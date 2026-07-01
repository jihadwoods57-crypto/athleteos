// OnStandard — overseer notification preferences (pure TS, no RN imports).
// The audit flagged that coaches/trainers/parents get a single on/off, no per-event
// control. These are the events an overseer can be alerted about for their athletes;
// the master `notif` flag still gates whether ANY fire (mirrors the athlete reminder
// model). Delivery rides the backend alert pipeline at go-live; this is the
// preference set the OverseerProfile edits and that pipeline will read.

export type OverseerAlertKey = 'below_line' | 'missed_logging' | 'checkin_ready' | 'weekly_digest';

export interface OverseerAlertDef {
  key: OverseerAlertKey;
  label: string;
  desc: string;
  /** Default enabled state — the high-signal events default on, the digest off. */
  on: boolean;
}

export const OVERSEER_ALERT_DEFS: OverseerAlertDef[] = [
  { key: 'below_line', label: 'Athlete falls below the line', desc: 'When a score drops into the needs-intervention band.', on: true },
  { key: 'missed_logging', label: 'Missed logging', desc: "When an athlete hasn't logged anything today.", on: true },
  { key: 'checkin_ready', label: 'Check-in submitted', desc: 'When an athlete submits their weekly check-in.', on: true },
  { key: 'weekly_digest', label: 'Weekly digest', desc: 'A Sunday summary of the whole roster.', on: false },
];

export type OverseerAlerts = Record<OverseerAlertKey, boolean>;

/** The default preference map (high-signal events on, digest off). */
export function defaultOverseerAlerts(): OverseerAlerts {
  return OVERSEER_ALERT_DEFS.reduce((acc, d) => {
    acc[d.key] = d.on;
    return acc;
  }, {} as OverseerAlerts);
}

/** Merge a persisted (possibly partial / older) map onto the current defaults, so a
 *  new alert key added later defaults sanely instead of reading undefined. */
export function normalizeOverseerAlerts(saved?: Partial<OverseerAlerts> | null): OverseerAlerts {
  const base = defaultOverseerAlerts();
  if (!saved) return base;
  for (const d of OVERSEER_ALERT_DEFS) {
    if (typeof saved[d.key] === 'boolean') base[d.key] = saved[d.key] as boolean;
  }
  return base;
}

/** How many alerts are enabled — for the "3 of 4 on" summary line. */
export function enabledAlertCount(a: OverseerAlerts): number {
  return OVERSEER_ALERT_DEFS.filter((d) => a[d.key]).length;
}
