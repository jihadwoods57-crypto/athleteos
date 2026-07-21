// Day-type resolution (0086 item.dayType + 0100 team_week_pattern). The overriding contract is
// PARITY: with no team pattern, or items that carry no dayType, resolution is a no-op and the
// scored day is byte-identical to before. These pure helpers are the whole surface of that risk.
// @ts-nocheck — untyped proto ESM engine, same pattern as firstDayActivation.test.ts.
import { dayTypeFor, filterItemsByDayType, stdFromItems } from '../../proto/redesign-2026-07/js/requirements.js';

// pattern indexed by getDay(): 0=Sun … 6=Sat.
const PATTERN = ['rest', 'training', 'training', 'rest', 'training', 'training', 'rest'];

describe('dayTypeFor', () => {
  it('reads the weekday slot from the pattern', () => {
    expect(dayTypeFor(PATTERN, 1)).toBe('training'); // Monday
    expect(dayTypeFor(PATTERN, 0)).toBe('rest');     // Sunday
  });
  it('accepts an ISO date and resolves its weekday', () => {
    expect(dayTypeFor(PATTERN, '2026-07-20')).toBe('training'); // 2026-07-20 is a Monday
    expect(dayTypeFor(PATTERN, '2026-07-19')).toBe('rest');     // Sunday
  });
  it('null / malformed / absent pattern is always "any" (no gating)', () => {
    expect(dayTypeFor(null, 1)).toBe('any');
    expect(dayTypeFor(['training'], 1)).toBe('any'); // wrong length
    expect(dayTypeFor(PATTERN, 'not-a-date')).toBe('any');
  });
});

describe('filterItemsByDayType', () => {
  const items = [
    { kind: 'meal', title: 'Breakfast' },                       // no dayType → always
    { kind: 'meal', title: 'Pre-lift', dayType: 'training' },
    { kind: 'meal', title: 'Light dinner', dayType: 'rest' },
    { kind: 'meal', title: 'Lunch', dayType: 'any' },
  ];
  it('keeps any/undefined items plus the ones matching the day type', () => {
    const t = filterItemsByDayType(items, 'training');
    expect(t.map((i) => i.title)).toEqual(['Breakfast', 'Pre-lift', 'Lunch']);
    const r = filterItemsByDayType(items, 'rest');
    expect(r.map((i) => i.title)).toEqual(['Breakfast', 'Light dinner', 'Lunch']);
  });
  it('PARITY: dayType "any" returns the exact same array (no gating)', () => {
    expect(filterItemsByDayType(items, 'any')).toBe(items);
  });
  it('PARITY: items with no dayType are never dropped', () => {
    const plain = [{ kind: 'meal' }, { kind: 'meal' }, { kind: 'meal' }, { kind: 'meal' }];
    expect(filterItemsByDayType(plain, 'training')).toEqual(plain);
    // and the standard built from them is unchanged (denominator 4)
    expect(stdFromItems(filterItemsByDayType(plain, 'training')).mealsRequired).toBe(4);
  });
});

describe('day-type changes the denominator only for a set that uses it', () => {
  const items = [
    { kind: 'meal' }, { kind: 'meal' }, { kind: 'meal' },
    { kind: 'meal', dayType: 'training' }, // a 4th meal only on training days
  ];
  it('training day → 4 required meals; rest day → 3', () => {
    expect(stdFromItems(filterItemsByDayType(items, 'training')).mealsRequired).toBe(4);
    expect(stdFromItems(filterItemsByDayType(items, 'rest')).mealsRequired).toBe(3);
  });
});
