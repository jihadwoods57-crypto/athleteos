// First-day activation (no retroactive failure). Pure proto helper — same // @ts-ignore ESM
// import pattern as requirementsEngine.test.ts (no DOM needed).
// @ts-ignore
import {
  ACTIVATION_BUFFER_MIN,
  parseActivation,
  windowPreActivation,
  activationInfo,
  // @ts-ignore
} from '../../proto/redesign-2026-07/js/activation.js';

// A local wall-clock stamp round-trips through toISOString back to the SAME local date/min,
// so these assertions hold regardless of the test runner's timezone.
const localStamp = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).toISOString();

describe('parseActivation', () => {
  test('null / empty / garbage → null', () => {
    expect(parseActivation(null)).toBeNull();
    expect(parseActivation('')).toBeNull();
    expect(parseActivation('not-a-date')).toBeNull();
  });
  test('bare YYYY-MM-DD → that date, minute 0 (no time-of-day)', () => {
    expect(parseActivation('2026-07-18')).toEqual({ date: '2026-07-18', min: 0 });
  });
  test('ISO datetime → local date + local minute-of-day', () => {
    // 6:34 PM local → 18*60+34 = 1114
    expect(parseActivation(localStamp(2026, 7, 18, 18, 34))).toEqual({ date: '2026-07-18', min: 1114 });
  });
});

describe('windowPreActivation — a window that closed before the athlete could act', () => {
  test('due at/before activation+buffer → pre-activation (true)', () => {
    // lunch due 14:00 (840), activated 18:34 (1114) → long closed
    expect(windowPreActivation(840, 1114)).toBe(true);
    // exactly at the buffer edge counts as pre-activation
    expect(windowPreActivation(1114 + ACTIVATION_BUFFER_MIN, 1114)).toBe(true);
  });
  test('due comfortably after activation+buffer → still the athlete’s to do (false)', () => {
    // dinner due 20:30 (1230) with a 60-min buffer past 18:34 → 1174 < 1230
    expect(windowPreActivation(1230, 1114)).toBe(false);
  });
  test('no activation (fully active) or no due → never pre-activation', () => {
    expect(windowPreActivation(840, null)).toBe(false);
    expect(windowPreActivation(null, 1114)).toBe(false);
  });
});

describe('activationInfo — first-day grace only on the activation day', () => {
  test('activated today → activation day, not-yet-scored, activationMin set', () => {
    const info = activationInfo(localStamp(2026, 7, 18, 18, 34), '2026-07-18');
    expect(info.isActivationDay).toBe(true);
    expect(info.notYetScored).toBe(true);
    expect(info.activationMin).toBe(1114);
  });
  test('activated yesterday → fully active (full scoring), no grace', () => {
    const info = activationInfo(localStamp(2026, 7, 17, 18, 34), '2026-07-18');
    expect(info.isActivationDay).toBe(false);
    expect(info.notYetScored).toBe(false);
    expect(info.activationMin).toBeNull();
  });
  test('no activation stamp (existing user) → fully active, unaffected', () => {
    const info = activationInfo(null, '2026-07-18');
    expect(info.isActivationDay).toBe(false);
    expect(info.notYetScored).toBe(false);
    expect(info.activationMin).toBeNull();
  });
});
