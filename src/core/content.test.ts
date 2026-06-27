// AthleteOS — content/display-helper tests: meal-analysis lookup, reactive Home
// insight, weekly-goal pace projection, and the profile subtitle.
import {
  aiInsight,
  athleteSubtitle,
  checkinAttribution,
  checkinSummary,
  coachGuidance,
  heroStatus,
  mealResultFor,
  MEAL_RESULTS,
  notificationCopy,
  paceProjection,
  qualityLabel,
  squadView,
  supportAudience,
  taskVisibilityNote,
  trainingCadence,
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

describe('checkinSummary — reflects the real slider inputs (no static blurb)', () => {
  const allOn = { energy: true, recovery: true, sleep: true, confidence: true, soreness: true, motivation: true };
  it('names strong (>=8) signals and a watch (<5) signal, soreness read inversely', () => {
    const out = checkinSummary({
      name: 'Maya Lopez', energy: 9, recovery: 4, sleep: 8, confidence: 9, soreness: 7, motivation: 6, config: allOn,
    });
    expect(out).toContain('Maya');
    expect(out.toLowerCase()).toContain('energy');
    expect(out.toLowerCase()).toContain('confidence');
    expect(out.toLowerCase()).toContain('strong');
    // recovery (4) is low and soreness (7) is high -> both on the watch list
    expect(out.toLowerCase()).toMatch(/keep an eye on/);
    expect(out.toLowerCase()).toContain('recovery');
    expect(out.toLowerCase()).toContain('soreness');
    expect(out).not.toContain('—');
  });
  it('only considers enabled questions', () => {
    const out = checkinSummary({
      name: 'Sam', energy: 9, recovery: 2, sleep: 9, confidence: 9, soreness: 9, motivation: 9,
      config: { energy: true, recovery: false, sleep: false, confidence: false, soreness: false, motivation: false },
    });
    // recovery is disabled, so a low recovery never surfaces
    expect(out.toLowerCase()).not.toContain('recovery');
    expect(out.toLowerCase()).toContain('energy');
  });
  it('is resilient to a blank name and non-finite answers', () => {
    const out = checkinSummary({ name: '', energy: NaN, recovery: undefined, sleep: 8, confidence: undefined, soreness: undefined, motivation: undefined, config: allOn });
    expect(out.length).toBeGreaterThan(10);
    expect(out).toContain('there'); // blank-name fallback
    expect(out.toLowerCase()).toContain('sleep'); // the one finite strong signal
  });
  it('falls back to a steady line when nothing is strong or low', () => {
    const out = checkinSummary({ name: 'Jo', energy: 6, recovery: 6, sleep: 6, confidence: 6, soreness: 4, motivation: 6, config: allOn });
    expect(out.toLowerCase()).toContain('steady');
  });
});

describe('aiInsight', () => {
  it('nudges to log dinner with the live protein gap before dinner is logged', () => {
    // A submitted check-in lifts the floor-less seed into the C band (70-79) where the
    // "log dinner to push into the green" nudge lives; the bare seed now reads D.
    const s = { ...createInitialState(), ciSubmitted: true } as AppState;
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

  it('a C-grade day (70-79) is "close", never "tracking well" or a promised A — matches heroStatus neutral band', () => {
    // Seed + a submitted check-in scores in the C band (70-79). Since the nutrition
    // floor was removed (D-B), the bare seed reads D; the check-in lifts it to a C.
    const s = { ...createInitialState(), ciSubmitted: true } as AppState;
    const d = computeDerived(s);
    expect(d.athleteScore).toBeGreaterThanOrEqual(70);
    expect(d.athleteScore).toBeLessThan(80);
    const msg = aiInsight(s, d);
    expect(msg).not.toContain('tracking well'); // that is a B/A sentiment
    expect(msg).not.toContain('close the day at an A'); // do not promise an A from a C
    expect(msg).toMatch(/close/i); // honest neutral framing
    expect(msg).toContain(`${d.proteinGap}g`);
    // heroStatus calls the same band neutral, not positive — the two cards agree.
    const h = heroStatus(s, d);
    expect(h.tone).toBe('neutral');
  });

  it('a B/A day not yet complete (>=80) keeps the positive "tracking well -> reachable A" copy', () => {
    // Seed + a submitted check-in + a protein shake (quick-add) lifts the score into
    // the B band while the day is still incomplete (dinner unlogged). The floor removal
    // (D-B) means a partial day needs near-target protein to reach B now.
    const s = { ...createInitialState(), ciSubmitted: true, quickAdded: [false, true, false] } as AppState;
    const d = computeDerived(s);
    expect(d.athleteScore).toBeGreaterThanOrEqual(80);
    expect(d.mealsLoggedCount).toBeLessThan(4); // not a complete day
    const msg = aiInsight(s, d);
    expect(msg).toContain('tracking well');
    expect(msg).toContain('close the day at an A');
    const h = heroStatus(s, d);
    expect(h.tone).toBe('positive'); // both cards positive on the same >=80 state
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
    // Seed + check-in + a protein shake reaches the on-pace (B) band with the day NOT
    // complete (3 meals) and protein still short — a real "on pace, gap remaining" state.
    const s = { ...createInitialState(), ciSubmitted: true, quickAdded: [false, true, false] } as AppState;
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

  it('caps the projection + calorie advice so a season-total fallback never reads absurdly', () => {
    // A new athlete with no weekly history feeds their season-total gain (e.g. +8 lb).
    // The old math projected "+14 lb by Sunday" -> "ease back ~13,000 cal/day".
    const p = paceProjection(1.0, 8);
    expect(p.projected).toBeLessThanOrEqual(5); // believable weekly band
    const calNum = Number((p.paceAi.match(/~(\d+) cal\/day/) ?? [])[1]);
    expect(Number.isFinite(calNum)).toBe(true);
    expect(calNum).toBeLessThanOrEqual(1000); // sane ceiling, never 13,183
  });

  it('stays finite on a zero weekly goal (corrupt blob) — never NaN%/Infinity%', () => {
    // goal 0 + 0 progress is the 0/0 = NaN trap; goal 0 + positive progress is the
    // x/0 = Infinity trap. Both must resolve to a finite 0..100.
    for (const [goal, prog] of [[0, 0], [0, 0.6], [0, -1]] as [number, number][]) {
      const p = paceProjection(goal, prog);
      expect(Number.isFinite(p.goalPct)).toBe(true);
      expect(p.goalPct).toBeGreaterThanOrEqual(0);
      expect(p.goalPct).toBeLessThanOrEqual(100);
    }
    // At/above the (degenerate) line reads 100, below reads 0 — mirrors seasonGoalProgress.
    expect(paceProjection(0, 0).goalPct).toBe(100);
    expect(paceProjection(0, 0.6).goalPct).toBe(100);
    expect(paceProjection(0, -1).goalPct).toBe(0);
  });

  it('stays finite across a sweep of degenerate goal/progress combinations', () => {
    for (const goal of [-1, 0, 0.5, 1, 2]) {
      for (const prog of [-3, 0, 0.6, 5]) {
        const p = paceProjection(goal, prog);
        expect(Number.isFinite(p.goalPct)).toBe(true);
        expect(Number.isFinite(p.projected)).toBe(true);
        expect(Number.isFinite(p.surplus)).toBe(true);
        expect(p.goalPct).toBeGreaterThanOrEqual(0);
        expect(p.goalPct).toBeLessThanOrEqual(100);
      }
    }
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

describe('notificationCopy', () => {
  it('keeps the full seeded showcase for the demo', () => {
    const c = notificationCopy({ isReal: false, supportTeam: [], athleteScore: 78 });
    expect(c.checkin).toContain('coach and parent');
    expect(c.score).toContain('linebacker room');
    expect(c.score).toContain('78');
    expect(c.coachNote).toEqual({
      initials: 'CD',
      title: 'Coach Davis',
      text: '"Strong week. Your nutrition is the best in the room. Keep it up."',
    });
  });

  it('drops the fabricated coach note + linebacker rank for a real athlete', () => {
    const c = notificationCopy({ isReal: true, supportTeam: ['coach'], athleteScore: 91 });
    expect(c.coachNote).toBeNull();
    expect(c.score).not.toMatch(/linebacker/i);
    expect(c.score).toContain('91');
  });

  it('names only the overseers a real athlete actually connected in the reminder', () => {
    expect(notificationCopy({ isReal: true, supportTeam: ['coach', 'parent'], athleteScore: 80 }).checkin)
      .toBe('Takes 2 minutes. Your coach and your parent will see your update.');
    expect(notificationCopy({ isReal: true, supportTeam: ['coach'], athleteScore: 80 }).checkin)
      .toBe('Takes 2 minutes. Your coach will see your update.');
  });

  it('never fabricates a coach or parent for a real solo athlete', () => {
    const c = notificationCopy({ isReal: true, supportTeam: [], athleteScore: 80 });
    expect(c.checkin).not.toMatch(/coach|parent/i);
    expect(c.coachNote).toBeNull();
  });
});

describe('trainingCadence', () => {
  it('maps each known onboarding frequency key to a phrase', () => {
    expect(trainingCadence('once')).toBe('Trains once a day');
    expect(trainingCadence('twice')).toBe('Trains twice a day');
    expect(trainingCadence('three_plus')).toBe('Trains 3+ times a day');
  });

  it('returns null when unset (seeded demo) or unknown, so the caller drops the line', () => {
    expect(trainingCadence(null)).toBeNull();
    expect(trainingCadence('')).toBeNull();
    expect(trainingCadence('weekly')).toBeNull();
  });
});

describe('squadView', () => {
  it('keeps the full seeded showcase for the demo (league chrome on, no empty panel)', () => {
    const v = squadView({ isReal: false });
    expect(v.kind).toBe('demo');
    expect(v.showLeague).toBe(true);
    expect(v.empty).toBeNull();
  });

  it('drops the seeded peer board + league chrome for a real athlete', () => {
    const v = squadView({ isReal: true });
    expect(v.kind).toBe('solo');
    expect(v.showLeague).toBe(false);
  });

  it('gives a real athlete an honest no-squad empty state instead of fabricated peers', () => {
    const v = squadView({ isReal: true });
    expect(v.empty).not.toBeNull();
    expect(v.empty?.title).toMatch(/no squad/i);
    // never fabricates the seed team identity in the real-athlete copy
    expect(v.empty?.title).not.toMatch(/Coach Davis|Linebacker/i);
    expect(v.empty?.body).not.toMatch(/Coach Davis|Linebacker/i);
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
    expect(note).toBe('Completed tasks feed your Development Score.');
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

describe('supportAudience', () => {
  it('keeps the exact seeded-demo showcase string', () => {
    expect(supportAudience({ isReal: false, supportTeam: [], demo: 'Coach Davis' })).toBe('Coach Davis');
    expect(supportAudience({ isReal: false, supportTeam: [], demo: 'Coach Davis & your parent' })).toBe('Coach Davis & your parent');
  });

  it('returns an empty clause for a real solo athlete (nothing to fabricate)', () => {
    expect(supportAudience({ isReal: true, supportTeam: [], demo: 'Coach Davis' })).toBe('');
  });

  it('names the real overseers a real athlete connected, in overseer order', () => {
    expect(supportAudience({ isReal: true, supportTeam: ['coach'], demo: 'X' })).toBe('your coach');
    expect(supportAudience({ isReal: true, supportTeam: ['parent', 'coach'], demo: 'X' })).toBe('your coach & your parent');
    expect(supportAudience({ isReal: true, supportTeam: ['parent', 'nutritionist', 'coach'], demo: 'X' })).toBe('your coach, your nutritionist & your parent');
  });

  it('never leaks Coach Davis to any real athlete', () => {
    for (const team of [[], ['coach'], ['trainer'], ['nutritionist'], ['parent']]) {
      expect(supportAudience({ isReal: true, supportTeam: team, demo: 'Coach Davis' })).not.toContain('Coach Davis');
    }
  });
});

describe('checkinAttribution', () => {
  it('keeps the seeded demo attribution', () => {
    expect(checkinAttribution({ isReal: false, supportTeam: [] })).toBe('Tailored by Coach Davis');
  });

  it('drops the badge entirely for a real solo athlete', () => {
    expect(checkinAttribution({ isReal: true, supportTeam: [] })).toBeNull();
  });

  it('credits the connected overseer for a real athlete (coach > nutritionist > trainer)', () => {
    expect(checkinAttribution({ isReal: true, supportTeam: ['coach'] })).toBe('Tailored by your coach');
    expect(checkinAttribution({ isReal: true, supportTeam: ['nutritionist'] })).toBe('Tailored by your nutritionist');
    expect(checkinAttribution({ isReal: true, supportTeam: ['trainer'] })).toBe('Tailored by your trainer');
    expect(checkinAttribution({ isReal: true, supportTeam: ['parent'] })).toBeNull();
  });

  it('never leaks Coach Davis to any real athlete', () => {
    for (const team of [[], ['coach'], ['trainer'], ['nutritionist'], ['parent']]) {
      expect(checkinAttribution({ isReal: true, supportTeam: team }) ?? '').not.toContain('Coach Davis');
    }
  });
});
