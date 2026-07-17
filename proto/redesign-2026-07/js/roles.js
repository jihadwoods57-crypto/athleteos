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

/* ---------------- coach: custom team code (0026 RPCs) ---------------- */
/** Set a vanity join code (e.g. GATORS). Server validates ^[A-Z0-9]{4,12}$ + uniqueness and
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

/* ---------------- coach: roster-wide activity feed (WS4) ---------------- */
/** Recent meals across every linked athlete (RLS can_view scopes rows). Best-effort []. */
export async function fetchTeamActivity(sinceISO, limit = 24) {
  const c = sb(); if (!c) return [];
  try {
    const { data } = await c.from('meals')
      .select('id,athlete_id,day_date,type,photo_path,name,protein,kcal,quality,logged_at')
      .gte('day_date', sinceISO).order('logged_at', { ascending: false }).limit(limit);
    return data || [];
  } catch { return []; }
}

/* ---------------- coach: Inbox v2 (Slice D) — comment threads + intervention state ---------------- */
/** Recent meal_comments across the given athletes (RLS scopes rows). Feeds inbox.js's
    lastByMeal (who spoke last per meal thread). Best-effort []. */
export async function fetchTeamMealComments(athleteIds, sinceISO) {
  const c = sb(); if (!c || !athleteIds || !athleteIds.length) return [];
  try {
    const { data } = await c.from('meal_comments')
      .select('meal_id,athlete_id,role,kind,created_at')
      .in('athlete_id', athleteIds).gte('created_at', sinceISO)
      .order('created_at', { ascending: true }).limit(1000);
    return data || [];
  } catch { return []; }
}
/** Recent coach_interventions for the team (kind 'handled' + reason_key 'meal:<id>' marks a
    thread resolved — Task 5 writes it, inbox.js reads it). Best-effort []. */
export async function fetchRecentInterventions(teamId, sinceISO) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const { data } = await c.from('coach_interventions')
      .select('athlete_id,kind,reason_key,created_at')
      .eq('team_id', teamId).gte('created_at', sinceISO)
      .order('created_at', { ascending: false }).limit(500);
    return data || [];
  } catch { return []; }
}

/* Outstanding (unredeemed) staff invites for the Staff inbox category — used_by is null is
   the real "pending staff" state (staff_invites RLS: is_staff_of_team, 0061). No approval
   queue exists; an unused code IS the pending signal. */
export async function fetchOpenStaffInvites(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const { data } = await c.from('staff_invites')
      .select('id,role,created_at')
      .eq('team_id', teamId).is('used_by', null)
      .order('created_at', { ascending: false }).limit(50);
    return data || [];
  } catch { return []; }
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
/** Coach-visible athlete basics for target suggestions (can_view-scoped). Best-effort null. */
export async function fetchAthleteBasics(athleteId) {
  const c = sb(); if (!c || !athleteId) return null;
  try {
    const { data } = await c.from('athlete_profiles')
      .select('base_weight,position,sport,targets').eq('athlete_id', athleteId).maybeSingle();
    return data || null;
  } catch { return null; }
}
export async function coachSetGoals(athleteId, targets) {
  const c = sb(); if (!c || !athleteId) return false;
  try { const { error } = await c.rpc('coach_set_goals', { athlete: athleteId, new_targets: targets, new_season_goal: null }); return !error; } catch { return false; }
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

/* ---------------- staff & collaborators (0061) ---------------- */
export async function fetchTeamStaff(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try { const { data } = await c.rpc('team_staff_list', { p_team: teamId }); return data || []; } catch { return []; }
}
export async function createStaffInvite(teamId, role) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.rpc('create_staff_invite', { p_team: teamId, p_role: role });
    if (error) return { ok: false, error: error.message || 'Could not mint the code.' };
    return { ok: true, code: (typeof data === 'string' && data) || '' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not mint the code.' }; }
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
/** The team's standing requirement sets (RLS: staff + active members). Best-effort []. */
export async function fetchRequirementSets(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try { const { data } = await c.from('requirement_sets').select('*').eq('team_id', teamId); return data || []; } catch { return []; }
}
/** The signed-in ATHLETE's assignments: everything open plus anything closed recently
    (so a just-completed task still shows Done tonight). Best-effort []. */
export async function fetchMyAssignments() {
  const c = sb(); if (!c) return [];
  try {
    const since = daysAgoISO(7);
    const { data } = await c.from('requirement_assignments').select('*')
      .neq('status', 'cancelled').gte('created_at', since)
      .order('created_at', { ascending: false }).limit(60);
    return data || [];
  } catch { return []; }
}
/** The signed-in user's server notification feed (0027): coach nudges, join events, digests.
    Recent first, bounded, best-effort []. RLS scopes the select to the caller's own rows. */
export async function fetchMyNotifications(limit = 30) {
  const c = sb(); if (!c) return [];
  try {
    const { data } = await c.from('notifications')
      .select('id, kind, title, body, created_at, read_at')
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  } catch { return []; }
}
/** Mark the caller's unread server notifications read (bell opened). Best-effort; RLS
    (notif_update, self-only) already scopes the update to the caller's own rows. */
export async function markMyNotificationsRead() {
  const c = sb(); if (!c) return;
  try { await c.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); }
  catch { /* best-effort — unread state self-heals on the next fetch */ }
}

/** Coach saves a standing requirement set (team / position / athlete scope). */
export async function setTeamRequirements(teamId, scopeKind, scopeValue, items) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.rpc('set_team_requirements', {
      p_team: teamId, p_scope_kind: scopeKind, p_scope_value: scopeValue || null, p_items: items,
    });
    return error ? { ok: false, error: error.message || 'Could not save the standard.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save the standard.' }; }
}
/** Remove a scope override so it falls back to the team default (0058). */
export async function clearTeamRequirements(teamId, scopeKind, scopeValue) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.rpc('clear_team_requirements', {
      p_team: teamId, p_scope_kind: scopeKind, p_scope_value: scopeValue || null,
    });
    return error ? { ok: false, error: error.message || 'Could not reset it.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not reset it.' }; }
}

/** Coach + button → assign_requirement RPC (fans out one row per athlete + push row each).
    Returns { ok, count?, error? } with the server's message surfaced verbatim. */
export async function assignRequirement({ teamId, scopeKind, scopeValue, title, proof, dueAt, dueLabel, note }) {
  const c = sb(); if (!c) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { data, error } = await c.rpc('assign_requirement', {
      p_team: teamId, p_scope_kind: scopeKind, p_scope_value: scopeValue || null,
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
  try {
    const { data } = await c.from('requirement_templates')
      .select('id,name,kind,items,created_at').eq('team_id', teamId).order('created_at');
    return data || [];
  } catch { return []; }
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
  try {
    const { data } = await c.from('announcements')
      .select('id,title,body,scope_kind,scope_value,sent_count,created_at')
      .eq('team_id', teamId).order('created_at', { ascending: false }).limit(limit);
    return data || [];
  } catch { return []; }
}

/* ---------------- Coach OS core (0071): interventions, groups, exceptions ---------------- */
/** Log a coach action (nudge/message/assign/handled). The queue and Insights both read this. */
export async function logIntervention({ teamId, athleteId, kind, reasonKey, tier, note }) {
  const c = sb(); if (!c || !teamId || !athleteId || !kind) return false;
  try {
    const { error } = await c.from('coach_interventions').insert({
      team_id: teamId, athlete_id: athleteId, kind, day: todayISO(),
      reason_key: reasonKey || null, tier: tier || null, note: note || null,
    });
    return !error;
  } catch { return false; }
}
/** Today's interventions for the team (priority queue filters on these). Best-effort []. */
export async function fetchTodayInterventions(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const { data } = await c.from('coach_interventions')
      .select('athlete_id,kind,reason_key,tier,created_at')
      .eq('team_id', teamId).eq('day', todayISO()).limit(400);
    return data || [];
  } catch { return []; }
}
export async function fetchCoachGroups(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try { const { data } = await c.from('coach_groups').select('id,name,athlete_ids').eq('team_id', teamId).order('name'); return data || []; } catch { return []; }
}
export async function saveCoachGroup(teamId, { id, name, athleteIds }) {
  const c = sb(); if (!c || !teamId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const row = { team_id: teamId, name, athlete_ids: athleteIds || [], updated_at: new Date().toISOString() };
    const q = id ? c.from('coach_groups').update(row).eq('id', id) : c.from('coach_groups').insert(row);
    const { error } = await q;
    return error ? { ok: false, error: error.message || 'Could not save the group.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save the group.' }; }
}
export async function deleteCoachGroup(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('coach_groups').delete().eq('id', id); return !error; } catch { return false; }
}
/** Exceptions whose window covers today. Best-effort []. */
export async function fetchActiveExceptions(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const t = todayISO();
    const { data } = await c.from('athlete_exceptions')
      .select('id,athlete_id,starts_on,ends_on,reason')
      .eq('team_id', teamId).lte('starts_on', t).gte('ends_on', t);
    return data || [];
  } catch { return []; }
}
export async function saveAthleteException(teamId, athleteId, startsOn, endsOn, reason) {
  const c = sb(); if (!c || !teamId || !athleteId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.from('athlete_exceptions').insert({
      team_id: teamId, athlete_id: athleteId, starts_on: startsOn, ends_on: endsOn, reason: reason || null,
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
/** The signed-in staff member's own scope on this team. null = whole team (default). */
export async function fetchMyStaffScope(teamId) {
  const c = sb(); if (!c || !teamId) return null;
  try {
    const uid = (await c.auth.getUser()).data.user.id;
    const { data } = await c.from('team_staff').select('scope_kind,scope_value')
      .eq('team_id', teamId).eq('staff_id', uid).maybeSingle();
    return (data && data.scope_kind) ? { kind: data.scope_kind, value: data.scope_value } : null;
  } catch { return null; }
}

/* ---------------- Coach OS Slice B: profile helpers ---------------- */
export async function fetchCoachNotes(teamId, athleteId) {
  const c = sb(); if (!c || !teamId || !athleteId) return [];
  try {
    const { data } = await c.from('coach_notes').select('id,author_id,body,created_at')
      .eq('team_id', teamId).eq('athlete_id', athleteId)
      .order('created_at', { ascending: false }).limit(100);
    return data || [];
  } catch { return []; }
}
export async function postCoachNote(teamId, athleteId, body) {
  const c = sb(); if (!c || !teamId || !athleteId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.from('coach_notes').insert({ team_id: teamId, athlete_id: athleteId, body });
    return error ? { ok: false, error: error.message || 'Could not save the note.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save the note.' }; }
}
export async function deleteCoachNote(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('coach_notes').delete().eq('id', id); return !error; } catch { return false; }
}
export async function fetchAthleteInterventions(teamId, athleteId, sinceISO) {
  const c = sb(); if (!c || !teamId || !athleteId) return [];
  try {
    let q = c.from('coach_interventions').select('kind,reason_key,tier,note,created_at')
      .eq('team_id', teamId).eq('athlete_id', athleteId);
    if (sinceISO) q = q.gte('day', sinceISO);
    const { data } = await q.order('created_at', { ascending: false }).limit(100);
    return data || [];
  } catch { return []; }
}
export async function fetchAthleteAssignments(athleteId, sinceISO) {
  const c = sb(); if (!c || !athleteId) return [];
  try {
    let q = c.from('requirement_assignments').select('id,title,proof,status,due_at,created_at,note')
      .eq('athlete_id', athleteId);
    if (sinceISO) q = q.gte('created_at', sinceISO);
    const { data } = await q.order('created_at', { ascending: false }).limit(60);
    return data || [];
  } catch { return []; }
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
export async function nudgePush(athleteId, title, body) {
  const c = sb(); if (!c || !athleteId) return false;
  try { const { error } = await c.functions.invoke('send-push', { body: { athlete_id: athleteId, title, body } }); return !error; } catch { return false; }
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
    const { data } = await c.from('practices').select('id,name,join_code,owner_id,handle').limit(1).maybeSingle();
    if (!data) return null;
    return { id: data.id, name: data.name || '', code: data.join_code || '', handle: data.handle || null };
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
export function buildRosterRow(member, dayRow, extras = {}) {
  const name = member.athlete_name || 'Athlete';
  const logged = !!dayRow;
  const score = logged && dayRow.score != null ? dayRow.score : null;
  const tasks = (dayRow && Array.isArray(dayRow.tasks)) ? dayRow.tasks : [];
  const done = tasks.filter(t => t && t.done).length;
  return {
    athleteId: member.athlete_id,
    name, unit: member.position || '', position: member.position || '',
    score, loggedToday: logged,
    flag: logged ? tierFlag(score) : 'r',
    logs: logged && tasks.length ? `${done}/${tasks.length}` : (logged ? 'Logged' : '—'),
    note: logged
      ? (score != null ? (score >= 80 ? 'On standard today' : 'Logged · below the bar') : 'Logged today')
      : 'No logs today',
    tasks,
    scoreHistory: extras.scoreHistory || [],
    lastMealAt: extras.lastMealAt || null,
  };
}

/** Full coach roster: teams → members (RPC) → merged with today's linked day rows. */
export async function loadCoachRoster() {
  const teams = await fetchMyTeams();
  if (teams.error) throw new Error('roster-fetch-failed'); // caller renders honest offline
  if (!teams.length) return { teams: [], rows: [] };
  const [perTeam, days, recentMeals] = await Promise.all([
    Promise.all(teams.map(t => fetchTeamRoster(t.id))),
    fetchLinkedDaysSince(daysAgoISO(7)),
    fetchTeamActivity(daysAgoISO(2), 400),
  ]);
  const today = todayISO();
  const dayByAthlete = {}, histByAthlete = {}, lastMealBy = {};
  for (const d of days) {
    if (d.date === today) dayByAthlete[d.athlete_id] = d;
    (histByAthlete[d.athlete_id] = histByAthlete[d.athlete_id] || []).push({ date: d.date, score: d.score });
  }
  for (const h of Object.values(histByAthlete)) h.sort((a, b) => a.date < b.date ? -1 : 1);
  for (const m of recentMeals) {
    if (!lastMealBy[m.athlete_id] || m.logged_at > lastMealBy[m.athlete_id]) lastMealBy[m.athlete_id] = m.logged_at;
  }
  const seen = new Set(); const rows = [];
  for (const members of perTeam) {
    for (const m of members) {
      if (seen.has(m.athlete_id)) continue; seen.add(m.athlete_id);
      rows.push(buildRosterRow(m, dayByAthlete[m.athlete_id], {
        scoreHistory: histByAthlete[m.athlete_id] || [],
        lastMealAt: lastMealBy[m.athlete_id] || null,
      }));
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
