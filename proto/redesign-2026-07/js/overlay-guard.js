/* One overlay at a time (DESIGN.md), decided in ONE place.
 *
 * The rule used to be enforced by hand-copied selector lists in five files, and they drifted:
 * image-viewer and members-sheet never learned about the tapback picker, lock-moment never
 * learned about it either. Each new overlay meant updating N other files and hoping. This module
 * owns the canonical marker list; a caller asks "is anything ELSE up" by excluding its own marker.
 *
 * Pure DOM read, no state: every overlay in this app announces itself with a class on a
 * body-level element, so presence in the document IS the truth.
 */

/** Every class an overlay mounts under. Adding an overlay to the app means adding it here. */
export const OVERLAY_MARKERS = ['.tour', '.lockstamp', '.memsheet', '.imgview', '.tapback', '.sheet-scrim'];

/**
 * True when any overlay marker is present in the DOM.
 * @param {string?} exceptSelector the caller's OWN marker, excluded so an overlay can consult
 *                                 the guard without vetoing itself (e.g. '.imgview').
 */
export function overlayOpen(exceptSelector) {
  if (typeof document === 'undefined') return false;
  const sel = OVERLAY_MARKERS.filter((m) => m !== exceptSelector).join(', ');
  try { return !!document.querySelector(sel); } catch { return false; }
}
