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
  evidenceFromDayRow,
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

// ---- the SERVER-side gate: evidence reconstructed from the row's OWN jsonb (what the 0041
// trigger actually sees). The property test above proves the tautological CLIENT ceiling;
// THIS one proves the AUTHORITATIVE server ceiling never clamps an honest score — the half
// that was untested and where the weekly-carry false positive lived.
describe('evidenceFromDayRow (mirrors the 0041 trigger gates)', () => {
  const D = '2026-07-03';
  it('grants nothing for an empty row', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: {} })).toEqual({ nutritionPossible: false, checkinPossible: false, commitmentPresent: false });
  });
  it('unlocks nutrition when any meal is logged', () => {
    expect(evidenceFromDayRow({ date: D, meals: { breakfast: true }, checkin: {} }).nutritionPossible).toBe(true);
  });
  it('unlocks nutrition from slotMacros even with no meal boolean', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: { slotMacros: { lunch: { protein: 40, kcal: 600 } } } }).nutritionPossible).toBe(true);
  });
  it('unlocks nutrition from an active trust pass (ctx)', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: {} }, { activeTrustPass: true }).nutritionPossible).toBe(true);
  });
  it('unlocks check-in when submitted today', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: { submitted: true } }).checkinPossible).toBe(true);
  });
  it('unlocks check-in from a weekly carry the row self-describes (ciLast in window)', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: { submitted: false, ciLast: '2026-06-30' } }).checkinPossible).toBe(true);
  });
  it('does NOT unlock check-in from a stale ciLast outside the trailing week', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: { submitted: false, ciLast: '2026-06-20' } }).checkinPossible).toBe(false);
  });
  it('ignores a malformed ciLast without throwing', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: { ciLast: 'garbage' } }).checkinPossible).toBe(false);
  });
  it('unlocks commitment when an answer is present', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: { commitment: 'yes' } }).commitmentPresent).toBe(true);
  });
});

// Build the row the way sync.mapStateToDayRow does (evidence-relevant fields incl. the ciLast
// carry marker), so the ceiling is fed the SAME jsonb the trigger reads.
function rowFromState(s: AppState) {
  return {
    date: s.dateStamp!,
    meals: s.meals as unknown as Record<string, boolean>,
    checkin: { submitted: s.ciSubmitted, ciLast: s.ciLast?.date ?? null, commitment: s.dailyCommitment },
  };
}

describe('property (SERVER gates): a real score never exceeds the ceiling from its own row', () => {
  it('holds across meals, submit, WEEKLY CARRY, commitment and profiles — with NO server-visible prior row', () => {
    const commitments = [null, 'no', 'partial', 'yes'] as const;
    const profiles = [undefined, 'athlete', 'general', 'gain'] as const;
    const carries = [null, { date: '2026-06-30', recovery: 92 }, { date: '2026-06-20', recovery: 92 }] as const;
    let checked = 0;
    for (let meals = 0; meals <= 4; meals++) {
      for (const submitted of [false, true]) {
        for (const ciLast of carries) {
          for (const commitment of commitments) {
            for (const profile of profiles) {
              const s = stateWith({
                dateStamp: '2026-07-03',
                meals: mealsLogged(meals) as unknown as AppState['meals'],
                mealFoods: Object.fromEntries(MEAL_KEYS.slice(0, meals).map((k) => [k, [{ name: 'Logged meal', portion: '', servings: 1, per: { protein: 60, kcal: 700, carbs: 60, fat: 20 } }]])) as AppState['mealFoods'],
                ciSubmitted: submitted,
                ciEnergy: 9, ciRecovery: 9, ciSleep: 9, ciConfidence: 9, ciSoreness: 1, ciMotivation: 9,
                ciLast: ciLast as AppState['ciLast'],
                dailyCommitment: commitment as AppState['dailyCommitment'],
                scoringProfile: profile as AppState['scoringProfile'],
              });
              const d = computeDerived(s);
              // Worst case for the guard: the server sees NO prior submitted row (the carry
              // day never synced) and no trust pass — the exact divergence the bug exploited.
              const ceil = evidenceScoreCeiling(evidenceFromDayRow(rowFromState(s), { priorSubmittedInWeek: false }));
              expect(d.athleteScore).toBeLessThanOrEqual(ceil);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('REGRESSION: an honest weekly-carry day is NOT clamped even when its check-in day never reached the server', () => {
    // A real check-in earlier this week (recovery 92) that never synced to Postgres; today logs
    // no meal but the carry legitimately backs recovery + check-in. The old cross-row-only gate
    // clamped this honest day; the self-described ciLast marker fixes it.
    const s = stateWith({
      dateStamp: '2026-07-03',
      meals: mealsLogged(0) as unknown as AppState['meals'],
      ciSubmitted: false,
      ciRecovery: 9, ciEnergy: 9, ciSleep: 9, ciConfidence: 9, ciSoreness: 1, ciMotivation: 9,
      ciLast: { date: '2026-06-29', recovery: 92 } as AppState['ciLast'],
      dailyCommitment: 'yes',
    });
    const d = computeDerived(s);
    expect(d.recoveryScoreIsReal).toBe(true); // the carry genuinely credits recovery
    const ceil = evidenceScoreCeiling(evidenceFromDayRow(rowFromState(s), { priorSubmittedInWeek: false }));
    expect(d.athleteScore).toBeLessThanOrEqual(ceil); // and the server ceiling honors it — no clamp
  });
});
