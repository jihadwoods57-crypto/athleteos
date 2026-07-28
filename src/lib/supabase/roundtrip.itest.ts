// OnStandard — backend round-trip INTEGRATION test (Stage A-D, runtime verification).
//
// This is NOT part of the unit gate (`npm test` matches *.test.ts only). It runs
// against a THROWAWAY LOCAL supabase stack — never the live project — to prove the
// migrations + RLS + RPCs actually work end-to-end:
//   coach signUp -> create_team -> athlete signUp -> join_team -> athlete pushDay
//   -> coach fetchLinkedDays sees the day -> a stranger sees NOTHING (RLS isolation).
//
// Run it (with the local stack up, EXPO_PUBLIC_BACKEND_LIVE unaffected) via:
//   AOS_SUPABASE_URL=http://127.0.0.1:54321 AOS_SUPABASE_ANON_KEY=... \
//   npx jest --config jest.itest.config.js
//
// It uses the app's own pure projection (mapStateToDayRow) against the real schema,
// so a schema/projection drift fails here. Separate clients per user exercise RLS as
// three distinct authenticated principals.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createInitialState } from '@/core/defaultState';
import { mapStateToDayRow } from '@/store/sync';
import type { Database } from './database.types';

const URL = process.env.AOS_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.AOS_SUPABASE_ANON_KEY ?? '';

function freshClient(): SupabaseClient<Database> {
  // No session persistence: each client is its own principal for the RLS check.
  return createClient<Database>(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signUpUser(email: string, fullName: string): Promise<SupabaseClient<Database>> {
  const c = freshClient();
  const { error } = await c.auth.signUp({ email, password: 'Passw0rd!23', options: { data: { full_name: fullName } } });
  if (error) throw new Error(`signUp ${email}: ${error.message}`);
  return c;
}

const stamp = `${Date.now()}`;
const TODAY = '2026-06-25';

describe('backend round-trip against the local stack', () => {
  if (!ANON) {
    it.skip('skipped: set AOS_SUPABASE_ANON_KEY to run the integration round-trip', () => {});
    return;
  }

  let coach: SupabaseClient<Database>;
  let athlete: SupabaseClient<Database>;
  let stranger: SupabaseClient<Database>;
  let athleteId: string;
  let teamCode: string;

  it('coach signs up and creates a team with a real join code', async () => {
    coach = await signUpUser(`coach.${stamp}@local.test`, 'Coach Test');
    const { data, error } = await coach.rpc('create_team', { team_name: 'Test Eagles', team_sport: 'Football' });
    expect(error).toBeNull();
    expect(typeof data).toBe('string');
    teamCode = data as string;
    expect(teamCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('athlete signs up and joins the team by code', async () => {
    athlete = await signUpUser(`athlete.${stamp}@local.test`, 'Athlete Test');
    const { data: aid } = await athlete.auth.getUser();
    athleteId = aid.user!.id;
    const { data, error } = await athlete.rpc('join_team', { code: teamCode, athlete_position: 'WR' });
    expect(error).toBeNull();
    expect(typeof data).toBe('string');
  });

  it('athlete pushes their day (app projection -> real schema)', async () => {
    const row = mapStateToDayRow({ ...createInitialState(), role: 'athlete' }, athleteId, TODAY);
    const { error } = await athlete.from('days').upsert(row, { onConflict: 'athlete_id,date' });
    expect(error).toBeNull();
  });

  // 0103 column-grant split: days.current_weight left the authenticated SELECT grant, so
  // select('*') now 42501s for everyone (that's the point). These RLS ROW-visibility checks
  // read the granted columns the shipped client actually reads (day.js DAY_SELECT_COLS) — the
  // weight-visibility ROLE checks live in supabase/tests/rls_authz_test.sql §0103.
  const DAY_COLS = 'athlete_id,date,score,meals';
  it('coach sees the athlete day via the roster read (can_view RLS)', async () => {
    const { data, error } = await coach.from('days').select(DAY_COLS).eq('date', TODAY);
    expect(error).toBeNull();
    const mine = (data ?? []).filter((d) => d.athlete_id === athleteId);
    expect(mine).toHaveLength(1);
    expect(typeof mine[0].score).toBe('number');
  });

  it('a stranger sees NOTHING (RLS cross-team isolation)', async () => {
    stranger = await signUpUser(`stranger.${stamp}@local.test`, 'Stranger Test');
    const { data, error } = await stranger.from('days').select(DAY_COLS).eq('date', TODAY);
    expect(error).toBeNull();
    expect((data ?? []).filter((d) => d.athlete_id === athleteId)).toHaveLength(0);
  });

  it('the athlete can still read their own day (is_self RLS)', async () => {
    const { data, error } = await athlete.from('days').select(DAY_COLS).eq('athlete_id', athleteId).eq('date', TODAY);
    expect(error).toBeNull();
    expect((data ?? [])).toHaveLength(1);
  });

  it('0103: current_weight is column-denied on a direct select (the RPC is the only door)', async () => {
    // Any authenticated principal — even the head coach who CAN view weight — is blocked from a
    // direct column read; weight comes exclusively through weight_series(). "Wrong returns LESS."
    const { error } = await coach.from('days').select('current_weight').eq('date', TODAY);
    expect(error).not.toBeNull();
    expect(error?.code === '42501' || /permission denied/i.test(error?.message ?? '')).toBe(true);
  });
});
