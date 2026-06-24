// AthleteOS — content/display-helper tests: meal-analysis lookup, reactive Home
// insight, weekly-goal pace projection, and the profile subtitle.
import {
  aiInsight,
  athleteSubtitle,
  coachGuidance,
  heroStatus,
  mealResultFor,
  MEAL_RESULTS,
  paceProjection,
  qualityLabel,
  taskVisibilityNote,
} from './content';
import { computeDerived, gradeFor } from './scoring';
import { createInitialState } from './defaultState';
import type { AppState, Derived, MealLabel } from './types';

const FALSE_CLAIM = 'on pace to hit every weekly goal';

describe('mealResultFor', () => {
  it('returns the matching analysis for each meal type', () => {
    (['Breakfast', 'Lunch', 'Snack', 'Dinner'] as MealLabel[]).forEach((m) => {
      expect(mealResultFor(m)).toBe(MEAL_RESULTS[m]);
    });
  });

  it('falls back to Dinner for an unknown label', () => {
    expect(mealResultFor('Brunch' as MealLabel)).toBe(MEAL_RESULTS.Dinner);
  });
});

describe('qualityLabel', () => {
  it('maps score boundaries to the right label + tone', () => {
    expect(qualityLabel(94)).toEqual({ label: 'EXCELLENT', tone: 'success' });
    expect(qualityLabel(90)).toEqual({ label: 'EXCELLENT', tone: 'success' });
    expect(qualityLabel(89)).toEqual({ label: 'GOOD', tone: 'accent' });
    expect(qualityLabel(80)).toEqual({ label: 'GOOD', tone: 'accent' });
    expect(qualityLabel(79)).toEqual({ label: 'FAIR', tone: 'accent' });
    expect(qualityLabel(70)).toEqual({ label: 'FAIR', tone: 'accent' });
    expect(qualityLabel(69)).toEqual({ label: 'NEEDS WORK', tone: 'warning' });
  });

  it('returns a tone token-name (union string), never a hex color', () => {
    [95, 85, 75, 50].forEach((v) => {
      expect(['success', 'accent', 'warning']).toContain(qualityLabel(v).tone);
      expect(qualityLabel(v).tone).not.toMatch(/^#/);
    });
  });

  it('89 reads GOOD, not EXCELLENT (the original badge bug)', () => {
    const q = qualityLabel(89);
    expect(q.label).toBe('GOOD');
    expect(q.label).not.toBe('EXCELLENT');
  });

  it('grants the success tone over MEAL_RESULTS exactly when (iff) the entry scores >= 90', () => {
    Object.values(MEAL_RESULTS).forEach((r) => {
      expect(qualityLabel(r.quality).tone === 'success').toBe(r.quality >= 90);
    });
    // Current seed pins: Breakfast 90 / Lunch 92 / Dinner 94 → success; Snack 89 → accent.
    expect(qualityLabel(MEAL_RESULTS.Breakfast.quality).tone).toBe('success');
    expect(qualityLabel(MEAL_RESULTS.Lunch.quality).tone).toBe('success');
    expect(qualityLabel(MEAL_RESULTS.Dinner.quality).tone).toBe('success');
    expect(qualityLabel(MEAL_RESULTS.Snack.quality)).toEqual({ label: 'GOOD', tone: 'accent' });
  });
});

describe('aiInsight', () => {
  it('nudges to log dinner with the live protein gap before dinner is logged', () => {
    const s = createInitialState();
    const d = computeDerived(s);
    const msg = aiInsight(s, d);
    expect(msg).toContain(`${d.proteinGap}g`);
    expect(msg).toContain('log dinner');
  });

  it('flips to the day-complete message only when all four are logged AND protein meets target', () => {
    const s = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: true, dinner: true } } as AppState;
    const d = computeDerived(s);
    // Gate is BOTH conditions; assert they hold for this state before expecting the copy.
    expect(d.mealsLoggedCount).toBe(4);
    expect(d.proteinToday >= d.proteinTarget).toBe(true);
    expect(aiInsight(s, d)).toContain('Day complete');
  });

  it('does not claim day complete when only dinner is logged', () => {
    const s = { ...createInitialState(), meals: { breakfast: false, lunch: false, snack: false, dinner: true } } as AppState;
    const d = computeDerived(s);
    const msg = aiInsight(s, d);
    expect(msg).not.toContain('Day complete');
    // Truthful nudge: shows the live protein gap and points at the remaining work,
    // not the misleading "log dinner" (dinner is already logged).
    expect(msg).toContain(`${d.proteinGap}g`);
    expect(msg).toContain('remaining meals');
    expect(msg).not.toContain('log dinner');
  });

  it('a behind athlete (empty day, score < 70) is told the honest truth, never "tracking well" or a reachable A', () => {
    const s = {
      ...createInitialState(),
      meals: { breakfast: false, lunch: false, snack: false, dinner: false },
      hydrationL: 0,
      quickAdded: [false, false, false],
      tasks: createInitialState().tasks.map((t) => ({ ...t, done: false })),
      ciSubmitted: false,
    } as AppState;
    const d = computeDerived(s);
    // The band is REAL (driven through computeDerived), not hand-set.
    expect(d.athleteScore).toBeLessThan(70);

    const msg = aiInsight(s, d);
    expect(msg).toMatch(/behind/i);
    expect(msg).not.toContain('tracking well');
    expect(msg).not.toContain('close the day at an A');
    // Still honest + actionable: it shows the live protein gap.
    expect(msg).toContain(`${d.proteinGap}g`);
  });

  it('does not contradict heroStatus: both go warn/behind on the same sub-70 state', () => {
    const s = {
      ...createInitialState(),
      meals: { breakfast: false, lunch: false, snack: false, dinner: false },
      ciSubmitted: false,
    } as AppState;
    const d = computeDerived(s);
    expect(d.athleteScore).toBeLessThan(70);
    const h = heroStatus(s, d);
    const msg = aiInsight(s, d);
    expect(h.tone).toBe('warn');
    expect(h.line.toLowerCase()).toContain('behind');
    expect(msg.toLowerCase()).toContain('behind'); // the two cards agree
  });

  it('gates the day-complete copy on the protein boundary, not meals alone', () => {
    // MEAL_MACROS protein sums to 42+51+49+52 = 194g, which always >= the 180g
    // PROTEIN_TARGET. So an "all-four-logged but protein below target" state is
    // UNREACHABLE from the fixed macros without scoring changes (out of scope).
    // Per the acceptance escape clause, assert the boundary directly instead.
    const s = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: true, dinner: true } } as AppState;
    const d = computeDerived(s);
    expect(d.mealsLoggedCount).toBe(4);
    expect(d.proteinToday >= d.proteinTarget).toBe(true); // boundary held → both arms satisfied
    expect(aiInsight(s, d)).toContain('Day complete');
  });
});

describe('heroStatus', () => {
  it('day-complete A-day → positive tone, streak/complete copy, never "behind" or the false on-pace claim', () => {
    const s = {
      ...createInitialState(),
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
      ciSubmitted: true,
    } as AppState;
    const d = computeDerived(s);
    // Verify the fixture actually lands in the day-complete A band before asserting.
    expect(d.mealsLoggedCount).toBe(4);
    expect(d.proteinToday >= d.proteinTarget).toBe(true);
    expect(d.athleteScore).toBeGreaterThanOrEqual(90);

    const h = heroStatus(s, d);
    expect(h.tone).toBe('positive');
    expect(h.line).toMatch(/streak|complete/i);
    expect(h.line.toLowerCase()).not.toContain('behind');
    expect(h.line).not.toContain(FALSE_CLAIM);
    expect(h.standingLabel).toBe('Top of your team'); // grade A
  });

  it('day-complete but sub-90 (B band, unsubmitted check-in) → complete copy with no ask/nag', () => {
    // All four meals logged + protein cleared, but the check-in is unsubmitted so the
    // score lands in [80,89]. This used to fall through the lone `dayComplete && >=90`
    // guard into the score-band branch and nag "finish the day strong" via `ask`.
    const s = {
      ...createInitialState(),
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
      ciSubmitted: false,
    } as AppState;
    const d = computeDerived(s);
    // Band is REAL (driven through computeDerived), not hand-set.
    expect(d.mealsLoggedCount).toBe(4);
    expect(d.proteinToday >= d.proteinTarget).toBe(true);
    expect(d.athleteScore).toBeGreaterThanOrEqual(80);
    expect(d.athleteScore).toBeLessThan(90);

    const h = heroStatus(s, d);
    expect(h.line).toMatch(/complete/i);
    ['to go', 'left to log', 'finish the day strong'].forEach((p) =>
      expect(h.line).not.toContain(p),
    );
    expect(h.line).not.toContain(`${d.proteinGap}g`); // proteinGap never interpolated
  });

  it('on-pace partial day → not warn, references the real proteinGap, never the false on-pace claim', () => {
    const s = { ...createInitialState(), ciSubmitted: true } as AppState;
    const d = computeDerived(s);
    // Bump into the on-pace (B) band but day NOT complete (3 meals).
    expect(d.athleteScore).toBeGreaterThanOrEqual(80);
    expect(d.athleteScore).toBeLessThan(90);
    expect(d.mealsLoggedCount).toBeLessThan(4);
    expect(d.proteinGap).toBeGreaterThan(0);

    const h = heroStatus(s, d);
    expect(h.tone).not.toBe('warn');
    expect(h.line).toContain(`${d.proteinGap}g`);
    expect(h.line).not.toContain(FALSE_CLAIM);
  });

  it('behind state (no meals, no check-in) → warn tone, honest "behind" copy, never the false on-pace claim', () => {
    const s = {
      ...createInitialState(),
      meals: { breakfast: false, lunch: false, snack: false, dinner: false },
      ciSubmitted: false,
    } as AppState;
    const d = computeDerived(s);
    expect(d.athleteScore).toBeLessThan(70);

    const h = heroStatus(s, d);
    expect(h.tone).toBe('warn');
    expect(h.line).toMatch(/behind/i);
    expect(h.line).toContain(`${d.proteinGap}g`);
    expect(h.line).not.toContain(FALSE_CLAIM);
  });

  it('maps each grade to a standingLabel with no fabricated percentile', () => {
    const base = computeDerived(createInitialState());
    const at = (score: number): Derived => ({ ...base, athleteScore: score, grade: gradeFor(score) });
    const cases: [number, string][] = [
      [95, 'Top of your team'],     // A
      [85, 'Upper third of your team'], // B
      [75, 'Middle of your team'],  // C
      [65, 'Work to do this week'], // D
      [55, 'Work to do this week'], // F
    ];
    cases.forEach(([score, label]) => {
      const h = heroStatus(createInitialState(), at(score));
      expect(h.standingLabel).toBe(label);
      expect(h.standingLabel).not.toContain('%');
      expect(h.standingLabel).not.toContain('Top 12%');
    });
  });
});

describe('paceProjection', () => {
  it('projects +1.1 lb at the default 1.0 lb/week goal (on pace)', () => {
    // progressLb 0.6 over 4 days -> (0.6/4)*7 = 1.05, .toFixed(1) -> 1.1
    const p = paceProjection(1.0);
    expect(p.projected).toBe(1.1);
    expect(p.onPace).toBe(true); // 1.1 >= 1.0 - eps
    expect(p.paceLabel).toBe('↑ On pace');
  });

  it('reports behind pace for an aggressive goal', () => {
    const p = paceProjection(2.0);
    expect(p.projected).toBe(1.1);
    expect(p.onPace).toBe(false);
    expect(p.paceLabel).toBe('↓ Behind pace');
    expect(p.paceAi).toContain('Add');
  });

  it('caps the goal-progress percentage at 100', () => {
    const p = paceProjection(0.5); // 0.6/0.5 = 120% -> clamp 100
    expect(p.goalPct).toBe(100);
  });

  it('computes the daily surplus from the weekly goal', () => {
    // round(goal * 3500 / 7)
    expect(paceProjection(1.0).surplus).toBe(500);
    expect(paceProjection(2.0).surplus).toBe(1000);
  });

  it('always leaves 3 days remaining (prototype constant)', () => {
    expect(paceProjection(1.0).daysLeft).toBe(3);
  });

  it('defaults progressLb to the seeded showcase (0.6) when omitted', () => {
    expect(paceProjection(1.0).progressLb).toBe(0.6);
  });

  it('takes a real athlete\'s weekly progress and echoes it back', () => {
    const p = paceProjection(1.5, 0); // brand-new athlete: 0 gained
    expect(p.progressLb).toBe(0);
    expect(p.projected).toBe(0);
    expect(p.goalPct).toBe(0); // clamped, never negative
    expect(p.onPace).toBe(false);
  });

  it('never returns a negative goal percentage on a cut', () => {
    expect(paceProjection(1.0, -2).goalPct).toBe(0);
  });
});

describe('athleteSubtitle', () => {
  it('expands a known position abbreviation', () => {
    expect(athleteSubtitle('QB')).toBe('Quarterback · Eastside HS');
    expect(athleteSubtitle('LB')).toBe('Linebacker · Eastside HS');
  });

  it('passes through an unknown abbreviation verbatim', () => {
    expect(athleteSubtitle('XYZ')).toBe('XYZ · Eastside HS');
  });

  it('defaults to Linebacker when no position is set', () => {
    expect(athleteSubtitle(null)).toBe('Linebacker · Eastside HS');
  });
});

describe('coachGuidance', () => {
  const NOTE = 'Ease up on refined carbs at dinner.';

  it('keeps the seeded demo showcase: Coach Davis note, no gating', () => {
    const g = coachGuidance({ isReal: false, supportTeam: [], coachNote: NOTE });
    expect(g).toEqual({ show: true, monogram: 'CD', note: NOTE, pending: false });
  });

  it('hides the card for a real solo athlete (no coach to quote)', () => {
    const g = coachGuidance({ isReal: true, supportTeam: [], coachNote: NOTE });
    expect(g.show).toBe(false);
    expect(g.note).toBeNull();
  });

  it('does not leak the seeded note even when the real athlete is solo', () => {
    const g = coachGuidance({ isReal: true, supportTeam: ['parent'], coachNote: NOTE });
    // parent is not a meal-guidance overseer
    expect(g.show).toBe(false);
    expect(g.note).toBeNull();
  });

  it('shows a pending empty state for a real athlete who connected a coach', () => {
    const g = coachGuidance({ isReal: true, supportTeam: ['coach'], coachNote: NOTE });
    expect(g).toEqual({ show: true, monogram: 'C', note: null, pending: true });
  });

  it('uses the nutritionist monogram when only a nutritionist is connected', () => {
    const g = coachGuidance({ isReal: true, supportTeam: ['nutritionist'], coachNote: NOTE });
    expect(g.monogram).toBe('N');
    expect(g.pending).toBe(true);
    expect(g.note).toBeNull();
  });

  it('prefers the coach monogram when both coach and nutritionist are connected', () => {
    const g = coachGuidance({ isReal: true, supportTeam: ['nutritionist', 'coach'], coachNote: NOTE });
    expect(g.monogram).toBe('C');
  });
});

describe('taskVisibilityNote', () => {
  it('keeps the seeded demo showcase (Coach Davis)', () => {
    expect(taskVisibilityNote({ isReal: false, supportTeam: [] })).toContain('Coach Davis');
  });

  it('drops the coach clause for a real solo athlete (no coach to leak)', () => {
    const note = taskVisibilityNote({ isReal: true, supportTeam: [] });
    expect(note).not.toContain('Coach Davis');
    expect(note).not.toContain('visible to');
    expect(note).toBe('Completed tasks feed your Athlete Score.');
  });

  it('names the connected overseer for a real athlete (coach > trainer > nutritionist)', () => {
    expect(taskVisibilityNote({ isReal: true, supportTeam: ['coach'] })).toContain('your coach');
    expect(taskVisibilityNote({ isReal: true, supportTeam: ['trainer'] })).toContain('your trainer');
    expect(taskVisibilityNote({ isReal: true, supportTeam: ['nutritionist'] })).toContain('your nutritionist');
    expect(taskVisibilityNote({ isReal: true, supportTeam: ['nutritionist', 'coach'] })).toContain('your coach');
  });

  it('never leaks Coach Davis to any real athlete', () => {
    for (const team of [[], ['coach'], ['trainer'], ['nutritionist'], ['parent']]) {
      expect(taskVisibilityNote({ isReal: true, supportTeam: team })).not.toContain('Coach Davis');
    }
  });
});
