// AthleteOS — typed data access (inert until configured).
// All functions return null / [] when Supabase is unconfigured so callers can fall
// back to local mock data with a single `?? mock` rather than branching everywhere.
// RLS does the authorization; these never widen access beyond the signed-in user.
import { isSupabaseConfigured, requireSupabase } from './client';
import type {
  AthleteProfileRow,
  CheckinRow,
  DayRow,
  MealRow,
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

export async function submitCheckin(row: Omit<CheckinRow, 'id' | 'submitted_at'>): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await requireSupabase()
    .from('checkins')
    .upsert(row, { onConflict: 'athlete_id,week' });
  if (error) throw error;
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
export async function joinTeam(code: string, position?: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().rpc('join_team', {
    code,
    athlete_position: position ?? null,
  });
  if (error) throw error;
  return data;
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
