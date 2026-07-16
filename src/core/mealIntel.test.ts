// Proto is plain ESM JS (allowJs) — same import pattern as obHelpers/exec tests.
// @ts-ignore
import { normalizeDetected, groundExtras, openingMessage, openingSummary, qualityBand, qualityReason, reactionGroups, threadMessages, contextForChat } from '../../proto/redesign-2026-07/js/meal-intel.js';
// @ts-ignore
import { DAY, dayLogMeal } from '../../proto/redesign-2026-07/js/day.js';

describe('normalizeDetected', () => {
  test('legacy strings become high-confidence entries', () =>
    expect(normalizeDetected(['Chicken', 'Rice'])).toEqual([
      { name: 'Chicken', confidence: 'high' }, { name: 'Rice', confidence: 'high' },
    ]));
  test('rich objects pass through; bad confidence coerces to high', () =>
    expect(normalizeDetected([{ name: 'Kale', confidence: 'low' }, { name: 'Beef', confidence: 'sure' }]))
      .toEqual([{ name: 'Kale', confidence: 'low' }, { name: 'Beef', confidence: 'high' }]));
  test('strips markup, drops empties, caps at 8', () => {
    const out = normalizeDetected(['<b>Egg</b>', '', ...Array(10).fill('x')]);
    expect(out[0].name).toBe('bEgg/b'.includes('<') ? 'FAIL' : 'bEgg/b');
    expect(out.length).toBeLessThanOrEqual(8);
  });
  test('non-array input yields empty', () => expect(normalizeDetected(undefined)).toEqual([]));
});

describe('groundExtras', () => {
  test('fiber clamps to 0..60 and rounds', () => {
    expect(groundExtras({ fiber: 200 }).fiber).toBe(60);
    expect(groundExtras({ fiber: -3 }).fiber).toBe(0);
    expect(groundExtras({ fiber: 7.6 }).fiber).toBe(8);
  });
  test('highlights capped at 3, cleaned, length-limited', () => {
    const g = groundExtras({ highlights: ['<i>Iron</i> source', 'a'.repeat(300), 'ok', 'dropped'] });
    expect(g.highlights).toHaveLength(3);
    expect(g.highlights[0]).not.toContain('<');
    expect(g.highlights[1].length).toBeLessThanOrEqual(120);
  });
  test('detectedRich + detectedNames derive together', () => {
    const g = groundExtras({ detected: [{ name: 'Oats', confidence: 'medium' }, 'Banana'] });
    expect(g.detectedRich).toEqual([{ name: 'Oats', confidence: 'medium' }, { name: 'Banana', confidence: 'high' }]);
    expect(g.detectedNames).toEqual(['Oats', 'Banana']);
  });
  test('missing fields yield safe defaults', () =>
    expect(groundExtras({})).toEqual({ fiber: 0, highlights: [], detectedRich: [], detectedNames: [], analysis: '' }));
  test('analysis clamps to 1200 chars and strips markup (0062)', () => {
    const g = groundExtras({ analysis: '<b>Strong plate.</b> ' + 'x'.repeat(2000) });
    expect(g.analysis.length).toBeLessThanOrEqual(1200);
    expect(g.analysis).not.toContain('<');
    expect(g.analysis).toContain('Strong plate.');
  });
  test('detected quantity rides through cleaned + capped; absent stays absent', () => {
    const g: any = groundExtras({ detected: [{ name: 'Eggs', confidence: 'high', quantity: '<i>2 eggs</i>' }, { name: 'Rice', confidence: 'medium' }] });
    expect(g.detectedRich[0].quantity).toBe('i2 eggs/i');
    expect(g.detectedRich[0].quantity).not.toContain('<');
    expect(g.detectedRich[1]).not.toHaveProperty('quantity');
    const long: any = groundExtras({ detected: [{ name: 'Rice', confidence: 'high', quantity: 'y'.repeat(100) }] });
    expect(long.detectedRich[0].quantity.length).toBeLessThanOrEqual(40);
  });
});

describe('analysisTiming (0062 — client-measured, server only formats)', () => {
  // @ts-ignore
  const { analysisTiming } = require('../../proto/redesign-2026-07/js/meal-intel.js');
  test('late capture yields minutesLate, zero minutesLeft', () =>
    expect(analysisTiming(900, 840)).toEqual({ deadlineMin: 840, minutesLate: 60, minutesLeft: 0 }));
  test('on-time capture yields minutesLeft, zero minutesLate', () =>
    expect(analysisTiming(800, 840)).toEqual({ deadlineMin: 840, minutesLate: 0, minutesLeft: 40 }));
  test('dishonest inputs yield null so the request just omits timing', () => {
    expect(analysisTiming(NaN, 840)).toBeNull();
    expect(analysisTiming(900, undefined)).toBeNull();
    expect(analysisTiming(-5, 840)).toBeNull();
    expect(analysisTiming(900, 9999)).toBeNull();
  });
});

describe('dayLogMeal meta persistence (slotMacros jsonb round-trip)', () => {
  const D: any = DAY; // proto JS state — untyped through allowJs
  // day.js guards its Supabase/localStorage I/O on window.sb / try-catch; give node a bare
  // window so pushDay's debounced push no-ops cleanly instead of throwing off-thread.
  beforeAll(() => { (globalThis as any).window = (globalThis as any).window ?? {}; });
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

  test('fiber/highlights/detectedRich land in DAY.slotMacros next to quality/foods/note', () => {
    D.meals.lunch = false; delete D.slotMacros.lunch;
    dayLogMeal(null, 'lunch', { protein: 40, kcal: 700, carbs: 60, fat: 20 }, {
      quality: 80, foods: ['Chicken', 'Rice'], note: 'Solid plate.', name: 'Lunch',
      fiber: 9, highlights: ['Strong iron source'], detectedRich: [{ name: 'Chicken', confidence: 'high' }, { name: 'Rice', confidence: 'medium' }],
    });
    expect(D.slotMacros.lunch).toMatchObject({
      protein: 40, quality: 80, foods: ['Chicken', 'Rice'], note: 'Solid plate.',
      fiber: 9, highlights: ['Strong iron source'],
      detectedRich: [{ name: 'Chicken', confidence: 'high' }, { name: 'Rice', confidence: 'medium' }],
    });
  });

  test('fiber 0 persists (not dropped as falsy); absent extras leave no keys behind', () => {
    D.meals.snack = false; delete D.slotMacros.snack;
    dayLogMeal(null, 'snack', { protein: 20, kcal: 240, carbs: 22, fat: 6 }, { quality: 88, foods: ['Yogurt'], note: '', fiber: 0, highlights: [], detectedRich: [] });
    expect(D.slotMacros.snack.fiber).toBe(0);
    expect(D.slotMacros.snack.highlights).toEqual([]);
    D.meals.dinner = false; delete D.slotMacros.dinner;
    dayLogMeal(null, 'dinner', { protein: 30, kcal: 500, carbs: 40, fat: 15 }, { quality: 70, foods: ['Steak'], note: 'n' });
    expect(D.slotMacros.dinner).not.toHaveProperty('fiber');
    expect(D.slotMacros.dinner).not.toHaveProperty('detectedRich');
  });
});

describe('openingMessage', () => {
  const base = { name: 'Chicken & Rice', quality: 82, note: 'Solid protein anchor.', goal: 'gain', coachTargets: null, late: false };
  test('on-time celebration first, note included, praise for quality >= 75', () => {
    const m = openingMessage(base);
    expect(m).toMatch(/on time/i);
    expect(m).toContain('Solid protein anchor.');
    expect(m).not.toMatch(/next time/i);
  });
  test('late meal celebrated as still counting — never shamed', () => {
    const m = openingMessage({ ...base, late: true });
    expect(m).toMatch(/counts/i);
    expect(m).not.toMatch(/fail|bad|shame/i);
  });
  test('quality < 75 adds exactly one practical improvement', () => {
    const m = openingMessage({ ...base, quality: 60 });
    expect(m).toMatch(/next time/i);
  });
  test('goal tie adapts per goal and tolerates null goal', () => {
    expect(openingMessage({ ...base, goal: 'perform' })).not.toBe(openingMessage(base));
    expect(openingMessage({ ...base, goal: null }).length).toBeGreaterThan(20);
  });
  test('coach targets earn a deference line', () =>
    expect(openingMessage({ ...base, coachTargets: { protein: 180 } })).toContain('180'));
  test('caps at 1200 chars (raised for the detailed analysis, WS5)', () =>
    expect(openingMessage({ ...base, note: 'x'.repeat(1400) }).length).toBeLessThanOrEqual(1200));
  test('analysis takes precedence over note + goal tie + quality praise (single AI surface)', () => {
    const m = openingMessage({ ...base, analysis: 'A detailed coach paragraph about this plate.' });
    expect(m).toContain('A detailed coach paragraph about this plate.');
    expect(m).not.toContain('Solid protein anchor.'); // note is superseded
    expect(m).not.toMatch(/keep .* in rotation/i);    // praise line is superseded
  });
  test('minutesLate sharpens the late sentence with the real number', () => {
    const m = openingMessage({ ...base, late: true, minutesLate: 42 });
    expect(m).toMatch(/42 min past the window/);
    expect(m).toMatch(/isn't the standard/i);
    expect(m).toMatch(/counts/i); // still credited, never shamed
  });
  test('on-time copy holds the standard in the founder voice', () =>
    expect(openingMessage(base)).toMatch(/in on time\. That's the standard\./));
  test('highlights fold into ONE sentence inside the message', () => {
    const m = openingMessage({ ...base, highlights: ['Strong iron source', 'Good fiber'] });
    expect(m).toContain('Worth knowing: Strong iron source. Good fiber.');
  });
  test('late: null omits the timing sentence entirely (timing unknown, not guessed)', () => {
    const m = openingMessage({ ...base, late: null });
    expect(m).not.toMatch(/on time/i);
    expect(m).not.toMatch(/counts/i);
    // the rest of the message (note, goal tie, quality praise) still renders
    expect(m).toContain('Solid protein anchor.');
  });
  test('late true/false athlete-side behavior is unchanged by the null branch', () => {
    expect(openingMessage(base)).toMatch(/on time/i);
    expect(openingMessage({ ...base, late: true })).toMatch(/counts/i);
  });
});

describe('qualityBand (2026-07-16 — quality is a separate concept from compliance green)', () => {
  test('bands: >=75 good, 50-74 mid, <50 low', () => {
    expect(qualityBand(82)).toEqual({ cls: 'good', label: 'Strong' });
    expect(qualityBand(75)).toEqual({ cls: 'good', label: 'Strong' });
    expect(qualityBand(58)).toEqual({ cls: 'mid', label: 'Needs work' });
    expect(qualityBand(50)).toEqual({ cls: 'mid', label: 'Needs work' });
    expect(qualityBand(31)).toEqual({ cls: 'low', label: 'Weak plate' });
  });
  test('no honest score yields null (nothing renders)', () => {
    expect(qualityBand(null)).toBeNull();
    expect(qualityBand(undefined)).toBeNull();
    expect(qualityBand('nope')).toBeNull();
  });
});

describe('qualityReason (the one-line WHY behind the number)', () => {
  test('low protein share names protein vs carbs and fat', () =>
    expect(qualityReason({ protein: 18, carbs: 55, fat: 28 }, 4))
      .toMatch(/protein came in low next to the carbs and fat/i));
  test('heavy fat share names fat', () =>
    expect(qualityReason({ protein: 30, carbs: 20, fat: 45 }, 6)).toMatch(/fat ran above the range/i));
  test('balanced plate says so instead of inventing a flaw', () =>
    expect(qualityReason({ protein: 40, carbs: 45, fat: 15 }, 8)).toMatch(/in balance/i));
  test('at most two issues, capitalized, one sentence', () => {
    const r = qualityReason({ protein: 5, carbs: 80, fat: 40 }, 0);
    expect(r[0]).toBe(r[0].toUpperCase());
    expect(r.split(' and ').length).toBeLessThanOrEqual(3); // 2 issues max, joined once
    expect(r.endsWith('.')).toBe(true);
  });
  test('no macros yields empty string', () => expect(qualityReason({}, 0)).toBe(''));
});

describe('openingSummary (the 5-second read)', () => {
  const base = { quality: 58, macros: { protein: 18, carbs: 55, fat: 28 }, fiber: 4, highlights: [], late: false, goal: 'gain' };
  test('three parts, all non-empty for a typical logged meal', () => {
    const s = openingSummary(base);
    expect(s.wentWell).toMatch(/logged on time/i);
    expect(s.opportunity).toMatch(/protein came in low/i);
    expect(s.next).toMatch(/greek yogurt|egg|chicken/i);
  });
  test('late meal still credits the log, never shames', () => {
    const s = openingSummary({ ...base, late: true });
    expect(s.wentWell).toMatch(/got it logged/i);
    expect(s.wentWell).not.toMatch(/fail|bad|shame/i);
  });
  test('strong protein is named as the win with the real number', () =>
    expect(openingSummary({ ...base, macros: { protein: 42, carbs: 40, fat: 18 } }).wentWell).toContain('42g'));
  test('balanced high-quality plate: opportunity honest, next ties to goal', () => {
    const s = openingSummary({ quality: 85, macros: { protein: 40, carbs: 45, fat: 15 }, fiber: 8, late: false, goal: 'perform' });
    expect(s.opportunity).toMatch(/not much/i);
    expect(s.next).toMatch(/rotation/i);
  });
  test('late: null omits the timing claim instead of guessing', () => {
    const s = openingSummary({ ...base, late: null, macros: { protein: 42, carbs: 40, fat: 18 } });
    expect(s.wentWell).not.toMatch(/on time|logged/i);
    expect(s.wentWell).toContain('42g');
  });
});

describe('reaction split', () => {
  const rows = [
    { role: 'coach', kind: 'reaction', text: '🔥' }, { role: 'coach', kind: 'reaction', text: '🔥' },
    { role: 'coach', kind: 'reaction', text: '💪' }, { role: 'coach', text: 'Nice plate' },
    { role: 'athlete', kind: 'message', text: 'Thanks' },
  ];
  test('reactionGroups counts per emoji', () =>
    expect(reactionGroups(rows)).toEqual([{ emoji: '🔥', count: 2 }, { emoji: '💪', count: 1 }]));
  test('threadMessages drops reactions, keeps kindless rows', () =>
    expect(threadMessages(rows).map((r: any) => r.text)).toEqual(['Nice plate', 'Thanks']));
});

describe('contextForChat', () => {
  const big = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Meal ${i}`, protein: 40, kcal: 700, quality: 70 }));
  test('passes the five sections through', () => {
    const c = contextForChat({ meal: { name: 'Lunch' }, plan: { goal: 'gain' }, exec: { met: 2 }, recentMeals: big(3), thread: [{ role: 'athlete', text: 'hi' }] });
    expect(c.meal.name).toBe('Lunch');
    expect(c.recentMeals).toHaveLength(3);
  });
  test('clamps to 8192 bytes, dropping oldest recentMeals then oldest thread', () => {
    const c = contextForChat({
      meal: { name: 'Dinner' }, plan: {}, exec: {},
      recentMeals: big(200),
      thread: Array.from({ length: 40 }, (_, i) => ({ role: 'athlete', text: `q${i} ` + 'y'.repeat(200) })),
    });
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(8192);
    // newest entries survive
    expect(JSON.stringify(c)).toContain('q39');
  });
  // Documents the caller-must-pass-ascending contract: contextForChat drops from the FRONT of
  // recentMeals when clamping, so callers (e.g. meal.js's askAI) must reverse a newest-first
  // DB result into ascending order first, or the newest meals get dropped instead of the oldest.
  test('recentMeals clamp drops from the front — surviving entries are the ones at the END of the input array', () => {
    const input = big(200); // ascending by construction: 'Meal 0' oldest .. 'Meal 199' newest
    const c = contextForChat({ meal: { name: 'Dinner' }, plan: {}, exec: {}, recentMeals: input, thread: [] });
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(8192);
    expect(c.recentMeals.length).toBeGreaterThan(0);
    expect(c.recentMeals.length).toBeLessThan(input.length);
    // the surviving slice must be a contiguous tail of the input, ending at the last element
    const survivingNames = c.recentMeals.map((m: any) => m.name);
    const expectedTail = input.slice(input.length - survivingNames.length).map((m) => m.name);
    expect(survivingNames).toEqual(expectedTail);
    expect(survivingNames[survivingNames.length - 1]).toBe('Meal 199');
  });
});
