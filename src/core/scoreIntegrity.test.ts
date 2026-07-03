// Tests for the server-mirrored score-integrity ceiling. The load-bearing test is the
// PROPERTY test: for a wide sweep of day states, the real computeDerived() score is always
// <= its evidence ceiling — so clamping a written score DOWN to the ceiling can only ever
// cut a fabricated over-report and never lowers an honest day (the exact "partial recompute
// drifts and mis-scores every athlete" failure the 0029 guard note refused to risk).
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';
import {
  MAX_SUBSCORE_WEIGHT,
  evidenceScoreCeiling,
  clampScoreToEvidence,
  evidenceFromDerived,
} from './scoreIntegrity';
import type { AppState, MealKey } from './types';

describe('MAX_SUBSCORE_WEIGHT', () => {
  it('is the max weight each subscore carries across every scoring profile', () => {
    // athlete .5/.25/.15/.1, general .55/.2/.15/.1, gain .55/.25/.1/.1
    expect(MAX_SUBSCORE_WEIGHT.nutrition).toBeCloseTo(0.55);
    expect(MAX_SUBSCORE_WEIGHT.recovery).toBeCloseTo(0.25);
    expect(MAX_SUBSCORE_WEIGHT.commitment).toBeCloseTo(0.15);
    expect(MAX_SUBSCORE_WEIGHT.checkin).toBeCloseTo(0.1);
  });
});

describe('evidenceScoreCeiling', () => {
  it('is 0 when the row carries no evidence at all', () => {
    expect(evidenceScoreCeiling({ nutritionPossible: false, checkinPossible: false, commitmentPresent: false })).toBe(0);
  });

  it('caps a no-logging, no-check-in day below on-standard (photo logging is the only road to 80)', () => {
    // nutrition gated off -> at most recovery+checkin+commitment = 35 + 15 = 50 < 80.
    const ceil = evidenceScoreCeiling({ nutritionPossible: false, checkinPossible: true, commitmentPresent: true });
    expect(ceil).toBe(50);
    expect(ceil).toBeLessThan(80);
  });

  it('allows only the nutrition slot (55) when a meal is logged but nothing else', () => {
    expect(evidenceScoreCeiling({ nutritionPossible: true, checkinPossible: false, commitmentPresent: false })).toBe(55);
  });

  it('allows recovery + check-in (35) for a submitted check-in alone', () => {
    expect(evidenceScoreCeiling({ nutritionPossible: false, checkinPossible: true, commitmentPresent: false })).toBe(35);
  });

  it('allows the commitment slot (15) for a plan-commitment answer alone', () => {
    expect(evidenceScoreCeiling({ nutritionPossible: false, checkinPossible: false, commitmentPresent: true })).toBe(15);
  });

  it('reaches a full 100 only with all three evidence gates present', () => {
    expect(evidenceScoreCeiling({ nutritionPossible: true, checkinPossible: true, commitmentPresent: true })).toBe(100);
  });
});

describe('clampScoreToEvidence', () => {
  it('cuts a fabricated flat 100 with no evidence down to 0', () => {
    expect(clampScoreToEvidence(100, { nutritionPossible: false, checkinPossible: false, commitmentPresent: false })).toBe(0);
  });

  it('leaves a legit score at or below its ceiling untouched', () => {
    expect(clampScoreToEvidence(40, { nutritionPossible: true, checkinPossible: false, commitmentPresent: false })).toBe(40);
  });

  it('clamps a claimed 95 with only a logged meal down to the 55 nutrition ceiling', () => {
    expect(clampScoreToEvidence(95, { nutritionPossible: true, checkinPossible: false, commitmentPresent: false })).toBe(55);
  });
});

// ---- the property test: real score is ALWAYS <= its evidence ceiling ----
const MEAL_KEYS: MealKey[] = ['breakfast', 'lunch', 'snack', 'dinner'];

function stateWith(over: Partial<AppState>): AppState {
  return { ...createInitialState(), athleteName: 'Test Athlete', ...over } as AppState;
}

function mealsLogged(n: number): Record<MealKey, boolean> {
  const m = {} as Record<MealKey, boolean>;
  MEAL_KEYS.forEach((k, i) => (m[k] = i < n));
  return m;
}

describe('property: computeDerived score never exceeds its evidence ceiling', () => {
  const commitments = [null, 'no', 'partial', 'yes'] as const;
  const profiles = [undefined, 'athlete', 'general', 'gain'] as const;

  it('holds across meal counts, check-in states, commitments and scoring profiles', () => {
    let checked = 0;
    for (let meals = 0; meals <= 4; meals++) {
      for (const submitted of [false, true]) {
        for (const commitment of commitments) {
          for (const profile of profiles) {
            const s = stateWith({
              meals: mealsLogged(meals) as unknown as AppState['meals'],
              // give logged slots a real plate so nutrition (protein) can actually score high
              mealFoods: Object.fromEntries(
                MEAL_KEYS.slice(0, meals).map((k) => [k, [{ name: 'Logged meal', portion: '', servings: 1, per: { protein: 60, kcal: 700, carbs: 60, fat: 20 } }]]),
              ) as AppState['mealFoods'],
              ciSubmitted: submitted,
              ciEnergy: 9, ciRecovery: 9, ciSleep: 9, ciConfidence: 9, ciSoreness: 1, ciMotivation: 9,
              dailyCommitment: commitment as AppState['dailyCommitment'],
              scoringProfile: profile as AppState['scoringProfile'],
            });
            const d = computeDerived(s);
            const ceil = evidenceScoreCeiling(evidenceFromDerived(d));
            expect(d.athleteScore).toBeLessThanOrEqual(ceil);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100); // the sweep actually ran
  });

  it('a maxed-out honest day still lands at or under 100 and is never clamped', () => {
    const s = stateWith({
      meals: mealsLogged(4) as unknown as AppState['meals'],
      mealFoods: Object.fromEntries(
        MEAL_KEYS.map((k) => [k, [{ name: 'Logged meal', portion: '', servings: 1, per: { protein: 80, kcal: 800, carbs: 80, fat: 25 } }]]),
      ) as AppState['mealFoods'],
      ciSubmitted: true,
      ciEnergy: 10, ciRecovery: 10, ciSleep: 10, ciConfidence: 10, ciSoreness: 0, ciMotivation: 10,
      dailyCommitment: 'yes',
    });
    const d = computeDerived(s);
    expect(clampScoreToEvidence(d.athleteScore, evidenceFromDerived(d))).toBe(d.athleteScore);
  });
});
