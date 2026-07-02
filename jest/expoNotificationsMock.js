// Node-test stub for expo-notifications (native ESM). Records scheduled notifications so the
// device seam is testable without a device; real delivery is device-only.
const scheduled = [];
module.exports = {
  __scheduled: scheduled,
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: async (req) => {
    scheduled.push(req);
    return `id-${scheduled.length}`;
  },
  cancelAllScheduledNotificationsAsync: async () => {
    scheduled.length = 0;
  },
};
