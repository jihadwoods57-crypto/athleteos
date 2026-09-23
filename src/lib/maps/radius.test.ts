import {
  clampRadius, metersLabel, radiusFromFraction, fractionFromRadius, snappedChanged,
  RADIUS_MIN, RADIUS_MAX,
} from './radius';

test('the bubble is never smaller than a building or larger than a campus', () => {
  expect(clampRadius(40)).toBe(100);
  expect(clampRadius(137)).toBe(125);
  expect(clampRadius(5000)).toBe(1000);
});
test('labels read like a coach says them', () => {
  expect(metersLabel(150)).toBe('150 m');
  expect(metersLabel(1000)).toBe('1 km');
});

describe('slider snap', () => {
  test('a slider position maps to a 25 m step inside the range', () => {
    expect(radiusFromFraction(0)).toBe(RADIUS_MIN);
    expect(radiusFromFraction(1)).toBe(RADIUS_MAX);
    expect(radiusFromFraction(0.5)).toBe(550);
    expect(radiusFromFraction(0.0138)).toBe(100); // 112.4 m rounds down to 100
    expect(radiusFromFraction(0.014)).toBe(125);
  });
  test('a finger past either end of the track holds at the end', () => {
    expect(radiusFromFraction(-0.3)).toBe(100);
    expect(radiusFromFraction(1.7)).toBe(1000);
    expect(radiusFromFraction(Number.NaN)).toBe(100);
  });
  test('fraction and radius round-trip on every step', () => {
    for (let m = RADIUS_MIN; m <= RADIUS_MAX; m += 25) {
      expect(radiusFromFraction(fractionFromRadius(m))).toBe(m);
    }
  });
  test('the haptic ticks only when the snapped value changes', () => {
    expect(snappedChanged(150, 150)).toBe(false);
    expect(snappedChanged(150, 175)).toBe(true);
    expect(snappedChanged(null, 150)).toBe(true);
  });
});
