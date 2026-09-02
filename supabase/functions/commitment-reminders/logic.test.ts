import { composeReminderPush, isInitialPush, minutesLeft, clockIn, codeDeadlineMs, type ReminderRow } from './logic';

const base: ReminderRow = {
  athlete_id: 'a', instance_id: 'i', title: 'Wake-Up Roll Call',
  body: '5 minutes left to respond.', offset_min: 5, action_label: null,
  respond_by_at: '2026-09-01T10:05:00Z',
  type: 'morning_roll_call',
  message: 'Everyone up and ready to go?\n\nScout meet at 7 AM.',
  coach_name: "Coach D'Onofrio",
  starts_at: '2026-09-01T10:00:00Z', closes_at: '2026-09-01T12:05:00Z',
  fires_at: '2026-09-01T10:00:00Z', timezone: 'America/New_York',
};

describe('isInitialPush', () => {
  it('is the rung scheduled at the start time', () => {
    expect(isInitialPush(base)).toBe(true);
    expect(isInitialPush({ ...base, fires_at: '2026-09-01T10:00:59Z' })).toBe(true);
    expect(isInitialPush({ ...base, offset_min: 2, fires_at: '2026-09-01T10:03:00Z' })).toBe(false);
  });
  it('treats a pre-0211 row with no timing as a follow-up', () => {
    expect(isInitialPush({ ...base, fires_at: null, starts_at: null })).toBe(false);
  });
});

describe('composeReminderPush', () => {
  it('speaks as the coach on the first push, with the message verbatim', () => {
    const p = composeReminderPush(base, Date.parse('2026-09-01T10:00:20Z'));
    expect(p.fromCoach).toBe(true);
    expect(p.title).toBe("Coach D'Onofrio");
    expect(p.subtitle).toBe('Wake-Up Roll Call · 6:00 AM');
    // Whole message, newlines and all. Nothing shortened, nothing rewritten.
    expect(p.body).toBe('Everyone up and ready to go?\n\nScout meet at 7 AM.');
  });
  it('never invents words for the coach when there is no message', () => {
    const p = composeReminderPush({ ...base, message: '  ' }, Date.parse('2026-09-01T10:00:20Z'));
    expect(p.fromCoach).toBe(false);
    expect(p.title).toBe('Wake-Up Roll Call');
    expect(p.subtitle).toBe('6:00 AM');
    expect(p.body).toBe('Check in by 6:05 AM.');
  });
  it('speaks as OnStandard on the follow-up, with the minutes left', () => {
    const p = composeReminderPush({ ...base, offset_min: 2, fires_at: '2026-09-01T10:03:00Z' },
      Date.parse('2026-09-01T10:03:10Z'));
    expect(p.fromCoach).toBe(false);
    expect(p.title).toBe('Roll call is waiting');
    expect(p.body).toBe("You haven't checked in yet. 2 minutes remaining.");
    expect(p.subtitle).toBeUndefined();
  });
  it('singularises one minute and never says zero', () => {
    const one = composeReminderPush({ ...base, offset_min: 1, fires_at: '2026-09-01T10:04:00Z' },
      Date.parse('2026-09-01T10:04:05Z'));
    expect(one.body).toBe("You haven't checked in yet. 1 minute remaining.");
    expect(minutesLeft(base, Date.parse('2026-09-01T10:04:59Z'))).toBe(1);
    expect(minutesLeft(base, Date.parse('2026-09-01T10:05:30Z'))).toBe(1);
  });
  it('uses the last-call line at offset zero', () => {
    const p = composeReminderPush({ ...base, offset_min: 0, fires_at: '2026-09-01T10:05:00Z' },
      Date.parse('2026-09-01T10:05:10Z'));
    expect(p.body).toBe('Last call. Your coach is waiting.');
  });
  it('leaves every other commitment type exactly as before', () => {
    const p = composeReminderPush({ ...base, type: 'practice', title: 'Practice', body: '15 minutes left to respond.' },
      Date.parse('2026-09-01T10:00:00Z'));
    expect(p).toEqual({ title: 'Practice', body: '15 minutes left to respond.', fromCoach: false });
  });
  it('does not put the coach name on a system push even when it is known', () => {
    const p = composeReminderPush({ ...base, offset_min: 2, fires_at: '2026-09-01T10:03:00Z' },
      Date.parse('2026-09-01T10:03:00Z'));
    expect(p.title).not.toContain("D'Onofrio");
    expect(p.body).not.toContain("D'Onofrio");
  });
});

describe('clockIn', () => {
  it('renders in the commitment zone, not the server zone', () => {
    expect(clockIn('2026-09-01T10:00:00Z', 'America/New_York')).toBe('6:00 AM');
    expect(clockIn('2026-09-01T10:00:00Z', 'America/Los_Angeles')).toBe('3:00 AM');
    expect(clockIn('2026-09-01T10:00:00Z', 'Not/AZone')).toBe('10:00 AM');
    expect(clockIn(null, 'America/New_York')).toBe('');
  });
});

describe('codeDeadlineMs', () => {
  it('lasts the whole late window, then falls back to the deadline, then now', () => {
    expect(codeDeadlineMs(base, 0)).toBe(Date.parse('2026-09-01T12:05:00Z'));
    expect(codeDeadlineMs({ ...base, closes_at: null }, 0)).toBe(Date.parse('2026-09-01T10:05:00Z'));
    expect(codeDeadlineMs({ closes_at: null, respond_by_at: null }, 42)).toBe(42);
  });
});
