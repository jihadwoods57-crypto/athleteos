// OnStandard — goal mapping. Proves the rich onboarding goal maps to the scoring BaseGoal, that daily
// targets derive from goal + bodyweight (a Lose Fat user gets a deficit + a weight target BELOW current,
// not the athlete bulk), that performance keeps the shipped constants byte-for-byte, and that a coach's
// profile is never overridden.
import { baseGoalForPrimary, deriveTargetsFromGoal, goalConfig } from './goalMapping';
import { CAL_TARGET, PROTEIN_TARGET, WEIGHT_TARGET } from './constants';

describe('baseGoalForPrimary', () => {
  it('maps body-composition goals by intent', () => {
    expect(baseGoalForPrimary('lose_fat')).toBe('lose');
    expect(baseGoalForPrimary('gain_weight')).toBe('gain');
    expect(baseGoalForPrimary('gain_muscle')).toBe('gain');
    expect(baseGoalForPrimary('maintain')).toBe('maintain');
  });
  it('maps performance + athletic-development + unknown to performance', () => {
    expect(baseGoalForPrimary('get_faster')).toBe('performance');
    expect(baseGoalForPrimary('scholarship')).toBe('performance');
    expect(baseGoalForPrimary('next_level')).toBe('performance');
    expect(baseGoalForPrimary(null)).toBe('performance');
    expect(baseGoalForPrimary('something_new')).toBe('performance');
  });
});

describe('deriveTargetsFromGoal', () => {
  it('a Lose Fat user gets a deficit + a weight target BELOW current (the board bug)', () => {
    const t = deriveTargetsFromGoal('lose', 178);
    expect(t.weightTarget).toBeLessThan(178); // never defaults a fat-loss user to a gain
    expect(t.calTarget).toBeLessThan(CAL_TARGET); // a deficit, not the 3200 bulk
    expect(t.proteinTarget).toBeGreaterThan(120); // protein stays high to protect muscle
  });
  it('a gain user gets a surplus + a weight target ABOVE current', () => {
    const t = deriveTargetsFromGoal('gain', 178);
    expect(t.weightTarget).toBeGreaterThan(178);
    expect(t.calTarget).toBeGreaterThan(deriveTargetsFromGoal('maintain', 178).calTarget);
  });
  it('maintain targets the current weight', () => {
    expect(deriveTargetsFromGoal('maintain', 178).weightTarget).toBe(178);
  });
  it('performance keeps the shipped athlete constants byte-for-byte', () => {
    expect(deriveTargetsFromGoal('performance', 178)).toEqual({
      proteinTarget: PROTEIN_TARGET,
      calTarget: CAL_TARGET,
      weightTarget: WEIGHT_TARGET,
    });
  });
  it('falls back to the start anchor for a non-positive bodyweight (no NaN/0 targets)', () => {
    const t = deriveTargetsFromGoal('lose', 0);
    expect(Number.isFinite(t.calTarget)).toBe(true);
    expect(t.calTarget).toBeGreaterThan(0);
  });

  it('NEVER prescribes a dangerously low target to a low-bodyweight user (safety floor)', () => {
    // The weight stepper floors at 70 lb and the app signs up 13+; bw*12 would be 840 without a floor.
    const t = deriveTargetsFromGoal('lose', 90);
    expect(t.calTarget).toBeGreaterThanOrEqual(1500);
    expect(t.proteinTarget).toBeGreaterThanOrEqual(80);
    expect(deriveTargetsFromGoal('maintain', 80).calTarget).toBeGreaterThanOrEqual(1500);
  });
});

describe('goalConfig', () => {
  it('bundles the goal scoring profile + targets', () => {
    const c = goalConfig('lose', 178);
    expect(c.scoringProfile).toBe('general'); // lose -> calorie-target scoring
    expect(c.weightTarget).toBeLessThan(178);
  });
  it('never overrides a coach-set profile, but still derives targets', () => {
    const c = goalConfig('lose', 178, 'athlete');
    expect(c.scoringProfile).toBe('athlete'); // coach's pick wins
    expect(c.calTarget).toBeLessThan(CAL_TARGET); // targets still goal-derived
  });
  it('preserves a target the user already edited off the default, but fills the untouched ones', () => {
    const c = goalConfig('lose', 178, undefined, { weightTarget: 170, calTarget: CAL_TARGET, proteinTarget: PROTEIN_TARGET });
    expect(c.weightTarget).toBe(170); // user moved it off the default -> kept
    expect(c.calTarget).toBeLessThan(CAL_TARGET); // still at default -> goal-derived
  });
});
