// AthleteOS — store-level tests for the overseer Nudge action (coach / trainer /
// nutritionist). The nudge is the only overseer action this phase: deterministic,
// offline, idempotent, and never moves an athlete's score. AsyncStorage is mocked
// so the node env can drive the real Zustand store.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useStore } from './useStore';
import { computeDerived } from '@/core';

const derived = () => computeDerived(useStore.getState());

beforeEach(() => {
  useStore.getState().resetDemo();
});

describe('sendNudge', () => {
  it('starts with no one nudged', () => {
    expect(useStore.getState().nudged).toEqual([]);
  });

  it('records an at-risk athlete as nudged', () => {
    useStore.getState().sendNudge('Andre Silva');
    expect(useStore.getState().nudged).toEqual(['Andre Silva']);
  });

  it('is idempotent — nudging the same athlete twice keeps one entry', () => {
    useStore.getState().sendNudge('Marcus Cole');
    useStore.getState().sendNudge('Marcus Cole');
    expect(useStore.getState().nudged).toEqual(['Marcus Cole']);
  });

  it('tracks multiple distinct athletes in order', () => {
    useStore.getState().sendNudge('Andre Silva');
    useStore.getState().sendNudge('Marcus Cole');
    expect(useStore.getState().nudged).toEqual(['Andre Silva', 'Marcus Cole']);
  });

  it('does not move the athlete score (it is an overseer-only action)', () => {
    const before = derived().athleteScore;
    useStore.getState().sendNudge('Andre Silva');
    expect(derived().athleteScore).toBe(before);
  });
});
