// WHERE IN THE DAY this plate sits, as one prompt line.
//
// The founder's report (2026-09-07): logging breakfast, the AI Nutritionist opened with "Zero on
// the board for protein until now". Obviously zero. It is the first meal of the day. The read
// spent its most valuable sentence narrating an empty board back at an athlete who had just
// walked up to it.
//
// The cause was in the prompt, not the model's taste. The day line handed it "the athlete had
// logged approximately 0g of a 180g daily protein target", and a 0 in the context is an invitation
// to say 0 in the prose — no amount of "do NOT write day totals" outranks a number sitting right
// there. So on the first meal of the day the number is not sent at all: the model is told it is
// the first plate, that an empty board is exactly right at this hour, and that there is no
// "behind" to remark on yet. It still gets the target, because the target is what CHOOSES the move.
//
// Same rules as every other block in analyze-meal's userContent(): client-computed, treated as
// data, clamped to plausible ranges. Out-of-range or absent input renders '' and the prompt is
// byte-identical to a request that never carried a day, which is what makes it safe to send from
// a client an older deploy will ignore.

export type DayContextIn = {
  /** Protein grams already logged today, BEFORE this plate (scored slots only). */
  proteinSoFar?: unknown;
  /** The athlete's real daily protein target. */
  proteinTarget?: unknown;
  /** Required meal slots still to come after this one. */
  mealsRemaining?: unknown;
  /**
   * How many meals are already on the board today, BEFORE this plate. 0 means this is the first.
   *
   * It exists because `proteinSoFar === 0` is not the same statement: an athlete who logged a
   * black coffee is on their second meal with zero protein banked, and telling them "this is your
   * first meal of the day" would be a small lie in the one message they read every time. When the
   * field is absent (an older client), a zero total is the honest fallback for "nothing yet".
   */
  mealsLoggedSoFar?: unknown;
};

const ORDINALS = ['first', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];

const int = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

/** The standing ban: the day CHOOSES the move, it is never written out. The app appends its own
 *  grounded day sentence right after the read, and a second set of totals from the model
 *  disagreed with it often enough that the numeric rail threw the whole paragraph away. */
const NEVER_WRITE =
  'do NOT write day totals, targets or arithmetic into the analysis, the app states the day ' +
  'itself right after your text.';

/** Render the day line, or '' when there is nothing honest to say. */
export function dayContextLine(d: DayContextIn | null | undefined): string {
  if (!d || typeof d !== 'object') return '';
  const soFar = int(d.proteinSoFar);
  const target = int(d.proteinTarget);
  if (soFar === null || target === null) return '';
  if (soFar < 0 || soFar > 500 || target <= 0 || target > 500) return '';

  const remRaw = int(d.mealsRemaining);
  const remaining = remRaw !== null && remRaw >= 0 && remRaw <= 8 ? remRaw : null;

  const loggedRaw = int(d.mealsLoggedSoFar);
  const logged = loggedRaw !== null && loggedRaw >= 0 && loggedRaw <= 8 ? loggedRaw : null;
  const first = logged !== null ? logged === 0 : soFar === 0;

  if (first) {
    // No zero, no "so far", no total. The day ahead, and the target that steers the move.
    const ahead = remaining === null
      ? ''
      : remaining === 0
        ? ' and it is the only required meal on their day'
        : ` and there are ${remaining} more required meal${remaining === 1 ? '' : 's'} to come after it`;
    return ` Day context: this is the FIRST meal the athlete has logged today${ahead}. Their daily protein target is ${target}g. An empty day at this point is exactly what it should look like, not a shortfall, so never open on it and never tell them what they have not eaten yet: there is no "behind" on the first plate. Use the target only to choose the right move for this athlete; ${NEVER_WRITE}`;
  }

  const rem = remaining === null
    ? ''
    : remaining === 0
      ? ', and after this meal their required meals are in'
      : `, with ${remaining} more required meal${remaining === 1 ? '' : 's'} to come after this one`;
  // The position is stated in words so the model can pitch the read to the hour without doing
  // (or writing) the arithmetic itself.
  const place = logged !== null ? `, their ${ORDINALS[Math.min(logged + 1, ORDINALS.length - 1)]} meal of the day` : '';
  return ` Day context: before this meal the athlete had logged approximately ${soFar}g of a ${target}g daily protein target${place}${rem}. Use this only to choose the right move for this athlete (a day far behind on protein makes the move a protein move, a day already at target frees you to talk about carbs, produce or timing); ${NEVER_WRITE}`;
}
