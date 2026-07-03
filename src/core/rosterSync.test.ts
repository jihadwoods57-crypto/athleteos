// OnStandard — Stage D projection: real `days` rows -> coach RosterRow[]. Proves the
// mapping is honest and total (score clamped, compliance from tasks, loggedToday true
// for every fetched row, name/initials/trend from the provided profile meta) and that
// the Phase-5 filters + risk ranking run unchanged on the projected rows.
import {
  buildLiveRoster,
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

describe('buildLiveRoster — membership ∪ day rows: the accountability read', () => {
  const members = [
    { athlete_id: 'a', athlete_name: 'Marcus Cole', position: 'LB' },
    { athlete_id: 'b', athlete_name: 'Jordan Reed', position: 'WR' },
    { athlete_id: 'c', athlete_name: null, position: null },
  ];

  it('every active member appears — the SILENT athlete shows as not logged, not absent', () => {
    const rows = buildLiveRoster(members, [day('a', { score: 84 })], []);
    expect(rows).toHaveLength(3);
    const byId = Object.fromEntries(rows.map((r) => [r.athleteId, r]));
    expect(byId.a).toMatchObject({ name: 'Marcus Cole', loggedToday: true, score: 84 });
    expect(byId.b).toMatchObject({ name: 'Jordan Reed', pos: 'WR', loggedToday: false, score: 0, comp: 0 });
    expect(byId.b.initials).toBe('JR');
  });

  it('derives the trend from yesterday’s day row for the same athlete', () => {
    const rows = buildLiveRoster(members, [day('a', { score: 84 }), day('b', { score: 60 })], [day('a', { score: 70 }), day('b', { score: 90 })]);
    const byId = Object.fromEntries(rows.map((r) => [r.athleteId, r]));
    expect(byId.a.dir).toBe('up');
    expect(byId.b.dir).toBe('down');
    expect(byId.c.dir).toBe('flat'); // no data either day
  });

  it('a day row from a non-member link still appears (uuid fallback), so no linked athlete is dropped', () => {
    const rows = buildLiveRoster(members, [day('d4f2aaaa-0000-0000-0000-000000000000', { score: 77 })], []);
    expect(rows).toHaveLength(4);
    const extra = rows.find((r) => r.athleteId === 'd4f2aaaa-0000-0000-0000-000000000000');
    expect(extra).toMatchObject({ loggedToday: true, score: 77 });
  });

  it('a null profile name falls back to the short id, never an empty string', () => {
    const rows = buildLiveRoster(members, [], []);
    const c = rows.find((r) => r.athleteId === 'c');
    expect(c?.name).toBe('#c');
  });

  it('an empty membership with day rows behaves like the old projection (nothing lost)', () => {
    const rows = buildLiveRoster([], [day('a', { score: 82 })], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ loggedToday: true, score: 82 });
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
