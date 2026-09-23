/* OnStandard: the Team Board and "Your day" (roll call rebuilt, Task 9, 2026-09-23).

   The founder's heart of the rebuild. One live team moment: every teammate's face lights up in the
   order they got up, first up is called out, the athlete's own face and place are clear, late is
   amber, missed turns red only after the close (the SERVER says so, never this clock), excused is
   muted. The athlete lands here from the lock screen, the alarm's second button, the in-app alarm
   face and the Home card; one swipe (or the Your day tab) is the rest of their day.

   ROUTES are path subs, never query strings (Ruling R2):
     rollcall-board/<id>          the board
     rollcall-board/<id>/day      Your day (athlete; the swipe target)
     rollcall-board/<id>/missed   the coach's closing-summary push: the board, scrolled to Missed

   ONE MODULE, BOTH ROLES. An operator (coach, trainer) gets the same board with every face a
   button (Nudge, Override with a required reason) and a sticky "Nudge everyone not up" while the
   window is open. `nav` is a getter for that reason: the operator's own tab bar for them, the
   athlete's for the athlete; `anyRole` keeps the router's mirror guard from bouncing either.

   THE SERVER DECIDES. Groups, places, verdicts and the arrival state all come from
   rollcall_team_board (0242) through js/team-board.js; this file arranges and acts. The live feed
   is subscribeTeamBoard (Realtime plus an 8 s poll while open); a repaint replaces only the live
   region, so the header, the tab strip, the scroll and an open sheet all stay put, and a face
   that arrives while you watch animates in (css: .rb-new, ease-out, reduced motion honoured).

   Styles: css/screens.css, the `rb-` block. */
import { icon } from '../icons.js';
import { track, EVENTS } from '../analytics.js';
import { backHead, esc, skeletonRows, emptyState, errorState, sayStatus } from '../components.js';
import { boardModel, boardHtml, boardMode, ordinal } from '../team-board.js';
import {
  VC, loadTeamBoard, subscribeTeamBoard, invalidateTeamBoard, ackCommitment, ackRefusal,
  remindMissing, pingAthlete, setResponse, loadMine, loadBoardFor, todayISO,
} from '../commitment-data.js';
import { ROLLCALL_OPEN_BEFORE_MIN, ROLLCALL_OFF, opensAtOf } from '../commitments.js';
import { RT, S, act, liveWeights } from '../state.js';
import { DAY, daySetWakeup, daySetArrival } from '../day.js';
import { myWakeupForDay, myArrivalForDay } from '../wakeup-morning.js';
import { fmtMin } from '../requirements.js';
import { clockTime, weekdayLong, dateKey } from '../fmt-date.js';
import { hydrateAvatars } from '../avatar.js';
import { overlayOpen } from '../overlay-guard.js';
import { afterGesture } from '../gestures.js';
import { buzz } from '../motion.js';
import { CD, bookId, loadBook, bookKindFor } from '../coach-data.js';
import {
  locationCapable, locationAskFor, locationAskClick, probeLocation, locationStateCached, checkInHere, hereErrorLine,
  probeConsent, consentCached,
} from '../location.js';

/* ---------------------------------------------------------------- routes */

/** 'abc' -> board, 'abc/day' -> Your day, 'abc/missed' -> the board scrolled to Missed. */
export function parseSub(sub) {
  const [id = '', view = ''] = String(sub || '').split('/');
  return { id, view: view === 'day' || view === 'missed' ? view : 'board' };
}
const isOperator = () => RT.authRole === 'coach' || RT.authRole === 'trainer';
/* The instance on the hash right now: what the swipe pager pairs the board with its day. */
function idOnHash() {
  const raw = String((typeof location !== 'undefined' && location.hash) || '').replace(/^#/, '');
  const [route, id] = raw.split('/');
  return route === 'rollcall-board' ? (id || '') : '';
}

/* ---------------------------------------------------------------- time */

const at = (iso) => { const t = Date.parse(iso || ''); return isFinite(t) ? t : null; };
const clock = (iso) => (at(iso) == null ? '' : clockTime(iso));
function dayWord(iso) {
  const t = at(iso);
  if (t == null) return 'Today';
  return dateKey(new Date(t)) === dateKey(new Date()) ? 'Today' : weekdayLong(new Date(t));
}

/* ---------------------------------------------------------------- per-instance notes */

/* Notes that must survive a live repaint: the last I'm here result and the last I'm Up failure,
   keyed by instance so one morning's note never paints onto another. */
const HERE_NOTE = new Map();   // id -> { text, error }
const ACK_NOTE = new Map();    // id -> text
/* An I'm Up write in flight, per instance. A live repaint during the await would otherwise draw a
   fresh, ENABLED button under the athlete's thumb (a second tap, a second write). While busy the
   button renders as "Saving…", disabled, whatever repaints. */
const ACK_BUSY = new Set();
/** Test and harness seam: mark an instance's I'm Up as in flight (or not). */
export function markAckBusy(id, on = true) { if (on) ACK_BUSY.add(id); else ACK_BUSY.delete(id); }

/** Did the answer land? The write's own stamp says yes; without one, the SERVER's row decides
 *  (a lost reply to a write that committed must never read "Didn't save"). */
export function ackLanded(stamp, board, selfId) {
  if (stamp) return true;
  const r = board && Array.isArray(board.rows) && selfId ? board.rows.find((x) => x && x.athlete_id === selfId) : null;
  return !!(r && (r.acknowledged_at || r.verdict === 'on_standard' || r.verdict === 'late' || r.verdict === 'review'));
}
/* Faces already up at the last paint, per instance: the ones not in here arrived while the
   athlete watched and get the arrival motion. Never replays on a same-route repaint. */
const SEEN = new Map();

/* ---------------------------------------------------------------- the athlete's actions */

const myRow = (board, selfId) => (board && Array.isArray(board.rows) && selfId
  ? board.rows.find((r) => r && r.athlete_id === selfId) || null : null);

/** What the athlete can do right now. Pure over the board, their own cached row and the clock. */
export function athleteActions(board, selfId, nowISO, mine = null) {
  const mode = boardMode(board);
  const m = boardModel(board, selfId, nowISO);
  const row = myRow(board, selfId);
  const now = at(nowISO);
  const starts = at(board && board.starts_at);
  const opens = mine ? at(opensAtOf(mine)) : (starts == null ? null : starts - ROLLCALL_OPEN_BEFORE_MIN * 60_000);
  const respondBy = at(board && board.respond_by_at) ?? starts;
  const answeredHere = !!(mine && mine.acknowledged_at);
  const isOpen = now != null && (opens == null || now >= opens) && !m.closed;
  const canAck = mode !== 'arrival' && !!row && row.verdict === 'pending' && !answeredHere && isOpen;
  const beforeOpen = mode !== 'arrival' && !!row && row.verdict === 'pending' && !answeredHere && now != null && opens != null && now < opens;
  const late = canAck && respondBy != null && now > respondBy;
  const av = row && row.arrival_verdict;
  const canHere = m.asksArrival && !!row && row.verdict !== 'excused' && (av === 'pending' || av === 'unverified') && !m.closed;
  return { m, row, canAck, beforeOpen, late, canHere, pendingSync: !!(mine && mine.pendingSync), opensAt: opens };
}

/* The morning's points, as the score counts them (day.js weightsForDay): the wake-up and the
   arrival each take their share of the one 8-point budget, full on time, half late. The live
   weights are the truth; before Home has published today's roll call they still read 0, so the
   share falls back on the board's own mode (8 alone, 4 each when both). */
export function morningShare(mode, part, weights = null) {
  const w = weights && typeof weights === 'object' ? weights[part] : null;
  if (typeof w === 'number' && w > 0) return Math.round(w * 100);
  return mode === 'both' ? 4 : 8;
}
const credit = (v, n) => (v === 'on_standard' ? n : v === 'late' ? Math.round(n / 2) : 0);

/** { points, late, words } banked so far this morning, or null when nothing is banked yet. */
export function bankedFor(board, selfId, weights = null) {
  const row = myRow(board, selfId);
  if (!row) return null;
  const mode = boardMode(board);
  let points = 0; let late = false; const words = [];
  if (mode !== 'arrival' && (row.verdict === 'on_standard' || row.verdict === 'late')) {
    points += credit(row.verdict, morningShare(mode, 'wakeup', weights));
    late = late || row.verdict === 'late';
    words.push(row.verdict === 'late' ? 'Up late' : 'Up on time');
  }
  if (mode !== 'wake' && (row.arrival_verdict === 'on_standard' || row.arrival_verdict === 'late')) {
    points += credit(row.arrival_verdict, morningShare(mode, 'arrival', weights));
    late = late || row.arrival_verdict === 'late';
    words.push(row.arrival_verdict === 'late' ? 'here late' : 'here on time');
  }
  if (!words.length) return null;
  const said = words.join(', ');
  return { points, late, words: said.charAt(0).toUpperCase() + said.slice(1) };
}

/* ---------------------------------------------------------------- Your day */

const PILL_CLS = { gray: 'muted', gold: 'a', red: 'r', green: 'g' };

/* One row of the rest of today. A meal reads when it CLOSES and carries no log button (founder,
   2026-09-23: most people do not eat the moment they wake up); nothing on this page is a log
   control. Only a real state earns a pill: due soon (amber), late or missed. */
function dayRow(it) {
  const meal = it.proof === 'photo';
  const due = it.window && typeof it.window.due === 'number' ? fmtMin(it.window.due) : '';
  const overdue = it.state === 'overdue';
  let sub;
  if (meal && due) sub = overdue ? `Was due ${due}` : `Closes ${due}`;
  else if (overdue && due) sub = `Was due ${due}`;
  else { const s = String(it.sub || it.dueLabel || ''); sub = s.charAt(0).toUpperCase() + s.slice(1); }
  const pill = it.state === 'due_soon' || overdue
    ? `<span class="status-pill ${PILL_CLS[it.color] || 'muted'}">${esc(it.pill || '')}</span>` : '';
  return `<li class="lrow rb-drow"><span class="lic">${icon(it.icon || 'clock', 18)}</span>`
    + `<div class="lm"><div class="lt">${esc(it.title)}</div><div class="ls">${esc(sub)}</div></div>${pill}</li>`;
}

/** Your day, pure over its inputs so it holds still in a test: the coach's message, what the
 *  morning banked, and the rest of today. `items` are S.exec items. */
export function dayHtml({ items = [], message = '', coachName = '', fromTime = '', banked = null, pendingLine = '' } = {}) {
  const open = (items || []).filter((i) => i && !['done', 'done_late', 'not_required'].includes(i.state));
  const dueOf = (i) => (i.window && typeof i.window.due === 'number' ? i.window.due : 1e9);
  open.sort((a, b) => dueOf(a) - dueOf(b));
  const who = coachName || 'Your coach';
  const msg = message
    ? `<figure class="rb-msg"><figcaption class="rb-msg-from">${esc(who)}${fromTime ? ` · ${esc(fromTime)}` : ''}</figcaption>`
      + `<blockquote class="rb-bubble">${esc(message)}</blockquote></figure>`
    : '';
  const bank = banked
    ? `<p class="rb-banked${banked.late ? ' late' : ''}"><span class="rb-bk-k">Roll call banked</span>`
      + ` · <span class="rb-bk-s">${esc(banked.words || '')}${banked.late ? ', half credit' : ''}</span>`
      + ` <span class="rb-bk-n">+${esc(banked.points)}</span></p>`
    : pendingLine ? `<p class="rb-bk-wait">${esc(pendingLine)}</p>` : '';
  const breakfastOpen = open.some((i) => i.id === 'breakfast' && i.state !== 'overdue');
  const list = open.length
    ? `<h2 class="eyebrow rb-dh">Rest of today</h2><ul class="card rows list rb-dlist">${open.map(dayRow).join('')}</ul>`
      + (breakfastOpen ? '<p class="rb-foot">We’ll remind you before breakfast closes.</p>' : '')
    : emptyState({ icon: 'check', title: 'Nothing else due today', body: 'Everything on today’s list is in.', compact: true });
  return `<div class="rb-day">${msg}${bank}${list}</div>`;
}

/* ---------------------------------------------------------------- markup */

function headSub(board) {
  const mode = boardMode(board);
  const when = mode === 'arrival' ? (board.arrive_by_at ? `by ${clock(board.arrive_by_at)}` : clock(board.starts_at)) : clock(board.starts_at);
  return [dayWord(board.starts_at), when, board.coach_name].filter(Boolean).join(' · ');
}
function whenLine(board, m) {
  // Arrival only: the header already says "by 3:30 PM"; a third copy on the count is noise.
  if (m.mode === 'arrival') return '';
  if (!board.closes_at) return '';
  return `${m.closed ? 'Closed' : 'Closes'} ${clock(board.closes_at)}`;
}
function title(board) {
  return boardMode(board) === 'arrival' ? (board.title || 'Check-in') : 'Roll call';
}

/* The athlete's action block: I'm Up (the one primary), or I'm here (primary when it is the only
   thing left to do), each with the one line that says where they stand. */
function athleteActionHtml(board, id, a, mine) {
  const place = board.location_name || 'the check-in spot';
  const label = (mine && mine.action_label && String(mine.action_label).trim()) || 'I’m Up';
  const note = ACK_NOTE.get(id);
  const here = HERE_NOTE.get(id);
  let out = '';
  if (ACK_BUSY.has(id)) {
    out += '<button type="button" class="btn primary rb-up" data-rb-ack-busy disabled aria-busy="true">Saving…</button>'
      + '<p class="rb-line" id="rb-ack-say" role="status" aria-live="polite">Checking you in</p>';
  } else if (a.canAck) {
    const line = note ? note
      : a.late ? `Late now. It still counts for half until ${clock(board.closes_at)}.`
      : `On time until ${clock(board.respond_by_at || board.starts_at)}`;
    out += `<button type="button" class="btn primary rb-up" data-rb-ack="${esc(id)}">${esc(label)}</button>`
      + `<p class="rb-line${a.late || note ? ' warn' : ''}" id="rb-ack-say" role="status" aria-live="polite">${esc(line)}</p>`;
  } else if (a.beforeOpen && a.opensAt != null) {
    out += `<p class="rb-line">Opens at ${esc(clock(new Date(a.opensAt).toISOString()))}. We’ll ring you.</p>`;
  } else if (a.pendingSync) {
    out += '<p class="rb-line">Answered on this phone. It sends when you reconnect.</p>';
  }
  if (a.canHere && !locationCapable()) {
    // An app build from before location came back (final review I-2): no button that cannot work,
    // and never a "verdict" made up from a phone that took no reading. One line, the real cause.
    out += '<p class="rb-line" id="rb-here-say" role="status">Update OnStandard to check in by location.</p>';
  } else if (a.canHere) {
    const primary = !a.canAck;
    out += `<button type="button" class="btn ${primary ? 'primary' : 'ghost'} rb-herebtn" data-rb-here="${esc(id)}">${icon('pin', 18)} I’m here</button>`
      + `<p class="rb-line${here && here.error ? ' warn' : ''}" id="rb-here-say" role="status" aria-live="polite">${esc(here ? here.text
        : primary ? `Takes one location reading now and checks it against ${place}.` : `At ${place}${board.arrive_by_at ? ` by ${clock(board.arrive_by_at)}` : ''}`)}</p>`
      // The permission ask, in context (final fix round, item 2): While Using explained before the
      // phone's prompt, Always offered only after, Settings after a No. '' when nothing to ask.
      + locationAskFor(place, !!RT.locationOptOut);
  }
  return out ? `<div class="rb-act">${out}</div>` : '';
}

function liveHtml(id, view, nowISO) {
  const board = VC.teamBoard(id);
  const coach = isOperator();
  const selfId = coach ? null : RT.userId;
  const m = boardModel(board, selfId, nowISO);
  const stale = VC.teamBoardError(id)
    ? '<p class="rb-stale" role="status">Showing the last update. Reconnecting.</p>' : '';
  if (view === 'day' && !coach) {
    const mine = VC.instance(id);
    const banked = bankedFor(board, selfId, safeWeights());
    const a = athleteActions(board, selfId, nowISO, mine);
    let items = [];
    try { items = (S.exec && S.exec.items) || []; } catch { items = []; }
    const pendingLine = a.canAck ? `Tap ${(mine && mine.action_label) || 'I’m Up'} on the Team tab to bank your morning.` : '';
    return stale + dayHtml({
      items, message: (mine && mine.message) || board.message || '', coachName: board.coach_name || '',
      fromTime: clock(board.starts_at), banked, pendingLine,
    });
  }
  const when = whenLine(board, m);
  if (coach) {
    const waiting = m.groups.waiting.filter((r) => r.verdict === 'pending').length;
    const bar = !m.closed && m.mode !== 'arrival' && waiting
      ? `<div class="action-bar rb-bar"><button type="button" class="btn primary" id="rb-nudge-all" data-inst="${esc(id)}">${icon('bell', 18)} Nudge everyone not up <span class="rb-bar-n">${waiting}</span></button></div>`
      : '';
    const hint = m.total ? `<p class="rb-hint">Tap a face to ${m.closed ? 'override with a reason' : 'nudge or override'}.</p>` : '';
    return stale + boardHtml(m, { coach: true, when }) + hint + bar;
  }
  const a = athleteActions(board, selfId, nowISO, VC.instance(id));
  return stale + athleteActionHtml(board, id, a, VC.instance(id)) + boardHtml(m, { coach: false, when });
}

function safeWeights() { try { return liveWeights(); } catch { return null; } }

/* The strip that makes the swipe discoverable. Plain navigation (data-go), so the router pairs
   it with the pager: the two views are siblings, not a push. */
function tabs(id, view) {
  const t = (to, label, on) => `<button type="button" role="tab" aria-selected="${on ? 'true' : 'false'}" class="${on ? 'on' : ''}" data-go="${esc(to)}">${label}</button>`;
  return `<div class="seg rb-seg" role="tablist" aria-label="Roll call views">${t(`rollcall-board/${id}`, 'Team', view !== 'day')}${t(`rollcall-board/${id}/day`, 'Your day', view === 'day')}</div>`;
}

/* ---------------------------------------------------------------- coach sheet */

const SAY = { rate_limited: 'Just nudged. Try again in a few minutes', not_authorized: 'You can’t nudge here', ok: 'Everyone is in' };

function closeSheet(focusBack) {
  document.querySelectorAll('.rb-sheet-scrim, .sheet.rb-sheet').forEach((n) => n.remove());
  document.removeEventListener('keydown', sheetKey);
  window.removeEventListener('hashchange', closeSheetQuiet);
  if (focusBack && typeof focusBack.focus === 'function') { try { focusBack.focus(); } catch { /* gone */ } }
}
function closeSheetQuiet() { closeSheet(null); }
let SHEET_OPENER = null;
function sheetKey(e) { if (e.key === 'Escape') closeSheet(SHEET_OPENER); }

/* The coach's response row for one athlete (commitment_board, 0216): Override needs its id and the
   team board never carries one. Loaded on demand from the coach's own board for that day. */
async function responseIdFor(id, athleteId, board) {
  if (!athleteId) return null;
  const find = () => {
    const inst = VC.instance(id);
    const r = inst && Array.isArray(inst.rows) ? inst.rows.find((x) => x && x.athlete_id === athleteId) : null;
    return (r && r.response_id) || null;
  };
  let rid = find();
  if (rid) return rid;
  // A cold launch from the closing-summary push can land here before the book has loaded.
  if (!bookId()) { try { await loadBook(false, bookKindFor(RT.authRole)); } catch { /* said below */ } }
  const bid = bookId();
  if (!bid) return null;
  const day = board && at(board.starts_at) != null ? dateKey(new Date(at(board.starts_at))) : todayISO();
  // loadBoardFor, never loadBoard: the latter owns the coach Home's TODAY slot, and a board opened
  // for another day would repaint Home with that day's roster.
  try { await loadBoardFor(bid, CD.kind, day, true); } catch { /* the caller says so */ }
  rid = find();
  return rid;
}

function sheetState(r, kind, m) {
  const t = clock(m.mode === 'arrival' ? r.arrived_at : r.acknowledged_at);
  const place = m.mode === 'arrival' ? (m.places && m.places.get(r.athlete_id)) : r.place;
  const base = kind === 'up' ? `On time · ${place ? `${ordinal(place)} at ` : ''}${t}`
    : kind === 'late' ? `Late · ${t}`
    : kind === 'missed' ? (m.mode === 'arrival' ? 'Not here' : 'Missed')
    : kind === 'excused' ? 'Excused'
    : kind === 'unverified' ? 'Place not confirmed'
    : r.verdict === 'review' ? 'Being checked: their tap reached us late'
    : (m.mode === 'arrival' ? 'Not here yet' : 'Not up yet');
  const arr = m.asksArrival && m.mode !== 'arrival' && kind !== 'excused'
    ? (r.arrival_verdict === 'on_standard' || r.arrival_verdict === 'late' ? ` · here ${clock(r.arrived_at)}`
      : r.arrival_verdict === 'missed' ? ' · not here' : r.arrival_verdict === 'unverified' ? ' · place not confirmed' : ' · not here yet')
    : '';
  return base + arr;
}

function openSheet(root, id, athleteId, opener, repaint) {
  if (overlayOpen()) return;
  const board = VC.teamBoard(id);
  const m = boardModel(board, null, new Date().toISOString());
  const kinds = ['up', 'late', 'waiting', 'missed', 'excused', 'unverified'];
  let kind = null; let r = null;
  for (const k of kinds) { const hit = (m.groups[k] || []).find((x) => x.athlete_id === athleteId); if (hit) { kind = k; r = hit; break; } }
  if (!r) return;
  const full = String(r.name || m.names[athleteId] || 'Athlete');
  const first = m.names[athleteId] || full;
  const canNudge = kind === 'waiting' && r.verdict === 'pending' && !m.closed && m.mode !== 'arrival';
  const canOverride = (kind === 'waiting' && r.verdict === 'pending') || kind === 'missed';
  const review = kind === 'waiting' && r.verdict === 'review';
  const host = root.querySelector('.screen') || root;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="sheet-scrim rb-sheet-scrim" data-rb-close></div>
    <div class="sheet rb-sheet" role="dialog" aria-modal="true" aria-labelledby="rb-sheet-t">
      <div class="grab"></div>
      <div class="rb-sh-who">
        <span class="rb-av" data-avatar-uid="${esc(athleteId)}" aria-hidden="true"><span data-avatar-fallback>${esc((full.match(/\b\p{L}/gu) || ['?']).slice(0, 2).join('').toUpperCase())}</span></span>
        <div class="rb-sh-t"><div class="sh-title" id="rb-sheet-t" tabindex="-1">${esc(full)}</div><div class="rb-sh-s">${esc(sheetState(r, kind, m))}</div></div>
      </div>
      ${canNudge || canOverride ? `<div class="rb-sh-acts">
        ${canNudge ? `<button type="button" class="btn primary" id="rb-nudge-one">${icon('bell', 18)} Nudge ${esc(first)}</button>` : ''}
        ${canOverride ? `<button type="button" class="btn ${canNudge ? 'ghost' : 'primary'}" id="rb-ovr-open" aria-expanded="false" aria-controls="rb-ovr">Override</button>` : ''}
      </div>` : ''}
      ${canOverride ? `<div class="rb-ovr" id="rb-ovr" hidden>
        <label class="rb-ovr-l" for="rb-ovr-why">Why? ${esc(first)} sees this on their record.</label>
        <input class="input" id="rb-ovr-why" maxlength="120" autocomplete="off" placeholder="Reason (required)">
        <button type="button" class="btn primary" id="rb-ovr-save">Mark on standard</button>
      </div>` : ''}
      ${review ? `<button type="button" class="sheet-row" data-go="coach-commitments/${esc(id)}/review"><span class="si">${icon('clock', 20)}</span><span class="st"><span class="t">Resolve the late tap</span><span class="s">Accept their phone’s time or keep it late</span></span>${icon('chevron', 16)}</button>` : ''}
      <p class="rb-sh-say" id="rb-sh-say" role="status" aria-live="polite"></p>
      <button type="button" class="cancel" data-rb-close>Close</button>
    </div>`;
  host.append(...wrap.children);
  const sheet = host.querySelector('.sheet.rb-sheet');
  if (!sheet) return;
  SHEET_OPENER = opener;
  hydrateAvatars(sheet);
  document.addEventListener('keydown', sheetKey);
  window.addEventListener('hashchange', closeSheetQuiet);
  host.querySelectorAll('[data-rb-close]').forEach((n) => n.addEventListener('click', () => closeSheet(opener)));
  sheet.querySelectorAll('[data-go]').forEach((n) => n.addEventListener('click', () => closeSheet(null)));
  const titleEl = sheet.querySelector('#rb-sheet-t'); if (titleEl) { try { titleEl.focus({ preventScroll: true }); } catch { /* no focus */ } }
  const say = sheet.querySelector('#rb-sh-say');
  // Look this athlete's record up now, so Mark on standard does not wait on a fetch.
  if (canOverride) void responseIdFor(id, athleteId, board);

  const one = sheet.querySelector('#rb-nudge-one');
  if (one) one.addEventListener('click', async () => {
    one.disabled = true; one.textContent = 'Sending…';
    const { sent, reason } = await pingAthlete(id, athleteId);
    if (sent) track(EVENTS.VC_REMINDED, { n: 1, single: true });
    one.textContent = sent ? `Nudged ${first}` : reason === 'rate_limited' ? 'Just nudged' : reason === 'ok' ? 'Already up' : reason === 'not_authorized' ? 'Not allowed' : 'Couldn’t nudge';
    if (!sent && reason === 'failed') { one.disabled = false; sayStatus(say, 'Couldn’t reach the server. Try again.', { error: true }); }
    else if (sent) sayStatus(say, `${first}’s phone rings now.`);
  });

  const ovrOpen = sheet.querySelector('#rb-ovr-open');
  const ovr = sheet.querySelector('#rb-ovr');
  if (ovrOpen && ovr) ovrOpen.addEventListener('click', () => {
    ovr.hidden = !ovr.hidden;
    ovrOpen.setAttribute('aria-expanded', ovr.hidden ? 'false' : 'true');
    if (!ovr.hidden) { const i = sheet.querySelector('#rb-ovr-why'); if (i) i.focus(); }
  });
  const save = sheet.querySelector('#rb-ovr-save');
  if (save) save.addEventListener('click', async () => {
    const input = sheet.querySelector('#rb-ovr-why');
    const why = input ? input.value.trim() : '';
    if (!why) { sayStatus(say, 'Give a reason. It goes on the record.', { error: true }); if (input) input.focus(); return; }
    save.disabled = true; save.textContent = 'Saving…';
    const rid = await responseIdFor(id, athleteId, board);
    // No record is not a network blip: retrying cannot find it, so say what can.
    if (!rid) { save.disabled = false; save.textContent = 'Mark on standard'; sayStatus(say, 'Couldn’t find this athlete’s roll call record. Open it from Home.', { error: true }); return; }
    const done = await setResponse(rid, 'acknowledged', why);
    if (!done) { save.disabled = false; save.textContent = 'Mark on standard'; sayStatus(say, 'Couldn’t save. Try again.', { error: true }); return; }
    closeSheet(opener);
    invalidateTeamBoard(id);
    await loadTeamBoard(id, true);
    repaint();
  });
}

/* ---------------------------------------------------------------- the screen */

export default {
  tab: 'home',
  hideTabs: false,
  anyRole: true,
  /* The operator's own tab bar for a coach or trainer, the athlete's for everyone else. */
  get nav() { return isOperator() ? 'operator' : undefined; },
  /* The pager's strip: the board and Your day are siblings (athletes only). */
  get subs() {
    if (isOperator()) return null;
    const id = idOnHash();
    return id ? [id, `${id}/day`] : null;
  },
  resolveSub(sub) { const p = parseSub(sub); return p.view === 'day' ? `${p.id}/day` : p.id; },
  /* The bell's `commitment_escalation` row opens here for every instance it names, and a coach can
     turn on miss digests for a plain commitment too (a study hall with no place). That is not a
     roll call: the board would score it as a wake-up. When a cached row says so, hand it to its
     own screen before painting (router.js redirect). An uncached id stays: the board is right for
     every roll call, and a plain commitment's bell row is opened from an app that has its board. */
  redirect({ sub }) {
    // The client kill switch (final review M-6): with roll call off, a cached link or an old push
    // lands on Home, never on a board the rest of the app no longer offers.
    if (ROLLCALL_OFF) return isOperator() ? (RT.authRole === 'trainer' ? 'trainer' : 'coach-home') : 'home';
    const { id } = parseSub(sub);
    const row = id ? VC.instance(id) : null;
    if (!row || !row.type || row.type === 'morning_roll_call') return null;
    if (row.location_id || row.asks_arrival || row.location_name) return null;   // an arrival board
    return isOperator() ? `coach-commitments/${id}/list` : `roll-call/${id}`;
  },

  render({ sub }) {
    const { id, view } = parseSub(sub);
    const coach = isOperator();
    const back = coach ? 'coach-home' : 'home';
    const board = VC.teamBoard(id);
    if (!board) {
      if (VC.teamBoardError(id)) {
        return `${backHead('Roll call', '', back)}${errorState({
          title: 'This roll call didn’t load',
          body: 'It may have been cancelled, or the connection dropped. Nothing is counted against you for a screen that didn’t load.',
          retryId: 'rb-retry',
        })}`;
      }
      return `${backHead('Roll call', 'Loading…', back)}${skeletonRows(4, 'Loading the team board')}`;
    }
    const nowISO = new Date().toISOString();
    const strip = coach ? '' : tabs(id, view);
    return `${backHead(title(board), headSub(board), back)}${strip}${coach ? '' : '<div class="rb-primer"></div>'}`
      + `<div class="pane"><div class="rb-live${coach ? ' coach' : ''}" data-rb-root="${esc(id)}" data-rb-view="${esc(view)}">${liveHtml(id, view, nowISO)}</div></div>`;
  },

  mount(root, { sub }) {
    const { id, view } = parseSub(sub);
    if (!id) return;
    const coach = isOperator();
    // I4: the athlete's board and Your day carry the same Continue primer as Home.
    if (!coach) {
      const host = root.querySelector('.rb-primer');
      if (host) void import('../notify-permission.js').then((NP) => NP.mountRollcallPrimer(host, VC.mine), () => {});
    }
    const live = root.querySelector(`[data-rb-root="${CSS.escape(id)}"]`);

    const retry = root.querySelector('#rb-retry');
    if (retry) retry.addEventListener('click', async () => {
      retry.disabled = true;
      await loadTeamBoard(id, true);
      if (root.isConnected) window.__render && window.__render();
    });

    const upIds = (m) => new Set(m.groups.up.concat(m.groups.late).map((r) => r.athlete_id));
    const markFresh = (m) => {
      const now = upIds(m);
      const prev = SEEN.get(id);
      SEEN.set(id, now);
      if (!prev || !live) return;
      for (const aid of now) {
        if (prev.has(aid)) continue;
        const av = live.querySelector(`.rb-tile .rb-av[data-avatar-uid="${CSS.escape(aid)}"]`);
        const tile = av && av.closest('.rb-tile');
        if (tile) tile.classList.add('rb-new');
      }
    };
    let lastJson = JSON.stringify(VC.teamBoard(id) || null);
    let lastPhase = '';
    const phaseOf = (b) => {
      if (!b) return '';
      const a = coach ? null : athleteActions(b, RT.userId, new Date().toISOString(), VC.instance(id));
      return `${boardModel(b, null, new Date().toISOString()).closed}|${a ? `${a.canAck}|${a.late}|${a.canHere}|${a.beforeOpen}` : ''}`;
    };
    const paint = () => afterGesture(() => {
      if (!live || !live.isConnected) return;
      const b = VC.teamBoard(id);
      if (!b) return;
      live.innerHTML = liveHtml(id, view, new Date().toISOString());
      hydrateAvatars(live);
      if (view !== 'day') markFresh(boardModel(b, coach ? null : RT.userId, new Date().toISOString()));
      lastJson = JSON.stringify(b); lastPhase = phaseOf(b);
    });
    const b0 = VC.teamBoard(id);
    if (b0 && view !== 'day') {
      markFresh(boardModel(b0, coach ? null : RT.userId, new Date().toISOString()));
      lastPhase = phaseOf(b0);
    }

    // The closing summary's deep link lands on the misses (Ruling R2: a path sub, not a query).
    if (view === 'missed' && live) {
      const grid = live.querySelector('.rb-grid.missed');
      const head = grid && grid.previousElementSibling;
      if (head) requestAnimationFrame(() => { try { head.scrollIntoView({ block: 'start' }); } catch { /* no scroll */ } });
    }

    // LIVE. First board ever: the screen was a skeleton, so the whole screen repaints once (the
    // header needs the board's title and time). After that only the live region moves.
    const hadBoard = !!b0;
    const unsub = subscribeTeamBoard(id, (b) => {
      if (!root.isConnected) return;
      if (!hadBoard) { if (window.__render) window.__render(); return; }
      if (JSON.stringify(b) !== lastJson || phaseOf(b) !== lastPhase) paint();
    });
    // The athlete's own row (the coach's message, their button's words, an answer queued offline)
    // is on my_commitments, which a lock-screen launch may not have read yet.
    if (!coach && !VC.instance(id)) loadMine(true).then(() => { if (root.isConnected) paint(); }, () => {});
    // The coach's response ids, for Override, loaded quietly ahead of the first tap.
    // Warm only when the coach's day board is not cached yet; the sheet looks up the real athlete.
    if (coach && b0 && !(VC.instance(id) && Array.isArray(VC.instance(id).rows))) {
      const bid = bookId();
      const day = at(b0.starts_at) != null ? dateKey(new Date(at(b0.starts_at))) : todayISO();
      if (bid) loadBoardFor(bid, CD.kind, day).catch(() => {});
    }

    // What the phone says about location, for the ask card: asked once the board shows an arrival
    // this athlete can still make, and again on every return (they may have just been in Settings).
    const wantsLoc = () => {
      const b = VC.teamBoard(id);
      return !coach && !!b && locationCapable() && athleteActions(b, RT.userId, new Date().toISOString(), VC.instance(id)).canHere;
    };
    const askLoc = () => {
      if (!wantsLoc()) return;
      const before = locationStateCached();
      const beforeConsent = consentCached();
      // The server's consent rule gates the card (m2); the permission state picks what it says.
      Promise.all([probeConsent(), probeLocation()]).then(([c, st]) => {
        if (st !== before || c !== beforeConsent) paint();
      }, () => {});
    };
    askLoc();
    const onFg = () => { if (root.isConnected) { askLoc(); loadTeamBoard(id, true).then(() => paint()); } };
    window.addEventListener('onstd:foreground', onFg);
    const prev = window.__screenCleanup;
    window.__screenCleanup = () => {
      unsub();
      window.removeEventListener('onstd:foreground', onFg);
      closeSheet(null);
      if (typeof prev === 'function') prev();
    };

    if (!live) return;
    live.addEventListener('click', async (ev) => {
      const t = ev.target instanceof Element ? ev.target : null;
      if (!t) return;

      const ack = t.closest('[data-rb-ack]');
      if (ack && !ack.disabled && !ACK_BUSY.has(id)) {
        ACK_BUSY.add(id);
        ACK_NOTE.delete(id);
        ack.disabled = true; ack.textContent = 'Saving…';
        let stamp = null;
        try { stamp = await ackCommitment(id); } catch { stamp = null; }
        if (!stamp) {
          // Before saying it failed, ask the server: the write may have landed and only its answer
          // been lost. A refusal (closed, not open, cancelled) is a decided answer and needs no check.
          const why = ackRefusal(id);
          let fresh = null;
          if (!why) { invalidateTeamBoard(id); try { fresh = await loadTeamBoard(id, true); } catch { fresh = null; } }
          if (!why && ackLanded(null, fresh, RT.userId)) {
            const r = fresh.rows.find((x) => x && x.athlete_id === RT.userId);
            stamp = (r && r.acknowledged_at) || new Date().toISOString();
          } else {
            ACK_NOTE.set(id, why === 'closed' ? 'This roll call has closed.' : why === 'not_open' ? 'It isn’t open yet.' : why === 'cancelled' ? 'Your coach cancelled this one.' : 'Didn’t save. Check your signal and tap again.');
            buzz('error');
            ACK_BUSY.delete(id);
            paint();
            return;
          }
        }
        buzz('success');
        try { if (navigator.vibrate) navigator.vibrate(10); } catch { /* no-op */ }
        const row = VC.instance(id) || {};
        track(EVENTS.VC_ACKNOWLEDGED, {
          type: row.type || 'morning_roll_call',
          minsEarly: row.respond_by_at ? Math.round((Date.parse(row.respond_by_at) - Date.parse(stamp)) / 60000) : null,
        });
        try {
          if (act && act.notifyCoachEvent) act.notifyCoachEvent({
            kind: `rollcall_answered:${id}`,
            title: `${(S.athlete && S.athlete.first) || 'Your athlete'} answered the roll call`,
            body: `${row.title || 'Roll call'} · Tap to see who is in.`,
            route: `rollcall-board/${id}`,
          });
        } catch { /* the board still counts it */ }
        invalidateTeamBoard(id);
        try { await loadTeamBoard(id, true); } finally { ACK_BUSY.delete(id); }
        paint();
        // The day score hears the answer the way Home's publish does (wakeup + arrival parts).
        loadMine(true).then((rows) => {
          if (!rows) return;
          RT.vcRows = rows;
          try { daySetWakeup(myWakeupForDay(rows, DAY.date), RT.userId || null); } catch { /* next sync */ }
          try { daySetArrival(myArrivalForDay(rows, DAY.date), RT.userId || null); } catch { /* next sync */ }
        }, () => {});
        return;
      }

      if (locationAskClick(t, paint)) return;

      const here = t.closest('[data-rb-here]');
      if (here && !here.disabled) {
        const board = VC.teamBoard(id) || {};
        const place = board.location_name || 'the check-in spot';
        here.disabled = true;
        sayStatus(live.querySelector('#rb-here-say'), 'Checking your location…');
        let r = null;
        // checkInHere asks for While Using first when the phone was never asked (item 2).
        try { r = await checkInHere(id); } catch { r = { error: 'failed' }; }
        if (!r || r.error) { HERE_NOTE.set(id, { text: hereErrorLine(r || { error: 'failed' }), error: true }); paint(); }
        else if (r.within) { HERE_NOTE.set(id, { text: `You’re here. Checked in at ${place}.`, error: false }); track(EVENTS.VC_ARRIVED, { source: 'manual' }); buzz('success'); }
        else {
          HERE_NOTE.set(id, { text: typeof r.distance_m === 'number' ? `You’re ${Math.round(r.distance_m)} m from ${place}.` : (r.reason || 'Couldn’t confirm you’re there.'), error: true });
          track(EVENTS.VC_UNVERIFIED, { reason: 'distance' });
        }
        here.disabled = false;
        sayStatus(live.querySelector('#rb-here-say'), HERE_NOTE.get(id).text, { error: HERE_NOTE.get(id).error });
        if (r && !r.error) {
          await loadTeamBoard(id, true);
          paint();
          loadMine(true).then((rows) => {
            if (!rows) return;
            RT.vcRows = rows;
            try { daySetArrival(myArrivalForDay(rows, DAY.date), RT.userId || null); } catch { /* next sync */ }
          }, () => {});
        }
        return;
      }

      const all = t.closest('#rb-nudge-all');
      if (all && !all.disabled) {
        all.disabled = true; all.textContent = 'Sending…';
        const { sent, reason } = await remindMissing(id);
        if (sent) track(EVENTS.VC_REMINDED, { n: sent });
        all.textContent = sent ? `Nudged ${sent} not up yet` : SAY[reason] || 'Couldn’t send. Try again';
        if (!sent && reason === 'failed') all.disabled = false;
        return;
      }

      const face = t.closest('[data-rb-athlete]');
      if (face && coach) openSheet(root, id, face.getAttribute('data-rb-athlete'), face, paint);
    });
  },
};
