// OnStandard — pure tests for the Profile identity helpers that retire the
// hard-coded "Eastside HS" / "Coach Davis" leaks. A real athlete's subtitle and
// visibility circle derive from their own onboarding answers; the seeded demo
// (no sport / no support team) keeps its showcase identity.
import { athleteSubtitle, supportVisibilityRows } from './content';

describe('athleteSubtitle — derives from the real sport, not a hard-coded school', () => {
  it('uses the chosen sport and position for a real athlete', () => {
    expect(athleteSubtitle('PG', 'Basketball')).toBe('Point Guard · Basketball');
    expect(athleteSubtitle('LB', 'Football')).toBe('Linebacker · Football');
  });

  it('leads with the sport when position was skipped', () => {
    expect(athleteSubtitle(null, 'Soccer')).toBe('Soccer athlete');
  });

  it('falls back to the seeded-demo identity when no sport is set', () => {
    expect(athleteSubtitle(null)).toBe('Linebacker · Eastside HS');
    expect(athleteSubtitle('QB')).toBe('Quarterback · Eastside HS');
  });

  it('expands position codes per-sport so a baseball catcher is not a "Center"', () => {
    // "C" is a Catcher in baseball but a Center in basketball/hockey - the label
    // must follow the sport, never a global abbreviation.
    expect(athleteSubtitle('C', 'Baseball')).toBe('Catcher · Baseball');
    expect(athleteSubtitle('C', 'Basketball')).toBe('Center · Basketball');
    expect(athleteSubtitle('C', 'Hockey')).toBe('Center · Hockey');
  });

  it('expands every onboarding position code for each sport (no raw abbreviation leaks)', () => {
    expect(athleteSubtitle('TE', 'Football')).toBe('Tight End · Football');
    expect(athleteSubtitle('GK', 'Soccer')).toBe('Goalkeeper · Soccer');
    expect(athleteSubtitle('OH', 'Volleyball')).toBe('Outside Hitter · Volleyball');
    expect(athleteSubtitle('S', 'Volleyball')).toBe('Setter · Volleyball');
    expect(athleteSubtitle('P', 'Baseball')).toBe('Pitcher · Baseball');
    expect(athleteSubtitle('G', 'Hockey')).toBe('Goaltender · Hockey');
  });

  it('passes an unrecognized code through verbatim rather than mislabeling it', () => {
    expect(athleteSubtitle('ZZ', 'Soccer')).toBe('ZZ · Soccer');
    // Track & Field / Wrestling codes are already readable words - kept verbatim.
    expect(athleteSubtitle('Sprints', 'Track & Field')).toBe('Sprints · Track & Field');
  });
});

describe('supportVisibilityRows — derives the accountability circle from supportTeam', () => {
  it('maps each chosen support role to a row', () => {
    const rows = supportVisibilityRows(['coach', 'parent']);
    expect(rows.map((r) => r.key)).toEqual(['coach', 'parent']);
    expect(rows[0].title).toBe('Your coach');
    expect(rows[1].title).toBe('Parent / guardian');
  });

  it('is empty for a solo athlete (intentional empty state, no demo leak)', () => {
    expect(supportVisibilityRows([])).toEqual([]);
  });

  it('ignores unknown keys', () => {
    expect(supportVisibilityRows(['coach', 'bogus'])).toHaveLength(1);
  });
});
