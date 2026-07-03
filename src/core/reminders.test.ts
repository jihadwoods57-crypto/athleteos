import {
  REMINDER_DEFS,
  defaultReminderSettings,
  conditionMet,
  clampHour,
  activeReminders,
  reminderCopy,
  formatReminderHour,
  reminderNotifySpecs,
  reminderSnapshotFromState,
  BEHIND_RATIO,
  type ReminderSnapshot,
  type ReminderSettings,
} from './reminders';
import { HYDRATION_TARGET } from './constants';

const onTrack: ReminderSnapshot = {
  proteinToday: 150,
  proteinTarget: 180,
  hydrationL: 3,
  hydrationTargetL: 3.5,
  dinnerLogged: true,
  checkinDue: false,
};

const behind: ReminderSnapshot = {
  proteinToday: 40,
  proteinTarget: 180,
  hydrationL: 0.5,
  hydrationTargetL: 3.5,
  dinnerLogged: false,
  checkinDue: true,
};

describe('REMINDER_DEFS', () => {
  it('has unique kinds with valid default hours', () => {
    const kinds = REMINDER_DEFS.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const d of REMINDER_DEFS) {
      expect(d.defaultHour).toBeGreaterThanOrEqual(0);
      expect(d.defaultHour).toBeLessThanOrEqual(23);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });
  it('has no em dashes in any shipped copy', () => {
    for (const d of REMINDER_DEFS) {
      expect(d.label).not.toContain('—');
      expect(d.description).not.toContain('—');
    }
  });
});

describe('defaultReminderSettings', () => {
  it('covers every reminder kind from its def', () => {
    const s = defaultReminderSettings();
    for (const d of REMINDER_DEFS) {
      expect(s[d.kind]).toEqual({ enabled: d.defaultOn, hour: d.defaultHour });
    }
  });
});

describe('conditionMet', () => {
  it('protein fires only when behind the BEHIND_RATIO of target', () => {
    expect(conditionMet('protein', behind)).toBe(true); // 40/180 < 0.6
    expect(conditionMet('protein', onTrack)).toBe(false); // 150/180 > 0.6
  });
  it('protein is safe on a zero/invalid target (no div-by-zero true)', () => {
    expect(conditionMet('protein', { ...behind, proteinTarget: 0 })).toBe(false);
  });
  it('hydration fires only when behind', () => {
    expect(conditionMet('hydration', behind)).toBe(true);
    expect(conditionMet('hydration', onTrack)).toBe(false);
  });
  it('log_dinner fires only when dinner is not logged', () => {
    expect(conditionMet('log_dinner', behind)).toBe(true);
    expect(conditionMet('log_dinner', onTrack)).toBe(false);
  });
  it('checkin fires only when due', () => {
    expect(conditionMet('checkin', behind)).toBe(true);
    expect(conditionMet('checkin', onTrack)).toBe(false);
  });
  it('the BEHIND_RATIO boundary is exclusive', () => {
    const atRatio: ReminderSnapshot = { ...onTrack, proteinToday: 180 * BEHIND_RATIO, proteinTarget: 180 };
    expect(conditionMet('protein', atRatio)).toBe(false); // exactly 0.6 is not "behind"
  });
});

describe('clampHour', () => {
  it('clamps to 0-23 and rounds', () => {
    expect(clampHour(-5)).toBe(0);
    expect(clampHour(30)).toBe(23);
    expect(clampHour(16.4)).toBe(16);
  });
  it('handles non-finite input', () => {
    expect(clampHour(NaN)).toBe(0);
  });
});

describe('activeReminders', () => {
  it('returns the conditional reminders whose condition holds', () => {
    const kinds = activeReminders(defaultReminderSettings(), behind).map((d) => d.kind);
    expect(kinds).toEqual(['protein', 'hydration', 'log_dinner', 'checkin']);
  });
  it('drops a reminder whose condition no longer holds', () => {
    expect(activeReminders(defaultReminderSettings(), onTrack)).toEqual([]);
  });
  it('respects a disabled setting', () => {
    const settings: ReminderSettings = { ...defaultReminderSettings(), protein: { enabled: false, hour: 16 } };
    const kinds = activeReminders(settings, behind).map((d) => d.kind);
    expect(kinds).not.toContain('protein');
    expect(kinds).toContain('hydration');
  });
});

describe('reminderCopy', () => {
  it('protein names the real gap to the target, no guilt, no em dash', () => {
    const { title, body } = reminderCopy('protein', behind);
    expect(title).toBe('Protein check');
    expect(body).toContain('140g'); // 180 - 40
    expect(body).toContain('180g');
    expect(body).not.toContain('—');
  });
  it('protein gap never shows a negative number when over target', () => {
    const over: ReminderSnapshot = { ...behind, proteinToday: 200, proteinTarget: 180 };
    const body = reminderCopy('protein', over).body;
    expect(body).not.toMatch(/-\d/); // no "-20g"
    expect(body).toContain('closing in'); // uses the at/over-target branch
  });
  it('check-in copy is factual, not guilt ("will see", not "waiting")', () => {
    const body = reminderCopy('checkin', behind).body;
    expect(body.toLowerCase()).toContain('will see');
    expect(body.toLowerCase()).not.toContain('waiting');
  });
  it('every kind produces non-empty title + body with no em dash', () => {
    for (const d of REMINDER_DEFS) {
      const { title, body } = reminderCopy(d.kind, behind);
      expect(title.length).toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(0);
      expect(title).not.toContain('—');
      expect(body).not.toContain('—');
    }
  });
});

describe('formatReminderHour', () => {
  it('formats midnight and noon edges', () => {
    expect(formatReminderHour(0)).toBe('12 AM');
    expect(formatReminderHour(12)).toBe('12 PM');
  });
  it('formats morning and evening hours', () => {
    expect(formatReminderHour(7)).toBe('7 AM');
    expect(formatReminderHour(16)).toBe('4 PM');
    expect(formatReminderHour(23)).toBe('11 PM');
  });
  it('clamps out-of-range / non-finite input before formatting', () => {
    expect(formatReminderHour(30)).toBe('11 PM');
    expect(formatReminderHour(-5)).toBe('12 AM');
    expect(formatReminderHour(NaN)).toBe('12 AM');
  });
});

describe('reminderNotifySpecs', () => {
  it('produces one spec per enabled reminder; behind conditions carry specific copy', () => {
    const specs = reminderNotifySpecs(defaultReminderSettings(), behind);
    // weigh_in rides along with generic copy (its condition isn't set in this snapshot,
    // but daily triggers repeat on fresh days — see the day-1-silence contract).
    expect(specs.map((s) => s.kind)).toEqual(['protein', 'hydration', 'log_dinner', 'checkin', 'weigh_in']);
    const protein = specs.find((s) => s.kind === 'protein')!;
    expect(protein.hour).toBe(16); // the default protein hour
    expect(protein.title).toBe('Protein check');
    expect(protein.body).toContain('140g');
  });
  it('a fully on-track day still schedules the generic daily floor (day-1 silence fix)', () => {
    const specs = reminderNotifySpecs(defaultReminderSettings(), onTrack);
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.some((s) => s.kind === 'checkin')).toBe(false); // weekly ritual done = done
    for (const s of specs) expect(s.body).not.toMatch(/\d+g from/); // no stale behind-numbers
  });
  it('carries the user-set hour, clamped', () => {
    const settings: ReminderSettings = { ...defaultReminderSettings(), protein: { enabled: true, hour: 99 } };
    const protein = reminderNotifySpecs(settings, behind).find((s) => s.kind === 'protein')!;
    expect(protein.hour).toBe(23);
  });
  it('omits a disabled reminder', () => {
    const settings: ReminderSettings = { ...defaultReminderSettings(), hydration: { enabled: false, hour: 14 } };
    expect(reminderNotifySpecs(settings, behind).map((s) => s.kind)).not.toContain('hydration');
  });
  it('emits no em dash in any spec copy', () => {
    for (const spec of reminderNotifySpecs(defaultReminderSettings(), behind)) {
      expect(spec.title).not.toContain('—');
      expect(spec.body).not.toContain('—');
    }
  });
});

describe('reminderSnapshotFromState', () => {
  const base = { proteinToday: 90, proteinTarget: 180, hydrationL: 1.5, meals: { dinner: false }, ciSubmitted: false, weighedToday: false };

  it('maps day state to a snapshot the spec builder consumes', () => {
    expect(reminderSnapshotFromState(base)).toEqual({
      proteinToday: 90,
      proteinTarget: 180,
      hydrationL: 1.5,
      hydrationTargetL: HYDRATION_TARGET,
      dinnerLogged: false,
      checkinDue: true,
      weighInDue: true,
    });
  });

  it('reads dinnerLogged from the meal slot and checkinDue from ciSubmitted', () => {
    const snap = reminderSnapshotFromState({ ...base, meals: { dinner: true }, ciSubmitted: true });
    expect(snap.dinnerLogged).toBe(true);
    expect(snap.checkinDue).toBe(false);
  });

  it('an at-target athlete still gets tomorrow\'s floor: generic dailies, never total silence', () => {
    // The old contract scheduled NOTHING for a user who finished day 0 on-track —
    // total notification silence on day 1, for exactly the user retention needs to
    // pull back. Daily triggers repeat on FRESH days (where the conditions hold
    // again by definition), so they schedule with generic forward-looking copy.
    const snap = reminderSnapshotFromState({ proteinToday: 180, proteinTarget: 180, hydrationL: HYDRATION_TARGET, meals: { dinner: true }, ciSubmitted: true, weighedToday: true });
    const specs = reminderNotifySpecs(defaultReminderSettings(), snap);
    expect(specs.map((s) => s.kind).sort()).toEqual(['hydration', 'log_dinner', 'protein', 'weigh_in']);
    // Generic copy carries no stale "behind" numbers.
    const protein = specs.find((s) => s.kind === 'protein');
    expect(protein?.body).not.toMatch(/\d+g from/);
  });

  it('a check-in done this week schedules NO check-in reminder (weekly ritual, not a daily nag)', () => {
    const snap = reminderSnapshotFromState({
      proteinToday: 0, proteinTarget: 180, hydrationL: 0, meals: { dinner: false }, weighedToday: false,
      ciSubmitted: false, ciLast: { date: '2026-07-01', recovery: 70 }, dateStamp: '2026-07-03',
    });
    const specs = reminderNotifySpecs(defaultReminderSettings(), snap);
    expect(specs.some((s) => s.kind === 'checkin')).toBe(false);
    expect(specs.some((s) => s.kind === 'protein')).toBe(true); // behind conditions still fire specific copy
  });

  it('checkinDue honors the WEEKLY carry: a fresh submission this week is not due', () => {
    // The reminder is titled "Weekly check-in" but fired daily (ciSubmitted resets
    // nightly) — a daily 6 PM nag labeled weekly. A ciLast within the trailing week
    // means the ritual is done for the week.
    const snap = reminderSnapshotFromState({
      ...base,
      ciSubmitted: false,
      ciLast: { date: '2026-07-01', recovery: 70 },
      dateStamp: '2026-07-03',
    });
    expect(snap.checkinDue).toBe(false);
  });

  it('an expired weekly snapshot makes the check-in due again', () => {
    const snap = reminderSnapshotFromState({
      ...base,
      ciSubmitted: false,
      ciLast: { date: '2026-07-01', recovery: 70 },
      dateStamp: '2026-07-09',
    });
    expect(snap.checkinDue).toBe(true);
  });
});
