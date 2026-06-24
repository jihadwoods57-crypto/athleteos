// AthleteOS — screen-data smoke net. The jest harness is node-env / pure-core
// (no react-native render preset is installable here — jest 30 conflicts with
// jest-expo's @react-native/jest-preset), so we can't mount the React screens
// themselves. Instead we drive the SAME pure selectors every screen renders from,
// across the edge states that historically break a screen (brand-new athlete,
// genuinely empty day, score at the floor / at 100, and each overseer role), and
// assert nothing throws and every derived value stays coherent (finite, in range,
// non-empty). This catches the class of "an edge state makes a screen crash or
// shows NaN" bug that the deferred mount-every-screen test would catch.
//
// AsyncStorage is mocked so the node env can drive the real Zustand store for the
// activation path; the rest is pure-core.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useStore } from './useStore';
import { createInitialState } from '@/core/defaultState';
import {
  computeDerived,
  emptyDaySlice,
  heroStatus,
  aiInsight,
  coachGuidance,
  mealRowsFor,
  paceProjection,
  trendSeries,
  trendSummary,
  trendGeometry,
  currentStreak,
  realTrendDays,
  recentDayLabels,
  seasonGoalProgress,
  buildLeaderboard,
  supportVisibilityRows,
  athleteSubtitle,
  weeklyCompliance,
  weightSeries,
  weightTrendGeometry,
  nutritionTrend,
  coachRosterKpis,
  trainerBookKpis,
  personBreakdown,
  rosterNoun,
  gradeFor,
  mealResultFor,
  qualityLabel,
  mealCoaching,
  mealScoreImpact,
  ROSTER,
  TRAINER_CLIENTS,
  WEIGHT_START,
  WEIGHT_TARGET,
} from '@/core';
import type { AppState, Flow, MealLabel, SquadMode } from '@/core';

const MEAL_LABELS: MealLabel[] = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];
const SQUAD_MODES: SquadMode[] = ['team', 'position'];

/** Assert a number the UI prints is safe to render (finite, and 0..100 in range). */
function expectScore(n: number) {
  expect(Number.isFinite(n)).toBe(true);
  expect(n).toBeGreaterThanOrEqual(0);
  expect(n).toBeLessThanOrEqual(100);
}

/**
 * Run the full pure-selector bundle that the athlete tabs + the meal-capture
 * overlay render from, plus the parent charts, over one state. Asserts no throw
 * and coherent values. This is the "mount the athlete app" smoke check, minus RN.
 */
function exerciseAthleteSurfaces(s: AppState) {
  const d = computeDerived(s);
  expectScore(d.athleteScore);
  expectScore(d.nutritionScore);
  expect(d.proteinGap).toBeGreaterThanOrEqual(0);

  // Home
  expect(typeof aiInsight(s, d)).toBe('string');
  expect(heroStatus(s, d).line.length).toBeGreaterThan(0);
  const series = trendSeries(s.scoreHistory, d.athleteScore);
  expect(series.length).toBeGreaterThan(0);
  series.forEach(expectScore);
  expect(trendSummary(series)).toHaveProperty('dir');
  expect(trendGeometry(series)).toHaveProperty('linePath');
  const streak = currentStreak(s.scoreHistory, d.athleteScore);
  expect(streak).toBeGreaterThanOrEqual(0);
  expect(realTrendDays(s.scoreHistory)).toBeGreaterThanOrEqual(0);
  expect(recentDayLabels(series.length).length).toBe(series.length);
  expect(seasonGoalProgress(s.currentWeight, WEIGHT_START, s.weightTarget ?? WEIGHT_TARGET)).toHaveProperty('remaining');
  expect(coachGuidance({ isReal: s.athleteName.trim().length > 0, supportTeam: s.supportTeam, coachNote: s.coachNote })).toHaveProperty('show');

  // Nutrition
  expect(mealRowsFor(s).length).toBe(4);
  expect(paceProjection(s.weeklyGoalLb)).toHaveProperty('surplus');

  // Profile
  expect(Array.isArray(supportVisibilityRows(s.supportTeam))).toBe(true);
  expect(typeof athleteSubtitle(s.position, s.sport)).toBe('string');

  // Squad — both segmented modes
  SQUAD_MODES.forEach((m) => {
    const board = buildLeaderboard(m, d.athleteScore);
    expect(board.length).toBeGreaterThan(0);
    board.forEach((r) => expectScore(r.score));
  });

  // Parent charts
  expect(weeklyCompliance(s.scoreHistory, d.athleteScore)).toHaveProperty('pct');
  const ws = weightSeries(s.weightHistory, s.currentWeight, WEIGHT_START);
  expect(ws.length).toBeGreaterThan(0);
  expect(weightTrendGeometry(ws, s.weightTarget ?? WEIGHT_TARGET)).toHaveProperty('linePath');
  expect(nutritionTrend(s.nutritionHistory, d.nutritionScore)).toHaveProperty('bars');

  // MealCapture overlay — every meal slot
  MEAL_LABELS.forEach((m) => {
    const mr = mealResultFor(m);
    expect(qualityLabel(mr.quality)).toHaveProperty('tone');
    const coaching = mealCoaching(m, s.primaryGoal, d, s.scoreHistory.length, s.coachNote);
    expect(coaching.insight.length).toBeGreaterThan(0);
    expect(mealScoreImpact(s, m)).toBeGreaterThanOrEqual(0);
  });
}

/** A brand-new real athlete just past the reveal: own identity, no history, an
 *  empty day, the Starting Point Score written as the day-0 anchor. */
function freshAthleteState(overrides: Partial<AppState> = {}): AppState {
  return {
    ...createInitialState(),
    ...emptyDaySlice(),
    athleteName: 'Marcus Cole',
    role: 'athlete',
    sport: 'Basketball',
    position: 'PG',
    primaryGoal: 'gain_muscle',
    supportTeam: [],
    scoreHistory: [],
    weightHistory: [],
    nutritionHistory: [],
    startScore: 49,
    ...overrides,
  } as AppState;
}

describe('athlete screen-data smoke (edge states do not crash a screen)', () => {
  it('seeded demo day renders coherently', () => {
    expect(() => exerciseAthleteSurfaces(createInitialState())).not.toThrow();
  });

  it('brand-new real athlete (empty day, no history, solo) renders coherently', () => {
    expect(() => exerciseAthleteSurfaces(freshAthleteState())).not.toThrow();
  });

  it('brand-new real athlete who connected a coach renders coherently', () => {
    expect(() => exerciseAthleteSurfaces(freshAthleteState({ supportTeam: ['coach', 'parent'] }))).not.toThrow();
  });

  it('genuinely empty day (nothing logged, no check-in) renders coherently', () => {
    const s = { ...createInitialState(), ...emptyDaySlice(), ciSubmitted: false } as AppState;
    expect(() => exerciseAthleteSurfaces(s)).not.toThrow();
  });

  it('score at the floor (nothing logged, low check-in, not submitted) renders coherently', () => {
    const s = {
      ...createInitialState(),
      ...emptyDaySlice(),
      ciEnergy: 1, ciRecovery: 1, ciSleep: 1, ciConfidence: 1, ciSoreness: 1, ciMotivation: 1,
      ciSubmitted: false,
    } as AppState;
    const d = computeDerived(s);
    expect(d.athleteScore).toBeLessThan(60); // really is a floor-ish state
    expect(() => exerciseAthleteSurfaces(s)).not.toThrow();
  });

  it('a maxed-out day (all meals + tasks done, check-in submitted high) renders coherently', () => {
    const s = {
      ...createInitialState(),
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
      quickAdded: [true, true, true],
      hydrationL: 4,
      tasks: createInitialState().tasks.map((t) => ({ ...t, done: true })),
      ciEnergy: 10, ciRecovery: 10, ciSleep: 10, ciConfidence: 10, ciSoreness: 10, ciMotivation: 10,
      ciSubmitted: true,
    } as AppState;
    const d = computeDerived(s);
    expect(d.athleteScore).toBeGreaterThanOrEqual(90);
    expect(() => exerciseAthleteSurfaces(s)).not.toThrow();
  });
});

describe('overseer dashboard-data smoke (every role surface)', () => {
  it('Coach roster KPIs + per-athlete detail render across the score range', () => {
    expect(() => {
      const roster = ROSTER.map((r) => (r.you ? { ...r, score: 72 } : r));
      const kpis = coachRosterKpis(roster);
      expectScore(kpis.avgScore);
      expect(kpis.alerts).toBeGreaterThanOrEqual(0);
      roster.forEach((r) => {
        const bd = personBreakdown(r.score);
        Object.values(bd).forEach(expectScore);
        expect(gradeFor(r.score)).toHaveProperty('g');
      });
    }).not.toThrow();
  });

  it('Trainer book KPIs + every client detail render', () => {
    expect(() => {
      const kpis = trainerBookKpis(TRAINER_CLIENTS);
      expectScore(kpis.avgCompliance);
      expect(kpis.clients).toBe(TRAINER_CLIENTS.length);
      TRAINER_CLIENTS.forEach((c) => {
        Object.values(personBreakdown(c.score)).forEach(expectScore);
      });
    }).not.toThrow();
  });

  it('the shared person-detail title noun resolves for every flow', () => {
    (['onboarding', 'app', 'coach', 'parent', 'trainer'] as Flow[]).forEach((f) => {
      expect(['Athlete', 'Client']).toContain(rosterNoun(f));
    });
  });

  it('person breakdown is coherent at the extremes (0 and 100)', () => {
    [0, 100].forEach((score) => {
      Object.values(personBreakdown(score)).forEach(expectScore);
    });
  });
});

describe('activation path drives the store into a renderable new-athlete state', () => {
  beforeEach(() => useStore.getState().resetDemo());

  it('startFirstMealChallenge yields an empty day that renders coherently', () => {
    const g = useStore.getState();
    g.setName('Marcus Cole');
    g.setSport('Basketball');
    g.setPrimaryGoal('gain_muscle');
    g.commitStartingScore();
    g.startFirstMealChallenge();
    const s = useStore.getState();
    expect(s.flow).toBe('app');
    expect(s.meals).toEqual({ breakfast: false, lunch: false, snack: false, dinner: false });
    expect(() => exerciseAthleteSurfaces(s)).not.toThrow();
  });
});
