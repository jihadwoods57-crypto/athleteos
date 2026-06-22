// AthleteOS — calendar-day rollover tests. Pure, injected dates, no real clock.
// Each case maps 1:1 to an acceptance criterion for the day-rollover fix.
import { rollDayIfStale, todayStamp } from './dayRollover';
import { createInitialState } from './defaultState';
import type { AppState } from './types';

const TODAY = '2026-06-21';

/** A persisted slice from a PRIOR day with every day field dirtied + cross-day
 *  fields set, mirroring what the store would have written yesterday. */
function staleSlice(): Partial<AppState> {
  return {
    dateStamp: '2026-06-20',
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
    expect(rolled.hydrationL).toBe(init.hydrationL); // 2.4
    expect(rolled.tasks).toEqual(init.tasks); // ids 3 & 4 done:false
    expect(rolled.quickAdded).toEqual([false, false, false]);
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
