/* Proto role data layer — mirrors the RN `db.*` seam (src/lib/supabase/queries.ts).
   supabase-js runs inside the WebView; RLS is the real authz, so these are plain selects/RPCs
   with NO explicit coach-id filter — the server's can_view() scopes rows to linked athletes.

   Every call is best-effort: on a missing client, a not-applied table/RPC, or any error it
   returns []/null so role screens render an HONEST empty state, never a fabricated one.
   No new endpoints — the exact tables/RPCs the RN app already uses. */
import { scoreBand, BAND_FLAG } from './score-band.js';
import { chunkIds } from './id-chunk.js';

function sb() { return window.sb; }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function todayISO() { return iso(new Date()); }
export function daysAgoISO(n) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ---------------- coach: teams + roster ---------------- */
export async function fetchMyTeams() {
  const c = sb(); if (!c) return [];
  // supabase-js resolves network failures into { error } without throwing — surface it as the
  // { error: true } sentinel (same pattern as fetchMyPracticeIdentity) so an outage is never
  // read as "no teams".
  try { const { data, error } = await c.from('teams').select('id,name'); if (error) return { error: true }; return data || []; } catch { return { error: true }; }
}
export async function fetchTeamRoster(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  // null = FAILED, [] = confirmed empty. A dropped request must not paint "No athletes yet"
  // over a real roster (loadCoachRoster turns null into the offline branch).
  try { const { data, error } = await c.rpc('team_roster', { team: teamId }); if (error) return null; return data || []; } catch { return null; }
}
/** Days since `sinceISO` for the caller's linked roster. Pass `athleteIds` (the roster is
 *  already known by every real caller, resolved a few lines before this runs) so the query can
 *  use the existing days(athlete_id, date desc) index — without it, `date >= sinceISO` alone is
 *  unusable against that index and Postgres falls back to a full table scan of `days` PLUS a
 *  per-row can_view() RLS check on every row in the table, not just the caller's roster
 *  (capacity audit F4, docs/scale/CAPACITY-AUDIT.md). Omitting athleteIds keeps the old
 *  RLS-only, unscoped, .limit(2000) behavior for any caller that doesn't have a roster yet. */
export async function fetchLinkedDaysSince(sinceISO, athleteIds) {
  const c = sb(); if (!c) return [];
  const cols = 'athlete_id,date,score,grade,tasks';
  try {
    if (!Array.isArray(athleteIds) || !athleteIds.length) {
      const { data, error } = await c.from('days').select(cols).gte('date', sinceISO).limit(2000);
      if (error) return null;
      return data || [];
    }
    // Chunked (scale pass 2026-08-18): a full roster's ids inlined into ONE .in() GET can 414
    // past ~200 athletes (see id-chunk.js). Each chunk keeps its own limit scaled to ITS size —
    // the roster x window cap (2026-08-17) — so the combined result matches the unchunked cap.
    const results = await Promise.all(chunkIds(athleteIds).map((chunk) =>
      c.from('days').select(cols).gte('date', sinceISO).in('athlete_id', chunk).limit(chunk.length * 9)));
    // null = FAILED. [] here fabricates "No logs today" onto every named athlete on the roster
    // (buildRosterRow flags each one red) — the single largest false-claim surface in the app.
    if (results.some((r) => r.error)) return null;
    return results.flatMap((r) => r.data || []);
  } catch { return null; }
}
/** Athlete IANA timezones for the coach roster (0088), keyed by id. Best-effort and RLS-safe: a
 *  coach reads these through the SAME profiles access they already have (connected → can_view, the
 *  predicate that already gates their days/meals reads). A pre-0088 database has no `timezone`
 *  column, so PostgREST returns an error we swallow to {} — every row then falls back to the coach
 *  clock, exactly as today. Nothing here can make the roster read (a separate RPC) fail. */
export async function fetchProfileTimezones(ids) {
  const c = sb(); if (!c || !Array.isArray(ids) || !ids.length) return {};
  try {
    // Chunked (scale pass 2026-08-18). This function is best-effort by its own contract (a
    // failed chunk falls back to the coach clock, same as a whole-function failure always
    // did) — so one bad chunk is skipped rather than voiding the roster's other chunks.
    const results = await Promise.all(chunkIds(ids).map((chunk) => c.from('profiles').select('id,timezone').in('id', chunk)));
    const out = {};
    for (const r of results) {
      if (r.error) continue;
      for (const row of (r.data || [])) if (row && row.id && row.timezone) out[row.id] = row.timezone;
    }
    return out;
  } catch { return {}; }
}
export async function pendingTeamRequests(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  // null = FAILED, so a dropped request can't read as "no join requests waiting".
  try { const { data, error } = await c.rpc('pending_team_requests', { team: teamId }); if (error) return null; return data || []; } catch { return null; }
}
export async function approveMember(teamId, athleteId) {
  const c = sb(); if (!c) return false;
  try { const { error } = await c.from('team_members').update({ status: 'active' }).eq('team_id', teamId).eq('athlete_id', athleteId); return !error; } catch { return false; }
}
export async function declineMember(teamId, athleteId) {
  const c = sb(); if (!c) return false;
  try { const { error } = await c.from('team_members').delete().eq('team_id', teamId).eq('athlete_id', athleteId); return !error; } catch { return false; }
}

/* ---------------- guardian consent (athlete side of 0008/0050) ---------------- */
/** The athlete's own consent state: newest guardian_consent_requests row (status is column-
    granted to the athlete post-0035; the token never is). Returns
    { status:'verified'|'pending'|'revoked'|'none', guardianEmail } — or { error:true } on a
    fetch failure so callers can keep last-known instead of misreporting. */
export async function fetchMyConsent(athleteId) {
  const c = sb(); if (!c || !athleteId) return null;
  try {
    const { data, error } = await c.from('guardian_consent_requests')
      .select('status,guardian_email,requested_at').eq('athlete_id', athleteId)
      .order('requested_at', { ascending: false }).limit(1).maybeSingle();
    if (error) return { error: true };
    if (!data) return { status: 'none', guardianEmail: null };
    return { status: data.status || 'pending', guardianEmail: data.guardian_email || null };
  } catch { return { error: true }; }
}

/** Ask a parent/guardian for consent. Goes through the guardian-request edge function because
    that is the half that actually EMAILS the guardian (Resend); the raw 0008 RPC only writes the
    pending row and token, so calling it alone records a request no parent ever hears about — the
    exact silent dead-end that kept every minor's sync gate closed. The RPC remains the fallback
    when the function is unreachable, and `emailed` tells the caller whether a real email left,
    so the UI can stop claiming "sent" when it wasn't. Returns { ok, emailed?, error? }. */
export async function requestGuardianConsent(email) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  const fn = await callFn('guardian-request', { guardian_email: email });
  if (fn && fn.ok) return { ok: true, emailed: fn.emailed === true };
  // Function unreachable or errored: record the request the old way so nothing is lost, but be
  // honest that no email went out.
  try {
    const { error } = await c.rpc('request_guardian_consent', { guardian_email: email });
    return error ? { ok: false, error: error.message } : { ok: true, emailed: false };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not send the request.' }; }
}

/** The signed-in coach's own team identity: real team name + real join code — mirrors
    fetchMyPracticeIdentity for trainers. teams_read RLS scopes the select to teams the caller
    staffs/created, so no explicit filter is needed. Returns null on a CONFIRMED "no team row
    yet" (still minting); { error: true } on a fetch failure (network/RLS) so callers never
    misreport a real outage as still-minting. */
export async function fetchMyTeamIdentity() {
  const c = sb(); if (!c) return null;
  try {
    // supabase-js resolves a network/RLS failure into { error } WITHOUT throwing, so the catch
    // below never sees it. Inspecting `error` here is what makes the { error: true } sentinel
    // this function documents actually reachable — otherwise a flaky connection returned null,
    // which callers read as "no team yet" and showed "Setting up" forever.
    const { data, error } = await c.from('teams').select('id,name,join_code,discipline').limit(1).maybeSingle();
    if (error) return { error: true };
    if (!data) return null;
    // discipline (0202): 'training' | 'nutrition' — the team-book mirror of the practice lens
    // key (0197). Same normalization: anything unexpected reads as 'training'.
    return { id: data.id, name: data.name || '', code: data.join_code || '', discipline: data.discipline === 'nutrition' ? 'nutrition' : 'training' };
  } catch { return { error: true }; }
}

/** The ATHLETE's real linked coach: their active team (teams_read grants members the row) +
    the head coach's display name (team_head_coach_name — the safe definer helper from 0024).
    Returns null on a confirmed "no team link"; { error: true } on a fetch failure. Never a
    fabricated persona — an unknown coach name comes back as ''. */
export async function fetchMyCoach() {
  const c = sb(); if (!c) return null;
  try {
    const { data: team } = await c.from('teams').select('id,name').limit(1).maybeSingle();
    if (!team) return null;
    let coachName = '';
    try {
      const { data: n } = await c.rpc('team_head_coach_name', { team: team.id });
      coachName = (typeof n === 'string' && n) || '';
    } catch { /* name is optional — the team link alone is real */ }
    return { teamId: team.id, teamName: team.name || '', name: coachName };
  } catch { return { error: true }; }
}

/* ---------------- athlete: barcode → packaged food (food-lookup fn) ---------------- */
/** One exact packaged product for a scanned/typed barcode, via the food-lookup edge function
    (Open Food Facts, cached server-side; founder decision D5 approved the licensing). Returns
    { name, serving, per100: {protein,carbs,fat,kcal}, attribution } or null (not found /
    unreachable — the screen renders the difference from navigator state, never invents food).
    Deadline-raced: this sits between an athlete and logging a meal, exactly the spot where one
    hung request used to freeze surfaces. */
export async function fetchFoodByBarcode(barcode) {
  const c = sb(); if (!c) return null;
  const digits = String(barcode || '').replace(/\D/g, '').slice(0, 14);
  if (digits.length < 8) return null;
  try {
    const res = await Promise.race([
      c.functions.invoke('food-lookup', { body: { barcode: digits } }),
      new Promise((resolve) => setTimeout(() => resolve({ error: { message: 'timeout' } }), 10_000)),
    ]);
    if (!res || res.error || !res.data || res.data.found !== true) return null;
    const d = res.data;
    if (!d.per100 || typeof d.per100 !== 'object') return null;
    return { name: d.name || 'Scanned product', serving: d.serving || null, per100: d.per100, attribution: d.attribution || '' };
  } catch { return null; }
}

/* ---------------- athlete: squad board (0180) ---------------- */
/** The opt-in team board. Rows: { athlete_id, athlete_name, position, shared, day_date, score } —
    full rows for the caller + teammates who opted in; anonymous stubs (everything null,
    shared=false) for teammates who haven't, so the screen can count them without naming them.
    Returns null on failure so the screen renders its honest offline state, never an empty board
    that reads as "nobody shares". */
export async function fetchSquadBoard(teamId) {
  const c = sb(); if (!c || !teamId) return null;
  try {
    const { data, error } = await c.rpc('squad_board', { p_team: teamId });
    if (error) return null;
    return Array.isArray(data) ? data : [];
  } catch { return null; }
}
/** Flip the athlete's own share switch (profiles.share_squad_score — 0138's pattern). */
export async function setShareSquadScore(uid, on) {
  const c = sb(); if (!c || !uid) return false;
  try {
    const { error } = await c.from('profiles').update({ share_squad_score: !!on }).eq('id', uid);
    return !error;
  } catch { return false; }
}

/* ---------------- coach: custom team code (0026 RPCs) ---------------- */
/** Set a vanity join code (e.g. GATORS). Server validates ^[A-Z0-9]{6,12}$ (0038) + uniqueness and
    resolves the team from auth.uid() — nothing is trusted from the client. Returns
    { ok, code?, error? } with the server's message (e.g. "already taken") surfaced verbatim. */
export async function setMyTeamCode(code) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.rpc('set_my_team_code', { new_code: code });
    if (error) return { ok: false, error: error.message || 'Could not save that code.' };
    return { ok: true, code: (typeof data === 'string' && data) || String(code || '').trim().toUpperCase() };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save that code.' }; }
}
/** Roll a fresh random code (the old one stops working immediately). */
export async function regenerateMyTeamCode() {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.rpc('regenerate_my_team_code');
    if (error) return { ok: false, error: error.message || 'Could not make a new code.' };
    return { ok: true, code: (typeof data === 'string' && data) || '' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not make a new code.' }; }
}
/* The PRACTICE arms. set_my_practice_code / regenerate_my_practice_code have existed
   server-side since 0026 (validation tightened to 6-12 chars in 0038) — no client ever
   called them, which is why a trainer with a leaked code had no move until the 2026-08-11
   open-items pass. Same contract as the team pair: the server resolves the practice from
   auth.uid(), the server's own error message is surfaced verbatim. */
export async function setMyPracticeCode(code) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.rpc('set_my_practice_code', { new_code: code });
    if (error) return { ok: false, error: error.message || 'Could not save that code.' };
    return { ok: true, code: (typeof data === 'string' && data) || String(code || '').trim().toUpperCase() };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save that code.' }; }
}
export async function regenerateMyPracticeCode() {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.rpc('regenerate_my_practice_code');
    if (error) return { ok: false, error: error.message || 'Could not make a new code.' };
    return { ok: true, code: (typeof data === 'string' && data) || '' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not make a new code.' }; }
}
/** Rename the caller's practice. A direct owner-scoped update — practices_update RLS
    (owner_id = auth.uid()) has allowed this since 0002/0053; no client offered it until the
    2026-08-11 open-items pass ("write-once at onboarding" was an accident, not a rule). */
export async function renamePractice(practiceId, name) {
  const c = sb(); if (!c || !practiceId) return { ok: false, error: 'You need a connection for this.' };
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) return { ok: false, error: 'Give your practice a name first.' };
  try {
    const { error } = await c.from('practices').update({ name: clean }).eq('id', practiceId);
    if (error) return { ok: false, error: error.message || 'Could not rename the practice.' };
    return { ok: true, name: clean };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not rename the practice.' }; }
}

/* ---------------- coach: roster-wide activity feed (WS4) ---------------- */
/** Recent meals across every linked athlete (RLS can_view scopes rows). Best-effort [].
 *  Pass `athleteIds` when the roster is already known (same reasoning as
 *  fetchLinkedDaysSince above): without it, `day_date >= sinceISO` can't use the
 *  meals(athlete_id, day_date desc) index and the ORDER BY forces a full sort of every
 *  matching row in the table before the limit applies (capacity audit F6). */
export async function fetchTeamActivity(sinceISO, limit = 24, athleteIds) {
  const c = sb(); if (!c) return [];
  const cols = 'id,athlete_id,day_date,type,photo_path,name,protein,kcal,quality,logged_at';
  try {
    if (!Array.isArray(athleteIds) || !athleteIds.length) {
      const { data, error } = await c.from('meals').select(cols).gte('day_date', sinceISO)
        .order('logged_at', { ascending: false }).limit(limit);
      if (error) return null; // null = FAILED (coach-home already branches on it)
      return data || [];
    }
    // Chunked (scale pass 2026-08-18): each chunk asks for its own top-`limit` rows, so the
    // TRUE global top-`limit` (by logged_at) is provably a subset of the union — any row in
    // the real answer is certainly in its own chunk's top-`limit`. Re-sort + re-slice below.
    const results = await Promise.all(chunkIds(athleteIds).map((chunk) =>
      c.from('meals').select(cols).gte('day_date', sinceISO).in('athlete_id', chunk)
        .order('logged_at', { ascending: false }).limit(limit)));
    if (results.some((r) => r.error)) return null;
    const merged = results.flatMap((r) => r.data || []);
    merged.sort((a, b) => String(b.logged_at || '').localeCompare(String(a.logged_at || '')));
    return merged.slice(0, limit);
  } catch { return null; }
}

/* ---------------- coach: Inbox v2 (Slice D) — comment threads + intervention state ---------------- */
/** Recent meal_comments across the given athletes (RLS scopes rows). Feeds inbox.js's
    lastByMeal (who spoke last per meal thread). Best-effort []. */
export async function fetchTeamMealComments(athleteIds, sinceISO) {
  const c = sb(); if (!c || !athleteIds || !athleteIds.length) return [];
  try {
    // DESC per chunk, so each chunk's own 1000-row cap drops ITS oldest rows first — the same
    // reasoning as the single-query version (2026-08-17): lastByMeal picks by timestamp, so
    // merging is order-agnostic, and re-sorting + re-slicing the union to 1000 below preserves
    // the exact "newest 1000 across the roster" contract chunking would otherwise blur.
    const results = await Promise.all(chunkIds(athleteIds).map((chunk) =>
      c.from('meal_comments').select('meal_id,athlete_id,role,kind,created_at')
        .in('athlete_id', chunk).gte('created_at', sinceISO)
        .order('created_at', { ascending: false }).limit(1000)));
    // null = FAILED. This drives the inbox's needsResponse count, so [] on a dropped request
    // printed "All caught up" over an inbox that may be full.
    if (results.some((r) => r.error)) return null;
    const merged = results.flatMap((r) => r.data || []);
    merged.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return merged.slice(0, 1000);
  } catch { return null; }
}
/** Recent coach_interventions for the team (kind 'handled' + reason_key 'meal:<id>' marks a
    thread resolved — Task 5 writes it, inbox.js reads it). Best-effort []. */
/* `book` (0136): 'team' filters team_id, 'practice' filters practice_id. The writer
   (logIntervention) has taken a book arg since 0136 and ci_staff_read has always had the
   practice arm — but this reader filtered team_id unconditionally, so a practice book's
   "Resolved" inbox bucket and the meal screen's resolved seed were permanently empty even
   though the rows existed (found in the 2026-08-11 open-items pass). */
export async function fetchRecentInterventions(bookId, sinceISO, book = 'team') {
  const c = sb(); if (!c || !bookId) return [];
  try {
    const { data, error } = await c.from('coach_interventions')
      .select('athlete_id,kind,reason_key,created_at')
      .eq(book === 'practice' ? 'practice_id' : 'team_id', bookId).gte('created_at', sinceISO)
      .order('created_at', { ascending: false }).limit(500);
    if (error) return null; // null = FAILED
    return data || [];
  } catch { return null; }
}

/* Outstanding (unredeemed) staff invites for the Staff inbox category — used_by is null is
   the real "pending staff" state (staff_invites RLS: is_staff_of_team, 0061). No approval
   queue exists; an unused code IS the pending signal. */
export async function fetchOpenStaffInvites(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const { data, error } = await c.from('staff_invites')
      .select('id,role,created_at')
      .eq('team_id', teamId).is('used_by', null)
      .order('created_at', { ascending: false }).limit(50);
    if (error) return null; // null = FAILED
    return data || [];
  } catch { return null; }
}

/* Has this meal thread been resolved (a handled intervention with reason_key meal:<id>)?
   Lets the coach thread show "Resolved ✓" on load instead of forgetting across a reload.
   RLS (is_team_staff) scopes the read; the meal uuid makes reason_key globally unique. */
export async function fetchMealResolved(mealId) {
  const c = sb(); if (!c || !mealId) return false;
  try {
    const { data } = await c.from('coach_interventions')
      .select('id').eq('reason_key', 'meal:' + mealId).eq('kind', 'handled').limit(1);
    return !!(data && data.length);
  } catch { return false; }
}
/* Is this meal currently flagged for follow-up (0199)? The table is append-only, so state is
   "latest row wins" on reason_key 'flag:meal:<id>' — kind 'flag' set it, kind 'handled' with
   the SAME reason_key cleared it. */
export async function fetchMealFlagged(mealId) {
  const c = sb(); if (!c || !mealId) return false;
  try {
    const { data } = await c.from('coach_interventions')
      .select('kind').eq('reason_key', 'flag:meal:' + mealId)
      .order('created_at', { ascending: false }).limit(1);
    return !!(data && data.length && data[0].kind === 'flag');
  } catch { return false; }
}
/* Persist a professional correction (0199 pro_correct_meal). The FIELDS are computed on the
   operator's device by the same deterministic machinery the athlete uses (meal-intel.js) —
   this wrapper only carries them; the server authorizes (write staff / trainer of the athlete),
   clamps, and appends the '[Pro correction]' note marker. */
export async function proCorrectMeal(mealId, fields, summary) {
  const c = sb(); if (!c || !mealId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.rpc('pro_correct_meal', { p_meal: mealId, p_fields: fields, p_summary: summary });
    if (error) return { ok: false, error: error.message || 'Could not save the correction.' };
    return { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save the correction.' }; }
}

/* ---------------- coach → athlete review ---------------- */
/* Weight visibility (0103): days.current_weight left the direct SELECT grant, so staff reads
   enumerate the granted columns (never '*', which 42501s post-apply). Weight, when the caller's
   role is allowed, is stitched in separately via fetchAthleteWeights below. */
const DAY_COLS = 'id,athlete_id,date,meals,hydration_l,tasks,quick_added,checkin,score,grade,computed_at,updated_at';
export async function fetchDay(athleteId, date) {
  const c = sb(); if (!c || !athleteId) return null;
  try { const { data } = await c.from('days').select(DAY_COLS).eq('athlete_id', athleteId).eq('date', date).maybeSingle(); return data || null; } catch { return null; }
}
/** The athlete's weight-by-date map (0103 weight_series RPC). A restricted role gets an empty
 *  map — zero rows, never an error — so callers stitch best-effort and weight surfaces simply
 *  don't exist for roles outside [head_coach, athletic_trainer, s_and_c] (+ trainers, + self).
 *  Pre-0103 fallback: the direct column read still works until the migration applies. */
export async function fetchAthleteWeights(athleteId, daysBack = 30) {
  const c = sb(); const m = new Map();
  if (!c || !athleteId) return m;
  try {
    const { data, error } = await c.rpc('weight_series', { athlete: athleteId, days_back: daysBack });
    if (!error && Array.isArray(data)) {
      for (const r of data) if (r && r.weight != null) m.set(String(r.date), r.weight);
      return m;
    }
  } catch { /* fall through */ }
  try {
    const { data } = await c.from('days').select('date,current_weight')
      .eq('athlete_id', athleteId).gte('date', daysAgoISO(daysBack)).not('current_weight', 'is', null);
    if (Array.isArray(data)) for (const r of data) if (r && r.current_weight != null) m.set(String(r.date), r.current_weight);
  } catch { /* offline / post-0103 restricted — weight honestly absent */ }
  return m;
}
export async function fetchRecentMeals(athleteId, sinceISO) {
  const c = sb(); if (!c || !athleteId) return [];
  // null = FAILED. [] on a dropped request told an athlete with a year of logs that their
  // "proof trail builds here" — the same fabrication listTrainingLogs was cured of.
  try {
    // Explicit columns, not `*` (scale pass 2026-08-17): the union every consumer actually
    // reads — traced through trust/home/nutrition-chat/meal/coach-data/recent-meals down to
    // meal-intel and food-memory. analysis/detected/note stay (the trust history renders
    // them); what drops is photo_hash, photo_taken_at, macro_confidence, description_signal,
    // favorited, source. The limit keeps the NEWEST days (day_date desc is the first sort
    // key): 200 rows is 30 days at 6 logs/day — beyond that the window query was the lie.
    const { data, error } = await c.from('meals')
      .select('id,athlete_id,day_date,type,name,protein,carbs,fat,kcal,fiber,quality,photo_path,note,analysis,detected,logged_at,minutes_late')
      .eq('athlete_id', athleteId).gte('day_date', sinceISO)
      .order('day_date', { ascending: false }).order('logged_at', { ascending: true })
      .limit(200);
    if (error) return null;
    return data || [];
  } catch { return null; }
}
export async function signedMealPhotoUrl(path) {
  const c = sb(); if (!c || !path) return null;
  try { const { data } = await c.storage.from('meal-photos').createSignedUrl(path, 3600); return (data && data.signedUrl) || null; } catch { return null; }
}
/* One round trip for a whole surface's photos instead of one per photo. Only successful paths
   appear in the result, so a caller that treats `undefined` as "not yet" retries on repaint. */
async function signedUrlMap(bucket, paths) {
  const c = sb(); const out = {};
  const want = [...new Set((paths || []).filter(Boolean))];
  if (!c || !want.length) return out;
  try {
    const { data } = await c.storage.from(bucket).createSignedUrls(want, 3600);
    for (const r of data || []) { if (r && r.signedUrl && !r.error) out[r.path] = r.signedUrl; }
  } catch { /* partial or empty map; callers keep their placeholders */ }
  return out;
}
export const signedMealPhotoUrls = (paths) => signedUrlMap('meal-photos', paths);

/* ---------------- food memory (0192): saved meals, orders + places ----------------
   The Plan intelligence hub's data. RLS decides whose memory a caller may read: the athlete
   reads their own; a coach/trainer reads any athlete they can_view — so ONE fetch serves both
   sides. Writes are athlete-only by policy; the coach's single write (verify) goes through the
   coach_verify_memory_item definer RPC. Every helper is best-effort: memory can never block
   or break logging. */
export async function fetchFoodMemory(athleteId) {
  const c = sb(); if (!c || !athleteId) return { error: true };
  try {
    const [items, places] = await Promise.all([
      c.from('food_memory_items').select('*').eq('athlete_id', athleteId).eq('status', 'active')
        .order('times_logged', { ascending: false }).limit(100),
      c.from('food_memory_places').select('*').eq('athlete_id', athleteId).eq('status', 'active')
        .order('times_eaten', { ascending: false }).limit(40),
    ]);
    if (items.error || places.error) return { error: true };
    return { items: items.data || [], places: places.data || [] };
  } catch { return { error: true }; }
}
export async function insertFoodMemoryItem(row) {
  const c = sb(); if (!c || !row || !row.athlete_id) return null;
  try {
    const { data, error } = await c.from('food_memory_items').insert(row).select('id').maybeSingle();
    if (error) { console.warn('[memory] insert item failed', error.message); return null; }
    return data ? data.id : null;
  } catch { return null; }
}
export async function updateFoodMemoryItem(id, patch) {
  const c = sb(); if (!c || !id || !patch) return false;
  try { const { error } = await c.from('food_memory_items').update(patch).eq('id', id); return !error; } catch { return false; }
}
/** "Forget" — archived, never deleted, so it's recoverable and history stays honest. */
export async function archiveFoodMemoryItem(id) { return updateFoodMemoryItem(id, { status: 'archived' }); }
/** A saved meal was re-logged: count it. `current` avoids a read-modify-write round trip. */
export async function bumpFoodMemoryItem(id, current) {
  return updateFoodMemoryItem(id, { times_logged: (Number(current) || 1) + 1, last_logged_at: new Date().toISOString() });
}
/** Find-or-create a place by name (unique per athlete on lower(name)); bumps the visit count
 *  on the existing row. Returns the place id or null. */
export async function upsertFoodMemoryPlace(athleteId, name, kind = 'restaurant') {
  const c = sb(); if (!c || !athleteId || !name) return null;
  try {
    const { data } = await c.from('food_memory_places').select('id,times_eaten')
      .eq('athlete_id', athleteId).eq('status', 'active').ilike('name', name).limit(1).maybeSingle();
    if (data && data.id) {
      await c.from('food_memory_places').update({ times_eaten: (Number(data.times_eaten) || 1) + 1, last_eaten_at: new Date().toISOString() }).eq('id', data.id);
      return data.id;
    }
    const ins = await c.from('food_memory_places').insert({ athlete_id: athleteId, name: String(name).slice(0, 80), kind }).select('id').maybeSingle();
    return ins.data ? ins.data.id : null;
  } catch { return null; }
}
/** Coach marks a saved meal verified (definer RPC — can flip ONLY the verified stamp). */
export async function coachVerifyMemoryItem(itemId) {
  const c = sb(); if (!c || !itemId) return false;
  try { const { data, error } = await c.rpc('coach_verify_memory_item', { item: itemId }); return !error && data === true; } catch { return false; }
}

/** Upload a photo ATTACHED TO A CHAT MESSAGE (not a logged meal). Returns the storage path, or
    null on any failure — the caller decides whether to still send the text.

    Deliberately its own path segment (`<uid>/chat/…`) and NOT `todayMealPhotoPath()`'s
    `<uid>/<date>/<slot>.jpg`: that key is the athlete's canonical photo FOR THAT MEAL SLOT, and
    writing a chat attachment there would silently overwrite the logged plate. Storage RLS (0003)
    only ever checks that the FIRST path segment is the caller's own uid, so this key needs no
    policy change and stays coach-readable through the same can_view() arm.

    It also never touches `meals`, so the 0062 photo-hash reuse wall cannot fire — attaching a
    picture of a plate you already logged is a legitimate thing to do in conversation. */
export async function uploadChatPhoto(userId, base64) {
  const c = sb(); if (!c || !userId || !base64) return null;
  const path = `${userId}/chat/${Date.now()}.jpg`;
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const up = await c.storage.from('meal-photos').upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (up.error) return null;
    return path;
  } catch { return null; }
}

/* ---------------- progress photos (before/after body-composition timeline, 0133) ---------------- */
/** Upload a progress photo (raw base64 jpeg) to the private progress-photos bucket and record a
    row. Path MUST start with the athlete's id (storage RLS). Best-effort — returns the new row or null. */
export async function uploadProgressPhoto(userId, base64, meta) {
  const c = sb(); if (!c || !userId || !base64) return null;
  const m = meta || {};
  const path = `${userId}/${Date.now()}.jpg`;
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const up = await c.storage.from('progress-photos').upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (up.error) return null;
    const row = {
      athlete_id: userId, photo_path: path,
      weight_lb: (m.weightLb != null && m.weightLb !== '') ? Math.round(+m.weightLb) : null,
      pose: m.pose || null, note: m.note || null,
    };
    if (m.takenOn) row.taken_on = m.takenOn;
    const { data, error } = await c.from('progress_photos').insert(row).select().maybeSingle();
    if (error) return null;
    return data || null;
  } catch { return null; }
}

/** An athlete's progress photos, newest first (self by default; a coach passes an athleteId they
    can_view). Returns [{ id, photo_path, taken_on, weight_lb, pose, note }]. */
/** The athlete's photo timeline. Same contract as listTrainingLogs: `[]` = none, `null` = the
 *  fetch failed. A failed fetch used to read "Start your timeline" to someone with twelve
 *  photos already saved, and hid the Compare button that proves they are there. */
export async function listProgressPhotos(athleteId) {
  const c = sb(); if (!c) return null;
  try {
    let uid = athleteId;
    if (!uid) { const { data: u } = await c.auth.getUser(); uid = u && u.user && u.user.id; }
    if (!uid) return null;
    const { data, error } = await c.from('progress_photos')
      .select('id,photo_path,taken_on,weight_lb,pose,note')
      .eq('athlete_id', uid)
      .order('taken_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) return null;
    return data || [];
  } catch { return null; }
}

/** Delete a progress photo (owner-RLS); best-effort object cleanup after the row goes. */
export async function deleteProgressPhoto(id, path) {
  const c = sb(); if (!c || !id) return false;
  try {
    const { error } = await c.from('progress_photos').delete().eq('id', id);
    if (error) return false;
    if (path) { try { await c.storage.from('progress-photos').remove([path]); } catch { /* orphan cleanup best-effort */ } }
    return true;
  } catch { return false; }
}

export async function signedProgressPhotoUrl(path) {
  const c = sb(); if (!c || !path) return null;
  try { const { data } = await c.storage.from('progress-photos').createSignedUrl(path, 3600); return (data && data.signedUrl) || null; } catch { return null; }
}
export const signedProgressPhotoUrls = (paths) => signedUrlMap('progress-photos', paths);

/* ---------------- health / wearables (Apple Health, Health Connect) — DISPLAY-only in v1 ----------------
   All false/null in a browser/preview or until the founder wires the native health module
   (src/lib/health). Device data never changes the score; it's shown for context. */
export async function healthAvailable() {
  try { if (window.OnStandardNative && window.OnStandardNative.health) return !!(await window.OnStandardNative.health.available()); } catch { /* no bridge */ }
  return false;
}
export async function healthConnected() {
  try { if (window.OnStandardNative && window.OnStandardNative.health) return !!(await window.OnStandardNative.health.connected()); } catch { /* no bridge */ }
  return false;
}
export async function healthConnect() {
  try { if (window.OnStandardNative && window.OnStandardNative.health) return await window.OnStandardNative.health.connect(); } catch (e) { return { connected: false, reason: 'error' }; }
  return { connected: false, reason: 'unavailable' };
}
/** Latest recovery sample { sleepHours?, hrvMs?, restingHr? } or null. */
export async function healthRead() {
  try { if (window.OnStandardNative && window.OnStandardNative.health) return await window.OnStandardNative.health.read(); } catch { /* no bridge */ }
  return null;
}

/* ---------------- dietary declarations (0134) — athlete-declared, coach-readable ---------------- */
/** Push the athlete's structured restrictions to the server (owner-write). Best-effort. */
export async function saveDietaryRestrictions(userId, data) {
  const c = sb(); if (!c || !userId) return false;
  try {
    const { error } = await c.from('dietary_restrictions')
      .upsert({ athlete_id: userId, data: data || {}, updated_at: new Date().toISOString() });
    return !error;
  } catch { return false; }
}
/** The caller's own declaration (for cross-device hydrate). Returns the data object, null when
    the server confirms no declaration, or { error:true } on a FAILED read — allergy data must
    not hydrate as "none declared" off a dropped request. */
export async function fetchMyDietary() {
  const c = sb(); if (!c) return null;
  try {
    const { data: u } = await c.auth.getUser(); const uid = u && u.user && u.user.id; if (!uid) return null;
    const { data, error } = await c.from('dietary_restrictions').select('data').eq('athlete_id', uid).maybeSingle();
    if (error) return { error: true };
    return (data && data.data) || null;
  } catch { return { error: true }; }
}
/** Coach read: declarations for a set of roster athletes (RLS gates to those they can_view).
    Returns [{ athlete_id, data }] — only athletes who have actually declared. */
export async function fetchTeamDietary(athleteIds) {
  const c = sb(); if (!c || !athleteIds || !athleteIds.length) return [];
  // null = FAILED. This feeds the Team Dietary Sheet — a safety surface a coach may order
  // team meals from. A dropped request must never read as "no declarations".
  try {
    // Chunked (scale pass 2026-08-18).
    const results = await Promise.all(chunkIds(athleteIds).map((chunk) =>
      c.from('dietary_restrictions').select('athlete_id,data').in('athlete_id', chunk)));
    if (results.some((r) => r.error)) return null;
    return results.flatMap((r) => r.data || []);
  } catch { return null; }
}

/* ---------------- training logs (0135) — lightweight session + notes, tracked-not-scored ---------------- */
/** Record a training session. A coach-requirement log is one-per-session-per-day (re-logging
    replaces today's entry); a self-log always adds a new row. Best-effort — returns the row or null. */
export async function saveTrainingLog(userId, opts) {
  const c = sb(); if (!c || !userId) return null;
  const o = opts || {};
  const today = o.logDate || new Date().toISOString().slice(0, 10);
  try {
    const row = {
      athlete_id: userId, log_date: today,
      title: o.title ? String(o.title).slice(0, 80) : null,
      note: o.note ? String(o.note).slice(0, 1000) : null,
      feel: (o.feel != null && o.feel !== '') ? Math.max(1, Math.min(5, Math.round(+o.feel))) : null,
      source: o.source === 'coach' ? 'coach' : 'self',
      requirement_id: o.requirementId || null,
    };
    // Replace any existing same-day entry for this programmed session so "update" never duplicates.
    if (o.requirementId) {
      try { await c.from('training_logs').delete().eq('athlete_id', userId).eq('requirement_id', o.requirementId).eq('log_date', today); } catch { /* best-effort */ }
    }
    const { data, error } = await c.from('training_logs').insert(row).select().maybeSingle();
    if (error) return null;
    return data || null;
  } catch { return null; }
}
/** An athlete's training logs, newest first (self by default; a coach passes an athleteId they
    can_view). Returns [{ id, log_date, title, note, feel, source, requirement_id }]. */
/** The athlete's session log. `[]` means they have none; **`null` means we could not find out**
 *  — do not collapse the two. Returning [] on a failed fetch made training-history render "No
 *  sessions yet" to an athlete with forty of them, which is the fabricated-data state
 *  errorState() exists to prevent. The one coach-side caller already does `rows || []`. */
export async function listTrainingLogs(athleteId) {
  const c = sb(); if (!c) return null;
  try {
    let uid = athleteId;
    if (!uid) { const { data: u } = await c.auth.getUser(); uid = u && u.user && u.user.id; }
    if (!uid) return null;
    const { data, error } = await c.from('training_logs')
      .select('id,log_date,title,note,feel,source,requirement_id')
      .eq('athlete_id', uid)
      .order('log_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) return null;
    return data || [];
  } catch { return null; }
}
/** Delete a training log (owner-RLS). */
export async function deleteTrainingLog(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('training_logs').delete().eq('id', id); return !error; } catch { return false; }
}
/** The ATHLETE side of the 0043 receipt loop: who actually opened MY day. RLS
    (coach_views_read) scopes rows to athlete_id = auth.uid() or the viewer's own receipts;
    the explicit athlete_id filter keeps a coach's client from pulling receipts they wrote
    about other athletes through this athlete-facing helper. Best-effort []. */
export async function fetchMyDayReceipts(athleteId, date) {
  const c = sb(); if (!c || !athleteId || !date) return [];
  try {
    const { data, error } = await c.from('coach_views')
      .select('viewer_name,seen_at').eq('athlete_id', athleteId).eq('date', date)
      .order('seen_at', { ascending: false }).limit(8);
    // null = FAILED. Both callers render nothing either way (a receipt is proof someone looked,
    // so silence is the honest failure), but the distinction keeps .length off a null.
    if (error) return null;
    return data || [];
  } catch { return null; }
}

export async function markDayViewed(athleteId, date, viewerId, viewerName) {
  const c = sb(); if (!c || !athleteId || !viewerId) return;
  try { await c.from('coach_views').upsert({ athlete_id: athleteId, viewer_id: viewerId, date, viewer_name: viewerName || null, seen_at: new Date().toISOString() }, { onConflict: 'athlete_id,viewer_id,date' }); } catch { /* best-effort receipt */ }
}

/* ---------------- meal comments (the real coach↔athlete thread) ---------------- */
/** Returns the meal's comment thread, oldest→newest — or the {error:true} sentinel (same
    pattern as fetchMyTeams) on a supabase {error} or thrown fetch, so an outage is never
    mistaken for "no replies yet".
 *  `sinceISO` (scale pass 2026-08-18): when passed, first runs a HEAD+count probe — an index
 *  scan, not 200 rows of text/meta over the wire — and returns {unchanged:true} instead of
 *  refetching if nothing landed after it. `.gt` not `.gte`, so a same-instant sibling row (two
 *  comments sharing one transaction's `now()`) can go unseen by ONE probe; the poll's next
 *  tick, its burst window after a send, and the realtime doorbell (which always fetches
 *  unconditionally) each independently catch it, so the narrow miss self-heals fast. A probe
 *  FAILURE falls through to the real fetch — this can only ever cost an extra round trip. Omit
 *  sinceISO for the original always-full behavior (every other caller, and every other call
 *  site in meal.js, does exactly that on purpose — a probe only serves the idle poll floor). */
export async function fetchMealComments(mealId, sinceISO) {
  const c = sb(); if (!c || !mealId) return [];
  try {
    if (sinceISO) {
      const { count, error: probeErr } = await c.from('meal_comments')
        .select('id', { count: 'exact', head: true }).eq('meal_id', mealId).gt('created_at', sinceISO);
      if (!probeErr && !count) return { unchanged: true };
    }
    const { data, error } = await c.from('meal_comments').select('*').eq('meal_id', mealId).order('created_at', { ascending: true }).limit(200);
    if (error) return { error: true };
    return data || [];
  } catch { return { error: true }; }
}
/* `meta` (0157) is optional and rides the same row: clients may write it on their own rows because
   the insert policy is row-level, not column-level. Used for a chat photo attachment
   ({photo:'<uid>/chat/…'}); the retry paths below drop it first, since a database old enough to
   lack `kind` also lacks `meta` and a message is worth more than its attachment. */
export async function postMealComment(mealId, athleteId, authorId, role, text, kind = 'message', meta = null) {
  const c = sb(); if (!c || !mealId || !authorId) return false;
  try {
    const row = { meal_id: mealId, athlete_id: athleteId, author_id: authorId, role, text };
    if (kind !== 'message') row.kind = kind;
    if (meta) row.meta = meta;
    const { error } = await c.from('meal_comments').insert(row);
    if (!error) return true;
    // A `meta` the database does not have would fail an otherwise-valid message. Retry without it
    // before giving up, so an attachment degrades to a plain text message instead of a lost one.
    if (meta) {
      const retry = { meal_id: mealId, athlete_id: athleteId, author_id: authorId, role, text };
      if (kind !== 'message') retry.kind = kind;
      const { error: eMeta } = await c.from('meal_comments').insert(retry);
      if (!eMeta) return true;
    }
    // pre-0049 DB: retry without kind so plain messages still post
    if (kind === 'message') return false;
    const { error: e2 } = await c.from('meal_comments').insert({ meal_id: mealId, athlete_id: athleteId, author_id: authorId, role, text });
    return !e2;
  } catch { return false; }
}

/** Every message across an athlete's own meals, newest window first — the season-long thread.
 *
 *  Keyed on athlete_id rather than meal_id, which is what makes one continuous conversation
 *  possible without changing where the rows live: RLS scopes it exactly as it scopes a single
 *  meal, so this reads the same rows the athlete could already read one plate at a time.
 *
 *  Returned oldest-first (the reading order); `beforeISO` pages backwards through the season. */
export async function fetchMyMealThread(athleteId, { beforeISO = null, limit = 200 } = {}) {
  const c = sb(); if (!c || !athleteId) return [];
  try {
    let q = c.from('meal_comments').select('*').eq('athlete_id', athleteId);
    if (beforeISO) q = q.lt('created_at', beforeISO);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
    if (error) return { error: true };
    return (data || []).slice().reverse();
  } catch { return { error: true }; }
}

/** Who is in this athlete's meal conversation (0158) — real names and real roles, for the
 *  participants header and for attributing bubbles. Cached per athlete for the session: the
 *  membership of a room does not change between two paints, and this is called on every mount.
 *
 *  Returns [] on any failure, including a database that predates the RPC. The thread then falls
 *  back to role labels, which is worse than names and much better than a blank screen — a
 *  participants list is a courtesy, never a gate on reading your own meal. */
const PARTICIPANTS = {};
export async function fetchThreadParticipants(athleteId, { force = false } = {}) {
  if (!athleteId) return [];
  if (!force && PARTICIPANTS[athleteId]) return PARTICIPANTS[athleteId];
  const c = sb(); if (!c) return [];
  try {
    const { data, error } = await c.rpc('meal_thread_participants', { p_athlete: athleteId });
    if (error) return [];
    const rows = Array.isArray(data) ? data.filter(Boolean) : [];
    PARTICIPANTS[athleteId] = rows;
    return rows;
  } catch { return []; }
}

/** Remove one's OWN comment (0046 delete-own policy). Used to un-send a mis-tapped reaction, so a
 *  wrong emoji is undoable rather than something the athlete sees and the coach cannot retract. */
export async function deleteMealComment(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('meal_comments').delete().eq('id', id); return !error; }
  catch { return false; }
}

/* ---------------- coach: targets / trust pass (RPCs) ---------------- */
/** base_weight + targets via the 0103 athlete_plan_meta RPC — the server conditionally redacts
 *  the weight parts for roles outside the allowed set (base_weight → null, targets minus its
 *  'weight' key; protein/calories always survive — the nutritionist's lane). Pre-0103 fallback:
 *  direct column read, still granted until the migration applies. Best-effort null. */
async function fetchPlanMeta(athleteId) {
  const c = sb(); if (!c || !athleteId) return null;
  try {
    const { data, error } = await c.rpc('athlete_plan_meta', { athlete: athleteId });
    if (!error && Array.isArray(data) && data[0]) return data[0];
    if (error) {
      const { data: legacy } = await c.from('athlete_profiles').select('base_weight,targets').eq('athlete_id', athleteId).maybeSingle();
      return legacy || null;
    }
    return null;
  } catch { return null; }
}
export async function fetchAthleteTargets(athleteId) {
  const meta = await fetchPlanMeta(athleteId);
  return (meta && meta.targets) || null;
}
/** Coach-visible athlete basics for target suggestions + the score breakdown's nutrition config
 *  (can_view-scoped). base_goal/position/sport stay direct reads (granted post-0103); base_weight
 *  + coach-set targets ride the redacting RPC. A weight-restricted role gets base_weight null +
 *  targets without a weight key — nutritionConfigForGoal degrades honestly (default bodyweight
 *  for goal-derived targets; exact whenever coach-set protein/cal targets exist). */
export async function fetchAthleteBasics(athleteId) {
  const c = sb(); if (!c || !athleteId) return null;
  try {
    const [{ data }, meta] = await Promise.all([
      c.from('athlete_profiles').select('base_goal,position,sport').eq('athlete_id', athleteId).maybeSingle(),
      fetchPlanMeta(athleteId),
    ]);
    if (!data && !meta) return null;
    return { ...(data || {}), base_weight: meta ? meta.base_weight : null, targets: (meta && meta.targets) || null };
  } catch { return null; }
}
export async function coachSetGoals(athleteId, targets) {
  const c = sb(); if (!c || !athleteId) return false;
  try { const { error } = await c.rpc('coach_set_goals', { athlete: athleteId, new_targets: targets, new_season_goal: null }); return !error; } catch { return false; }
}
/** The athlete's own stated plan-style PREFERENCE (0142) — always readable by a connected
 *  coach/trainer/nutrition pro (profiles_read: connected(id)), even when a team standard or
 *  their own assignment governs the effective style. This is the "3 athletes prefer more
 *  flexibility" signal: never a dead end for a locked athlete's answer. */
export async function fetchAthletePlanPreference(athleteId) {
  const c = sb(); if (!c || !athleteId) return null;
  try {
    const { data } = await c.from('profiles').select('plan_style_preference').eq('id', athleteId).maybeSingle();
    return (data && data.plan_style_preference) || null;
  } catch { return null; }
}
/** A coach/trainer/nutrition pro assigns (or clears) a plan style + optional knob overrides for
 *  one athlete (set_athlete_plan_style RPC — server enforces is_team_coach_of/is_trainer_of and
 *  validates the overrides shape). Returns false on any rejection (auth, invalid style/overrides,
 *  offline) — the caller shows an honest error rather than assuming success. */
export async function setAthletePlanStyle(athleteId, style, overrides, reason) {
  const c = sb(); if (!c || !athleteId || !style) return false;
  try {
    const { error } = await c.rpc('set_athlete_plan_style', {
      p_athlete: athleteId, p_style: style, p_overrides: overrides || null, p_reason: reason || null,
    });
    return !error;
  } catch { return false; }
}
// Coach OS Slice D — Inbox v2. Ask meal-chat (draft mode) for FOUR candidate coach-voice
// replies about a meal. The edge fn persists NOTHING here; these are drafts the coach edits
// and sends manually. Same vendored-supabase-js error-parse idiom as screens/meal.js (~818):
// on a non-2xx the client throws FunctionsHttpError, so data is null and the structured error
// body must be read off error.context.json(). Never throws into the UI.
export async function draftMealReplies(mealId, context) {
  const c = sb(); if (!c || !mealId) return { ok: false, error: 'offline' };
  try {
    const { data, error } = await c.functions.invoke('meal-chat', { body: { mealId, draftReplies: true, context: context || {} } });
    if (error || !data || data.error) {
      let parsed = data && data.error ? data : null;
      if (!parsed && error && error.context && typeof error.context.json === 'function') parsed = await error.context.json().catch(() => null);
      return { ok: false, error: (parsed && parsed.error) || 'unavailable' };
    }
    return { ok: true, drafts: Array.isArray(data.drafts) ? data.drafts : [] };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
/* Trust Pass (0196). A grant is coach OR trainer authorized server-side (grant_pass); a spend is
   self-only by construction, since spend_pass takes no athlete argument at all. */
export async function fetchActivePass(athleteId) {
  const c = sb(); if (!c || !athleteId) return null;
  try {
    const { data, error } = await c.from('trust_passes')
      .select('id,credits_total,covers_from,covers_until,expires_on,note,created_at')
      .eq('athlete_id', athleteId).is('ended_at', null).maybeSingle();
    // A throw and an empty result are different facts. Returning null on an ERROR would read as
    // "no pass" and quietly hide a credit the athlete owns.
    if (error) return { error: error.message };
    return data || null;
  } catch (e) { return { error: String((e && e.message) || e) }; }
}

export async function grantPass(athleteId, opts) {
  const c = sb(); if (!c || !athleteId) return { ok: false };
  const o = opts || {};
  const args = { p_athlete: athleteId };
  if (typeof o.credits === 'number') args.p_credits = o.credits;
  if (o.from)  args.p_covers_from = o.from;
  if (o.until) args.p_covers_until = o.until;
  if (o.expires) args.p_expires_on = o.expires;
  if (o.note) args.p_note = String(o.note).slice(0, 140);
  try { const { error } = await c.rpc('grant_pass', args); return { ok: !error, error: error && error.message }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

export async function endPass(athleteId) {
  const c = sb(); if (!c || !athleteId) return false;
  try { const { error } = await c.rpc('end_pass', { p_athlete: athleteId }); return !error; } catch { return false; }
}

export async function spendPass(dayISO, slot) {
  const c = sb(); if (!c || !dayISO || !slot) return { ok: false };
  try { const { error } = await c.rpc('spend_pass', { p_day: dayISO, p_slot: slot }); return { ok: !error, error: error && error.message }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

/* One row per book (0196's dual-owner shape): teamId OR practiceId, never both — the caller
   passes whichever their operator context has, exactly like every other 0136 dual-owner fetch. */
export async function fetchPassPolicy({ teamId, practiceId } = {}) {
  const c = sb(); if (!c || (!teamId && !practiceId)) return null;
  try {
    let q = c.from('trust_pass_policy')
      .select('default_credits,default_window_days,eligibility_days,max_credits');
    q = teamId ? q.eq('team_id', teamId) : q.eq('practice_id', practiceId);
    const { data, error } = await q.maybeSingle();
    // null = confirmed no custom policy (shipped defaults are correct); { error:true } = FAILED,
    // where the shipped defaults would misstate the coach's own eligibility numbers.
    if (error) return { error: true };
    return data || null;
  } catch { return { error: true }; }
}

/* Active passes across the whole book, for the roster section. Returns a map keyed by athlete id,
   or null on failure (never {} — an empty map from a failed fetch would read as "nobody has a
   pass" and hide every active grant on the roster). */
export async function fetchRosterPasses(athleteIds) {
  const c = sb(); if (!c || !athleteIds || !athleteIds.length) return null;
  try {
    // Chunked (scale pass 2026-08-18).
    const results = await Promise.all(chunkIds(athleteIds).map((chunk) =>
      c.from('trust_passes').select('id,athlete_id,credits_total,covers_from,covers_until,expires_on')
        .in('athlete_id', chunk).is('ended_at', null)));
    if (results.some((r) => r.error)) return null;
    const map = {};
    for (const r of results) for (const row of (r.data || [])) map[row.athlete_id] = row;
    return map;
  } catch { return null; }
}
/* Coach first-run setup progress (0092), read back so the checklist RESUMES after a reinstall or on
   a new device — the write side (act.markCoachSetup) had no reader, so progress looked lost. Returns
   a { step: true } map of completed steps. Staff-scoped RLS; a missing table/offline returns {}. */
export async function fetchCoachSetupState(teamId) {
  const c = sb(); if (!c || !teamId) return {};
  try {
    const { data, error } = await c.from('coach_setup_state').select('step, state').eq('team_id', teamId).eq('state', 'completed');
    // null = FAILED, {} = confirmed nothing completed. A fabricated {} re-opens "Finish setting
    // up your team" for steps that were completed on another device.
    if (error) return null;
    const map = {};
    for (const r of (data || [])) if (r && r.step) map[r.step] = true;
    return map;
  } catch { return null; }
}
/* The practice arm of the same resume (0197). fetchCoachSetupState only ever read by team_id, so
   a trainer's checklist progress silently reset on every reinstall/new device — "Finish setting
   up your practice" kept coming back for trainers who had finished (founder, 2026-08-10). */
export async function fetchPracticeSetupState(practiceId) {
  const c = sb(); if (!c || !practiceId) return {};
  try {
    const { data, error } = await c.from('practice_setup_state').select('step, state').eq('practice_id', practiceId).eq('state', 'completed');
    if (error) return null; // null = FAILED (this is the 0197 founder bug's other half)
    const map = {};
    for (const r of (data || [])) if (r && r.step) map[r.step] = true;
    return map;
  } catch { return null; }
}
/* Per-team weekly training/rest pattern (0100): a 7-element array indexed by getDay() (0=Sun). Team
   MEMBERS read it (their scored day resolves day-type from it); staff write. A missing row means no
   day-type gating — every requirement item applies every day. The WRITE lives in state.js
   act.setWeekPattern (owns RT). */
/* null already means "no pattern configured" (no day-type gating), so FAILURE needs its own
   value: { error:true }. Callers must branch on it and keep last-known — overwriting
   RT.weekPattern with null on a blip drops rest-day gating, and the athlete gets scored on
   training-day items they were never meant to do. */
export async function fetchTeamWeekPattern(teamId) {
  const c = sb(); if (!c || !teamId) return null;
  try {
    const { data, error } = await c.from('team_week_pattern').select('pattern').eq('team_id', teamId).maybeSingle();
    if (error) return { error: true };
    return data && Array.isArray(data.pattern) ? data.pattern : null;
  } catch { return { error: true }; }
}

/* ---------------- staff & collaborators (0061) ---------------- */
export async function fetchTeamStaff(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  // null = FAILED, [] = confirmed no other staff.
  try { const { data, error } = await c.rpc('team_staff_list', { p_team: teamId }); if (error) return null; return data || []; } catch { return null; }
}
export async function createStaffInvite(teamId, role) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.rpc('create_staff_invite', { p_team: teamId, p_role: role });
    if (error) return { ok: false, error: error.message || 'Could not create the code.' };
    return { ok: true, code: (typeof data === 'string' && data) || '' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not create the code.' }; }
}
export async function joinStaff(code) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.rpc('join_staff', { p_code: code });
    if (error) return { ok: false, error: error.message || 'That code did not work.' };
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { ok: true, teamId: row.team_id, teamName: row.team_name, role: row.staff_role } : { ok: false, error: 'That code did not work.' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'That code did not work.' }; }
}
export async function revokeStaff(teamId, staffId) {
  const c = sb(); if (!c) return false;
  try { const { data, error } = await c.rpc('revoke_staff', { p_team: teamId, p_staff: staffId }); return !error && data === true; } catch { return false; }
}

/* ---------------- preferred coach name (0056) ---------------- */
/** The signed-in user's own coach handle ("Coach JB"). null = none set; {error:true} on failure. */
export async function fetchMyCoachHandle() {
  const c = sb(); if (!c) return { error: true };
  try {
    const { data, error } = await c.from('profiles').select('coach_display_name').eq('id', (await c.auth.getUser()).data.user.id).maybeSingle();
    if (error) return { error: true };
    return (data && data.coach_display_name) || null;
  } catch { return { error: true }; }
}
/** Set (or clear with '') the handle via the 0056 definer RPC. */
export async function setMyCoachName(name) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.rpc('set_my_coach_name', { new_name: name });
    if (error) return { ok: false, error: error.message || 'Could not save that.' };
    return { ok: true, name: (typeof data === 'string' && data) || null };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save that.' }; }
}

/* ---------------- requirements engine (0055) ---------------- */
/** Which owner column a book kind writes/reads (0136 dual-owner columns). A coach's book is a
    team, a trainer's is a practice; exactly one is ever set on a row. */
export const ownerCol = (kind) => (kind === 'practice' ? 'practice_id' : 'team_id');

/** The book's standing requirement sets (RLS: staff/owner + active members/clients).
    null = FAILED: a fabricated [] here silently reverts the athlete's SCORED DAY to the
    built-in catalog, dropping the coach's standard — callers keep last-known instead. */
export async function fetchRequirementSets(bookId, kind = 'team') {
  const c = sb(); if (!c || !bookId) return [];
  try { const { data, error } = await c.from('requirement_sets').select('*').eq(ownerCol(kind), bookId); if (error) return null; return data || []; } catch { return null; }
}
/** The BOUNDED read for athlete-side standard resolution (0203): per scope lane, everything
 *  effective after (today - 7) plus the newest row at-or-before it — provably still contains
 *  the governing row for any asOf resolveRequirementSet is called with. Falls back to the
 *  full fetch on a pre-0203 server so an old database never breaks scoring. Same null-on-FAIL
 *  contract as fetchRequirementSets: a fabricated [] would silently drop the coach's standard. */
export async function fetchRelevantRequirementSets(bookId, kind = 'team') {
  const c = sb(); if (!c || !bookId) return [];
  try {
    const { data, error } = await c.rpc('relevant_requirement_sets', { p_book: bookId, p_kind: kind });
    if (!error) return data || [];
    return fetchRequirementSets(bookId, kind); // RPC missing/failed: the unbounded read still tells the truth
  } catch { return fetchRequirementSets(bookId, kind); }
}
/** The signed-in ATHLETE's assignments: everything open plus anything closed recently
    (so a just-completed task still shows Done tonight). null = FAILED — [] on a dropped
    request wiped every real coach assignment out of local state. */
export async function fetchMyAssignments() {
  const c = sb(); if (!c) return [];
  try {
    const since = daysAgoISO(7);
    const { data, error } = await c.from('requirement_assignments').select('*')
      .neq('status', 'cancelled').gte('created_at', since)
      .order('created_at', { ascending: false }).limit(60);
    if (error) return null;
    return data || [];
  } catch { return null; }
}
/** The signed-in user's server notification feed (0027): coach nudges, join events, digests.
    Recent first, bounded. null = FAILED — [] here didn't just render "all caught up", it
    overwrote and PERSISTED the cached feed as empty. RLS scopes the select to the caller. */
export async function fetchMyNotifications(limit = 30) {
  const c = sb(); if (!c) return [];
  try {
    const { data, error } = await c.from('notifications')
      .select('id, kind, title, body, created_at, read_at')
      .order('created_at', { ascending: false }).limit(limit);
    if (error) return null;
    return data || [];
  } catch { return null; }
}
/** Mark the caller's unread server notifications read (bell opened). Best-effort; RLS
    (notif_update, self-only) already scopes the update to the caller's own rows. */
export async function markMyNotificationsRead() {
  const c = sb(); if (!c) return;
  try { await c.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); }
  catch { /* best-effort — unread state self-heals on the next fetch */ }
}

/** Coach saves a standing requirement set (team / position / athlete scope). `effectiveDate`
    ('YYYY-MM-DD' or null) makes the change prospective — null is the always-in-effect base
    (team creation / apply-now), a future date leaves today and past days untouched (0085). */
export async function setTeamRequirements(bookId, scopeKind, scopeValue, items, effectiveDate = null, kind = 'team') {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  const practice = kind === 'practice';
  try {
    const { error } = await c.rpc(practice ? 'set_practice_requirements' : 'set_team_requirements',
      practice
        ? { p_practice: bookId, p_scope_kind: scopeKind, p_scope_value: scopeValue || null, p_items: items, p_effective_date: effectiveDate || null }
        : { p_team: bookId, p_scope_kind: scopeKind, p_scope_value: scopeValue || null, p_items: items, p_effective_date: effectiveDate || null });
    return error ? { ok: false, error: error.message || 'Could not save the standard.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save the standard.' }; }
}
/** Remove a scope override so it falls back to the team default (0058). */
export async function clearTeamRequirements(bookId, scopeKind, scopeValue, kind = 'team') {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  const practice = kind === 'practice';
  try {
    const { error } = await c.rpc(practice ? 'clear_practice_requirements' : 'clear_team_requirements',
      practice
        ? { p_practice: bookId, p_scope_kind: scopeKind, p_scope_value: scopeValue || null }
        : { p_team: bookId, p_scope_kind: scopeKind, p_scope_value: scopeValue || null });
    return error ? { ok: false, error: error.message || 'Could not reset it.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not reset it.' }; }
}

/** Coach + button → assign_requirement RPC (fans out one row per athlete + push row each).
    Returns { ok, count?, error? } with the server's message surfaced verbatim. */
export async function assignRequirement({ teamId, scopeKind, scopeValue, title, proof, dueAt, dueLabel, note, kind = 'team' }) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  const practice = kind === 'practice';
  const owner = practice ? { p_practice: teamId } : { p_team: teamId };
  try {
    const { data, error } = await c.rpc(practice ? 'assign_practice_requirement' : 'assign_requirement', {
      ...owner, p_scope_kind: scopeKind, p_scope_value: scopeValue || null,
      p_title: title, p_proof: proof || 'check', p_due_at: dueAt || null,
      p_due_label: dueLabel || null, p_note: note || null,
    });
    if (error) return { ok: false, error: error.message || 'Could not send the assignment.' };
    return { ok: true, count: typeof data === 'number' ? data : 0 };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not send the assignment.' }; }
}
/** Athlete marks their own open assignment done (server-verified). Best-effort false. */
export async function completeAssignmentRemote(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { data, error } = await c.rpc('complete_assignment', { p_id: id }); return !error && data === true; } catch { return false; }
}

/* ---- Requirement templates (Slice C, 0074): named reusable requirement-set drafts ---- */
export async function fetchRequirementTemplates(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  // null = FAILED. [] means "this team really has no templates", which is the trigger for the
  // one-time seven-row seed — a failure must never impersonate it.
  try {
    const { data, error } = await c.from('requirement_templates')
      .select('id,name,kind,items,created_at').eq('team_id', teamId).order('created_at');
    if (error) return null;
    return data || [];
  } catch { return null; }
}
export async function saveRequirementTemplate(teamId, name, kind, items) {
  const c = sb(); if (!c) return { ok: false, error: 'Offline' };
  try {
    const { error } = await c.from('requirement_templates')
      .insert({ team_id: teamId, name, kind: kind || 'custom', items });
    if (error) return { ok: false, error: /duplicate|unique/i.test(error.message || '') ? 'A template with that name already exists.' : error.message };
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
export async function deleteRequirementTemplate(id) {
  const c = sb(); if (!c) return { ok: false };
  try { const { error } = await c.from('requirement_templates').delete().eq('id', id); return { ok: !error }; }
  catch { return { ok: false }; }
}
/* Rename only — never touches `items`, so a rename can't accidentally redefine what applying
   the template fills in. Same duplicate-name message as saveRequirementTemplate (same unique
   index: team_id, lower(name)). */
export async function renameRequirementTemplate(id, name) {
  const c = sb(); if (!c || !id) return { ok: false, error: 'Offline' };
  try {
    const { error } = await c.from('requirement_templates').update({ name }).eq('id', id);
    if (error) return { ok: false, error: /duplicate|unique/i.test(error.message || '') ? 'A template with that name already exists.' : error.message };
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

/* ---- Announcements (Slice C, 0074): staff broadcast → feed rows server-side ---- */
export async function postAnnouncement({ teamId, scopeKind = 'team', scopeValue = null, title, body }) {
  const c = sb(); if (!c) return { ok: false, error: 'Offline' };
  try {
    const { data, error } = await c.rpc('post_announcement', {
      p_team: teamId, p_scope_kind: scopeKind, p_scope_value: scopeValue, p_title: title, p_body: body,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data && data.id, count: (data && data.count) || 0 };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
export async function fetchAnnouncements(teamId, limit = 10) {
  const c = sb(); if (!c || !teamId) return [];
  // null = FAILED. "Nothing sent yet" on a dropped request invites a duplicate broadcast.
  try {
    const { data, error } = await c.from('announcements')
      .select('id,title,body,scope_kind,scope_value,sent_count,created_at')
      .eq('team_id', teamId).order('created_at', { ascending: false }).limit(limit);
    if (error) return null;
    return data || [];
  } catch { return null; }
}

/* ---------------- Coach OS core (0071): interventions, groups, exceptions ---------------- */
/** Log a coach action (nudge/message/assign/handled). The queue and Insights both read this. */
export async function logIntervention({ teamId, athleteId, kind, reasonKey, tier, note, book = 'team' }) {
  const c = sb(); if (!c || !teamId || !athleteId || !kind) return false;
  // `kind` is the INTERVENTION kind (nudge/message/assign/handled); `book` is which owner column
  // the row hangs off (0136). Exactly one of team_id/practice_id may be set — the CHECK enforces it.
  try {
    const { error } = await c.from('coach_interventions').insert({
      [ownerCol(book)]: teamId, athlete_id: athleteId, kind, day: todayISO(),
      reason_key: reasonKey || null, tier: tier || null, note: note || null,
    });
    return !error;
  } catch { return false; }
}
/** Today's interventions for the team (priority queue filters on these). Best-effort []. */
export async function fetchTodayInterventions(bookId, kind = 'team') {
  const c = sb(); if (!c || !bookId) return [];
  try {
    const { data, error } = await c.from('coach_interventions')
      .select('athlete_id,kind,reason_key,tier,created_at')
      .eq(ownerCol(kind), bookId).eq('day', todayISO()).limit(400);
    if (error) return null; // null = FAILED (loadExtras keeps last-known)
    return data || [];
  } catch { return null; }
}
export async function fetchCoachGroups(bookId, kind = 'team') {
  const c = sb(); if (!c || !bookId) return [];
  // null = FAILED. [] also un-ticks the coach's "Create a group" setup step, so a blip made a
  // finished checklist look unfinished.
  try { const { data, error } = await c.from('coach_groups').select('id,name,athlete_ids').eq(ownerCol(kind), bookId).order('name'); if (error) return null; return data || []; } catch { return null; }
}
export async function saveCoachGroup(bookId, { id, name, athleteIds }, kind = 'team') {
  const c = sb(); if (!c || !bookId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const row = { [ownerCol(kind)]: bookId, name, athlete_ids: athleteIds || [], updated_at: new Date().toISOString() };
    const q = id ? c.from('coach_groups').update(row).eq('id', id) : c.from('coach_groups').insert(row);
    const { error } = await q;
    return error ? { ok: false, error: error.message || 'Could not save the group.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save the group.' }; }
}
export async function deleteCoachGroup(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('coach_groups').delete().eq('id', id); return !error; } catch { return false; }
}
/* Position rooms (0087, T-04 slice 1): first-class rooms, distinct from custom groups above. Members
   read, staff write. Slice 1 is the object + CRUD only — no auto-assign, no scoring inheritance. */
export async function fetchTeamRooms(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  // null = FAILED. [] silently falls every athlete's room label back to their raw position,
  // which changes how their standard is displayed across the roster.
  try { const { data, error } = await c.from('team_rooms').select('id,key,label,sort,staff_owner_id').eq('team_id', teamId).order('sort').order('label'); if (error) return null; return data || []; } catch { return null; }
}
export async function saveTeamRoom(teamId, { id, key, label, sort }) {
  const c = sb(); if (!c || !teamId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const row = { team_id: teamId, key, label, updated_at: new Date().toISOString() };
    if (typeof sort === 'number') row.sort = sort;
    const q = id ? c.from('team_rooms').update(row).eq('id', id) : c.from('team_rooms').insert(row);
    const { error } = await q;
    return error ? { ok: false, error: error.message || 'Could not save the room.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save the room.' }; }
}
export async function deleteTeamRoom(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('team_rooms').delete().eq('id', id); return !error; } catch { return false; }
}
/* Set (or clear) a room's staff owner — the position coach responsible for it (T-04 slice 3).
   Staff-scoped RLS (team_rooms tr_staff_update). staffId null clears the owner. */
export async function setRoomOwner(roomId, staffId) {
  const c = sb(); if (!c || !roomId) return { ok: false };
  try { const { error } = await c.from('team_rooms').update({ staff_owner_id: staffId || null, updated_at: new Date().toISOString() }).eq('id', roomId); return { ok: !error, error: error && error.message }; } catch (e) { return { ok: false, error: e && e.message }; }
}
/* The signed-in ATHLETE's own assigned room label (0101), or null when unassigned. Drives their
   standard resolution (an assigned athlete's day follows their room; null = raw position, parity).
   Reads their own team_members row (tm_read self policy) then the room label (member read). */
export async function fetchMyRoomLabel(teamId) {
  const c = sb(); if (!c || !teamId) return null;
  try {
    const u = await c.auth.getUser();
    const uid = u.data && u.data.user && u.data.user.id;
    if (!uid) return null;
    // null = confirmed unassigned; { error:true } = FAILED. Collapsing them silently resolved
    // the athlete's standard against their raw position instead of their room.
    const { data: mem, error: memErr } = await c.from('team_members').select('room_id').eq('team_id', teamId).eq('athlete_id', uid).eq('status', 'active').maybeSingle();
    if (memErr) return { error: true };
    if (!mem || !mem.room_id) return null;
    const { data: room, error: roomErr } = await c.from('team_rooms').select('label').eq('id', mem.room_id).maybeSingle();
    if (roomErr) return { error: true };
    return room && room.label ? room.label : null;
  } catch { return { error: true }; }
}
/* Staff: assign (or reassign) an athlete to a room, or null to un-assign. Server re-checks the
   coach-link and that the room is on the athlete's team (assign_athlete_room, 0101). */
export async function assignAthleteRoom(athleteId, roomId) {
  const c = sb(); if (!c || !athleteId) return { ok: false };
  try { const { error } = await c.rpc('assign_athlete_room', { p_athlete: athleteId, p_room: roomId || null }); return { ok: !error, error: error && error.message }; } catch (e) { return { ok: false, error: e && e.message }; }
}
/** Exceptions whose window covers today. Best-effort []. */
export async function fetchActiveExceptions(bookId, kind = 'team') {
  const c = sb(); if (!c || !bookId) return [];
  try {
    const t = todayISO();
    const { data, error } = await c.from('athlete_exceptions')
      .select('id,athlete_id,starts_on,ends_on,reason')
      .eq(ownerCol(kind), bookId).lte('starts_on', t).gte('ends_on', t);
    // null = FAILED. [] here means "nobody is excused", so every athlete with a real excuse
    // (injury, travel) reads as failing the standard.
    if (error) return null;
    return data || [];
  } catch { return null; }
}
export async function saveAthleteException(bookId, athleteId, startsOn, endsOn, reason, kind = 'team') {
  const c = sb(); if (!c || !bookId || !athleteId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.from('athlete_exceptions').insert({
      [ownerCol(kind)]: bookId, athlete_id: athleteId, starts_on: startsOn, ends_on: endsOn, reason: reason || null,
    });
    return error ? { ok: false, error: error.message || 'Could not mark that.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not mark that.' }; }
}
export async function endAthleteException(id) {
  const c = sb(); if (!c || !id) return false;
  try {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const { error } = await c.from('athlete_exceptions').update({ ends_on: iso(y) }).eq('id', id);
    return !error;
  } catch { return false; }
}
/* fetchMyStaffScope (Slice A) lived here and was deleted 2026-08-12 with zero callers: Slice F's
   fetchMyStaffAccess below superseded it by carrying role AND scope in one read, and every
   consumer moved at that time. It also had an unguarded `.data.user.id` that would throw on a
   signed-out client, so it was dead code with a latent crash in it. */

/* ---------------- Coach OS Slice F (0077/0078): roles + scope management ---------------- */
/** The signed-in staff member's own role + scope in ONE read: { role, scope } — scope null =
    whole team. null when not staff / offline (callers fail open on the client; the server
    walls everything regardless). */
export async function fetchMyStaffAccess(teamId) {
  const c = sb(); if (!c || !teamId) return null;
  try {
    const uid = (await c.auth.getUser()).data.user.id;
    const { data } = await c.from('team_staff').select('role,scope_kind,scope_value')
      .eq('team_id', teamId).eq('staff_id', uid).maybeSingle();
    if (!data) return null;
    return {
      role: data.role || null,
      scope: data.scope_kind ? { kind: data.scope_kind, value: data.scope_value } : null,
    };
  } catch { return null; }
}
/** Head coach sets anyone's scope; a staffer may self-declare their INITIAL narrowing only
    (0078 set_staff_scope enforces both). kind null clears back to whole team. */
export async function setStaffScope(teamId, staffId, kind, value) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.rpc('set_staff_scope', {
      p_team: teamId, p_staff: staffId, p_kind: kind || null, p_value: value || null,
    });
    return error ? { ok: false, error: error.message || 'Could not set the scope.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not set the scope.' }; }
}
/** Head coach re-roles a staff member (never the head-coach row). */
export async function setStaffRole(teamId, staffId, role) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.rpc('set_staff_role', { p_team: teamId, p_staff: staffId, p_role: role });
    if (error) return { ok: false, error: error.message || 'Could not change the role.' };
    return data === true ? { ok: true } : { ok: false, error: 'That role is locked.' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not change the role.' }; }
}

/* ---------------- Coach OS Slice B: profile helpers ---------------- */
export async function fetchCoachNotes(bookId, athleteId, kind = 'team') {
  const c = sb(); if (!c || !bookId || !athleteId) return [];
  try {
    const { data, error } = await c.from('coach_notes').select('id,author_id,body,created_at')
      .eq(ownerCol(kind), bookId).eq('athlete_id', athleteId)
      .order('created_at', { ascending: false }).limit(100);
    if (error) return null; // null = FAILED
    return data || [];
  } catch { return null; }
}
export async function postCoachNote(bookId, athleteId, body, kind = 'team') {
  const c = sb(); if (!c || !bookId || !athleteId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.from('coach_notes').insert({ [ownerCol(kind)]: bookId, athlete_id: athleteId, body });
    return error ? { ok: false, error: error.message || 'Could not save the note.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save the note.' }; }
}
export async function deleteCoachNote(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('coach_notes').delete().eq('id', id); return !error; } catch { return false; }
}
export async function fetchAthleteInterventions(bookId, athleteId, sinceISO, kind = 'team') {
  const c = sb(); if (!c || !bookId || !athleteId) return [];
  try {
    let q = c.from('coach_interventions').select('kind,reason_key,tier,note,created_at')
      .eq(ownerCol(kind), bookId).eq('athlete_id', athleteId);
    if (sinceISO) q = q.gte('day', sinceISO);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(100);
    if (error) return null; // null = FAILED (the profile marks the section, not the screen)
    return data || [];
  } catch { return null; }
}
export async function fetchAthleteAssignments(athleteId, sinceISO) {
  const c = sb(); if (!c || !athleteId) return [];
  try {
    let q = c.from('requirement_assignments').select('id,title,proof,status,due_at,created_at,note')
      .eq('athlete_id', athleteId);
    if (sinceISO) q = q.gte('created_at', sinceISO);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(60);
    if (error) return null; // null = FAILED
    return data || [];
  } catch { return null; }
}
export async function fetchMeal(mealId) {
  const c = sb(); if (!c || !mealId) return null;
  try { const { data } = await c.from('meals').select('*').eq('id', mealId).maybeSingle(); return data || null; } catch { return null; }
}

/* ---------------- photo integrity (0062) ---------------- */
/** Prior logs of this EXACT photo by the signed-in athlete (sha256 of the downscaled JPEG),
    newest first: [{ day_date, meal_type, logged_at }]. [] when clean OR when the check can't
    run (offline / pre-0062 DB) — fail OPEN here; the server's unique index is the real wall
    and insertMeal handles its 23505. */
export async function checkPhotoReuse(hash) {
  const c = sb(); if (!c || !hash) return [];
  try { const { data, error } = await c.rpc('check_photo_reuse', { p_hash: hash }); if (error) return []; return data || []; } catch { return []; }
}

/* ---------------- notify (edge fn; must allowlist file:// null origin) ---------------- */
/** Operator → athlete notification. Returns the delivery TRUTH, not a boolean: the server
 *  distinguishes a real device push from "saved to the bell only" (no token / pushes off /
 *  deduped), and the send surfaces owe the coach that distinction. Shape:
 *  { ok, pushed, deduped, suppressed, devices, rateLimited }.
 *  opts.kind: 'nudge' (default) | 'coach_comment' | 'coach_react' — comments/reactions skip
 *  the server's nudge dedupe. opts.ref: meal id, makes the athlete's bell row deep-link. */
/** Bulk operator → athletes nudge: ONE send-push call for a roster selection (scale pass
 *  2026-08-18). The server authorizes set-based (caller runs the book, targets are its active
 *  members), applies the same 2-minute dedupe and opt-out as the single path, writes the bell
 *  rows AND the coach_interventions queue-clear rows, and returns per-athlete truth:
 *  { ok, sent, inboxOnly, deduped, suppressed, dropped, results: [{athlete_id, pushed,
 *  devices, deduped?, suppressed?}], rateLimited? }.
 *  `reasons` is athleteId -> { reason_key, tier } so each intervention row can clear the
 *  coach-home queue, exactly what the old client loop stamped one insert at a time. */
export async function bulkNudgePush(athleteIds, title, body, { bookId, book = 'team', reasons } = {}) {
  const c = sb(); if (!c || !Array.isArray(athleteIds) || !athleteIds.length || !bookId) return { ok: false };
  try {
    const { data, error } = await c.functions.invoke('send-push', {
      body: { athlete_ids: athleteIds, title, body, book_id: bookId, book, ...(reasons ? { reasons } : {}) },
    });
    if (error) {
      const status = error && error.context && error.context.status;
      return { ok: false, rateLimited: status === 429 };
    }
    const d = data || {};
    return {
      ok: d.ok !== false, sent: d.sent || 0, inboxOnly: d.inboxOnly || 0,
      deduped: d.deduped || 0, suppressed: d.suppressed || 0, dropped: d.dropped || 0,
      results: Array.isArray(d.results) ? d.results : [],
    };
  } catch { return { ok: false }; }
}
export async function nudgePush(athleteId, title, body, opts = {}) {
  const c = sb(); if (!c || !athleteId) return { ok: false };
  try {
    const { data, error } = await c.functions.invoke('send-push', {
      body: {
        athlete_id: athleteId, title, body,
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(opts.ref ? { ref: opts.ref } : {}),
        ...(opts.route ? { route: opts.route } : {}),
      },
    });
    if (error) {
      // FunctionsHttpError carries the raw Response as context — a 429 is the rate limit,
      // which bulk send reports as "wait a minute", not "check your connection".
      const status = error && error.context && error.context.status;
      return { ok: false, rateLimited: status === 429 };
    }
    const d = data || {};
    return {
      ok: d.ok !== false, pushed: d.pushed || 0, deduped: !!d.deduped,
      suppressed: d.suppressed || null, devices: d.devices != null ? d.devices : null,
    };
  } catch { return { ok: false }; }
}

/** Coach OS Slice C: push-only fan-out for an already-posted announcement. The feed rows are
 *  the guaranteed delivery (written by post_announcement); this is a best-effort nudge on top —
 *  never awaited by the send flow, so a push failure can't break the compose screen. */
export async function pushAnnouncement(announcementId) {
  const c = sb(); if (!c || !announcementId) return { ok: false };
  try { const { error } = await c.functions.invoke('send-push', { body: { announcement_id: announcementId } }); return { ok: !error }; }
  catch { return { ok: false }; }
}

/** Athlete → coach notification (meal-conversation upgrade 2026-07-16): the server resolves
 *  the caller's ACTIVE coach staff from the JWT, records a durable in-app notification for
 *  each, and pushes by classification — kind 'meal_logged' stays quiet (record only),
 *  'meal_review' pushes, 'meal_action' pushes with sound. `route` deep-links the tap. */
export async function notifyMyCoach({ kind = 'meal_logged', title, body, urgent = false, route } = {}) {
  const c = sb(); if (!c || !title) return false;
  try {
    const { error } = await c.functions.invoke('send-push', {
      body: { to_coach: true, kind, title, body: body || '', urgent: !!urgent, ...(route ? { route } : {}) },
    });
    return !error;
  } catch { return false; }
}

/* ---------------- trainer mirror (practices) ---------------- */
export async function fetchMyPractices() {
  const c = sb(); if (!c) return [];
  // { error: true } sentinel on failure (see fetchMyTeams) — an outage must not read as
  // "no practices".
  try { const { data, error } = await c.from('practices').select('id,name,join_code,owner_id,handle'); if (error) return { error: true }; return data || []; } catch { return { error: true }; }
}

/** The signed-in trainer's own practice identity: real business name + real client join code.
    Owner-scoped by practices_read RLS (owner_id = auth.uid()) — no explicit filter needed, same
    pattern as every other trainer/coach read in this file. Returns null on a CONFIRMED "no
    practice row yet" (still minting) — but on a fetch failure (network/RLS error) returns
    { error: true } instead of null, so a caller can tell "nothing to show yet" apart from
    "we don't actually know" and never misreports a real outage as still-minting (mirrors
    PracticeFetchResult in src/core/practiceIdentity.ts). */
export async function fetchMyPracticeIdentity() {
  const c = sb(); if (!c) return null;
  try {
    // See fetchMyTeamIdentity: supabase-js returns { error } without throwing, so this must be
    // inspected explicitly or the { error: true } sentinel above is unreachable and Practice HQ
    // shows "Your client code is being created" forever on a flaky connection.
    // discipline (0197): 'training' | 'nutrition' — the dietitian/nutritionist lens key. Read
    // defensively so a pre-0197 DB (column missing → error) still yields the base identity.
    let data, error;
    ({ data, error } = await c.from('practices').select('id,name,join_code,owner_id,handle,discipline').limit(1).maybeSingle());
    if (error) ({ data, error } = await c.from('practices').select('id,name,join_code,owner_id,handle').limit(1).maybeSingle());
    if (error) return { error: true };
    if (!data) return null;
    return { id: data.id, name: data.name || '', code: data.join_code || '', handle: data.handle || null, discipline: data.discipline === 'nutrition' ? 'nutrition' : 'training' };
  } catch { return { error: true }; }
}

/** The CLIENT's view of their linked trainer: the active practice they joined + the trainer's real
    display name — the practice mirror of fetchMyCoach (teams) for the athlete side. Prefers the
    my_trainer() definer RPC (0063 — the only client-readable source of the trainer's NAME); falls
    OPEN to a direct practices select (practices_read RLS grants an active client the row) on a
    pre-0063 DB, which yields the practice name only. Returns null on a confirmed "no trainer link";
    { error: true } on a fetch failure. Never fabricates a persona — an unknown name is ''. */
export async function fetchMyTrainer() {
  const c = sb(); if (!c) return null;
  try {
    const { data, error } = await c.rpc('my_trainer');
    if (!error) {
      const r = Array.isArray(data) ? data[0] : data;
      if (r && r.practice_id) return { practiceId: r.practice_id, practiceName: r.practice_name || '', name: r.trainer_name || '', handle: r.handle || null };
      return null; // RPC ran and found no active link → confirmed no trainer
    }
    // RPC absent (pre-0063) or errored → fall open to the RLS-scoped practice row (name only).
    const { data: p, error: pErr } = await c.from('practices').select('id,name,handle').limit(1).maybeSingle();
    if (pErr) return { error: true };
    if (!p) return null;
    return { practiceId: p.id, practiceName: p.name || '', name: '', handle: p.handle || null };
  } catch { return { error: true }; }
}
export async function fetchPracticeRoster(practiceId) {
  const c = sb(); if (!c || !practiceId) return [];
  try {
    const { data, error } = await c.rpc('practice_roster', { practice: practiceId });
    if (error) return null; // null = FAILED, not "no clients yet" (mirrors fetchTeamRoster)
    return (data || []).map(r => ({ athlete_id: r.client_id, athlete_name: r.client_name, position: null, joined_at: r.joined_at }));
  } catch { return null; }
}
export async function pendingPracticeRequests(practiceId) {
  const c = sb(); if (!c || !practiceId) return [];
  // null = FAILED (mirrors pendingTeamRequests).
  try { const { data, error } = await c.rpc('pending_practice_requests', { practice: practiceId }); if (error) return null; return data || []; } catch { return null; }
}
export async function approveClient(practiceId, clientId) {
  const c = sb(); if (!c) return false;
  try { const { error } = await c.from('practice_clients').update({ status: 'active' }).eq('practice_id', practiceId).eq('client_id', clientId); return !error; } catch { return false; }
}
export async function declineClient(practiceId, clientId) {
  const c = sb(); if (!c) return false;
  try { const { error } = await c.from('practice_clients').delete().eq('practice_id', practiceId).eq('client_id', clientId); return !error; } catch { return false; }
}

/* ---------------- Trainer monetization wedge (0114): public page + offers + applications ----------------
   Same best-effort, RLS-scoped shape as every read above — owner_id/owns_practice is the real authz,
   so no explicit owner filter; failures fall to a null/[]/{error} sentinel and never throw. */
export async function fetchMyTrainerPage(practiceId) {
  const c = sb(); if (!c || !practiceId) return null;
  try { const { data, error } = await c.from('trainer_public_pages').select('*').eq('practice_id', practiceId).maybeSingle(); if (error) return { error: true }; return data || null; } catch { return { error: true }; }
}
export async function saveMyTrainerPage(practiceId, fields) {
  const c = sb(); if (!c || !practiceId) return { error: 'no practice' };
  try {
    const { error } = await c.from('trainer_public_pages')
      .upsert({ practice_id: practiceId, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'practice_id' });
    return { ok: !error, error: error && error.message };
  } catch (e) { return { error: String(e) }; }
}
export async function publishMyTrainerPage(practiceId, publish) {
  const c = sb(); if (!c || !practiceId) return { error: 'no practice' };
  try {
    const { data, error } = await c.rpc('publish_trainer_page', { p_practice: practiceId, p_publish: publish });
    if (error) return { error: error.message };
    return { ok: true, page: Array.isArray(data) ? data[0] : data };
  } catch (e) { return { error: String(e) }; }
}
/* Money-surface reads return { error: true } on FAILURE (network down, RPC threw) instead of a
   fabricated [] — "No payments yet." on a dead connection is a lie on the screen with dollars on
   it. The `!c` guard keeps its benign empty: that's demo/preview mode, not a failure. */
export async function fetchMyOffers(practiceId) {
  const c = sb(); if (!c || !practiceId) return [];
  try { const { data, error } = await c.from('offers').select('*').eq('practice_id', practiceId).order('sort').order('created_at'); if (error) return { error: true }; return data || []; } catch { return { error: true }; }
}
export async function saveOffer(offer) {
  const c = sb(); if (!c) return { error: 'no client' };
  try {
    const { id, ...row } = offer; row.updated_at = new Date().toISOString();
    const { error } = id ? await c.from('offers').update(row).eq('id', id) : await c.from('offers').insert(row);
    return { ok: !error, error: error && error.message };
  } catch (e) { return { error: String(e) }; }
}
export async function deleteOffer(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('offers').delete().eq('id', id); return !error; } catch { return false; }
}
export async function fetchMyApplications(practiceId) {
  const c = sb(); if (!c || !practiceId) return [];
  try { const { data, error } = await c.from('trainer_applications').select('*').eq('practice_id', practiceId).order('created_at', { ascending: false }).limit(100); if (error) return { error: true }; return data || []; } catch { return { error: true }; }
}
export async function setApplicationStatus(id, status) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('trainer_applications').update({ status }).eq('id', id); return !error; } catch { return false; }
}

/* ---------------- OnStandard Pay (0119): Connect onboarding + offer checkout + payments ----------------
   Edge functions (not RPCs — they call the Stripe API server-side) are invoked via a plain
   fetch() with the session's own bearer token, the first time the proto has needed this pattern
   (every prior server write went through supabase-js .rpc()/.from()). window.__SUPABASE carries
   the project URL the native shell injects (see supabase.js); apikey is the same anon key sb was
   built with. Every wrapper is best-effort and returns { error } on any failure — never throws. */
async function callFn(name, body) {
  const c = sb();
  const cfg = window.__SUPABASE || {};
  if (!c || !cfg.url || !cfg.anonKey) return { error: 'not configured' };
  try {
    const { data: { session } } = await c.auth.getSession();
    const token = (session && session.access_token) || cfg.anonKey;
    const res = await fetch(`${cfg.url}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return { error: out.error || `request failed (${res.status})` };
    return out;
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/* ---------------- Verified Profile (0199): the recruiter-facing public page ----------------
   All server-computed; the client only carries the athlete's intent (enable/publish/unpublish)
   and, at publish time, the card PNG the ONE share-card renderer drew — the function stores it
   where the tweet unfurler can reach it. Every wrapper returns { error } on failure, never throws. */
export async function verifiedProfileStatus() {
  return callFn('verified-profile', { action: 'status' });
}
export async function verifiedProfileEnable() {
  return callFn('verified-profile', { action: 'enable' });
}
export async function verifiedProfilePublish(cardDataUrl) {
  return callFn('verified-profile', { action: 'publish', card: cardDataUrl });
}
export async function verifiedProfileRefreshCard(cardDataUrl) {
  return callFn('verified-profile', { action: 'refresh_card', card: cardDataUrl });
}
export async function verifiedProfileUnpublish() {
  return callFn('verified-profile', { action: 'unpublish' });
}

/** Mint/resume the trainer's Stripe Connect onboarding link. Returns { url } or { error }. */
export async function startConnectOnboarding(practiceId) {
  return callFn('connect-onboarding', { practiceId });
}
/** Create a Checkout Session for an offer (destination charge). Returns { url } or { error }. */
export async function startOfferCheckout(offerId) {
  return callFn('pay-offer-checkout', { offerId });
}
/** Refund one of the trainer's own recorded payments. Returns { ok:true } or { error }. */
export async function refundOfferPayment(paymentId) {
  return callFn('refund-payment', { paymentId });
}

export async function fetchConnectStatus(practiceId) {
  const c = sb(); if (!c || !practiceId) return null;
  try { const { data, error } = await c.rpc('my_connect_status', { p_practice: practiceId }); if (error) return { error: true }; const r = Array.isArray(data) ? data[0] : data; return r || null; } catch { return { error: true }; }
}
export async function fetchPracticePayments(practiceId) {
  const c = sb(); if (!c || !practiceId) return [];
  try { const { data, error } = await c.rpc('my_practice_payments', { p_practice: practiceId, p_limit: 30 }); if (error) return { error: true }; return data || []; } catch { return { error: true }; }
}
/** The signed-in CLIENT's own connected trainer's payable offers (active Connect + active offer). */
export async function fetchMyTrainerOffers() {
  const c = sb(); if (!c) return [];
  try { const { data, error } = await c.rpc('my_trainer_offers'); if (error) return { error: true }; return data || []; } catch { return { error: true }; }
}
/** A guardian's children's trainers' payable offers (active guardianship + active client + active Connect).
 *  `{ error: true }` on failure, never `[]` — see fetchFundedPlans. */
export async function fetchFundedOffers() {
  const c = sb(); if (!c) return { error: true };
  try { const { data, error } = await c.rpc('my_funded_offers'); if (error) return { error: true }; return data || []; } catch { return { error: true }; }
}
/** The guardian's own funded plans (for the Funded plans list).
 *  **Money reads return `{ error: true }`, never `[]`.** This returned [] on any failure, so a
 *  parent whose card is charged every month was shown "No funded plans yet" the moment the
 *  request dropped — the app disowning a live subscription. Same rule the coach/trainer money
 *  surfaces were put on 2026-08-08; these two were missed then. */
export async function fetchFundedPlans() {
  const c = sb(); if (!c) return { error: true };
  try { const { data, error } = await c.rpc('my_funded_plans', { p_limit: 50 }); if (error) return { error: true }; return data || []; } catch { return { error: true }; }
}
/** Start Checkout for an offer on behalf of a child. Returns { url } or { error }. */
export async function startFundedCheckout(offerId, beneficiaryAthleteId) {
  return callFn('pay-offer-checkout', { offerId, beneficiaryAthleteId });
}
/** Cancel a recurring funded plan (by an offer_payments row id). Returns { ok:true } or { error }. */
export async function cancelFundedSubscription(paymentId) {
  return callFn('cancel-offer-subscription', { paymentId });
}

/** Generate/fetch the athlete's monthly report. Returns the report object or { error }. */
export async function fetchMonthlyReport(period, data) {
  return callFn('monthly-report', { period, data });
}

/** Open a Stripe-hosted URL (Connect onboarding, Checkout) in the SYSTEM browser via the native
 *  bridge — never navigate this WebView itself into it (see bridge.ts OPEN_URL for why). Falls
 *  back to window.open for a plain-browser dev/preview session where the bridge doesn't exist. */
export function openExternal(url) {
  if (!url) return;
  if (window.OnStandardNative && window.OnStandardNative.openUrl) window.OnStandardNative.openUrl(url);
  else window.open(url, '_blank');
}

/** Sponsor: start a Stripe checkout for N premium seats. Returns { url } or { error }. */
export async function startSponsorCheckout(seats, label) { return callFn('sponsor-checkout', { seats, label }); }
/** Sponsor: my purchased seat batches (code + claimed count). */
export async function fetchMySponsorships() {
  const c = sb(); if (!c) return [];
  // null = FAILED — money surface: "No sponsorships yet, buy a batch above" must never be
  // shown to someone whose purchased seats just didn't load.
  try { const { data, error } = await c.from('sponsorships').select('*').order('created_at', { ascending: false }).limit(100); if (error) return null; return data || []; } catch { return null; }
}
/** Athlete: redeem a sponsor code. Returns the RPC row { ok, reason, label, expires_at } or { error }. */
export async function redeemSponsorCode(code) {
  const c = sb(); if (!c) return { error: 'not configured' };
  try { const { data, error } = await c.rpc('redeem_sponsor_code', { p_code: code }); if (error) return { error: error.message }; return Array.isArray(data) ? data[0] : data; }
  catch (e) { return { error: String((e && e.message) || e) }; }
}
/** Athlete: redeem a trainer claim code (0166) from a pay-first purchase. Connects them to the
 *  practice AND turns on premium in one transaction. Row: { ok, reason, trainer_name, expires_at }. */
export async function redeemOfferCode(code) {
  const c = sb(); if (!c) return { error: 'not configured' };
  try { const { data, error } = await c.rpc('redeem_offer_code', { p_code: code }); if (error) return { error: error.message }; return Array.isArray(data) ? data[0] : data; }
  catch (e) { return { error: String((e && e.message) || e) }; }
}
/** Which source is paying for this athlete's premium: 'subscription' | 'trainer' | 'sponsor' | 'none'.
 *  The billing screen can't derive this locally — sponsor and trainer grants live in their own
 *  tables, which is exactly why the screen used to say "Free" to someone who had premium. */
export async function myPremiumSource() {
  const c = sb(); if (!c) return 'none';
  // null = FAILED; 'none' = the server confirmed no premium source. Same entitlement lie as
  // fetchMySubscription when collapsed.
  try { const { data, error } = await c.rpc('my_premium_source'); if (error) return null; return data || 'none'; }
  catch { return null; }
}
/** Operator: the funded roster for a practice — who's covered, when they renew, who lapsed. */
export async function fetchFundedClients(practiceId) {
  const c = sb(); if (!c || !practiceId) return [];
  try { const { data, error } = await c.rpc('my_funded_clients', { p_practice: practiceId }); if (error) return { error: true }; return data || []; }
  catch { return { error: true }; }
}
/** Operator: people who PAID from the public page and never redeemed their code (0167). They are
 *  being billed for an app they can't open, and the trainer is the one who can actually fix it. */
export async function fetchPendingClaims(practiceId) {
  const c = sb(); if (!c || !practiceId) return [];
  try { const { data, error } = await c.rpc('my_pending_claims', { p_practice: practiceId }); if (error) return { error: true }; return data || []; }
  catch { return { error: true }; }
}

/* ---------------- consumer subscription (App Store / Play IAP via RevenueCat) ----------------
   The native store rail. `iapAvailable()` is false in a browser/preview session and until the
   founder wires react-native-purchases (src/lib/iap) — the paywall stays honest either way. */

/** Whether the native store paywall can transact right now. */
export async function iapAvailable() {
  try {
    if (window.OnStandardNative && window.OnStandardNative.iap) return !!(await window.OnStandardNative.iap.available());
  } catch { /* bridge missing / preview */ }
  return false;
}

/** Present the store purchase sheet for a product id. appUserId MUST be the profile UUID so the
    RevenueCat webhook can attribute the subscription. Returns { ok:true } | { ok:false, reason, message }. */
export async function purchaseConsumerPlan(productId, appUserId) {
  try {
    if (window.OnStandardNative && window.OnStandardNative.iap) return await window.OnStandardNative.iap.purchase(productId, appUserId);
  } catch (e) { return { ok: false, reason: 'error', message: String((e && e.message) || e) }; }
  return { ok: false, reason: 'unavailable' };
}

/** Restore a prior store purchase (Apple requires this). Same result shape as purchase. */
export async function restoreConsumerPurchases(appUserId) {
  try {
    if (window.OnStandardNative && window.OnStandardNative.iap) return await window.OnStandardNative.iap.restore(appUserId);
  } catch (e) { return { ok: false, reason: 'error', message: String((e && e.message) || e) }; }
  return { ok: false, reason: 'unavailable' };
}

/** The caller's own subscription row for the Plan & billing screen (owner-RLS). Selects only
    columns present since 0042, so it's safe whether or not the consumer-IAP migration 0102 is live.
    Returns { tier, status, plan_id, current_period_end, cancel_at_period_end } | null. */
export async function fetchMySubscription() {
  const c = sb(); if (!c) return null;
  try {
    const { data: u } = await c.auth.getUser();
    const uid = u && u.user && u.user.id;
    if (!uid) return null;
    const { data, error } = await c.from('subscriptions')
      .select('tier,status,plan_id,current_period_end,cancel_at_period_end')
      .eq('owner_id', uid).maybeSingle();
    // { error:true } = FAILED; null = confirmed no row. Collapsing them told a paying user
    // "You have the free plan" whenever the read dropped.
    if (error) return { error: true };
    return data || null;
  } catch { return { error: true }; }
}

/* ---------------- pure roster projection (honest: no invented numbers) ---------------- */
export function tierFlag(score) { const b = scoreBand(score); return b ? BAND_FLAG[b] : ''; }
/** Merge a roster member (from the RPC) with today's real day row into a UI row.
    A member with no day row today is honestly "No logs today" — never a made-up score. */
export function buildRosterRow(member, dayRow, extras = {}) {
  const name = member.athlete_name || 'Athlete';
  const logged = !!dayRow;
  const score = logged && dayRow.score != null ? dayRow.score : null;
  const tasks = (dayRow && Array.isArray(dayRow.tasks)) ? dayRow.tasks : [];
  const done = tasks.filter(t => t && t.done).length;
  return {
    athleteId: member.athlete_id,
    name, unit: member.position || '', position: member.position || '',
    // Assigned room (0101), or null when unassigned. Drives room-scoped standard resolution in the
    // coach view + Needs-Assignment; null = the athlete resolves by raw position (parity).
    roomId: member.room_id || null,
    score, loggedToday: logged,
    flag: logged ? tierFlag(score) : 'r',
    logs: logged && tasks.length ? `${done}/${tasks.length}` : (logged ? 'Logged' : '—'),
    note: logged
      ? (score != null ? (score >= 80 ? 'On standard today' : 'Logged · below the bar') : 'Logged today')
      : 'No logs today',
    tasks,
    scoreHistory: extras.scoreHistory || [],
    lastMealAt: extras.lastMealAt || null,
    // Athlete IANA timezone (0088) so the coach status engine judges due/overdue in the athlete's
    // local day. null (no set, or pre-migration) → the caller falls back to the coach clock.
    timezone: extras.timezone || null,
  };
}

/** Distinct athlete ids across a book's member lists, in first-seen order. */
function athleteIdsOf(perBook) {
  const seen = new Set(); const ids = [];
  for (const members of perBook) for (const m of members) {
    if (m && m.athlete_id && !seen.has(m.athlete_id)) { seen.add(m.athlete_id); ids.push(m.athlete_id); }
  }
  return ids;
}

/** PURE projection shared by both books: members + day rows + recent meals + timezones → sorted UI
    rows. No fetches, so each loader keeps its own parallelism. A coach's team book and a trainer's
    practice book differ only in which RPC produced `perBook` — every downstream engine (status,
    priority, inbox) then reads the same row shape. */
function projectRows(perBook, days, recentMeals, tzByAthlete) {
  const today = todayISO();
  const dayByAthlete = {}, histByAthlete = {}, lastMealBy = {};
  for (const d of (days || [])) {
    if (d.date === today) dayByAthlete[d.athlete_id] = d;
    (histByAthlete[d.athlete_id] = histByAthlete[d.athlete_id] || []).push({ date: d.date, score: d.score });
  }
  for (const h of Object.values(histByAthlete)) h.sort((a, b) => a.date < b.date ? -1 : 1);
  for (const m of (recentMeals || [])) {
    if (!lastMealBy[m.athlete_id] || m.logged_at > lastMealBy[m.athlete_id]) lastMealBy[m.athlete_id] = m.logged_at;
  }
  const seen = new Set(); const rows = [];
  for (const members of perBook) {
    for (const m of members) {
      if (seen.has(m.athlete_id)) continue; seen.add(m.athlete_id);
      rows.push(buildRosterRow(m, dayByAthlete[m.athlete_id], {
        scoreHistory: histByAthlete[m.athlete_id] || [],
        lastMealAt: lastMealBy[m.athlete_id] || null,
        timezone: (tzByAthlete || {})[m.athlete_id] || null,
      }));
    }
  }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return rows;
}

/** Full coach roster: teams → members (RPC) → merged with today's linked day rows.
 *  The roster resolves FIRST, then days/meals/timezones read in parallel scoped to those
 *  athlete ids — not because it changes the roster's own cost, but because fetchLinkedDaysSince
 *  and fetchTeamActivity can only use their existing indexes when they know which athletes to
 *  ask for (capacity audit F4/F6). The old ordering (roster + unscoped days/meals in parallel,
 *  timezones after) ran the two expensive unscoped scans BEFORE the ids that would have scoped
 *  them were even available. */
export async function loadCoachRoster() {
  const teams = await fetchMyTeams();
  if (teams.error) throw new Error('roster-fetch-failed'); // caller renders honest offline
  if (!teams.length) return { teams: [], rows: [] };
  const perTeam = await Promise.all(teams.map(t => fetchTeamRoster(t.id)));
  // A failed roster read (null) must land in the same offline branch as a failed teams read:
  // rows=[] here painted "No athletes yet — share your code" over a real roster.
  if (perTeam.some(r => r === null)) throw new Error('roster-fetch-failed');
  const athleteIds = athleteIdsOf(perTeam);
  const [days, recentMeals, tzByAthlete] = await Promise.all([
    fetchLinkedDaysSince(daysAgoISO(7), athleteIds),
    fetchTeamActivity(daysAgoISO(2), 400, athleteIds),
    // Athlete timezones (0088) so coach "overdue"/"due soon" is judged in each athlete's local
    // day. Best-effort: a pre-migration DB or missing tz leaves the map empty and every row uses
    // the coach clock (today's behavior).
    fetchProfileTimezones(athleteIds),
  ]);
  // days === null means the day read FAILED — projecting it would flag every athlete
  // "No logs today" (red) and feed the nudge queue a roster of fabricated delinquents.
  if (days === null) throw new Error('roster-fetch-failed');
  return { teams, rows: projectRows(perTeam, days, recentMeals, tzByAthlete) };
}

/** Trainer book: practices → clients (RPC) → merged with today's linked day rows.
    Identical depth to the coach roster above — 7 days of history (sparklines), recent meals
    (staleness), and timezones. Every one of those reads is `can_view`-scoped (0081 includes
    is_trainer_of), so parity here needs no server change. Same roster-first ordering as
    loadCoachRoster, for the same reason (capacity audit F4/F6). */
export async function loadTrainerBook() {
  const practices = await fetchMyPractices();
  if (practices.error) throw new Error('book-fetch-failed'); // caller renders honest offline
  if (!practices.length) return { practices: [], rows: [] };
  const perPractice = await Promise.all(practices.map(p => fetchPracticeRoster(p.id)));
  if (perPractice.some(r => r === null)) throw new Error('book-fetch-failed');
  const athleteIds = athleteIdsOf(perPractice);
  const [days, recentMeals, tzByAthlete] = await Promise.all([
    fetchLinkedDaysSince(daysAgoISO(7), athleteIds),
    fetchTeamActivity(daysAgoISO(2), 400, athleteIds),
    fetchProfileTimezones(athleteIds),
  ]);
  if (days === null) throw new Error('book-fetch-failed');
  return { practices, rows: projectRows(perPractice, days, recentMeals, tzByAthlete) };
}

/* ---------------- Slice E team insights reads (0076); practice mirror (0137) ---------------- */
export async function fetchTeamDayRollup(bookId, fromISO, toISO, kind = 'team') {
  const c = sb(); if (!c || !bookId) return [];
  const practice = kind === 'practice';
  try {
    const { data, error } = await c.rpc(practice ? 'practice_day_rollup' : 'team_day_rollup',
      practice ? { p_practice: bookId, p_from: fromISO, p_to: toISO } : { p_team: bookId, p_from: fromISO, p_to: toISO });
    // null = FAILED. [] made a failed week read indistinguishable from "not enough history yet",
    // which is what kept coach-insights' own offline branch unreachable.
    if (error) return null;
    return data || [];
  } catch { return null; }
}
export async function fetchInterventionOutcomes(bookId, fromISO, kind = 'team') {
  const c = sb(); if (!c || !bookId) return [];
  const practice = kind === 'practice';
  try {
    const { data, error } = await c.rpc(practice ? 'practice_intervention_outcomes' : 'team_intervention_outcomes',
      practice ? { p_practice: bookId, p_from: fromISO } : { p_team: bookId, p_from: fromISO });
    if (error) return null; // null = FAILED (mirrors fetchTeamDayRollup)
    return data || [];
  } catch { return null; }
}

/* ---------------- Athlete memory (0019) ----------------
   What the athlete's corrections teach the AI about them. RLS `mem_self` gives an athlete full
   control of their own rows, so these are plain client writes — no RPC needed. Every call is
   best-effort and never throws: memory is an enhancement, and a failure here must never break a
   correction the athlete just made. */

/** Active + pending facts for the signed-in athlete. null = FAILED — state.js uses this list
    to dedupe before inserting, and a fabricated [] creates duplicate facts. */
export async function fetchMyMemoryFacts(uid) {
  const c = sb(); if (!c || !uid) return [];
  try {
    const { data, error } = await c.from('athlete_memory_facts')
      .select('id,kind,value,confidence,evidence_n,status')
      .eq('athlete_id', uid).in('status', ['active', 'pending_confirmation']).limit(120);
    if (error) return null;
    return data || [];
  } catch { return null; }
}

/** Insert a new fact, or accrue evidence on the one that already says the same thing. */
export async function upsertMemoryFact(uid, fact, existing) {
  const c = sb(); if (!c || !uid || !fact) return false;
  try {
    if (existing && existing.id) {
      const { error } = await c.from('athlete_memory_facts').update({
        evidence_n: (Number(existing.evidence_n) || 1) + 1,
        confidence: Math.min(1, (Number(existing.confidence) || 0.3) + 0.15),
        last_seen: new Date().toISOString(),
      }).eq('id', existing.id).eq('athlete_id', uid);
      return !error;
    }
    const { error } = await c.from('athlete_memory_facts').insert({
      athlete_id: uid, kind: fact.kind, value: fact.value,
      confidence: fact.confidence == null ? 0.3 : fact.confidence,
      source: fact.source || 'inferred_correction',
      evidence_n: fact.evidence_n || 1, status: fact.status || 'pending_confirmation',
    });
    return !error;
  } catch { return false; }
}

/** The athlete confirming or rejecting a pending fact. This is the only thing that makes an
 *  inferred safety fact bind. */
export async function setMemoryFactStatus(uid, id, status) {
  const c = sb(); if (!c || !uid || !id) return false;
  try {
    const { error } = await c.from('athlete_memory_facts')
      .update({ status, last_seen: new Date().toISOString() })
      .eq('id', id).eq('athlete_id', uid);
    return !error;
  } catch { return false; }
}

/* ---------------- billing (Stripe rail) ---------------- */

/**
 * Open a Stripe Checkout for a pro/org plan. Returns:
 *   { ok: true,  url }              — send the user to Stripe (native: openUrl; web: location)
 *   { ok: false, action: 'portal' } — already subscribed; plan changes belong in the portal
 *   { ok: false, error }            — honest failure copy
 * The server owns everything that matters (price lookup by generation, the 14-day trial, the
 * duplicate-subscription guard, founding locks) — this passes intent and relays the answer.
 */
export async function startPlanCheckout(planId, cadence = 'annual') {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    // camelCase `planId` — the server's contract since day one (billing-checkout reads
    // body.planId). The first draft sent snake_case and every real purchase died with
    // "unknown or non-Stripe plan"; caught by the paywall E2E, kept as a named test.
    const { data, error } = await c.functions.invoke('billing-checkout', {
      body: { planId, cadence },
    });
    if (error) {
      // supabase-js wraps non-2xx; the 409 duplicate guard rides in the response body.
      const body = await (async () => { try { return await error.context?.json?.(); } catch { return null; } })();
      if (body?.action === 'portal') return { ok: false, action: 'portal' };
      return { ok: false, error: body?.error || 'Checkout is not available right now.' };
    }
    if (data?.action === 'portal') return { ok: false, action: 'portal' };
    if (data?.url) return { ok: true, url: data.url };
    return { ok: false, error: data?.error || 'Checkout is not available right now.' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Checkout is not available right now.' }; }
}

/** Open the Stripe billing portal (plan changes, cards, invoices). Same contract as above. */
export async function openBillingPortal() {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.functions.invoke('billing-portal', { body: {} });
    if (error) return { ok: false, error: 'The billing portal is not available right now.' };
    return data?.url ? { ok: true, url: data.url } : { ok: false, error: 'The billing portal is not available right now.' };
  } catch { return { ok: false, error: 'The billing portal is not available right now.' }; }
}

/** Founding 50 slots remaining (0163), or null when unknowable. Display-only. */
export async function foundingSlotsLeft() {
  const c = sb(); if (!c) return null;
  try {
    const { data, error } = await c.rpc('founding_slots_left');
    return error ? null : (Number.isFinite(Number(data)) ? Number(data) : null);
  } catch { return null; }
}

/** This month's active-athlete count for the signed-in owner (0163). Null when unknowable. */
export async function myActiveAthleteCount() {
  const c = sb(); if (!c) return null;
  try {
    const { data, error } = await c.rpc('my_active_athlete_count');
    return error ? null : (Number.isFinite(Number(data)) ? Number(data) : null);
  } catch { return null; }
}

/* ---------------- support / feedback intake (0125 + 0162) ---------------- */

/**
 * File a support ticket. Returns the new ticket id.
 *
 * THROWS on failure, unlike most helpers in this file, and deliberately: the caller has a person
 * waiting who just typed something they cared enough to send, and the server's own message is the
 * useful one ('rate limit…', 'invalid category', 'subject too short'). Swallowing it into a false
 * would make every failure look identical and cost the 'idea' fallback its signal.
 *
 * All validation, the 5/hour rate limit, and the rule that a safety report becomes 'urgent' live in
 * the RPC — never here. The client is not trusted to set priority.
 */
export async function createSupportTicket(category, subject, body) {
  const c = sb();
  if (!c) throw new Error('You need a connection to send this.');
  const { data, error } = await c.rpc('create_support_ticket', {
    p_category: category, p_subject: subject, p_body: body || '',
  });
  if (error) throw new Error(error.message || 'Could not send that.');
  return data || null;
}

/* ================================================================ Coach Marketplace (0183–0186)
 * The marketplace ships dark: marketplace_flags() is the ONLY switch the proto trusts (the WebView
 * has no feature-flags channel), and every server RPC re-checks it — hiding UI is courtesy, not
 * enforcement. Flags are cached per session; call with force after actions that change them. */
let MKT_FLAGS = null;
export async function fetchMarketplaceFlags(force) {
  if (MKT_FLAGS && !force) return MKT_FLAGS;
  const c = sb(); if (!c) return { enabled: false, can_hire: false };
  try {
    const { data, error } = await c.rpc('marketplace_flags');
    if (error) return { enabled: false, can_hire: false };
    MKT_FLAGS = data || { enabled: false, can_hire: false };
    return MKT_FLAGS;
  } catch { return { enabled: false, can_hire: false }; }
}
export async function fetchMarketplaceDirectory(filters = {}) {
  const c = sb(); if (!c) return [];
  try {
    const { data, error } = await c.rpc('marketplace_directory', {
      p_category: filters.category || null, p_max_price_cents: filters.maxPriceCents || null,
      p_style: filters.style || null, p_tz: filters.tz || null,
    });
    if (error) return null; // null = FAILED, so "No coaches match" stays a real answer
    return data || [];
  } catch { return null; }
}
/** A public coach listing by slug. `null` = the RPC ran and there is no such listing;
 *  `{ error: true }` = we could not find out. They were the same value, and the screen turns
 *  `null` into "This coach is not available — they may be at capacity or no longer taking
 *  clients", which is a claim about a real person's business invented from a dropped request. */
export async function fetchMarketplaceListing(slug) {
  const c = sb(); if (!c || !slug) return { error: true };
  try { const { data, error } = await c.rpc('marketplace_listing', { p_slug: slug }); if (error) return { error: true }; return data || null; } catch { return { error: true }; }
}
/** Hire: Stripe Checkout for a tier offer. Returns { url } or { error }. */
export async function startMarketplaceCheckout(offerId) {
  return callFn('marketplace-checkout', { offerId });
}
/** Coach side: my application (+ credentials + listing pointer). null = confirmed never
    started; { error:true } = FAILED — collapsing them rendered the blank application form
    to an already-approved coach and invited a duplicate submission. */
export async function fetchMyCoachApplication() {
  const c = sb(); if (!c) return null;
  try { const { data, error } = await c.rpc('my_coach_application'); if (error) return { error: true }; return data || null; } catch { return { error: true }; }
}
export async function saveCoachApplication(payload) {
  const c = sb(); if (!c) return { error: 'not configured' };
  try { const { data, error } = await c.rpc('save_coach_application', { p: payload }); if (error) return { error: error.message }; return data || {}; }
  catch (e) { return { error: String((e && e.message) || e) }; }
}
export async function submitCoachApplication() {
  const c = sb(); if (!c) return { error: 'not configured' };
  try { const { data, error } = await c.rpc('submit_coach_application'); if (error) return { error: error.message }; return data || {}; }
  catch (e) { return { error: String((e && e.message) || e) }; }
}
/** Upload a credential document into the applicant's own folder, then record the row. */
export async function uploadCredential(applicationId, category, title, file) {
  const c = sb(); if (!c) return { error: 'not configured' };
  try {
    const { data: u } = await c.auth.getUser();
    const uid = u && u.user && u.user.id; if (!uid) return { error: 'sign in required' };
    const path = `${uid}/${Date.now()}-${(file.name || 'credential').replace(/[^a-zA-Z0-9.-]+/g, '_')}`;
    const { error: upErr } = await c.storage.from('coach-credentials').upload(path, file);
    if (upErr) return { error: upErr.message };
    const { error } = await c.from('coach_credentials').insert({
      application_id: applicationId, user_id: uid, category, title: title || '', doc_path: path,
    });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) { return { error: String((e && e.message) || e) }; }
}
/** The coach's own listing row (own-row RLS) — null until approved; { error:true } = FAILED
    (a dropped read must not tell a published coach they have no listing). */
export async function fetchMyListing() {
  const c = sb(); if (!c) return null;
  try { const { data, error } = await c.from('coach_listings').select('*').maybeSingle(); if (error) return { error: true }; return data || null; } catch { return { error: true }; }
}
/** Presentation fields + publish only — categories/suspended/slug are not grant-writable. */
export async function updateMyListing(patch) {
  const c = sb(); if (!c) return { error: 'not configured' };
  const allowed = ['display_name', 'headline', 'bio', 'style_tags', 'languages', 'timezone', 'capacity', 'published'];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  clean.updated_at = new Date().toISOString();
  try {
    const { data: u } = await c.auth.getUser();
    const uid = u && u.user && u.user.id; if (!uid) return { error: 'sign in required' };
    const { error } = await c.from('coach_listings').update(clean).eq('user_id', uid);
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) { return { error: String((e && e.message) || e) }; }
}
export async function setListingTierPrices(prices) {
  const c = sb(); if (!c) return { error: 'not configured' };
  try { const { error } = await c.rpc('set_listing_tier_prices', { p: prices }); if (error) return { error: error.message }; return { ok: true }; }
  catch (e) { return { error: String((e && e.message) || e) }; }
}
/** Safety intake: report a marketplace coach. Reasons: scope|conduct|solicitation|spam|other. */
export async function submitCoachReport(practiceId, reason, detail) {
  const c = sb(); if (!c) return { error: 'not configured' };
  try {
    const { data: u } = await c.auth.getUser();
    const uid = u && u.user && u.user.id; if (!uid) return { error: 'sign in required' };
    const { error } = await c.from('coach_reports').insert({
      reporter_id: uid, practice_id: practiceId, reason, detail: detail || '',
    });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) { return { error: String((e && e.message) || e) }; }
}

export { cap };
