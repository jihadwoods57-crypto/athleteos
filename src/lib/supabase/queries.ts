// AthleteOS — typed data access (inert until configured).
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
  ProfileRow,
  SubscriptionRow,
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

// ---------------------------------------------------------------- secure RPCs
/** Coach creates a team and is added as its head_coach staff (atomic, via the
 *  SECURITY DEFINER create_team RPC). Returns the real, server-generated join code
 *  that replaces the static EAGLES24 — share it so athletes can joinTeam(code). */
export async function createTeam(name: string, sport?: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('create_team', {
    team_name: name,
    team_sport: sport ?? null,
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
