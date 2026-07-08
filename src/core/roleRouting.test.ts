import { flowForRole, serverRoleForFlow } from './constants';

// Regression guard for the 2026-07-04 routing bug: a coach/trainer/parent whose profile
// stores the DB user_role enum ('coach'/'trainer'/'parent') must route to THEIR dashboard,
// not fall through to the athlete app.
describe('flowForRole — DB enum values (the routing fix)', () => {
  it('maps the coarse DB user_role values to the right flow', () => {
    expect(flowForRole('coach')).toBe('coach');
    expect(flowForRole('trainer')).toBe('trainer');
    expect(flowForRole('parent')).toBe('parent');
    expect(flowForRole('athlete')).toBe('app');
  });
  it('still maps the granular onboarding roles', () => {
    expect(flowForRole('sports_perf_coach')).toBe('coach');
    expect(flowForRole('hs_coach')).toBe('coach');
    expect(flowForRole('college_coach')).toBe('coach');
    expect(flowForRole('personal_trainer')).toBe('trainer');
    expect(flowForRole('nutritionist')).toBe('trainer');
  });
  it('unknown/null falls back to the athlete app', () => {
    expect(flowForRole(null)).toBe('app');
    expect(flowForRole('nonsense')).toBe('app');
  });
});

describe('serverRoleForFlow — what we persist at signup', () => {
  it('maps each flow to its DB user_role enum value', () => {
    expect(serverRoleForFlow('coach')).toBe('coach');
    expect(serverRoleForFlow('trainer')).toBe('trainer');
    expect(serverRoleForFlow('parent')).toBe('parent');
    expect(serverRoleForFlow('app')).toBe('athlete');
    expect(serverRoleForFlow('onboarding')).toBe('athlete');
  });
  it('round-trips: a granular coach role -> flow -> stored enum -> flow stays coach', () => {
    const stored = serverRoleForFlow(flowForRole('sports_perf_coach'));
    expect(stored).toBe('coach');
    expect(flowForRole(stored)).toBe('coach');
  });
});
