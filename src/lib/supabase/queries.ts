// OnStandard — typed data access (inert until configured).
// All functions return null / [] when Supabase is unconfigured so callers can fall
// back to local mock data with a single `?? mock` rather than branching everywhere.
// RLS does the authorization; these never widen access beyond the signed-in user.
import { isSupabaseConfigured, requireSupabase } from './client';
import type {
  AthleteProfileRow,
  CheckinRow,
  DayRow,
  GuardianConsentRequestRow,
  MealRow,
  NotificationRow,
  OrgRow,
  OrgType,
  ProfileRow,
  SubscriptionRow,
  TeamRow,
} from './database.types';

// ---------------------------------------------------------------- athlete: own day
export async function fetchDay(athleteId: string, date: string): Promise<DayRow | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase()
    .from('days')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Upsert the athlete's day slice (athlete is the only writer per RLS). */
export async function upsertDay(row: Partial<DayRow> & Pick<DayRow, 'athlete_id' | 'date'>): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase()
    .from('days')
    .upsert(row, { onConflict: 'athlete_id,date' });
  if (error) throw error;
}

export async function fetchMeals(athleteId: string, date: string): Promise<MealRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase()
    .from('meals')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('day_date', date)
    .order('logged_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function insertMeal(row: Omit<MealRow, 'id' | 'logged_at'>): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase().from('meals').insert(row);
  if (error) throw error;
}

/** Meal history: every stored meal on or after `sinceDate`, newest day first
 *  (then by logged_at within a day). RLS scopes it to the athlete + linked
 *  overseers, so the same call powers the client's own history and a coach's
 *  view of a linked athlete. Empty when unconfigured. */
export async function fetchRecentMeals(athleteId: string, sinceDate: string): Promise<MealRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase()
    .from('meals')
    .select('*')
    .eq('athlete_id', athleteId)
    .gte('day_date', sinceDate)
    .order('day_date', { ascending: false })
    .order('logged_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Resolve a meal-photo storage path to a short-lived signed URL (the bucket is
 *  private). Null when unconfigured or on any error — the UI falls back to the
 *  color thumbnail, so a missing photo never breaks the list. */
export async function signedMealPhotoUrl(path: string, ttlSeconds = 3600): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().storage.from('meal-photos').createSignedUrl(path, ttlSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function submitCheckin(row: Omit<CheckinRow, 'id' | 'submitted_at'>): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase()
    .from('checkins')
    .upsert(row, { onConflict: 'athlete_id,week' });
  if (error) throw error;
}

/** Revoke a viewer KIND's server access (security G1): the athlete removing a coach/trainer/parent
 *  from their circle should actually drop that side's `can_view`, not just hide a local label.
 *  Calls the revoke_viewer RPC (authored at go-live); inert when unconfigured. See
 *  docs/specs/2026-06-29-g1-revoke-viewer.md. */
export async function revokeViewer(viewerKind: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase().rpc('revoke_viewer', { viewer_kind: viewerKind });
  if (error) throw error;
}

/** Read the signed-in athlete's own guardian-consent requests (status only). The 0008 RLS
 *  policy gcr_read scopes this to their own rows; `status` is server-owned (only the
 *  verification endpoint writes 'verified'). Empty when unconfigured — callers reduce these
 *  to a single GuardianStatus via core's guardianStatusFromRequests. */
export async function fetchGuardianRequests(athleteId: string): Promise<Pick<GuardianConsentRequestRow, 'status'>[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase()
    .from('guardian_consent_requests')
    .select('status')
    .eq('athlete_id', athleteId);
  if (error) throw error;
  return data ?? [];
}

/** Read the signed-in user's own profile row (display name + org name + email), so a
 *  fresh device shows their real identity instead of the seeded demo. RLS scopes it to
 *  their own id; null when unconfigured / no row. */
export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Update the signed-in user's own profile row (RLS restricts it to their own id).
 *  Carries the overseer-editable display name + org/team/practice name (org_name
 *  added in migration 0009). */
export async function updateProfile(
  userId: string,
  fields: { full_name?: string | null; org_name?: string | null },
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase().from('profiles').update(fields).eq('id', userId);
  if (error) throw error;
}

/** Read the signed-in user's own subscription row (RLS scopes it to owner_id =
 *  auth.uid()). Null when unconfigured or no row yet — the caller falls back to the
 *  free-preview entitlement. The row is written by the Stripe webhook at go-live;
 *  this read is the only client touch-point. */
export async function fetchEntitlement(userId: string): Promise<SubscriptionRow | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase()
    .from('subscriptions')
    .select('*')
    .eq('owner_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchAthleteProfile(athleteId: string): Promise<AthleteProfileRow | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase()
    .from('athlete_profiles')
    .select('*')
    .eq('athlete_id', athleteId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- overseer: rosters
// RLS (`can_view`) filters these to athletes the caller is linked to, so a plain
// select returns exactly the roster the coach/trainer/parent is allowed to see.
export async function fetchLinkedDays(date: string): Promise<DayRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase()
    .from('days')
    .select('*')
    .eq('date', date);
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------- schools directory
/** A directory match: safe display columns only (the `search_orgs`/`find_org` RPCs never return
 *  created_by, so the org creator's identity stays private). Shaped as OrgRow for callers; the
 *  private fields are filled inert (never shown in the picker). */
function toOrgRow(o: { id: string; name: string; type: OrgType; city: string | null; state: string | null }): OrgRow {
  return { id: o.id, name: o.name, type: o.type, city: o.city, state: o.state, created_by: null, created_at: '' };
}

/** Type-ahead over the schools/clubs directory. Reads through the `search_orgs` SECURITY DEFINER
 *  RPC (migration 0031) rather than a direct `orgs` select, so the directory works while the
 *  `orgs_read` policy stays locked to connected orgs (0013) — no org-enumeration leak. Empty when
 *  unconfigured or for a query shorter than 2 chars (the RPC enforces the same floor). */
export async function searchOrgs(query: string, limit = 20): Promise<OrgRow[]> {
  if (!isSupabaseConfigured) return [];
  const term = query.trim();
  if (term.length < 2) return [];
  const { data, error } = await requireSupabase().rpc('search_orgs', { q: term, lim: limit });
  if (error) throw error;
  return (data ?? []).map(toOrgRow);
}

/** "Add your school/club": create an org if one with the same (name, state) doesn't
 *  already exist (case-insensitive), else return the existing row — so two people
 *  adding the same school converge on one entity rather than duplicating it. Insert is
 *  allowed by `orgs_write` (created_by = auth.uid()). Null when unconfigured. */
export async function createOrg(
  name: string,
  city: string | null,
  state: string | null,
  type: OrgType = 'school',
  createdBy?: string,
): Promise<OrgRow | null> {
  if (!isSupabaseConfigured) return null;
  const sb = requireSupabase();
  const trimmed = name.trim();
  // Dedup pre-check via the `find_org` SECURITY DEFINER RPC (migration 0031), so the "add your
  // school" path can see an existing school it isn't linked to yet and converge on it — impossible
  // through a direct `orgs` select under the locked orgs_read policy (0013), which would spawn dups.
  const { data: existing, error: dedupErr } = await sb.rpc('find_org', { p_name: trimmed, p_state: state ?? null });
  if (dedupErr) throw dedupErr;
  if (existing && existing.length > 0) return toOrgRow(existing[0]);

  const { data, error } = await sb
    .from('orgs')
    .insert({ name: trimmed, city: city || null, state: state || null, type, created_by: createdBy ?? null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- secure RPCs
/** Coach creates a team and is added as its head_coach staff (atomic, via the
 *  SECURITY DEFINER create_team RPC). Returns the real, server-generated join code
 *  that replaces the static EAGLES24 — share it so athletes can joinTeam(code).
 *  `orgId` attaches the team to a school; `discoverable` opts it into athlete search. */
export async function createTeam(
  name: string,
  sport?: string,
  orgId?: string | null,
  discoverable = false,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('create_team', {
    team_name: name,
    team_sport: sport ?? null,
    team_org: orgId ?? null,
    team_discoverable: discoverable,
  });
  if (error) throw error;
  return data;
}

export async function joinTeam(code: string, position?: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('join_team', {
    code,
    athlete_position: position ?? null,
  });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- athlete-first linking
/** Safe (display-only) shapes returned by the discovery/resolve RPCs — never the join code. */
export type DiscoveredTeam = { id: string; name: string; sport: string | null; coach_name: string | null };
export type ResolvedTeam = DiscoveredTeam & { school: string | null };
export type PendingRequest = { athlete_id: string; athlete_name: string | null; position: string | null; requested_at: string };

/** Discoverable teams at a school (athlete-first "find my coach"). Empty when unconfigured. */
export async function discoverTeams(orgId: string): Promise<DiscoveredTeam[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase().rpc('discover_teams', { org: orgId });
  if (error) throw error;
  return data ?? [];
}

/** Resolve a join code to a confirm-screen preview (coach + school) without joining. */
export async function resolveTeamCode(code: string): Promise<ResolvedTeam | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('resolve_team_code', { code });
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

/** Athlete requests to join a discoverable team → a 'pending' row (coach approves later). */
export async function requestJoinTeam(teamId: string, position?: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('request_join_team', {
    team: teamId,
    athlete_position: position ?? null,
  });
  if (error) throw error;
  return data;
}

/** Pending join requests for a team (staff-only, via SECURITY DEFINER RPC so the coach can
 *  see the requester's name even though the link isn't active yet). Empty when unconfigured. */
export async function pendingTeamRequests(teamId: string): Promise<PendingRequest[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase().rpc('pending_team_requests', { team: teamId });
  if (error) throw error;
  return data ?? [];
}

/** Coach approves a pending request → flips the member row to 'active' (tm_manage policy). */
export async function approveMember(teamId: string, athleteId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase()
    .from('team_members')
    .update({ status: 'active' })
    .eq('team_id', teamId)
    .eq('athlete_id', athleteId);
  if (error) throw error;
}

/** Coach declines a pending request → deletes the member row (tm_manage policy). */
export async function declineMember(teamId: string, athleteId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase()
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('athlete_id', athleteId);
  if (error) throw error;
}

/** Teams the signed-in user is staff on (teams_read RLS returns the coach's own teams).
 *  Used to gather the coach's pending-request inbox across their team(s). */
export async function fetchMyTeams(): Promise<Pick<TeamRow, 'id' | 'name'>[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase().from('teams').select('id, name');
  if (error) throw error;
  return data ?? [];
}

/** Apple 5.1.1(v): permanently delete the signed-in user's account + all their data
 *  server-side. Calls a SECURITY DEFINER `delete_account` RPC (authored at go-live)
 *  that cascades the auth user + rows + storage. Inert when no backend is configured;
 *  the store still wipes local data so the in-app deletion always works. */
export async function deleteAccount(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase().rpc('delete_account');
  if (error) throw error;
}

/** Minor guardian consent: email a minor's guardian an approval request. Calls a
 *  `request_guardian_consent` RPC (authored at go-live) that records a pending
 *  guardianship and sends the verification link. Inert without a backend. */
export async function requestGuardianConsent(guardianEmail: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase().rpc('request_guardian_consent', { guardian_email: guardianEmail });
  if (error) throw error;
}

export async function joinPractice(code: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('join_practice', { code });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- client ↔ trainer mirror
/** Safe (display-only) shapes returned by the practice discovery/resolve RPCs. */
export type FoundPractice = { id: string; name: string; trainer_name: string | null };
export type PendingClient = { client_id: string; client_name: string | null; requested_at: string | null };

/** Trainer creates their practice → real, server-generated join code + optional @handle. */
export async function createPractice(name: string, handle?: string | null, discoverable = false): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('create_practice', {
    practice_name: name,
    practice_handle: handle ?? null,
    is_discoverable: discoverable,
  });
  if (error) throw error;
  return data;
}

/** Client-first discovery: find a discoverable practice by the trainer's @handle. */
export async function findPracticeByHandle(handle: string): Promise<FoundPractice | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('find_practice_by_handle', { h: handle });
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

/** Resolve a practice join code to a confirm-screen preview (trainer name) without joining. */
export async function resolvePracticeCode(code: string): Promise<FoundPractice | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('resolve_practice_code', { code });
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

/** Client requests to join a discoverable practice → a 'pending' row (trainer approves). */
export async function requestJoinPractice(practiceId: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('request_join_practice', { practice: practiceId });
  if (error) throw error;
  return data;
}

/** Pending client requests for a practice (owner-gated RPC returning requester names). */
export async function pendingPracticeRequests(practiceId: string): Promise<PendingClient[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase().rpc('pending_practice_requests', { practice: practiceId });
  if (error) throw error;
  return data ?? [];
}

/** Trainer approves a pending client → flips the row to 'active' (pc_manage policy). */
export async function approveClient(practiceId: string, clientId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase()
    .from('practice_clients')
    .update({ status: 'active' })
    .eq('practice_id', practiceId)
    .eq('client_id', clientId);
  if (error) throw error;
}

/** Trainer declines a pending client → deletes the row (pc_manage policy). */
export async function declineClient(practiceId: string, clientId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase()
    .from('practice_clients')
    .delete()
    .eq('practice_id', practiceId)
    .eq('client_id', clientId);
  if (error) throw error;
}

// ---------------------------------------------------------------- push (device tokens)
/** Register the caller's Expo push token (upsert). Inert when unconfigured. */
export async function registerDeviceToken(token: string, platform?: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase().rpc('register_device_token', { tok: token, plat: platform ?? null });
  if (error) throw error;
}

/** Coach/trainer nudge → the send-push edge function records an in-app notification and
 *  pushes to the athlete's devices (authorized server-side via can_view). Inert offline. */
export async function nudgePush(athleteId: string, title: string, message: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase().functions.invoke('send-push', {
    body: { athlete_id: athleteId, title, body: message },
  });
  if (error) throw error;
}

// ---------------------------------------------------------------- in-app notifications
/** The signed-in user's notifications, newest first (RLS scopes to their own rows). */
export async function fetchNotifications(limit = 50): Promise<NotificationRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase()
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
export async function markNotificationRead(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  if (error) throw error;
}
export async function markAllNotificationsRead(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw error;
}

// ---------------------------------------------------------------- custom / regenerate join code
/** Set a vanity join code on the caller's team; throws with a friendly message if taken
 *  or malformed. Returns the saved (uppercased) code. */
export async function setMyTeamCode(newCode: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('set_my_team_code', { new_code: newCode });
  if (error) throw error;
  return data;
}
export async function regenerateMyTeamCode(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('regenerate_my_team_code', {});
  if (error) throw error;
  return data;
}
export async function setMyPracticeCode(newCode: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('set_my_practice_code', { new_code: newCode });
  if (error) throw error;
  return data;
}
export async function regenerateMyPracticeCode(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('regenerate_my_practice_code', {});
  if (error) throw error;
  return data;
}

/** Practices the signed-in user owns (practices_read RLS returns the owner's own; a
 *  trainer typically has one). Powers the trainer's pending-request inbox. */
export async function fetchMyPractices(): Promise<{ id: string; name: string }[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase().from('practices').select('id, name');
  if (error) throw error;
  return data ?? [];
}

export async function coachSetGoals(
  athleteId: string,
  targets: AthleteProfileRow['targets'] | null,
  seasonGoal: AthleteProfileRow['season_goal'] | null,
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase().rpc('coach_set_goals', {
    athlete: athleteId,
    new_targets: targets,
    new_season_goal: seasonGoal,
  });
  if (error) throw error;
}
