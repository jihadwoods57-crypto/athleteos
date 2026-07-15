// PARITY: the proto's ported scoring (proto/redesign-2026-07/js/day.js) must produce the EXACT
// same numbers as the real RN engine (computeDerived) for identical inputs. Drives both from the
// same AppState fixtures so the proto can never silently drift from the score of record.
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';
import { MEAL_MACROS } from './constants';
import { mealMacros } from './mealEdit';
import type { AppState } from './types';
// proto is plain ESM JS (no types)
// @ts-ignore — importing the proto's ported compute functions (allowJs)
import { computeComponents, scoreFor } from '../../proto/redesign-2026-07/js/day.js';

const MEAL_KEYS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;

// Map an AppState to the proto's DAY shape, mirroring the engine's evidence rule (mealSlotMacros):
// showcase (blank name) → constant macros; real user → macros only if a plate exists.
function toDay(s: AppState) {
  const slotMacros: Record<string, unknown> = {};
  for (const k of MEAL_KEYS) {
    if (!s.meals[k]) continue;
    if (s.mealFoods && s.mealFoods[k]) slotMacros[k] = mealMacros(s.mealFoods[k]!);
    else if (s.athleteName) slotMacros[k] = null; // real user, no plate → no macros
    else {
      // showcase constant — MEAL_MACROS uses {p,k,c,f}; the proto (like mealMacros / the AI
      // result) uses {protein,kcal,carbs,fat}, which is the real on-device shape.
      const m = MEAL_MACROS[k];
      slotMacros[k] = { protein: m.p, kcal: m.k, carbs: m.c, fat: m.f };
    }
  }
  return {
    date: (s as unknown as { dateStamp: string }).dateStamp,
    meals: { ...s.meals },
    slotMacros,
    mealLoggedAt: s.mealLoggedAt,
    quickAdded: s.quickAdded,
    ci: { energy: s.ciEnergy, recovery: s.ciRecovery, sleep: s.ciSleep, confidence: s.ciConfidence, soreness: s.ciSoreness, motivation: s.ciMotivation },
    ciConfig: s.ciConfig,
    ciSubmitted: s.ciSubmitted,
    ciLast: s.ciLast,
    dailyCommitment: s.dailyCommitment,
    proteinTarget: s.proteinTarget,
    calTarget: s.calTarget,
    scoringProfile: s.scoringProfile || 'athlete',
  };
}

function parity(label: string, s: AppState) {
  const d = computeDerived(s);
  const day = toDay(s);
  const c = computeComponents(day);
  expect({ label, nutrition: c.nutrition }).toEqual({ label, nutrition: d.nutritionScore });
  expect({ label, recovery: c.recoveryContribution }).toEqual({ label, recovery: d.recoveryScoreIsReal ? d.recoveryScore : 0 });
  expect({ label, checkin: c.checkin }).toEqual({ label, checkin: d.checkinScore });
  expect({ label, score: scoreFor(day) }).toEqual({ label, score: d.athleteScore });
}

const base = createInitialState();
const withMeals = (over: Partial<AppState['meals']>): AppState =>
  ({ ...createInitialState(), meals: { ...createInitialState().meals, ...over } } as AppState);

describe('proto day.js ↔ RN engine score parity (athlete profile)', () => {
  it('default showcase day (39/F anchor)', () => parity('default', base));
  it('+ dinner logged', () => parity('dinner', withMeals({ dinner: true })));
  it('full day: check-in + commitment + all meals', () =>
    parity('full', { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: true, dinner: true }, ciSubmitted: true, dailyCommitment: 'yes' } as AppState));
  it('commitment = partial', () => parity('partial', { ...createInitialState(), dailyCommitment: 'partial' } as AppState));
  it('commitment = no', () => parity('no', { ...createInitialState(), dailyCommitment: 'no' } as AppState));
  it('real user, nothing logged (0/F)', () =>
    parity('empty-real', { ...createInitialState(), athleteName: 'Real User', meals: { breakfast: false, lunch: false, snack: false, dinner: false }, mealFoods: {} } as AppState));
  it('real user, one plated meal (evidence rule)', () =>
    parity('one-plate', { ...createInitialState(), athleteName: 'Real User', meals: { breakfast: true, lunch: false, snack: false, dinner: false }, mealFoods: { breakfast: [{ name: 'Eggs', servings: 1, per: { protein: 30, kcal: 300, carbs: 5, fat: 18 } }] } } as unknown as AppState));
  it('quick-add protein bumps nutrition', () =>
    parity('quick', { ...createInitialState(), quickAdded: [true, false, true] } as AppState));
});

// A trainer's client (goal = lose/maintain) is scored on the `general` profile and a muscle-gain
// client on `gain` — both calorie-target led. The proto MUST reproduce those too, or a client's
// number silently diverges from the engine of record. Showcase day (blank name) = MEAL_MACROS, so
// a full day is 2180 kcal (520+680+300+680); fixtures pick calTarget to hit each branch of the
// two adherence curves (on-window / linear falloff / zeroed).
describe('proto day.js ↔ RN engine score parity (general / gain profiles)', () => {
  const full = { breakfast: true, lunch: true, snack: true, dinner: true };
  const cfg = (over: Omit<Partial<AppState>, 'meals'> & { meals?: Partial<AppState['meals']> }): AppState =>
    ({ ...createInitialState(), ...over, meals: { ...createInitialState().meals, ...(over.meals ?? {}) } } as AppState);

  it('general: calories on target (dev ≤ 10% → full credit)', () =>
    parity('gen-on', cfg({ scoringProfile: 'general', calTarget: 2180, meals: { ...full } })));
  it('general: calories mildly off (linear falloff)', () =>
    parity('gen-mild', cfg({ scoringProfile: 'general', calTarget: 2600, meals: { ...full } })));
  it('general: overeating far past target (dev ≥ 40% → 0 credit)', () =>
    parity('gen-over', cfg({ scoringProfile: 'general', calTarget: 1000, meals: { ...full } })));
  it('general: crash deficit vs a high target (0 credit)', () =>
    parity('gen-under', cfg({ scoringProfile: 'general', calTarget: 6000, meals: { breakfast: true } })));
  it('general: nothing logged', () =>
    parity('gen-empty', cfg({ scoringProfile: 'general', calTarget: 2200, meals: { breakfast: false, lunch: false, snack: false, dinner: false } })));
  it('general: quick-adds add kcal + protein', () =>
    parity('gen-quick', cfg({ scoringProfile: 'general', calTarget: 2600, meals: { dinner: true }, quickAdded: [true, true, false] })));
  it('general: full honest day (check-in + commitment)', () =>
    parity('gen-full', cfg({ scoringProfile: 'general', calTarget: 2180, meals: { ...full }, ciSubmitted: true, dailyCommitment: 'yes' })));

  it('gain: calorie floor met (full credit)', () =>
    parity('gain-met', cfg({ scoringProfile: 'gain', calTarget: 2180, meals: { ...full } })));
  it('gain: over target is never penalized', () =>
    parity('gain-over', cfg({ scoringProfile: 'gain', calTarget: 1000, meals: { ...full } })));
  it('gain: partial floor (linear)', () =>
    parity('gain-lin', cfg({ scoringProfile: 'gain', calTarget: 3000, meals: { ...full } })));
  it('gain: well under the floor (0 credit)', () =>
    parity('gain-under', cfg({ scoringProfile: 'gain', calTarget: 5000, meals: { breakfast: true, lunch: true } })));
});
