// OnStandard — exec-driven local notifications (the NOTIFY_SYNC half).
// The proto's execution engine decides WHAT to remind and WHEN (pure, tested);
// this seam only schedules what it is handed: cancel the previous set, then
// schedule each future item as a one-shot date trigger. Exec is the ONLY
// scheduler now (the legacy daily reminders are retired), so cancel-all is safe.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ensureNotifyPermission, isNotifyAvailable } from './index';

export type ExecPlanItem = { id: string; atISO: string | null; title: string; body: string };

export async function syncExecNotifications(plan: ExecPlanItem[]): Promise<void> {
  if (!isNotifyAvailable) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!plan.length) return;
    const granted = await ensureNotifyPermission();
    if (!granted) return;
    for (const p of plan) {
      const at = p.atISO ? new Date(p.atISO) : null;
      if (at && at.getTime() <= Date.now()) continue; // stale by transit time — skip
      await Notifications.scheduleNotificationAsync({
        identifier: `exec-${p.id}-${p.atISO ?? 'now'}`,
        content: { title: p.title, body: p.body },
        trigger: at
          ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: Platform.OS === 'android' ? 'reminders' : undefined }
          : null,
      });
    }
  } catch {
    // best-effort — a scheduler hiccup never surfaces to the athlete
  }
}
