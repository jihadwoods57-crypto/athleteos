// OnStandard — content data + display-string helpers (pure).
// Ported from the prototype: meal log, meal-analysis results, AI insight, pace.
import type { AppState, CiConfig, Derived, MealKey, MealLabel } from './types';
import type { MacroConfidence } from './macroGrounding';
import { mealSlotMacros } from './scoring';

export interface LoggedMeal {
  id: string;
  name: string;
  time: string;
  quality: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  thumb: [string, string];
  foods: { n: string; p: string }[];
  sub: { l: string; s: number }[];
  note: string;
}

export const MEALS_LOG: LoggedMeal[] = [
  {
    id: 'b',
    name: 'Overnight Oats & Berries',
    time: '7:40 AM',
    quality: 88,
    kcal: 520,
    protein: 42,
    carbs: 68,
    fat: 12,
    thumb: ['#FDE68A', '#F59E0B'],
    foods: [
      { n: 'Rolled oats', p: '1 cup' },
      { n: 'Greek yogurt', p: '¾ cup' },
      { n: 'Blueberries', p: '½ cup' },
      { n: 'Almond butter', p: '1 tbsp' },
    ],
    sub: [
      { l: 'Protein density', s: 90 },
      { l: 'Whole foods', s: 94 },
      { l: 'Macro balance', s: 84 },
      { l: 'Meal timing', s: 86 },
    ],
    note: 'Great recovery breakfast. The yogurt and oats give you slow-release energy for a morning lift.',
  },
  {
    id: 'l',
    name: 'Chicken & Rice Bowl',
    time: '12:30 PM',
    quality: 91,
    kcal: 680,
    protein: 51,
    carbs: 72,
    fat: 16,
    thumb: ['#BBF7D0', '#22C55E'],
    foods: [
      { n: 'Grilled chicken', p: '6 oz' },
      { n: 'Brown rice', p: '1.5 cups' },
      { n: 'Black beans', p: '½ cup' },
      { n: 'Avocado', p: '¼' },
    ],
    sub: [
      { l: 'Protein density', s: 94 },
      { l: 'Whole foods', s: 90 },
      { l: 'Macro balance', s: 92 },
      { l: 'Meal timing', s: 88 },
    ],
    note: 'Excellent lunch with high protein and clean carbs. Ideal 2-3 hours before practice.',
  },
  {
    id: 's',
    name: 'Greek Yogurt & Almonds',
    time: '3:15 PM',
    quality: 89,
    kcal: 300,
    protein: 49,
    carbs: 24,
    fat: 10,
    thumb: ['#DDD6FE', '#8B5CF6'],
    foods: [
      { n: 'Greek yogurt', p: '1 cup' },
      { n: 'Almonds', p: '¼ cup' },
      { n: 'Honey', p: '1 tbsp' },
      { n: 'Blueberries', p: '½ cup' },
    ],
    sub: [
      { l: 'Protein density', s: 92 },
      { l: 'Whole foods', s: 88 },
      { l: 'Macro balance', s: 80 },
      { l: 'Meal timing', s: 90 },
    ],
    note: 'Smart high-protein snack between lunch and dinner. Keeps you in a surplus.',
  },
];

/** How the athlete's note related to the photo (drives the coach pattern signal in Slice 4). */
export type DescriptionSignal = 'match' | 'photo_heavier' | 'photo_lighter' | 'no_photo';

export interface MealResult {
  name: string;
  quality: number;
  protein: number;
  kcal: number;
  carbs: number;
  fat: number;
  detected: string[];
  note: string;
  /** How much of the macro estimate the grounder could corroborate. Absent on legacy/fallback results. */
  confidence?: MacroConfidence;
  /** Non-accusatory "show its work" line, present only when the note contradicts what the photo shows. */
  reconcile?: string;
  /** Relationship of the athlete note to the photo. Feeds the coach pattern signal. */
  descriptionSignal?: DescriptionSignal;
  /** Closest compliant swap vs the plan slot's macro target, present only when a target was given and missed. */
  substitution?: { suggestion: string; items: string[]; deltaProtein: number; deltaKcal: number };
}

export const MEAL_RESULTS: Record<MealLabel, MealResult> = {
  Breakfast: { name: 'Veggie Omelette & Toast', quality: 90, protein: 38, kcal: 480, carbs: 34, fat: 22, detected: ['Eggs', 'Spinach', 'Whole-grain toast', 'Feta'], note: 'Strong protein start. Add fruit for micronutrients and you’re at an A.' },
  Lunch: { name: 'Turkey & Quinoa Bowl', quality: 92, protein: 46, kcal: 620, carbs: 58, fat: 18, detected: ['Ground turkey', 'Quinoa', 'Peppers', 'Avocado'], note: 'Excellent lunch with lean protein and clean carbs, ideal pre-practice.' },
  Dinner: { name: 'Chicken, Rice & Broccoli', quality: 94, protein: 52, kcal: 680, carbs: 64, fat: 18, detected: ['Grilled chicken', 'Brown rice', 'Broccoli', 'Olive oil'], note: 'Excellent protein hit for dinner. Add a piece of fruit and this is a perfect plate.' },
  Snack: { name: 'Greek Yogurt & Berries', quality: 89, protein: 24, kcal: 240, carbs: 22, fat: 6, detected: ['Greek yogurt', 'Blueberries', 'Honey', 'Almonds'], note: 'Great high-protein snack to close the gap before bed.' },
};

export function mealResultFor(mealType: MealLabel): MealResult {
  return MEAL_RESULTS[mealType] ?? MEAL_RESULTS.Dinner;
}

/** Tone token-name for a quality badge — the UI maps it to color tokens (never a hex). */
export type QualityTone = 'success' | 'accent' | 'warning';
export interface QualityLabel {
  label: string;
  tone: QualityTone;
}

/**
 * Map a 0..100 meal-quality score to its badge label + tone so the word the badge
 * shows always tracks the number (89 must read GOOD, not EXCELLENT). Pure: returns a
 * tone token-NAME, never a color value, so it stays RN-import-free in src/core.
 */
export function qualityLabel(quality: number): QualityLabel {
  if (quality >= 90) return { label: 'EXCELLENT', tone: 'success' };
  if (quality >= 80) return { label: 'GOOD', tone: 'accent' };
  if (quality >= 70) return { label: 'FAIR', tone: 'accent' };
  return { label: 'NEEDS WORK', tone: 'warning' };
}

/** One row of the Nutrition "Today's Meals" list — logged data or a log-next prompt. */
export interface MealRow {
  key: MealKey;
  /** Capitalized label used by the capture flow (setMealType) and mealResultFor. */
  label: MealLabel;
  /** Id the detail overlay resolves against (MEALS_LOG ids: b/l/s, dinner fallback). */
  detailId: string;
  logged: boolean;
  name: string;
  protein: number;
  kcal: number;
  quality: number;
  /** Accent swatch / dashed-border color for the row. */
  thumb: string;
  /** Coach-voice "Due by ..." subtitle for the unlogged prompt. */
  dueTime: string;
}

/** Fixed slot order — mirrors computeDerived's iteration of s.meals. */
const SLOT_ORDER: MealKey[] = ['breakfast', 'lunch', 'snack', 'dinner'];

const SLOT_META: Record<MealKey, { label: MealLabel; detailId: string; thumb: string; dueTime: string }> = {
  breakfast: { label: 'Breakfast', detailId: 'b', thumb: '#F59E0B', dueTime: 'Due by 9:00 AM' },
  lunch: { label: 'Lunch', detailId: 'l', thumb: '#22C55E', dueTime: 'Due by 1:00 PM' },
  snack: { label: 'Snack', detailId: 's', thumb: '#8B5CF6', dueTime: 'Due by 4:00 PM' },
  dinner: { label: 'Dinner', detailId: 'dinner', thumb: '#EF4444', dueTime: 'Due by 8:00 PM' },
};

/**
 * Build the per-slot row model for all four meal slots from day state.
 * Name + quality come from mealResultFor(); protein + kcal come from mealSlotMacros
 * (the same source computeDerived sums — a saved edited plate when present, the slot
 * constant otherwise) so the rendered rows agree with the "N of 4 logged" header and
 * the macro totals even after the athlete edits a meal.
 */
export function mealRowsFor(state: AppState): MealRow[] {
  return SLOT_ORDER.map((key) => {
    const meta = SLOT_META[key];
    const result = mealResultFor(meta.label);
    const macros = mealSlotMacros(state, key);
    return {
      key,
      label: meta.label,
      detailId: meta.detailId,
      logged: state.meals[key],
      name: result.name,
      protein: macros.protein,
      kcal: macros.kcal,
      quality: result.quality,
      thumb: meta.thumb,
      dueTime: meta.dueTime,
    };
  });
}

/** Reactive Home insight — celebrates only when the day is genuinely complete. */
export function aiInsight(state: AppState, derived: Derived): string {
  const dayComplete =
    derived.mealsLoggedCount === 4 && derived.proteinToday >= derived.proteinTarget;
  if (dayComplete) {
    return 'Day complete. Every meal logged and protein over target. This is what an A week looks like; keep the streak alive.';
  }
  // Band the copy on the SAME thresholds heroStatus uses (>=80 positive "tracking
  // well", 70-79 neutral "you're close", <70 warn "behind"), so the two cards on
  // Home never contradict each other or the number sitting right above them.
  //
  // A behind athlete (score below the C band, i.e. the spec's "needs intervention"
  // line) must never be told they are "tracking well" or promised a still-reachable A.
  if (derived.athleteScore < 70) {
    const climb = state.meals.dinner
      ? 'log your remaining meals to start climbing back.'
      : 'logging dinner is the fastest way to start climbing back.';
    return `You’re behind today. You’re ${derived.proteinGap}g from your protein target, so ${climb}`;
  }
  // A C-grade day (70-79) is "real but inconsistent" per the spec — doing some of the
  // work, missing protein or days. It must NOT claim "tracking well" (a B/A sentiment)
  // or promise an A; heroStatus calls the same band a neutral "you're close". Match it.
  if (derived.athleteScore < 80) {
    const push = state.meals.dinner
      ? 'log your remaining meals to push into the green.'
      : 'log dinner to push into the green.';
    return `You’re close today. You’re ${derived.proteinGap}g from your protein target, so ${push}`;
  }
  // B/A (>=80), day not yet complete: genuinely on pace, an A is still reachable.
  const close = state.meals.dinner
    ? 'log your remaining meals to close the day at an A.'
    : 'log dinner to close the day at an A.';
  return `Protein and recovery are tracking well. You’re ${derived.proteinGap}g from your protein target, so ${close}`;
}

export type HeroTone = 'positive' | 'neutral' | 'warn';
export interface HeroStatus {
  line: string;
  standingLabel: string;
  tone: HeroTone;
}

/**
 * Reactive score-hero status — the most prominent surface in the app, so it must
 * never confidently tell a behind athlete they are "on pace". Branches off the
 * SAME dayComplete gate as aiInsight (mealsLoggedCount===4 && proteinToday>=target)
 * plus the live score band; the specific ask is built from real derived values
 * (proteinGap / meals remaining) so a line never claims completion that did not
 * happen. standingLabel is grade-derived — no fabricated precise percentile.
 */
export function heroStatus(state: AppState, derived: Derived): HeroStatus {
  const dayComplete =
    derived.mealsLoggedCount === 4 && derived.proteinToday >= derived.proteinTarget;
  const score = derived.athleteScore;
  const g = derived.grade.g;

  const standingLabel =
    g === 'A' ? 'Top of your team' :
    g === 'B' ? 'Upper third of your team' :
    g === 'C' ? 'Middle of your team' :
    'Work to do this week'; // D / F

  const mealsLeft = 4 - derived.mealsLoggedCount;
  const ask =
    derived.proteinGap > 0
      ? `${derived.proteinGap}g of protein to go`
      : mealsLeft > 0
        ? `${mealsLeft} meal${mealsLeft === 1 ? '' : 's'} left to log`
        : 'finish the day strong';

  if (dayComplete) {
    // Genuinely complete day (every meal logged, protein cleared). Completion copy
    // is gated on dayComplete ALONE — never fall through to a score-band branch that
    // builds an `ask` from proteinGap/mealsLeft (both zero here), which would nag an
    // athlete who has nothing left to do. Band only sets tone/copy, never an ask.
    if (score >= 90) {
      return { line: 'Day complete and you cleared an A. Keep the streak rolling.', standingLabel, tone: 'positive' };
    }
    if (score >= 80) {
      return { line: 'Day complete. Every meal in and protein cleared. Recovery is the only thing keeping you off an A.', standingLabel, tone: 'positive' };
    }
    return { line: 'Day complete. Everything logged. Lock in recovery to lift the grade.', standingLabel, tone: 'neutral' };
  }
  if (score >= 80) {
    // On pace (A/B), day not yet complete.
    return { line: `Tracking well: ${ask} to lock in an A today.`, standingLabel, tone: 'positive' };
  }
  if (score < 70) {
    // Behind (D/F) — honest, never "on pace".
    return { line: `You're behind today: ${ask} to climb back up.`, standingLabel, tone: 'warn' };
  }
  // Mid 70..79 (C): neutral nudge.
  return { line: `You're close: ${ask} to push into the green.`, standingLabel, tone: 'neutral' };
}

export interface PaceProjection {
  daysLeft: number;
  surplus: number;
  goalPct: number;
  onPace: boolean;
  paceLabel: string;
  paceAi: string;
  projected: number;
  /** Weight change so far this week (lb). Echoed so the screen's "+N lb so far"
   *  label reads the same number the projection math uses (no second hardcode). */
  progressLb: number;
}

export type PaceDirection = 'gain' | 'lose' | 'maintain';

/** Nutrition weekly-goal pace projection from the weekly lb goal.
 *  `progressLb` defaults to the seeded-demo showcase (0.6) so a one-arg call is
 *  unchanged; a real athlete passes their actual weekly progress so the card
 *  never contradicts Home's "gained since start".
 *  `direction` orients the whole projection: on a cut, weight LOST is progress
 *  and a behind-pace athlete is told to trim intake — never to add calories. */
export function paceProjection(
  weeklyGoalLb: number,
  progressLb: number = 0.6,
  direction: PaceDirection = 'gain',
): PaceProjection {
  const goal = weeklyGoalLb;
  const daysLeft = 3;
  const daysElapsed = 4;
  const surplus = direction === 'maintain' ? 0 : Math.round((goal * 3500) / 7);
  // Clamp the linear extrapolation to a believable weekly band. A brand-new athlete
  // with no weekly weight history yet has `progressLb` fall back to their season-total
  // gain (e.g. +7 lb), which would otherwise project an absurd "+12.3 lb by Sunday"
  // and, downstream, "ease back ~13,000 cal/day". No real weekly weight change exceeds
  // a few pounds, so cap the projection — honest and never nonsensical.
  const projected = +Math.max(-5, Math.min(5, (progressLb / daysElapsed) * 7)).toFixed(1);
  // Calorie adjustment to hit the goal, bounded to a realistic ceiling (no one
  // meaningfully eats 1,000+ cal/day off-plan; a larger raw number is an artifact).
  const calAdjust = (lb: number) => Math.max(0, Math.min(1000, Math.round((lb * 3500) / daysLeft)));
  // Signed progress/projection TOWARD the goal: on a cut, weight lost counts, weight
  // gained reads as zero progress (never credit). Maintain measures drift from zero.
  const towardGoal = direction === 'lose' ? -projected : projected;
  const progressToward = direction === 'lose' ? -progressLb : progressLb;
  const onPace = direction === 'maintain' ? Math.abs(projected) <= 1 : towardGoal >= goal - 0.001;
  // The UI clamps the weekly goal to >= 0.5, but a corrupt/legacy persisted blob (or a
  // future maintain goal) could carry 0/negative/NaN, making progressLb/goal divide as
  // Infinity (any progress) or 0/0 = NaN (a fresh athlete at 0 progress) and rendering
  // "NaN%"/"Infinity%" on the goal ring. With no positive goal there is no span to
  // measure against, so mirror seasonGoalProgress's degenerate handling: at/above the
  // line (progress >= 0) reads 100%, below reads 0% — always a finite 0..100.
  const goalPct =
    direction === 'maintain'
      ? Math.max(0, Math.min(100, Math.round(100 - Math.abs(progressLb) * 50)))
      : goal > 0
        ? Math.max(0, Math.min(100, Math.round((progressToward / goal) * 100)))
        : progressToward >= 0
          ? 100
          : 0;
  const paceLabel = onPace ? '↑ On pace' : '↓ Behind pace';
  // Signed weight-change string: a cut talks in minus pounds, a build in plus pounds.
  const signed = (lb: number) => (lb > 0 ? `+${lb}` : lb < 0 ? `−${Math.abs(lb)}` : '0');
  // Never advise a young athlete to slash more than ~500 cal/day off their intake,
  // no matter how far behind the week is — catch-up math is not a crash-diet license.
  const trimAdjust = (lb: number) => Math.min(500, calAdjust(lb));
  let paceAi: string;
  if (direction === 'maintain') {
    paceAi = onPace
      ? `You're holding steady — right where the plan wants you. Keep intake where it is.`
      : `You're drifting ${signed(projected)} lb this week. Level your intake to hold your weight.`;
  } else if (direction === 'lose') {
    if (towardGoal > goal + 0.001) {
      // Losing faster than planned is a health flag for a young athlete, not a win.
      paceAi = `You're tracking to ${signed(projected)} lb by Sunday — faster than the plan. Add back ~${calAdjust(towardGoal - goal)} cal/day so the cut stays fueled.`;
    } else if (onPace) {
      paceAi = `You're tracking to ${signed(projected)} lb by Sunday, right on target. Keep the deficit steady.`;
    } else {
      paceAi = `At today's intake you'll reach ${signed(projected)} lb. Trim ~${trimAdjust(goal - towardGoal)} cal/day over the next ${daysLeft} days to stay on track.`;
    }
  } else if (projected > goal) {
    paceAi = `You're tracking to +${projected} lb by Sunday, a touch ahead. Ease back ~${calAdjust(projected - goal)} cal/day to land exactly on target.`;
  } else if (onPace) {
    paceAi = `You're tracking to +${projected} lb by Sunday, right on target. Keep the surplus steady.`;
  } else {
    paceAi = `At today's intake you'll reach +${projected} lb. Add ~${calAdjust(goal - projected)} cal/day over the next ${daysLeft} days to stay on track.`;
  }
  return { daysLeft, surplus, goalPct, onPace, paceLabel, paceAi, projected, progressLb };
}

export interface VisibilityRow {
  key: string;
  title: string;
  sub: string;
}

/**
 * "Who can see your data" rows derived from the athlete's chosen support team
 * (onboarding `supportTeam`). Empty when the athlete is solo, so the Profile can
 * show an intentional empty state instead of leaking the demo's Coach Davis /
 * Sarah to a brand-new athlete who connected no one.
 */
export function supportVisibilityRows(supportTeam: string[]): VisibilityRow[] {
  const map: Record<string, VisibilityRow> = {
    coach: { key: 'coach', title: 'Your coach', sub: 'Full profile & history' },
    trainer: { key: 'trainer', title: 'Your trainer', sub: 'Full profile & history' },
    nutritionist: { key: 'nutritionist', title: 'Your nutritionist', sub: 'Meals & nutrition' },
    parent: { key: 'parent', title: 'Parent / guardian', sub: 'Weekly reports & alerts' },
  };
  return supportTeam.map((k) => map[k]).filter(Boolean);
}

export interface CoachGuidance {
  /** Whether to render the human-coach guidance surface at all. */
  show: boolean;
  /** Avatar monogram for the guidance source (e.g. 'CD' demo, 'C' coach, 'N' nutritionist). */
  monogram: string;
  /** The standing coach directive, or null when none has landed yet (pending). */
  note: string | null;
  /** True when an overseer is connected but no directive exists yet (intentional empty state). */
  pending: boolean;
}

/**
 * The athlete's human-coach guidance, gated so the seeded demo's "Coach Davis"
 * note never leaks to a brand-new real athlete who has no coach.
 *   - seeded demo (not real): the showcase note from Coach Davis ("CD") — unchanged.
 *   - real athlete with a coach or nutritionist on their support team: a pending
 *     empty state (their first real directive will appear here) — no fabricated note.
 *   - real solo athlete: no guidance surface at all.
 * `isReal` mirrors the Profile convention (a name set means onboarding completed).
 */
export function coachGuidance(opts: {
  isReal: boolean;
  supportTeam: string[];
  coachNote: string;
}): CoachGuidance {
  if (!opts.isReal) {
    return { show: true, monogram: 'CD', note: opts.coachNote, pending: false };
  }
  const hasCoach = opts.supportTeam.includes('coach');
  const hasNutritionist = opts.supportTeam.includes('nutritionist');
  if (!hasCoach && !hasNutritionist) {
    return { show: false, monogram: '', note: null, pending: false };
  }
  return { show: true, monogram: hasCoach ? 'C' : 'N', note: null, pending: true };
}

/**
 * The Plan-tab footer explaining where completed tasks go. The seeded demo keeps
 * the showcase "Coach Davis"; a real athlete with an overseer connected sees that
 * overseer's noun (coach > trainer > nutritionist); a real solo athlete sees no
 * coach clause at all, so the seed coach never leaks to someone who has no coach.
 * Mirrors coachGuidance's gating convention.
 */
export function taskVisibilityNote(opts: { isReal: boolean; supportTeam: string[] }): string {
  const base = 'Completed tasks feed your Execution Score';
  if (!opts.isReal) return `${base} and stay visible to Coach Davis.`;
  if (opts.supportTeam.includes('coach')) return `${base} and stay visible to your coach.`;
  if (opts.supportTeam.includes('trainer')) return `${base} and stay visible to your trainer.`;
  if (opts.supportTeam.includes('nutritionist')) return `${base} and stay visible to your nutritionist.`;
  return `${base}.`;
}

/**
 * The audience a real athlete's submission is shared with, for the "sent to ..."
 * / "visible to ..." lines on Home and Check-In. The seeded demo keeps the exact
 * showcase string passed in `demo`; a real athlete sees the overseers they
 * actually connected ("your coach & your parent"); a real SOLO athlete gets '' so
 * the caller drops the clause rather than fabricate a Coach Davis who is not on
 * their support team. Mirrors taskVisibilityNote's gating + overseer order.
 */
export function supportAudience(opts: { isReal: boolean; supportTeam: string[]; demo: string }): string {
  if (!opts.isReal) return opts.demo;
  const labels: Record<string, string> = {
    coach: 'your coach',
    trainer: 'your trainer',
    nutritionist: 'your nutritionist',
    parent: 'your parent',
  };
  const present = ['coach', 'trainer', 'nutritionist', 'parent']
    .filter((k) => opts.supportTeam.includes(k))
    .map((k) => labels[k]);
  if (present.length === 0) return '';
  if (present.length === 1) return present[0];
  return present.slice(0, -1).join(', ') + ' & ' + present[present.length - 1];
}

/**
 * The "Tailored by ..." attribution badge on the Check-In header. The seeded demo
 * keeps "Coach Davis"; a real athlete whose coach/nutritionist/trainer tunes the
 * check-in sees that overseer's noun; a real solo athlete's check-in is the
 * standard set tuned by no one, so this returns null and the caller drops the badge
 * rather than crediting a coach who does not exist.
 */
export function checkinAttribution(opts: { isReal: boolean; supportTeam: string[] }): string | null {
  if (!opts.isReal) return 'Tailored by Coach Davis';
  if (opts.supportTeam.includes('coach')) return 'Tailored by your coach';
  if (opts.supportTeam.includes('nutritionist')) return 'Tailored by your nutritionist';
  if (opts.supportTeam.includes('trainer')) return 'Tailored by your trainer';
  return null;
}

/**
 * Position abbreviation → full label, keyed by sport. Abbreviations are NOT
 * global: "C" is a Center in basketball/hockey but a Catcher in baseball, "S" a
 * Setter in volleyball. The onboarding position picker (POSITION_MAP in
 * constants) emits these per-sport codes, so the label lookup must be per-sport
 * too or a baseball catcher reads as "Center". Mirrors POSITION_MAP exactly.
 */
export const POSITION_LABELS: Record<string, Record<string, string>> = {
  Football: {
    QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End',
    OL: 'Offensive Line', DL: 'Defensive Line', LB: 'Linebacker', DB: 'Defensive Back',
  },
  Basketball: { PG: 'Point Guard', SG: 'Shooting Guard', SF: 'Small Forward', PF: 'Power Forward', C: 'Center' },
  Baseball: { P: 'Pitcher', C: 'Catcher', IF: 'Infielder', OF: 'Outfielder' },
  Soccer: { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' },
  'Track & Field': { Sprints: 'Sprints', Distance: 'Distance', Jumps: 'Jumps', Throws: 'Throws' },
  Wrestling: { Lightweight: 'Lightweight', Middleweight: 'Middleweight', Heavyweight: 'Heavyweight' },
  Volleyball: { OH: 'Outside Hitter', MB: 'Middle Blocker', S: 'Setter', L: 'Libero', OPP: 'Opposite' },
  Hockey: { G: 'Goaltender', D: 'Defenseman', C: 'Center', W: 'Wing' },
};

/**
 * Profile / Squad subtitle from the athlete's REAL onboarding selections.
 *
 * `isReal` (a name is set → onboarding finished) is the gate that stops the seeded
 * demo identity from leaking to a real athlete (the audit's "Linebacker · Eastside
 * HS on a user who entered neither" bug). Athletes have no position step, so a real
 * athlete's position is usually null; they must read as themselves, never as the
 * demo linebacker at a demo school:
 *   - real, position + sport → "{label} · {sport}"
 *   - real, position only    → "{label}"          (never a fabricated school)
 *   - real, sport only       → "{sport} athlete"
 *   - real, neither          → "Athlete"          (honest neutral)
 * The seeded demo (isReal false, athleteName '') keeps the exact showcase
 * "Linebacker · Eastside HS" so nothing about the demo changes.
 */
export function athleteSubtitle(position: string | null, sport?: string | null, isReal = false): string {
  const hasSport = !!(sport && sport.trim());
  if (isReal) {
    if (position) {
      const label = (POSITION_LABELS[hasSport ? (sport as string) : 'Football'] ?? {})[position] ?? position;
      return hasSport ? `${label} · ${sport}` : label;
    }
    return hasSport ? `${sport} athlete` : 'Athlete';
  }
  if (!position) return hasSport ? `${sport} athlete` : 'Linebacker · Eastside HS';
  const label = (POSITION_LABELS[hasSport ? (sport as string) : 'Football'] ?? {})[position] ?? position;
  return `${label} · ${hasSport ? sport : 'Eastside HS'}`;
}

export interface NotificationCopy {
  /** The "weekly check-in due" reminder body, with an honest audience clause. */
  checkin: string;
  /** The "score update" body; only the seeded demo claims a linebacker-room rank. */
  score: string;
  /** The EARLIER coach-praise card, or null when it must not be fabricated. */
  coachNote: { initials: string; title: string; text: string } | null;
}

/**
 * Gated copy for the Notifications inbox so a real athlete is never told that a
 * coach, parent, or position room they don't have is waiting on, ranking, or
 * praising them. The seeded demo (isReal false) keeps the exact showcase strings;
 * a real athlete's reminders name only the overseers they actually connected, the
 * score update drops the fabricated "#2 in the linebacker room" rank (matching the
 * honest solo Squad view), and the fabricated Coach Davis praise note is removed.
 * Mirrors the supportAudience / coachGuidance gating convention.
 */
export function notificationCopy(opts: {
  isReal: boolean;
  supportTeam: string[];
  athleteScore: number;
}): NotificationCopy {
  if (!opts.isReal) {
    return {
      checkin: 'Takes 2 minutes. Your coach and parent will see your update.',
      score: `Your Execution Score is ${opts.athleteScore}. You're #2 in the linebacker room.`,
      coachNote: { initials: 'CD', title: 'Coach Davis', text: '"Strong week. Your nutrition is the best in the room. Keep it up."' },
    };
  }
  const has = (k: string) => opts.supportTeam.includes(k);
  let checkin: string;
  if (has('coach') && has('parent')) checkin = 'Takes 2 minutes. Your coach and your parent will see your update.';
  else if (has('coach')) checkin = 'Takes 2 minutes. Your coach will see your update.';
  else if (has('parent')) checkin = 'Takes 2 minutes. Your parent will see your update.';
  else if (has('trainer')) checkin = 'Takes 2 minutes. Your trainer will see your update.';
  else if (has('nutritionist')) checkin = 'Takes 2 minutes. Your nutritionist will see your update.';
  else checkin = 'Takes 2 minutes. Your weekly check-in keeps your score honest.';
  return {
    checkin,
    score: `Your Execution Score is ${opts.athleteScore}. Tap to see your week.`,
    coachNote: null,
  };
}

export type FeedNotifKind = 'checkin' | 'meal' | 'score' | 'hydration' | 'coachNote';
export type FeedNotifAction = 'checkin' | 'meal' | 'squad' | 'none';

export interface FeedNotif {
  key: string;
  kind: FeedNotifKind;
  title: string;
  /** Honest timing label. Real-athlete items say "Now"/"Today"; the seeded demo keeps
   *  its showcase relative stamps ("2m"/"6h"). Never a fabricated past for a real user. */
  time: string;
  text: string;
  action: FeedNotifAction;
  section: 'new' | 'earlier';
  initials?: string;
}

/**
 * The inbox feed for the non-backend (demo/offline) path, built so a brand-new real
 * athlete never sees fabricated history — the audit's "notifications timestamped 6h
 * ago on a 10-minute-old account" bug. The seeded demo (isReal false) keeps the exact
 * showcase (four cards with relative stamps). A real athlete gets only the reminders
 * that are TRUE RIGHT NOW, stamped with honest timing ("Now"/"Today"): a check-in
 * nudge while it's unsubmitted, and a log-your-next-meal nudge while protein is short.
 * When nothing is due the list is empty and the screen shows an "all caught up" state.
 * Pure.
 */
export function notificationFeed(opts: {
  isReal: boolean;
  supportTeam: string[];
  athleteScore: number;
  checkinSubmitted: boolean;
  proteinGap: number;
}): FeedNotif[] {
  const copy = notificationCopy(opts);
  if (!opts.isReal) {
    // Seeded showcase — unchanged from the original hardcoded cards.
    const list: FeedNotif[] = [
      { key: 'checkin', kind: 'checkin', title: 'Weekly check-in due', time: '2m', text: copy.checkin, action: 'checkin', section: 'new' },
      { key: 'meal', kind: 'meal', title: 'Time to log dinner', time: '18m', text: `You're ${opts.proteinGap}g of protein from your target. One more meal does it.`, action: 'meal', section: 'new' },
      { key: 'score', kind: 'score', title: 'Score update', time: '1h', text: copy.score, action: 'squad', section: 'new' },
    ];
    if (copy.coachNote) {
      list.push({ key: 'coachNote', kind: 'coachNote', title: copy.coachNote.title, time: '4h', text: copy.coachNote.text, action: 'none', section: 'earlier', initials: copy.coachNote.initials });
    }
    list.push({ key: 'hydration', kind: 'hydration', title: 'Hydration reminder', time: '6h', text: "You're behind on water. Knock out 500ml before practice.", action: 'none', section: 'earlier' });
    return list;
  }
  // Real athlete — only currently-true reminders, honest timing, no fabricated past.
  const list: FeedNotif[] = [];
  if (!opts.checkinSubmitted) {
    list.push({ key: 'checkin', kind: 'checkin', title: 'Weekly check-in due', time: 'Today', text: copy.checkin, action: 'checkin', section: 'new' });
  }
  if (opts.proteinGap > 0) {
    list.push({ key: 'meal', kind: 'meal', title: 'Log your next meal', time: 'Now', text: `You're ${opts.proteinGap}g of protein from your target. One more meal does it.`, action: 'meal', section: 'new' });
  }
  return list;
}

/** Onboarding training-frequency key → a short Profile cadence phrase. */
const TRAIN_CADENCE: Record<string, string> = {
  once: 'Trains once a day',
  twice: 'Trains twice a day',
  three_plus: 'Trains 3+ times a day',
};

/**
 * The athlete's training cadence for the Profile identity card, derived from the
 * onboarding `trainingFreq` answer (which was collected but never surfaced). Returns
 * null when unset (the seeded demo, so it stays unchanged) or for an unknown key, so
 * the caller drops the line rather than rendering a stray value.
 */
export function trainingCadence(trainingFreq: string | null): string | null {
  if (!trainingFreq) return null;
  return TRAIN_CADENCE[trainingFreq] ?? null;
}

export interface SquadView {
  /**
   * 'demo'  = the seeded showcase leaderboard (Marcus Cole et al.) — unchanged.
   * 'solo'  = a real athlete with no real peer/team source connected; show their
   *           own week plus an honest "no squad yet" panel instead of fabricated
   *           peers, a "Linebackers" room, and a "Visible to Coach Davis" footer.
   */
  kind: 'demo' | 'solo';
  /**
   * Render the league chrome (Team/position segmented control, the "Linebackers"
   * trophy badge, and the "Visible to Coach Davis · resets Sunday" footer). These
   * are all seed identity, so only the demo shows them.
   */
  showLeague: boolean;
  /** Empty-peer panel copy for a real athlete with no connected squad (null in demo). */
  empty: { title: string; body: string } | null;
}

/**
 * Gates the Squad tab so the seeded peer leaderboard, the "Linebackers" labels,
 * and the "Visible to Coach Davis" footer (all seed data, with no real team/peer
 * source offline) never leak to a brand-new real athlete. The seeded demo
 * (athleteName '') keeps the full showcase exactly as before; a real athlete sees
 * their own live week plus an honest "no squad connected yet" empty state.
 * Mirrors coachGuidance's gating convention (`isReal` = a name set).
 */
export function squadView(opts: { isReal: boolean }): SquadView {
  if (!opts.isReal) {
    return { kind: 'demo', showLeague: true, empty: null };
  }
  return {
    kind: 'solo',
    showLeague: false,
    empty: {
      title: 'No squad connected yet',
      body: 'When your team or training group joins OnStandard, your weekly leaderboard shows up here. Your own score keeps tracking in the meantime.',
    },
  };
}

/** The just-submitted weekly check-in answers, for an honest derived summary. */
export interface CheckinAnswers {
  name?: string;
  energy?: number;
  recovery?: number;
  sleep?: number;
  confidence?: number;
  soreness?: number;
  motivation?: number;
  /** Which questions the coach enabled (mirrors AppState.ciConfig). */
  config: CiConfig;
}

/**
 * Honest weekly check-in summary derived from the athlete's ACTUAL slider answers
 * (replaces a static "Energy and confidence are up..." blurb that ignored what was
 * entered). Names only the enabled questions, classifies each strong (>=8) / watch
 * (<5), with soreness read inversely (high soreness = something to watch). Resilient
 * to missing/non-finite answers; factual, no guilt, no em dash.
 */
export function checkinSummary(a: CheckinAnswers): string {
  const first = (a.name ?? '').trim().split(/\s+/)[0] || 'there';
  const fin = (v: number | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const strong: string[] = [];
  const watch: string[] = [];
  const consider = (on: boolean | undefined, label: string, v: number | null) => {
    if (on !== true || v === null) return;
    if (v >= 8) strong.push(label);
    else if (v < 5) watch.push(label);
  };
  consider(a.config.energy, 'energy', fin(a.energy));
  consider(a.config.recovery, 'recovery', fin(a.recovery));
  consider(a.config.sleep, 'sleep', fin(a.sleep));
  consider(a.config.confidence, 'confidence', fin(a.confidence));
  consider(a.config.motivation, 'motivation', fin(a.motivation));
  // Soreness is inverse: a HIGH score is worse, so it only ever goes on the watch list.
  const sore = fin(a.soreness);
  if (a.config.soreness === true && sore !== null && sore >= 6) watch.push('soreness');

  const join = (xs: string[]): string =>
    xs.length <= 1 ? (xs[0] ?? '') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
  const cap = (str: string): string => (str ? str[0].toUpperCase() + str.slice(1) : str);

  const sentences: string[] = [];
  if (strong.length) sentences.push(`${cap(join(strong))} ${strong.length === 1 ? 'is' : 'are'} strong this week.`);
  if (watch.length) sentences.push(`Keep an eye on ${join(watch)}.`);
  if (sentences.length === 0) sentences.push('Your numbers are steady across the board.');
  return `Check-in saved, ${first}. ${sentences.join(' ')}`;
}
