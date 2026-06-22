// AthleteOS — store-level integration tests. Drives the real Zustand actions and
// asserts that the derived score (computeDerived over the live state) moves the
// way the prototype intends. AsyncStorage is mocked so the node env can run it.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useStore } from './useStore';
import { computeDerived } from '@/core';

const derived = () => computeDerived(useStore.getState());

beforeEach(() => {
  // Start every test from the prototype's seeded day.
  useStore.getState().resetDemo();
});

describe('addMeal', () => {
  it('logging dinner marks it logged and raises the athlete score', () => {
    const before = derived();
    expect(before.mealsLoggedCount).toBe(3);

    useStore.getState().setMealType('Dinner');
    useStore.getState().addMeal();

    const after = derived();
    expect(useStore.getState().meals.dinner).toBe(true);
    expect(after.mealsLoggedCount).toBe(4);
    expect(after.proteinToday).toBe(before.proteinToday + 52); // dinner macro
    expect(after.athleteScore).toBeGreaterThan(before.athleteScore);
  });

  it('logging dinner also completes the "Log dinner" task (id 3)', () => {
    expect(useStore.getState().tasks.find((t) => t.id === 3)?.done).toBe(false);
    useStore.getState().setMealType('Dinner');
    useStore.getState().addMeal();
    expect(useStore.getState().tasks.find((t) => t.id === 3)?.done).toBe(true);
  });

  it('logging a non-dinner meal does not touch the dinner task', () => {
    // Breakfast already logged in seed; re-logging it must not flip task 3.
    useStore.getState().setMealType('Breakfast');
    useStore.getState().addMeal();
    expect(useStore.getState().tasks.find((t) => t.id === 3)?.done).toBe(false);
  });

  it('closes the meal overlay and resets the capture stage', () => {
    useStore.getState().openMeal();
    useStore.getState().addMeal();
    expect(useStore.getState().mealOpen).toBe(false);
    expect(useStore.getState().mealStage).toBe('capture');
  });
});

describe('toggleTask', () => {
  it('flips a task and recomputes the tasks sub-score', () => {
    const before = derived();
    expect(before.tasksDone).toBe(4);

    useStore.getState().toggleTask(3); // mark "Log dinner" done
    const after = derived();
    expect(after.tasksDone).toBe(5);
    expect(after.tasksScore).toBeGreaterThan(before.tasksScore);
  });

  it('is reversible', () => {
    useStore.getState().toggleTask(1); // was done -> undone
    expect(useStore.getState().tasks.find((t) => t.id === 1)?.done).toBe(false);
    useStore.getState().toggleTask(1); // back to done
    expect(useStore.getState().tasks.find((t) => t.id === 1)?.done).toBe(true);
  });
});

describe('addWater', () => {
  it('adds 0.3 L per pour and never exceeds the hydration target', () => {
    expect(useStore.getState().hydrationL).toBe(2.4);
    useStore.getState().addWater();
    expect(useStore.getState().hydrationL).toBe(2.7);

    // Pour repeatedly; it must clamp at the 3.8 L target.
    for (let i = 0; i < 20; i++) useStore.getState().addWater();
    expect(useStore.getState().hydrationL).toBe(3.8);
    expect(derived().hydrationPct).toBe(100);
  });

  it('completes the water task once intake clears 3.7 L', () => {
    expect(useStore.getState().tasks.find((t) => t.id === 4)?.done).toBe(false);
    for (let i = 0; i < 20; i++) useStore.getState().addWater();
    expect(useStore.getState().tasks.find((t) => t.id === 4)?.done).toBe(true);
  });
});

describe('submitCi', () => {
  it('marks the check-in submitted and snapshots the weight', () => {
    useStore.getState().wStep(2); // ciWeight 178 -> 180
    useStore.getState().submitCi();
    const s = useStore.getState();
    expect(s.ciSubmitted).toBe(true);
    expect(s.ciStage).toBe('done');
    expect(s.currentWeight).toBe(180);
  });

  it('moves recovery from the default 86 to the live readiness score', () => {
    const before = derived();
    expect(before.recoveryScore).toBe(86); // pre-submit default

    // Default ciConfig enables energy+recovery+sleep+confidence — max all four
    // so the recovery sub-score averages to a perfect 100.
    useStore.getState().setCi('ciEnergy', 10);
    useStore.getState().setCi('ciRecovery', 10);
    useStore.getState().setCi('ciSleep', 10);
    useStore.getState().setCi('ciConfidence', 10);
    useStore.getState().submitCi();

    // (10+10+10+10)/40 * 100 = 100
    expect(derived().recoveryScore).toBe(100);
  });
});

describe('wStep clamp', () => {
  it('cannot drop ciWeight below the 70 lb floor on repeated large negative steps', () => {
    for (let i = 0; i < 100; i++) useStore.getState().wStep(-50);
    expect(useStore.getState().ciWeight).toBe(70);
    expect(useStore.getState().ciWeight).toBeGreaterThan(0);
  });

  it('cannot raise ciWeight above the 350 lb ceiling on repeated large positive steps', () => {
    for (let i = 0; i < 100; i++) useStore.getState().wStep(50);
    expect(useStore.getState().ciWeight).toBe(350);
  });

  it('moves ciWeight by exactly the delta for a single in-range step', () => {
    // Seed ciWeight is 178; +2 lands at 180, well inside [70,350].
    useStore.getState().wStep(2);
    expect(useStore.getState().ciWeight).toBe(180);
  });

  it('submitCi snapshots the clamped (>=70) weight, never a negative/zero value', () => {
    for (let i = 0; i < 100; i++) useStore.getState().wStep(-50);
    useStore.getState().submitCi();
    expect(useStore.getState().currentWeight).toBe(70);
    expect(useStore.getState().currentWeight).toBeGreaterThanOrEqual(70);
  });
});

describe('end-to-end perfect day', () => {
  it('drives the athlete score upward as accountability is completed', () => {
    const start = derived().athleteScore;

    useStore.getState().setMealType('Dinner');
    useStore.getState().addMeal();
    for (let i = 0; i < 20; i++) useStore.getState().addWater();
    useStore.getState().tasks.forEach((t) => {
      if (!t.done) useStore.getState().toggleTask(t.id);
    });
    useStore.getState().setCi('ciEnergy', 10);
    useStore.getState().setCi('ciRecovery', 10);
    useStore.getState().setCi('ciSleep', 10);
    useStore.getState().submitCi();

    const end = derived();
    expect(end.athleteScore).toBeGreaterThanOrEqual(start);
    expect(end.athleteScore).toBeLessThanOrEqual(100);
    expect(end.athleteScore).toBeGreaterThanOrEqual(90); // an A day
    expect(end.grade.g).toBe('A');
  });
});
