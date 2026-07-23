/**
 * proto/plan-style.js <-> src/core/planStyle.ts parity.
 *
 * The shipped UI is the proto WebView, so plan-style.js is the copy that actually scores real
 * days; planStyle.ts is the typed copy the RN core and these tests drive. Same discipline as
 * protoNutrition.test.ts: the two are asserted equal here so they cannot drift silently, because
 * a drift would mean the athlete's device and the coach's reconstruction grade the same day
 * differently.
 */
// @ts-ignore — proto is plain ESM JS (allowJs)
import * as PROTO from '../../proto/redesign-2026-07/js/plan-style.js';
import * as CORE from './planStyle';

const PROFILES = ['athlete', 'general', 'gain'] as const;

describe('constant tables are identical', () => {
  test('style keys, defaults and caps', () => {
    expect(PROTO.STYLE_KEYS).toEqual(CORE.STYLE_KEYS);
    expect(PROTO.DEFAULT_STYLE).toBe(CORE.DEFAULT_STYLE);
    expect(PROTO.LEGACY_STYLE).toBe(CORE.LEGACY_STYLE);
    expect(PROTO.WEIGHT_CAPS).toEqual(CORE.WEIGHT_CAPS);
  });

  test('the full style x profile weight matrix', () => {
    expect(PROTO.STYLE_WEIGHTS).toEqual(CORE.STYLE_WEIGHTS);
  });

  test('nutrition parts, presets, signals and onboarding answers', () => {
    expect(PROTO.NUTRITION_PARTS).toEqual(CORE.NUTRITION_PARTS);
    expect(PROTO.PRESETS).toEqual(CORE.PRESETS);
    expect(PROTO.SIGNAL_KEYS).toEqual(CORE.SIGNAL_KEYS);
    expect(PROTO.MEAL_SIGNAL_KEYS).toEqual(CORE.MEAL_SIGNAL_KEYS);
    expect(PROTO.CHECKIN_SIGNAL_KEYS).toEqual(CORE.CHECKIN_SIGNAL_KEYS);
    expect(PROTO.STRUCTURE_ANSWERS).toEqual(CORE.STRUCTURE_ANSWERS);
    expect(PROTO.STYLE_CONTROL).toEqual(CORE.STYLE_CONTROL);
  });
});

describe('pure functions agree across a sweep', () => {
  test('weightsFor over every style x profile (plus junk)', () => {
    for (const style of [...CORE.STYLE_KEYS, 'keto', null, undefined]) {
      for (const profile of [...PROFILES, 'nonsense', null]) {
        expect(PROTO.weightsFor(style, profile)).toEqual(CORE.weightsFor(style, profile));
      }
    }
  });

  test('knobsFor with and without overrides', () => {
    const OVERRIDES = [
      undefined,
      null,
      {},
      { nutrition: { calorie: 'range', calorieBand: 0.2 } },
      { nutrition: { protein: 'off', awarenessScored: true } },
      { parts: { protein: 10, calorie: 10, timing: 10, hydration: 10, quality: 10, awareness: 10 } },
      { signals: { hunger: true, cravings: true } },
      { surface: { showMacros: false, tone: 'signals' } },
      { nutrition: { calorie: 'bogus', calorieBand: 99 }, surface: { tone: 'evil' } },
    ];
    for (const style of CORE.STYLE_KEYS) {
      for (const o of OVERRIDES) {
        expect(PROTO.knobsFor(style, o)).toEqual(CORE.knobsFor(style, o));
      }
    }
  });

  test('rangeAdherence and fuelingAdequacy over a numeric sweep', () => {
    for (const target of [0, 1500, 2400, 3200]) {
      for (const value of [0, 900, 1400, 2000, 2400, 2900, 3200, 4800]) {
        for (const band of [0, 0.1, 0.12, 0.15, 0.3]) {
          expect(PROTO.rangeAdherence(value, target, band)).toBeCloseTo(CORE.rangeAdherence(value, target, band), 12);
        }
        expect(PROTO.fuelingAdequacy(value, target)).toBeCloseTo(CORE.fuelingAdequacy(value, target), 12);
      }
    }
  });

  test('awarenessScore over answered-set permutations', () => {
    const knobs = CORE.knobsFor('intuitive', null);
    const SETS = [[], ['hunger'], ['hunger', 'fullness'], ['hunger', 'fullness', 'satisfaction', 'digestion', 'cravings']];
    for (const answered of SETS) {
      for (const week of [undefined, 0, 0.5, 1, -3, 99]) {
        expect(PROTO.awarenessScore(answered, knobs, week)).toBeCloseTo(CORE.awarenessScore(answered, knobs as any, week), 12);
      }
    }
  });

  test('resolvePlanStyle over the permission matrix', () => {
    const ROLES = ['athlete', 'client', 'solo', 'coach', 'trainer', 'nutrition', 'parent', undefined];
    const INPUTS: any[] = [];
    for (const role of ROLES) {
      INPUTS.push({ role });
      INPUTS.push({ role, hasHistory: true });
      INPUTS.push({ role, preference: 'intuitive' });
      INPUTS.push({ role, selfChoice: 'structured' });
      INPUTS.push({ role, preference: 'intuitive', selfChoice: 'structured' });
      INPUTS.push({ role, proAssignment: { style: 'guided', setBy: 'Coach Reed' } });
      INPUTS.push({ role, teamStandard: { style: 'structured', setBy: 'UCF' }, preference: 'intuitive' });
      INPUTS.push({ role, teamStandard: { style: 'structured' }, proAssignment: { style: 'guided' }, selfChoice: 'intuitive' });
    }
    for (const input of INPUTS) {
      expect(PROTO.resolvePlanStyle(input)).toEqual(CORE.resolvePlanStyle(input));
    }
  });

  test('label + helper copy is identical', () => {
    for (const style of [...CORE.STYLE_KEYS, 'junk', null]) {
      expect(PROTO.styleLabel(style)).toEqual(CORE.styleLabel(style));
      expect(PROTO.resolveStyleKey(style)).toEqual(CORE.resolveStyleKey(style));
    }
    for (const a of ['numbers', 'flexible', 'signals', 'unsure', 'garbage']) {
      expect(PROTO.styleForStructureAnswer(a)).toBe(CORE.styleForStructureAnswer(a));
    }
    for (const role of ['athlete', 'client', 'solo', 'coach', 'nope']) {
      expect(PROTO.styleControlFor(role)).toBe(CORE.styleControlFor(role));
    }
    const res = CORE.resolvePlanStyle({ role: 'athlete', teamStandard: { style: 'structured', setBy: 'Coach Reed' } });
    expect(PROTO.styleSourceLabel(res, 'coach')).toBe(CORE.styleSourceLabel(res, 'coach'));
  });
});
