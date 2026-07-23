/* OnStandard — Verified Commitments data layer (0138).
   Supabase I/O + a small runtime cache, in the coach-data.js idiom: every call is best-effort and
   degrades to an empty result rather than throwing, so a cold network renders an honest empty
   state instead of a crash at 4:30 AM.

   This module does NOT import state.js (same cycle hazard coach-data.js documents) and does NOT
   import commitments.js — the pure engine stays free of any I/O so node --test can hold it.

   Writes never carry a timestamp. ack/arrive/complete all resolve their time from the SERVER
   clock inside the RPC; a client-supplied "I woke at 4:48" is not a verification. */

function sb() { return window.sb; }

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function todayISO() { return iso(new Date()); }
export function shiftISO(dateISO, days) {
  const d = new Date(String(dateISO) + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return iso(d);
}

/* Runtime cache. `error` is sticky per load so a screen can say "couldn't reach the server"
   instead of "you have no commitments" — the two are very different messages to an athlete
   whose coach is counting on them. */
const RTC = {
  mine: [], mineDay: null, mineAt: 0, mineError: false,
  board: [], boardDay: null, boardAt: 0, boardError: false,
  locations: [], locationsAt: 0,
};

export const VC = {
  get mine() { return RTC.mine; },
  get board() { return RTC.board; },
  get locations() { return RTC.locations; },
  get mineError() { return RTC.mineError; },
  get boardError() { return RTC.boardError; },
  /** Today's rows only — what Home renders. */
  today(dayISO) {
    const d = dayISO || todayISO();
    return RTC.mine.filter(r => r.occurs_on === d);
  },
  /** One instance out of whichever cache holds it. */
  instance(instanceId) {
    return RTC.mine.find(r => r.instance_id === instanceId)
        || RTC.board.find(r => r.instance_id === instanceId)
        || null;
  },
};

const FRESH_MS = 30_000;

/* ---------------------------------------------------------------- athlete reads */

/** The athlete's own commitments across a window (default: yesterday → tomorrow, so a late-night
 *  log and an early-morning card both resolve without a second fetch). Materializes first. */
export async function loadMine(force = false, dayISO = null) {
  const day = dayISO || todayISO();
  if (!force && RTC.mineDay === day && Date.now() - RTC.mineAt < FRESH_MS) return RTC.mine;
  const c = sb();
  if (!c) { RTC.mineError = true; return RTC.mine; }
  const from = shiftISO(day, -1), to = shiftISO(day, 1);
  try {
    // Best-effort: if materialization fails (offline, not-yet-applied migration) we still try the
    // read — an already-materialized day must not be hidden by a failed ensure.
    try { await c.rpc('ensure_my_commitment_instances', { p_from: from, p_to: to }); } catch { /* best-effort */ }
    const { data, error } = await c.rpc('my_commitments', { p_from: from, p_to: to });
    if (error) { RTC.mineError = true; return RTC.mine; }
    RTC.mine = Array.isArray(data) ? data : [];
    RTC.mineDay = day; RTC.mineAt = Date.now(); RTC.mineError = false;
    return RTC.mine;
  } catch { RTC.mineError = true; return RTC.mine; }
}

/** A longer history window for the Accountability screen. Does not touch the Home cache. */
export async function loadMineRange(fromISO, toISO) {
  const c = sb(); if (!c) return [];
  try {
    const { data, error } = await c.rpc('my_commitments', { p_from: fromISO, p_to: toISO });
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

/* ---------------------------------------------------------------- athlete writes */

/** "I'm Up". Returns the server-stamped ISO time, or null. Idempotent server-side: a double tap
 *  keeps the FIRST response, so a slow network can never cost an athlete their real time. */
export async function ackCommitment(instanceId) {
  const c = sb(); if (!c || !instanceId) return null;
  try {
    const { data, error } = await c.rpc('ack_commitment', { p_instance: instanceId });
    if (error) return null;
    patchLocal(instanceId, { acknowledged_at: data, status: 'acknowledged' });
    return data || null;
  } catch { return null; }
}

/** "Something wrong?" — the athlete's route to correct a bad verification. */
export async function disputeResponse(instanceId, note) {
  const c = sb(); if (!c || !instanceId) return false;
  try {
    const { error } = await c.rpc('dispute_response', {
      p_instance: instanceId, p_note: (note || '').slice(0, 200) });
    if (error) return false;
    patchLocal(instanceId, { disputed_at: new Date().toISOString() });
    return true;
  } catch { return false; }
}

/** Slice 2 writes. `within` false records 'unverified' with a reason — NEVER 'missed'. */
export async function verifyArrival(instanceId, source, within, reason) {
  const c = sb(); if (!c || !instanceId) return null;
  try {
    const { data, error } = await c.rpc('verify_arrival', {
      p_instance: instanceId, p_source: source || 'manual',
      p_within: !!within, p_reason: reason || null });
    if (error) return null;
    await loadMine(true);
    return data || null;
  } catch { return null; }
}

export async function completeCommitment(instanceId, source) {
  const c = sb(); if (!c || !instanceId) return null;
  try {
    const { data, error } = await c.rpc('complete_commitment', {
      p_instance: instanceId, p_source: source || 'manual' });
    if (error) return null;
    patchLocal(instanceId, { completed_at: data, status: 'completed' });
    return data || null;
  } catch { return null; }
}

/** Optimistic local patch so the card responds instantly; the next load reconciles from server. */
function patchLocal(instanceId, fields) {
  const row = RTC.mine.find(r => r.instance_id === instanceId);
  if (row) Object.assign(row, fields);
}

/* ---------------------------------------------------------------- coach reads */

/** The live board for one day. `ownerId` is a team uuid for a coach, a practice uuid for a
 *  trainer; `kind` is 'team' | 'practice' (coach-data.js CD.kind). */
export async function loadBoard(ownerId, kind, dayISO = null, force = false) {
  const day = dayISO || todayISO();
  if (!force && RTC.boardDay === day && Date.now() - RTC.boardAt < FRESH_MS) return RTC.board;
  const c = sb();
  if (!c || !ownerId) { RTC.boardError = !!ownerId; return RTC.board; }
  const team = kind === 'practice' ? null : ownerId;
  const practice = kind === 'practice' ? ownerId : null;
  try {
    try {
      await c.rpc('ensure_commitment_instances', {
        p_team: team, p_practice: practice, p_from: day, p_to: day });
    } catch { /* best-effort */ }
    const { data, error } = await c.rpc('commitment_board', {
      p_team: team, p_practice: practice, p_on: day });
    if (error) { RTC.boardError = true; return RTC.board; }
    RTC.board = Array.isArray(data) ? data : [];
    RTC.boardDay = day; RTC.boardAt = Date.now(); RTC.boardError = false;
    return RTC.board;
  } catch { RTC.boardError = true; return RTC.board; }
}

/** Every standing commitment in this book — what the composer lists and edits. */
export async function loadCommitments(ownerId, kind) {
  const c = sb(); if (!c || !ownerId) return [];
  const col = kind === 'practice' ? 'practice_id' : 'team_id';
  try {
    const { data, error } = await c.from('commitments')
      .select('*').eq(col, ownerId).eq('active', true).order('starts_min');
    if (error) return [];
    return data || [];
  } catch { return []; }
}

export async function loadLocations(ownerId, kind, force = false) {
  if (!force && RTC.locations.length && Date.now() - RTC.locationsAt < 300_000) return RTC.locations;
  const c = sb(); if (!c || !ownerId) return [];
  const col = kind === 'practice' ? 'practice_id' : 'team_id';
  try {
    const { data, error } = await c.from('commitment_locations')
      .select('id,name,address,lat,lng,radius_m').eq(col, ownerId).is('archived_at', null);
    if (error) return [];
    RTC.locations = data || []; RTC.locationsAt = Date.now();
    return RTC.locations;
  } catch { return []; }
}

/* ---------------------------------------------------------------- coach writes */

/** Create or edit. `payload` is the commitments row shape; the RPC authorizes the owner and the
 *  staff role. Returns the commitment id or null.
 *
 *  title / message / action_label are passed through EXACTLY as the coach typed them — this layer
 *  never substitutes a default. A null action_label means "the coach didn't choose one", and the
 *  client supplies a render-time label; writing one here would make the column lie. */
export async function saveCommitment(payload) {
  const c = sb(); if (!c || !payload) return null;
  try {
    const { data, error } = await c.rpc('upsert_commitment', { p: payload });
    if (error) return null;
    RTC.boardAt = 0; // force the next board read
    return data || null;
  } catch { return null; }
}

export async function saveLocation(row) {
  const c = sb(); if (!c || !row) return null;
  try {
    const { data, error } = await c.from('commitment_locations').insert(row).select().maybeSingle();
    if (error) return null;
    RTC.locationsAt = 0;
    return data || null;
  } catch { return null; }
}

/** Excuse, or manually correct. Every call is attributed server-side (corrected_by/at). */
export async function setResponse(responseId, status, reason) {
  const c = sb(); if (!c || !responseId) return false;
  try {
    const { error } = await c.rpc('staff_set_response', {
      p_response: responseId, p_status: status, p_reason: reason || null });
    if (error) return false;
    RTC.boardAt = 0;
    return true;
  } catch { return false; }
}

/** Reaches ONLY athletes who have not responded. Returns how many were notified. */
export async function remindMissing(instanceId) {
  const c = sb(); if (!c || !instanceId) return 0;
  try {
    const { data, error } = await c.rpc('remind_missing', { p_instance: instanceId });
    if (error) return 0;
    return Number(data) || 0;
  } catch { return 0; }
}

/* ---------------------------------------------------------------- rollups */

/** Server-side accountability over a range. The client engine is the source of truth for what is
 *  on screen today; this is for windows too large to ship row-by-row. */
export async function loadAccountability(athleteId, fromISO, toISO) {
  const c = sb(); if (!c || !athleteId) return null;
  try {
    const { data, error } = await c.rpc('athlete_accountability', {
      p_athlete: athleteId, p_from: fromISO, p_to: toISO });
    if (error) return null;
    return data || null;
  } catch { return null; }
}

/** The recruit-facing aggregate. Refused by the server unless the athlete shared it. */
export async function loadVerifiedDiscipline(athleteId, fromISO, toISO) {
  const c = sb(); if (!c || !athleteId) return null;
  try {
    const { data, error } = await c.rpc('verified_discipline', {
      p_athlete: athleteId, p_from: fromISO, p_to: toISO });
    if (error) return null;
    return data || null;
  } catch { return null; }
}

/** The athlete's own share switch. Only the athlete can move it. */
export async function setShareDiscipline(on) {
  const c = sb(); if (!c) return false;
  try {
    const { data: u } = await c.auth.getUser();
    const uid = u && u.user && u.user.id;
    if (!uid) return false;
    const { error } = await c.from('profiles')
      .update({ share_verified_discipline: !!on }).eq('id', uid);
    return !error;
  } catch { return false; }
}
