// Position rooms pure helpers (T-04 slice 1): key slug + roster-derived suggestions.
// @ts-nocheck — untyped proto ESM engine, firstDayActivation.test.ts pattern.
import { slugifyRoomKey, suggestedRooms, effectiveRoomLabel, groupRosterByRoom } from '../../proto/redesign-2026-07/js/rooms.js';

describe('slugifyRoomKey', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugifyRoomKey('Defensive Backs')).toBe('defensive-backs');
    expect(slugifyRoomKey('O-Line')).toBe('o-line');
    expect(slugifyRoomKey('  Wide   Receivers  ')).toBe('wide-receivers');
  });
  it('empty / symbol-only label yields empty', () => {
    expect(slugifyRoomKey('')).toBe('');
    expect(slugifyRoomKey('!!!')).toBe('');
  });
});

describe('suggestedRooms', () => {
  it('suggests distinct roster positions that have no room yet', () => {
    const s = suggestedRooms(['WR', 'DB', 'WR', 'LB'], [{ key: 'db' }]);
    expect(s).toEqual([{ key: 'lb', label: 'LB' }, { key: 'wr', label: 'WR' }]); // sorted, DB filtered out
  });
  it('ignores blank positions', () => {
    expect(suggestedRooms(['', '  ', 'QB'], [])).toEqual([{ key: 'qb', label: 'QB' }]);
  });
  it('handles empty inputs', () => {
    expect(suggestedRooms(null, null)).toEqual([]);
    expect(suggestedRooms([], [])).toEqual([]);
  });
});

describe('effectiveRoomLabel', () => {
  const rooms = [{ id: 'r1', key: 'db', label: 'DB' }, { id: 'r2', key: 'wr', label: 'WR' }];
  it('returns the assigned room label', () => {
    expect(effectiveRoomLabel('r2', rooms)).toBe('WR');
  });
  it('PARITY: unassigned (null room) returns null → caller uses raw position', () => {
    expect(effectiveRoomLabel(null, rooms)).toBeNull();
    expect(effectiveRoomLabel(undefined, rooms)).toBeNull();
  });
  it('unknown room id or missing rooms returns null', () => {
    expect(effectiveRoomLabel('nope', rooms)).toBeNull();
    expect(effectiveRoomLabel('r1', null)).toBeNull();
  });
});

describe('groupRosterByRoom', () => {
  const rooms = [{ id: 'r1', label: 'DB' }, { id: 'r2', label: 'WR' }];
  const rows = [
    { athleteId: 'a', roomId: 'r1' },
    { athleteId: 'b', roomId: 'r2' },
    { athleteId: 'c', roomId: null },      // unassigned
    { athleteId: 'd', roomId: 'gone' },    // room was deleted
  ];
  it('buckets assigned athletes and queues the rest for assignment', () => {
    const { byRoom, needs } = groupRosterByRoom(rows, rooms);
    expect(byRoom.get('r1').map((r) => r.athleteId)).toEqual(['a']);
    expect(byRoom.get('r2').map((r) => r.athleteId)).toEqual(['b']);
    // unassigned AND pointing-at-a-deleted-room both need assignment
    expect(needs.map((r) => r.athleteId).sort()).toEqual(['c', 'd']);
  });
  it('handles empty inputs', () => {
    const { byRoom, needs } = groupRosterByRoom([], rooms);
    expect(byRoom.size).toBe(0);
    expect(needs).toEqual([]);
  });
});
