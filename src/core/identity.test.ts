// AthleteOS — identity helpers. The avatar monogram + you-row name derive from
// the live athleteName, so pin the name-parsing edge cases.
import { coachTeamTitle, firstName, initials, monitoredAthlete, trainerOrgTitle } from './identity';

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

describe('coachTeamTitle', () => {
  it('keeps the seeded demo showcase title', () => {
    expect(coachTeamTitle({ isReal: false, sport: 'Football', school: 'Lincoln' })).toBe('Linebackers · Varsity');
  });

  it('prefers a real coach\'s school, then sport', () => {
    expect(coachTeamTitle({ isReal: true, sport: 'Football', school: 'Lincoln High' })).toBe('Lincoln High');
    expect(coachTeamTitle({ isReal: true, sport: 'Soccer', school: '' })).toBe('Soccer');
  });

  it('falls back to a neutral title and tolerates non-string meta', () => {
    expect(coachTeamTitle({ isReal: true })).toBe('Your Team');
    expect(coachTeamTitle({ isReal: true, sport: ['x'], school: 0 })).toBe('Your Team');
  });

  it('never leaks the demo team to a real coach', () => {
    expect(coachTeamTitle({ isReal: true, sport: 'Lacrosse' })).not.toContain('Linebackers');
  });
});

describe('trainerOrgTitle', () => {
  it('keeps the seeded demo gym, gives a real trainer a neutral practice label', () => {
    expect(trainerOrgTitle(false)).toBe('Apex Performance');
    expect(trainerOrgTitle(true)).toBe('Your Practice');
  });
});
