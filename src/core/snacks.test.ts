import { SNACK_PRESETS, snackToFood, appendSnack } from './snacks';

describe('snack presets', () => {
  it('has unique ids and sane macros', () => {
    const ids = new Set(SNACK_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(SNACK_PRESETS.length);
    for (const p of SNACK_PRESETS) {
      expect(p.per.protein).toBeGreaterThanOrEqual(0);
      expect(p.per.kcal).toBeGreaterThan(0);
      expect(p.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('leads with shakes and includes the coach-thread Core Power (42g)', () => {
    expect(SNACK_PRESETS[0].kind).toBe('shake');
    expect(SNACK_PRESETS.some((p) => /core power/i.test(p.name) && p.per.protein === 42)).toBe(true);
  });

  it('projects a preset to an EditableFood (servings 1, macros copied)', () => {
    const p = SNACK_PRESETS[0];
    const f = snackToFood(p);
    expect(f.servings).toBe(1);
    expect(f.name).toBe(p.name);
    expect(f.per).toEqual(p.per);
    f.per.protein = 999; // ensure it's a copy, not a shared reference
    expect(p.per.protein).toBe(42);
  });
});

describe('appendSnack', () => {
  it('appends to an existing snack slot', () => {
    const a = snackToFood(SNACK_PRESETS[0]);
    const b = snackToFood(SNACK_PRESETS[1]);
    expect(appendSnack([a], b)).toEqual([a, b]);
  });

  it('starts a new slot when none exists', () => {
    const a = snackToFood(SNACK_PRESETS[0]);
    expect(appendSnack(undefined, a)).toEqual([a]);
  });
});
