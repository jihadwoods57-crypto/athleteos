// OnStandard — Starting Point Score (pure TS, no RN imports).
//
// ┌─ NOT REACHABLE FROM THE SHIPPED APP (verified 2026-09-07) ────────────────────────────────┐
// │ Nothing an athlete uses calls this. Its only consumer is src/store/useStore.ts            │
// │ (commitStartingScore), and `src/` is the legacy React Native engine that mostly renders   │
// │ nothing — the shipped UI is proto/redesign-2026-07. Three of the six inputs this file     │
// │ needs (nutritionConfidence, waterL, proteinFreq) appear ZERO times anywhere in proto/, so │
// │ the baseline assessment it scores is not a flow the athlete is ever put through.          │
// │                                                                                           │
// │ It is also contradicted by what the app now promises. The shipped athlete onboarding says,│
// │ on screen: "Example score: yours starts fresh and is earned" (ob2-athlete.js), and twice  │
// │ more that the score "simply reports whether you kept it". Seeding a day-0 number from      │
// │ self-report would break a commitment made in the athlete's first five minutes.            │
// │                                                                                           │
// │ Kept rather than deleted because it is considered design, not debris — the weights and the │
// │ day-0 reconcile were thought through. Reviving it is a PRODUCT decision (does the athlete  │
// │ get a self-reported starting number at all?), not a wiring job. Founder question that      │
// │ surfaced it: "would it make more sense to start the daily score not at 0?" — answered no,  │
// │ at the presentation layer instead (scoreRing `notStarted`).                                │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
// The onboarding baseline assessment turns six self-reported habit answers into an
// honest *starting* score (0-100). It is explicitly an estimate from self-report —
// it seeds day-0 and is replaced by measured behavior as the athlete logs real days.
// Transparent, fixed weights so the number is explainable, never a black box.

export interface BaselineAnswers {
  nutritionConfidence: number; // 1-10
  mealsPerDay: number; // count
  waterL: number; // liters/day
  sleepH: number; // hours/night
  proteinFreq: number; // 0 never · 1 sometimes · 2 often · 3 always
  consistency: number; // 1-10 week-to-week
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Each answer's max contribution; they sum to 100. Protein adherence + consistency +
 *  nutrition confidence carry the most (they predict real-world score the hardest);
 *  meals / water / sleep round it out. */
export const STARTING_WEIGHTS = {
  proteinFreq: 25,
  nutritionConfidence: 20,
  consistency: 20,
  mealsPerDay: 15,
  water: 10,
  sleep: 10,
} as const;

/** Compute the Starting Point Score (0-100) from the baseline answers. */
export function startingScore(a: BaselineAnswers): number {
  const proteinPts = (clamp(a.proteinFreq, 0, 3) / 3) * STARTING_WEIGHTS.proteinFreq;
  const confPts = (clamp(a.nutritionConfidence, 1, 10) / 10) * STARTING_WEIGHTS.nutritionConfidence;
  const consPts = (clamp(a.consistency, 1, 10) / 10) * STARTING_WEIGHTS.consistency;
  // meals: 2 is a floor, 5+ is full credit.
  const mealsPts = ((clamp(a.mealsPerDay, 2, 5) - 2) / 3) * STARTING_WEIGHTS.mealsPerDay;
  // water: 3.8 L (~1 gal) is full credit.
  const waterPts = (clamp(a.waterL, 0, 3.8) / 3.8) * STARTING_WEIGHTS.water;
  // sleep: 4 h floor, 9 h full credit.
  const sleepPts = ((clamp(a.sleepH, 4, 9) - 4) / 5) * STARTING_WEIGHTS.sleep;
  const total = proteinPts + confPts + consPts + mealsPts + waterPts + sleepPts;
  return clamp(Math.round(total), 0, 100);
}

const BANDS: { min: number; letter: string }[] = [
  { min: 90, letter: 'A' },
  { min: 80, letter: 'B' },
  { min: 70, letter: 'C' },
  { min: 60, letter: 'D' },
  { min: 0, letter: 'F' },
];

/** Letter grade with a +/- suffix from the athlete's position within the band
 *  (top third → +, bottom third → −). Used for the onboarding reveal only; the
 *  dashboards keep whole-letter grades. F carries no suffix. */
export function gradeWithSuffix(score: number): string {
  const s = clamp(Math.round(score), 0, 100);
  const band = BANDS.find((b) => s >= b.min)!;
  if (band.letter === 'F') return 'F';
  const offset = s - band.min; // 0-9 (A can reach 10 at 100)
  if (offset >= 7) return `${band.letter}+`;
  if (offset <= 2) return `${band.letter}-`;
  return band.letter;
}

/** Score gained from completing the first-meal challenge — the activation reward.
 *  Small, honest bump that proves the loop (logging real behavior moves the number). */
export const FIRST_MEAL_BUMP = 3;

/** Apply the first-meal challenge bump to a starting score (capped at 100). */
export function scoreAfterFirstMeal(start: number): number {
  return clamp(start + FIRST_MEAL_BUMP, 0, 100);
}

/** Map baseline sleep hours onto the 1-10 check-in sleep slider, so the in-app
 *  recovery score continues sensibly from self-report instead of a flat default. */
export function sleepHoursToSlider(h: number): number {
  return clamp(Math.round((clamp(h, 0, 10) / 9) * 10), 1, 10);
}
