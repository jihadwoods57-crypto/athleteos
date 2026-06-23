import {
  displayWeight,
  displayWeightDelta,
  formatWeight,
  kgToLb,
  lbToKg,
  weightStepLb,
  weightUnit,
} from './units';

describe('units', () => {
  describe('conversion', () => {
    it('round-trips lb -> kg -> lb', () => {
      expect(kgToLb(lbToKg(184))).toBeCloseTo(184, 6);
    });
    it('converts a known anchor (184 lb ~= 83.5 kg)', () => {
      expect(lbToKg(184)).toBeCloseTo(83.46, 2);
      expect(kgToLb(83.46)).toBeCloseTo(184, 1);
    });
  });

  describe('weightUnit', () => {
    it('labels each system', () => {
      expect(weightUnit('imperial')).toBe('lb');
      expect(weightUnit('metric')).toBe('kg');
    });
  });

  describe('displayWeight', () => {
    it('imperial rounds to whole lb (and hides any fractional internal lb)', () => {
      expect(displayWeight(184, 'imperial')).toBe(184);
      expect(displayWeight(186.2, 'imperial')).toBe(186);
    });
    it('metric converts and rounds to whole kg', () => {
      expect(displayWeight(184, 'metric')).toBe(83);
      expect(displayWeight(171, 'metric')).toBe(78);
    });
  });

  describe('formatWeight', () => {
    it('appends the active unit label', () => {
      expect(formatWeight(184, 'imperial')).toBe('184 lb');
      expect(formatWeight(184, 'metric')).toBe('83 kg');
    });
  });

  describe('displayWeightDelta', () => {
    it('keeps lb deltas to one decimal in imperial', () => {
      expect(displayWeightDelta(7, 'imperial')).toBe(7);
      expect(displayWeightDelta(7.04, 'imperial')).toBe(7);
      expect(displayWeightDelta(-2.36, 'imperial')).toBe(-2.4);
    });
    it('converts deltas to kg to one decimal in metric', () => {
      expect(displayWeightDelta(7, 'metric')).toBeCloseTo(3.2, 1);
      expect(displayWeightDelta(-7, 'metric')).toBeCloseTo(-3.2, 1);
    });
  });

  describe('weightStepLb', () => {
    it('steps by 1 lb in imperial', () => {
      expect(weightStepLb('imperial')).toBe(1);
    });
    it('steps by ~2.205 lb (1 kg) in metric so the kg display moves by 1', () => {
      expect(weightStepLb('metric')).toBeCloseTo(2.2046, 3);
      // a single metric step should move the displayed kg by exactly 1
      const start = 184;
      const next = start + weightStepLb('metric');
      expect(displayWeight(next, 'metric') - displayWeight(start, 'metric')).toBe(1);
    });
  });
});
