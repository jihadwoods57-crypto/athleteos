/**
 * A PHOTO CAPTURE MUST LOG TO THE SLOT IT WAS TAKEN FOR (2026-08-02).
 *
 * Founder report: "meal breakdown macros is populating 0s when i clearly uploaded a meal."
 *
 * logMeal() resolved its slot through nextOpenSlot(), which — when the captured slot is ALREADY
 * logged — silently redirects to whatever other slot is still open. That redirect was written for
 * MANUAL logs ("log something, put it wherever is open"), but it also fired for photo captures,
 * and everything downstream keys off `MEAL.key === slot`:
 *
 *   hasPhoto  = MEAL.photoBase64 && MEAL.key === slot   -> false after a redirect
 *   optimistic = hasPhoto && !MEAL.result               -> false, so NO `pending` marker
 *   source    = MEAL.key === slot ? ... : 'manual'      -> 'manual'
 *   macros    = loggingMacros()                         -> all zeros, no result yet
 *
 * So the plate was filed under the wrong meal, the photo was dropped, and the slot SETTLED at 0g.
 * Worse, `source: 'manual'` makes the thread's emptyRead branch false (it requires fromPhoto), so
 * the athlete got bare "0g / 0 cal" tiles with no explanation and no "Re-read this meal" rescue —
 * the one affordance built for exactly this state.
 *
 * Reproduces the founder's path: test breakfast once (works), then photograph breakfast again.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act, MEAL, mealDetail } = require('../../proto/redesign-2026-07/js/state.js');
const { DAY } = require('../../proto/redesign-2026-07/js/day.js');

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
  RT.userId = 'athlete-1';
  for (const k of Object.keys(DAY.meals)) DAY.meals[k] = false;
  for (const k of Object.keys(DAY.slotMacros)) delete DAY.slotMacros[k];
  DAY.mealLoggedAt = {};
  act.clearMeal();
});

/** Stand in for the camera: a real capture for one specific slot, not yet analysed. */
function captureFor(slot: string) {
  MEAL.key = slot;
  MEAL.photoBase64 = 'BASE64PHOTOBYTES';
  MEAL.photoDataUrl = 'data:image/jpeg;base64,BASE64PHOTOBYTES';
  MEAL.photoHash = 'hash-' + slot;
  MEAL.result = null;
  MEAL.live = true;
  MEAL.source = 'live';
  MEAL.mealType = slot;
}

describe('a photo capture lands on the slot it was captured for', () => {
  test('the ordinary case: capturing an open slot logs it there, pending a read', () => {
    captureFor('breakfast');
    act.logMeal('breakfast');

    expect(DAY.meals.breakfast).toBe(true);
    const m = mealDetail('breakfast');
    expect(m.pending).toBe(true);        // the read is in flight — NOT settled at zero
    expect(m.source).toBe('live');
  });

  test('capturing a slot that is ALREADY logged must not silently refile it elsewhere at 0g', () => {
    // 1. breakfast already logged from an earlier test run
    captureFor('breakfast');
    act.logMeal('breakfast');
    expect(DAY.meals.breakfast).toBe(true);

    // 2. the founder photographs breakfast AGAIN
    act.clearMeal();
    captureFor('breakfast');
    act.logMeal('breakfast');

    // The redirect used to file this plate under lunch (or whatever slot was open), with the
    // photo dropped and every macro zero. Whatever the product decides to do about the conflict,
    // it must never invent a settled zero-macro meal in a slot the athlete never photographed.
    const lunch = mealDetail('lunch');
    const zeroSettled = DAY.meals.lunch
      && !lunch.pending
      && !lunch.macros.protein && !lunch.macros.carbs && !lunch.macros.fat && !lunch.macros.cals;
    expect(zeroSettled).toBe(false);

    // And nothing may be recorded as a hand-typed entry when a photo was plainly taken.
    for (const slot of ['breakfast', 'lunch', 'snack', 'dinner']) {
      if (!DAY.meals[slot]) continue;
      expect(mealDetail(slot).source).not.toBe('manual');
    }
  });

  test('a manual log with no photo still uses the open-slot redirect it was written for', () => {
    // No capture at all — logDinner()/day0Meal() style. nextOpenSlot's behaviour is correct here
    // and must survive the fix.
    act.clearMeal();
    act.logMeal('dinner');
    expect(DAY.meals.dinner).toBe(true);
    expect(mealDetail('dinner').pending).toBe(false); // nothing to wait for
  });
});
