// OnStandard — notifications seam (inert until expo-notifications is added).
//
// Accountability needs timely prompts: protein/hydration/dinner/check-in reminders
// for the athlete (P3). This file is the DEVICE half: the glue that would (re)schedule
// the day's active reminders as LOCAL notifications. The pure half — which reminders
// are active today, their hour, and their copy — lives in core/reminders.ts
// (reminderNotifySpecs); this seam only schedules what it is handed.
//
// Activate this seam:
//   1) `npx expo install expo-notifications`
//   2) request permission + set the Android channel (no remote push token needed —
//      these are LOCAL notifications only)
//   3) implement the bodies below against Notifications.scheduleNotificationAsync
//      with a daily trigger at spec.hour
//   4) set isNotifyAvailable = true
//   5) call refreshReminderSchedule(reminderNotifySpecs(settings, snapshot), notif)
//      from the app whenever settings or the day snapshot change.
// Everything no-ops by default so the app (and web) run unchanged. LOCAL only:
// nothing here sends a remote/push notification or contacts a real person.

import type { ReminderNotifySpec } from '@/core';

export const isNotifyAvailable = false;

export type { ReminderNotifySpec };

/**
 * Whether reminders should actually be scheduled right now: only when the device
 * seam is wired AND the athlete's master notifications flag is on. Pure + exported
 * so the gate is unit-testable without a device.
 */
export function shouldSchedule(notifEnabled: boolean): boolean {
  return isNotifyAvailable && notifEnabled;
}

/**
 * (Re)schedule the day's active reminders as LOCAL notifications: cancel the old
 * set, then schedule one daily notification per spec at its hour. No-op until the
 * seam is wired and the master `notif` flag is on (see shouldSchedule). When the
 * flag is off it still clears any previously-scheduled reminders.
 */
export async function refreshReminderSchedule(
  specs: ReminderNotifySpec[],
  notifEnabled: boolean,
): Promise<void> {
  if (!isNotifyAvailable) return;
  await cancelReminders();
  if (!shouldSchedule(notifEnabled)) return;
  // Real impl (once wired): for (const s of specs) schedule a daily LOCAL
  // notification with { title: s.title, body: s.body } at hour s.hour. The
  // conditional reminders were already filtered by reminderNotifySpecs, so every
  // spec handed here is one we want to fire.
  void specs;
  return;
}

/** Cancel all scheduled reminders (e.g. when the athlete turns notifications off). */
export async function cancelReminders(): Promise<void> {
  return;
}
