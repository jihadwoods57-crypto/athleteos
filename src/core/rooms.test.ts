// Position rooms pure helpers (T-04 slice 1): key slug + roster-derived suggestions.
// @ts-nocheck — untyped proto ESM engine, firstDayActivation.test.ts pattern.
import { slugifyRoomKey, suggestedRooms } from '../../proto/redesign-2026-07/js/rooms.js';

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
