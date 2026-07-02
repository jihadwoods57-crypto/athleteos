import * as Notifications from 'expo-notifications';
import { isNotifyAvailable, shouldSchedule, refreshReminderSchedule, cancelReminders } from './index';
import { reminderNotifySpecs, defaultReminderSettings, type ReminderSnapshot } from '@/core';

const behind: ReminderSnapshot = {
  proteinToday: 40,
  proteinTarget: 180,
  hydrationL: 0.5,
  hydrationTargetL: 3.5,
  dinnerLogged: false,
  checkinDue: true,
};

// The jest stub records scheduled notifications so the device seam is testable without a device.
const scheduled = (Notifications as unknown as { __scheduled: Array<{ content: { title: string }; trigger: { hour: number } }> }).__scheduled;

beforeEach(() => {
  scheduled.length = 0;
});

describe('notify seam (local reminders)', () => {
  it('is available on native (Platform mocked as ios)', () => {
    expect(isNotifyAvailable).toBe(true);
  });

  it('shouldSchedule tracks the master notif flag', () => {
    expect(shouldSchedule(true)).toBe(true);
    expect(shouldSchedule(false)).toBe(false);
  });

  it('schedules one daily local notification per active spec, at its hour', async () => {
    const specs = reminderNotifySpecs(defaultReminderSettings(), behind);
    expect(specs.length).toBeGreaterThan(0);
    await refreshReminderSchedule(specs, true);
    expect(scheduled).toHaveLength(specs.length);
    for (let i = 0; i < specs.length; i++) {
      expect(scheduled[i].content.title).toBe(specs[i].title);
      expect(scheduled[i].trigger.hour).toBe(specs[i].hour);
    }
  });

  it('schedules nothing when the master flag is off', async () => {
    const specs = reminderNotifySpecs(defaultReminderSettings(), behind);
    await refreshReminderSchedule(specs, false);
    expect(scheduled).toHaveLength(0);
  });

  it('cancelReminders clears the schedule', async () => {
    await refreshReminderSchedule(reminderNotifySpecs(defaultReminderSettings(), behind), true);
    await cancelReminders();
    expect(scheduled).toHaveLength(0);
  });
});
