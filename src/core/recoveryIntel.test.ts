// Proto is plain ESM JS (allowJs) — same import pattern as mealIntel.test.
// @ts-ignore
import { recoverySignals, recoveryCoachMessage } from '../../proto/redesign-2026-07/js/recovery-intel.js';
// @ts-ignore
import { CI_BEST } from '../../proto/redesign-2026-07/js/breakdown-model.js';

const CFG4 = { energy: true, recovery: true, sleep: true, confidence: true };

describe('recoverySignals', () => {
  test('only enabled + answered fields, sorted worst-first', () => {
    const sig = recoverySignals(
      { energy: 8, recovery: 4, sleep: 10, confidence: 6, motivation: 2 },
      CFG4, // motivation answered but not enabled — must not appear
    );
    expect(sig.map((s: { key: string }) => s.key)).toEqual(['recovery', 'confidence', 'energy', 'sleep']);
  });
  test('inverse polarity: high soreness is the WORST signal, not the best', () => {
    const sig = recoverySignals(
      { energy: 8, soreness: 10 },
      { energy: true, soreness: true },
    );
    expect(sig[0].key).toBe('soreness');
    expect(sig[0].good).toBe(0);
    expect(sig[0].chip).toBe(5); // spoken as the athlete's own 5/5 answer
  });
  test('cravings invert too (day.js CI_INVERSE parity)', () => {
    const sig = recoverySignals({ cravings: 0, sleep: 6 }, { cravings: true, sleep: true });
    expect(sig[sig.length - 1].key).toBe('cravings'); // no cravings = the strongest signal
  });
  test('missing/garbage input yields empty', () => {
    expect(recoverySignals(undefined, undefined)).toEqual([]);
    expect(recoverySignals({ energy: 'high' }, { energy: true })).toEqual([]);
  });
});

describe('recoveryCoachMessage', () => {
  test('weakest signal drives the message, named with the athlete chip number', () => {
    const msg = recoveryCoachMessage({ ci: { energy: 8, recovery: 8, sleep: 4, confidence: 8 }, ciConfig: CFG4 });
    expect(msg).toContain('Sleep came in at 2/5');
    expect(msg).toMatch(/lights-out/); // sleep-specific move, not generic advice
  });
  test('soreness at 5/5 gets soreness coaching (inverse polarity honored)', () => {
    const msg = recoveryCoachMessage({
      ci: { energy: 8, soreness: 10 },
      ciConfig: { energy: true, soreness: true },
    });
    expect(msg).toContain('Soreness came in at 5/5');
    expect(msg).toMatch(/easy movement/);
  });
  test('all-strong board earns recognition, never an invented problem', () => {
    const msg = recoveryCoachMessage({ ci: { energy: 10, recovery: 8, sleep: 10, confidence: 10 }, ciConfig: CFG4 });
    expect(msg).toMatch(/Strong board/);
    expect(msg).not.toMatch(/came in at/);
  });
  test('coach visibility line only with a coach; solo gets the forward frame', () => {
    const ci = { energy: 6, recovery: 6, sleep: 6, confidence: 6 };
    expect(recoveryCoachMessage({ ci, ciConfig: CFG4, hasCoach: true, coachName: 'Coach Reyes' }))
      .toContain('Coach Reyes sees this');
    expect(recoveryCoachMessage({ ci, ciConfig: CFG4 })).toContain("Tomorrow's readiness");
  });
  test('markup is stripped from the coach name and output stays bounded', () => {
    const msg = recoveryCoachMessage({
      ci: { energy: 4 }, ciConfig: { energy: true }, hasCoach: true, coachName: '<b>X</b>',
    });
    expect(msg).not.toContain('<');
    expect(msg.length).toBeLessThanOrEqual(600);
  });
  test('nothing to speak to yields empty (caller hides the card)', () => {
    expect(recoveryCoachMessage({})).toBe('');
  });
});

describe('CI_BEST (shared ceiling constant)', () => {
  test('is exported and best on every axis, inverse fields at 0', () => {
    expect(CI_BEST).toMatchObject({ energy: 10, recovery: 10, sleep: 10, confidence: 10, motivation: 10, soreness: 0, cravings: 0, digestion: 10 });
  });
});
