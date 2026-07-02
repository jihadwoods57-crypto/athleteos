import { fuelTarget, winTheDay } from './fuelTarget';

describe('fuelTarget', () => {
  it('adds a surplus for a gain goal (~500 kcal per lb/week)', () => {
    const t = fuelTarget(180, 1, 'gain'); // 180*16=2880 + 500
    expect(t.kcal).toBe(3380);
    expect(t.protein).toBe(180); // ~1 g/lb
  });

  it('subtracts for a lose goal', () => {
    expect(fuelTarget(180, 1, 'lose').kcal).toBe(2380); // 2880 - 500
  });

  it('is maintenance for a maintain goal', () => {
    expect(fuelTarget(180, 1, 'maintain').kcal).toBe(2880);
  });

  it('floors a cut at 1400 kcal and clamps absurd bodyweights', () => {
    expect(fuelTarget(90, 5, 'lose').kcal).toBe(1400); // 1440 - 2500 -> floored
    expect(fuelTarget(9999, 0, 'maintain').kcal).toBe(400 * 16);
  });
});

describe('winTheDay', () => {
  const target = { kcal: 3380, protein: 180 };

  it('wins when protein and fuel are within 10% of target', () => {
    const w = winTheDay({ protein: 170, kcal: 3100, carbs: 0, fat: 0 }, target);
    expect(w.proteinHit).toBe(true); // 170 >= 162
    expect(w.fuelHit).toBe(true); //   3100 >= 3042
    expect(w.won).toBe(true);
  });

  it('misses when protein is short', () => {
    const w = winTheDay({ protein: 120, kcal: 3300, carbs: 0, fat: 0 }, target);
    expect(w.proteinHit).toBe(false);
    expect(w.won).toBe(false);
  });

  it('misses when fuel is short', () => {
    const w = winTheDay({ protein: 180, kcal: 2000, carbs: 0, fat: 0 }, target);
    expect(w.fuelHit).toBe(false);
    expect(w.won).toBe(false);
  });
});
