// AthleteOS — persistence invariants. Locks the agreement between the day-rollover
// reset set (DAY_DEFAULT_KEYS) and the store's persist whitelist (partialize), and
// proves a serialize -> merge round-trip restores state. AsyncStorage is mocked so
// the node env can drive the real Zustand store + its persist options.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useStore } from './useStore';
import { DAY_DEFAULT_KEYS } from '@/core';
import { createInitialState } from '@/core/defaultState';
import { todayStamp } from '@/core/dayRollover';
import type { AppState } from '@/core/types';

/** The real persist whitelist: the exact subset partialize writes to AsyncStorage. */
function persistedKeys(): Set<string> {
  const opts = (useStore as unknown as { persist: { getOptions: () => { partialize: (s: AppState) => object } } }).persist.getOptions();
  return new Set(Object.keys(opts.partialize(useStore.getState())));
}

beforeEach(() => {
  useStore.getState().resetDemo();
});

describe('DAY_DEFAULT_KEYS <-> partialize agreement', () => {
  // The one-directional invariant the rollover doc states: every key that RESETS on
  // a calendar rollover MUST be persisted, otherwise the same-day reload would lose
  // that day's progress (and the rollover would archive a score computed from
  // defaults rather than the real pre-roll day).
  it('every day-reset key is in the persist whitelist', () => {
    const persisted = persistedKeys();
    const missing = DAY_DEFAULT_KEYS.filter((k) => !persisted.has(k));
    expect(missing).toEqual([]);
  });

  it('the day-reset keys are a non-empty, well-formed set (no typos vs defaults)', () => {
    const init = createInitialState();
    // Each declared reset key must actually exist on the state shape.
    const unknown = DAY_DEFAULT_KEYS.filter((k) => !(k in init));
    expect(unknown).toEqual([]);
    expect(DAY_DEFAULT_KEYS.length).toBeGreaterThan(0);
  });
});

describe('onboarding identity + baseline fields are all persisted', () => {
  // A returning user must land back in their role/flow with their onboarding answers
  // intact, so every onboarding identity + baseline field has to survive a reload.
  const ONBOARDING_FIELDS: (keyof AppState)[] = [
    'flow', 'role', 'obStep', 'signinMode',
    'athleteName', 'athleteEmail', 'level', 'sport', 'position',
    'baseGoal', 'baseHeight', 'baseWeight', 'baseAge',
    'goals', 'inviteWho', 'parentFocus', 'coachTrack', 'compMode',
    // onboarding (redesign)
    'primaryGoal', 'trainingFreq', 'supportTeam', 'inviteCode',
    'baseNutritionConfidence', 'baseMealsPerDay', 'baseWaterL', 'baseSleepH',
    'baseProteinFreq', 'baseConsistency', 'startScore', 'obMeta',
  ];

  it('persists every onboarding field so a returning user is restored', () => {
    const persisted = persistedKeys();
    const missing = ONBOARDING_FIELDS.filter((k) => !persisted.has(k));
    expect(missing).toEqual([]);
  });

  it('persists the editable targets that feed scoring + the goal card', () => {
    const persisted = persistedKeys();
    for (const k of ['proteinTarget', 'calTarget', 'weightTarget']) {
      expect(persisted.has(k)).toBe(true);
    }
  });
});

describe('serialize -> merge round-trip', () => {
  const getMerge = () =>
    (useStore as unknown as { persist: { getOptions: () => { merge: (p: unknown, c: AppState) => AppState } } }).persist.getOptions().merge;
  const partialize = () =>
    (useStore as unknown as { persist: { getOptions: () => { partialize: (s: AppState) => Partial<AppState> } } }).persist.getOptions().partialize;

  it('a same-day persisted slice merges back to the same day + identity values', () => {
    // Build a realistic app session, serialize it the way persist would, and merge
    // it back onto a fresh default — same-day, so nothing resets.
    const current = createInitialState();
    const session: AppState = {
      ...current,
      flow: 'app',
      role: 'athlete',
      athleteName: 'Marcus',
      athleteEmail: 'm@x.io',
      dateStamp: todayStamp(),
      hydrationL: 3.1,
      meals: { breakfast: true, lunch: true, snack: false, dinner: true },
      proteinTarget: 200,
      weightTarget: 190,
      scoreHistory: [{ date: '2026-06-20', score: 77 }],
    };
    const serialized = partialize()(session);
    const merged = getMerge()(serialized, createInitialState());

    // Identity + flow restored verbatim.
    expect(merged.flow).toBe('app');
    expect(merged.role).toBe('athlete');
    expect(merged.athleteName).toBe('Marcus');
    expect(merged.athleteEmail).toBe('m@x.io');
    // Same-day day slice restored as-is (no rollover reset).
    expect(merged.hydrationL).toBe(3.1);
    expect(merged.meals).toEqual(session.meals);
    expect(merged.dateStamp).toBe(todayStamp());
    // Editable targets + history survive.
    expect(merged.proteinTarget).toBe(200);
    expect(merged.weightTarget).toBe(190);
    expect(merged.scoreHistory).toEqual([{ date: '2026-06-20', score: 77 }]);
  });

  it('a legacy/new-install blob with no flow lands at onboarding step 0', () => {
    const merged = getMerge()({ dateStamp: todayStamp(), hydrationL: 2.9, obStep: 7 }, createInitialState());
    expect(merged.flow).toBe('onboarding');
    expect(merged.obStep).toBe(0);
  });
});
