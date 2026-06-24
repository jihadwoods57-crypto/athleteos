// AthleteOS — identity helpers. The avatar monogram + you-row name derive from
// the live athleteName, so pin the name-parsing edge cases.
import { accountIdentity, coachTeamTitle, firstName, initials, monitoredAthlete, trainerOrgTitle } from './identity';

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

describe('accountIdentity', () => {
  it('keeps the seeded demo showcase per role when no name is set', () => {
    expect(accountIdentity({ role: 'coach', athleteName: '' })).toEqual({ name: 'Coach Davis', role: 'Head Coach · Eastside HS', initials: 'CD' });
    expect(accountIdentity({ role: 'parent', athleteName: '' })).toEqual({ name: 'Sarah Carter', role: 'Parent · linked to Jihad', initials: 'SC' });
    expect(accountIdentity({ role: 'trainer', athleteName: '' })).toEqual({ name: 'Maya Anders', role: 'Trainer · Apex Performance', initials: 'MA' });
    expect(accountIdentity({ role: 'athlete', athleteName: '' })).toEqual({ name: 'Jihad Carter', role: 'Athlete · Eastside HS', initials: 'JC' });
    // An unknown/blank role still lands on the athlete showcase, never empty.
    expect(accountIdentity({ role: '', athleteName: '   ' }).name).toBe('Jihad Carter');
  });

  it('derives a real coach from their own name + school/sport, never the demo', () => {
    const a = accountIdentity({ role: 'coach', athleteName: 'Dana Cole', obMeta: { school: 'Lincoln High', sport: 'Football' } });
    expect(a).toEqual({ name: 'Dana Cole', role: 'Coach · Lincoln High', initials: 'DC' });
    // School wins; sport is the fallback; neither leaks "Eastside" / "Davis".
    expect(accountIdentity({ role: 'coach', athleteName: 'Dana Cole', obMeta: { sport: 'Soccer' } }).role).toBe('Coach · Soccer');
    expect(accountIdentity({ role: 'coach', athleteName: 'Dana Cole' }).role).toBe('Coach');
    expect(accountIdentity({ role: 'coach', athleteName: 'Dana Cole', obMeta: { school: 'X' } }).name).not.toBe('Coach Davis');
  });

  it('derives a real parent linked to the child they entered', () => {
    expect(accountIdentity({ role: 'parent', athleteName: 'Pat Reyes', obMeta: { athleteName: 'Jordan Reyes' } }))
      .toEqual({ name: 'Pat Reyes', role: 'Parent · linked to Jordan', initials: 'PR' });
    // No child captured falls back to the monitoredAthlete default first name.
    expect(accountIdentity({ role: 'parent', athleteName: 'Pat Reyes' }).role).toBe('Parent · linked to Jihad');
  });

  it('gives a real trainer a neutral practice label (no business name is captured)', () => {
    expect(accountIdentity({ role: 'trainer', athleteName: 'Maya Lopez' }))
      .toEqual({ name: 'Maya Lopez', role: 'Trainer · Your Practice', initials: 'ML' });
  });

  it('derives a real athlete from their name + sport, falling back to just "Athlete"', () => {
    expect(accountIdentity({ role: 'athlete', athleteName: 'Marcus Cole', sport: 'Basketball' }))
      .toEqual({ name: 'Marcus Cole', role: 'Athlete · Basketball', initials: 'MC' });
    expect(accountIdentity({ role: 'athlete', athleteName: 'Marcus Cole' }).role).toBe('Athlete');
    // The app-flow athlete may arrive with role undefined; still their own identity.
    expect(accountIdentity({ athleteName: 'Marcus Cole', sport: 'Track' }))
      .toEqual({ name: 'Marcus Cole', role: 'Athlete · Track', initials: 'MC' });
  });

  it('tolerates non-string meta without leaking the demo', () => {
    const a = accountIdentity({ role: 'coach', athleteName: 'Dana Cole', sport: ['x'], obMeta: { school: 0, sport: ['y'] } });
    expect(a).toEqual({ name: 'Dana Cole', role: 'Coach', initials: 'DC' });
  });
});
