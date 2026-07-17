// Coach OS shared data cache (coach-data.js) + the status.js schedule fix (C1): off-schedule
// requirements must never read as overdue. scopeFilter is pure over rows; CD.extras is a plain
// writable property (not an accessor) so group scope is testable without the async roster fetch.
// @ts-ignore
import { CD, scopeFilter } from '../../proto/redesign-2026-07/js/coach-data.js';
// @ts-ignore
import { runsOn, athleteStatus } from '../../proto/redesign-2026-07/js/status.js';

const rows = [
  { athleteId: 'a1', name: 'Devin Cole', position: 'LB' },
  { athleteId: 'a2', name: 'Sam Ortiz', position: 'wr' },
  { athleteId: 'a3', name: 'Jae Park', position: 'LB' },
];

describe('scopeFilter', () => {
  test('team scope returns every row untouched', () => {
    expect(scopeFilter(rows, { kind: 'team', value: null })).toEqual(rows);
    expect(scopeFilter(rows, null)).toEqual(rows); // no scope at all -> team behavior
  });

  test('position scope matches case-insensitively', () => {
    expect(scopeFilter(rows, { kind: 'position', value: 'lb' }).map((r: any) => r.athleteId)).toEqual(['a1', 'a3']);
    expect(scopeFilter(rows, { kind: 'position', value: 'WR' }).map((r: any) => r.athleteId)).toEqual(['a2']);
  });

  test('athlete scope is an exact single-row match', () => {
    expect(scopeFilter(rows, { kind: 'athlete', value: 'a2' })).toEqual([rows[1]]);
  });

  test('group scope reads CD.extras.groups (a plain writable property, no async fetch needed)', () => {
    // coach-data.js infers CD.extras' exported type from its `null` initializer (checkJs is off
    // for proto/*.js, so TS never sees the later `CD.extras = {...}` assignments inside the
    // module) — cast to bypass that narrow inferred type, same as the module's own runtime shape.
    (CD as any).extras = { groups: [{ id: 'g1', name: 'Skill', athlete_ids: ['a1', 'a2'] }] };
    expect(scopeFilter(rows, { kind: 'group', value: 'g1' }).map((r: any) => r.athleteId)).toEqual(['a1', 'a2']);
    // Unknown group id -> honest empty, never the whole roster.
    expect(scopeFilter(rows, { kind: 'group', value: 'nope' })).toEqual([]);
    (CD as any).extras = null;
  });
});

describe('status.js runsOn — pure mirror of requirements.js runsToday (C1)', () => {
  test('no freq / daily req runs every day', () => {
    expect(runsOn({}, 0)).toBe(true);
    expect(runsOn({ freq: { type: 'daily' } }, 4)).toBe(true);
  });

  test('days:[1,3,5] (Mon/Wed/Fri) runs true on Monday, false on Thursday', () => {
    const weigh = { freq: { type: 'days', days: [1, 3, 5] } };
    expect(runsOn(weigh, 1)).toBe(true);   // Monday
    expect(runsOn(weigh, 3)).toBe(true);   // Wednesday
    expect(runsOn(weigh, 5)).toBe(true);   // Friday
    expect(runsOn(weigh, 4)).toBe(false);  // Thursday — the C1 bug day
    expect(runsOn(weigh, 2)).toBe(false);  // Tuesday
  });

  test('weekly check-in (day: 0) runs only on Sunday', () => {
    const weekly = { freq: { type: 'weekly', day: 0 } };
    expect(runsOn(weekly, 0)).toBe(true);
    expect(runsOn(weekly, 1)).toBe(false);
    expect(runsOn(weekly, 6)).toBe(false);
  });
});

describe('athleteStatus off-day honesty (C1)', () => {
  const weighReq = [{ id: 'weight', title: 'Morning Weight', required: true, proof: 'scale', window: { due: 9 * 60 }, freq: { type: 'days', days: [1, 3, 5] } }];
  const row = { athleteId: 'a1', name: 'Devin', score: null, loggedToday: false, tasks: [], lastMealAt: null, scoreHistory: [] };

  test('undone MWF weight item on a Thursday (dow=4), well past 9am, is NOT overdue', () => {
    const s = athleteStatus({ nowMin: 20 * 60, row, reqs: weighReq, excused: false, nowDow: 4 });
    expect(s.key).not.toBe('overdue');
    expect(s.openItems).toEqual([]); // off-schedule -> not even an open item, no phantom card
  });

  test('same input on a Monday (dow=1) past the 9am due time IS overdue', () => {
    const s = athleteStatus({ nowMin: 20 * 60, row, reqs: weighReq, excused: false, nowDow: 1 });
    expect(s.key).toBe('overdue');
    expect(s.detail).toMatch(/Morning Weight/i);
  });

  test('nowDow omitted keeps the old (pre-schedule) behavior for backward test compat', () => {
    const s = athleteStatus({ nowMin: 20 * 60, row, reqs: weighReq, excused: false });
    expect(s.key).toBe('overdue'); // no nowDow -> every required item still gates purely on time
  });
});
