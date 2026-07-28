import { evaluateFlag, evaluateAll, type FlagRow } from '../../supabase/functions/_shared/feature-flags';

const base: FlagRow = {
  name: 'f', default_on: false, kill_switch: false,
  enabled_user_ids: [], enabled_roles: [], enabled_org_ids: [],
};

describe('evaluateFlag', () => {
  test('default_on governs when nothing matches', () => {
    expect(evaluateFlag({ ...base, default_on: true }, {})).toBe(true);
    expect(evaluateFlag({ ...base, default_on: false }, {})).toBe(false);
  });
  test('user allowlist flips on', () => {
    expect(evaluateFlag({ ...base, enabled_user_ids: ['u1'] }, { userId: 'u1' })).toBe(true);
    expect(evaluateFlag({ ...base, enabled_user_ids: ['u1'] }, { userId: 'u2' })).toBe(false);
  });
  test('role allowlist flips on', () => {
    expect(evaluateFlag({ ...base, enabled_roles: ['coach'] }, { role: 'coach' })).toBe(true);
  });
  test('org allowlist flips on', () => {
    expect(evaluateFlag({ ...base, enabled_org_ids: ['o1'] }, { orgId: 'o1' })).toBe(true);
  });
  test('kill_switch overrides every allowlist and default', () => {
    const f = { ...base, default_on: true, kill_switch: true, enabled_user_ids: ['u1'], enabled_roles: ['coach'], enabled_org_ids: ['o1'] };
    expect(evaluateFlag(f, { userId: 'u1', role: 'coach', orgId: 'o1' })).toBe(false);
  });
  test('empty context never throws and yields default', () => {
    expect(evaluateFlag({ ...base, enabled_user_ids: ['u1'], default_on: true }, {})).toBe(true);
  });
});

describe('evaluateAll', () => {
  test('maps every flag by name', () => {
    const flags: FlagRow[] = [
      { ...base, name: 'a', default_on: true },
      { ...base, name: 'b', enabled_user_ids: ['u1'] },
    ];
    expect(evaluateAll(flags, { userId: 'u1' })).toEqual({ a: true, b: true });
  });
});
