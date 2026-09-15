/* Score cutovers — display-only. A separate, import-free module (same reasoning as
   requirements.js's own import-free rule) so it can be unit-tested without pulling in
   state.js's whole live-app graph (DOM globals, RT/DAY singletons, ...). */

/* Must equal SCORING_V2_CUTOVER / SCORING_V3_CUTOVER in src/core/scoreIntegrity.ts and
   migrations 0193 / 0228. The engine never reads these — they exist purely so a screen
   showing a score trend across a cutover can explain its own step instead of leaving an
   unexplained jump in the line. v3 was missing here for its whole first week (found by the
   09-15 audit): the 7-day chart crossed 2026-09-09 with no divider, which is exactly the
   silent step this module exists to prevent. Every future cutover gets a row in this list. */
export const SCORING_V2_CUTOVER = '2026-08-16';
export const SCORING_V3_CUTOVER = '2026-09-09';
export const SCORING_CUTOVERS = [SCORING_V2_CUTOVER, SCORING_V3_CUTOVER];

/** Index of the first date at/after a cutover, ONLY when an earlier date is also present in
 *  the array — a boundary with nothing shown on one side of it isn't worth drawing. -1 means
 *  "no divider": every date sits inside one era, so there is no step in view to explain.
 *  Checks the NEWEST cutover first: in a 7-day window only one boundary can be in view, and
 *  in any wider window the newest crossed boundary is the step the viewer is looking at. */
export function cutoverIndex(dates, cutover = SCORING_CUTOVERS) {
  const cuts = Array.isArray(cutover) ? cutover : [cutover];
  for (let j = cuts.length - 1; j >= 0; j--) {
    const i = (dates || []).findIndex((d) => d >= cuts[j]);
    if (i > 0) return i;
  }
  return -1;
}
