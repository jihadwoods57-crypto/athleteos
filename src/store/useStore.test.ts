// OnStandard — store-level integration tests. Drives the real Zustand actions and
// asserts that the derived score (computeDerived over the live state) moves the
// way the prototype intends. AsyncStorage is mocked so the node env can run it.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from './useStore';
import { computeDerived, seasonGoalProgress, WEIGHT_START, WEIGHT_TARGET } from '@/core';
import { createInitialState } from '@/core/defaultState';
import { todayStamp } from '@/core/dayRollover';
import type { AppState } from '@/core/types';

const derived = () => computeDerived(useStore.getState());

/** Seed the persisted `aos_day` blob in zustand-persist's {state, version} envelope. */
async function seedPersisted(blob: Partial<AppState>): Promise<void> {
  await AsyncStorage.setItem('aos_day', JSON.stringify({ state: blob, version: 0 }));
}

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
    expect(before.tasksDone).toBe(3); // protein task (id 2) not done: 142 < 180

    // Use a NON-drift-proofed task. ids 2 (protein) and 3 (dinner) derive their
    // done-state in computeDerived from logged reality, so toggling their stored
    // flag no longer moves the derived count. id 6 ("10 min mobility") starts done
    // and reads straight from the stored flag, so flipping it off drops the count.
    useStore.getState().toggleTask(6); // mark "10 min mobility" undone
    const after = derived();
    expect(after.tasksDone).toBe(2);
    expect(after.tasksScore).toBeLessThan(before.tasksScore);
  });

  it('is reversible', () => {
    useStore.getState().toggleTask(1); // was done -> undone
    expect(useStore.getState().tasks.find((t) => t.id === 1)?.done).toBe(false);
    useStore.getState().toggleTask(1); // back to done
    expect(useStore.getState().tasks.find((t) => t.id === 1)?.done).toBe(true);
  });
});

describe('protein task (id 2) visible row mirrors logged protein', () => {
  it('starts unchecked in the seed (142 < 180)', () => {
    expect(useStore.getState().tasks.find((t) => t.id === 2)?.done).toBe(false);
  });

  it('toggleQuick flips the visible id 2 row done once protein clears 180', () => {
    // Greek yogurt (18) + Turkey roll-ups (22) = +40 -> 142+40 = 182 >= 180.
    useStore.getState().toggleQuick(0); // 142+18=160, still under
    expect(useStore.getState().tasks.find((t) => t.id === 2)?.done).toBe(false);
    useStore.getState().toggleQuick(2); // +22 -> 182, over
    expect(useStore.getState().tasks.find((t) => t.id === 2)?.done).toBe(true);
    // un-toggling drops back under target and the row un-checks
    useStore.getState().toggleQuick(2); // back to 160
    expect(useStore.getState().tasks.find((t) => t.id === 2)?.done).toBe(false);
  });

  it('addMeal (dinner -> 194) flips both the dinner task and the protein task', () => {
    expect(useStore.getState().tasks.find((t) => t.id === 2)?.done).toBe(false);
    useStore.getState().setMealType('Dinner');
    useStore.getState().addMeal();
    expect(useStore.getState().tasks.find((t) => t.id === 2)?.done).toBe(true);
    expect(useStore.getState().tasks.find((t) => t.id === 3)?.done).toBe(true);
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

describe('editable nutrition targets', () => {
  it('default to the PROTEIN_TARGET/CAL_TARGET constants and surface in derived', () => {
    const d = derived();
    expect(d.proteinTarget).toBe(180);
    expect(d.calTarget).toBe(3200);
  });

  it('lowering the protein target raises proteinPct + nutrition score and completes the protein task', () => {
    const before = derived();
    expect(before.proteinPct).toBe(79); // seed 142g / 180g target
    expect(useStore.getState().tasks.find((t) => t.id === 2)?.done).toBe(false);

    useStore.getState().adjustProteinTarget(-40); // 180 -> 140; seed 142g now clears it
    const after = derived();
    expect(useStore.getState().proteinTarget).toBe(140);
    expect(after.proteinTarget).toBe(140);
    expect(after.proteinPct).toBe(100);
    expect(after.nutritionScore).toBeGreaterThan(before.nutritionScore);
    expect(after.athleteScore).toBeGreaterThan(before.athleteScore);
    // the visible id-2 task row re-derives to done the instant the target drops
    expect(useStore.getState().tasks.find((t) => t.id === 2)?.done).toBe(true);
  });

  it('raising the protein target lowers proteinPct and the nutrition score', () => {
    const before = derived();
    useStore.getState().adjustProteinTarget(60); // 180 -> 240
    const after = derived();
    expect(useStore.getState().proteinTarget).toBe(240);
    expect(after.proteinPct).toBeLessThan(before.proteinPct);
    expect(after.nutritionScore).toBeLessThan(before.nutritionScore);
  });

  it('clamps the protein target to [80, 320]', () => {
    for (let i = 0; i < 100; i++) useStore.getState().adjustProteinTarget(-10);
    expect(useStore.getState().proteinTarget).toBe(80);
    for (let i = 0; i < 100; i++) useStore.getState().adjustProteinTarget(10);
    expect(useStore.getState().proteinTarget).toBe(320);
  });

  it('edits the calorie target (clamped to [1200, 6000]) and reflects it in derived', () => {
    useStore.getState().adjustCalTarget(300); // 3200 -> 3500
    expect(useStore.getState().calTarget).toBe(3500);
    expect(derived().calTarget).toBe(3500);
    for (let i = 0; i < 200; i++) useStore.getState().adjustCalTarget(50);
    expect(useStore.getState().calTarget).toBe(6000);
    for (let i = 0; i < 300; i++) useStore.getState().adjustCalTarget(-50);
    expect(useStore.getState().calTarget).toBe(1200);
  });
});

describe('editable season weight target', () => {
  it('defaults to the WEIGHT_TARGET constant', () => {
    expect(useStore.getState().weightTarget).toBe(WEIGHT_TARGET);
  });

  it('lowering the weight target raises season-goal progress and shrinks "to go"', () => {
    const w = useStore.getState().currentWeight;
    const before = seasonGoalProgress(w, WEIGHT_START, useStore.getState().weightTarget);

    useStore.getState().adjustWeightTarget(-4); // 184 -> 180, closer to current weight
    expect(useStore.getState().weightTarget).toBe(180);

    const after = seasonGoalProgress(w, WEIGHT_START, useStore.getState().weightTarget);
    expect(after.remaining).toBeLessThan(before.remaining);
    expect(after.pctThere).toBeGreaterThan(before.pctThere);
  });

  it('clamps the weight target to [120, 350]', () => {
    for (let i = 0; i < 400; i++) useStore.getState().adjustWeightTarget(-1);
    expect(useStore.getState().weightTarget).toBe(120);
    for (let i = 0; i < 400; i++) useStore.getState().adjustWeightTarget(1);
    expect(useStore.getState().weightTarget).toBe(350);
  });

  it('falls back to the constant for a legacy blob with no weightTarget', () => {
    // Action must not produce NaN when the persisted state predates the field.
    useStore.setState({ weightTarget: undefined as unknown as number });
    useStore.getState().adjustWeightTarget(2);
    expect(useStore.getState().weightTarget).toBe(WEIGHT_TARGET + 2);
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

describe('session persistence / rehydrate', () => {
  beforeEach(async () => {
    // Isolate from the global resetDemo() (which touches in-memory state only):
    // clear AsyncStorage so each case controls the persisted blob explicitly.
    await AsyncStorage.clear();
  });

  it('(a) restores flow:app + role:athlete + identity on a same-day blob (lands on AthleteApp)', async () => {
    await seedPersisted({
      flow: 'app',
      role: 'athlete',
      athleteName: 'Marcus',
      dateStamp: todayStamp(),
    });
    await useStore.persist.rehydrate();
    const s = useStore.getState();
    expect(s.flow).toBe('app');
    expect(s.role).toBe('athlete');
    expect(s.athleteName).toBe('Marcus');
  });

  it('(b) restores a coach flow verbatim', async () => {
    await seedPersisted({ flow: 'coach', dateStamp: todayStamp() });
    await useStore.persist.rehydrate();
    expect(useStore.getState().flow).toBe('coach');
  });

  it('(c) restores a mid-onboarding step', async () => {
    await seedPersisted({ flow: 'onboarding', obStep: 2, dateStamp: todayStamp() });
    await useStore.persist.rehydrate();
    const s = useStore.getState();
    expect(s.flow).toBe('onboarding');
    expect(s.obStep).toBe(2);
  });

  it('(d) a brand-new install (no persisted blob) starts at onboarding step 0', async () => {
    await AsyncStorage.removeItem('aos_day');
    await useStore.persist.rehydrate();
    const s = useStore.getState();
    expect(s.flow).toBe('onboarding');
    expect(s.obStep).toBe(0);
  });

  it('(d2) a legacy blob with day data but no flow falls back to onboarding step 0', async () => {
    await seedPersisted({ dateStamp: todayStamp(), hydrationL: 3.1, obStep: 5 });
    await useStore.persist.rehydrate();
    const s = useStore.getState();
    expect(s.flow).toBe('onboarding');
    expect(s.obStep).toBe(0);
  });

  it('(e) stale-day rollover resets the day slice, appends history once, and keeps identity', async () => {
    await seedPersisted({
      flow: 'app',
      role: 'athlete',
      athleteName: 'Marcus',
      currentWeight: 185,
      dateStamp: '2020-01-01',
      scoreHistory: [],
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
      hydrationL: 3.8,
      tasks: createInitialState().tasks.map((t) => ({ ...t, done: true })),
    });
    await useStore.persist.rehydrate();
    const s = useStore.getState();
    const fresh = createInitialState();

    // day slice reset to fresh defaults
    expect(s.meals).toEqual(fresh.meals);
    expect(s.hydrationL).toBe(fresh.hydrationL);
    expect(s.tasks).toEqual(fresh.tasks);
    expect(s.dateStamp).toBe(todayStamp());

    // prior day's score appended exactly once, for the stale date
    expect(s.scoreHistory).toHaveLength(1);
    expect(s.scoreHistory[0].date).toBe('2020-01-01');

    // identity / cross-day survives the roll
    expect(s.flow).toBe('app');
    expect(s.role).toBe('athlete');
    expect(s.athleteName).toBe('Marcus');
    expect(s.currentWeight).toBe(185);
  });

  it('(e2) stale-day rollover also records the prior day weight + nutrition history once', async () => {
    await seedPersisted({
      flow: 'app',
      role: 'athlete',
      currentWeight: 183,
      dateStamp: '2020-01-01',
      scoreHistory: [],
      weightHistory: [],
      nutritionHistory: [],
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
    });
    await useStore.persist.rehydrate();
    const s = useStore.getState();

    // weight snapshot is the cross-day currentWeight, stamped to the stale day.
    expect(s.weightHistory).toHaveLength(1);
    expect(s.weightHistory[0]).toEqual({ date: '2020-01-01', weight: 183 });
    // currentWeight (cross-day) survives the roll, so the trend's live last point holds.
    expect(s.currentWeight).toBe(183);

    // nutrition sub-score for the pre-roll (all meals logged) day is recorded once.
    expect(s.nutritionHistory).toHaveLength(1);
    expect(s.nutritionHistory[0].date).toBe('2020-01-01');
    expect(s.nutritionHistory[0].score).toBeGreaterThan(0);
  });

  it('(e3) same-day rehydrate does not append weight or nutrition history', async () => {
    await seedPersisted({
      flow: 'app',
      role: 'athlete',
      dateStamp: todayStamp(),
      weightHistory: [{ date: '2020-01-01', weight: 180 }],
      nutritionHistory: [{ date: '2020-01-01', score: 70 }],
    });
    await useStore.persist.rehydrate();
    const s = useStore.getState();
    expect(s.weightHistory).toEqual([{ date: '2020-01-01', weight: 180 }]);
    expect(s.nutritionHistory).toEqual([{ date: '2020-01-01', score: 70 }]);
  });

  it('(f) same-day rehydrate leaves the day slice untouched and does not double-append history', async () => {
    await seedPersisted({
      flow: 'app',
      role: 'athlete',
      dateStamp: todayStamp(),
      hydrationL: 3.1,
      scoreHistory: [{ date: '2020-01-01', score: 50 }],
    });
    await useStore.persist.rehydrate();
    const s = useStore.getState();
    expect(s.hydrationL).toBe(3.1);
    expect(s.scoreHistory).toHaveLength(1);
    expect(s.scoreHistory[0]).toEqual({ date: '2020-01-01', score: 50 });
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
