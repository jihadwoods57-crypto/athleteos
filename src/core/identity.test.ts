// AthleteOS — identity helpers. The avatar monogram + you-row name derive from
// the live athleteName, so pin the name-parsing edge cases.
import { firstName, initials, monitoredAthlete } from './identity';

describe('initials', () => {
  it('takes first + last initial of a full name, uppercased', () => {
    expect(initials('Marcus Cole')).toBe('MC');
    expect(initials('jordan lee')).toBe('JL');
  });

  it('returns a single letter for a one-word name', () => {
    expect(initials('Jihad')).toBe('J');
  });

  it('uses the first + last of three or more names (skips the middle)', () => {
    expect(initials('Mary Jane Watson')).toBe('MW');
  });

  it('collapses extra whitespace', () => {
    expect(initials('  Jihad   Woods  ')).toBe('JW');
  });

  it('falls back when the name is blank or undefined', () => {
    expect(initials('', 'J')).toBe('J');
    expect(initials(undefined, 'J')).toBe('J');
    expect(initials('   ', 'J')).toBe('J');
  });

  it('defaults the fallback to "?" when none is given', () => {
    expect(initials('')).toBe('?');
  });
});

describe('firstName', () => {
  it('returns the first token of a multi-word name', () => {
    expect(firstName('Marcus Cole', 'X')).toBe('Marcus');
  });

  it('returns the whole single-word name', () => {
    expect(firstName('Jihad', 'X')).toBe('Jihad');
  });

  it('falls back when the name is blank or undefined', () => {
    expect(firstName('', 'Jihad')).toBe('Jihad');
    expect(firstName(undefined, 'Jihad')).toBe('Jihad');
    expect(firstName('   ', 'Jihad')).toBe('Jihad');
  });
});

describe('monitoredAthlete', () => {
  it('uses the child name a real parent entered (name, first, monogram)', () => {
    const m = monitoredAthlete('Jordan Reyes');
    expect(m.name).toBe('Jordan Reyes');
    expect(m.first).toBe('Jordan');
    expect(m.monogram).toBe('JR');
    expect(m.isDemo).toBe(false);
  });

  it('falls back to the seeded demo athlete when the name is blank', () => {
    for (const blank of ['', '   ', undefined, [], 0]) {
      const m = monitoredAthlete(blank);
      expect(m.name).toBe('Jihad');
      expect(m.first).toBe('Jihad');
      expect(m.monogram).toBe('J');
      expect(m.isDemo).toBe(true);
    }
  });

  it('trims a single-word name and is not flagged as demo', () => {
    const m = monitoredAthlete('  Sam  ');
    expect(m.name).toBe('Sam');
    expect(m.monogram).toBe('S');
    expect(m.isDemo).toBe(false);
  });
});
