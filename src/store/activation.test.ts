// AthleteOS — store-level tests for the new-athlete activation / Day-0 reconcile.
// A brand-new athlete must continue HONESTLY from the onboarding reveal: the
// Starting Point Score is written as the day-0 anchor in scoreHistory, and the
// seeded demo day is swapped for a genuinely empty day at activation so Home
// never shows someone else's pre-logged meals. The seeded demo (resetDemo) is
// untouched. AsyncStorage is mocked so the node env can drive the real store.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useStore } from './useStore';
import { emptyDaySlice, trendSeries } from '@/core';
import { createInitialState } from '@/core/defaultState';

/** Put the store into a brand-new-athlete shape: cleared identity + no history,
 *  then walk the onboarding answers the athlete would have set. */
function freshAthlete() {
  useStore.setState({
    ...createInitialState(),
    athleteName: 'Marcus Cole',
    role: 'athlete',
    scoreHistory: [],
    baseNutritionConfidence: 4,
    baseMealsPerDay: 3,
    baseWaterL: 2,
    baseSleepH: 7,
    baseProteinFreq: 1,
    baseConsistency: 4,
    startScore: null,
  });
}

describe('emptyDaySlice (pure)', () => {
  it('logs nothing and leaves every task open', () => {
    const slice = emptyDaySlice();
    expect(slice.meals).toEqual({ breakfast: false, lunch: false, snack: false, dinner: false });
    expect(slice.hydrationL).toBe(0);
    expect(slice.quickAdded).toEqual([false, false, false]);
    expect(slice.nudged).toEqual([]);
    expect(slice.tasks.every((t) => !t.done)).toBe(true);
  });

  it('keeps the same task ids as the seeded day (only the done flags differ)', () => {
    const seeded = createInitialState().tasks.map((t) => t.id);
    expect(emptyDaySlice().tasks.map((t) => t.id)).toEqual(seeded);
  });
});

describe('commitStartingScore — writes the Starting Point Score as day-0 history', () => {
  it('anchors scoreHistory at the computed start score when none exists', () => {
    freshAthlete();
    useStore.getState().commitStartingScore();
    const s = useStore.getState();
    expect(s.startScore).not.toBeNull();
    expect(s.scoreHistory).toHaveLength(1);
    expect(s.scoreHistory[0].score).toBe(s.startScore);
    expect(s.scoreHistory[0].date).toBe(s.dateStamp);
  });

  it('seeds the check-in sleep slider from the baseline answer', () => {
    freshAthlete();
    useStore.setState({ baseSleepH: 9 });
    useStore.getState().commitStartingScore();
    // 9h maps to the top of the 1-10 slider.
    expect(useStore.getState().ciSleep).toBe(10);
  });

  it('never clobbers existing real history', () => {
    freshAthlete();
    useStore.setState({ scoreHistory: [{ date: '2026-06-20', score: 88 }] });
    useStore.getState().commitStartingScore();
    expect(useStore.getState().scoreHistory).toEqual([{ date: '2026-06-20', score: 88 }]);
  });
});

describe('startFirstMealChallenge — swaps the seeded demo day for an empty one', () => {
  it('clears every logged meal, hydration and task before entering the app', () => {
    freshAthlete();
    useStore.getState().commitStartingScore();
    useStore.getState().startFirstMealChallenge();
    const s = useStore.getState();
    expect(s.flow).toBe('app');
    expect(s.tab).toBe('home');
    expect(s.mealOpen).toBe(true);
    expect(s.meals).toEqual({ breakfast: false, lunch: false, snack: false, dinner: false });
    expect(s.hydrationL).toBe(0);
    expect(s.tasks.every((t) => !t.done)).toBe(true);
  });

  it('keeps the day-0 anchor so the Home trend continues from the reveal', () => {
    freshAthlete();
    useStore.getState().commitStartingScore();
    const start = useStore.getState().startScore!;
    useStore.getState().startFirstMealChallenge();
    const s = useStore.getState();
    // The Starting Point Score is the second-to-last point of the 7-day trend
    // (today's live score is the last), so the chart continues from the reveal.
    const series = trendSeries(s.scoreHistory, 40);
    expect(series[series.length - 2]).toBe(start);
  });
});

describe('resetDemo — the seeded demo day is untouched by the activation path', () => {
  it('still ships 3 logged meals and a populated day', () => {
    useStore.getState().resetDemo();
    const s = useStore.getState();
    expect(s.meals).toEqual({ breakfast: true, lunch: true, snack: true, dinner: false });
    expect(s.hydrationL).toBe(2.4);
  });
});
