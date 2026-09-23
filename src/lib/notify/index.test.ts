import * as Notifications from 'expo-notifications';
import { isNotifyAvailable, shouldSchedule, refreshReminderSchedule, cancelReminders, ensureNotifyPermission, notifyPermissionState } from './index';
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

// G-R10: nothing but a Continue primer shows the system notification question.
describe('permission is asked only on purpose', () => {
  const N = Notifications as unknown as { getPermissionsAsync: () => Promise<unknown>; requestPermissionsAsync: () => Promise<unknown> };
  const realGet = N.getPermissionsAsync;
  const realReq = N.requestPermissionsAsync;
  let requested = 0;
  beforeEach(() => {
    requested = 0;
    N.getPermissionsAsync = async () => ({ granted: false, status: 'undetermined', canAskAgain: true });
    N.requestPermissionsAsync = async () => { requested++; return { granted: true }; };
  });
  afterAll(() => { N.getPermissionsAsync = realGet; N.requestPermissionsAsync = realReq; });

  it('reads without asking by default', async () => {
    expect(await ensureNotifyPermission()).toBe(false);
    expect(requested).toBe(0);
    expect(await notifyPermissionState()).toBe('undetermined');
  });

  it('asks when told to', async () => {
    expect(await ensureNotifyPermission(true)).toBe(true);
    expect(requested).toBe(1);
  });

  it('a reminder sync never asks', async () => {
    await refreshReminderSchedule(reminderNotifySpecs(defaultReminderSettings(), behind), true);
    expect(requested).toBe(0);
    expect(scheduled).toHaveLength(0);
  });
});
