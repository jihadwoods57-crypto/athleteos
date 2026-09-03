// Connected Standards reminder copy — the vectors that keep this file and the proto engine
// (proto/redesign-2026-07/js/connected-standards.js) saying the same thing about the same numbers.
// The two are duplicated because Deno cannot import a WebView ES module; these assertions are the
// contract that stops them drifting.
import { fmtValue, unitNoun, groupThousands, toDisplay, clockAt, reminderCopy } from './activity-copy';

const MI = 1609.344;

describe('activity copy formatting', () => {
  it('groups thousands the same way the client does', () => {
    expect(groupThousands(7842)).toBe('7,842');
    expect(groupThousands(1000000)).toBe('1,000,000');
    expect(groupThousands(999)).toBe('999');
  });

  it('renders distance from metres, the only unit ever stored', () => {
    expect(toDisplay(5000, 'distance', 'km')).toBe(5);
    expect(fmtValue(2.73 * MI, 'distance', 'mi')).toBe('2.73');
    expect(fmtValue(12 * MI, 'distance', 'mi')).toBe('12');
    expect(fmtValue(10000, 'steps', 'steps')).toBe('10,000');
  });

  it('goes singular where a human would', () => {
    expect(unitNoun('steps', 'steps', 1)).toBe('step');
    expect(unitNoun('steps', 'steps', 2158)).toBe('steps');
    expect(unitNoun('workouts', 'workouts', 1)).toBe('workout');
  });

  it('renders the deadline in the athlete zone, not the server zone', () => {
    // 02:59 UTC is 9:59 PM the previous evening in New York. A reminder that named the UTC hour
    // would tell an athlete their day ends tomorrow morning.
    expect(clockAt('2026-07-29T01:00:00Z', 'America/New_York')).toBe('9:00 PM');
    expect(clockAt(null, 'America/New_York')).toBe('');
    expect(clockAt('not-a-date', 'America/New_York')).toBe('');
  });
});

describe('the nudge itself', () => {
  const daily = {
    title: 'Daily Movement', metric: 'steps', display_unit: 'steps',
    target: 10000, progress: 6800, period: 'day',
    period_start: '2026-07-28', period_end: '2026-07-28',
    deadline_at: '2026-07-29T01:00:00Z',
  };

  it('tells a daily standard what is left and by when', () => {
    const c = reminderCopy(daily, '2026-07-28T22:00:00Z');
    expect(c.title).toBe('Daily Movement');
    expect(c.body).toBe('3,200 steps to go by 9:00 PM.');
  });

  it('drops the clause rather than inventing a time it does not know', () => {
    const c = reminderCopy({ ...daily, deadline_at: null }, '2026-07-28T22:00:00Z');
    expect(c.body).toBe('3,200 steps to go today.');
  });

  it('gives a weekly standard the per-day number, which is the one that decides anything', () => {
    const weekly = {
      title: 'Weekly Miles', metric: 'distance', display_unit: 'mi',
      target: 12 * MI, progress: 4 * MI, period: 'week',
      period_start: '2026-07-27', period_end: '2026-08-02',
      deadline_at: '2026-08-03T03:59:00Z',
    };
    // Thursday: Fri/Sat/Sun plus today = 4 days left, 8 miles to go → 2 a day.
    const c = reminderCopy(weekly, '2026-07-30T18:00:00Z');
    expect(c.body).toBe('8 mi to go with 4 days left. About 2 mi a day gets you there.');
  });

  it('says last day instead of doing pointless division', () => {
    const weekly = {
      title: 'Weekly Miles', metric: 'distance', display_unit: 'mi',
      target: 12 * MI, progress: 10 * MI, period: 'week',
      period_start: '2026-07-27', period_end: '2026-08-02',
      deadline_at: '2026-08-03T03:59:00Z',
    };
    expect(reminderCopy(weekly, '2026-08-02T14:00:00Z').body).toBe('Last day: 2 mi to go.');
  });

  it('never emits a negative remainder even if a caller passes an over-target row', () => {
    const c = reminderCopy({ ...daily, progress: 12000 }, '2026-07-28T22:00:00Z');
    expect(c.body).toBe('0 steps to go by 9:00 PM.');
  });
});
