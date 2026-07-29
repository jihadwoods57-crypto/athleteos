/* OnStandard — Connected Standards data layer (0155).
   Supabase I/O + a small runtime cache, in the commitment-data.js idiom: every call is best-effort
   and degrades to an empty result rather than throwing, so a cold network renders an honest empty
   state instead of a crash.

   This module does NOT import state.js (the module cycle coach-data.js documents, which makes RT
   undefined at eval time in an ESM WebView) and does NOT import connected-standards.js — the pure
   engine stays free of any I/O so node --test can hold it.

   THE FLAG NEEDS NO CLIENT HALF. cs_enabled (0155) is checked inside the materialize RPCs and
   fails CLOSED, so with the feature off nothing is ever materialized, my_connected_standards
   returns [], and every surface below renders nothing. Same shape as Verified Commitments: one
   gate, on the server, where a client bug cannot route around it.

   Writes never carry a verdict. The server decides whether a number meets a target — a client
   that says "I'm verified" is not a verification. */

function sb() { return window.sb; }

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function todayISO() { return iso(new Date()); }
export function shiftISO(dateISO, days) {
  const d = new Date(String(dateISO) + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return iso(d);
}

/* Runtime cache. `error` is sticky per load so a screen can say "couldn't reach the server"
   instead of "you have no standards" — an athlete who is behind on a step goal and an athlete
   whose phone is offline must not see the same screen. */
const RTC = {
  mine: [], mineDay: null, mineAt: 0, mineError: false,
  defs: [], defsAt: 0,
  board: [], boardDay: null, boardAt: 0, boardError: false,
};

export const CS = {
  get mine() { return RTC.mine; },
  get defs() { return RTC.defs; },
  get board() { return RTC.board; },
  get mineError() { return RTC.mineError; },
  get boardError() { return RTC.boardError; },
  /** One result row out of whichever cache holds it. */
  result(resultId) {
    return RTC.mine.find(r => r.result_id === resultId) || null;
  },
  /** A standard definition the athlete owns, for the personal editor. */
  def(standardId) {
    return RTC.defs.find(d => d.id === standardId) || null;
  },
};

const FRESH_MS = 30_000;

/* ---------------------------------------------------------------- athlete reads */

/** The athlete's own standards across a window. Widened to ±8 days so a weekly window that
 *  started last Monday is fully covered without a second fetch. Materializes first. */
export async function loadMine(force = false, dayISO = null) {
  const day = dayISO || todayISO();
  if (!force && RTC.mineDay === day && Date.now() - RTC.mineAt < FRESH_MS) return RTC.mine;
  const c = sb();
  if (!c) { RTC.mineError = true; return RTC.mine; }
  const from = shiftISO(day, -8), to = shiftISO(day, 1);
  try {
    // Best-effort: if materialization fails (offline, feature off, migration not yet applied) we
    // still try the read — an already-materialized period must not be hidden by a failed ensure.
    try { await c.rpc('ensure_my_connected_standards', { p_from: from, p_to: to }); } catch { /* best-effort */ }
    const { data, error } = await c.rpc('my_connected_standards', { p_from: from, p_to: to });
    if (error) { RTC.mineError = true; return RTC.mine; }
    RTC.mine = Array.isArray(data) ? data : [];
    RTC.mineDay = day; RTC.mineAt = Date.now(); RTC.mineError = false;
    return RTC.mine;
  } catch { RTC.mineError = true; return RTC.mine; }
}

/** The athlete's OWN standard definitions — what the personal editor lists and edits. Coach-set
 *  standards are deliberately absent: an athlete may not edit an obligation someone else set. */
export async function loadMyDefs(force = false) {
  if (!force && RTC.defs.length && Date.now() - RTC.defsAt < FRESH_MS) return RTC.defs;
  const c = sb();
  if (!c) return RTC.defs;
  try {
    const uid = (await c.auth.getUser())?.data?.user?.id;
    if (!uid) return RTC.defs;
    const { data, error } = await c.from('connected_standards')
      .select('*').eq('owner_athlete', uid).order('created_at', { ascending: false });
    if (error) return RTC.defs;
    RTC.defs = Array.isArray(data) ? data : [];
    RTC.defsAt = Date.now();
    return RTC.defs;
  } catch { return RTC.defs; }
}

/* ---------------------------------------------------------------- athlete writes */

/** Log it by hand — the path that works with a dead watch, or no watch at all. */
export async function submitManual(instanceId, note) {
  const c = sb();
  if (!c) return { ok: false };
  try {
    const { data, error } = await c.rpc('submit_manual_activity',
      { p_instance: instanceId, p_note: note || null });
    if (error) return { ok: false, error: error.message };
    RTC.mineAt = 0;
    return { ok: true, status: data };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/** Flags the row for the coach. Never rewrites the verdict — that stays a staff act with a name. */
export async function disputeResult(resultId, note) {
  const c = sb();
  if (!c) return { ok: false };
  try {
    const { error } = await c.rpc('dispute_activity_result',
      { p_result: resultId, p_note: note || '' });
    if (error) return { ok: false, error: error.message };
    RTC.mineAt = 0;
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/** Create or edit a standard. The personal editor passes owner_athlete; the coach builder
 *  (slice 3) passes team_id or practice_id. One RPC, because the server authorizes either way. */
export async function saveStandard(payload) {
  const c = sb();
  if (!c) return { ok: false };
  try {
    const { data, error } = await c.rpc('upsert_connected_standard', { p: payload });
    if (error) return { ok: false, error: error.message };
    RTC.defsAt = 0; RTC.mineAt = 0; RTC.boardAt = 0;
    return { ok: true, id: data };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

export async function setStandardActive(standardId, active) {
  const c = sb();
  if (!c) return { ok: false };
  try {
    const { error } = await c.rpc('set_connected_standard_active',
      { p_id: standardId, p_active: !!active });
    if (error) return { ok: false, error: error.message };
    RTC.defsAt = 0; RTC.mineAt = 0; RTC.boardAt = 0;
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/* ---------------------------------------------------------------- device sync
   Called by the native health bridge once it exists (slice 5/6). Present now so the RPC contract
   lives in one place: the device posts a NUMBER and the server decides what it means. */
export async function postProgress(instanceId, progress, syncedAtISO, source, progressDays, deviceConnected) {
  const c = sb();
  if (!c) return { ok: false };
  try {
    const { data, error } = await c.rpc('submit_activity_progress', {
      p_instance: instanceId,
      p_progress: progress,
      p_synced_at: syncedAtISO || new Date().toISOString(),
      p_source: source || 'healthkit',
      p_progress_days: progressDays || null,
      p_device_connected: deviceConnected !== false,
    });
    if (error) return { ok: false, error: error.message };
    RTC.mineAt = 0;
    return { ok: true, status: data };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/* ---------------------------------------------------------------- staff (slice 3) */

export async function loadBoard(teamId, practiceId, dayISO, force = false) {
  const day = dayISO || todayISO();
  if (!force && RTC.boardDay === day && Date.now() - RTC.boardAt < FRESH_MS) return RTC.board;
  const c = sb();
  if (!c) { RTC.boardError = true; return RTC.board; }
  try {
    try {
      await c.rpc('ensure_connected_standard_instances', {
        p_team: teamId || null, p_practice: practiceId || null, p_from: day, p_to: day });
    } catch { /* best-effort */ }
    const { data, error } = await c.rpc('connected_standard_board',
      { p_team: teamId || null, p_practice: practiceId || null, p_on: day });
    if (error) { RTC.boardError = true; return RTC.board; }
    RTC.board = Array.isArray(data) ? data : [];
    RTC.boardDay = day; RTC.boardAt = Date.now(); RTC.boardError = false;
    return RTC.board;
  } catch { RTC.boardError = true; return RTC.board; }
}

export async function reviewManual(resultId, approve, note) {
  const c = sb();
  if (!c) return { ok: false };
  try {
    const { data, error } = await c.rpc('review_manual_activity',
      { p_result: resultId, p_approve: !!approve, p_note: note || null });
    if (error) return { ok: false, error: error.message };
    RTC.boardAt = 0;
    return { ok: true, status: data };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

export async function staffSetResult(resultId, status, reason) {
  const c = sb();
  if (!c) return { ok: false };
  try {
    const { error } = await c.rpc('staff_set_activity_result',
      { p_result: resultId, p_status: status, p_reason: reason || null });
    if (error) return { ok: false, error: error.message };
    RTC.boardAt = 0;
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/** Load the standards a coach or trainer owns, for the manage list (slice 3). */
export async function loadOwnerStandards(teamId, practiceId) {
  const c = sb();
  if (!c) return [];
  try {
    const col = teamId ? 'team_id' : 'practice_id';
    const { data, error } = await c.from('connected_standards')
      .select('*').eq(col, teamId || practiceId).order('created_at', { ascending: false });
    return error ? [] : (Array.isArray(data) ? data : []);
  } catch { return []; }
}
