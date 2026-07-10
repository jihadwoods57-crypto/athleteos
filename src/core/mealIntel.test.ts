// Proto is plain ESM JS (allowJs) — same import pattern as obHelpers/exec tests.
// @ts-ignore
import { normalizeDetected, groundExtras, openingMessage, reactionGroups, threadMessages, contextForChat } from '../../proto/redesign-2026-07/js/meal-intel.js';

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
    expect(groundExtras({})).toEqual({ fiber: 0, highlights: [], detectedRich: [], detectedNames: [] }));
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
  test('caps at 600 chars', () =>
    expect(openingMessage({ ...base, note: 'x'.repeat(700) }).length).toBeLessThanOrEqual(600));
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
});
