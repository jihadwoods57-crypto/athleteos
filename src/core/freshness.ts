// OnStandard — data-freshness labels for overseer views (pure TS, no RN imports).
//
// When the backend is live, a trainer/coach/parent looking at a client needs an HONEST
// "how current is this?" signal — never a fabricated timestamp. This is the pure half: turn
// a last-sync ISO time into a plain label + a fresh/stale/none state. The UI (gated behind
// isBackendLive) renders these; with the backend off it shows a "Demo data" state instead.
// Copy follows the shipped guardrails: factual, no guilt, no em dash.

export type Freshness = 'fresh' | 'stale' | 'none';

/** Hours after which a client's data reads as stale (a quiet amber note, not an alarm). */
export const STALE_AFTER_HOURS = 36;

const MS_PER_MIN = 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Fresh / stale / none from a last-sync time. `none` for a missing or unparseable value
 * (never synced); `stale` once older than `staleHours`; `fresh` otherwise. Pure.
 */
export function syncFreshness(iso: string | null | undefined, now: Date, staleHours: number = STALE_AFTER_HOURS): Freshness {
  const t = parse(iso);
  if (t == null) return 'none';
  const hours = (now.getTime() - t) / (60 * MS_PER_MIN);
  return hours <= staleHours ? 'fresh' : 'stale';
}

/**
 * A plain-language "last synced" label: "Synced just now" / "Synced 12m ago" /
 * "Synced 3h ago" / "Synced yesterday" / "Synced 4 days ago" / "Last synced Jun 24" /
 * "Not synced yet". Never invents a time; an absent/invalid value reads honestly. Pure.
 */
export function lastSyncedLabel(iso: string | null | undefined, now: Date): string {
  const t = parse(iso);
  if (t == null) return 'Not synced yet';
  const ms = now.getTime() - t;
  if (ms < MS_PER_MIN) return 'Synced just now'; // includes small clock skew (future stamps)
  const mins = Math.floor(ms / MS_PER_MIN);
  if (mins < 60) return `Synced ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Synced yesterday';
  if (days < 7) return `Synced ${days} days ago`;
  const d = new Date(t);
  return `Last synced ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
