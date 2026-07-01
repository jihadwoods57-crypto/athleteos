import {
  availableWorkspaces, needsPrimaryChoice, primaryAthleteOrg, resolveActiveWorkspace, showsWorkspaceSwitcher,
} from './workspace';
import type { Membership } from './membership';

const g = (over: Partial<Membership>): Membership => ({
  id: 'g', organizationId: 'o', memberId: 'u', role: 'athlete',
  scope: { kind: 'organization', id: null }, permissions: {}, status: 'active', ...over,
});

describe('availableWorkspaces', () => {
  it('one workspace per org, taking the highest-privilege grant', () => {
    const all: Membership[] = [
      g({ id: '1', memberId: 'u', organizationId: 'school', role: 'guardian', scope: { kind: 'individual', id: 'kid' } }),
      g({ id: '2', memberId: 'u', organizationId: 'school', role: 'head_coach', scope: { kind: 'organization', id: null } }),
      g({ id: '3', memberId: 'u', organizationId: 'club', role: 'assistant_coach', scope: { kind: 'group', id: 'x' } }),
    ];
    const ws = availableWorkspaces('u', all);
    expect(ws.map((w) => w.organizationId)).toEqual(['club', 'school']);
    expect(ws.find((w) => w.organizationId === 'school')!.role).toBe('head_coach'); // beat guardian
  });
  it('ignores inactive grants and other members', () => {
    const all: Membership[] = [
      g({ memberId: 'u', organizationId: 'a', status: 'transferred' }),
      g({ memberId: 'other', organizationId: 'b' }),
    ];
    expect(availableWorkspaces('u', all)).toEqual([]);
  });
});

describe('resolveActiveWorkspace + switcher (inert single-org)', () => {
  const all: Membership[] = [
    g({ memberId: 'u', organizationId: 'a', role: 'head_coach' }),
    g({ memberId: 'u', organizationId: 'b', role: 'trainer', scope: { kind: 'individual', id: 'p' } }),
  ];
  it('selected org wins when still held; else the first', () => {
    const ws = availableWorkspaces('u', all);
    expect(resolveActiveWorkspace(ws, 'b')!.organizationId).toBe('b');
    expect(resolveActiveWorkspace(ws, 'gone')!.organizationId).toBe('a'); // fallback
    expect(resolveActiveWorkspace([], 'x')).toBeNull();
  });
  it('no switcher for 0 or 1 workspaces; switcher only for 2+', () => {
    expect(showsWorkspaceSwitcher(availableWorkspaces('u', [all[0]]))).toBe(false);
    expect(showsWorkspaceSwitcher(availableWorkspaces('u', all))).toBe(true);
  });
});

describe('primaryAthleteOrg (athlete chooses; memo D5)', () => {
  const oneOrg: Membership[] = [g({ memberId: 'ath', organizationId: 'school', role: 'athlete' })];
  const twoOrgs: Membership[] = [
    g({ id: 's', memberId: 'ath', organizationId: 'school', role: 'athlete' }),
    g({ id: 't', memberId: 'ath', organizationId: 'trainer', role: 'athlete' }),
  ];
  it('single org is automatically primary', () => {
    expect(primaryAthleteOrg('ath', oneOrg)).toBe('school');
    expect(needsPrimaryChoice('ath', oneOrg)).toBe(false);
  });
  it('multiple orgs: no implicit default — the athlete must choose', () => {
    expect(primaryAthleteOrg('ath', twoOrgs)).toBeNull();
    expect(needsPrimaryChoice('ath', twoOrgs)).toBe(true);
  });
  it('honors a valid chosen org; ignores a stale choice', () => {
    expect(primaryAthleteOrg('ath', twoOrgs, 'trainer')).toBe('trainer');
    expect(needsPrimaryChoice('ath', twoOrgs, 'trainer')).toBe(false);
    expect(primaryAthleteOrg('ath', twoOrgs, 'gone-org')).toBeNull();
  });
  it('no membership -> no primary', () => {
    expect(primaryAthleteOrg('ath', [])).toBeNull();
  });
});
