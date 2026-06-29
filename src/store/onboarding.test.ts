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
});
