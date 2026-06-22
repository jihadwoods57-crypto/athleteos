// AthleteOS — scoring engine tests. Asserts the ported math against the
// prototype's default state and known transitions.
import { computeDerived, gradeFor } from './scoring';
import { createInitialState } from './defaultState';
import type { AppState } from './types';

describe('gradeFor', () => {
  it('maps score ranges to letter grades', () => {
    expect(gradeFor(95).g).toBe('A');
    expect(gradeFor(90).g).toBe('A');
    expect(gradeFor(85).g).toBe('B');
    expect(gradeFor(75).g).toBe('C');
    expect(gradeFor(65).g).toBe('D');
    expect(gradeFor(50).g).toBe('F');
  });
});

describe('computeDerived — default state', () => {
  const s = createInitialState();
  const d = computeDerived(s);

  it('logs 3 of 4 meals (dinner pending)', () => {
    expect(d.mealsLoggedCount).toBe(3);
  });

  it('protein = breakfast 42 + lunch 51 + snack 49 = 142, gap 38', () => {
    expect(d.proteinToday).toBe(142);
    expect(d.proteinGap).toBe(38);
  });

  it('nutrition sub-score = round(57 + 142/180*30 + 3/4*15) = 92', () => {
    // 57 + 23.6667 + 11.25 = 91.9167 -> 92
    expect(d.nutritionScore).toBe(92);
  });

  it('recovery defaults to 86 before check-in', () => {
    expect(d.recoveryScore).toBe(86);
  });

  it('tasks = 4 of 6 done -> 67', () => {
    expect(d.tasksDone).toBe(4);
    expect(d.tasksTotal).toBe(6);
    expect(d.tasksScore).toBe(67);
  });

  it('athlete score = clamp(round(.4*92 + .2*86 + .2*95 + .1*67 + .1*100)) = 90', () => {
    // 36.8 + 17.2 + 19 + 6.7 + 10 = 89.7 -> 90
    expect(d.athleteScore).toBe(90);
    expect(d.grade.g).toBe('A');
  });

  it('ring offset = round(540 * (1 - score/100))', () => {
    expect(d.ringOffset).toBe(Math.round(540 * (1 - d.athleteScore / 100)));
  });
});

describe('computeDerived — reactivity', () => {
  it('logging dinner raises nutrition + total score', () => {
    const base = createInitialState();
    const before = computeDerived(base);
    const after = computeDerived({ ...base, meals: { ...base.meals, dinner: true } } as AppState);
    expect(after.mealsLoggedCount).toBe(4);
    expect(after.proteinToday).toBe(194); // +52 dinner
    expect(after.athleteScore).toBeGreaterThan(before.athleteScore);
  });

  it('submitting a strong check-in raises recovery above 86', () => {
    const base = createInitialState();
    const after = computeDerived({ ...base, ciSubmitted: true, ciEnergy: 10, ciRecovery: 10, ciSleep: 10 } as AppState);
    expect(after.recoveryScore).toBe(100);
  });

  it('score is clamped to 0..100', () => {
    const base = createInitialState();
    const maxed = computeDerived({
      ...base,
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
      quickAdded: [true, true, true],
      tasks: base.tasks.map((t) => ({ ...t, done: true })),
      ciSubmitted: true,
      ciEnergy: 10,
      ciRecovery: 10,
      ciSleep: 10,
    } as AppState);
    expect(maxed.athleteScore).toBeLessThanOrEqual(100);
    expect(maxed.athleteScore).toBeGreaterThanOrEqual(0);
  });
});
