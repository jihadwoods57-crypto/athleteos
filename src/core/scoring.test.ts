// AthleteOS — scoring engine tests. Asserts the ported math against the
// prototype's default state and known transitions.
import { computeDerived, gradeFor, seasonGoalProgress } from './scoring';
import { createInitialState } from './defaultState';
import { HYDRATION_TARGET } from './constants';
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

  it('check-in sub-score is 0 when the athlete has not submitted the daily check-in', () => {
    expect(s.ciSubmitted).toBe(false);
    expect(d.checkinScore).toBe(0);
  });

  it('athlete score = clamp(round(.4*92 + .2*86 + .2*95 + .1*67 + .1*0)) = 80', () => {
    // 36.8 + 17.2 + 19 + 6.7 + 0 = 79.7 -> 80
    expect(d.athleteScore).toBe(80);
    expect(d.grade.g).toBe('B');
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

  it('check-in sub-score jumps to 100 once the daily check-in is submitted', () => {
    expect(computeDerived({ ...createInitialState(), ciSubmitted: true } as AppState).checkinScore).toBe(100);
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

describe('computeDerived — hydrationPct clamp', () => {
  it('over-target hydrationL (4.5, e.g. corrupt/legacy persisted) clamps to 100, never >100', () => {
    const s = createInitialState();
    const d = computeDerived({ ...s, hydrationL: 4.5 } as AppState);
    expect(d.hydrationPct).toBe(100);
    expect(d.hydrationPct).toBeLessThanOrEqual(100);
  });

  it('at-target hydrationL (3.8) is exactly 100', () => {
    const s = createInitialState();
    const d = computeDerived({ ...s, hydrationL: HYDRATION_TARGET } as AppState);
    expect(d.hydrationPct).toBe(100);
  });

  it('under-target hydrationL (1.9) is the correct rounded pct (50)', () => {
    const s = createInitialState();
    const d = computeDerived({ ...s, hydrationL: 1.9 } as AppState);
    // round(1.9 / 3.8 * 100) = 50
    expect(d.hydrationPct).toBe(50);
  });

  it('default-state hydrationL (2.4) is 63 — clamp is a no-op in the happy path', () => {
    const s = createInitialState();
    const d = computeDerived(s);
    // round(2.4 / 3.8 * 100) = 63; in range so clamp does not alter the bar
    expect(d.hydrationPct).toBe(63);
  });
});

describe('addWater hydration threshold (couples task id 4 to HYDRATION_TARGET)', () => {
  // Pure simulation of the store's addWater step math (useStore.ts addWater):
  //   h = Math.min(HYDRATION_TARGET, +(prev + 0.3).toFixed(1))
  //   task id 4 done = h >= HYDRATION_TARGET
  // No Zustand / AsyncStorage / RN import — keeps src/core pure (no store harness exists).
  const step = (prev: number) => Math.min(HYDRATION_TARGET, +(prev + 0.3).toFixed(1));
  const isDone = (h: number) => h >= HYDRATION_TARGET;

  it('the threshold is HYDRATION_TARGET, not the old magic 3.7', () => {
    expect(HYDRATION_TARGET).not.toBe(3.7);
    // 3.7 must NOT flip the task done; only at/after the target does it complete.
    expect(isDone(3.7)).toBe(false);
    expect(isDone(HYDRATION_TARGET)).toBe(true);
  });

  it('task id 4 is NOT done for any step strictly below the target, and done once it reaches it', () => {
    const s = createInitialState();
    expect(s.hydrationL).toBe(2.4); // default start
    expect(s.tasks.find((t) => t.id === 4)?.done).toBe(false);

    let h = s.hydrationL;
    let flippedAt: number | null = null;
    for (let i = 0; i < 20; i++) {
      const done = isDone(h);
      if (done && flippedAt === null) flippedAt = h;
      if (!done) {
        // every value below the target leaves the task incomplete
        expect(h).toBeLessThan(HYDRATION_TARGET);
      } else {
        // once complete, it only happens at/after the target
        expect(h).toBeGreaterThanOrEqual(HYDRATION_TARGET);
      }
      h = step(h);
    }
    // It does eventually complete, and exactly at the target (cap snaps to 3.8).
    expect(flippedAt).toBe(HYDRATION_TARGET);
  });

  it('the step math caps at HYDRATION_TARGET (Math.min) and never overshoots', () => {
    let h = 2.4;
    for (let i = 0; i < 20; i++) h = step(h);
    expect(h).toBe(HYDRATION_TARGET);
    expect(h).toBeLessThanOrEqual(HYDRATION_TARGET);
  });
});
