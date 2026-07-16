// Meal conversation intelligence (proto/redesign-2026-07/js/meal-intel.js additions,
// upgrade 2026-07-16): estimate honesty, consistency rules, historical patterns, the
// score rubric, coach-notification classification, athlete corrections, the follow-up
// question, and the athlete-visible coach status.
// @ts-ignore
import {
  estRange, estimateConfidence, hasVisibleProduce, qualityReason,
  openingSummary, openingMessage, mealPatterns, scoreRubric,
  classifyMealEvent, applyMealCorrection, followUpQuestion, coachThreadStatus,
  threadMessages, privateNotes,
// @ts-ignore
} from '../../proto/redesign-2026-07/js/meal-intel.js';

const SALMON = [
  { name: 'Baked salmon', confidence: 'high' },
  { name: 'White rice', confidence: 'high' },
  { name: 'Roasted asparagus', confidence: 'medium' },
];

describe('estimate honesty', () => {
  test('ranges widen with lower confidence and always bracket the value', () => {
    const hi = estRange(46, 'high'), md = estRange(46, 'medium'), lo = estRange(46, 'low');
    for (const r of [hi, md, lo]) { expect(r.lo).toBeLessThanOrEqual(46); expect(r.hi).toBeGreaterThanOrEqual(46); }
    expect(hi.hi - hi.lo).toBeLessThan(md.hi - md.lo);
    expect(md.hi - md.lo).toBeLessThan(lo.hi - lo.lo);
  });
  test('confidence: label/manual are exact; the weakest detected item sets photo confidence', () => {
    expect(estimateConfidence('label', SALMON)).toBe('exact');
    expect(estimateConfidence('manual', [])).toBe('exact');
    expect(estimateConfidence('live', SALMON)).toBe('medium');
    expect(estimateConfidence('live', [{ name: 'Mystery stew', confidence: 'low' }])).toBe('low');
    expect(estimateConfidence('live', [{ name: 'Eggs', confidence: 'high' }])).toBe('high');
  });
});

describe('consistency rules (spec: feedback must never contradict the plate)', () => {
  test('visible produce with a 0g fiber estimate NEVER yields "almost no fiber"', () => {
    const reason = qualityReason({ protein: 46, carbs: 62, fat: 22 }, 0, SALMON);
    expect(reason).not.toMatch(/almost no fiber/i);
  });
  test('visible produce with a small fiber number softens to an estimate gap', () => {
    const reason = qualityReason({ protein: 20, carbs: 80, fat: 10 }, 2, SALMON);
    expect(reason).not.toMatch(/almost no fiber/i);
  });
  test('no produce and low fiber still calls it out honestly', () => {
    const reason = qualityReason({ protein: 20, carbs: 80, fat: 10 }, 1, [{ name: 'White bread', confidence: 'high' }]);
    expect(reason).toMatch(/almost no fiber/i);
  });
  test('hasVisibleProduce recognizes vegetables, fruit, and whole grains', () => {
    expect(hasVisibleProduce(SALMON)).toBe(true);
    expect(hasVisibleProduce([{ name: 'Fried chicken' }, { name: 'White bread' }])).toBe(false);
  });
});

describe('openingSummary (personalized, uncertainty-honest)', () => {
  const base = {
    quality: 84, macros: { protein: 46, carbs: 62, fat: 22 }, fiber: 4,
    detected: SALMON, source: 'live', late: false, deadlineClock: '2:00 PM',
    day: { proteinSoFar: 92, proteinTarget: 180, mealsRemaining: 2 },
  };
  test('references the real deadline and ranges the visible protein', () => {
    const s = openingSummary(base);
    expect(s.wentWell).toMatch(/2:00 PM deadline/);
    expect(s.wentWell).toMatch(/salmon/i);
    expect(s.wentWell).toMatch(/\d+–\d+g/); // ranged, not false-precision
  });
  test('exact sources do not hedge', () => {
    const s = openingSummary({ ...base, source: 'label' });
    expect(s.wentWell).not.toMatch(/–/);
  });
  test('produce-aware next action doubles the vegetables instead of generic advice', () => {
    const s = openingSummary({ ...base, macros: { protein: 18, carbs: 90, fat: 8 }, fiber: 2 });
    expect(`${s.opportunity} ${s.next}`).toMatch(/vegetables|fruit|protein/i);
  });
});

describe('openingMessage (day progress, patterns, impact, uncertainty)', () => {
  test('connects the meal to real day math and states the score impact', () => {
    const msg = openingMessage({
      name: 'Lunch', quality: 84, analysis: 'Strong plate, fuels the afternoon.',
      late: false, detected: SALMON, source: 'live',
      day: { proteinSoFar: 92, proteinTarget: 180, mealsRemaining: 2 },
      patterns: ["That's your second lunch in a row logged on time."],
      impact: 13,
    });
    expect(msg).toMatch(/92 of 180g protein/);
    expect(msg).toMatch(/second lunch in a row/);
    expect(msg).toMatch(/\+13/);
    expect(msg).toMatch(/photo estimates/i);
  });
  test('never fabricates: absent day/patterns/impact produce no such sentences', () => {
    const msg = openingMessage({ name: 'Lunch', quality: 84, analysis: 'Solid.', late: false, source: 'label' });
    expect(msg).not.toMatch(/of \d+g protein/);
    expect(msg).not.toMatch(/in a row/);
    expect(msg).not.toMatch(/Daily Score/);
    expect(msg).not.toMatch(/photo estimates/);
  });
});

describe('mealPatterns (real history only)', () => {
  const meal = (over: object) => ({ type: 'lunch', day_date: '2026-07-10', protein: 40, quality: 80, minutes_late: 0, ...over });
  test('returns [] with insufficient history — no invented patterns', () => {
    expect(mealPatterns([], { slot: 'lunch' })).toEqual([]);
    expect(mealPatterns([meal({})], { slot: 'lunch' })).toEqual([]);
  });
  test('detects an on-time streak from 2+ same-slot logs', () => {
    const p = mealPatterns([meal({ day_date: '2026-07-15' }), meal({ day_date: '2026-07-16' })], { slot: 'lunch' });
    expect(p.join(' ')).toMatch(/second lunch in a row logged on time/);
  });
  test('a late meal breaks the streak claim', () => {
    const p = mealPatterns([meal({ day_date: '2026-07-15' }), meal({ day_date: '2026-07-16', minutes_late: 30 })], { slot: 'lunch' });
    expect(p.join(' ')).not.toMatch(/in a row logged on time/);
  });
  test('protein hit-rate needs 4 real meals and 3 hits', () => {
    const rows = ['13', '14', '15', '16'].map((d, i) => meal({ day_date: `2026-07-${d}`, protein: i === 0 ? 20 : 45 }));
    const p = mealPatterns(rows, { slot: 'lunch', mealProteinBar: 40 });
    expect(p.join(' ')).toMatch(/3 of your last 4 lunches/);
  });
});

describe('scoreRubric (transparent, estimate-labeled, consistent)', () => {
  test('timing and completeness are exact; macro rows are estimated for photo reads', () => {
    const r = scoreRubric({ quality: 84, minutesLate: 0, macros: { protein: 46, carbs: 62, fat: 22 }, fiber: 4, detected: SALMON, source: 'live' });
    const timing = r.rows.find((x: any) => x.k === 'On-time logging')!;
    expect(timing.exact).toBe(true);
    expect(timing.state).toBe('met');
    const protein = r.rows.find((x: any) => x.k === 'Protein alignment')!;
    expect(protein.exact).toBe(false);
    expect(protein.note).toMatch(/estimated/);
    expect(r.headline).toMatch(/84/);
  });
  test('produce on the plate keeps the fiber row from reading as a flat miss', () => {
    const r = scoreRubric({ quality: 84, minutesLate: 0, macros: { protein: 46, carbs: 62, fat: 22 }, fiber: 0, detected: SALMON, source: 'live' });
    const fiber = r.rows.find((x: any) => x.k === 'Produce & fiber')!;
    expect(fiber.state).not.toBe('miss');
    expect(fiber.note).toMatch(/Visible produce/);
  });
});

describe('classifyMealEvent (coach notification routing)', () => {
  test('clean on-time meal → logged (quiet)', () => {
    expect(classifyMealEvent({ quality: 84, detected: SALMON, source: 'live', minutesLate: 0 }).cls).toBe('logged');
  });
  test('low-confidence read or no photo → review', () => {
    expect(classifyMealEvent({ quality: 84, detected: [{ name: 'Stew', confidence: 'low' }], source: 'live' }).cls).toBe('review');
    expect(classifyMealEvent({ quality: 84, detected: [], source: 'manual' }).cls).toBe('review');
  });
  test('severe allergen or athlete question → action', () => {
    expect(classifyMealEvent({ restrictionHits: { severe: ['Peanuts'] } }).cls).toBe('action');
    expect(classifyMealEvent({ athleteAskedCoach: true }).cls).toBe('action');
  });
  test('big correction delta → review', () => {
    expect(classifyMealEvent({ quality: 84, detected: SALMON, source: 'live', correctionDelta: 150 }).cls).toBe('review');
  });
});

describe('applyMealCorrection (recalculate + audit trail)', () => {
  const meta = { protein: 46, carbs: 62, fat: 22, kcal: 620, fiber: 4, quality: 84, note: '' };
  test('butter adds fat/calories, freezes the original once, logs the correction', () => {
    const r = applyMealCorrection(meta, { kind: 'cooking', value: 'butter' })!;
    expect(r.meta.fat).toBe(34);
    expect(r.meta.kcal).toBe(728);
    expect(r.meta.orig).toEqual({ protein: 46, carbs: 62, fat: 22, kcal: 620, fiber: 4, quality: 84 });
    expect(r.meta.corrections).toHaveLength(1);
    expect(r.summary).toMatch(/butter/);
    expect(r.summary).toMatch(/estimated/);
  });
  test('portion scaling rescales all macros; a second correction keeps the FIRST original', () => {
    const r1 = applyMealCorrection(meta, { kind: 'portion', value: 'half' })!;
    expect(r1.meta.protein).toBe(23);
    const r2 = applyMealCorrection(r1.meta, { kind: 'side', value: 'fruit' })!;
    expect(r2.meta.orig.protein).toBe(46); // the audit anchor never moves
    expect(r2.meta.corrections).toHaveLength(2);
    expect(r2.meta.fiber).toBeGreaterThan(r1.meta.fiber);
  });
  test('quality nudges are bounded rule-based adjustments, never a fake re-score', () => {
    const r = applyMealCorrection(meta, { kind: 'side', value: 'vegetables' })!;
    expect(r.meta.quality).toBe(88); // +4, from the rule
    expect(Math.abs((r.meta.quality as number) - 84)).toBeLessThanOrEqual(8);
  });
  test('"neither" confirms the estimate without changing numbers', () => {
    const r = applyMealCorrection(meta, { kind: 'cooking', value: 'neither' })!;
    expect(r.meta.fat).toBe(22);
    expect(r.summary).toMatch(/confirmed/);
  });
  test('unknown corrections are rejected, not guessed', () => {
    expect(applyMealCorrection(meta, { kind: 'cooking', value: 'plasma' })).toBeNull();
  });
});

describe('followUpQuestion (one useful question, never redundant)', () => {
  const meta = { source: 'live', detectedRich: SALMON, userNote: '', note: '', corrections: [] };
  test('asks about cooking fat for a photo-read protein', () => {
    const q = followUpQuestion(meta)!;
    expect(q.q).toMatch(/salmon.*oil, butter, or neither/i);
    expect(q.chips.map((c: any) => c.value)).toEqual(['oil', 'butter', 'neither', 'other']);
  });
  test('silent when the note already covers prep, the source is exact, or it was answered', () => {
    expect(followUpQuestion({ ...meta, userNote: 'baked with olive oil' })).toBeNull();
    expect(followUpQuestion({ ...meta, source: 'label' })).toBeNull();
    expect(followUpQuestion({ ...meta, corrections: [{ kind: 'cooking', value: 'oil' }] })).toBeNull();
  });
});

describe('coachThreadStatus (athlete-visible, real signals only)', () => {
  test('walks sent → reviewed → replied on real evidence', () => {
    expect(coachThreadStatus({ mealId: 'm1', hasCoach: true, comments: [] }).label).toBe('Sent to Coach');
    expect(coachThreadStatus({ mealId: 'm1', hasCoach: true, comments: [], dayReviewed: true }).label).toBe('Reviewed by Coach');
    expect(coachThreadStatus({ mealId: 'm1', hasCoach: true, comments: [{ role: 'coach', text: 'nice' }] }).label).toBe('Coach replied');
  });
  test('no coach or no persisted meal → no claim', () => {
    expect(coachThreadStatus({ mealId: 'm1', hasCoach: false }).state).toBe('none');
    expect(coachThreadStatus({ hasCoach: true, comments: [] }).state).toBe('none');
  });
});

describe('private notes stay out of the shared thread', () => {
  const rows = [
    { role: 'coach', kind: 'message', text: 'good plate' },
    { role: 'coach', kind: 'note', text: 'watch portions this week' },
    { role: 'coach', kind: 'reaction', text: '🔥' },
  ];
  test('threadMessages excludes notes and reactions; privateNotes returns only notes', () => {
    expect(threadMessages(rows).map((r: any) => r.text)).toEqual(['good plate']);
    expect(privateNotes(rows).map((r: any) => r.text)).toEqual(['watch portions this week']);
  });
});
