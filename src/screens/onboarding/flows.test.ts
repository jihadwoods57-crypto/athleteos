// OnStandard — athlete onboarding step order. Proves the account-creation + consent
// gates are present ONLY when the backend is live, so with the flag off the flow is
// byte-identical to today (no extra steps, same order, neither reachable before any
// real-data path exists).
import { athleteFlowKeys, roleFlowFor, ROLE_FLOWS } from './flows';

describe('athleteFlowKeys', () => {
  it('flag OFF: no account/consent steps; flow ends at the activation challenge', () => {
    const keys = athleteFlowKeys(false);
    expect(keys).not.toContain('consent');
    expect(keys).not.toContain('account');
    expect(keys[keys.length - 1]).toBe('challenge');
    expect(keys[keys.length - 2]).toBe('score');
  });

  it('flag ON: account → consent sit between the score reveal and activation', () => {
    const keys = athleteFlowKeys(true);
    const ai = keys.indexOf('account');
    const ci = keys.indexOf('consent');
    expect(keys[ai - 1]).toBe('score'); // account right after the score reveal
    expect(keys[ai + 1]).toBe('consent'); // then consent
    expect(keys[ci + 1]).toBe('challenge'); // then activation
  });

  it('flag ON adds exactly the two gated steps vs flag OFF (otherwise identical order)', () => {
    const off = athleteFlowKeys(false);
    const on = athleteFlowKeys(true);
    expect(on.length).toBe(off.length + 2);
    expect(on.filter((k) => k !== 'consent' && k !== 'account')).toEqual(off);
  });
});

describe('roleFlowFor (overseer account step)', () => {
  it('flag OFF: every role flow is unchanged', () => {
    for (const role of Object.keys(ROLE_FLOWS) as (keyof typeof ROLE_FLOWS)[]) {
      const flow = ROLE_FLOWS[role];
      if (!flow) continue;
      expect(roleFlowFor(flow, false)).toEqual(flow);
    }
  });

  it('flag ON: inserts one account step immediately before the invite', () => {
    const coach = ROLE_FLOWS.hs_coach ?? [];
    const live = roleFlowFor(coach, true);
    expect(live.length).toBe(coach.length + 1);
    const inviteIdx = live.findIndex((s) => s.kind === 'invite');
    expect(live[inviteIdx - 1].kind).toBe('account');
  });
});
