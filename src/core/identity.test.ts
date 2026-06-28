// AthleteOS — identity helpers. The avatar monogram + you-row name derive from
// the live athleteName, so pin the name-parsing edge cases.
import { accountIdentity, coachTeamTitle, firstName, initials, monitoredAthlete, trainerLens, trainerOrgTitle } from './identity';

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
    expect(coachTeamTitle({ isReal: false, sport: 'Football', school: 'Lincoln' })).toBe('Defense · Varsity');
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

describe('trainerLens — a nutritionist rides the trainer dash through a nutrition lens', () => {
  it('a personal trainer keeps the generic book framing', () => {
    const real = trainerLens('personal_trainer', true);
    expect(real.orgTitle).toBe('Your Practice');
    expect(real.headerTitle).toBe('Your Clients');
    expect(real.complianceTitle).toBe('Book Compliance');
    expect(real.allClearLine).toContain('above the line');
  });

  it('the seeded-demo trainer keeps the showcase gym', () => {
    expect(trainerLens('personal_trainer', false).orgTitle).toBe('Apex Performance');
    expect(trainerLens(null, false).headerTitle).toBe('Your Clients');
  });

  it('reflects a non-athlete clientType in the header (non-athlete book is first-class)', () => {
    expect(trainerLens('personal_trainer', true, 'weight_loss').headerTitle).toBe('Your Weight-Loss Clients');
    expect(trainerLens('personal_trainer', true, 'muscle_gain').headerTitle).toBe('Your Muscle-Gain Clients');
    expect(trainerLens('personal_trainer', true, 'general').headerTitle).toBe('Your Fitness Clients');
    // a non-athlete book gets an "on plan" empty state, not the athlete-coded "above the line"
    expect(trainerLens('personal_trainer', true, 'weight_loss').allClearLine).toContain('on plan');
  });

  it('an athlete/hybrid/blank/unknown clientType keeps the neutral book framing', () => {
    for (const ct of ['athletes', 'hybrid', '', undefined, 'nonsense', 42]) {
      expect(trainerLens('personal_trainer', true, ct).headerTitle).toBe('Your Clients');
    }
  });

  it('clientType never overrides the nutritionist lens', () => {
    expect(trainerLens('nutritionist', true, 'weight_loss').headerTitle).toBe('Your Nutrition Clients');
  });

  it('a nutritionist gets a nutrition-lensed header, org, compliance card, and empty state', () => {
    const real = trainerLens('nutritionist', true);
    expect(real.orgTitle).toBe('Your Nutrition Practice');
    expect(real.headerTitle).toBe('Your Nutrition Clients');
    expect(real.complianceTitle).toBe('Nutrition Compliance');
    expect(real.allClearLine).toContain('nutrition targets');
  });

  it('the seeded-demo nutritionist keeps a showcase nutrition practice', () => {
    expect(trainerLens('nutritionist', false).orgTitle).toBe('Apex Nutrition');
  });

  it('contains no em dashes in any lensed copy', () => {
    for (const role of ['personal_trainer', 'nutritionist'] as const) {
      for (const isReal of [true, false]) {
        const l = trainerLens(role, isReal);
        for (const v of [l.orgTitle, l.headerTitle, l.complianceTitle, l.allClearLine]) {
          expect(v).not.toMatch(/—/);
        }
      }
    }
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

describe('accountIdentity buckets the stored ONBOARDING role (regression)', () => {
  // Bug: callers pass s.role ('hs_coach'/'personal_trainer'/…), but the switch only
  // matched flow words ('coach'/'trainer'), so every real coach/trainer fell through
  // to the athlete identity. Bucket the onboarding role first.
  it('maps real coach roles to the coach identity (real + demo)', () => {
    for (const r of ['hs_coach', 'sports_perf_coach', 'college_coach']) {
      expect(accountIdentity({ role: r, athleteName: 'Sam Reyes', obMeta: { school: 'North HS' } }))
        .toEqual({ name: 'Sam Reyes', role: 'Coach · North HS', initials: 'SR' });
      // demo showcase (no name) now resolves to the coach, not Jihad the athlete
      expect(accountIdentity({ role: r }).name).toBe('Coach Davis');
    }
  });
  it('maps real trainer roles to the trainer identity', () => {
    for (const r of ['personal_trainer', 'nutritionist']) {
      expect(accountIdentity({ role: r, athleteName: 'Maya Lopez' }).role).toBe('Trainer · Your Practice');
      expect(accountIdentity({ role: r }).name).toBe('Maya Anders');
    }
  });
  it('still handles parent + athlete (and already-bucketed inputs)', () => {
    expect(accountIdentity({ role: 'parent', athleteName: 'Sarah' }).role).toContain('Parent');
    expect(accountIdentity({ role: 'athlete', athleteName: 'Jordan', sport: 'Track' }).role).toBe('Athlete · Track');
    expect(accountIdentity({ role: 'coach', athleteName: 'Dana', obMeta: { school: 'X HS' } }).role).toBe('Coach · X HS');
  });
});

describe('orgName (OverseerProfile self-edit) wins over onboarding context', () => {
  it('coachTeamTitle prefers an edited org name over school/sport', () => {
    expect(coachTeamTitle({ isReal: true, school: 'Eastside HS', sport: 'Football', orgName: 'Apex Academy' })).toBe('Apex Academy');
    expect(coachTeamTitle({ isReal: true, school: 'Eastside HS' })).toBe('Eastside HS');
    expect(coachTeamTitle({ isReal: false, orgName: 'Apex Academy' })).toBe('Defense · Varsity');
  });

  it('trainerLens orgTitle prefers an edited practice name', () => {
    expect(trainerLens('personal_trainer', true, undefined, 'My Gym').orgTitle).toBe('My Gym');
    expect(trainerLens('nutritionist', true, undefined, 'Fuel Co').orgTitle).toBe('Fuel Co');
    expect(trainerLens('personal_trainer', true).orgTitle).toBe('Your Practice');
  });

  it('accountIdentity role line uses the edited org for coach + trainer', () => {
    expect(accountIdentity({ role: 'coach', athleteName: 'Dana Cole', orgName: 'Apex Academy' }).role).toBe('Coach · Apex Academy');
    expect(accountIdentity({ role: 'trainer', athleteName: 'Maya Lopez', orgName: 'My Gym' }).role).toBe('Trainer · My Gym');
  });
});
