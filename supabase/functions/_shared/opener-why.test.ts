// A2 "why this matters": the library's rails, the topic pick, the variant pick, and the opener
// wiring (meta.why is a separate field, never part of the text).
import { WHY_LIBRARY, WHY_MAX, PHASE_WHY, openerWhy, whyGoal, whyTopic, whyPhase, type WhyGoal, type WhyTopic, type WhyPhase } from './opener-why';
import { composeOpener } from './meal-opener';
import { violatesStyleLanguage } from './plan-style';
import { scrubToolLeak } from './tool-leak';

const GOALS: WhyGoal[] = ['gain', 'lose', 'maintain', 'perform'];
const TOPICS: WhyTopic[] = ['short', 'closed', 'carbs', 'late', 'snack'];
const ALL = GOALS.flatMap((g) => TOPICS.flatMap((t) => WHY_LIBRARY[g][t].map((line) => ({ g, t, line }))));
const WEIGHT = /\b(weight|weigh|weighs|lbs?|pounds?|scale|deficit|surplus|cut|cutting|bulk|bulking|lose|losing|slim|diet|calories?|kcal)\b/i;

describe('the why library holds its rails on every line', () => {
  it('has at least three variants for every goal and topic', () => {
    for (const g of GOALS) for (const t of TOPICS) expect(WHY_LIBRARY[g][t].length).toBeGreaterThanOrEqual(3);
  });
  it.each(ALL.map((x) => [`${x.g}/${x.t}: ${x.line.slice(0, 40)}`, x.line]))('%s', (_n, line) => {
    expect(line.length).toBeGreaterThan(20);
    expect(line.length).toBeLessThanOrEqual(WHY_MAX);
    expect(line).not.toMatch(/\d/);                         // no figures: it serves Intuitive too
    expect(violatesStyleLanguage(line, 'intuitive')).toBeNull();
    expect(scrubToolLeak(line)).toBe(line);                   // the scrubber is never needed
    expect(line).not.toMatch(/[—–<>{}]/);                     // no dashes, no markup
    expect(line).not.toMatch(WEIGHT);                         // no weight language, any family
    expect(line).toMatch(/[.!?]$/);
  });
  it('no two lines are the same', () => {
    expect(new Set(ALL.map((x) => x.line)).size).toBe(ALL.length);
  });
});

describe('goal and topic', () => {
  it('reads every stored goal spelling; unknown is perform', () => {
    expect(whyGoal('build')).toBe('gain');
    expect(whyGoal('gain_weight')).toBe('gain');
    expect(whyGoal('lose_fat')).toBe('lose');
    expect(whyGoal('health')).toBe('maintain');
    expect(whyGoal('performance')).toBe('perform');
    expect(whyGoal(null)).toBe('perform');
    expect(whyGoal('something')).toBe('perform');
  });
  it('keys the topic on the move the day line made', () => {
    expect(whyTopic({ gap: 0, remaining: 2, late: true, slot: 'Lunch' })).toBe('closed');
    expect(whyTopic({ gap: 30, remaining: 0, late: false, slot: 'Dinner' })).toBe('snack');
    expect(whyTopic({ gap: 30, remaining: 2, late: true, slot: 'Lunch' })).toBe('late');
    expect(whyTopic({ gap: 30, remaining: 2, late: false, slot: 'Lunch' })).toBe('short');
    expect(whyTopic({ gap: null, remaining: null, late: true, slot: 'Lunch' })).toBe('late');
    expect(whyTopic({ gap: null, remaining: null, late: false, slot: 'Snack' })).toBe('snack');
    expect(whyTopic({ gap: null, remaining: null, late: null, slot: 'Breakfast' })).toBe('carbs');
  });
});

describe('variant pick', () => {
  it('is stable for one meal and spreads across meals', () => {
    const a = openerWhy({ goal: 'gain', topic: 'short', mealId: 'meal-1' });
    expect(openerWhy({ goal: 'gain', topic: 'short', mealId: 'meal-1' })).toEqual(a);
    const seen = new Set(Array.from({ length: 30 }, (_, i) => openerWhy({ goal: 'gain', topic: 'short', mealId: `m-${i}` }).text));
    expect(seen.size).toBe(3);
  });
  it('a minor always gets the training family, labelled train, whatever the goal', () => {
    for (const g of ['gain', 'lose', 'maintain', 'performance']) {
      for (const t of TOPICS) {
        const w = openerWhy({ goal: g, minor: true, topic: t, mealId: 'x' });
        expect(w.goal).toBe('train');
        expect(WHY_LIBRARY.perform[t]).toContain(w.text);
      }
    }
  });
});

describe('the opener carries it beside the text, never in it', () => {
  const read = { name: 'Chicken bowl', analysis: 'Real protein and a starch, which is what a training day wants. Add a fruit next time.', detected: [] };
  it('keys on the day line: short, closed, snack', () => {
    const short = composeOpener(read, { goal: 'gain', mealId: 'a', day: { proteinIncludingThisMeal: 60, proteinTarget: 180, mealsRemaining: 2 } });
    expect(short.why && short.why.topic).toBe('short');
    expect(short.why && short.why.goal).toBe('gain');
    expect(short.text).not.toContain(short.why!.text);
    const closed = composeOpener(read, { goal: 'lose', mealId: 'a', day: { proteinIncludingThisMeal: 190, proteinTarget: 180, mealsRemaining: 1 } });
    expect(closed.why && closed.why.topic).toBe('closed');
    const snack = composeOpener(read, { goal: 'maintain', mealId: 'a', day: { proteinIncludingThisMeal: 150, proteinTarget: 180, mealsRemaining: 0 } });
    expect(snack.why && snack.why.topic).toBe('snack');
  });
  it('an Intuitive athlete still gets one, and it has no figure', () => {
    const r = composeOpener(read, { planStyle: 'intuitive', goal: 'gain', mealId: 'b', day: { proteinIncludingThisMeal: 60, proteinTarget: 180, mealsRemaining: 2 } });
    expect(r.text).not.toMatch(/\d+\s*g\b/);
    expect(r.why).not.toBeNull();
    expect(r.why!.text).not.toMatch(/\d/);
  });
  it('a minor with a fat-loss goal hears about training, never weight', () => {
    const r = composeOpener(read, { goal: 'lose', minor: true, mealId: 'c', day: { proteinIncludingThisMeal: 60, proteinTarget: 180, mealsRemaining: 2 } });
    expect(r.why!.goal).toBe('train');
    expect(WHY_LIBRARY.perform.short).toContain(r.why!.text);
  });
  it('no message, no why', () => {
    expect(composeOpener({}, { goal: 'gain' }).why).toBeNull();
  });
});

describe('season-aware variants (phase B)', () => {
  const PHASES: WhyPhase[] = ['off', 'pre', 'in', 'post'];
  const LINES = PHASES.flatMap((p) => TOPICS.flatMap((t) => (PHASE_WHY[p][t] || []).map((line) => ({ p, t, line }))));
  it('hold the same rails as the goal library', () => {
    expect(LINES.length).toBeGreaterThanOrEqual(18);
    for (const { line } of LINES) {
      expect(line.length).toBeLessThanOrEqual(WHY_MAX);
      expect(line).not.toMatch(/\d/);
      expect(violatesStyleLanguage(line, 'intuitive')).toBeNull();
      expect(scrubToolLeak(line)).toBe(line);
      expect(line).not.toMatch(new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}<>{}]`));   // no dashes, no markup
      expect(line).not.toMatch(WEIGHT);
      expect(line).toMatch(/[.!?]$/);
    }
    for (const p of PHASES) for (const t of TOPICS) { const l = PHASE_WHY[p][t]; if (l) expect(l.length).toBeGreaterThanOrEqual(3); }
    expect(new Set([...LINES.map((x) => x.line), ...ALL.map((x) => x.line)]).size).toBe(LINES.length + ALL.length);
  });
  it('speak where the season has a variant, and fall back to the goal where it has none', () => {
    const inCarbs = openerWhy({ goal: 'gain', topic: 'carbs', mealId: 'm', phase: 'in' });
    expect(PHASE_WHY.in.carbs).toContain(inCarbs.text);
    expect(inCarbs.goal).toBe('gain');                       // the chip still names the goal
    const inLate = openerWhy({ goal: 'gain', topic: 'late', mealId: 'm', phase: 'in' });
    expect(WHY_LIBRARY.gain.late).toContain(inLate.text);
    const none = openerWhy({ goal: 'gain', topic: 'carbs', mealId: 'm', phase: null });
    expect(WHY_LIBRARY.gain.carbs).toContain(none.text);
    expect(openerWhy({ goal: 'gain', topic: 'carbs', mealId: 'm', phase: 'playoffs' }).text).toBe(none.text);
    expect(whyPhase('IN')).toBeNull();
  });
  it('a minor in season still hears about training, labelled train', () => {
    const w = openerWhy({ goal: 'lose', minor: true, topic: 'carbs', mealId: 'm', phase: 'in' });
    expect(w.goal).toBe('train');
    expect(PHASE_WHY.in.carbs).toContain(w.text);
  });
  it('rides composeOpener through ctx.phase', () => {
    const read = { name: 'Chicken bowl', analysis: 'Real protein and a starch, which is what a training day wants. Add a fruit next time.', detected: [] };
    const r = composeOpener(read, { goal: 'gain', mealId: 'a', phase: 'in', day: { proteinIncludingThisMeal: 190, proteinTarget: 180, mealsRemaining: 1 } });
    expect(r.why && r.why.topic).toBe('closed');
    expect(PHASE_WHY.in.closed).toContain(r.why!.text);
  });
});
