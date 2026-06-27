// AthleteOS — "next best action" coaching prompt. Proves the single highest-impact
// step is chosen from real derived state + the hour, in score-lever priority order,
// and that the all-clear only shows when the day is genuinely complete.
import { nextBestAction } from './nextAction';
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';
import type { AppState } from './types';
import type { EditableFood } from './mealEdit';

const plate = (protein: number): EditableFood[] => [
  { name: 'food', portion: '1', servings: 1, per: { protein, kcal: 0, carbs: 0, fat: 0 } },
];
const act = (s: AppState, hour = 10) => nextBestAction(s, computeDerived(s), new Date(2026, 5, 27, hour));

describe('nextBestAction — protein leads (the dominant lever)', () => {
  it('default day (38g short, dinner unlogged): log the next due meal, protein-framed', () => {
    const a = act(createInitialState(), 10);
    expect(a.key).toBe('log-meal');
    expect(a.title).toBe('Log dinner');
    expect(a.detail).toContain('38g of protein');
    expect(a.cta).toBe('meal');
    expect(a.done).toBe(false);
  });

  it('uses urgent "overdue" copy once the slot is past its due hour', () => {
    const early = act(createInitialState(), 10).detail;
    const late = act(createInitialState(), 21).detail; // dinner due 20:00
    expect(late).toContain('overdue');
    expect(early).not.toContain('overdue');
  });

  it('all meals logged but still short -> a protein top-up, not a meal', () => {
    const s: AppState = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: true, dinner: true }, mealFoods: { breakfast: [], lunch: [], snack: [], dinner: [] } };
    const a = act(s);
    expect(a.key).toBe('protein-topup');
    expect(a.detail).toContain('shake');
  });
});

describe('nextBestAction — once protein is met, the next lever', () => {
  const proteinMet = (over: Partial<AppState> = {}): AppState => ({
    ...createInitialState(),
    meals: { breakfast: true, lunch: true, snack: true, dinner: true },
    mealFoods: { breakfast: plate(220) },
    ...over,
  });

  it('protein met but a meal missing -> keep the day complete (no protein nag)', () => {
    const s = proteinMet({ meals: { breakfast: true, lunch: true, snack: true, dinner: false } });
    const a = act(s);
    expect(a.key).toBe('log-meal');
    expect(a.title).toBe('Log dinner');
    expect(a.detail).toContain('already on target');
  });

  it('nutrition done, water behind -> hydrate', () => {
    const a = act(proteinMet({ hydrationL: 2.4 }));
    expect(a.key).toBe('hydrate');
    expect(a.cta).toBe('water');
  });

  it('nutrition + water done, check-in not in -> do the check-in', () => {
    const a = act(proteinMet({ hydrationL: 3.8, ciSubmitted: false }));
    expect(a.key).toBe('checkin');
    expect(a.cta).toBe('checkin');
  });

  it('everything in -> the honest all-clear (done)', () => {
    const init = createInitialState();
    const s = proteinMet({ hydrationL: 3.8, ciSubmitted: true, tasks: init.tasks.map((t) => ({ ...t, done: true })) });
    const a = act(s);
    expect(a.key).toBe('done');
    expect(a.done).toBe(true);
    expect(a.cta).toBeNull();
  });
});
