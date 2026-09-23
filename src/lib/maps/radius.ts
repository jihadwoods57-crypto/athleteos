/* The check-in bubble's size. Pure, so the slider, the drag handle and the bridge all agree on one
   rule: 100 m (a building) to 1 km (a campus), in 25 m steps. The server (save_commitment_place)
   enforces the same 100..1000 range; this keeps the picker from ever offering a value it refuses. */
export const RADIUS_MIN = 100, RADIUS_MAX = 1000, RADIUS_STEP = 25;
/** A new bubble starts here: a building and its lot. */
export const DEFAULT_RADIUS = 150;

export function clampRadius(m: number): number {
  const v = Math.round((Number.isFinite(m) ? m : RADIUS_MIN) / RADIUS_STEP) * RADIUS_STEP;
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, v));
}

export function metersLabel(m: number): string {
  return m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Slider position (0 = left end, 1 = right end) to a snapped radius. A finger past either end
 *  holds at that end. */
export function radiusFromFraction(f: number): number {
  const t = Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
  return clampRadius(RADIUS_MIN + t * (RADIUS_MAX - RADIUS_MIN));
}

export function fractionFromRadius(m: number): number {
  return (clampRadius(m) - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);
}

/** Whether a drag crossed into a new 25 m step, which is the only moment the haptic ticks. */
export function snappedChanged(prev: number | null, next: number): boolean {
  return prev !== next;
}
