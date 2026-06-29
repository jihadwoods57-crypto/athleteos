// AthleteOS — organization membership + scope + permission model (pure TS, no RN/Supabase).
//
// PHASE A keystone (docs/architecture/01 + the ratified DECISION-MEMO). This is the
// single access-grant model the whole platform keys off: one `org_memberships` row
// generalizes today's four link tables (team_members/team_staff/practice_clients/
// guardianships). It encodes the ratified decisions:
//   - Everything is an Organization; trainer/parent/family are orgs of one/household
//     (no special-case logic — just member rows on an org).
//   - Athletes own their data; organizations own ACCESS only (this module decides
//     visibility/permission, never writes athlete data).
//   - Unlimited orgs per athlete: visibility is computed over a member's full grant set.
//
// This file is the pure SOURCE OF TRUTH for the access predicate. The SQL `can_view`
// body-swap (migration 0011, authored-not-pushed) mirrors `canView` below; keeping the
// rule here means it is offline-testable and the SQL is generated from / checked against
// it. The fail-closed CONSENT gate (src/core/consent.ts) sits ABOVE this — a valid grant
// never overrides withheld/minor-unverified consent. INERT until the backend is live.

/** Organization taxonomy. A family/solo-trainer/parent is just an org with a small
 *  membership — "the only difference is organization size." */
export type OrgType = 'school' | 'college' | 'club' | 'academy' | 'facility' | 'family' | 'individual';

/** The "subject" side (the person whose data is governed) vs the "staff/access" side. */
export type MembershipRole =
  | 'athlete' | 'client' | 'guardian' // subject side (+ guardian, a viewer-of-one)
  | 'admin' | 'head_coach' | 'assistant_coach' | 'trainer' | 'nutritionist'; // staff/professional

/** What a grant reaches inside its org. Staff get a container scope (org/program/group);
 *  a trainer/guardian gets an individual scope (one named athlete). */
export type ScopeKind = 'organization' | 'program' | 'group' | 'individual';

export type MembershipStatus =
  | 'invited' | 'active' | 'suspended' | 'left' | 'transferred' | 'graduated' | 'removed';

export interface Scope {
  kind: ScopeKind;
  /** program_id | group_id | target athlete profile id | null (= the whole organization). */
  id: string | null;
}

/** Capability keys beyond the role default. NOTE: there is deliberately NO key that edits
 *  the Development Score FORMULA — scoring integrity is structural, impossible-not-denied
 *  (DECISION-MEMO D3). `score_config` only toggles the platform-owned profile/components. */
export type PermissionKey =
  | 'view_profile' | 'view_meals' | 'view_reports'
  | 'set_targets' | 'edit_plan' | 'edit_goals'
  | 'message' | 'invite_user' | 'remove_user' | 'archive_athlete'
  | 'manage_billing' | 'score_config';

/** The closed, typed catalog — every permission a jsonb `permissions` bag may carry. A bag
 *  key outside this set is invalid (validate writes against it; jsonb is the value, this is
 *  the key space). */
export const PERMISSION_KEYS: readonly PermissionKey[] = [
  'view_profile', 'view_meals', 'view_reports',
  'set_targets', 'edit_plan', 'edit_goals',
  'message', 'invite_user', 'remove_user', 'archive_athlete',
  'manage_billing', 'score_config',
];

export interface Membership {
  id: string;
  organizationId: string;
  /** The person this grant belongs to (a profile id). */
  memberId: string;
  role: MembershipRole;
  scope: Scope;
  /** Per-grant capability overrides on top of the role default. */
  permissions: Partial<Record<PermissionKey, boolean>>;
  status: MembershipStatus;
}

/** Roles that can ever READ another athlete's data (the "viewer" side of a grant). */
const VIEWER_ROLES = new Set<MembershipRole>([
  'admin', 'head_coach', 'assistant_coach', 'trainer', 'nutritionist', 'guardian',
]);

/** Default capability set per role. The per-membership `permissions` bag overrides these.
 *  Athlete/client carry none here — they own their OWN data (handled by self-ownership,
 *  not a viewer grant). No role can edit the scoring formula. */
const ROLE_DEFAULTS: Record<MembershipRole, Partial<Record<PermissionKey, boolean>>> = {
  athlete: {},
  client: {},
  guardian: { view_profile: true, view_reports: true, message: true },
  nutritionist: { view_profile: true, view_meals: true, view_reports: true, set_targets: true, edit_plan: true, edit_goals: true, message: true },
  trainer: { view_profile: true, view_meals: true, view_reports: true, set_targets: true, edit_plan: true, edit_goals: true, message: true },
  assistant_coach: { view_profile: true, view_reports: true, message: true },
  head_coach: { view_profile: true, view_meals: true, view_reports: true, set_targets: true, edit_plan: true, edit_goals: true, message: true, invite_user: true, archive_athlete: true },
  admin: { view_profile: true, view_meals: true, view_reports: true, set_targets: true, edit_plan: true, edit_goals: true, message: true, invite_user: true, remove_user: true, archive_athlete: true, manage_billing: true, score_config: true },
};

export const isActiveMembership = (m: Membership): boolean => m.status === 'active';

/**
 * Hierarchy containment: does the OUTER scope contain the INNER scope?
 * organization ⊇ program ⊇ group; individual contains only an exact individual match.
 * Pure mirror of the SQL `scope_contains` helper (migration 0011). `childOfProgram`/
 * `childOfGroup` would refine program⊇group with real tree data; for the flat wedge
 * (one org = one program = one group) an organization scope contains everything in its org.
 */
export function scopeContains(outer: Scope, inner: Scope): boolean {
  switch (outer.kind) {
    case 'organization':
      // Whole-org grant reaches every program/group/individual in the org. (Org-level
      // containment is already scoped to the same organization_id by the caller.)
      return true;
    case 'program':
      // Reaches its own program and groups under it. Group containment needs the tree;
      // at wedge scale (one program) treat same-id program/group as contained.
      return (inner.kind === 'program' || inner.kind === 'group') && (outer.id === inner.id || inner.id === outer.id);
    case 'group':
      return inner.kind === 'group' && outer.id === inner.id;
    case 'individual':
      return inner.kind === 'individual' && outer.id === inner.id;
    default:
      return false;
  }
}

/**
 * Can `viewerId` see `athleteId`'s data, given the full set of memberships? Pure mirror of
 * the SQL `can_view` body (migration 0011). Self always sees self. Otherwise the viewer
 * needs an ACTIVE viewer-role grant that reaches the athlete, either:
 *   - individual scope directly on the athlete (trainer/guardian), or
 *   - a container scope (org/program/group) that contains an ACTIVE athlete-membership of
 *     the athlete in the SAME organization (coach over a roster).
 * Consent is layered ABOVE this (consent.ts) — a true here is necessary, not sufficient.
 */
export function canView(viewerId: string, athleteId: string, all: Membership[]): boolean {
  if (viewerId === athleteId) return true;
  const athleteGrants = all.filter(
    (m) => m.memberId === athleteId && m.role === 'athlete' && isActiveMembership(m),
  );
  return all.some((v) => {
    if (v.memberId !== viewerId || !isActiveMembership(v) || !VIEWER_ROLES.has(v.role)) return false;
    if (v.scope.kind === 'individual') return v.scope.id === athleteId;
    // container scope: reaches the athlete if they have an active athlete-membership in the
    // same org whose scope this grant contains.
    return athleteGrants.some(
      (a) => a.organizationId === v.organizationId && scopeContains(v.scope, a.scope),
    );
  });
}

/** Effective capability of a single grant for one key (role default ⊕ explicit override). */
export function membershipAllows(m: Membership, key: PermissionKey): boolean {
  const override = m.permissions[key];
  if (override !== undefined) return override;
  return ROLE_DEFAULTS[m.role][key] === true;
}

/** The viewer's grants (of their own) that actually reach the athlete. */
export function reachingMemberships(viewerId: string, athleteId: string, all: Membership[]): Membership[] {
  if (!canView(viewerId, athleteId, all)) return [];
  const athleteGrants = all.filter((m) => m.memberId === athleteId && m.role === 'athlete' && isActiveMembership(m));
  return all.filter((v) => {
    if (v.memberId !== viewerId || !isActiveMembership(v) || !VIEWER_ROLES.has(v.role)) return false;
    if (v.scope.kind === 'individual') return v.scope.id === athleteId;
    return athleteGrants.some((a) => a.organizationId === v.organizationId && scopeContains(v.scope, a.scope));
  });
}

/**
 * Can `viewerId` perform `action` on `athleteId`? The athlete always may act on their OWN
 * data (self-ownership). Otherwise: any ACTIVE grant that reaches the athlete and allows the
 * action (most-permissive union across reaching grants). This is the single authorization
 * predicate UI + RPCs should call — never check role NAMES, always permission keys.
 * Consent (consent.ts) still gates whether the underlying data may be produced at all.
 */
export function can(viewerId: string, athleteId: string, action: PermissionKey, all: Membership[]): boolean {
  if (viewerId === athleteId) return true; // owns their data
  return reachingMemberships(viewerId, athleteId, all).some((m) => membershipAllows(m, action));
}
