// OnStandard — notifications seam (LOCAL reminders via expo-notifications).
//
// Accountability needs timely prompts: protein/hydration/dinner/weigh-in/check-in reminders
// for the athlete (P3). This file is the DEVICE half: it (re)schedules the day's active
// reminders as LOCAL notifications. The pure half — which reminders are active today, their
// hour, and their copy — lives in core/reminders.ts (reminderNotifySpecs); this seam only
// schedules what it is handed.
//
// This file schedules LOCAL reminders. It also captures the device's Expo PUSH token
// (getPushToken) for remote coach->athlete push — the send side is the send-push edge
// function + device_tokens table; the store registers the token via registerDeviceToken.
// Web has no scheduler / push, so isNotifyAvailable is false there and every call no-ops.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { ReminderNotifySpec } from '@/core';

/** Local notifications work on native; web has no scheduler. Permission is requested at
 *  runtime (ensureNotifyPermission); a denial makes scheduling a graceful no-op. */
export const isNotifyAvailable = Platform.OS !== 'web';

export type { ReminderNotifySpec };

const ANDROID_CHANNEL = 'reminders';

/**
 * Ask for notification permission (idempotent) and set the Android channel. Returns true if
 * we may post local notifications. Never throws — a denial or error just disables reminders.
 */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (!isNotifyAvailable) return false;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return !!req.granted;
  } catch {
    return false;
  }
}

/**
 * Whether reminders should actually be scheduled right now: only when the device seam is
 * available AND the athlete's master notifications flag is on. Pure + exported so the gate is
 * unit-testable without a device.
 */
export function shouldSchedule(notifEnabled: boolean): boolean {
  return isNotifyAvailable && notifEnabled;
}

/**
 * (Re)schedule the day's active reminders as LOCAL daily notifications: cancel the old set,
 * then schedule one per spec at its hour. No-op on web. When the master flag is off it still
 * clears any previously-scheduled reminders. Best-effort — never throws.
 */
export async function refreshReminderSchedule(
  specs: ReminderNotifySpec[],
  notifEnabled: boolean,
): Promise<void> {
  if (!isNotifyAvailable) return;
  try {
    await cancelReminders();
    if (!shouldSchedule(notifEnabled)) return;
    const granted = await ensureNotifyPermission();
    if (!granted) return;
    // The conditional reminders were already filtered by reminderNotifySpecs, so every spec
    // handed here is one we want to fire — schedule each as a daily local notification.
    for (const s of specs) {
      await Notifications.scheduleNotificationAsync({
        content: { title: s.title, body: s.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: s.hour,
          minute: 0,
          channelId: Platform.OS === 'android' ? ANDROID_CHANNEL : undefined,
        },
      });
    }
  } catch {
    // A scheduler hiccup must never crash the app; reminders are best-effort.
  }
}

/**
 * Capture this device's Expo push token for remote coach→athlete push. Native only, after
 * permission is granted, and only when an EAS projectId exists (set once there's an EAS
 * build). Returns null when unavailable — never throws. The store registers the returned
 * token server-side (registerDeviceToken); this seam only mints it.
 */
export async function getPushToken(): Promise<string | null> {
  if (!isNotifyAvailable) return null;
  try {
    const granted = await ensureNotifyPermission();
    if (!granted) return null;
    // Lazy require so tests (which never call this) don't load expo-constants (ESM, native).
    const Constants = (require('expo-constants') as { default?: unknown }).default as
      | { expoConfig?: { extra?: { eas?: { projectId?: string } } }; easConfig?: { projectId?: string } }
      | undefined;
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) return null; // no EAS project yet → can't mint a push token
    const res = await Notifications.getExpoPushTokenAsync({ projectId });
    return res.data ?? null;
  } catch {
    return null;
  }
}

/** Cancel all scheduled reminders (e.g. when the athlete turns notifications off). */
export async function cancelReminders(): Promise<void> {
  if (!isNotifyAvailable) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // best effort
  }
}
