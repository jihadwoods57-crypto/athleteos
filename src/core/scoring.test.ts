// AthleteOS — scoring engine tests. Asserts the ported math against the
// prototype's default state and known transitions.
import { computeDerived, gradeFor, seasonGoalProgress } from './scoring';
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

describe('seasonGoalProgress', () => {
  it('at start (171) -> nothing gained yet', () => {
    expect(seasonGoalProgress(171, 171, 184)).toEqual({ remaining: 13, pctThere: 0 });
  });

  it('at target (184) -> goal reached', () => {
    expect(seasonGoalProgress(184, 171, 184)).toEqual({ remaining: 0, pctThere: 100 });
  });

  it('midpoint (177.5) -> ~50% with one-decimal remaining', () => {
    expect(seasonGoalProgress(177.5, 171, 184)).toEqual({ remaining: 6.5, pctThere: 50 });
  });

  it('below start (160) -> pctThere clamped to 0', () => {
    const r = seasonGoalProgress(160, 171, 184);
    expect(r.pctThere).toBe(0);
    expect(r.remaining).toBe(24);
  });

  it('above target (190) -> pctThere clamped to 100, remaining <= 0 (not NaN)', () => {
    const r = seasonGoalProgress(190, 171, 184);
    expect(r.pctThere).toBe(100);
    expect(r.remaining).toBeLessThanOrEqual(0);
    expect(Number.isNaN(r.remaining)).toBe(false);
  });

  it('default-state currentWeight (178) reproduces the seeded card numbers', () => {
    const s = createInitialState();
    expect(seasonGoalProgress(s.currentWeight, 171, 184)).toEqual({ remaining: 6, pctThere: 54 });
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
    // Default config also enables confidence, so max all four enabled questions.
    const after = computeDerived({ ...base, ciSubmitted: true, ciEnergy: 10, ciRecovery: 10, ciSleep: 10, ciConfidence: 10 } as AppState);
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

describe('computeDerived — recovery sub-score from ciConfig', () => {
  const allOff = { energy: false, recovery: false, sleep: false, confidence: false, soreness: false, motivation: false };

  it('default config (energy+recovery+sleep+confidence) includes confidence — differs from old /30 trio', () => {
    const s = createInitialState();
    const d = computeDerived({ ...s, ciSubmitted: true } as AppState);
    // seed 8/7/8/9 over 4 questions: round(((8+7+8+9)/40)*100) = round(80) = 80
    expect(d.recoveryScore).toBe(Math.round(((s.ciEnergy + s.ciRecovery + s.ciSleep + s.ciConfidence) / 40) * 100));
    expect(d.recoveryScore).toBe(80);
    // old /30 trio (8+7+8) would have been round(76.67) = 77 — confidence is now counted
    expect(d.recoveryScore).not.toBe(77);
  });

  it('sleep-only enabled = round((ciSleep/10)*100)', () => {
    const s = createInitialState();
    const d = computeDerived({ ...s, ciSubmitted: true, ciConfig: { ...allOff, sleep: true } } as AppState);
    expect(d.recoveryScore).toBe(Math.round((s.ciSleep / 10) * 100)); // 8 -> 80
    expect(d.recoveryScore).toBe(80);
  });

  it('soreness-only enabled contributes (10 - ciSoreness) — inverse polarity', () => {
    const s = createInitialState();
    const d = computeDerived({ ...s, ciSubmitted: true, ciSoreness: 4, ciConfig: { ...allOff, soreness: true } } as AppState);
    // round(((10-4)/10)*100) = 60
    expect(d.recoveryScore).toBe(60);
  });

  it('zero enabled questions with ciSubmitted=true falls back to 86', () => {
    const s = createInitialState();
    const d = computeDerived({ ...s, ciSubmitted: true, ciConfig: { ...allOff } } as AppState);
    expect(d.recoveryScore).toBe(86);
  });

  it('unsubmitted check-in still returns 86 (regression guard)', () => {
    const s = createInitialState();
    const d = computeDerived(s);
    expect(s.ciSubmitted).toBe(false);
    expect(d.recoveryScore).toBe(86);
  });
});
