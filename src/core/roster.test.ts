import { rosterGroups, filterRoster, notLoggedCount } from './roster';
import type { RosterRow } from './constants';

const mk = (name: string, pos: string, loggedToday?: boolean): RosterRow => ({
  name, initials: name.slice(0, 2).toUpperCase(), pos, comp: 80, score: 85, dir: 'flat', loggedToday,
});

const sample: RosterRow[] = [
  mk('Jihad', 'LB', true),
  mk('D. Brooks', 'LB', false),
  mk('K. Mensah', 'DB', true),
  mk('J. Park', 'DB', false),
  mk('B. Osei', 'DL', undefined),
];

describe('rosterGroups', () => {
  it('returns distinct positions in first-seen order', () => {
    expect(rosterGroups(sample)).toEqual(['LB', 'DB', 'DL']);
  });
  it('is empty for an empty roster', () => {
    expect(rosterGroups([])).toEqual([]);
  });
});

describe('filterRoster', () => {
  it('no filter returns everyone, order preserved', () => {
    expect(filterRoster(sample, {}).map((r) => r.name)).toEqual(sample.map((r) => r.name));
  });
  it('group filter keeps only that position', () => {
    expect(filterRoster(sample, { group: 'DB' }).map((r) => r.name)).toEqual(['K. Mensah', 'J. Park']);
  });
  it('null group means all', () => {
    expect(filterRoster(sample, { group: null })).toHaveLength(sample.length);
  });
  it('query matches name case-insensitively, anywhere', () => {
    expect(filterRoster(sample, { query: 'bro' }).map((r) => r.name)).toEqual(['D. Brooks']);
    expect(filterRoster(sample, { query: '  ' })).toHaveLength(sample.length);
  });
  it('notLoggedOnly keeps only loggedToday === false (undefined counts as logged)', () => {
    expect(filterRoster(sample, { notLoggedOnly: true }).map((r) => r.name)).toEqual(['D. Brooks', 'J. Park']);
  });
  it('combines group + search + notLogged', () => {
    expect(filterRoster(sample, { group: 'DB', notLoggedOnly: true, query: 'park' }).map((r) => r.name)).toEqual(['J. Park']);
  });
});

describe('notLoggedCount', () => {
  it('counts only explicit false', () => {
    expect(notLoggedCount(sample)).toBe(2);
  });
  it('is zero when all logged or unknown', () => {
    expect(notLoggedCount([mk('a', 'LB', true), mk('b', 'DB', undefined)])).toBe(0);
  });
});
