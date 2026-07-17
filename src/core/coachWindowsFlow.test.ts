/**
 * End-to-end pin: coach standards editor items -> catalog/std shaping -> status/priority/
 * notification engines all honor coach-set meal windows (js/screens/coach.js `window:{open,due}`)
 * instead of falling back to the old hardcoded defaults (570/840/1230).
 *
 * coach.js's import chain pulls in state.js, whose `export const RT = load()` reads
 * localStorage at MODULE LOAD TIME — so, per src/core/coachPlanKnobs.test.ts (the established
 * precedent for pulling a proto/screens module under Jest), we build a real DOM with jsdom and
 * install window/document/localStorage globals BEFORE lazily requiring the screen module.
 * requirements.js / status.js / notify-plan.js are pure and import cleanly.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).MouseEvent = dom.window.MouseEvent;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { itemsFromKnobs } = require('../../proto/redesign-2026-07/js/screens/coach.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { catalogFromItems, stdFromItems } = require('../../proto/redesign-2026-07/js/requirements.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { athleteStatus } = require('../../proto/redesign-2026-07/js/status.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { planNotifications, DEFAULT_NOTIF_PREFS } = require('../../proto/redesign-2026-07/js/notify-plan.js');

const KNOB = { key: 'team:', meals: 2, lifts: 0, weigh: 'off', hydration: false, hydrationOz: 120,
               recovery: false, checkin: false, photoProof: true,
               mealNames: ['Early Fuel', 'Team Dinner'],
               mealWins: [{ open: 300, due: 420 }, { open: 1000, due: 1100 }] }; // 5-7a, 4:40-6:20p
const reqs = catalogFromItems(itemsFromKnobs(KNOB));
const row = (over: object = {}) => ({ athleteId: 'a1', name: 'Devin', score: 90, loggedToday: true,
  tasks: [], lastMealAt: null, scoreHistory: [], ...over });

test('custom window: due_soon inside 60min of the coach-set due, not the old defaults', () => {
  // 6:30am = 390 — inside [420-60, 420] of Early Fuel, far from default breakfast 570
  const s = athleteStatus({ nowMin: 390, row: row(), reqs, excused: false });
  expect(s.key).toBe('due_soon');
  expect(s.detail).toContain('Early Fuel');
});

test('custom window: overdue strictly after coach-set due', () => {
  const s = athleteStatus({ nowMin: 421, row: row(), reqs, excused: false });
  expect(s.key).toBe('overdue');
});

test('before a custom open the item is upcoming, never due_soon', () => {
  const s = athleteStatus({ nowMin: 200, row: row(), reqs, excused: false });
  expect(s.key).toBe('on_standard');
});

test('reminders fire off the coach-set due (soon = due - lead), with custom title in copy', () => {
  const plan = planNotifications({ nowMin: 0, dateISO: '2026-07-17', dayOffset: 0, reqs,
    assigned: [], pressure: 'accountable', prefs: DEFAULT_NOTIF_PREFS,
    celebration: null, score: null, streak: 0, coachName: 'Coach' });
  // notify-plan.js pushes each entry as { id: req.id, ... } (no suffix) — req.id for the first
  // meal item is 'meal-1' (itemsFromKnobs), so the id itself (not a composed '-soon' suffix)
  // identifies the requirement; `stage` distinguishes soon/due/open.
  const soon = plan.find((p: any) => p.id === 'meal-1' && p.stage === 'soon');
  expect(soon).toBeTruthy();
  // Raw lead math is due - LEAD.accountable = 420 - 45 = 375 (6:15am), but that falls inside
  // DEFAULT_NOTIF_PREFS' quiet window (10pm-7am) — notify-plan.js's documented quiet-hours rule
  // shifts a non-'due' stage to the quiet-window end (420, i.e. 7:00am) instead of dropping it.
  // It still pins the coach-set due, not the old hardcoded breakfast default (570): with the old
  // default, lead would land at 525 (8:45am, outside quiet hours) and this assertion would fail.
  expect(soon.fireAtMin).toBe(420);
  expect(soon.title).toContain('Early Fuel');
});

test('the athlete day standard carries the same windows (stdFromItems parity)', () => {
  const std = stdFromItems(itemsFromKnobs(KNOB))!;
  expect(std.deadlines[std.slots[0]]).toBe(420);
  expect(std.titles[std.slots[1]]).toBe('Team Dinner');
});
