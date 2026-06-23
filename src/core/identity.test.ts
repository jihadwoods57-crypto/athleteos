// AthleteOS — identity helpers. The avatar monogram + you-row name derive from
// the live athleteName, so pin the name-parsing edge cases.
import { firstName, initials } from './identity';

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
