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
