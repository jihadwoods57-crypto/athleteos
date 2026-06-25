// AthleteOS — athlete onboarding step order. Proves the real-data consent gate is
// present ONLY when the backend is live, so with the flag off the flow is byte-identical
// to today (no extra step, same order, consent never reachable before any real-data push).
import { athleteFlowKeys } from './flows';

describe('athleteFlowKeys', () => {
  it('flag OFF: no consent step; flow ends at the activation challenge', () => {
    const keys = athleteFlowKeys(false);
    expect(keys).not.toContain('consent');
    expect(keys[keys.length - 1]).toBe('challenge');
    expect(keys[keys.length - 2]).toBe('score');
  });

  it('flag ON: consent sits right after the score reveal and before activation', () => {
    const keys = athleteFlowKeys(true);
    expect(keys).toContain('consent');
    const ci = keys.indexOf('consent');
    expect(keys[ci - 1]).toBe('score');
    expect(keys[ci + 1]).toBe('challenge');
  });

  it('flag ON adds exactly one step vs flag OFF (otherwise identical order)', () => {
    const off = athleteFlowKeys(false);
    const on = athleteFlowKeys(true);
    expect(on.length).toBe(off.length + 1);
    expect(on.filter((k) => k !== 'consent')).toEqual(off);
  });
});
