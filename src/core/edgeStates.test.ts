// OnStandard — edge-state correctness net. Proves the scoring engine produces a
// finite, in-range result and never throws across the boundary conditions the
// product can actually reach: a fully empty day, a fully complete day, score
// boundaries, undefined optional fields, out-of-range inputs, and zero targets.
import { computeDerived, gradeFor, seasonGoalProgress } from './scoring';
import { createInitialState } from './defaultState';
import { STARTING_WEIGHTS, startingScore } from './startingScore';
import type { AppState, Derived } from './types';

const ranges: Partial<Record<keyof Derived, [number, number]>> = {
  athleteScore: [0, 100],
  nutritionScore: [0, 100],
  recoveryScore: [0, 100],
  weightScore: [0, 100],
  tasksScore: [0, 100],
  checkinScore: [0, 100],
  proteinPct: [0, 100],
  carbPct: [0, 100],
  fatPct: [0, 100],
  hydrationPct: [0, 100],
};

function assertSane(d: Derived) {
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'number') {
      expect(Number.isFinite(v)).toBe(true); // no NaN, no Infinity
    }
  }
  // Score is an integer 0..100.
  expect(Number.isInteger(d.athleteScore)).toBe(true);
  for (const [k, [lo, hi]] of Object.entries(ranges) as [keyof Derived, [number, number]][]) {
    expect(d[k] as number).toBeGreaterThanOrEqual(lo);
    expect(d[k] as number).toBeLessThanOrEqual(hi);
  }
  // Ring offsets are finite and non-negative (SVG dashoffset).
  expect(d.ringOffset).toBeGreaterThanOrEqual(0);
  expect(d.proteinRingOffset).toBeGreaterThanOrEqual(0);
}

describe('computeDerived — never throws, always sane', () => {
  const base = createInitialState();
  const fullyEmpty: Partial<AppState> = {
    meals: { breakfast: false, lunch: false, snack: false, dinner: false },
    hydrationL: 0,
    quickAdded: [false, false, false],
    nudged: [],
    tasks: base.tasks.map((t) => ({ ...t, done: false })),
    ciSubmitted: false,
    scoreHistory: [],
  };
  const fullyComplete: Partial<AppState> = {
    meals: { breakfast: true, lunch: true, snack: true, dinner: true },
    hydrationL: 3.8,
    quickAdded: [true, true, true],
    tasks: base.tasks.map((t) => ({ ...t, done: true })),
    ciSubmitted: true,
    ciEnergy: 10,
    ciRecovery: 10,
    ciSleep: 10,
    ciConfidence: 10,
    dailyCommitment: 'yes',
  };

  const cases: [string, Partial<AppState>][] = [
    ['default seeded day', {}],
    ['fully empty day', fullyEmpty],
    ['fully complete day', fullyComplete],
    ['zero protein target (corrupt blob)', { proteinTarget: 0 }],
    ['zero protein target + empty meals (0/0 guard)', { proteinTarget: 0, ...fullyEmpty }],
    ['negative protein target', { proteinTarget: -50 }],
    ['zero calorie target', { calTarget: 0 }],
    ['undefined optional targets + history', { proteinTarget: undefined, calTarget: undefined, scoreHistory: undefined } as Partial<AppState>],
    ['out-of-range hydration (negative)', { hydrationL: -10 }],
    ['out-of-range hydration (huge)', { hydrationL: 9999 }],
    ['all check-in questions disabled', { ciSubmitted: true, ciConfig: { energy: false, recovery: false, sleep: false, confidence: false, soreness: false, motivation: false } }],
  ];

  cases.forEach(([name, patch]) => {
    it(`stays finite + in range: ${name}`, () => {
      let d: Derived | undefined;
      expect(() => { d = computeDerived({ ...base, ...patch } as AppState); }).not.toThrow();
      assertSane(d as Derived);
    });
  });

  it('a fully complete day lands an A (>= 90)', () => {
    const d = computeDerived({ ...base, ...fullyComplete } as AppState);
    expect(d.athleteScore).toBeGreaterThanOrEqual(90);
    expect(d.grade.g).toBe('A');
  });

  it('a fully empty day is still a finite, low, defined-grade score', () => {
    const d = computeDerived({ ...base, ...fullyEmpty } as AppState);
    assertSane(d);
    expect(d.mealsLoggedCount).toBe(0);
    expect(typeof d.grade.g).toBe('string');
  });
});

describe('gradeFor — grade boundaries are exact and total (0..100)', () => {
  const expected: [number, string][] = [
    [0, 'F'], [59, 'F'],
    [60, 'D'], [69, 'D'],
    [70, 'C'], [79, 'C'],
    [80, 'B'], [89, 'B'],
    [90, 'A'], [100, 'A'],
  ];
  it('maps every boundary to the right letter', () => {
    expected.forEach(([score, g]) => expect(gradeFor(score).g).toBe(g));
  });
  it('returns a color pair for every score in 0..100 (no gap)', () => {
    for (let sc = 0; sc <= 100; sc++) {
      const g = gradeFor(sc);
      expect(typeof g.g).toBe('string');
      expect(g.bg).toMatch(/^#/);
      expect(g.c).toMatch(/^#/);
    }
  });
});

describe('startingScore — weights sum to exactly 100', () => {
  it('the documented per-answer weights total 100', () => {
    const sum = Object.values(STARTING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('clamps to 0..100 across extreme and out-of-range answers', () => {
    const extremes = [
      { nutritionConfidence: -9, mealsPerDay: -9, waterL: -9, sleepH: -9, proteinFreq: -9, consistency: -9 },
      { nutritionConfidence: 99, mealsPerDay: 99, waterL: 99, sleepH: 99, proteinFreq: 99, consistency: 99 },
    ];
    extremes.forEach((a) => {
      const v = startingScore(a);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });
});

describe('seasonGoalProgress — finite + in range across a full sweep', () => {
  it('never yields NaN/Infinity for any current/start/target combination', () => {
    for (const start of [120, 171, 184, 250]) {
      for (const target of [120, 171, 184, 250]) {
        for (const cur of [100, 171, 184, 300]) {
          const r = seasonGoalProgress(cur, start, target);
          expect(Number.isFinite(r.pctThere)).toBe(true);
          expect(Number.isFinite(r.remaining)).toBe(true);
          expect(r.pctThere).toBeGreaterThanOrEqual(0);
          expect(r.pctThere).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
