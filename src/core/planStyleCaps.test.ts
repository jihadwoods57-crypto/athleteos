/**
 * THE INTEGRITY GATE for plan styles.
 *
 * Migration 0041 clamps a written day score to an evidence ceiling built from the MAXIMUM weight
 * each component carries across all scoring profiles (nutrition 55 / recovery 25 / commitment 15
 * / checkin 10), mirrored in TS by scoreIntegrity.ts's MAX_SUBSCORE_WEIGHT. Neither the trigger
 * nor that constant knows plan styles exist.
 *
 * That is only safe while NO style pushes a component above its cap. This file is what makes it
 * safe: it sweeps every style x profile in STYLE_WEIGHTS and every reachable override permutation
 * of the knobs, asserting the caps hold and the mix still sums to 1. If a future founder tunes a
 * style past a cap, this fails LOUDLY here instead of silently loosening the server anti-tamper
 * bound for every user on the platform.
 *
 * If you ever genuinely need to raise a cap: change 0041, MAX_SUBSCORE_WEIGHT, and WEIGHT_CAPS
 * together, and understand that a tampered client gains exactly that much headroom.
 */
import {
  STYLE_KEYS, STYLE_WEIGHTS, WEIGHT_CAPS, PRESETS, NUTRITION_PARTS,
  weightsFor, weightsWithinCaps, knobsFor, SIGNAL_KEYS,
  type PlanStyle,
} from './planStyle';
import { PROFILE_WEIGHTS } from './scoringProfiles';
import { MAX_SUBSCORE_WEIGHT } from './scoreIntegrity';
import type { ScoringProfile } from './types';

const PROFILES: ScoringProfile[] = ['athlete', 'general', 'gain'];
const COMPONENTS = ['nutrition', 'recovery', 'commitment', 'checkin'] as const;

describe('plan-style weights can never breach the 0041 evidence ceiling', () => {
  test('WEIGHT_CAPS equals the ceiling scoreIntegrity derives from PROFILE_WEIGHTS', () => {
    // If these ever disagree, the caps this file enforces are not the caps the server enforces.
    expect(WEIGHT_CAPS).toEqual(MAX_SUBSCORE_WEIGHT);
  });

  test('every style x profile is within caps and sums to 1', () => {
    for (const style of STYLE_KEYS) {
      for (const profile of PROFILES) {
        const w = weightsFor(style, profile);
        expect({ style, profile, ok: weightsWithinCaps(w) }).toEqual({ style, profile, ok: true });
      }
    }
  });

  test('no single component exceeds its cap anywhere in the matrix', () => {
    for (const style of STYLE_KEYS) {
      for (const profile of PROFILES) {
        const w = weightsFor(style, profile);
        for (const c of COMPONENTS) {
          expect(w[c]).toBeLessThanOrEqual(WEIGHT_CAPS[c]);
        }
      }
    }
  });

  test('an unknown style or profile still resolves to a capped, valid mix', () => {
    for (const bad of [null, undefined, '', 'keto', 'STRUCTURED ', 42]) {
      expect(weightsWithinCaps(weightsFor(bad, 'athlete'))).toBe(true);
      expect(weightsWithinCaps(weightsFor('guided', bad))).toBe(true);
    }
  });
});

describe('grandfathering is provable, not approximate', () => {
  test('the structured row IS PROFILE_WEIGHTS, byte for byte', () => {
    // This identity is the whole proof that an existing account does not move on release day.
    for (const profile of PROFILES) {
      expect(STYLE_WEIGHTS.structured[profile]).toEqual(PROFILE_WEIGHTS[profile]);
    }
  });
});

describe('nutrition parts stay a valid 0..100 composition under any override', () => {
  test('every preset sums to 100', () => {
    for (const style of STYLE_KEYS) {
      const total = Object.values(NUTRITION_PARTS[style]).reduce((a, b) => a + b, 0);
      expect({ style, total }).toEqual({ style, total: 100 });
    }
  });

  test('knobsFor re-normalizes a lopsided pro override back to 100', () => {
    const k = knobsFor('guided', { parts: { protein: 500, calorie: 500, timing: 0, hydration: 0, quality: 0, awareness: 0 } });
    const total = Object.values(k.parts).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  test('a part whose knob is OFF earns nothing — a pro cannot silently cap the athlete below 100', () => {
    // Weighting `quality` on Structured (which never measures it) would otherwise strand 30 points.
    const k = knobsFor('structured', {
      parts: { protein: 40, calorie: 30, timing: 0, hydration: 0, quality: 30, awareness: 0 },
    });
    expect(k.nutrition.qualityScored).toBe(false);
    expect(k.parts.quality).toBe(0);
    expect(Object.values(k.parts).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  test('turning protein off zeroes its part and redistributes', () => {
    const k = knobsFor('structured', { nutrition: { protein: 'off' } });
    expect(k.parts.protein).toBe(0);
    expect(Object.values(k.parts).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });
});

describe('override sweep — no permutation produces an invalid engine input', () => {
  const CAL = ['exact', 'range', 'adequacy', 'off'] as const;
  const PRO = ['exact', 'range', 'off'] as const;
  const BOOLS = [true, false];

  test('every calorie x protein x scored-flag permutation stays valid', () => {
    for (const style of STYLE_KEYS) {
      for (const calorie of CAL) {
        for (const protein of PRO) {
          for (const timingScored of BOOLS) {
            for (const qualityScored of BOOLS) {
              for (const awarenessScored of BOOLS) {
                const k = knobsFor(style, {
                  nutrition: { calorie, protein, timingScored, qualityScored, awarenessScored },
                });
                const total = Object.values(k.parts).reduce((a, b) => a + b, 0);
                expect(total).toBeCloseTo(100, 6);
                for (const v of Object.values(k.parts)) {
                  expect(v).toBeGreaterThanOrEqual(0);
                  expect(v).toBeLessThanOrEqual(100);
                }
                expect(k.nutrition.calorieBand).toBeGreaterThanOrEqual(0);
                expect(k.nutrition.calorieBand).toBeLessThanOrEqual(0.5);
              }
            }
          }
        }
      }
    }
  });

  test('hostile override values are rejected, not absorbed', () => {
    const k = knobsFor('guided', {
      nutrition: { calorie: 'zzz', protein: 9, calorieBand: 99, proteinBand: -3, timingScored: 'yes' },
      surface: { tone: 'evil', showMacros: 'nope' },
      signals: { hunger: 'maybe', notAKey: true },
    } as any);
    expect(k.nutrition.calorie).toBe(PRESETS.guided.nutrition.calorie);
    expect(k.nutrition.protein).toBe(PRESETS.guided.nutrition.protein);
    expect(k.nutrition.calorieBand).toBe(PRESETS.guided.nutrition.calorieBand); // 99 is out of range
    expect(k.nutrition.proteinBand).toBe(PRESETS.guided.nutrition.proteinBand); // negative rejected
    expect(k.nutrition.timingScored).toBe(PRESETS.guided.nutrition.timingScored);
    expect(k.surface.tone).toBe(PRESETS.guided.surface.tone);
    expect(k.surface.showMacros).toBe(PRESETS.guided.surface.showMacros);
    expect(k.signals.hunger).toBe(PRESETS.guided.signals.hunger);
    expect((k.signals as any).notAKey).toBeUndefined();
  });

  test('overrides never mutate the shared presets', () => {
    const before = JSON.stringify(PRESETS);
    knobsFor('intuitive', { nutrition: { calorie: 'exact' }, parts: { protein: 90 }, signals: { hunger: false } });
    knobsFor('structured', { surface: { showMacros: false } });
    expect(JSON.stringify(PRESETS)).toBe(before);
  });

  test('every signal key is representable in the preset signal maps', () => {
    for (const style of STYLE_KEYS as PlanStyle[]) {
      for (const { key } of SIGNAL_KEYS) {
        expect(typeof PRESETS[style].signals[key]).toBe('boolean');
      }
    }
  });
});
