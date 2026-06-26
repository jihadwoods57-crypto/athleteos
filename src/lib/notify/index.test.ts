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

// Locks the local-notification seam INERT: a regression that ships live scheduling
// (or fires when the master notif flag is off) without the founder's device wiring
// fails CI here.
describe('notify seam (inert)', () => {
  it('is not available by default', () => {
    expect(isNotifyAvailable).toBe(false);
  });

  it('shouldSchedule is false while the seam is unwired, regardless of the notif flag', () => {
    expect(shouldSchedule(true)).toBe(false);
    expect(shouldSchedule(false)).toBe(false);
  });

  it('refreshReminderSchedule resolves without firing anything (flag on)', async () => {
    const specs = reminderNotifySpecs(defaultReminderSettings(), behind);
    expect(specs.length).toBeGreaterThan(0); // real specs are produced...
    await expect(refreshReminderSchedule(specs, true)).resolves.toBeUndefined(); // ...and the seam still no-ops
  });

  it('refreshReminderSchedule resolves with the flag off', async () => {
    await expect(refreshReminderSchedule([], false)).resolves.toBeUndefined();
  });

  it('cancelReminders resolves (no scheduler touched)', async () => {
    await expect(cancelReminders()).resolves.toBeUndefined();
  });
});
