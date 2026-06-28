// AthleteOS — Projected Development Score. Proves the projection reuses computeDerived
// (single authority), never reads below current, lists the right remaining actions, and
// collapses to "nothing left" on a fully-completed day.
import { projectedScore } from './projection';
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';
import type { AppState } from './types';
import type { EditableFood } from './mealEdit';

/** A plate carrying explicit protein, for forcing the protein target in a slot. */
const plate = (protein: number): EditableFood[] => [
  { name: 'food', portion: '1 serving', servings: 1, per: { protein, kcal: 0, carbs: 0, fat: 0 } },
];

/** A day with every controllable action already done (no remaining actions). */
function completeDay(): AppState {
  const base = createInitialState();
  const target = computeDerived(base).proteinTarget;
  return {
    ...base,
    meals: { breakfast: true, lunch: true, snack: true, dinner: true },
    mealLoggedAt: {},
    mealFoods: { breakfast: plate(target) },
    tasks: base.tasks.map((t) => ({ ...t, done: true })),
    ciSubmitted: true,
  };
}

describe('projectedScore — current vs reachable', () => {
  it('projects at or above the current score for the seeded day', () => {
    const p = projectedScore(createInitialState());
    expect(p.projected).toBeGreaterThanOrEqual(p.current);
    expect(p.gain).toBe(p.projected - p.current);
    expect(p.gain).toBeGreaterThan(0); // the seed has unfinished actions
  });

  it('equals computeDerived for the current value (single authority)', () => {
    const s = createInitialState();
    expect(projectedScore(s).current).toBe(computeDerived(s).athleteScore);
  });

  it('a fully completed day has no remaining actions and zero gain', () => {
    const p = projectedScore(completeDay());
    expect(p.actions).toEqual([]);
    expect(p.gain).toBe(0);
    expect(p.projected).toBe(p.current);
  });

  it('a near-empty day projects a large gain toward ~100', () => {
    const empty: AppState = {
      ...createInitialState(),
      meals: { breakfast: false, lunch: false, snack: false, dinner: false },
      mealFoods: {},
      ciSubmitted: false,
    };
    const p = projectedScore(empty);
    expect(p.projected).toBeGreaterThan(p.current);
    expect(p.projected).toBeGreaterThanOrEqual(90);
  });
});

describe('projectedScore — the action checklist', () => {
  it('lists a protein action with the remaining grams when behind', () => {
    const s = createInitialState();
    const gap = computeDerived(s).proteinGap;
    const p = projectedScore(s);
    if (gap > 0) {
      const protein = p.actions.find((a) => a.key === 'protein');
      expect(protein).toBeDefined();
      expect(protein!.label).toContain(`${Math.round(gap)}g`);
    }
  });

  it('lists each unlogged meal slot', () => {
    const s: AppState = {
      ...createInitialState(),
      meals: { breakfast: true, lunch: false, snack: true, dinner: false },
    };
    const keys = projectedScore(s).actions.map((a) => a.key);
    expect(keys).toContain('meal:lunch');
    expect(keys).toContain('meal:dinner');
    expect(keys).not.toContain('meal:breakfast');
  });

  it('lists the check-in when it is still open, not once submitted', () => {
    const open = projectedScore({ ...createInitialState(), ciSubmitted: false });
    expect(open.actions.some((a) => a.key === 'checkin')).toBe(true);
    const done = projectedScore({ ...createInitialState(), ciSubmitted: true });
    expect(done.actions.some((a) => a.key === 'checkin')).toBe(false);
  });

  it('never emits an em dash in an action label', () => {
    for (const a of projectedScore(createInitialState()).actions) {
      expect(a.label).not.toContain('—');
    }
  });
});
