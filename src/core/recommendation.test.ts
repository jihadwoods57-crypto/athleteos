// AthleteOS — baseline recommendation tests. Asserts the ported macro math
// (protein/lb, calorie deltas per goal) and the display helpers.
import { baselineRec, formatHeight } from './recommendation';
import type { BaseGoal } from './types';

describe('baselineRec — protein', () => {
  it('uses 1.0 g/lb for non-loss goals', () => {
    expect(baselineRec(180, 'gain').recProtein).toBe(180);
    expect(baselineRec(180, 'maintain').recProtein).toBe(180);
    expect(baselineRec(180, 'performance').recProtein).toBe(180);
  });

  it('bumps protein to 1.1 g/lb when cutting', () => {
    // 180 * 1.1 = 198
    expect(baselineRec(180, 'lose').recProtein).toBe(198);
  });

  it('rounds protein to the nearest gram', () => {
    // 175 * 1.1 = 192.5 -> 193
    expect(baselineRec(175, 'lose').recProtein).toBe(193);
  });
});

describe('baselineRec — calories', () => {
  // base maintenance = weight * 15, then goal delta.
  it('gain adds +500 over maintenance', () => {
    // 180*15 = 2700, +500 = 3200
    expect(baselineRec(180, 'gain').recCal).toBe(3200);
  });

  it('lose subtracts 500', () => {
    expect(baselineRec(180, 'lose').recCal).toBe(2200);
  });

  it('maintain holds at maintenance', () => {
    expect(baselineRec(180, 'maintain').recCal).toBe(2700);
  });

  it('performance adds +250', () => {
    expect(baselineRec(180, 'performance').recCal).toBe(2950);
  });

  it('formats calories with a thousands separator', () => {
    expect(baselineRec(180, 'gain').recCalStr).toBe((3200).toLocaleString());
  });
});

describe('baselineRec — change label + color', () => {
  const cases: { goal: BaseGoal; label: string }[] = [
    { goal: 'gain', label: '+6 lb' },
    { goal: 'lose', label: '−8 lb' },
    { goal: 'maintain', label: 'Hold' },
    { goal: 'performance', label: '+3 lb' },
  ];
  it.each(cases)('$goal -> "$label"', ({ goal, label }) => {
    expect(baselineRec(180, goal).recChange).toBe(label);
  });

  it('paints loss blue, everything else green', () => {
    expect(baselineRec(180, 'lose').recChangeColor).toBe('#2563EB');
    expect(baselineRec(180, 'gain').recChangeColor).toBe('#22C55E');
    expect(baselineRec(180, 'maintain').recChangeColor).toBe('#22C55E');
  });
});

describe('formatHeight', () => {
  it('splits total inches into feet and inches', () => {
    expect(formatHeight(73)).toBe(`6'1"`);
    expect(formatHeight(72)).toBe(`6'0"`);
    expect(formatHeight(60)).toBe(`5'0"`);
    expect(formatHeight(54)).toBe(`4'6"`);
  });
});
