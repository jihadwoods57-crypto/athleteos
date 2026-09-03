// OnStandard — exec-driven local notifications (the NOTIFY_SYNC half).
// The proto's execution engine decides WHAT to remind and WHEN (pure, tested);
// this seam only schedules what it is handed: cancel the previous set, then
// schedule each future item as a one-shot date trigger. Exec is the ONLY
// scheduler now (the legacy daily reminders are retired), so cancel-all is safe.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ensureNotifyPermission, isNotifyAvailable } from './index';

export type ExecPlanItem = {
  id: string; atISO: string | null; title: string; body: string; route?: string | null;
  /** The one time fact ("Closes at 2:00 PM"). iOS draws it as its own line under the title;
   *  Android has no subtitle line, so it folds into the title (see `contentFor`). */
  subtitle?: string | null;
};

/** The notification content for one plan item on one platform. iOS gets the three-line shape
 *  the planner authored; every other platform gets `title · subtitle` folded into the title,
 *  because a subtitle Android cannot draw is that half of the copy silently thrown away. Pure. */
export function contentFor(p: ExecPlanItem, os: string): { title: string; subtitle?: string; body: string } {
  const sub = typeof p.subtitle === 'string' && p.subtitle.trim() ? p.subtitle.trim() : null;
  if (!sub) return { title: p.title, body: p.body };
  return os === 'ios' ? { title: p.title, subtitle: sub, body: p.body } : { title: `${p.title} · ${sub}`, body: p.body };
}

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
          content: { ...contentFor(p, Platform.OS), data: { route: p.route ?? null } },
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
