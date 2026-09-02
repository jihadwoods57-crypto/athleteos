/* OnStandard — Verified Commitments data layer (0138).
   Supabase I/O + a small runtime cache, in the coach-data.js idiom: every call is best-effort and
   degrades to an empty result rather than throwing, so a cold network renders an honest empty
   state instead of a crash at 4:30 AM.

   This module does NOT import state.js (same cycle hazard coach-data.js documents) and does NOT
   import commitments.js — the pure engine stays free of any I/O so node --test can hold it.

   Writes never carry a timestamp. ack/arrive/complete all resolve their time from the SERVER
   clock inside the RPC; a client-supplied "I woke at 4:48" is not a verification. */

function sb() { return window.sb; }

import * as SQ from './sync-queue.js';

/* Who to queue offline work FOR — registered by state.js (the setDayTaskProvider pattern; this
   module must not import state.js, see header). Unregistered → no queueing, behavior as before. */
let uidProvider = null;
export function setVcUidProvider(fn) { uidProvider = typeof fn === 'function' ? fn : null; }

/* A write that could not reach the server becomes a durable queue entry instead of vanishing.
   Only for RPCs that are safe to replay: ack (server keeps the FIRST response), complete and
   dispute (server-stamped, window-checked server-side on replay). verify_arrival is deliberately
   NOT queued — its verdict compares a fix taken NOW against a window; replaying it later would
   verify the wrong moment. Returns true when queued (callers then patch local optimistically
   and show the tap as saved-and-syncing, which it is). */
function queueVcWrite(rpc, instanceId, args) {
  const uid = uidProvider ? uidProvider() : null;
  if (!uid) return false;
  SQ.putJob({ uid, kind: 'rpc', ref: `${rpc}:${instanceId}`, rpc, args, queuedAt: Date.now() });
  const act = typeof window !== 'undefined' ? window.__act : null;
  if (act && act._scheduleSyncDrain) act._scheduleSyncDrain();
  return true;
}
const vcRetryable = (errMsg, threw) =>
  SQ.retryable(errMsg, threw, typeof navigator !== 'undefined' && navigator.onLine === false);

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
  commitments: [], commitmentsAt: 0, commitmentsError: false,
  // Per-day boards (0215): Home holds today AND the next roll call at once, and the board screen
  // can open any day of the week ahead without the two evicting each other.
  boards: new Map(),          // dayISO -> { rows, at, error }
  upcoming: new Map(),        // commitmentId -> { rows, at }
};

export const VC = {
  get mine() { return RTC.mine; },
  get board() { return RTC.board; },
  get locations() { return RTC.locations; },
  get mineError() { return RTC.mineError; },
  get boardError() { return RTC.boardError; },
  get commitmentsError() { return RTC.commitmentsError; },
  /** Today's rows only — what Home renders. */
  today(dayISO) {
    const d = dayISO || todayISO();
    return RTC.mine.filter(r => r.occurs_on === d);
  },
  /** One instance out of whichever cache holds it. */
  instance(instanceId) {
    if (!instanceId) return null;
    const hit = RTC.mine.find(r => r.instance_id === instanceId)
        || RTC.board.find(r => r.instance_id === instanceId);
    if (hit) return hit;
    for (const b of RTC.boards.values()) {
      const r = (b.rows || []).find((x) => x.instance_id === instanceId);
      if (r) return r;
    }
    return null;
  },
  /** The cached board for one day (0215), or null when that day was never loaded. */
  boardFor(dayISO) { const b = RTC.boards.get(dayISO); return b ? b.rows : null; },
  /** Which day an instance in any cached board belongs to, or null. */
  dayOf(instanceId) {
    for (const [day, b] of RTC.boards) if ((b.rows || []).some((r) => r.instance_id === instanceId)) return day;
    return null;
  },
  /** The week ahead for one roll call (0215), or null when never loaded. */
  upcomingFor(commitmentId) { const u = RTC.upcoming.get(commitmentId); return u ? u.rows : null; },
};

const FRESH_MS = 30_000;

/** Harness seams (render harnesses only, never product code): seed the caches so a screen can be
 *  rendered headlessly without a session. Same idea as the OB2 harness seeding RT by mutation. */
export function seedMineForHarness(rows, dayISO) {
  RTC.mine = Array.isArray(rows) ? rows : [];
  RTC.mineDay = dayISO || todayISO(); RTC.mineAt = Date.now(); RTC.mineError = false;
}
export function seedBoardForHarness(rows, dayISO) {
  RTC.board = Array.isArray(rows) ? rows : [];
  RTC.boardDay = dayISO || todayISO(); RTC.boardAt = Date.now(); RTC.boardError = false;
}

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

/** A longer history window for the Accountability screen. Does not touch the Home cache.
 *  null = FAILED (the fetcher contract): a dead network must never read as "Nothing to show
 *  yet" on a record both the athlete and their coach act on. The screen branches on null
 *  (error + retry) vs [] (a genuinely empty record). No client is the same failure: the
 *  read never happened, so answering [] would fabricate emptiness the same way. */
export async function loadMineRange(fromISO, toISO) {
  const c = sb(); if (!c) return null;
  try {
    const { data, error } = await c.rpc('my_commitments', { p_from: fromISO, p_to: toISO });
    if (error) return null;
    return Array.isArray(data) ? data : [];
  } catch { return null; }
}

/* ---------------------------------------------------------------- athlete writes */

/** "I'm Up". Returns the server-stamped ISO time, or null. Idempotent server-side: a double tap
 *  keeps the FIRST response, so a slow network can never cost an athlete their real time. */
export async function ackCommitment(instanceId) {
  const c = sb(); if (!c || !instanceId) return null;
  // The offline path: the tap is queued durably, the card shows it as answered, and the server
  // stamps the REAL response time when the queue drains. That later stamp is honest — the server
  // clock rule above means we never claim the tap time anyway.
  const queueIt = () => {
    if (!queueVcWrite('ack_commitment', instanceId, { p_instance: instanceId })) return null;
    const at = new Date().toISOString();
    patchLocal(instanceId, { acknowledged_at: at, status: 'acknowledged', pendingSync: true });
    return at;
  };
  try {
    const { data, error } = await c.rpc('ack_commitment', { p_instance: instanceId });
    if (error) {
      // The server's window verdicts (0211) are decided answers, never queued: replaying "closed"
      // at 9 AM would not make a 6 AM answer exist. The card names each one.
      ACK_REFUSAL.set(instanceId, ackRefusalOf(error.message));
      return vcRetryable(error.message, false) ? queueIt() : null;
    }
    ACK_REFUSAL.delete(instanceId);
    patchLocal(instanceId, { acknowledged_at: data, status: 'acknowledged' });
    return data || null;
  } catch { return queueIt(); }
}

/* Why the last ack was refused, per instance: 'not_open' | 'closed' | 'cancelled' | null. */
const ACK_REFUSAL = new Map();
function ackRefusalOf(msg) {
  const m = String(msg || '');
  if (/not open yet/i.test(m)) return 'not_open';
  if (/closed/i.test(m)) return 'closed';
  if (/cancelled/i.test(m)) return 'cancelled';
  return null;
}
export function ackRefusal(instanceId) { return ACK_REFUSAL.get(instanceId) || null; }

/** "Something wrong?" — the athlete's route to correct a bad verification. */
export async function disputeResponse(instanceId, note) {
  const c = sb(); if (!c || !instanceId) return false;
  const args = { p_instance: instanceId, p_note: (note || '').slice(0, 200) };
  const queueIt = () => {
    if (!queueVcWrite('dispute_response', instanceId, args)) return false;
    patchLocal(instanceId, { disputed_at: new Date().toISOString(), pendingSync: true });
    return true;
  };
  try {
    const { error } = await c.rpc('dispute_response', args);
    if (error) return vcRetryable(error.message, false) ? queueIt() : false;
    patchLocal(instanceId, { disputed_at: new Date().toISOString() });
    return true;
  } catch { return queueIt(); }
}

/** Slice 2 writes. `within` false records 'unverified' with a reason — NEVER 'missed'.
 *  Returns { ok, row?, error? } so the caller can tell a recorded verdict from a refused one:
 *  the old null-on-failure contract collapsed a consent refusal, a cancelled instance and a
 *  dropped connection into the same silence, and the arrival card painted success over it. */
export async function verifyArrival(instanceId, source, within, reason) {
  const c = sb(); if (!c || !instanceId) return { ok: false };
  try {
    const { data, error } = await c.rpc('verify_arrival', {
      p_instance: instanceId, p_source: source || 'manual',
      p_within: !!within, p_reason: reason || null });
    if (error) return { ok: false, error: error.message };
    await loadMine(true);
    return { ok: true, row: data || null };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

export async function completeCommitment(instanceId, source) {
  const c = sb(); if (!c || !instanceId) return null;
  const args = { p_instance: instanceId, p_source: source || 'manual' };
  const queueIt = () => {
    if (!queueVcWrite('complete_commitment', instanceId, args)) return null;
    const at = new Date().toISOString();
    patchLocal(instanceId, { completed_at: at, status: 'completed', pendingSync: true });
    return at;
  };
  try {
    const { data, error } = await c.rpc('complete_commitment', args);
    if (error) return vcRetryable(error.message, false) ? queueIt() : null;
    patchLocal(instanceId, { completed_at: data, status: 'completed' });
    return data || null;
  } catch { return queueIt(); }
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
    RTC.boards.set(day, { rows: RTC.board, at: Date.now(), error: false });
    return RTC.board;
  } catch { RTC.boardError = true; return RTC.board; }
}

/** One day's board WITHOUT touching the today-board slot (0215). Home paints today from
 *  VC.board and the next roll call from here; loading tomorrow through loadBoard would have
 *  flipped the Home card to tomorrow's roster. */
export async function loadBoardFor(ownerId, kind, dayISO, force = false) {
  const day = dayISO || todayISO();
  const have = RTC.boards.get(day);
  if (!force && have && Date.now() - have.at < FRESH_MS) return have.rows;
  const c = sb();
  if (!c || !ownerId) return have ? have.rows : null;
  const team = kind === 'practice' ? null : ownerId;
  const practice = kind === 'practice' ? ownerId : null;
  try {
    try {
      await c.rpc('ensure_commitment_instances', { p_team: team, p_practice: practice, p_from: day, p_to: day });
    } catch { /* best-effort */ }
    const { data, error } = await c.rpc('commitment_board', { p_team: team, p_practice: practice, p_on: day });
    if (error) { RTC.boards.set(day, { rows: have ? have.rows : [], at: have ? have.at : 0, error: true }); return have ? have.rows : null; }
    const rows = Array.isArray(data) ? data : [];
    RTC.boards.set(day, { rows, at: Date.now(), error: false });
    if (day === RTC.boardDay) { RTC.board = rows; RTC.boardAt = Date.now(); }
    return rows;
  } catch { return have ? have.rows : null; }
}

/** The week ahead for one roll call (0215): the next `days` occurrences, materialized on the
 *  server on the way in. null = the fetch failed (never rendered as "nothing scheduled"). */
export async function loadUpcoming(commitmentId, days = 7, force = false) {
  const c = sb(); if (!c || !commitmentId) return null;
  const have = RTC.upcoming.get(commitmentId);
  if (!force && have && Date.now() - have.at < FRESH_MS) return have.rows;
  try {
    const { data, error } = await c.rpc('rollcall_upcoming', { p_commitment: commitmentId, p_days: days });
    if (error) return have ? have.rows : null;
    const rows = Array.isArray(data) ? data : [];
    RTC.upcoming.set(commitmentId, { rows, at: Date.now() });
    return rows;
  } catch { return have ? have.rows : null; }
}

/** Change ONE day's schedule (0215): a different wake-up time, back to the rule, skip it, or put
 *  it back. Refused server-side once that morning has started. Every board cache is stale after. */
export async function setInstanceSchedule(instanceId, { startsMin = null, resetTime = false, skipped = null, note = null } = {}) {
  const c = sb(); if (!c || !instanceId) return false;
  try {
    const { error } = await c.rpc('set_instance_schedule', {
      p_instance: instanceId,
      p_starts_min: startsMin == null ? null : Math.max(0, Math.min(1439, Math.round(Number(startsMin)))),
      p_reset_time: !!resetTime,
      p_skipped: skipped == null ? null : !!skipped,
      p_note: note == null ? null : String(note).slice(0, 200),
    });
    if (error) return false;
    RTC.boardAt = 0;
    for (const b of RTC.boards.values()) b.at = 0;
    for (const u of RTC.upcoming.values()) u.at = 0;
    return true;
  } catch { return false; }
}

/** Every standing commitment in this book — what the manage screen lists and the composer edits.
 *  PAUSED ones are included: a coach has to be able to find and resume them, which they can't do
 *  if the only screen that lists commitments filters them out. */
export async function loadCommitments(ownerId, kind, force = false) {
  // Failure keeps the last-known rows AND raises the sticky commitmentsError flag (the
  // mineError/boardError idiom above): on a cold open the last-known list is still the
  // initial [], and without the flag the manage screen renders "Nothing scheduled yet"
  // over a book of standing 5 AM roll calls it simply could not read. The flag lets the
  // screen tell that outage from a truly empty book; success clears it.
  const c = sb();
  if (!c || !ownerId) { RTC.commitmentsError = !!ownerId; return RTC.commitments; }
  if (!force && RTC.commitments.length && Date.now() - RTC.commitmentsAt < FRESH_MS) return RTC.commitments;
  const col = kind === 'practice' ? 'practice_id' : 'team_id';
  try {
    // `active` sorts first, so the cap can only ever drop long-retired rows, never a live 5 AM
    // roll call. A book does not hold 200 standing commitments; unbounded, this grew forever.
    const { data, error } = await c.from('commitments')
      .select('*').eq(col, ownerId).order('active', { ascending: false }).order('starts_min').limit(200);
    if (error) { RTC.commitmentsError = true; return RTC.commitments; }
    RTC.commitments = data || [];
    RTC.commitmentsAt = Date.now();
    RTC.commitmentsError = false;
    return RTC.commitments;
  } catch { RTC.commitmentsError = true; return RTC.commitments; }
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
    RTC.boardAt = 0;        // force the next board read
    RTC.commitmentsAt = 0;  // and the next manage-screen read
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

/* excuseAthlete() USED TO LIVE HERE (removed 2026-09-02, founder).
   It wrapped the staff_excuse_athlete RPC: one call excused an athlete across a date range and
   cleared every commitment in it. The roll-call board's "Excuse" chip was its only caller, and
   that chip is gone, so the client no longer holds a path to excuse anyone off a roll call.
   Deliberately NOT touched: the RPC itself still exists server-side (older builds in the field
   still call it, and it is what the roster's absence tool leans on for a range), and every
   already-excused row still reads as Excused everywhere. The capability that was removed is the
   coach's one-tap excuse ON a morning, which erased the morning and left no reason behind.
   Override is the replacement: attributed, reasoned, and visible to the athlete. */

/** Pause, resume, or retire a standing commitment. Retiring is `active = false`, never a delete:
 *  the instances and responses already recorded against it are history a coach acted on. */
export async function setCommitmentActive(commitment, active) {
  if (!commitment || !commitment.id) return null;
  return saveCommitment({ ...commitment, active: !!active });
}

/** Reaches ONLY athletes who have not responded. Returns how many were notified. */
/* "Remind N missing" on the coach board.
   Goes through the roll-call-coach edge function rather than the remind_missing RPC, because the
   RPC only ever INSERTED notification rows — it cannot push. A reminder that lands in a bell the
   athlete will read at noon is not a reminder for a 5 AM roll call, so the button was, for its
   whole life, a silent no-op to the one person it was aimed at. The function writes the same
   durable rows AND pushes, and the push carries a fresh one-tap "I'm Up" of its own.

   It also fixes who gets reminded: remind_missing filters status='pending', but the escalation
   ladder marks everyone 'missed' at the deadline, so after 5:02 AM the RPC matched nobody. See
   rollcall_nudge_claim (0209).

   FALLBACK: on a transport failure or a 5xx we fall back to the old RPC, so the button keeps
   working if this proto ships ahead of the function's deploy. A 4xx is a real refusal (not staff,
   too soon) and must NOT be retried against a path with a weaker check.

   Returns { sent, reason }. The reason matters because the server now rate-limits nudges (one per
   instance per 10 minutes, so two assistant coaches cannot double-buzz a roster): a refused nudge
   and a failed one are opposite facts, and rendering "Couldn't send" over a 429 would tell a coach
   to press again at the one moment pressing again is exactly wrong. */
export async function remindMissing(instanceId) {
  const c = sb(); if (!c || !instanceId) return { sent: 0, reason: 'failed' };
  try {
    const { data, error } = await c.functions.invoke('roll-call-coach', {
      body: { instance: instanceId, action: 'nudge' },
    });
    if (!error && data && data.ok) return { sent: Number(data.targeted) || 0, reason: 'ok' };
    // FunctionsHttpError exposes the status; anything 4xx is a decided answer, not a hiccup.
    const status = error && error.context && error.context.status;
    if (status === 429) return { sent: 0, reason: 'rate_limited' };
    if (status === 403) return { sent: 0, reason: 'not_authorized' };
    if (status && status < 500) return { sent: 0, reason: 'failed' };
  } catch { /* fall through to the RPC */ }
  try {
    const { data, error } = await c.rpc('remind_missing', { p_instance: instanceId });
    if (error) return { sent: 0, reason: 'failed' };
    return { sent: Number(data) || 0, reason: 'ok' };
  } catch { return { sent: 0, reason: 'failed' }; }
}

/** Ping ONE athlete from their row on the board (0211). Same function, same authorization, its
 *  own per-athlete cooldown on the server. Returns { sent, reason } exactly like remindMissing.
 *  No RPC fallback: the single-athlete path only exists on the function. */
export async function pingAthlete(instanceId, athleteId) {
  const c = sb(); if (!c || !instanceId || !athleteId) return { sent: 0, reason: 'failed' };
  try {
    const { data, error } = await c.functions.invoke('roll-call-coach', {
      body: { instance: instanceId, action: 'nudge', athlete: athleteId },
    });
    if (!error && data && data.ok) return { sent: Number(data.targeted) || 0, reason: 'ok' };
    const status = error && error.context && error.context.status;
    if (status === 429) return { sent: 0, reason: 'rate_limited' };
    if (status === 403) return { sent: 0, reason: 'not_authorized' };
    return { sent: 0, reason: 'failed' };
  } catch { return { sent: 0, reason: 'failed' }; }
}

/** Tell the roster a day was moved or skipped (0216): one push in the coach's name, server-side
 *  cooldown per occurrence. `rate_limited` is a success from the coach's side (they were told
 *  minutes ago); the board reads `schedule_notified_at` to say when. */
export async function notifyScheduleChange(instanceId) {
  const c = sb(); if (!c || !instanceId) return { sent: 0, reason: 'failed' };
  try {
    const { data, error } = await c.functions.invoke('roll-call-coach', {
      body: { instance: instanceId, action: 'schedule' },
    });
    if (!error && data && data.ok) { for (const b of RTC.boards.values()) b.at = 0; for (const u of RTC.upcoming.values()) u.at = 0; RTC.boardAt = 0; return { sent: Number(data.targeted) || 0, reason: 'ok' }; }
    const status = error && error.context && error.context.status;
    if (status === 429) return { sent: 0, reason: 'rate_limited' };
    if (status === 403) return { sent: 0, reason: 'not_authorized' };
    if (status === 404) return { sent: 0, reason: 'no_instance' };
    return { sent: 0, reason: 'failed' };
  } catch { return { sent: 0, reason: 'failed' }; }
}

/** "Change today's message" (0211): edits the OCCURRENCE, never the standing rule. An empty
 *  string clears the override so the standing message shows again. */
export async function setInstanceMessage(instanceId, message) {
  const c = sb(); if (!c || !instanceId) return false;
  try {
    const { error } = await c.rpc('set_instance_message', {
      p_instance: instanceId, p_message: (message || '').slice(0, 1000) || null });
    if (error) return false;
    RTC.boardAt = 0;
    return true;
  } catch { return false; }
}

/** Resolve a delayed-sync review (0212): 'accepted' (the coach validates the device tap time),
 *  'late' or 'missed' (judged on the server receipt). Audited server-side. */
export async function resolveSyncReview(responseId, resolution, note) {
  const c = sb(); if (!c || !responseId) return false;
  try {
    const { error } = await c.rpc('resolve_sync_review', {
      p_response: responseId, p_resolution: resolution, p_note: (note || '').slice(0, 120) || null });
    if (error) return false;
    RTC.boardAt = 0;
    return true;
  } catch { return false; }
}

/* ---------------------------------------------------------------- live updates (0212)
   The pattern from screens/meal.js and screens/nutrition-chat.js: Supabase Realtime is the fast
   path, a self-rescheduling poll is the floor, and the socket status flips the poll cadence. The
   caller owns the lifetime: it calls the returned stop() when its root leaves the DOM. Nothing is
   assumed about the publication; if the channel never reaches SUBSCRIBED the poll carries it. */
const LIVE_FAST_MS = 8_000;    // socket down, roll call open: poll often
const LIVE_SLOW_MS = 30_000;   // socket up: the poll is only a safety net
const LIVE_IDLE_MS = 60_000;   // roll call closed: nothing moves fast any more

/** Watch one instance's responses. `onChange()` fires on every row event and every poll tick;
 *  `isIdle()` lets the caller slow the floor once the roll call has closed. */
export function subscribeBoard(instanceId, onChange, isIdle) {
  return liveWatch(`rollcall_board:${instanceId}`, `instance_id=eq.${instanceId}`, onChange, isIdle);
}
/** Watch the signed-in athlete's own rows, so a lock-screen tap paints its receipt in the app. */
export function subscribeMine(athleteId, onChange, isIdle) {
  return liveWatch(`rollcall_mine:${athleteId}`, `athlete_id=eq.${athleteId}`, onChange, isIdle);
}
function liveWatch(name, filter, onChange, isIdle) {
  const c = sb();
  let live = false, stopped = false, timer = null, ch = null;
  const tick = () => {
    if (stopped) return;
    try { onChange({ via: 'poll', live }); } catch { /* the caller's problem */ }
    const ms = (isIdle && isIdle()) ? LIVE_IDLE_MS : live ? LIVE_SLOW_MS : LIVE_FAST_MS;
    timer = setTimeout(tick, ms);
  };
  timer = setTimeout(tick, live ? LIVE_SLOW_MS : LIVE_FAST_MS);
  if (c && typeof c.channel === 'function') {
    try {
      ch = c.channel(name)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'commitment_responses', filter },
          () => { if (!stopped) { try { onChange({ via: 'realtime', live: true }); } catch { /* no-op */ } } })
        .subscribe((status) => { live = status === 'SUBSCRIBED'; });
    } catch { ch = null; }
  }
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (ch && c) { try { c.removeChannel(ch); } catch { /* no-op */ } }
    },
    get live() { return live; },
  };
}

/** The coach's per-occurrence verdict counts for one standing roll call (0211).
 *  null = FAILED (fetcher contract), [] = genuinely nothing yet. */
export async function loadRollcallSummary(commitmentId, days = 14) {
  const c = sb(); if (!c || !commitmentId) return null;
  try {
    const { data, error } = await c.rpc('rollcall_summary', { p_commitment: commitmentId, p_days: days });
    if (error) return null;
    return Array.isArray(data) ? data : [];
  } catch { return null; }
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

/* ---------------------------------------------------------------- consent (0139) */

/** Ask the SERVER whether this athlete may have their location verified. Deliberately not derived
 *  client-side: state.js's _isProvableMinor() treats an unknown age as an ADULT (the 0050 live-beta
 *  ruling), while has_verification_consent() fails CLOSED and treats it as a minor. Guessing here
 *  would show an athlete a switch the server then refuses. Returns true/false, or null if we
 *  couldn't ask — a null must render as "we don't know yet", never as "you're allowed". */
export async function loadVerificationConsent() {
  const c = sb(); if (!c) return null;
  try {
    const { data: u } = await c.auth.getUser();
    const uid = u && u.user && u.user.id;
    if (!uid) return null;
    const { data, error } = await c.rpc('has_verification_consent', { p_athlete: uid });
    if (error) return null;
    return data === true;
  } catch { return null; }
}

/** Ask a guardian to approve location verification. Rides the existing guardian request flow —
 *  through roles.js so the guardian actually receives an email (the raw RPC records the row but
 *  never sends anything; see requestGuardianConsent there). */
export async function requestVerificationConsent(email) {
  const { requestGuardianConsent } = await import('./roles.js');
  const r = await requestGuardianConsent(email);
  return !!(r && r.ok);
}

/** The GUARDIAN side of 0139 consent: a linked parent approves location verification for one
 *  athlete. Server-authorized (is_guardian_of); anyone else gets a refusal, not a row. */
export async function grantVerificationConsent(athleteId) {
  const c = sb(); if (!c || !athleteId) return false;
  try {
    const { error } = await c.rpc('grant_verification_consent', {
      p_athlete: athleteId, p_kind: 'guardian', p_team: null, p_note: null });
    return !error;
  } catch { return false; }
}

/** Consent state for ONE athlete (a guardian checking a child, not just self). */
export async function verificationConsentFor(athleteId) {
  const c = sb(); if (!c || !athleteId) return null;
  try {
    const { data, error } = await c.rpc('has_verification_consent', { p_athlete: athleteId });
    if (error) return null;
    return data === true;
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
