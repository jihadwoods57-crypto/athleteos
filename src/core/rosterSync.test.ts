// AthleteOS — Stage D projection: real `days` rows -> coach RosterRow[]. Proves the
// mapping is honest and total (score clamped, compliance from tasks, loggedToday true
// for every fetched row, name/initials/trend from the provided profile meta) and that
// the Phase-5 filters + risk ranking run unchanged on the projected rows.
import {
  dayCompliance,
  filterRoster,
  initialsFromName,
  mapLinkedDaysToRoster,
  notLoggedCount,
  rankByRisk,
  type LinkedDay,
} from './index';

const day = (id: string, over: Partial<LinkedDay> = {}): LinkedDay => ({
  athlete_id: id,
  score: 80,
  tasks: [{ done: true }, { done: true }, { done: false }, { done: false }],
  hydration_l: 2,
  meals: { breakfast: true },
  current_weight: 180,
  ...over,
});

describe('initialsFromName', () => {
  it('handles one and two-part names + empties', () => {
    expect(initialsFromName('Jihad')).toBe('J');
    expect(initialsFromName('D. Brooks')).toBe('DB');
    expect(initialsFromName('  ')).toBe('?');
  });
});

describe('dayCompliance', () => {
  it('is the share of tasks done, clamped 0..100', () => {
    expect(dayCompliance(day('a'))).toBe(50); // 2 of 4
    expect(dayCompliance(day('a', { tasks: [{ done: true }] }))).toBe(100);
  });
  it('falls back to the score when there are no tasks', () => {
    expect(dayCompliance(day('a', { tasks: [], score: 73 }))).toBe(73);
  });
  it('never emits NaN/out-of-range from a null/garbage score', () => {
    expect(dayCompliance(day('a', { tasks: [], score: null }))).toBe(0);
  });
});

describe('mapLinkedDaysToRoster', () => {
  it('projects every row as logged-today with derived comp + clamped score', () => {
    const rows = mapLinkedDaysToRoster([day('a', { score: 999 }), day('b', { score: -5 })]);
    expect(rows).toHaveLength(2);
    expect(rows[0].score).toBe(100);
    expect(rows[1].score).toBe(0);
    expect(rows.every((r) => r.loggedToday === true)).toBe(true);
  });

  it('uses profile meta for name/initials/pos and derives the trend from prevScore', () => {
    const meta = (id: string) =>
      id === 'a' ? { name: 'M. Cole', pos: 'LB', prevScore: 70 } : { name: 'Jordan', pos: 'WR', prevScore: 90 };
    const rows = mapLinkedDaysToRoster([day('a', { score: 80 }), day('b', { score: 80 })], meta);
    expect(rows[0]).toMatchObject({ name: 'M. Cole', initials: 'MC', pos: 'LB', dir: 'up' });
    expect(rows[1]).toMatchObject({ name: 'Jordan', initials: 'J', pos: 'WR', dir: 'down' });
  });

  it('falls back to a stable short-id label when no profile is known', () => {
    const rows = mapLinkedDaysToRoster([day('abcd1234-xyz', { score: 80 })]);
    expect(rows[0].name).toBe('#abcd');
    expect(rows[0].dir).toBe('flat'); // no prevScore
  });

  it('produces rows the Phase-5 filters + risk ranking consume unchanged', () => {
    const rows = mapLinkedDaysToRoster(
      [day('a', { score: 60, tasks: [{ done: false }, { done: false }] }), day('b', { score: 95 })],
      (id) => (id === 'a' ? { name: 'Low Guy', pos: 'LB' } : { name: 'Top Guy', pos: 'LB' }),
    );
    // all logged today -> notLogged filter empties
    expect(notLoggedCount(rows)).toBe(0);
    expect(filterRoster(rows, { query: 'top' })).toHaveLength(1);
    // worst-first ranking puts the low-compliance athlete ahead
    const ranked = rankByRisk(rows);
    expect(ranked[0].name).toBe('Low Guy');
  });
});
