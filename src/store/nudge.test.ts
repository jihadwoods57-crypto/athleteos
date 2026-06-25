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

describe('nudge acknowledgement log', () => {
  it('starts with an empty log', () => {
    expect(useStore.getState().nudgeLog).toEqual([]);
  });

  it('records the athlete baseline (compliance + score) at send-time', () => {
    useStore.getState().sendNudge('Andre Silva', { score: 71, comp: 64 });
    const log = useStore.getState().nudgeLog;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ name: 'Andre Silva', comp: 64, score: 71 });
    // Stamped with the current day so it is read as "since you nudged today".
    expect(log[0].day).toBe(useStore.getState().dateStamp);
  });

  it('defaults the baseline to 0 when none is supplied (back-compat)', () => {
    useStore.getState().sendNudge('Marcus Cole');
    expect(useStore.getState().nudgeLog[0]).toMatchObject({ comp: 0, score: 0 });
  });

  it('is idempotent — a repeat nudge does not double-log', () => {
    useStore.getState().sendNudge('Andre Silva', { score: 71, comp: 64 });
    useStore.getState().sendNudge('Andre Silva', { score: 99, comp: 99 });
    const log = useStore.getState().nudgeLog;
    expect(log).toHaveLength(1);
    expect(log[0].comp).toBe(64); // the first baseline is preserved
  });

  it('stays in lockstep with the day-scoped nudged flag', () => {
    useStore.getState().sendNudge('Andre Silva', { score: 71, comp: 64 });
    const s = useStore.getState();
    expect(s.nudged.includes('Andre Silva')).toBe(true);
    expect(s.nudgeLog.map((n) => n.name)).toEqual(s.nudged);
  });

  it('stores an attached note (trimmed) as the documentation trail', () => {
    useStore.getState().sendNudge('Andre Silva', { score: 71, comp: 64 }, '  Eat before practice  ');
    expect(useStore.getState().nudgeLog[0].note).toBe('Eat before practice');
  });

  it('leaves note undefined when blank or omitted (no empty trail)', () => {
    useStore.getState().sendNudge('Andre Silva', { score: 71, comp: 64 }, '   ');
    useStore.getState().sendNudge('Marcus Cole', { score: 68, comp: 58 });
    const log = useStore.getState().nudgeLog;
    expect(log[0].note).toBeUndefined();
    expect(log[1].note).toBeUndefined();
  });
});
