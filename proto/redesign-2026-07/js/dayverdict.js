/* OnStandard — day verdict timing (pure; no imports, no DOM, no Date). One job: decide whether a
   day is OVER for on-time purposes, so the UI never delivers a negative verdict ("Off Standard",
   a red "Missed") on a day the athlete can still win. A day is DECIDED when no required window is
   still open on time — every required item is done, past its close, or excused. Optional items and
   pre-activation ('not_required') windows never hold the day open. Empty day ⇒ vacuously decided. */

const STILL_OPEN = new Set(['locked', 'ready', 'due_soon']);

/** @param {{required?: boolean, state?: string}[]} items derived exec items
 *  @returns {boolean} true once no required window is still open on time */
export function dayDecided(items) {
  const list = Array.isArray(items) ? items : [];
  // Only time-windowed required items gate the verdict. A coach-assigned task has no closing
  // window (its state stays 'ready' until done), so it must never hold the day "in progress"
  // forever — that would keep the negative verdict from ever showing for a user who has a
  // standing assignment. Gating on a real window is the honest "the day's requirements came due".
  return !list.some((i) => i && i.required && i.window && STILL_OPEN.has(i.state));
}
