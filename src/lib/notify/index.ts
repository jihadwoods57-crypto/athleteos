// AthleteOS — notifications seam (inert until expo-notifications is added).
//
// Accountability needs timely prompts: meal/hydration/check-in reminders for the athlete,
// and "your athlete needs you" / nudge alerts for the overseer. Activate this seam:
//   1) `npx expo install expo-notifications`
//   2) request permission, get the push token, implement the functions below
//   3) set isNotifyAvailable = true
//   4) gate scheduling on the persisted `notif` flag (already in the store / Profile toggle)
//   5) real push (overseer -> athlete nudge) also needs the backend to store tokens + send.
// No-ops by default so the app (and web) run unchanged.

export const isNotifyAvailable = false;

export interface ReminderSpec {
  key: 'meal' | 'hydration' | 'checkin';
  title: string;
  body: string;
  /** Local hour (0-23) to fire the daily reminder. */
  hour: number;
}

/** Schedule the athlete's daily reminders (no-op until wired + `notif` is on). */
export async function scheduleReminders(_specs: ReminderSpec[]): Promise<void> {
  return;
}

/** Cancel all scheduled reminders (e.g. when the athlete turns notifications off). */
export async function cancelReminders(): Promise<void> {
  return;
}
