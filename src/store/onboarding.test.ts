// AthleteOS — store-level tests for the redesigned onboarding actions: the
// athlete baseline setters + primary goal, and the 7-role -> 4-dashboard routing
// (flowForRole / finishOb). AsyncStorage is mocked so the node env drives the
// real Zustand store.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useStore } from './useStore';
import { flowForRole, MIN_SIGNUP_AGE } from '@/core';
import type { Role } from '@/core';

beforeEach(() => {
  useStore.getState().resetDemo();
});

describe('athlete onboarding setters', () => {
  it('setPrimaryGoal stores the chosen goal (drives AI coaching)', () => {
    useStore.getState().setPrimaryGoal('gain_muscle');
    expect(useStore.getState().primaryGoal).toBe('gain_muscle');
  });

  it('setTrainingFreq stores the frequency', () => {
    useStore.getState().setTrainingFreq('twice');
    expect(useStore.getState().trainingFreq).toBe('twice');
  });

  it('the age stepper floors at the 13+ signup minimum (no under-13 -> out of COPPA scope)', () => {
    expect(MIN_SIGNUP_AGE).toBe(13);
    useStore.setState({ baseAge: MIN_SIGNUP_AGE });
    for (let i = 0; i < 12; i++) useStore.getState().ageStep(-1); // try to push well below
    expect(useStore.getState().baseAge).toBe(MIN_SIGNUP_AGE); // clamped, never under 13
  });

  it('the age stepper still ranges up through college age', () => {
    useStore.setState({ baseAge: MIN_SIGNUP_AGE });
    for (let i = 0; i < 20; i++) useStore.getState().ageStep(1);
    expect(useStore.getState().baseAge).toBe(24); // upper clamp unchanged
  });

  it('connectCoach stores the code (uppercased) and marks a coach connected, idempotently', () => {
    useStore.setState({ supportTeam: [], inviteCode: '' });
    useStore.getState().connectCoach('  eagles24 ');
    expect(useStore.getState().inviteCode).toBe('EAGLES24');
    expect(useStore.getState().supportTeam).toContain('coach');
    useStore.getState().connectCoach('eagles24'); // again -> no duplicate coach
    expect(useStore.getState().supportTeam.filter((x) => x === 'coach')).toHaveLength(1);
  });

  it('connectCoach ignores an empty code', () => {
    useStore.setState({ supportTeam: [], inviteCode: '' });
    useStore.getState().connectCoach('   ');
    expect(useStore.getState().supportTeam).toEqual([]);
    expect(useStore.getState().inviteCode).toBe('');
  });

  it('removeViewer drops the viewer from the local support circle (server revoke is gated to live)', () => {
    useStore.setState({ supportTeam: ['coach', 'parent'] });
    useStore.getState().removeViewer('coach');
    expect(useStore.getState().supportTeam).toEqual(['parent']);
  });

  it('setCachedRoster stores the roster + userId; sign-out purges it (no cross-user leak)', async () => {
    const roster = [{ name: 'A', initials: 'A', pos: 'LB', comp: 80, score: 85, dir: 'flat' as const }];
    useStore.getState().setCachedRoster(roster, 'u1');
    expect(useStore.getState().cachedRoster).toEqual(roster);
    expect(useStore.getState().cachedRosterUserId).toBe('u1');
    await useStore.getState().signOutLive();
    expect(useStore.getState().cachedRoster).toBeNull();
    expect(useStore.getState().cachedRosterUserId).toBeNull();
  });

  it('setBaseAnswer writes each baseline assessment answer', () => {
    const g = useStore.getState();
    g.setBaseAnswer('baseNutritionConfidence', 8);
    g.setBaseAnswer('baseProteinFreq', 3);
    g.setBaseAnswer('baseConsistency', 9);
    g.setBaseAnswer('baseMealsPerDay', 5);
    g.setBaseAnswer('baseWaterL', 3.5);
    g.setBaseAnswer('baseSleepH', 8.5);
    const s = useStore.getState();
    expect(s.baseNutritionConfidence).toBe(8);
    expect(s.baseProteinFreq).toBe(3);
    expect(s.baseConsistency).toBe(9);
    expect(s.baseMealsPerDay).toBe(5);
    expect(s.baseWaterL).toBe(3.5);
    expect(s.baseSleepH).toBe(8.5);
  });
});

describe('support team', () => {
  it('toggleSupport adds and removes a role', () => {
    useStore.getState().toggleSupport('coach');
    expect(useStore.getState().supportTeam).toEqual(['coach']);
    useStore.getState().toggleSupport('coach');
    expect(useStore.getState().supportTeam).toEqual([]);
  });

  it("'none' clears the whole support team (Just me for now)", () => {
    const g = useStore.getState();
    g.toggleSupport('coach');
    g.toggleSupport('parent');
    expect(useStore.getState().supportTeam).toEqual(['coach', 'parent']);
    g.toggleSupport('none');
    expect(useStore.getState().supportTeam).toEqual([]);
  });
});

describe('7-role -> 4-dashboard routing', () => {
  const cases: [Role, string][] = [
    ['athlete', 'app'],
    ['parent', 'parent'],
    ['personal_trainer', 'trainer'],
    ['nutritionist', 'trainer'],
    ['sports_perf_coach', 'coach'],
    ['hs_coach', 'coach'],
    ['college_coach', 'coach'],
  ];

  it('flowForRole maps every role to its dashboard archetype', () => {
    cases.forEach(([role, flow]) => expect(flowForRole(role)).toBe(flow));
  });

  it('finishOb routes each role onto the right flow', () => {
    cases.forEach(([role, flow]) => {
      useStore.getState().resetDemo();
      useStore.getState().setRole(role);
      useStore.getState().finishOb();
      expect(useStore.getState().flow).toBe(flow);
    });
  });

  it('finishOb lands the athlete on the home tab', () => {
    useStore.getState().setRole('athlete');
    useStore.getState().finishOb();
    expect(useStore.getState().flow).toBe('app');
    expect(useStore.getState().tab).toBe('home');
  });

  it('finishOb auto-assigns a solo executor a scoring profile from their goal (no coach to pick one)', () => {
    useStore.getState().resetDemo();
    useStore.setState({ role: 'athlete', scoringProfile: undefined, baseGoal: 'lose' });
    useStore.getState().finishOb();
    expect(useStore.getState().scoringProfile).toBe('general'); // lose/maintain -> general (calorie-led)

    useStore.getState().resetDemo();
    useStore.setState({ role: 'athlete', scoringProfile: undefined, baseGoal: 'gain' });
    useStore.getState().finishOb();
    expect(useStore.getState().scoringProfile).toBe('gain'); // build muscle -> surplus-led
  });

  it('finishOb never overrides a profile a coach already set', () => {
    useStore.getState().resetDemo();
    useStore.setState({ role: 'athlete', scoringProfile: 'athlete', baseGoal: 'lose' });
    useStore.getState().finishOb();
    expect(useStore.getState().scoringProfile).toBe('athlete'); // coach's pick wins
  });

  it('setPrimaryGoal maps the rich goal onto the scoring BaseGoal', () => {
    useStore.getState().resetDemo();
    useStore.getState().setPrimaryGoal('lose_fat');
    expect(useStore.getState().baseGoal).toBe('lose');
    useStore.getState().setPrimaryGoal('gain_muscle');
    expect(useStore.getState().baseGoal).toBe('gain');
  });

  it('the athlete activation path applies the goal profile + targets (the audit bug)', () => {
    useStore.getState().resetDemo();
    useStore.setState({ role: 'athlete', scoringProfile: undefined, baseWeight: 178 });
    useStore.getState().setPrimaryGoal('lose_fat'); // -> baseGoal 'lose'
    useStore.getState().startFirstMealChallenge();
    const s = useStore.getState();
    expect(s.scoringProfile).toBe('general'); // scored on calorie target, not the athlete formula
    expect(s.weightTarget).toBeLessThan(178); // a Lose Fat user no longer defaults to a weight GAIN
    expect(s.calTarget).toBeLessThan(3200); // a deficit, not the 3200 bulk
  });
});
