/* Score v2 cutover — display-only. A separate, import-free module (same reasoning as
   requirements.js's own import-free rule) so it can be unit-tested without pulling in
   state.js's whole live-app graph (DOM globals, RT/DAY singletons, ...). */

/* Must equal SCORING_V2_CUTOVER in src/core/scoreIntegrity.ts and migration 0193.
   The engine never reads this — it exists purely so a screen showing a score trend across
   the cutover can explain its own step instead of leaving an unexplained jump in the line. */
export const SCORING_V2_CUTOVER = '2026-08-16';

/** Index of the first date at/after the cutover, ONLY when an earlier date is also present in
 *  the array — a boundary with nothing shown on one side of it isn't worth drawing. -1 means
 *  "no divider": either every date is before the cutover (today, in reality) or every date is
 *  already on/after it (the transition happened before this window). */
export function cutoverIndex(dates, cutover = SCORING_V2_CUTOVER) {
  const i = (dates || []).findIndex((d) => d >= cutover);
  return i > 0 ? i : -1;
}
