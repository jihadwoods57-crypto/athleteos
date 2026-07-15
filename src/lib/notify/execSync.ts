// OnStandard — exec-driven local notifications (the NOTIFY_SYNC half).
// The proto's execution engine decides WHAT to remind and WHEN (pure, tested);
// this seam only schedules what it is handed: cancel the previous set, then
// schedule each future item as a one-shot date trigger. Exec is the ONLY
// scheduler now (the legacy daily reminders are retired), so cancel-all is safe.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ensureNotifyPermission, isNotifyAvailable } from './index';

export type ExecPlanItem = { id: string; atISO: string | null; title: string; body: string; route?: string | null };

export async function syncExecNotifications(plan: ExecPlanItem[]): Promise<void> {
  if (!isNotifyAvailable) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!plan.length) return;
    const granted = await ensureNotifyPermission();
    if (!granted) return;
    for (const p of plan) {
      const at = p.atISO ? new Date(p.atISO) : null;
      // Skip malformed dates (Invalid Date → NaN) and items already stale by transit time.
      if (at && (Number.isNaN(at.getTime()) || at.getTime() <= Date.now())) continue;
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: `exec-${p.id}-${p.atISO ?? 'now'}`,
          // route rides in data so the tap handler (ProtoApp) can land the WebView on the
          // exact screen the reminder is about — camera/dinner, recovery, weight.
          content: { title: p.title, body: p.body, data: { route: p.route ?? null } },
          trigger: at
            ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: Platform.OS === 'android' ? 'reminders' : undefined }
            : null,
        });
      } catch {
        // one bad item must never suppress the rest of the plan — skip and continue
      }
    }
  } catch {
    // best-effort — a scheduler hiccup never surfaces to the athlete
  }
}
