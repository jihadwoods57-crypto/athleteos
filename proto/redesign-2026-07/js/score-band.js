/* The standard's thresholds, in ONE place.
 *
 * 80 = on standard, 60 = the floor below which a day is off standard. Those two numbers were
 * written out as an inline ternary in three separate files (coach-roster, coach-home, roles),
 * which meant "what counts as on standard" could drift between the roster and the score beside
 * it. They are the same rule; they live here now.
 *
 * DEPENDENCY-FREE ON PURPOSE. state.js imports roles.js and components.js imports state.js, so
 * putting this in components.js would close a roles -> components -> state -> roles cycle. A
 * leaf module can be imported from anywhere, including roles.js.
 *
 * This file describes how a score is LABELLED. It does not decide what a score IS — nothing here
 * feeds scoring. */

export const ON_STANDARD = 80;
export const CLOSE = 60;

/** 'on' | 'close' | 'off', or null when there is no score to band. */
export function scoreBand(score) {
  if (score == null) return null;
  return score >= ON_STANDARD ? 'on' : score >= CLOSE ? 'close' : 'off';
}

export const BAND_COLOR = {
  on: 'var(--green-bright)',
  close: 'var(--amber-bright)',
  off: 'var(--red-bright)',
};

/** Token string for a score's colour; --text-3 when there is nothing to show. */
export function scoreColor(score) {
  const b = scoreBand(score);
  return b ? BAND_COLOR[b] : 'var(--text-3)';
}

/* The legacy one-letter flags ('g'/'y'/'r') that roles.js -> tierFlag() has always returned.
   Kept as a mapping rather than a second set of thresholds so the contract can't drift. */
export const BAND_FLAG = { on: 'g', close: 'y', off: 'r' };

/* ---------------- Tier ladder ----------------
 * The names the athlete reads, on the SAME thresholds as scoreBand above.
 *
 * This ladder was written out four separate times (state.js tier(), day.js tierFor(),
 * share-card.js, and the states gallery's hardcoded chips) and every copy put the "Locked In"
 * floor at 75 — while ON_STANDARD, the streak gate, and the "days on standard (>=80)" copy all
 * used 80. That five-point gap was visible in the product: at 79 Home showed a blue "Locked In"
 * chip while Progress warned the streak was about to break. The score was honest; the LABEL was
 * not, which is the one thing PRODUCT.md says can never happen.
 *
 * Locked In now begins at ON_STANDARD, so the badge and the streak mean the same thing. Building
 * absorbs 60-79, which makes it exactly the 'close' band — three thresholds (60/80/90) for the
 * whole system, defined once, impossible to drift. Tier names are unchanged (founder's brief). */
export const TIERS = [
  { min: 90,           name: 'OnStandard',   cls: 'g' },
  { min: ON_STANDARD,  name: 'Locked In',    cls: 'b' },
  { min: CLOSE,        name: 'Building',     cls: 'a' },
  { min: 0,            name: 'Off Standard', cls: 'r' },
];

/** The tier for a score: `{ name, cls }`. The ONE definition; never re-inline these numbers. */
export function tierFor(score) {
  const s = Number(score) || 0;
  return TIERS.find((t) => s >= t.min) || TIERS[TIERS.length - 1];
}

/* ---------------- Meal quality ----------------
 * Meal QUALITY is its own concept (the plate read) with its OWN two floors, distinct from the
 * day-score ladder above: 80+ green, 50+ amber, below red. A plate is never success-green at 58.
 * Four screens (home, state's activity feed, trust's history, coach's athlete day) had each
 * re-inlined this ternary; the floors live here now. */
export const MEAL_QUALITY_GOOD = 80;
export const MEAL_QUALITY_OK = 50;

/** The one-letter accent class ('g' | 'a' | 'r') a meal-quality score wears. Named
 *  qualityACCENT, not qualityBand: meal-intel.js already exports a qualityBand() with its own
 *  75/50 label ladder ({cls, label}), and state.js/coach.js import both. */
export function qualityAccent(quality) {
  return quality >= MEAL_QUALITY_GOOD ? 'g' : quality >= MEAL_QUALITY_OK ? 'a' : 'r';
}

/* ---------------- Letter grade ----------------
 * The A-F letter a history day wears (day.js scoreHistory rows). Same 90/80/60 floors as the
 * tier ladder, plus ONE extra step the tier ladder does not have: 70 splits Building into C and
 * D so the letters read like school grades. Moved here from day.js so the shared floors can
 * never drift from TIERS; the 70 stays a deliberate letter-only literal. */
export function gradeFor(s) { return s >= 90 ? 'A' : s >= ON_STANDARD ? 'B' : s >= 70 ? 'C' : s >= CLOSE ? 'D' : 'F'; }

/* ---------------- Accent letters ----------------
 * The one-letter accent a requirement / score part carries ('g','a','b','p','c') mapped to its
 * token family. Four screens had each written their own inline ternary for this (breakdown,
 * plan, coach, progress), every one with a different fallback, so adding a fifth accent silently
 * rendered as amber in one place and blue in another. One map; add a hue here and it lands
 * everywhere. */
export const ACCENT_FAMILY = { g: 'green', a: 'amber', b: 'blue', p: 'purple', c: 'cyan' };

/** `var(--green-bright)` for accent 'g'. `variant` is the token suffix ('bright', 'deep', ''). */
export function accentVar(accent, variant = 'bright') {
  const fam = ACCENT_FAMILY[accent] || ACCENT_FAMILY.b;
  return `var(--${fam}${variant ? `-${variant}` : ''})`;
}

/* The token behind each tier's one-letter class, so a screen tinting a score by tier never has
   to re-inline the thresholds to pick a colour. */
export const TIER_COLOR = {
  g: 'var(--green-bright)',
  b: 'var(--blue-bright)',
  a: 'var(--amber-bright)',
  r: 'var(--red-bright)',
};

/** Token string for a score's TIER colour (distinct from scoreColor's three-way band colour). */
export function tierColor(score) { return TIER_COLOR[tierFor(score).cls]; }

/** "60–79" style range label for a tier, for legends and the design-states gallery. */
export function tierRange(i) {
  const hi = i === 0 ? 100 : TIERS[i - 1].min - 1;
  return `${TIERS[i].min}–${hi}`;
}
