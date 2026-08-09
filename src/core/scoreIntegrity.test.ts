// Tests for the server-mirrored score-integrity ceiling. The load-bearing test is the
// PROPERTY test: for a wide sweep of day states, the real computeDerived() score is always
// <= its evidence ceiling — so clamping a written score DOWN to the ceiling can only ever
// cut a fabricated over-report and never lowers an honest day (the exact "partial recompute
// drifts and mis-scores every athlete" failure the 0029 guard note refused to risk).
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';
import {
  MAX_SUBSCORE_WEIGHT,
  SCORING_V2_CUTOVER,
  evidenceScoreCeiling,
  clampScoreToEvidence,
  evidenceFromDerived,
  evidenceFromDayRow,
} from './scoreIntegrity';
import type { AppState, MealKey } from './types';

/** A date on the v2 side of the cutover — the era the live engine now computes in. */
const V2 = '2026-08-20';
/** A date on the v1 side — frozen history. */
const V1 = '2026-08-01';

describe('MAX_SUBSCORE_WEIGHT', () => {
  it('is the max weight each subscore carries across every scoring profile', () => {
    // v2: athlete .76/.12/0/.12, general .78/.10/0/.12, gain .76/.12/0/.12
    expect(MAX_SUBSCORE_WEIGHT.nutrition).toBeCloseTo(0.78);
    expect(MAX_SUBSCORE_WEIGHT.recovery).toBeCloseTo(0.12);
    expect(MAX_SUBSCORE_WEIGHT.commitment).toBeCloseTo(0);
    expect(MAX_SUBSCORE_WEIGHT.checkin).toBeCloseTo(0.12);
  });
});

describe('evidenceScoreCeiling', () => {
  it('is 0 when the row carries no evidence at all', () => {
    expect(evidenceScoreCeiling({ nutritionPossible: false, checkinPossible: false, commitmentPresent: false }, V2)).toBe(0);
  });

  it('caps a no-logging day below on-standard (photo logging is the only road to 80)', () => {
    // v2: nutrition gated off -> at most recovery+checkin+commitment = 24 + 0 = 24 < 80.
    // (commitment carries weight 0 in v2, so a commitment answer alone adds nothing.)
    const ceil = evidenceScoreCeiling({ nutritionPossible: false, checkinPossible: true, commitmentPresent: true }, V2);
    expect(ceil).toBe(24);
    expect(ceil).toBeLessThan(80);
  });

  it('allows only the nutrition slot (78) when a meal is logged but nothing else', () => {
    expect(evidenceScoreCeiling({ nutritionPossible: true, checkinPossible: false, commitmentPresent: false }, V2)).toBe(78);
  });

  it('allows recovery + check-in (24) for a submitted check-in alone', () => {
    expect(evidenceScoreCeiling({ nutritionPossible: false, checkinPossible: true, commitmentPresent: false }, V2)).toBe(24);
  });

  it('v2: a plan-commitment answer alone unlocks nothing (commitment no longer scores)', () => {
    expect(evidenceScoreCeiling({ nutritionPossible: false, checkinPossible: false, commitmentPresent: true }, V2)).toBe(0);
  });

  it('reaches a full 100 only with all three evidence gates present', () => {
    expect(evidenceScoreCeiling({ nutritionPossible: true, checkinPossible: true, commitmentPresent: true }, V2)).toBe(100);
  });
});

describe('clampScoreToEvidence', () => {
  it('cuts a fabricated flat 100 with no evidence down to 0', () => {
    expect(clampScoreToEvidence(100, { nutritionPossible: false, checkinPossible: false, commitmentPresent: false }, V2)).toBe(0);
  });

  it('leaves a legit score at or below its ceiling untouched', () => {
    expect(clampScoreToEvidence(40, { nutritionPossible: true, checkinPossible: false, commitmentPresent: false }, V2)).toBe(40);
  });

  it('clamps a claimed 95 with only a logged meal down to the 78 nutrition ceiling', () => {
    expect(clampScoreToEvidence(95, { nutritionPossible: true, checkinPossible: false, commitmentPresent: false }, V2)).toBe(78);
  });
});

// ---- the DATE GUARD: which era's ceiling a row is judged under ----
describe('score v2 evidence ceiling — the cutover date guard', () => {
  const nothing = { nutritionPossible: false, checkinPossible: false, commitmentPresent: false };

  it('after cutover: nutrition evidence unlocks 78, a check-in unlocks 24', () => {
    expect(evidenceScoreCeiling({ ...nothing, nutritionPossible: true }, V2)).toBe(78);
    expect(evidenceScoreCeiling({ ...nothing, checkinPossible: true }, V2)).toBe(24);
    expect(evidenceScoreCeiling({ nutritionPossible: true, checkinPossible: true, commitmentPresent: false }, V2)).toBe(100);
  });

  it('after cutover: a commitment answer alone justifies nothing', () => {
    expect(evidenceScoreCeiling({ ...nothing, commitmentPresent: true }, V2)).toBe(0);
  });

  it('BEFORE cutover the v1 slots still apply, so frozen history is never re-clamped', () => {
    // The whole point of the guard: v1 rows had a REAL 15-point commitment slot and a 35-point
    // recovery+check-in slot (which a weekly carry could unlock). Judging them under v2 would
    // strip both and rewrite history.
    expect(evidenceScoreCeiling({ ...nothing, commitmentPresent: true }, V1)).toBe(15);
    expect(evidenceScoreCeiling({ ...nothing, checkinPossible: true }, V1)).toBe(35);
  });

  it('BEFORE cutover nutrition unlocks 78, not 55 — the pre-cutover ceiling is the UNION of both eras', () => {
    // Deliberate widening of the brief's literal v1 number, and the ONE slot where the two eras
    // disagree upward (v1 55 -> v2 78). It is required for correctness, not a nicety:
    //
    //   sync.ts:mapStateToDayRow self-clamps with THIS function using the row's own date. Once
    //   the v2 engine ships, a row dated before the cutover can still be written by it — an
    //   offline backlog draining after the cutover, a 12:05am push whose dateStamp is still
    //   yesterday, or a re-push of a recent day. That row's score is a v2 score (nutrition up to
    //   78). A strict 55 would clamp it to 55 in the client AND again in the trigger: exactly the
    //   "silently writes 55 where it computed 76" corruption this whole task exists to prevent.
    //
    // Widening is the safe direction (a looser ceiling clamps less and never touches an honest
    // score), it preserves every grant v1 made, and it cannot move an existing row: the union is
    // >= the v1 ceiling everywhere, so any row that did not move under v1 cannot move under it.
    expect(evidenceScoreCeiling({ ...nothing, nutritionPossible: true }, V1)).toBe(78);
  });

  it('the cutover date itself is scored under v2', () => {
    expect(evidenceScoreCeiling({ ...nothing, commitmentPresent: true }, SCORING_V2_CUTOVER)).toBe(0);
  });

  it('the pre-cutover ceiling is never TIGHTER than the post-cutover one for any evidence combination', () => {
    // HONEST SCOPE: this cannot fail while PRE_CUTOVER_CEILING is built with Math.max over the
    // two eras — it is true by construction today. It is kept as a REGRESSION PIN, not a proof:
    // the moment someone hardcodes the pre-cutover slots (the brief's original 55/35/15, say) or
    // edits one of the three constants by hand, this is what catches it. What it genuinely
    // guarantees is the property the date guard depends on — that a v2 score landing on a
    // pre-cutover row can never be clamped below its honest value.
    for (const nutritionPossible of [false, true]) {
      for (const checkinPossible of [false, true]) {
        for (const commitmentPresent of [false, true]) {
          const ev = { nutritionPossible, checkinPossible, commitmentPresent };
          expect(evidenceScoreCeiling(ev, V1)).toBeGreaterThanOrEqual(evidenceScoreCeiling(ev, V2));
        }
      }
    }
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

  it('holds across meal counts, check-in states, commitments and scoring profiles — on BOTH sides of the cutover', () => {
    let checked = 0;
    for (const rowDate of [V1, V2]) {
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
            const ceil = evidenceScoreCeiling(evidenceFromDerived(d), rowDate);
            expect(d.athleteScore).toBeLessThanOrEqual(ceil);
            checked++;
          }
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
    for (const rowDate of [V1, V2]) {
      expect(clampScoreToEvidence(d.athleteScore, evidenceFromDerived(d), rowDate)).toBe(d.athleteScore);
    }
  });
});

// ---- the SERVER-side gate: evidence reconstructed from the row's OWN jsonb (what the 0041
// trigger actually sees). The property test above proves the tautological CLIENT ceiling;
// THIS one proves the AUTHORITATIVE server ceiling never clamps an honest score — the half
// that was untested and where the weekly-carry false positive lived.
describe('evidenceFromDayRow (mirrors the 0193 trigger gates)', () => {
  const D = '2026-07-03'; // pre-cutover, so the v1 carry gate is live
  it('grants nothing for an empty row', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: {} })).toEqual({ nutritionPossible: false, checkinPossible: false, commitmentPresent: false });
  });
  it('unlocks nutrition when any meal is logged', () => {
    expect(evidenceFromDayRow({ date: D, meals: { breakfast: true }, checkin: {} }).nutritionPossible).toBe(true);
  });
  it('unlocks nutrition for a 5-/6-meal coach standard slot (meal-5 / meal-6)', () => {
    // The meals jsonb is scanned by VALUE, not against a hardcoded classic-four key list, so a
    // room on a 5- or 6-meal standard (STD_SLOT_MAP) is honoured without the server knowing it.
    expect(evidenceFromDayRow({ date: D, meals: { 'meal-5': true }, checkin: {} }).nutritionPossible).toBe(true);
    expect(evidenceFromDayRow({ date: D, meals: { 'meal-6': true }, checkin: {} }).nutritionPossible).toBe(true);
  });
  it('unlocks nutrition from slotMacros even with no meal boolean', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: { slotMacros: { lunch: { protein: 40, kcal: 600 } } } }).nutritionPossible).toBe(true);
  });
  it('unlocks nutrition from a quick-add with no meal slot and no plate at all', () => {
    // The gap the proto found and Task 2 fixed: a quick-add-only day earns real nutrition credit
    // client-side. Without this gate the server ceiling was 0 and erased the whole day.
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: {}, quick_added: [false, true, false] }).nutritionPossible).toBe(true);
  });
  it('an all-false quick_added array is not evidence', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: {}, quick_added: [false, false, false] }).nutritionPossible).toBe(false);
  });
  it('ignores a malformed quick_added without throwing (the SQL rejects such a row outright)', () => {
    // Intentional divergence from the trigger, and the only one. 0193 fails CLOSED on an
    // unreadable shape: it raises and the write is rejected, because there is no honest path to a
    // non-array quick_added and a silent clamp would be the very corruption it guards against.
    // This mirror stays tolerant instead — it runs inside the app process, where throwing would
    // take down a render for a shape TypeScript already makes unreachable. The two agree on every
    // row that can actually reach Postgres.
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: {}, quick_added: 'nope' as unknown as boolean[] }).nutritionPossible).toBe(false);
  });
  it('unlocks nutrition from an active trust pass (ctx)', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: {} }, { activeTrustPass: true }).nutritionPossible).toBe(true);
  });
  it('unlocks check-in when submitted today', () => {
    expect(evidenceFromDayRow({ date: D, meals: {}, checkin: { submitted: true } }).checkinPossible).toBe(true);
  });
  it('v1 only: unlocks check-in from a weekly carry the row self-describes (ciLast in window)', () => {
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

  it('v2: NO carry — only a check-in submitted that day unlocks the slot', () => {
    // The engine no longer carries recovery (checkinReal = ciSubmitted only), so a v2 row whose
    // only check-in evidence is a carry marker scores 0 there. Tightening the gate to match is
    // safe (it can never clamp a score the engine gave 0) and closes the tamper path where a
    // fabricated ciLast bought 24 points.
    expect(evidenceFromDayRow({ date: V2, meals: {}, checkin: { submitted: false, ciLast: '2026-08-19' } }).checkinPossible).toBe(false);
    expect(evidenceFromDayRow({ date: V2, meals: {}, checkin: { submitted: true } }).checkinPossible).toBe(true);
    // ...and a server-visible prior submitted row is likewise not evidence for a v2 row.
    expect(evidenceFromDayRow({ date: V2, meals: {}, checkin: {} }, { priorSubmittedInWeek: true }).checkinPossible).toBe(false);
  });
});

// Build the row the way sync.mapStateToDayRow does (evidence-relevant fields incl. the ciLast
// carry marker), so the ceiling is fed the SAME jsonb the trigger reads.
function rowFromState(s: AppState) {
  return {
    date: s.dateStamp!,
    meals: s.meals as unknown as Record<string, boolean>,
    quick_added: s.quickAdded,
    checkin: { submitted: s.ciSubmitted, ciLast: s.ciLast?.date ?? null, commitment: s.dailyCommitment },
  };
}

describe('property (SERVER gates): a real score never exceeds the ceiling from its own row', () => {
  it('holds across meals, submit, WEEKLY CARRY, commitment and profiles — BOTH eras, with NO server-visible prior row', () => {
    const commitments = [null, 'no', 'partial', 'yes'] as const;
    const profiles = [undefined, 'athlete', 'general', 'gain'] as const;
    let checked = 0;
    // Each era gets carry markers inside and outside its own trailing week.
    for (const [rowDate, carries] of [
      ['2026-07-03', [null, { date: '2026-06-30', recovery: 92 }, { date: '2026-06-20', recovery: 92 }]],
      [V2, [null, { date: '2026-08-19', recovery: 92 }, { date: '2026-08-01', recovery: 92 }]],
    ] as const) {
    for (let meals = 0; meals <= 4; meals++) {
      for (const submitted of [false, true]) {
        for (const ciLast of carries) {
          for (const commitment of commitments) {
            for (const profile of profiles) {
              const s = stateWith({
                dateStamp: rowDate,
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
              const ceil = evidenceScoreCeiling(evidenceFromDayRow(rowFromState(s), { priorSubmittedInWeek: false }), rowDate);
              expect(d.athleteScore).toBeLessThanOrEqual(ceil);
              checked++;
            }
          }
        }
      }
    }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('v2: a stale weekly-carry day (no client credit) still never exceeds the server ceiling', () => {
    // v1: a real check-in earlier this week (recovery 92) that never synced to Postgres still
    // legitimately backed recovery + check-in via the client's carry, and this test proved the
    // server ceiling (built from the row's self-described ciLast) never clamped that honest day.
    // v2 retires the client-side carry entirely (score.ts §5: "checked in TONIGHT" only), so
    // this day now scores 0 client-side — trivially at or under any ceiling. The SERVER-side
    // evidenceFromDayRow gate below is untouched (Task 4's scope) and still recognizes ciLast,
    // which is fine: a ceiling may be more generous than the score it bounds, never less.
    const s = stateWith({
      dateStamp: '2026-07-03',
      meals: mealsLogged(0) as unknown as AppState['meals'],
      ciSubmitted: false,
      ciRecovery: 9, ciEnergy: 9, ciSleep: 9, ciConfidence: 9, ciSoreness: 1, ciMotivation: 9,
      ciLast: { date: '2026-06-29', recovery: 92 } as AppState['ciLast'],
      dailyCommitment: 'yes',
    });
    const d = computeDerived(s);
    expect(d.recoveryScoreIsReal).toBe(false); // v2: no client-side weekly carry
    const ceil = evidenceScoreCeiling(evidenceFromDayRow(rowFromState(s), { priorSubmittedInWeek: false }), s.dateStamp!);
    expect(d.athleteScore).toBeLessThanOrEqual(ceil); // still never clamped — score is 0, ceiling is >= 0
  });

  it('a v2-computed nutrition day written under a PRE-cutover date is never clamped', () => {
    // The corruption scenario the union pre-cutover ceiling exists for: an offline backlog or a
    // pre-rollover push lands a v2 score (nutrition up to 78) on a row dated before the cutover.
    // A strict v1 ceiling of 55 would cut it — here, in the client's own self-clamp — with no
    // error surfaced. This is the regression test for that.
    const s = stateWith({
      dateStamp: '2026-08-15', // the day before cutover
      meals: mealsLogged(4) as unknown as AppState['meals'],
      mealFoods: Object.fromEntries(
        MEAL_KEYS.map((k) => [k, [{ name: 'Logged meal', portion: '', servings: 1, per: { protein: 80, kcal: 800, carbs: 80, fat: 25 } }]]),
      ) as AppState['mealFoods'],
      ciSubmitted: false,
      scoringProfile: 'general', // the profile carrying the .78 nutrition weight
    });
    const d = computeDerived(s);
    expect(d.athleteScore).toBeGreaterThan(55); // a real v2 score above the old v1 nutrition slot
    const ceil = evidenceScoreCeiling(evidenceFromDayRow(rowFromState(s), { priorSubmittedInWeek: false }), s.dateStamp!);
    expect(d.athleteScore).toBeLessThanOrEqual(ceil);
    expect(clampScoreToEvidence(d.athleteScore, evidenceFromDayRow(rowFromState(s)), s.dateStamp!)).toBe(d.athleteScore);
  });
});
