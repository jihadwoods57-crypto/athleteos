// OnStandard — active-workspace selector (pure TS, no RN/Supabase).
//
// PHASE A seam (docs/architecture/07 + DECISION-MEMO D5). A multi-org member (a
// nutritionist serving several schools, or an athlete in a school + a club + a private
// trainer + a family) acts inside exactly ONE organization per request. This module
// resolves "which org am I acting in" purely from the member's grants.
//
// INERT BY DESIGN: with a single membership it resolves to that org and renders no
// switcher — byte-identical to today's single-flow app (the same discipline as
// consent.ts / subscription.ts). The selector is a NARROWING hint; the server (RLS over
// org_memberships) is always the authority and never widens access from it.
//
// It also resolves the athlete's PRIMARY org — the one whose plan drives their own
// Development Score / Game Plan / accountability (the athlete chooses; memo D5). Every
// other org's plan is a Reference Plan.
import type { Membership, MembershipRole, Scope } from './membership';
import { isActiveMembership } from './membership';

export interface Workspace {
  organizationId: string;
  /** The member's highest-privilege role in this org (a member may hold several grants). */
  role: MembershipRole;
  /** The representative grant's scope (the broadest the member holds in this org). */
  scope: Scope;
}

// Higher = more privileged. Used to pick the representative grant when a member holds
// several in one org (e.g. a coach who is also a parent).
const ROLE_RANK: Record<MembershipRole, number> = {
  admin: 7, head_coach: 6, assistant_coach: 5, nutritionist: 4, trainer: 4,
  guardian: 3, athlete: 2, client: 1,
};

/** The distinct organizations the member can act in (one Workspace per org, taking the
 *  member's highest-privilege active grant as the representative). Sorted by org id for
 *  determinism. */
export function availableWorkspaces(userId: string, all: Membership[]): Workspace[] {
  const byOrg = new Map<string, Membership>();
  for (const g of all) {
    if (g.memberId !== userId || !isActiveMembership(g)) continue;
    const cur = byOrg.get(g.organizationId);
    if (!cur || ROLE_RANK[g.role] > ROLE_RANK[cur.role]) byOrg.set(g.organizationId, g);
  }
  return [...byOrg.values()]
    .sort((a, b) => (a.organizationId < b.organizationId ? -1 : 1))
    .map((g) => ({ organizationId: g.organizationId, role: g.role, scope: g.scope }));
}

/** The in-force workspace: the selected org when the member still has it, else the first
 *  available (deterministic). Null when the member belongs to no org. */
export function resolveActiveWorkspace(available: Workspace[], selectedOrgId?: string | null): Workspace | null {
  if (available.length === 0) return null;
  const sel = selectedOrgId ? available.find((w) => w.organizationId === selectedOrgId) : undefined;
  return sel ?? available[0];
}

/** Whether to render a workspace switcher at all. False for 0-1 workspaces, so the UI is
 *  inert until a member genuinely belongs to more than one org. */
export function showsWorkspaceSwitcher(available: Workspace[]): boolean {
  return available.length > 1;
}

/** The athlete's own active athlete-grants (one per org they're a member of). */
export function athleteMemberships(athleteId: string, all: Membership[]): Membership[] {
  return all.filter((m) => m.memberId === athleteId && m.role === 'athlete' && isActiveMembership(m));
}

/**
 * The athlete's PRIMARY organization — the one whose plan governs their own score/Game
 * Plan (memo D5: the athlete chooses). Returns the chosen org when it's still a live
 * athlete-membership; otherwise, if they belong to exactly one org, that one; otherwise
 * null = the athlete must choose (no implicit default when several orgs compete, so no
 * org silently wins the athlete's number).
 */
export function primaryAthleteOrg(athleteId: string, all: Membership[], chosenOrgId?: string | null): string | null {
  const mine = athleteMemberships(athleteId, all);
  if (mine.length === 0) return null;
  if (chosenOrgId && mine.some((m) => m.organizationId === chosenOrgId)) return chosenOrgId;
  return mine.length === 1 ? mine[0].organizationId : null;
}

/** True when the athlete belongs to multiple orgs but hasn't chosen a primary — the UI
 *  must prompt them to pick which plan governs their score (memo D5). */
export function needsPrimaryChoice(athleteId: string, all: Membership[], chosenOrgId?: string | null): boolean {
  return athleteMemberships(athleteId, all).length > 1 && primaryAthleteOrg(athleteId, all, chosenOrgId) === null;
}
