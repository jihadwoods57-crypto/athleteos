// AthleteOS — reminder schedule model + copy (pure TS, no RN imports).
//
// P3 (reminders / notifications) is "the engine's fuel": timely, athlete-first
// prompts that keep the day on track without nagging. This module is the PURE half:
//   - which reminders exist, their default time + on/off (REMINDER_DEFS),
//   - the per-reminder user setting (enabled + hour),
//   - the CONDITION each conditional reminder fires on ("protein still behind",
//     "dinner not logged", "check-in due"), evaluated from a small day snapshot,
//   - the athlete-first copy each reminder shows.
// The actual LOCAL scheduling (expo-notifications) is a device seam (src/lib/notify),
// gated by isNotifyAvailable; nothing here fires a notification. Copy follows the
// shipped guardrails: factual, no guilt, no em dash.

export type ReminderKind = 'protein' | 'hydration' | 'log_dinner' | 'checkin';

export interface ReminderDef {
  kind: ReminderKind;
  /** Settings-row title. */
  label: string;
  /** Settings-row subtitle (what it does). */
  description: string;
  /** Default local hour (0-23) to fire. */
  defaultHour: number;
  /** Default on/off for a fresh athlete. */
  defaultOn: boolean;
  /** True if this reminder only fires when its day condition still holds (vs. a
   *  fixed daily prompt). Drives whether `conditionMet` gates it. */
  conditional: boolean;
}

// Ordered as they appear in the settings UI.
export const REMINDER_DEFS: readonly ReminderDef[] = [
  {
    kind: 'protein',
    label: 'Protein check',
    description: 'An afternoon nudge if your protein is still behind for the day.',
    defaultHour: 16,
    defaultOn: true,
    conditional: true,
  },
  {
    kind: 'hydration',
    label: 'Hydration',
    description: 'A midday reminder if your water is behind for the day.',
    defaultHour: 14,
    defaultOn: true,
    conditional: true,
  },
  {
    kind: 'log_dinner',
    label: 'Log dinner',
    description: 'An evening prompt to log dinner so your day is complete.',
    defaultHour: 20,
    defaultOn: true,
    conditional: true,
  },
  {
    kind: 'checkin',
    label: 'Weekly check-in',
    description: 'A reminder when your check-in is ready to submit.',
    defaultHour: 18,
    defaultOn: true,
    conditional: true,
  },
] as const;

/** Fraction of a daily target below which protein / hydration counts as "behind". */
export const BEHIND_RATIO = 0.6;

export interface ReminderSetting {
  enabled: boolean;
  /** Local hour 0-23. */
  hour: number;
}

export type ReminderSettings = Record<ReminderKind, ReminderSetting>;

/** A fresh athlete's reminder settings, derived from REMINDER_DEFS. */
export function defaultReminderSettings(): ReminderSettings {
  const out = {} as ReminderSettings;
  for (const d of REMINDER_DEFS) out[d.kind] = { enabled: d.defaultOn, hour: d.defaultHour };
  return out;
}

/** The day signals the conditional reminders read. Pure — caller derives it from state. */
export interface ReminderSnapshot {
  proteinToday: number;
  proteinTarget: number;
  hydrationL: number;
  hydrationTargetL: number;
  dinnerLogged: boolean;
  /** Check-in is enabled today AND not yet submitted. */
  checkinDue: boolean;
}

/**
 * Whether a conditional reminder's day condition still holds (so it's worth firing).
 * A non-conditional reminder always "holds". Defensive against non-finite targets.
 */
export function conditionMet(kind: ReminderKind, s: ReminderSnapshot): boolean {
  switch (kind) {
    case 'protein':
      return s.proteinTarget > 0 && s.proteinToday / s.proteinTarget < BEHIND_RATIO;
    case 'hydration':
      return s.hydrationTargetL > 0 && s.hydrationL / s.hydrationTargetL < BEHIND_RATIO;
    case 'log_dinner':
      return !s.dinnerLogged;
    case 'checkin':
      return s.checkinDue;
  }
}

/** Clamp an hour to a valid 0-23 local hour (settings UI guard). */
export function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 0;
  return Math.max(0, Math.min(23, Math.round(h)));
}

/**
 * The reminders that should be ACTIVE today given the user's settings + the day
 * snapshot: enabled, and (for conditional reminders) their condition still holds.
 * This is what the scheduling glue would (re)schedule; order follows REMINDER_DEFS.
 */
export function activeReminders(settings: ReminderSettings, snapshot: ReminderSnapshot): ReminderDef[] {
  return REMINDER_DEFS.filter((d) => {
    const set = settings[d.kind];
    if (!set || !set.enabled) return false;
    return d.conditional ? conditionMet(d.kind, snapshot) : true;
  });
}

/** Athlete-first copy for a reminder. Factual, no guilt, no em dash. */
export function reminderCopy(kind: ReminderKind, s: ReminderSnapshot): { title: string; body: string } {
  switch (kind) {
    case 'protein': {
      const gap = Math.max(0, Math.round(s.proteinTarget - s.proteinToday));
      return {
        title: 'Protein check',
        body: gap > 0
          ? `You're ${gap}g from your ${Math.round(s.proteinTarget)}g protein goal. A quick high-protein snack closes the gap.`
          : `You're closing in on your ${Math.round(s.proteinTarget)}g protein goal. One more high-protein bite finishes it.`,
      };
    }
    case 'hydration':
      return {
        title: 'Hydration',
        body: "You're behind on water today. A glass now keeps you on pace.",
      };
    case 'log_dinner':
      return {
        title: 'Log dinner',
        body: 'Add tonight\'s dinner to keep your day complete.',
      };
    case 'checkin':
      return {
        title: 'Weekly check-in',
        body: 'Your check-in is ready. Your coach will see your update.',
      };
  }
}
