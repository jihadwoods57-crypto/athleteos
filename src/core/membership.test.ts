import { can, canView, membershipAllows, reachingMemberships, scopeContains, type Membership, type Scope } from './membership';

const ORG = 'org-1';
const m = (over: Partial<Membership>): Membership => ({
  id: over.id ?? 'm', organizationId: ORG, memberId: 'x', role: 'athlete',
  scope: { kind: 'organization', id: null }, permissions: {}, status: 'active', ...over,
});
const ath = (id: string, scope: Scope, org = ORG): Membership =>
  m({ id: 'a-' + id, memberId: id, role: 'athlete', scope, organizationId: org });

describe('scopeContains', () => {
  it('org contains everything in the org', () => {
    expect(scopeContains({ kind: 'organization', id: null }, { kind: 'group', id: 'g1' })).toBe(true);
    expect(scopeContains({ kind: 'organization', id: null }, { kind: 'individual', id: 'p1' })).toBe(true);
  });
  it('group contains only its own group', () => {
    expect(scopeContains({ kind: 'group', id: 'g1' }, { kind: 'group', id: 'g1' })).toBe(true);
    expect(scopeContains({ kind: 'group', id: 'g1' }, { kind: 'group', id: 'g2' })).toBe(false);
  });
  it('individual contains only the exact athlete', () => {
    expect(scopeContains({ kind: 'individual', id: 'p1' }, { kind: 'individual', id: 'p1' })).toBe(true);
    expect(scopeContains({ kind: 'individual', id: 'p1' }, { kind: 'individual', id: 'p2' })).toBe(false);
  });
});

describe('canView', () => {
  it('an athlete always sees their own data', () => {
    expect(canView('p1', 'p1', [])).toBe(true);
  });

  it('a group-scoped coach sees only athletes in that group', () => {
    const all: Membership[] = [
      ath('p1', { kind: 'group', id: 'LB' }),
      ath('p2', { kind: 'group', id: 'QB' }),
      m({ id: 'coach', memberId: 'c', role: 'assistant_coach', scope: { kind: 'group', id: 'LB' } }),
    ];
    expect(canView('c', 'p1', all)).toBe(true); // LB
    expect(canView('c', 'p2', all)).toBe(false); // QB — out of scope
  });

  it('an org-scoped head coach sees the whole roster', () => {
    const all: Membership[] = [
      ath('p1', { kind: 'group', id: 'LB' }),
      ath('p2', { kind: 'group', id: 'QB' }),
      m({ id: 'hc', memberId: 'h', role: 'head_coach', scope: { kind: 'organization', id: null } }),
    ];
    expect(canView('h', 'p1', all)).toBe(true);
    expect(canView('h', 'p2', all)).toBe(true);
  });

  it('a trainer/guardian individual grant reaches exactly one athlete', () => {
    const all: Membership[] = [
      m({ id: 't', memberId: 'tr', role: 'trainer', scope: { kind: 'individual', id: 'p1' }, organizationId: 'trainer-org' }),
    ];
    expect(canView('tr', 'p1', all)).toBe(true);
    expect(canView('tr', 'p9', all)).toBe(false);
  });

  it('containment requires the SAME organization (cross-org coach cannot peek)', () => {
    const all: Membership[] = [
      ath('p1', { kind: 'group', id: 'LB' }, 'school-A'),
      m({ id: 'coach', memberId: 'c', role: 'head_coach', scope: { kind: 'organization', id: null }, organizationId: 'school-B' }),
    ];
    expect(canView('c', 'p1', all)).toBe(false);
  });

  it('an inactive (transferred/removed) grant grants nothing', () => {
    const all: Membership[] = [
      ath('p1', { kind: 'group', id: 'LB' }),
      m({ id: 'coach', memberId: 'c', role: 'head_coach', scope: { kind: 'organization', id: null }, status: 'removed' }),
    ];
    expect(canView('c', 'p1', all)).toBe(false);
  });

  it('unlimited orgs: two different orgs each see the same one athlete profile', () => {
    const all: Membership[] = [
      ath('p1', { kind: 'group', id: 'LB' }, 'school'),
      ath('p1', { kind: 'group', id: 'club' }, 'club'),
      m({ id: 'hc', memberId: 'school-coach', role: 'head_coach', scope: { kind: 'organization', id: null }, organizationId: 'school' }),
      m({ id: 'cc', memberId: 'club-coach', role: 'head_coach', scope: { kind: 'organization', id: null }, organizationId: 'club' }),
    ];
    expect(canView('school-coach', 'p1', all)).toBe(true);
    expect(canView('club-coach', 'p1', all)).toBe(true);
  });
});

describe('can (permission resolution)', () => {
  const roster: Membership[] = [
    ath('p1', { kind: 'group', id: 'LB' }),
    m({ id: 'hc', memberId: 'h', role: 'head_coach', scope: { kind: 'organization', id: null } }),
    m({ id: 'asst', memberId: 'a', role: 'assistant_coach', scope: { kind: 'group', id: 'LB' } }),
    m({ id: 'par', memberId: 'mom', role: 'guardian', scope: { kind: 'individual', id: 'p1' }, organizationId: 'family' }),
  ];

  it('the athlete may act on their own data', () => {
    expect(can('p1', 'p1', 'edit_plan', roster)).toBe(true);
  });
  it('a head coach may set targets; an assistant may not (role defaults)', () => {
    expect(can('h', 'p1', 'set_targets', roster)).toBe(true);
    expect(can('a', 'p1', 'set_targets', roster)).toBe(false);
    expect(can('a', 'p1', 'view_reports', roster)).toBe(true);
  });
  it('a guardian can view + message but not edit the plan', () => {
    expect(can('mom', 'p1', 'view_reports', roster)).toBe(true);
    expect(can('mom', 'p1', 'message', roster)).toBe(true);
    expect(can('mom', 'p1', 'edit_plan', roster)).toBe(false);
  });
  it('a per-grant override beats the role default', () => {
    const asstPlus = roster.map((x) => (x.id === 'asst' ? { ...x, permissions: { set_targets: true } } : x));
    expect(can('a', 'p1', 'set_targets', asstPlus)).toBe(true);
  });
  it('no permission reaches an athlete the viewer cannot see', () => {
    expect(can('h', 'stranger', 'view_reports', roster)).toBe(false);
  });
});

describe('reachingMemberships + membershipAllows', () => {
  it('returns only the grants that actually reach the athlete', () => {
    const all: Membership[] = [
      ath('p1', { kind: 'group', id: 'LB' }),
      m({ id: 'g1', memberId: 'c', role: 'assistant_coach', scope: { kind: 'group', id: 'LB' } }),
      m({ id: 'g2', memberId: 'c', role: 'assistant_coach', scope: { kind: 'group', id: 'QB' } }),
    ];
    const reach = reachingMemberships('c', 'p1', all);
    expect(reach.map((r) => r.id)).toEqual(['g1']);
    expect(membershipAllows(reach[0], 'view_reports')).toBe(true);
    expect(membershipAllows(reach[0], 'manage_billing')).toBe(false);
  });
});
