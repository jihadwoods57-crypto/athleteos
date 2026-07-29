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
