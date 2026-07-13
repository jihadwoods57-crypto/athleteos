/* Proto role data layer — mirrors the RN `db.*` seam (src/lib/supabase/queries.ts).
   supabase-js runs inside the WebView; RLS is the real authz, so these are plain selects/RPCs
   with NO explicit coach-id filter — the server's can_view() scopes rows to linked athletes.

   Every call is best-effort: on a missing client, a not-applied table/RPC, or any error it
   returns []/null so role screens render an HONEST empty state, never a fabricated one.
   No new endpoints — the exact tables/RPCs the RN app already uses. */

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
  try { const { data } = await c.rpc('team_roster', { team: teamId }); return data || []; } catch { return []; }
}
export async function fetchLinkedDaysSince(sinceISO) {
  const c = sb(); if (!c) return [];
  try { const { data } = await c.from('days').select('athlete_id,date,score,grade,tasks').gte('date', sinceISO).limit(2000); return data || []; } catch { return []; }
}
export async function pendingTeamRequests(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try { const { data } = await c.rpc('pending_team_requests', { team: teamId }); return data || []; } catch { return []; }
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
    const { data } = await c.from('guardian_consent_requests')
      .select('status,guardian_email,requested_at').eq('athlete_id', athleteId)
      .order('requested_at', { ascending: false }).limit(1).maybeSingle();
    if (!data) return { status: 'none', guardianEmail: null };
    return { status: data.status || 'pending', guardianEmail: data.guardian_email || null };
  } catch { return { error: true }; }
}

/** Ask a parent/guardian for consent (0008 RPC: creates/refreshes the request row + token;
    the service-role verify endpoint flips it to verified). Returns { ok, error? }. */
export async function requestGuardianConsent(email) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.rpc('request_guardian_consent', { guardian_email: email });
    return error ? { ok: false, error: error.message } : { ok: true };
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
    const { data } = await c.from('teams').select('id,name,join_code').limit(1).maybeSingle();
    if (!data) return null;
    return { id: data.id, name: data.name || '', code: data.join_code || '' };
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

/* ---------------- coach → athlete review ---------------- */
export async function fetchDay(athleteId, date) {
  const c = sb(); if (!c || !athleteId) return null;
  try { const { data } = await c.from('days').select('*').eq('athlete_id', athleteId).eq('date', date).maybeSingle(); return data || null; } catch { return null; }
}
export async function fetchRecentMeals(athleteId, sinceISO) {
  const c = sb(); if (!c || !athleteId) return [];
  try {
    const { data } = await c.from('meals').select('*').eq('athlete_id', athleteId).gte('day_date', sinceISO).order('day_date', { ascending: false }).order('logged_at', { ascending: true });
    return data || [];
  } catch { return []; }
}
export async function signedMealPhotoUrl(path) {
  const c = sb(); if (!c || !path) return null;
  try { const { data } = await c.storage.from('meal-photos').createSignedUrl(path, 3600); return (data && data.signedUrl) || null; } catch { return null; }
}
/** The ATHLETE side of the 0043 receipt loop: who actually opened MY day. RLS
    (coach_views_read) scopes rows to athlete_id = auth.uid() or the viewer's own receipts;
    the explicit athlete_id filter keeps a coach's client from pulling receipts they wrote
    about other athletes through this athlete-facing helper. Best-effort []. */
export async function fetchMyDayReceipts(athleteId, date) {
  const c = sb(); if (!c || !athleteId || !date) return [];
  try {
    const { data } = await c.from('coach_views')
      .select('viewer_name,seen_at').eq('athlete_id', athleteId).eq('date', date)
      .order('seen_at', { ascending: false }).limit(8);
    return data || [];
  } catch { return []; }
}

export async function markDayViewed(athleteId, date, viewerId, viewerName) {
  const c = sb(); if (!c || !athleteId || !viewerId) return;
  try { await c.from('coach_views').upsert({ athlete_id: athleteId, viewer_id: viewerId, date, viewer_name: viewerName || null, seen_at: new Date().toISOString() }, { onConflict: 'athlete_id,viewer_id,date' }); } catch { /* best-effort receipt */ }
}

/* ---------------- meal comments (the real coach↔athlete thread) ---------------- */
/** Returns the meal's comment thread, oldest→newest — or the {error:true} sentinel (same
    pattern as fetchMyTeams) on a supabase {error} or thrown fetch, so an outage is never
    mistaken for "no replies yet". */
export async function fetchMealComments(mealId) {
  const c = sb(); if (!c || !mealId) return [];
  try { const { data, error } = await c.from('meal_comments').select('*').eq('meal_id', mealId).order('created_at', { ascending: true }).limit(200); if (error) return { error: true }; return data || []; } catch { return { error: true }; }
}
export async function postMealComment(mealId, athleteId, authorId, role, text, kind = 'message') {
  const c = sb(); if (!c || !mealId || !authorId) return false;
  try {
    const row = { meal_id: mealId, athlete_id: athleteId, author_id: authorId, role, text };
    if (kind !== 'message') row.kind = kind;
    const { error } = await c.from('meal_comments').insert(row);
    if (!error) return true;
    // pre-0049 DB: retry without kind so plain messages still post
    if (kind === 'message') return false;
    const { error: e2 } = await c.from('meal_comments').insert({ meal_id: mealId, athlete_id: athleteId, author_id: authorId, role, text });
    return !e2;
  } catch { return false; }
}

/* ---------------- coach: targets / trust pass (RPCs) ---------------- */
export async function fetchAthleteTargets(athleteId) {
  const c = sb(); if (!c || !athleteId) return null;
  try { const { data } = await c.from('athlete_profiles').select('targets').eq('athlete_id', athleteId).maybeSingle(); return (data && data.targets) || null; } catch { return null; }
}
export async function coachSetGoals(athleteId, targets) {
  const c = sb(); if (!c || !athleteId) return false;
  try { const { error } = await c.rpc('coach_set_goals', { athlete: athleteId, new_targets: targets, new_season_goal: null }); return !error; } catch { return false; }
}
export async function fetchActiveTrustPass(athleteId) {
  const c = sb(); if (!c || !athleteId) return null;
  try { const { data } = await c.from('trust_passes').select('granted_date,length_days').eq('athlete_id', athleteId).is('ended_at', null).maybeSingle(); return data || null; } catch { return null; }
}
export async function grantTrustPass(athleteId, lengthDays) {
  const c = sb(); if (!c || !athleteId) return { ok: false };
  try { const { error } = await c.rpc('grant_trust_pass', { p_athlete: athleteId, p_length: lengthDays || 10 }); return { ok: !error, error: error && error.message }; } catch (e) { return { ok: false, error: e && e.message }; }
}
export async function endTrustPass(athleteId) {
  const c = sb(); if (!c || !athleteId) return false;
  try { const { error } = await c.rpc('end_trust_pass', { p_athlete: athleteId }); return !error; } catch { return false; }
}

/* ---------------- notify (edge fn; must allowlist file:// null origin) ---------------- */
export async function nudgePush(athleteId, title, body) {
  const c = sb(); if (!c || !athleteId) return false;
  try { const { error } = await c.functions.invoke('send-push', { body: { athlete_id: athleteId, title, body } }); return !error; } catch { return false; }
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
    const { data } = await c.from('practices').select('id,name,join_code,owner_id,handle').limit(1).maybeSingle();
    if (!data) return null;
    return { id: data.id, name: data.name || '', code: data.join_code || '', handle: data.handle || null };
  } catch { return { error: true }; }
}
export async function fetchPracticeRoster(practiceId) {
  const c = sb(); if (!c || !practiceId) return [];
  try {
    const { data } = await c.rpc('practice_roster', { practice: practiceId });
    return (data || []).map(r => ({ athlete_id: r.client_id, athlete_name: r.client_name, position: null, joined_at: r.joined_at }));
  } catch { return []; }
}
export async function pendingPracticeRequests(practiceId) {
  const c = sb(); if (!c || !practiceId) return [];
  try { const { data } = await c.rpc('pending_practice_requests', { practice: practiceId }); return data || []; } catch { return []; }
}
export async function approveClient(practiceId, clientId) {
  const c = sb(); if (!c) return false;
  try { const { error } = await c.from('practice_clients').update({ status: 'active' }).eq('practice_id', practiceId).eq('client_id', clientId); return !error; } catch { return false; }
}
export async function declineClient(practiceId, clientId) {
  const c = sb(); if (!c) return false;
  try { const { error } = await c.from('practice_clients').delete().eq('practice_id', practiceId).eq('client_id', clientId); return !error; } catch { return false; }
}

/* ---------------- pure roster projection (honest: no invented numbers) ---------------- */
export function tierFlag(score) { return score == null ? '' : score >= 80 ? 'g' : score >= 60 ? 'y' : 'r'; }
/** Merge a roster member (from the RPC) with today's real day row into a UI row.
    A member with no day row today is honestly "No logs today" — never a made-up score. */
export function buildRosterRow(member, dayRow) {
  const name = member.athlete_name || 'Athlete';
  const logged = !!dayRow;
  const score = logged && dayRow.score != null ? dayRow.score : null;
  const tasks = (dayRow && Array.isArray(dayRow.tasks)) ? dayRow.tasks : [];
  const done = tasks.filter(t => t && t.done).length;
  return {
    athleteId: member.athlete_id,
    name, unit: member.position || '',
    score, loggedToday: logged,
    flag: logged ? tierFlag(score) : 'r',
    logs: logged && tasks.length ? `${done}/${tasks.length}` : (logged ? 'Logged' : '—'),
    note: logged
      ? (score != null ? (score >= 80 ? 'On standard today' : 'Logged · below the bar') : 'Logged today')
      : 'No logs today',
  };
}

/** Full coach roster: teams → members (RPC) → merged with today's linked day rows. */
export async function loadCoachRoster() {
  const teams = await fetchMyTeams();
  if (teams.error) throw new Error('roster-fetch-failed'); // caller renders honest offline
  if (!teams.length) return { teams: [], rows: [] };
  const [perTeam, days] = await Promise.all([
    Promise.all(teams.map(t => fetchTeamRoster(t.id))),
    fetchLinkedDaysSince(daysAgoISO(1)),
  ]);
  const today = todayISO();
  const dayByAthlete = {};
  for (const d of days) { if (d.date === today) dayByAthlete[d.athlete_id] = d; }
  const seen = new Set(); const rows = [];
  for (const members of perTeam) {
    for (const m of members) {
      if (seen.has(m.athlete_id)) continue; seen.add(m.athlete_id);
      rows.push(buildRosterRow(m, dayByAthlete[m.athlete_id]));
    }
  }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { teams, rows };
}

/** Trainer book: practices → clients (RPC) → merged with today's linked day rows. */
export async function loadTrainerBook() {
  const practices = await fetchMyPractices();
  if (practices.error) throw new Error('book-fetch-failed'); // caller renders honest offline
  if (!practices.length) return { practices: [], rows: [] };
  const [perPractice, days] = await Promise.all([
    Promise.all(practices.map(p => fetchPracticeRoster(p.id))),
    fetchLinkedDaysSince(daysAgoISO(1)),
  ]);
  const today = todayISO();
  const dayByAthlete = {};
  for (const d of days) { if (d.date === today) dayByAthlete[d.athlete_id] = d; }
  const seen = new Set(); const rows = [];
  for (const clients of perPractice) {
    for (const m of clients) {
      if (seen.has(m.athlete_id)) continue; seen.add(m.athlete_id);
      rows.push(buildRosterRow(m, dayByAthlete[m.athlete_id]));
    }
  }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { practices, rows };
}

export { cap };
