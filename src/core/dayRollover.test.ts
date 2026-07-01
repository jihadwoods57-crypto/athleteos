// OnStandard — calendar-day rollover tests. Pure, injected dates, no real clock.
// Each case maps 1:1 to an acceptance criterion for the day-rollover fix.
import { recordDayNutrition, recordDayScore, recordDayWeight, rollDayIfStale, todayStamp } from './dayRollover';
import { createInitialState } from './defaultState';
import { computeDerived } from './scoring';
import type { AppState } from './types';

const TODAY = '2026-06-21';

/** A persisted slice from a PRIOR day with every day field dirtied + cross-day
 *  fields set, mirroring what the store would have written yesterday. */
function staleSlice(): Partial<AppState> {
  return {
    dateStamp: '2026-06-20',
    meals: { breakfast: true, lunch: true, snack: true, dinner: true },
    mealFoods: { dinner: [{ name: 'Chicken', portion: '8 oz', servings: 2, per: { protein: 50, kcal: 330, carbs: 0, fat: 7 } }] },
    hydrationL: 3.8,
    quickAdded: [true, true, true],
    nudged: ['Andre Silva'],
    nudgeLog: [{ name: 'Andre Silva', day: '2026-06-20', comp: 64, score: 71 }],
    tasks: createInitialState().tasks.map((t) => ({ ...t, done: true })),
    ciStage: 'done',
    ciSubmitted: true,
    ciEnergy: 2,
    ciRecovery: 3,
    ciSleep: 1,
    ciConfidence: 2,
    ciSoreness: 9,
    ciMotivation: 1,
    ciWeight: 190,
    currentWeight: 190,
    visibility: 'coach',
    notif: false,
  };
}

describe('todayStamp', () => {
  it('builds a local YYYY-MM-DD with no UTC off-by-one near midnight', () => {
    // 23:30 local on June 21 must NOT roll to the 22nd via toISOString/UTC.
    expect(todayStamp(new Date(2026, 5, 21, 23, 30))).toBe('2026-06-21');
  });

  it('zero-pads month and day', () => {
    expect(todayStamp(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('rollDayIfStale — stale stamp resets the day (criterion 2)', () => {
  const init = createInitialState();
  const rolled = rollDayIfStale(staleSlice(), TODAY);

  it('resets every day field to fresh defaults', () => {
    expect(rolled.meals).toEqual(init.meals);
    expect(rolled.mealFoods).toEqual(init.mealFoods); // {} — yesterday's saved plates clear with the day
    expect(rolled.hydrationL).toBe(init.hydrationL); // 2.4
    expect(rolled.tasks).toEqual(init.tasks); // ids 3 & 4 done:false
    expect(rolled.quickAdded).toEqual([false, false, false]);
    expect(rolled.nudged).toEqual([]); // yesterday's nudges clear with the day
    expect(rolled.nudgeLog).toEqual([]); // and so does the acknowledgement log
    expect(rolled.ciSubmitted).toBe(false);
    expect(rolled.ciStage).toBe('open');
    expect(rolled.ciEnergy).toBe(init.ciEnergy);
    expect(rolled.ciRecovery).toBe(init.ciRecovery);
    expect(rolled.ciSleep).toBe(init.ciSleep);
    expect(rolled.ciConfidence).toBe(init.ciConfidence);
    expect(rolled.ciSoreness).toBe(init.ciSoreness);
    expect(rolled.ciMotivation).toBe(init.ciMotivation);
  });

  it('stamps today', () => {
    expect(rolled.dateStamp).toBe(TODAY);
  });
});

describe('rollDayIfStale — cross-day data survives (criterion 3)', () => {
  const rolled = rollDayIfStale(staleSlice(), TODAY);

  it('preserves currentWeight (190, not reset to 178)', () => {
    expect(rolled.currentWeight).toBe(190);
  });

  it('preserves visibility and notif prefs', () => {
    expect(rolled.visibility).toBe('coach');
    expect(rolled.notif).toBe(false);
  });

  it('seeds ciWeight from the surviving currentWeight', () => {
    expect(rolled.ciWeight).toBe(190);
  });
});

describe('rollDayIfStale — same-day preserved & idempotent (criterion 4)', () => {
  function sameDay(): Partial<AppState> {
    return {
      dateStamp: TODAY,
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
      hydrationL: 3.8,
      tasks: createInitialState().tasks.map((t) => (t.id === 3 ? { ...t, done: true } : t)),
    };
  }

  it('returns the day values unchanged', () => {
    const slice = sameDay();
    const out = rollDayIfStale(slice, TODAY);
    expect(out.meals?.dinner).toBe(true);
    expect(out.hydrationL).toBe(3.8);
    expect(out.tasks?.find((t) => t.id === 3)?.done).toBe(true);
  });

  it('returns the same reference (no clone) and is idempotent', () => {
    const slice = sameDay();
    const once = rollDayIfStale(slice, TODAY);
    expect(once).toBe(slice);
    const twice = rollDayIfStale(once, TODAY);
    expect(twice).toEqual(once);
  });
});

describe('recordDayScore — logs the prior day before reset', () => {
  it('appends the pre-roll day score, stamped with the prior date', () => {
    const preRoll: AppState = { ...createInitialState(), dateStamp: '2026-06-20', scoreHistory: [] };
    const expected = computeDerived(preRoll).athleteScore;
    const hist = recordDayScore(preRoll, TODAY);
    expect(hist).toEqual([{ date: '2026-06-20', score: expected }]);
  });

  it('preserves earlier history and grows it across rollovers', () => {
    const preRoll: AppState = {
      ...createInitialState(),
      dateStamp: '2026-06-20',
      scoreHistory: [{ date: '2026-06-19', score: 75 }],
    };
    const hist = recordDayScore(preRoll, TODAY);
    expect(hist).toHaveLength(2);
    expect(hist[0]).toEqual({ date: '2026-06-19', score: 75 });
    expect(hist[1].date).toBe('2026-06-20');
  });

  it('does NOT log on the same day (no phantom score)', () => {
    const preRoll: AppState = {
      ...createInitialState(),
      dateStamp: TODAY,
      scoreHistory: [{ date: '2026-06-19', score: 75 }],
    };
    expect(recordDayScore(preRoll, TODAY)).toEqual([{ date: '2026-06-19', score: 75 }]);
  });

  it('does NOT log a brand-new install with no prior stamp', () => {
    const preRoll = { ...createInitialState(), dateStamp: '', scoreHistory: [] } as AppState;
    expect(recordDayScore(preRoll, TODAY)).toEqual([]);
  });
});

describe('recordDayWeight — logs the prior day weight before reset', () => {
  it('appends the pre-roll currentWeight, stamped with the prior date', () => {
    const preRoll: AppState = { ...createInitialState(), dateStamp: '2026-06-20', currentWeight: 181, weightHistory: [] };
    const hist = recordDayWeight(preRoll, TODAY);
    expect(hist).toEqual([{ date: '2026-06-20', weight: 181 }]);
  });

  it('grows existing weight history across rollovers', () => {
    const preRoll: AppState = {
      ...createInitialState(),
      dateStamp: '2026-06-20',
      currentWeight: 182,
      weightHistory: [{ date: '2026-06-19', weight: 180 }],
    };
    const hist = recordDayWeight(preRoll, TODAY);
    expect(hist).toEqual([
      { date: '2026-06-19', weight: 180 },
      { date: '2026-06-20', weight: 182 },
    ]);
  });

  it('does NOT log on the same day or a stamp-less install', () => {
    const same: AppState = { ...createInitialState(), dateStamp: TODAY, weightHistory: [{ date: 'x', weight: 175 }] };
    expect(recordDayWeight(same, TODAY)).toEqual([{ date: 'x', weight: 175 }]);
    const fresh = { ...createInitialState(), dateStamp: '', weightHistory: [] } as AppState;
    expect(recordDayWeight(fresh, TODAY)).toEqual([]);
  });
});

describe('recordDayNutrition — logs the prior day nutrition sub-score before reset', () => {
  it('appends the derived nutrition score, stamped with the prior date', () => {
    const preRoll: AppState = { ...createInitialState(), dateStamp: '2026-06-20', nutritionHistory: [] };
    const expected = computeDerived(preRoll).nutritionScore;
    const hist = recordDayNutrition(preRoll, TODAY);
    expect(hist).toEqual([{ date: '2026-06-20', score: expected }]);
  });

  it('is a no-op on the same day or a stamp-less install', () => {
    const same: AppState = { ...createInitialState(), dateStamp: TODAY, nutritionHistory: [{ date: 'x', score: 80 }] };
    expect(recordDayNutrition(same, TODAY)).toEqual([{ date: 'x', score: 80 }]);
    const fresh = { ...createInitialState(), dateStamp: '', nutritionHistory: [] } as AppState;
    expect(recordDayNutrition(fresh, TODAY)).toEqual([]);
  });
});

describe('ciConfig persistence — archived score uses the answered questions, not defaults', () => {
  // Prior-day snapshot with a COACH-CUSTOMIZED ciConfig: only energy + sleep enabled.
  // The enabled-only set {energy, sleep} differs from the default enabled set
  // {energy, recovery, sleep, confidence}, so the recovery sub-score (and thus the
  // archived athleteScore) differs depending on which ciConfig is in effect.
  function customConfigPreRoll(): AppState {
    return {
      ...createInitialState(),
      dateStamp: '2026-06-20',
      scoreHistory: [],
      ciSubmitted: true,
      ciEnergy: 2,
      ciRecovery: 3,
      ciSleep: 1,
      ciConfidence: 2,
      ciSoreness: 9,
      ciMotivation: 1,
      ciConfig: { energy: true, sleep: true, recovery: false, confidence: false, soreness: false, motivation: false },
    };
  }

  it('archives the prior-day score computed against the PERSISTED (custom) ciConfig', () => {
    const preRoll = customConfigPreRoll();
    const expected = computeDerived(preRoll).athleteScore;
    const hist = recordDayScore(preRoll, TODAY);
    expect(hist).toHaveLength(1);
    expect(hist[0].date).toBe('2026-06-20');
    expect(hist[0].score).toBe(expected);
  });

  it('control: same answers under the DEFAULT ciConfig yield a different score (documents the bug)', () => {
    const expected = computeDerived(customConfigPreRoll()).athleteScore;
    const preRollDefault: AppState = { ...customConfigPreRoll(), ciConfig: createInitialState().ciConfig };
    const defaultScore = computeDerived(preRollDefault).athleteScore;
    // If ciConfig were dropped from persistence, merge would archive `defaultScore` —
    // the wrong number. Proving they differ proves the persisted config is load-bearing.
    expect(expected).not.toBe(defaultScore);
  });

  it('merge path: archived entry uses custom config AND ciConfig survives rollDayIfStale', () => {
    // Persisted slice as partialize would write it (now including ciConfig), stamped prior day.
    const customConfig = { energy: true, sleep: true, recovery: false, confidence: false, soreness: false, motivation: false };
    const p: Partial<AppState> = {
      dateStamp: '2026-06-20',
      scoreHistory: [],
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
      hydrationL: 3.8,
      quickAdded: [true, true, true],
      tasks: createInitialState().tasks.map((t) => ({ ...t, done: true })),
      ciStage: 'done',
      ciSubmitted: true,
      ciEnergy: 2,
      ciRecovery: 3,
      ciSleep: 1,
      ciConfidence: 2,
      ciSoreness: 9,
      ciMotivation: 1,
      ciWeight: 190,
      currentWeight: 190,
      visibility: 'coach',
      notif: false,
      ciConfig: customConfig,
    };

    // Mirrors store.merge: recordDayScore({ ...current, ...p }, today) then rollDayIfStale(p, today).
    const preRoll = { ...createInitialState(), ...p } as AppState;
    const expected = computeDerived(preRoll).athleteScore;
    const scoreHistory = recordDayScore(preRoll, TODAY);
    const rolled = rollDayIfStale(p, TODAY);

    expect(scoreHistory).toHaveLength(1);
    expect(scoreHistory[0]).toEqual({ date: '2026-06-20', score: expected });

    // ciConfig is a cross-day coach setting: it must SURVIVE rollover, not reset.
    expect(rolled.ciConfig).toEqual(customConfig);

    // Day fields still reset alongside the surviving config.
    const init = createInitialState();
    expect(rolled.ciSubmitted).toBe(false);
    expect(rolled.meals).toEqual(init.meals);
    expect(rolled.dateStamp).toBe(TODAY);
  });
});

describe('rollDayIfStale — missing stamp is treated as stale (criterion 5)', () => {
  it('resets day fields and stamps today for a legacy blob', () => {
    const init = createInitialState();
    const legacy: Partial<AppState> = {
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
      hydrationL: 3.8,
      currentWeight: 185,
    };
    const rolled = rollDayIfStale(legacy, TODAY);
    expect(rolled.dateStamp).toBe(TODAY);
    expect(rolled.meals).toEqual(init.meals);
    expect(rolled.hydrationL).toBe(init.hydrationL);
    expect(rolled.currentWeight).toBe(185); // cross-day survives migration
    expect(rolled.ciWeight).toBe(185); // seeded from currentWeight
  });
});
