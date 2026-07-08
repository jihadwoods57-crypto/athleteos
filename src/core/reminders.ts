// OnStandard — reminder schedule model + copy (pure TS, no RN imports).
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
import { HYDRATION_TARGET } from './constants';
import { withinTrailingWeek } from './clock';

export type ReminderKind = 'protein' | 'hydration' | 'log_dinner' | 'checkin' | 'weigh_in';

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
  {
    kind: 'weigh_in',
    label: 'Weigh-in',
    description: 'A morning nudge to log your weight if you have not today.',
    defaultHour: 9,
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
  /** No weight logged yet today (drives the weigh-in nudge). Optional so existing snapshot
   *  literals stay valid; treated as "not due" when absent. */
  weighInDue?: boolean;
  /** The athlete's linked coach/trainer first name, when one exists. Presence is the pull:
   *  "Coach Mark sees tonight's log" beats a generic chore. Optional; absent = no coach line. */
  coachName?: string | null;
  /** Points between the live score and on-standard (threshold - score), when today is close
   *  (0 < gap <= 25). The near-goal pull: "you're 6 points from locking today". Optional. */
  pointsToStandard?: number | null;
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
    case 'weigh_in':
      return !!s.weighInDue;
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

/** The near-goal pull, when today is genuinely close: a real gap, small enough to close
 *  tonight. Returns '' otherwise so callers can append unconditionally. */
function scorePull(s: ReminderSnapshot): string {
  const gap = s.pointsToStandard;
  if (typeof gap !== 'number' || !Number.isFinite(gap) || gap <= 0 || gap > 25) return '';
  return ` You're ${Math.round(gap)} ${Math.round(gap) === 1 ? 'point' : 'points'} from on standard today.`;
}

/** The coach-presence line, when a real coach is linked. '' otherwise. */
function coachPull(s: ReminderSnapshot, verb: string): string {
  const name = (s.coachName ?? '').trim();
  return name ? ` ${name} ${verb}.` : '';
}

/** Athlete-first copy for a reminder. Factual, no guilt, no em dash. A reminder is a
 *  specific reason to open the app today (a real gap, a real coach watching), never a
 *  generic chore ("log your meal"). */
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
        body: `Add tonight's dinner to keep your day complete.${scorePull(s)}${coachPull(s, 'sees tonight\'s log')}`,
      };
    case 'checkin':
      return {
        title: 'Weekly check-in',
        body: `Your check-in is ready.${(s.coachName ?? '').trim() ? ` ${(s.coachName ?? '').trim()} will see your update.` : ' Your coach will see your update.'}`,
      };
    case 'weigh_in':
      return {
        title: 'Weigh-in',
        body: 'Log your weight to keep your goal on track. Takes ten seconds.',
      };
  }
}

/**
 * Forward-looking copy for a DAILY reminder scheduled while today's condition is
 * already satisfied: the trigger repeats on fresh days (where the condition holds
 * again by definition), so it must carry no stale "you're behind" numbers. Factual,
 * no guilt, no em dash.
 */
export function genericReminderCopy(kind: ReminderKind): { title: string; body: string } {
  switch (kind) {
    case 'protein':
      return { title: 'Protein check', body: 'A high-protein option now keeps you ahead of your target.' };
    case 'hydration':
      return { title: 'Hydration', body: 'A glass of water now keeps you on pace for the day.' };
    case 'log_dinner':
      return { title: 'Log dinner', body: "Add tonight's dinner to keep your day complete." };
    case 'checkin':
      return { title: 'Weekly check-in', body: 'Your check-in is ready. Your coach will see your update.' };
    case 'weigh_in':
      return { title: 'Weigh-in', body: 'A quick weigh-in keeps your trend honest. Takes ten seconds.' };
  }
}

/** Format a 0-23 local hour as a 12-hour label for the settings UI ("4 PM", "12 PM"). */
export function formatReminderHour(hour: number): string {
  const h = clampHour(hour);
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

/** A fully-resolved local-notification spec: which reminder, when, and the copy to show. */
export interface ReminderNotifySpec {
  kind: ReminderKind;
  title: string;
  body: string;
  /** Local hour 0-23 to fire. */
  hour: number;
}

/**
 * The local notifications to (re)schedule: one per ENABLED reminder, carrying its
 * user-set hour and copy. Condition still holding today -> today's specific copy
 * (real numbers); condition already satisfied -> generic forward-looking copy,
 * because the trigger is DAILY-repeating and tomorrow's fresh day makes the
 * condition true again. The old contract dropped satisfied reminders entirely,
 * which left a user who finished day 0 on-track in total silence on day 1.
 * Exception: the check-in is a WEEKLY ritual — done for the week means no reminder
 * at all, not a daily generic nag. This is the PURE hand-off the device seam
 * (src/lib/notify) consumes; it fires nothing. Order follows REMINDER_DEFS.
 */
export function reminderNotifySpecs(
  settings: ReminderSettings,
  snapshot: ReminderSnapshot,
): ReminderNotifySpec[] {
  return REMINDER_DEFS.flatMap((d) => {
    const set = settings[d.kind];
    if (!set || !set.enabled) return [];
    const met = d.conditional ? conditionMet(d.kind, snapshot) : true;
    if (!met && d.kind === 'checkin') return [];
    const { title, body } = met ? reminderCopy(d.kind, snapshot) : genericReminderCopy(d.kind);
    return [{ kind: d.kind, title, body, hour: clampHour(set.hour) }];
  });
}

/**
 * Build the reminder snapshot from the live day state, so the store can hand the device
 * seam its specs without re-deriving the conditions inline. `proteinToday` is passed in
 * (it is a derived value); hydration target is the app constant; check-in is "due" while
 * it has not been submitted (mirrors nextAction's read). Pure.
 */
export function reminderSnapshotFromState(s: {
  proteinToday: number;
  proteinTarget: number;
  hydrationL: number;
  meals: { dinner: boolean };
  ciSubmitted: boolean;
  /** Whether the athlete has logged a weight today (drives the weigh-in nudge). */
  weighedToday: boolean;
  /** The weekly check-in snapshot + today's stamp: a real submission within the
   *  trailing week means the WEEKLY ritual is done — no daily nag labeled weekly. */
  ciLast?: { date: string; recovery: number } | null;
  dateStamp?: string;
  /** The linked coach/trainer's name (presence pull) — optional, real links only. */
  coachName?: string | null;
  /** Today's live score + the on-standard threshold, for the near-goal pull. Optional. */
  liveScore?: number;
  threshold?: number;
}): ReminderSnapshot {
  const doneThisWeek =
    s.ciSubmitted || (s.ciLast != null && s.dateStamp != null && withinTrailingWeek(s.ciLast.date, s.dateStamp));
  const gap =
    typeof s.liveScore === 'number' && typeof s.threshold === 'number' && Number.isFinite(s.liveScore)
      ? s.threshold - s.liveScore
      : null;
  return {
    proteinToday: s.proteinToday,
    proteinTarget: s.proteinTarget,
    hydrationL: s.hydrationL,
    hydrationTargetL: HYDRATION_TARGET,
    dinnerLogged: s.meals.dinner,
    checkinDue: !doneThisWeek,
    weighInDue: !s.weighedToday,
    coachName: s.coachName ?? null,
    pointsToStandard: gap,
  };
}
