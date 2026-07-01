// OnStandard — store-level tests for the P3 reminder settings: the toggle/hour
// actions, defaults, persistence, and the hour clamp. Pure store logic.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useStore } from './useStore';
import { defaultReminderSettings, REMINDER_DEFS } from '@/core';

const state = () => useStore.getState();

beforeEach(() => {
  state().resetDemo();
});

describe('reminderSettings defaults', () => {
  it('seeds from defaultReminderSettings()', () => {
    expect(state().reminderSettings).toEqual(defaultReminderSettings());
  });
});

describe('toggleReminder', () => {
  it('flips a single reminder without touching the others', () => {
    const before = state().reminderSettings;
    state().toggleReminder('protein');
    const after = state().reminderSettings;
    expect(after.protein.enabled).toBe(!before.protein.enabled);
    expect(after.hydration).toEqual(before.hydration);
  });
  it('toggling twice returns to the original', () => {
    state().toggleReminder('checkin');
    state().toggleReminder('checkin');
    expect(state().reminderSettings.checkin.enabled).toBe(defaultReminderSettings().checkin.enabled);
  });
});

describe('setReminderHour', () => {
  it('sets the hour for one reminder', () => {
    state().setReminderHour('log_dinner', 21);
    expect(state().reminderSettings.log_dinner.hour).toBe(21);
  });
  it('clamps an out-of-range hour', () => {
    state().setReminderHour('protein', 99);
    expect(state().reminderSettings.protein.hour).toBe(23);
    state().setReminderHour('protein', -3);
    expect(state().reminderSettings.protein.hour).toBe(0);
  });
});

describe('reminderSettings persistence', () => {
  it('is in the persist whitelist', () => {
    const opts = (useStore as unknown as {
      persist: { getOptions: () => { partialize: (s: ReturnType<typeof state>) => object } };
    }).persist.getOptions();
    const persisted = Object.keys(opts.partialize(state()));
    expect(persisted).toContain('reminderSettings');
  });
  it('every REMINDER_DEFS kind has a setting', () => {
    const s = state().reminderSettings;
    for (const d of REMINDER_DEFS) expect(s[d.kind]).toBeDefined();
  });
});
