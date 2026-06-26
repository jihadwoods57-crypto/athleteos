import {
  REMINDER_DEFS,
  defaultReminderSettings,
  conditionMet,
  clampHour,
  activeReminders,
  reminderCopy,
  BEHIND_RATIO,
  type ReminderSnapshot,
  type ReminderSettings,
} from './reminders';

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
