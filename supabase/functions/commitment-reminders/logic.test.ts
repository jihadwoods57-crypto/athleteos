import { composeReminderPush, isInitialPush, minutesLeft, clockIn, codeDeadlineMs, pushBody, platformCopy, PUSH_BODY_MAX_BYTES, type ReminderRow } from './logic';

const base: ReminderRow = {
  athlete_id: 'a', instance_id: 'i', title: 'Wake-Up Roll Call',
  body: '5 minutes left to respond.', offset_min: 5, action_label: null,
  respond_by_at: '2026-09-01T10:05:00Z',
  type: 'morning_roll_call',
  message: 'Everyone up and ready to go?\n\nScout meet at 7 AM.',
  coach_name: "Coach D'Onofrio",
  starts_at: '2026-09-01T10:00:00Z', closes_at: '2026-09-01T10:30:00Z',
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

describe('composeReminderPush: the three lock-screen states', () => {
  it('INITIAL puts the COACH NAME in the title and the roll call in the subtitle', () => {
    const p = composeReminderPush(base, Date.parse('2026-09-01T10:00:20Z'));
    expect(p.fromCoach).toBe(true);
    expect(p.title).toBe("Coach D'Onofrio");
    expect(p.subtitle).toBe('Wake-Up Roll Call · up by 6:05 AM');
    expect(p.body).toBe(base.message);
    expect(p.truncated).toBe(false);
  });
  it('INITIAL folds both names into one title for Android, which has no subtitle', () => {
    const p = composeReminderPush(base, Date.parse('2026-09-01T10:00:20Z'));
    expect(p.androidTitle).toBe("Coach D'Onofrio · Wake-Up Roll Call · up by 6:05 AM");
    expect(platformCopy(p, 'android').subtitle).toBeNull();
    expect(platformCopy(p, 'ios').subtitle).toBe('Wake-Up Roll Call · up by 6:05 AM');
    // An unknown platform is treated as the one that cannot render a subtitle: never drop copy.
    expect(platformCopy(p, null).title).toBe(p.androidTitle);
  });
  it('INITIAL with no message never invents words in the coach name, and adds no subtitle', () => {
    const p = composeReminderPush({ ...base, message: '  ' }, Date.parse('2026-09-01T10:00:20Z'));
    expect(p.fromCoach).toBe(false);
    expect(p.title).toBe('Wake-Up Roll Call');
    expect(p.subtitle).toBeNull();
    expect(p.androidTitle).toBe('Wake-Up Roll Call');
    expect(p.body).toBe('Check in by 6:05 AM.');
  });
  it('REMINDER leads with the TIME LEFT, the one fact that changed since the last push', () => {
    const p = composeReminderPush({ ...base, offset_min: 2, fires_at: '2026-09-01T10:03:00Z' },
      Date.parse('2026-09-01T10:03:10Z'));
    expect(p.fromCoach).toBe(false);
    expect(p.title).toBe('2 minutes left');
    expect(p.subtitle).toBe('Wake-Up Roll Call');
    expect(p.body).toBe('On Standard until 6:05 AM.');
    expect(p.title).not.toContain("D'Onofrio");
    expect(p.androidTitle).toBe('2 minutes left · Wake-Up Roll Call');
  });
  it('singularises one minute and never says zero', () => {
    const one = composeReminderPush({ ...base, offset_min: 1, fires_at: '2026-09-01T10:04:00Z' },
      Date.parse('2026-09-01T10:04:05Z'));
    expect(one.title).toBe('1 minute left');
    expect(minutesLeft(base, Date.parse('2026-09-01T10:04:59Z'))).toBe(1);
    expect(minutesLeft(base, Date.parse('2026-09-01T10:05:30Z'))).toBe(1);
  });
  it('uses the last-call line at offset zero', () => {
    const p = composeReminderPush({ ...base, offset_min: 0, fires_at: '2026-09-01T10:05:00Z' },
      Date.parse('2026-09-01T10:05:10Z'));
    expect(p.title).toBe('Last call');
    expect(p.body).toBe('Your coach is waiting.');
  });
  it('never writes the app name into our own copy (the OS draws it)', () => {
    for (const row of [base,
      { ...base, offset_min: 2, fires_at: '2026-09-01T10:03:00Z' },
      { ...base, message: '' }]) {
      const p = composeReminderPush(row, Date.parse('2026-09-01T10:03:10Z'));
      expect(`${p.title} ${p.subtitle ?? ''} ${p.body}`).not.toContain('OnStandard');
    }
  });
  it('leaves every other commitment type exactly as before', () => {
    const p = composeReminderPush({ ...base, type: 'practice', title: 'Practice', body: '15 minutes left to respond.' },
      Date.parse('2026-09-01T10:00:00Z'));
    expect(p.title).toBe('Practice');
    expect(p.subtitle).toBeNull();
    expect(p.androidTitle).toBe('Practice');
    expect(p.body).toBe('15 minutes left to respond.');
    expect(p.androidBody).toBe('15 minutes left to respond.');
    expect(p.fromCoach).toBe(false);
    expect(p.truncated).toBe(false);
  });
});

describe('pushBody: the push cap (the app keeps the whole message)', () => {
  const enc = new TextEncoder();
  it('leaves a 1000-character ASCII message alone', () => {
    const m = 'a'.repeat(1000);
    expect(pushBody(m)).toEqual({ text: m, truncated: false });
  });
  it('caps 1000 emoji (4 bytes each) under the byte budget without splitting one', () => {
    const m = '🏈'.repeat(1000);
    const r = pushBody(m);
    expect(r.truncated).toBe(true);
    expect(enc.encode(r.text).length).toBeLessThanOrEqual(PUSH_BODY_MAX_BYTES);
    expect(r.text.endsWith('…')).toBe(true);
    // Every character before the ellipsis is a whole football, never a broken surrogate.
    expect([...r.text.slice(0, -1)].every((c) => c === '🏈')).toBe(true);
  });
  it('cuts on a word boundary when one is near the edge, and keeps accents whole', () => {
    const words = Array.from({ length: 400 }, (_, i) => `réveil${i}`).join(' ');
    const r = pushBody(words);
    expect(r.truncated).toBe(true);
    expect(enc.encode(r.text).length).toBeLessThanOrEqual(PUSH_BODY_MAX_BYTES);
    expect(r.text.slice(0, -1).endsWith(' ')).toBe(false);
    expect(r.text.slice(0, -1).split(' ').every((w) => /^réveil\d+$/.test(w))).toBe(true);
  });
  it('handles a message with no spaces at all', () => {
    const r = pushBody('x'.repeat(5000));
    expect(enc.encode(r.text).length).toBeLessThanOrEqual(PUSH_BODY_MAX_BYTES);
    expect(r.text.endsWith('…')).toBe(true);
  });
  it('the initial push reports truncation so the caller can log it', () => {
    const p = composeReminderPush({ ...base, message: 'word '.repeat(600) }, Date.parse('2026-09-01T10:00:20Z'));
    expect(p.truncated).toBe(true);
    expect(enc.encode(p.body).length).toBeLessThanOrEqual(PUSH_BODY_MAX_BYTES);
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
  it('lasts until the close, then falls back to the deadline, then now', () => {
    expect(codeDeadlineMs(base, 0)).toBe(Date.parse('2026-09-01T10:30:00Z'));
    expect(codeDeadlineMs({ ...base, closes_at: null }, 0)).toBe(Date.parse('2026-09-01T10:05:00Z'));
    expect(codeDeadlineMs({ closes_at: null, respond_by_at: null }, 42)).toBe(42);
  });
});
