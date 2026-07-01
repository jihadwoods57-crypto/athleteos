import { clampTarget, goalPlanSummary, recommendTargets, SCORING_PROFILE_OPTIONS, TARGET_LIMITS } from './coachGoals';

describe('recommendTargets', () => {
  it('recommends higher protein for the athlete profile than general', () => {
    expect(recommendTargets('athlete').protein).toBeGreaterThan(recommendTargets('general').protein);
  });
  it('is deterministic', () => {
    expect(recommendTargets('general')).toEqual(recommendTargets('general'));
  });
});

describe('clampTarget', () => {
  it('clamps into the rendered/scoreable range and rounds', () => {
    expect(clampTarget('protein', 10)).toBe(TARGET_LIMITS.protein.min);
    expect(clampTarget('protein', 9999)).toBe(TARGET_LIMITS.protein.max);
    expect(clampTarget('calories', 2400.6)).toBe(2401);
  });
});

describe('SCORING_PROFILE_OPTIONS', () => {
  it('ships exactly the two profiles', () => {
    expect(SCORING_PROFILE_OPTIONS.map((o) => o.key)).toEqual(['athlete', 'general']);
  });
});

describe('goalPlanSummary', () => {
  it('names the athlete, the macros, and the scoring lens', () => {
    const s = goalPlanSummary('Dana', { protein: 180, calories: 3200, weight: 184 }, 'athlete');
    expect(s).toContain('Dana');
    expect(s).toContain('180g protein');
    expect(s).toContain('Athlete scoring');
  });
});
