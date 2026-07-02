import { parsePlanSlots } from './planValidate';

describe('parsePlanSlots', () => {
  it('drops entries with no valid meal key', () => {
    const out = parsePlanSlots([{ key: 'brunch', mode: 'open' }, { key: 'lunch', mode: 'open' }]);
    expect(out.map((s) => s.key)).toEqual(['lunch']);
  });

  it('defaults missing fields and strips unknown keys', () => {
    const [s] = parsePlanSlots([{ key: 'breakfast', mode: 'pinned', hacker: true, macros: { kcal: 600, protein: 40 } }]);
    expect(s.mode).toBe('pinned');
    expect(s.options).toEqual([]);
    expect(s.restaurantAlts).toEqual([]);
    expect(s.photoRequired).toBe(false);
    expect(s.note).toBeNull();
    expect((s as unknown as Record<string, unknown>).hacker).toBeUndefined();
  });

  it('clamps negative macros to 0 and coerces meal items to strings', () => {
    const [s] = parsePlanSlots([
      { key: 'dinner', mode: 'open', macros: { kcal: -5, protein: -2 }, options: [{ name: 'X', items: ['rice', 7], macros: { kcal: -1, protein: 10, carbs: 5, fat: 3 }, source: 'ai' }] },
    ]);
    expect(s.macros).toEqual({ kcal: 0, protein: 0 });
    expect(s.options[0].items).toEqual(['rice']);
    expect(s.options[0].macros.kcal).toBe(0);
  });

  it('returns [] for non-array input', () => {
    expect(parsePlanSlots(null)).toEqual([]);
    expect(parsePlanSlots('nope')).toEqual([]);
  });
});
