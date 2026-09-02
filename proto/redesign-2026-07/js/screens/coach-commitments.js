/* OnStandard — Verified Commitments, operator side (0138).
   Two screens plus the Home card:
     · commitmentBoardCard()  — the live count on coach/trainer Home ("9 of 11 Up")
     · coachCommitments       — the roster breakdown: who's missing, exact times, remind/excuse/fix
     · coachCommitEdit        — the composer

   The coach never counts replies and never calls anyone out in a group chat: Remind Missing
   reaches ONLY non-responders, and there is no team-wide list of who missed. Individual status is
   staff-only by RLS, and every manual correction is attributed server-side.

   nav:'operator' — one module renders for a coach's team AND a trainer's practice. */
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { track, EVENTS } from '../analytics.js';
import { backHead, esc, errorState, skeletonRows, segBar } from '../components.js';
import { CD, bookId } from '../coach-data.js';
// The shared no-book trio (coach-connected.js): kick the book without forcing, the honest
// "can't reach / no book yet / loading" screen for a book-less landing, and the Retry that
// force-loads past a cached offline ROSTER (a plain kick early-returns on it).
import { ensureBook, bookless, wireBookRetry, bookBack } from './coach-connected.js';
import { allowedCreateKeys, isReadonly } from '../staff-access.js';
import {
  boardCounts, missingFrom, TYPE_LABEL, presenceOf, PRESENCE,
  groupByVerdict, verdictCounts, deadlineOf, closesAtOf, graceMinOf, offsetFor, fmtAt,
  summarizeOccurrences, wakeupPhase, VERDICT,
} from '../commitments.js';
import { fmtMin } from '../requirements.js';
import {
  VC, loadBoard, loadCommitments, loadLocations, saveCommitment, saveLocation,
  setResponse, remindMissing, excuseAthlete, setCommitmentActive, todayISO, shiftISO,
  pingAthlete, setInstanceMessage, loadRollcallSummary,
} from '../commitment-data.js';
import { editWakeup } from './coach-wakeup.js';

const hhmm = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const canSchedule = () => {
  if (CD.kind === 'practice') return true;              // a trainer owns their practice outright
  const role = CD.extras ? CD.extras.myRole : null;
  if (!CD.extras) return true;                          // never blank the menu on a slow fetch
  return !isReadonly(role) && allowedCreateKeys(role).includes('commitments');
};

/* ---------------------------------------------------------------- Home card */

/** The live board card for operator Home. '' when nothing is scheduled today, so an operator who
 *  has never used this feature sees no change at all. */
export function commitmentBoardCard() {
  const rows = VC.board;
  // Same honesty rule as the athlete card: a coach must never read "all in" when the truth is
  // "we couldn't load the board". A wrong count is worse than no count.
  if ((!rows || !rows.length) && VC.boardError) {
    return `<section class="card pad" style="border-color:var(--amber-border);margin-bottom:10px">
      <div class="tt">Roll call didn’t load</div>
      <div class="ts" style="padding-top:4px">This isn’t a count of zero; we couldn’t reach the server. It retries the next time you open this screen.</div>
    </section>`;
  }
  if (!rows || !rows.length) return '';
  return rows.map((inst) => {
    // A wake-up roll call (0211) reads in verdicts: up / late / still out, on the instance clock.
    if (inst.type === 'morning_roll_call') return wakeupHomeCard(inst);
    const c = boardCounts(inst.rows || []);
    if (!c.total) return '';
    const ctx = [
      inst.audience_label || (CD.kind === 'practice' ? 'All clients' : 'Entire team'),
      inst.linked_title && inst.linked_starts_min != null
        ? `${inst.linked_title} at ${fmtMin(inst.linked_starts_min)}`
        : (inst.starts_min != null ? fmtMin(inst.starts_min) : ''),
    ].filter(Boolean).join(' · ');
    const allIn = c.awaiting === 0;
    return `
    <section class="card pad vc-board" data-go="coach-commitments/${esc(inst.instance_id)}" style="cursor:pointer;margin-bottom:10px">
      <h2 class="eyebrow" style="margin:0 0 6px">${esc(inst.title || TYPE_LABEL[inst.type] || 'Commitment')}</h2>
      <div class="ts" style="padding-bottom:10px">${esc(ctx)}</div>
      ${segBar(c.responded, c.total, `${c.responded} of ${c.total} responded`)}
      <div style="display:flex;align-items:baseline;gap:10px;padding-top:8px">
        <div style="font-size:var(--t-2xl);font-weight:800;letter-spacing:-.02em;color:${allIn ? 'var(--green-bright)' : 'var(--text)'}">
          ${c.responded} of ${c.total}</div>
        <div style="font-size:var(--t-sm);font-weight:700;color:var(--text-2)">in</div>
        <div style="flex:1"></div>
        <span class="xpill ${allIn ? 'green' : 'gold'}">${allIn ? 'All in' : `${c.awaiting} awaiting`}</span>
      </div>
      ${c.excused || c.unverified || c.leftEarly ? `<div class="ts" style="padding-top:8px">${
        [c.excused ? `${c.excused} excused` : '', c.unverified ? `${c.unverified} unverified` : '',
          c.leftEarly ? `${c.leftEarly} left early` : '']
          .filter(Boolean).join(' · ')}</div>` : ''}
    </section>`;
  }).filter(Boolean).join('');
}

/** The operator-Home card for a wake-up roll call: the count that matters and the split. */
function wakeupHomeCard(inst) {
  const now = new Date().toISOString();
  const c = verdictCounts(inst, now);
  if (!c.total) return '';
  const phase = wakeupPhase(inst, now);
  const ctx = [
    inst.audience_label || (CD.kind === 'practice' ? 'All clients' : 'Entire team'),
    inst.starts_min != null ? fmtMin(inst.starts_min) : '',
  ].filter(Boolean).join(' · ');
  const out = c.pending + c.missed;
  const pill = phase === 'closed'
    ? (out ? `<span class="xpill red">${out} missed</span>` : '<span class="xpill green">All in</span>')
    : phase === 'late'
      ? (out ? `<span class="xpill red">${out} still out</span>` : '<span class="xpill green">All in</span>')
      : (out ? `<span class="xpill gold">${out} pending</span>` : '<span class="xpill green">All in</span>');
  return `
    <section class="card pad vc-board wk-homecard" data-go="coach-commitments/${esc(inst.instance_id)}">
      <h2 class="eyebrow wk-cardh">${esc(inst.title || 'Wake-Up Roll Call')}</h2>
      <div class="ts wk-ctx">${esc(ctx)}</div>
      ${segBar(c.responded, c.counted, `${c.responded} of ${c.counted} checked in`)}
      <div class="wk-homeline">
        <div class="wk-homen ${out ? '' : 'g'}">${c.responded} of ${c.counted}</div>
        <div class="wk-homel">up</div>
        <div class="wk-spacer"></div>
        ${pill}
      </div>
      ${c.late || c.excused ? `<div class="ts wk-sub">${[
        c.late ? `${c.late} late` : '', c.excused ? `${c.excused} excused` : '',
      ].filter(Boolean).join(' · ')}</div>` : ''}
    </section>`;
}

/* ---------------------------------------------------------------- wake-up board (0211) */

/* The coach's 14-day read for the roll call on screen. Keyed by commitment id; null rows = the
   fetch failed (said so, never "no history"). */
const SUMMARY = { forId: null, rows: null, failed: false };
/* Which day a summary tap asked for, per instance id. Home-tapped instances are absent and load
   today, so opening a past day never leaks into the next visit to today's board. */
const BOARD_DAY_FOR = new Map();

const ACK_SRC = { lockscreen: 'from the lock screen', app: 'in the app', staff: 'set by staff' };

function wakeupRow(r, kind, inst, clock, phase) {
  const dl = deadlineOf(inst);
  const src = r.ack_source && ACK_SRC[r.ack_source] ? ` · ${ACK_SRC[r.ack_source]}` : '';
  const when = kind === 'on' ? `${clock(r.acknowledged_at)}${src}`
    : kind === 'late' ? `${clock(r.acknowledged_at)}${src}`
    : kind === 'ex' ? (r.excused_reason || 'Excused')
    : phase === 'open' || phase === 'before' ? 'No answer yet'
    : `No answer by ${clock(dl)}`;
  const pill = kind === 'on' ? '<span class="xpill green">On Standard</span>'
    : kind === 'late' ? `<span class="xpill gold">Late${r.lateMin ? ` · +${r.lateMin} min` : ''}</span>`
    : kind === 'ex' ? '<span class="xpill gray">Excused</span>'
    : r.verdict === VERDICT.MISSED ? '<span class="xpill red">Missed</span>'
    : '<span class="xpill gray">Pending</span>';
  const canPing = kind === 'out' && phase !== 'closed' && phase !== 'before';
  return `
  <div class="lrow wk-row">
    <div class="lm">
      <div class="lt">${esc(r.name || 'Athlete')}</div>
      <div class="ls">${esc(when)}${r.corrected_by_name ? esc(` · corrected by ${r.corrected_by_name}`) : ''}</div>
      ${r.disputed_at ? `<div class="ls wk-dispute">Reported wrong by the ${CD.noun}${r.dispute_note ? esc(`: ${r.dispute_note}`) : ''}</div>` : ''}
    </div>
    <div class="wk-rowend">
      ${pill}
      <div class="wk-rowacts">
        ${canPing ? `<button class="chip" data-wk-ping="${esc(r.athlete_id)}" data-wk-inst="${esc(inst.instance_id)}">Ping</button>` : ''}
        ${kind !== 'ex' ? `<button class="chip" data-vc-excuse="${esc(r.athlete_id)}">Excuse</button>` : ''}
        ${kind === 'out' ? `<button class="chip" data-vc-mark="${esc(r.response_id)}">Mark in</button>` : ''}
      </div>
    </div>
  </div>`;
}

function wakeupSummaryCard(inst) {
  if (SUMMARY.forId !== inst.commitment_id) return '';
  if (SUMMARY.failed) {
    return `<h2 class="eyebrow">History</h2>
    <div class="sidebox"><div class="req-icon b s38">${icon('clock', 17)}</div>
      <div><div class="tt">History didn’t load</div><div class="ts">This isn’t an empty record. It retries when you reopen this board.</div></div></div>`;
  }
  const rows = (SUMMARY.rows || []).filter((o) => o.instance_id !== inst.instance_id && o.instance_status !== 'cancelled');
  if (!rows.length) return '';
  const s = summarizeOccurrences(rows);
  const line = s.occurrences
    ? `Last ${s.occurrences} roll call${s.occurrences === 1 ? '' : 's'} · ${s.onStandard} On Standard · ${s.late} Late · ${s.missed} Missed`
    : 'Earlier roll calls';
  const day = (iso) => {
    const d = new Date(String(iso) + 'T12:00:00');
    return isNaN(d) ? String(iso) : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };
  return `
  <h2 class="eyebrow">History</h2>
  <section class="card rows">
    <div class="ts wk-histline">${esc(line)}</div>
    ${rows.slice(0, 14).map((o) => `
    <div class="lrow wk-hist" data-wk-day="${esc(o.occurs_on)}" data-wk-inst="${esc(o.instance_id)}">
      <div class="lm"><div class="lt">${esc(day(o.occurs_on))}</div>
        <div class="ls">${Number(o.pending) > 0 ? `${o.pending} pending · ` : ''}${o.on_standard} On Standard · ${o.late} Late · ${o.missed} Missed${Number(o.excused) ? ` · ${o.excused} excused` : ''}</div></div>
      <div class="lv">${Number(o.total) ? `${Number(o.on_standard) + Number(o.late)} of ${o.total}` : ''}</div>
      ${icon('chevron', 14, 'class="ic-chevron"')}
    </div>`).join('')}
  </section>`;
}

/** The live roll-call board for a wake-up. Grouped by verdict, in the order a coach reads it at
 *  6:05: who is still out, who was late, who is up. The count at the top is the only number that
 *  matters; everything below it is names. */
function wakeupBoard(inst, back) {
  const now = new Date().toISOString();
  const off = offsetFor(inst, now);
  const clock = (iso) => fmtAt(iso, off);
  const g = groupByVerdict(inst, now);
  const c = verdictCounts(inst, now);
  const phase = wakeupPhase(inst, now);
  const grace = graceMinOf(inst);
  const dl = deadlineOf(inst);
  const close = closesAtOf(inst);
  const out = g.pending.length + g.missed.length;
  const title = inst.title || 'Wake-Up Roll Call';
  const ctx = [
    inst.audience_label || (CD.kind === 'practice' ? 'All clients' : 'Entire team'),
    inst.starts_min != null ? fmtMin(inst.starts_min) : '',
    grace ? `${grace} min grace` : '',
  ].filter(Boolean).join(' · ');
  const statusLine = phase === 'before' ? `Opens ${clock(inst.opens_at)}. Answers by ${clock(dl)} are On Standard.`
    : phase === 'open' ? `On Standard until ${clock(dl)}.${close ? ` Late answers until ${clock(close)}.` : ''}`
    : phase === 'late' ? `Grace period ended ${clock(dl)}.${close ? ` Late answers until ${clock(close)}.` : ''}`
    : `Closed ${clock(close)}.`;
  const outLabel = phase === 'open' || phase === 'before' ? 'Pending' : 'Missed';
  const section = (label, list, kind) => list.length ? `
    <h2 class="eyebrow">${esc(label)} <span class="opt">· ${list.length}</span></h2>
    <section class="card rows">${list.map((r) => wakeupRow(r, kind, inst, clock, phase)).join('')}</section>` : '';

  return `
  ${backHead(title, ctx, back)}

  <section class="card pad wk-board">
    <div class="wk-count"><span class="wk-n ${out ? '' : 'g'}">${c.responded}</span><span class="wk-of">/ ${c.counted}</span><span class="wk-cl">checked in</span></div>
    ${segBar(c.responded, c.counted, `${c.responded} of ${c.counted} checked in`)}
    <div class="wk-stats">
      <div class="wk-stat g"><b>${c.onStandard}</b><span>On Standard</span></div>
      <div class="wk-stat ${outLabel === 'Missed' && out ? 'r' : ''}"><b>${out}</b><span>${outLabel}</span></div>
      <div class="wk-stat ${c.late ? 'a' : ''}"><b>${c.late}</b><span>Late</span></div>
    </div>
    <div class="ts wk-status">${esc(statusLine)}</div>
  </section>

  ${phase === 'closed' ? `
  <section class="card pad wk-done">
    <h2 class="eyebrow">Wake-Up Roll Call complete</h2>
    <div class="wk-doneline"><b>${c.onStandard} / ${c.counted}</b> On Standard · <b>${c.late}</b> Late · <b>${c.missed}</b> Missed${c.excused ? ` · ${c.excused} excused` : ''}</div>
  </section>` : ''}

  <section class="card pad">
    <div class="wk-msgh"><h2 class="eyebrow wk-inline">Your message today</h2><button class="chip" id="wk-msg-edit">${inst.message ? 'Change' : 'Add'}</button></div>
    ${inst.message ? `<p class="wk-msgp">${esc(inst.message)}</p>` : `<div class="ts">No message. The roll call goes out with the time only.</div>`}
    ${inst.message_override ? `<div class="ts wk-hint">Today only. Tomorrow uses your standing message.</div>` : ''}
    <div id="wk-msg-form" hidden>
      <textarea class="ob-input wk-msg" id="wk-msg-ta" maxlength="1000" rows="4" aria-label="Today’s message">${esc(inst.message_override || inst.standing_message || inst.message || '')}</textarea>
      <div class="ts wk-hint">${phase === 'before' ? 'Goes out with today’s roll call, in your name, exactly as written.' : 'Shows in the app now. A push already sent keeps its words.'}</div>
      <div class="btn-row mt">
        <button class="btn green sm" id="wk-msg-save">Save for today</button>
        ${inst.message_override ? `<button class="btn ghost sm" id="wk-msg-clear">Use standing message</button>` : ''}
      </div>
      <div id="wk-msg-err" class="ts wk-err" aria-live="polite"></div>
    </div>
  </section>

  ${out && phase !== 'closed' && phase !== 'before' ? `
  <button class="btn" id="vc-remind" data-inst="${esc(inst.instance_id)}">${icon('bell', 18)} Ping ${out} ${outLabel === 'Pending' ? 'pending' : 'still out'}</button>
  <div class="ts wk-pinghint">Only these ${out} get it, with their own I’m Up button. Nobody who answered is pinged. One ping per roll call every ten minutes.</div>` : ''}
  ${!out && phase !== 'before' ? `
  <div class="sidebox wk-allin">
    <div class="req-icon g s38">${icon('check', 19)}</div>
    <div><div class="tt">Everyone is in</div><div class="ts">Nobody to chase.</div></div>
  </div>` : ''}

  ${section(outLabel, [...g.pending, ...g.missed], 'out')}
  ${section('Late', g.late, 'late')}
  ${section('On Standard', g.on_standard, 'on')}
  ${section('Excused', g.excused, 'ex')}
  ${wakeupSummaryCard(inst)}
  <div class="wk-foot"></div>`;
}

/** Paint the board card into a slot on operator Home. Same async-slot seam Home uses elsewhere. */
export function paintBoard(root, slotId = '#vc-board-slot') {
  const slot = root.querySelector(slotId);
  if (!slot) return;
  const paint = () => { if (slot.isConnected) slot.innerHTML = commitmentBoardCard(); };
  paint();
  const id = bookId();
  if (id) loadBoard(id, CD.kind).then(paint);
}

/* ---------------------------------------------------------------- roster breakdown */

/* pending is a neutral fact, not a warning, so it reads gray; unverified is a gap in
   evidence (the product's own ruling), so it reads blue, never gold. Gold stays reserved
   for a deadline that was genuinely missed (the Left early presence pill below). */
const STATUS_PILL = {
  pending: ['gray', 'Awaiting'], acknowledged: ['green', 'In'],
  arrived: ['green', 'Arrived'], completed: ['green', 'Completed'],
  excused: ['gray', 'Excused'], unverified: ['blue', 'Unverified'], missed: ['red', 'No response'],
};

function athleteRow(r, asksArrival, dwellMin) {
  const [cls, label] = STATUS_PILL[r.status] || ['gray', r.status];
  // Presence (0208): the server's verdict on whether they stayed. Left early is a verified
  // miss of the stay, so it earns gold; provisional is a session still running, blue.
  const pres = presenceOf(r);
  const needed = r.min_dwell_min != null ? r.min_dwell_min : dwellMin;
  const when = pres === PRESENCE.LEFT_EARLY
    ? `Left ${hhmm(r.departed_at) || 'early'}${needed ? ` · needed ${needed}m` : ''}`
    : pres === PRESENCE.PROVISIONAL && r.arrived_at
    ? `At the location since ${hhmm(r.arrived_at)}`
    : r.completed_at ? `Completed ${hhmm(r.completed_at)}`
    : r.arrived_at ? `Arrived ${hhmm(r.arrived_at)}`
    : r.acknowledged_at ? `Responded ${hhmm(r.acknowledged_at)}`
    : r.status === 'excused' ? (r.excused_reason || 'Excused')
    : r.status === 'unverified' ? (r.unverified_reason || 'Couldn’t verify')
    : 'No response yet';
  const presPill = pres === PRESENCE.LEFT_EARLY ? '<span class="xpill gold">Left early</span>'
    : pres === PRESENCE.PROVISIONAL && r.arrived_at ? '<span class="xpill blue">Still there</span>' : '';
  const src = r.arrival_source === 'staff' ? ' · set by staff'
    : r.arrival_source === 'geofence' ? ' · verified at the location'
    : r.arrival_source === 'manual' ? ' · self-reported' : '';
  return `
  <div class="lrow" style="align-items:flex-start">
    <div class="lm" style="flex:1">
      <div class="lt">${esc(r.name || 'Athlete')}</div>
      <div class="ls">${esc(when)}${esc(src)}${r.corrected_by_name ? esc(` · corrected by ${r.corrected_by_name}`) : ''}</div>
      ${r.disputed_at ? `<div class="ls" style="color:var(--amber-bright);font-weight:700">Reported wrong by the ${CD.noun}${r.dispute_note ? esc(`: ${r.dispute_note}`) : ''}</div>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
      <span class="xpill ${cls}">${esc(label)}</span>${presPill}
      <div style="display:flex;gap:6px">
        ${r.status !== 'excused' ? `<button class="chip" data-vc-excuse="${esc(r.athlete_id)}">Excuse</button>` : ''}
        ${r.status === 'pending' || r.status === 'unverified' || r.status === 'missed'
          ? `<button class="chip" data-vc-mark="${esc(r.response_id)}">${asksArrival ? 'Mark arrived' : 'Mark in'}</button>` : ''}
      </div>
    </div>
  </div>`;
}

/* Whether a board load has ever settled this session. VC exposes boardError but no loaded
   stamp, and without one an in-flight first load is indistinguishable from a confirmed-empty
   day, which is the difference between a skeleton and "Nothing scheduled today". */
let BOARD_LOADED = false;

export const coachCommitments = {
  nav: 'operator', tab: 'home',
  render({ sub }) {
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
    const inst = (VC.board || []).find((b) => b.instance_id === sub) || (VC.board || [])[0];
    if (!inst) {
      // No book means no board fetch ever started — that's a book problem, not a board one.
      // Without this, a failed (or book-less) load left the skeleton below up forever with no
      // way out: the mount's plain kick early-returns on the cached offline ROSTER, so only
      // bookless()'s forced Retry can punch through it.
      if (!bookId()) return bookless('Roll call', bookBack());
      // A failed load is NOT a count of zero, and a load still in flight is not one either.
      // Only a confirmed-empty board earns the "Nothing scheduled today" copy.
      if (VC.boardError) {
        return `${backHead('Roll call', 'Couldn’t reach the server', back)}
        ${errorState({ title: "Roll call didn't load", body: "This isn't a count of zero. We couldn't reach the server.", retryId: 'vc-board-retry' })}`;
      }
      if (!BOARD_LOADED) {
        return `${backHead('Roll call', 'Loading', back)}${skeletonRows(3, 'Loading the board')}`;
      }
      return `${backHead('Roll call', 'Nothing scheduled today', back)}
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('clock', 17)}</div>
        <div><div class="tt">No commitments today</div>
        <div class="ts">Schedule a morning roll call, a lift, or a study hall and you'll see live responses here, without counting replies in a group chat.</div></div>
      </div>
      ${canSchedule() ? `<div style="height:14px"></div>
      <button class="btn" data-go="coach-commit-edit" style="width:100%">${icon('plus', 18)} Schedule a commitment</button>` : ''}`;
    }

    // A wake-up roll call (0211) has its own board: verdict groups, ping per row, today's message.
    if (inst.type === 'morning_roll_call') return wakeupBoard(inst, back);

    const rows = inst.rows || [];
    const c = boardCounts(rows);
    const missing = missingFrom(rows);
    const responded = rows.filter((r) => !missing.includes(r));
    const ctx = [
      inst.audience_label || (CD.kind === 'practice' ? 'All clients' : 'Entire team'),
      inst.linked_title && inst.linked_starts_min != null
        ? `${inst.linked_title} at ${fmtMin(inst.linked_starts_min)}` : '',
    ].filter(Boolean).join(' · ');

    return `
    ${backHead(inst.title || TYPE_LABEL[inst.type] || 'Commitment', ctx, back)}

    <section class="card pad">
      ${segBar(c.responded, c.total, `${c.responded} of ${c.total} responded`)}
      <div style="display:flex;align-items:baseline;gap:10px;padding-top:8px">
        <div style="font-size:var(--t-3xl);font-weight:800;letter-spacing:-.02em;color:${c.awaiting ? 'var(--text)' : 'var(--green-bright)'}">${c.responded} of ${c.total}</div>
        <div style="font-size:var(--t-base);font-weight:700;color:var(--text-2)">in</div>
        <div style="flex:1"></div>
        <span class="xpill ${c.awaiting ? 'gold' : 'green'}">${c.awaiting ? `${c.awaiting} awaiting` : 'All in'}</span>
      </div>
      ${inst.respond_by_at || c.leftEarly ? `<div class="ts" style="padding-top:8px">${[
        inst.respond_by_at ? `Responses due by ${esc(hhmm(inst.respond_by_at))}` : '',
        c.leftEarly ? `${c.leftEarly} left early` : '',
      ].filter(Boolean).join(' · ')}</div>` : ''}
    </section>

    ${missing.length ? `
    <h2 class="eyebrow">Still waiting on ${missing.length}</h2>
    <section class="card" style="padding:2px 16px">${missing.map((r) => athleteRow(r, !!inst.asks_arrival, inst.min_dwell_min)).join('')}</section>
    <div style="height:10px"></div>
    <button class="btn" id="vc-remind" style="width:100%">${icon('bell', 18)} Remind ${missing.length} missing ${missing.length === 1 ? CD.noun : CD.nouns}</button>
    <div class="ts" style="text-align:center;padding-top:8px">Only these ${missing.length} get the reminder. Nobody who already responded is pinged.</div>
    ` : `
    <div class="sidebox" style="margin-top:12px">
      <div class="req-icon g" style="width:38px;height:38px">${icon('check', 19)}</div>
      <div><div class="tt">Everyone is in</div>
      <div class="ts">No reminders to send and nobody to chase.</div></div>
    </div>`}

    ${responded.length ? `
    <h2 class="eyebrow">Responded</h2>
    <section class="card" style="padding:2px 16px">${responded.map((r) => athleteRow(r, !!inst.asks_arrival, inst.min_dwell_min)).join('')}</section>` : ''}

    ${inst.asks_arrival ? `
    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 19)}</div>
      <div><div class="tt">What "Arrived" means</div>
      <div class="ts">The ${CD.noun}'s phone reached ${esc(inst.location_name || 'the location')} inside the scheduled window. It does not prove the session was completed; that's the separate Completed signal.</div></div>
    </div>` : ''}
    <div style="height:20px"></div>`;
  },

  mount(root, { sub }) {
    /* This screen used to hang the app.
     *
     * mount() called loadBoard(..., force = true) and then repainted unconditionally. force skips
     * the freshness cache, so every mount issued a real RPC; __render() re-runs mount(); and that
     * mount forced another load. An unbounded loop of network calls — the board never settled, and
     * the QC harness timed out at 45s trying to photograph it.
     *
     * Two changes break it. The load is no longer forced, so the 30s freshness cache can answer;
     * and the repaint is conditional on the board CONTENT having actually changed, which is the
     * pattern the rest of the app already uses for late-arriving data (cf. warmParticipants in
     * meal.js). Once the data is stable there is nothing new to paint, so it terminates. A coach
     * action still refreshes immediately — repaint() below force-loads after every mutation. */
    /* Direct entry (a relaunch restoring this hash): nothing has loaded the book yet, so
       bookId() is null, nothing below fires, BOARD_LOADED stays false, and the skeleton sat
       forever — the exact hang class coach-standards fell into (audit 2026-08-23). ensureBook
       kicks the load; its arrival repaints every operator screen (router's onstd:book-arrival
       listener) and this mount re-runs with a real id. Until then the render above shows
       bookless(), whose Retry is the one path past a cached FAILED load — wire it and stop,
       because none of the board controls below exist on that screen. */
    if (!ensureBook()) { wireBookRetry(root); return; }
    const id = bookId();
    // A summary tap asked for a past day (0211); anything else is today.
    const boardDay = (sub && BOARD_DAY_FOR.get(sub)) || todayISO();
    if (id) {
      const before = JSON.stringify(VC.board);
      loadBoard(id, CD.kind, boardDay).then(() => {
        // The first settled load must repaint even when the board is unchanged (an empty [] is
        // unchanged from the seed), or the skeleton above never resolves into a real state.
        const first = !BOARD_LOADED;
        BOARD_LOADED = true;
        if (!root.isConnected) return;
        if (!first && JSON.stringify(VC.board) === before) return;
        window.__render && window.__render();
      });
    }

    // The failed-load state's retry: a FORCED board load, then repaint whatever came back.
    const boardRetry = root.querySelector('#vc-board-retry');
    if (boardRetry) boardRetry.addEventListener('click', async () => {
      boardRetry.disabled = true;
      const bid = bookId();
      if (bid) await loadBoard(bid, CD.kind, todayISO(), true);
      BOARD_LOADED = true;
      window.__render && window.__render();
    });

    const remind = root.querySelector('#vc-remind');
    if (remind) remind.addEventListener('click', async () => {
      remind.disabled = true; remind.textContent = 'Sending…';
      const { sent, reason } = await remindMissing(remind.getAttribute('data-inst') || sub);
      if (sent) track(EVENTS.VC_REMINDED, { n: sent });
      /* Four different outcomes, four different sentences. This button used to print
         "Couldn't send. Try again" over every non-success, including the two where trying again is
         the wrong move: somebody already nudged this roll call (the server holds one nudge per ten
         minutes so a roster is never double-buzzed), and everyone answered while the board was on
         screen. Telling a coach to retry either one produces a second press that also does nothing,
         which reads as a broken button rather than a working limit. */
      remind.textContent = sent ? `Reminded ${sent}`
        : reason === 'rate_limited' ? 'Just reminded. Give it a few minutes'
        : reason === 'not_authorized' ? 'You can’t send reminders here'
        : reason === 'ok' ? 'Everyone is in'
        : 'Couldn’t send. Try again';
      // Re-enable ONLY where pressing again could do something. A limit and a refusal are not
      // retries, and a live button under them is an invitation to keep pressing.
      if (!sent && reason === 'failed') remind.disabled = false;
    });

    const repaint = async () => {
      const bid = bookId();
      if (bid) await loadBoard(bid, CD.kind, boardDay, true);
      window.__render && window.__render();
    };

    /* ---- wake-up board controls (0211). Every selector below exists only on that board. ---- */
    const inst = (VC.board || []).find((b) => b.instance_id === sub) || (VC.board || [])[0];
    if (inst && inst.type === 'morning_roll_call' && SUMMARY.forId !== inst.commitment_id) {
      // One fetch per commitment per visit; a failure is shown, never rendered as "no history".
      SUMMARY.forId = inst.commitment_id; SUMMARY.rows = null; SUMMARY.failed = false;
      loadRollcallSummary(inst.commitment_id, 14).then((rows) => {
        if (SUMMARY.forId !== inst.commitment_id) return;
        if (rows === null) SUMMARY.failed = true; else SUMMARY.rows = rows;
        if (root.isConnected) window.__render && window.__render();
      });
    }

    root.querySelectorAll('[data-wk-ping]').forEach((b) => b.addEventListener('click', async () => {
      const instId = b.getAttribute('data-wk-inst');
      const athleteId = b.getAttribute('data-wk-ping');
      b.disabled = true; b.textContent = '…';
      const { sent, reason } = await pingAthlete(instId, athleteId);
      if (sent) track(EVENTS.VC_REMINDED, { n: 1, single: true });
      // Same four-outcome honesty as the roster button: a limit and a refusal are not retries.
      b.textContent = sent ? 'Pinged'
        : reason === 'rate_limited' ? 'Just pinged'
        : reason === 'ok' ? 'Already in'
        : reason === 'not_authorized' ? 'Not allowed'
        : 'Couldn’t ping';
      if (!sent && reason === 'failed') b.disabled = false;
    }));

    const msgEdit = root.querySelector('#wk-msg-edit');
    const msgForm = root.querySelector('#wk-msg-form');
    if (msgEdit && msgForm) msgEdit.addEventListener('click', () => {
      msgForm.hidden = !msgForm.hidden;
      msgEdit.setAttribute('aria-expanded', msgForm.hidden ? 'false' : 'true');
      if (!msgForm.hidden) { const ta = root.querySelector('#wk-msg-ta'); if (ta) ta.focus(); }
    });
    const msgSay = (m) => { const el = root.querySelector('#wk-msg-err'); if (el) el.textContent = m; };
    const msgSave = root.querySelector('#wk-msg-save');
    if (msgSave && inst) msgSave.addEventListener('click', async () => {
      const ta = root.querySelector('#wk-msg-ta');
      msgSave.disabled = true; msgSave.textContent = 'Saving…';
      const ok = await setInstanceMessage(inst.instance_id, ta ? ta.value : '');
      if (!ok) { msgSave.disabled = false; msgSave.textContent = 'Save for today'; msgSay('Couldn’t save. Check your connection and try again.'); return; }
      await repaint();
    });
    const msgClear = root.querySelector('#wk-msg-clear');
    if (msgClear && inst) msgClear.addEventListener('click', async () => {
      msgClear.disabled = true; msgClear.textContent = '…';
      const ok = await setInstanceMessage(inst.instance_id, '');
      if (!ok) { msgClear.disabled = false; msgClear.textContent = 'Use standing message'; msgSay('Couldn’t change it. Try again.'); return; }
      await repaint();
    });

    root.querySelectorAll('[data-wk-day]').forEach((row) => row.addEventListener('click', async () => {
      const day = row.getAttribute('data-wk-day');
      const instId = row.getAttribute('data-wk-inst');
      if (!day || !instId) return;
      BOARD_DAY_FOR.set(instId, day);
      const bid = bookId();
      if (bid) await loadBoard(bid, CD.kind, day, true);
      location.hash = `#coach-commitments/${instId}`;
    }));

    root.querySelectorAll('[data-vc-mark]').forEach((b) => b.addEventListener('click', async () => {
      const label = b.textContent; // 'Mark arrived' or 'Mark in' — restore the SAME one on failure
      b.disabled = true; b.textContent = '…';
      const ok = await setResponse(b.getAttribute('data-vc-mark'), 'acknowledged', null);
      if (!ok) { b.disabled = false; b.textContent = label; return; }
      await repaint();
    }));

    // Excusing is almost never about ONE morning — it's travel, illness, a funeral. Tapping
    // Excuse asks how long, and the range writes athlete_exceptions so every other coach surface
    // agrees, instead of the coach clearing the same athlete again tomorrow.
    root.querySelectorAll('[data-vc-excuse]').forEach((b) => b.addEventListener('click', () => {
      const athleteId = b.getAttribute('data-vc-excuse');
      const wrap = b.parentElement;
      if (!wrap) return;
      const opts = [['Today', 0], ['3 days', 2], ['A week', 6]];
      const optEls = opts.map(([label, addDays]) => {
        const el = document.createElement('button');
        el.className = 'chip';
        el.textContent = label;
        el.addEventListener('click', async () => {
          el.disabled = true; el.textContent = '…';
          const today = todayISO();
          const n = await excuseAthlete(
            athleteId, today, shiftISO(today, addDays),
            addDays ? `Excused ${label.toLowerCase()}` : 'Excused by staff',
            bookId(), CD.kind);
          if (!n) { el.disabled = false; el.textContent = label; return; }
          await repaint();
        });
        return el;
      });
      // A way out: a mis-tap on Excuse must not leave the coach stuck choosing a duration.
      const cancel = document.createElement('button');
      cancel.className = 'chip';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => { window.__render && window.__render(); });
      wrap.replaceChildren(...optEls, cancel);
    }));
  },
};

/* ---------------------------------------------------------------- composer */

const TYPES = [
  'morning_roll_call', 'practice', 'strength', 'speed', 'team_meeting',
  'study_hall', 'tutoring', 'class', 'rehab', 'nutrition',
];
const DOW = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];

/* Writing prompts, NOT defaults. Tapping one loads it into the field to edit; nothing here is
   ever persisted unless the coach leaves it in the box. A coach who types nothing ships a card
   with no message rather than a sentence OnStandard invented for them. */
const STARTERS = {
  morning_roll_call: ['Everyone up? Ready to rise and conquer?', 'Feet on the floor. Let’s go.', 'Up and moving. Today starts now.'],
  study_hall: ['Books open. Two hours, no phones.'],
  rehab: ['Rehab today. Don’t skip it, it’s how you get back.'],
};

/* The commitment currently being edited, or null for a new one. Set by the manage screen so the
   composer can prefill; cleared on save so the next "Schedule a commitment" starts clean. */
let DRAFT = null;
const blankDraft = () => ({
  type: 'morning_roll_call', title: TYPE_LABEL.morning_roll_call, message: '',
  action_label: '', audience_kind: 'team', audience_value: null,
  repeat_days: [1, 2, 3, 4, 5], starts_min: 285, respond_by_min: 315,
  location_id: null, arrive_by_min: null, min_dwell_min: null,
  linked_commitment_id: null, reminder_offsets_min: [15, 5],
  escalation: {},
});

/* The visible caption is a <label for>, not a styled <div>: a time field whose name lives in an
   unassociated div is announced as just "time" by a screen reader, and the caption is not a tap
   target. `display:block` keeps the label sitting on its own line exactly as the div did. */
const timeInput = (id, label, val) => `
  <div style="flex:1">
    <label for="${id}" style="display:block;font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">${esc(label)}</label>
    <input class="ob-input" id="${id}" type="time" value="${esc(val == null ? '' : `${String(Math.floor(val / 60)).padStart(2, '0')}:${String(val % 60).padStart(2, '0')}`)}" />
  </div>`;

/* ---------------------------------------------------------------- manage standing commitments */

const DOW_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysLabel = (days) => {
  const d = (days || []).map(Number).sort();
  if (!d.length) return 'Never';
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Weekdays';
  if (d.join() === '0,6') return 'Weekends';
  return d.map((n) => DOW_FULL[n]).join(' · ');
};

/** Load a saved commitment into the composer. Exported so the manage screen can hand one over. */
export function editCommitment(row) {
  DRAFT = {
    id: row.id, type: row.type, title: row.title || '', message: row.message || '',
    action_label: row.action_label || '', audience_kind: row.audience_kind,
    audience_value: row.audience_value || null,
    repeat_days: Array.isArray(row.repeat_days) ? row.repeat_days.map(Number) : [],
    starts_min: row.starts_min, ends_min: row.ends_min,
    respond_by_min: row.respond_by_min, opens_min: row.opens_min,
    location_id: row.location_id || null, arrive_by_min: row.arrive_by_min,
    min_dwell_min: row.min_dwell_min,
    linked_commitment_id: row.linked_commitment_id || null,
    reminder_offsets_min: row.reminder_offsets_min || [15, 5],
    escalation: (row.escalation && typeof row.escalation === 'object') ? { ...row.escalation } : {},
    active: row.active !== false,
  };
}

export const coachCommitManage = {
  nav: 'operator', tab: 'home',
  render() {
    // No book, no commitments read — same book-first honesty as the board above.
    if (!bookId()) return bookless('Commitments', bookBack());
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
    // null = never loaded this session; [] = the server confirmed there is nothing. Folding the
    // two together printed "Nothing scheduled yet" over a coach's real commitments for the whole
    // first load on a direct entry — the same fabricated-emptiness lie the fetcher contract bans.
    const loaded = Array.isArray(RT.vcCommitments);
    const rows = RT.vcCommitments || [];
    const live = rows.filter((r) => r.active !== false);
    const paused = rows.filter((r) => r.active === false);

    const card = (r) => `
      <div class="lrow" style="align-items:flex-start">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon(r.type === 'morning_roll_call' ? 'sun' : 'clock', 17)}</div>
        <div class="lm" style="flex:1">
          <div class="lt">${esc(r.title || TYPE_LABEL[r.type] || 'Commitment')}</div>
          <div class="ls">${esc(daysLabel(r.repeat_days))} · ${esc(fmtMin(r.starts_min))}${
            r.type === 'morning_roll_call' && graceMinOf(r) != null ? ` · ${esc(String(graceMinOf(r)))} min grace` : ''}${
            r.location_id ? ' · location verified' : ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <button class="chip" data-vc-edit="${esc(r.id)}">Edit</button>
          <button class="chip" data-vc-toggle="${esc(r.id)}">${r.active === false ? 'Resume' : 'Pause'}</button>
        </div>
      </div>`;

    return `
    ${backHead('Commitments', 'Everything you have standing', back)}
    ${VC.commitmentsError && !rows.length ? errorState({ title: "Couldn't load your commitments", body: 'Nothing was deleted. Reconnect and your schedule loads right here.', retryId: 'vc-manage-retry' })
    : !loaded ? skeletonRows(3, 'Loading your commitments')
    : !rows.length ? `
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('clock', 17)}</div>
        <div><div class="tt">Nothing scheduled yet</div>
        <div class="ts">Schedule a morning roll call, a lift, or a study hall and it'll live here: editable, pausable, and never silently deleted.</div></div>
      </div>` : ''}
    ${live.length ? `<h2 class="eyebrow">Running</h2>
      <section class="card" style="padding:2px 16px">${live.map(card).join('')}</section>` : ''}
    ${paused.length ? `<h2 class="eyebrow">Paused</h2>
      <section class="card" style="padding:2px 16px">${paused.map(card).join('')}</section>
      <div class="ts" style="padding-top:8px">Paused commitments stop appearing for ${CD.nouns} tomorrow. Everything already recorded against them stays exactly as it is.</div>` : ''}
    <div style="height:14px"></div>
    <button class="btn green" data-go="coach-wakeup-new">${icon('sun', 18)} Wake-Up Roll Call</button>
    <div class="wk-gap"></div>
    <button class="btn ghost" id="vc-new" style="width:100%">${icon('plus', 18)} Schedule a commitment</button>
    <div style="height:20px"></div>`;
  },

  mount(root) {
    // Direct entry — see coachCommitments.mount: kick, wire bookless()'s Retry, and stop.
    if (!ensureBook()) { wireBookRetry(root); return; }
    const id = bookId();
    const hadError = VC.commitmentsError;
    if (id) loadCommitments(id, CD.kind, true).then((rows) => {
      // Repaint only when the rows or the error flag actually changed — __render re-runs
      // this mount, and an unconditional refresh here would refetch and spin forever.
      const changed = JSON.stringify(rows) !== JSON.stringify(RT.vcCommitments || null)
        || VC.commitmentsError !== hadError;
      RT.vcCommitments = rows;
      if (changed && root.isConnected) window.__render && window.__render();
    });
    const retry = root.querySelector('#vc-manage-retry');
    if (retry) retry.addEventListener('click', () => {
      // A repaint re-runs this mount, and the mount always refetches.
      window.__render && window.__render();
    });

    const create = root.querySelector('#vc-new');
    if (create) create.addEventListener('click', () => {
      DRAFT = null;                       // a fresh sheet, not the last thing edited
      location.hash = '#coach-commit-edit';
    });

    root.querySelectorAll('[data-vc-edit]').forEach((b) => b.addEventListener('click', () => {
      const row = (RT.vcCommitments || []).find((r) => r.id === b.getAttribute('data-vc-edit'));
      if (!row) return;
      // A wake-up roll call edits in its own composer (0211); everything else in the general one.
      if (row.type === 'morning_roll_call') { editWakeup(row); location.hash = '#coach-wakeup-edit'; return; }
      editCommitment(row);
      location.hash = '#coach-commit-edit';
    }));

    root.querySelectorAll('[data-vc-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const row = (RT.vcCommitments || []).find((r) => r.id === b.getAttribute('data-vc-toggle'));
      if (!row) return;
      b.disabled = true; b.textContent = '…';
      const owner = bookId();
      const ok = await setCommitmentActive({
        ...row,
        team_id: CD.kind === 'practice' ? null : owner,
        practice_id: CD.kind === 'practice' ? owner : null,
      }, row.active === false);
      if (!ok) { b.disabled = false; b.textContent = row.active === false ? 'Resume' : 'Pause'; return; }
      RT.vcCommitments = await loadCommitments(owner, CD.kind, true);
      window.__render && window.__render();
    }));
  },
};

export const coachCommitEdit = {
  nav: 'operator', tab: 'home', transient: true,
  render() {
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
    if (!canSchedule()) {
      return `${backHead('Schedule', 'Not available for your role', back)}
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('eye', 17)}</div>
        <div><div class="tt">Scheduling is for the coaching staff</div>
        <div class="ts">You can see the board and every response for your scope. Ask the head coach if you should be able to schedule too.</div></div>
      </div>`;
    }
    const d = DRAFT || (DRAFT = blankDraft());
    const rooms = (CD.extras && CD.extras.rooms) || [];
    const groups = (CD.extras && CD.extras.groups) || [];
    const starters = STARTERS[d.type] || [];

    return `
    ${backHead('Schedule a commitment', 'Type, who it’s for, when it repeats', back)}

    <h2 class="eyebrow">What is it</h2>
    <section class="card pad">
      <div class="chips-wrap" id="vc-type" style="display:flex;flex-wrap:wrap;gap:6px" role="radiogroup" aria-label="Commitment type">
        ${TYPES.map((t) => `<button class="chip ${d.type === t ? 'on' : ''}" role="radio" aria-checked="${d.type === t ? 'true' : 'false'}" data-type="${t}">${esc(TYPE_LABEL[t])}</button>`).join('')}
      </div>
      <div style="height:14px"></div>
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">What the ${CD.nouns} see as the title</div>
      <input class="ob-input" id="vc-title" maxlength="60" value="${esc(d.title)}" placeholder="${esc(TYPE_LABEL[d.type])}" />
      <div style="height:14px"></div>
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Your message <span style="color:var(--text-3);font-weight:600">· optional, your words</span></div>
      <textarea class="ob-input" id="vc-msg" maxlength="200" rows="2" style="min-height:60px;resize:vertical" placeholder="Say it how you'd say it in the room.">${esc(d.message)}</textarea>
      ${starters.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
        ${starters.map((s, i) => `<button class="chip" data-starter="${i}">${esc(s.length > 34 ? s.slice(0, 32) + '…' : s)}</button>`).join('')}
      </div>
      <div class="ts" style="padding-top:6px">Tap one to load it in and edit it, or ignore them and write your own.</div>` : ''}
      <div style="height:14px"></div>
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Button label</div>
      <input class="ob-input" id="vc-action" maxlength="24" value="${esc(d.action_label)}" placeholder="${d.type === 'morning_roll_call' ? 'I’m Up' : 'I’m here'}" />
    </section>

    <h2 class="eyebrow">Who gets it</h2>
    <section class="card pad">
      <div style="display:flex;flex-wrap:wrap;gap:6px" id="vc-aud" role="radiogroup" aria-label="Who gets it">
        <button class="chip ${d.audience_kind === 'team' ? 'on' : ''}" role="radio" aria-checked="${d.audience_kind === 'team' ? 'true' : 'false'}" data-aud="team">${CD.kind === 'practice' ? 'All clients' : 'Entire team'}</button>
        ${rooms.map((r) => `<button class="chip ${d.audience_value === r.id ? 'on' : ''}" role="radio" aria-checked="${d.audience_value === r.id ? 'true' : 'false'}" data-aud="room:${esc(r.id)}">${esc(r.label)}</button>`).join('')}
        ${groups.map((g) => `<button class="chip ${d.audience_value === g.id ? 'on' : ''}" role="radio" aria-checked="${d.audience_value === g.id ? 'true' : 'false'}" data-aud="group:${esc(g.id)}">${esc(g.name)}</button>`).join('')}
      </div>
    </section>

    <h2 class="eyebrow">When</h2>
    <section class="card pad">
      <div style="display:flex;gap:6px" id="vc-days" role="group" aria-label="Repeat on days">
        ${DOW.map((n, i) => `<button class="chip ${d.repeat_days.includes(i) ? 'on' : ''}" role="checkbox" aria-checked="${d.repeat_days.includes(i) ? 'true' : 'false'}" aria-label="${DOW_FULL[i]}" data-day="${i}" style="flex:1;padding:8px 0">${n}</button>`).join('')}
      </div>
      <div style="height:14px"></div>
      <div style="display:flex;gap:10px">
        ${timeInput('vc-start', 'Appears / starts', d.starts_min)}
        ${timeInput('vc-respond', 'Respond by', d.respond_by_min)}
      </div>
      <div class="ts" style="padding-top:10px">A reminder goes out 15 and 5 minutes before the deadline, only to ${CD.nouns} who haven’t responded.</div>
    </section>

    ${/* The escalation ladder (0145) ran server-side for a month with NO way to switch either
          rung on — no UI ever wrote commitments.escalation, so the "louder" half of the ladder
          could never fire for anyone. These two chips are that missing switch. */''}
    <h2 class="eyebrow">If they miss it <span class="opt">· optional</span></h2>
    <section class="card pad">
      <div class="vc-esc" id="vc-esc" role="group" aria-label="If they miss it">
        <button class="chip ${d.escalation && d.escalation.breakthrough ? 'on' : ''}" role="checkbox" aria-checked="${d.escalation && d.escalation.breakthrough ? 'true' : 'false'}" data-esc="breakthrough">Send a second, louder push</button>
        <button class="chip ${d.escalation && d.escalation.notify_coach_on_miss ? 'on' : ''}" role="checkbox" aria-checked="${d.escalation && d.escalation.notify_coach_on_miss ? 'true' : 'false'}" data-esc="notify_coach_on_miss">Tell me who missed</button>
      </div>
      <div class="ts mt">The louder push is time-sensitive and lands once, right after the deadline passes. "Tell me who missed" is one message to you naming everyone who never answered, not one per ${CD.noun}.</div>
    </section>

    <h2 class="eyebrow">Where <span class="opt">· optional</span></h2>
    <section class="card pad">
      <div class="ts" style="padding-bottom:10px">Attach a place and OnStandard confirms ${CD.nouns} actually got there. Leave it off and this stays a check-in only.</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px" id="vc-place" role="radiogroup" aria-label="Location">
        <button class="chip ${!d.location_id ? 'on' : ''}" role="radio" aria-checked="${!d.location_id ? 'true' : 'false'}" data-place="">No location</button>
        ${(VC.locations || []).map((l) => `<button class="chip ${d.location_id === l.id ? 'on' : ''}" role="radio" aria-checked="${d.location_id === l.id ? 'true' : 'false'}" data-place="${esc(l.id)}">${esc(l.name)}</button>`).join('')}
      </div>
      <div style="height:12px"></div>
      <button class="btn ghost sm" id="vc-newplace" style="width:100%">${icon('target', 16)} Add the place I'm standing in</button>
      <div id="vc-placeform" hidden>
        <div style="height:12px"></div>
        <label for="vc-placename" style="display:block;font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Call it what your ${CD.nouns} call it</label>
        <input class="ob-input" id="vc-placename" maxlength="60" placeholder="e.g. Football Facility" />
        <div style="height:10px"></div>
        <label for="vc-placeradius" style="display:block;font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">How close counts <span style="color:var(--text-3);font-weight:600">· metres</span></label>
        <input class="ob-input" id="vc-placeradius" type="number" min="50" max="1000" step="10" value="120" />
        <div class="ts" style="padding-top:6px">120m covers a field and its building. Below 50m a phone's own GPS error starts marking honest ${CD.nouns} absent, so that's the floor.</div>
        <div style="height:10px"></div>
        <button class="btn green" id="vc-saveplace" style="width:100%">${icon('check', 17)} Use my current location</button>
        <div id="vc-placemsg" class="ts" style="padding-top:8px"></div>
      </div>
      ${d.location_id ? `
      <div style="height:14px"></div>
      <div style="display:flex;gap:10px">
        ${timeInput('vc-arrive', 'Arrive by', d.arrive_by_min)}
        <div style="flex:1">
          <label for="vc-dwell" style="display:block;font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Stay at least <span style="color:var(--text-3);font-weight:600">· min</span></label>
          <input class="ob-input" id="vc-dwell" type="number" min="0" max="480" step="5" value="${d.min_dwell_min == null ? '' : esc(String(d.min_dwell_min))}" placeholder="45" />
        </div>
      </div>
      ${/* 0208. This line used to describe arrival only, while the "Stay at least" box beside it
            wrote a number that enforced NOTHING: min_dwell_min round-tripped through this form
            and no code anywhere ever read it, so a coach setting 45 got the same result as a
            coach setting nothing, and a drive-by scored like a full session. It is real now, and
            the copy says what it actually checks, including where it falls back. */''}
      <div class="ts" style="padding-top:10px">Arriving counts when their phone reaches the place inside this window. A minimum stay counts only once their phone has been there that long without leaving, and a phone that cannot report leaving falls back to arrival alone. Neither proves the work got done; completing the session is a separate signal, and nothing in OnStandard claims otherwise.</div>
      ` : ''}
    </section>

    <h2 class="eyebrow">Linked event <span class="opt">· optional</span></h2>
    <section class="card pad">
      <label for="vc-link" style="display:block;font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">What is this roll call for?</label>
      <select class="ob-input" id="vc-link">
        <option value="">Nothing, it stands alone</option>
        ${(RT.vcCommitments || []).filter((c) => c.type !== 'morning_roll_call')
          .map((c) => `<option value="${esc(c.id)}" ${d.linked_commitment_id === c.id ? 'selected' : ''}>${esc(c.title)} · ${esc(fmtMin(c.starts_min))}</option>`).join('')}
      </select>
      <div class="ts" style="padding-top:8px">Pick one and the ${CD.noun}'s card reads "Practice at 6:00 AM" underneath your message.</div>
    </section>

    <div style="height:14px"></div>
    <button class="btn green" id="vc-save" style="width:100%">${icon('check', 19)} Schedule it</button>
    <div id="vc-save-err" class="ts" style="color:var(--red);text-align:center;min-height:16px"></div>
    <div style="height:10px"></div>
    <div class="ts" style="text-align:center">Athletes see this on Home when it opens. Responses land on your board live.</div>
    <div style="height:20px"></div>`;
  },

  mount(root) {
    // Direct entry: kick the book (no bookless screen here — a draft in progress must never be
    // replaced by one). Without the book only the audience pickers (rooms/groups from CD.extras)
    // and canSchedule()'s role read stay empty; they fill on the arrival repaint or next tap.
    ensureBook();
    const id = bookId();
    if (id) {
      // Both repaint when they land: the place chips and the linked-event list are rendered from
      // these, so without the re-render a coach sees an empty picker until something else
      // happens to repaint the screen.
      loadLocations(id, CD.kind).then((rows) => {
        if (root.isConnected && rows.length) window.__render && window.__render();
      });
      loadCommitments(id, CD.kind).then((rows) => {
        RT.vcCommitments = rows;
        if (root.isConnected && rows.length) window.__render && window.__render();
      });
    }
    const d = DRAFT || (DRAFT = blankDraft());
    const val = (sel) => { const el = root.querySelector(sel); return el ? el.value : ''; };
    const minOf = (v) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
      return m ? Math.min(1439, +m[1] * 60 + +m[2]) : null;
    };
    // Capture every free-text field before any re-render, so a chip tap never eats typing.
    const capture = () => {
      // A stale validation message must not outlive the coach's next action.
      const errEl = root.querySelector('#vc-save-err');
      if (errEl) errEl.textContent = '';
      d.title = val('#vc-title').trim();
      d.message = val('#vc-msg').trim();
      d.action_label = val('#vc-action').trim();
      const s = minOf(val('#vc-start')); if (s != null) d.starts_min = s;
      d.respond_by_min = minOf(val('#vc-respond'));
      d.linked_commitment_id = val('#vc-link') || null;
      if (d.location_id) {
        d.arrive_by_min = minOf(val('#vc-arrive'));
        const dw = parseInt(val('#vc-dwell'), 10);
        d.min_dwell_min = isFinite(dw) && dw >= 0 ? Math.min(480, dw) : null;
      }
    };

    root.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
      capture();
      const t = b.getAttribute('data-type');
      // Only replace the title when the coach hasn't personalised it.
      if (!d.title || d.title === TYPE_LABEL[d.type]) d.title = TYPE_LABEL[t];
      d.type = t;
      window.__render && window.__render();
    }));
    root.querySelectorAll('[data-starter]').forEach((b) => b.addEventListener('click', () => {
      capture();
      d.message = (STARTERS[d.type] || [])[+b.getAttribute('data-starter')] || d.message;
      window.__render && window.__render();
    }));
    root.querySelectorAll('#vc-esc [data-esc]').forEach((b) => b.addEventListener('click', () => {
      const k = b.getAttribute('data-esc');
      d.escalation = { ...(d.escalation || {}) };
      d.escalation[k] = !d.escalation[k];
      b.classList.toggle('on', !!d.escalation[k]);
      b.setAttribute('aria-checked', d.escalation[k] ? 'true' : 'false');
    }));
    root.querySelectorAll('[data-aud]').forEach((b) => b.addEventListener('click', () => {
      capture();
      const [kind, value] = b.getAttribute('data-aud').split(':');
      d.audience_kind = kind; d.audience_value = value || null;
      window.__render && window.__render();
    }));
    root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
      capture();
      const n = +b.getAttribute('data-day');
      d.repeat_days = d.repeat_days.includes(n)
        ? d.repeat_days.filter((x) => x !== n) : d.repeat_days.concat(n).sort();
      window.__render && window.__render();
    }));

    root.querySelectorAll('[data-place]').forEach((b) => b.addEventListener('click', () => {
      capture();
      d.location_id = b.getAttribute('data-place') || null;
      // Sensible starting points the coach can override: be there 5 minutes before it starts,
      // and stay for the length of the session if they gave one.
      if (d.location_id && d.arrive_by_min == null) d.arrive_by_min = Math.max(0, d.starts_min - 5);
      window.__render && window.__render();
    }));

    const newPlace = root.querySelector('#vc-newplace');
    if (newPlace) newPlace.addEventListener('click', () => {
      const form = root.querySelector('#vc-placeform');
      if (form) form.hidden = !form.hidden;
    });

    const savePlace = root.querySelector('#vc-saveplace');
    if (savePlace) savePlace.addEventListener('click', async () => {
      const msg = root.querySelector('#vc-placemsg');
      const name = ((root.querySelector('#vc-placename') || {}).value || '').trim();
      if (!name) { if (msg) msg.textContent = 'Give the place a name first.'; return; }
      const radius = Math.max(50, Math.min(1000, parseInt((root.querySelector('#vc-placeradius') || {}).value, 10) || 120));
      const nat = typeof window !== 'undefined' && window.OnStandardNative && window.OnStandardNative.location;
      if (!nat || !nat.place) {
        if (msg) msg.textContent = 'Capturing a location needs the phone app; this build can’t do it.';
        return;
      }
      savePlace.disabled = true; savePlace.textContent = 'Getting your location…';
      const pos = await nat.place().catch(() => null);
      if (!pos) {
        savePlace.disabled = false; savePlace.textContent = 'Use my current location';
        if (msg) msg.textContent = 'Couldn’t get a location. Check that location access is allowed, and try again standing outside.';
        return;
      }
      capture();
      const owner = bookId();
      const row = await saveLocation({
        name, lat: pos.lat, lng: pos.lng, radius_m: radius,
        team_id: CD.kind === 'practice' ? null : owner,
        practice_id: CD.kind === 'practice' ? owner : null,
      });
      if (!row) {
        savePlace.disabled = false; savePlace.textContent = 'Use my current location';
        if (msg) msg.textContent = 'Couldn’t save that place. Try again in a moment.';
        return;
      }
      await loadLocations(owner, CD.kind, true);
      d.location_id = row.id;
      if (d.arrive_by_min == null) d.arrive_by_min = Math.max(0, d.starts_min - 5);
      window.__render && window.__render();
    });

    const save = root.querySelector('#vc-save');
    // Validation speaks in its own line, never by overwriting the button's label: a button
    // that suddenly reads "Give it a title first" stops looking like the way to schedule.
    const sayErr = (msg) => { const el = root.querySelector('#vc-save-err'); if (el) el.textContent = msg; };
    if (save) save.addEventListener('click', async () => {
      if (save.disabled) return;
      capture();
      if (!d.title) { sayErr('Give it a title first.'); return; }
      if (!d.repeat_days.length) { sayErr('Pick at least one day.'); return; }
      const origLabel = save.innerHTML;
      save.disabled = true; save.textContent = 'Scheduling…';
      const owner = bookId();
      const payload = {
        ...d,
        title: d.title,
        message: d.message || null,
        action_label: d.action_label || null,   // null = "the coach didn't choose one"
        team_id: CD.kind === 'practice' ? null : owner,
        practice_id: CD.kind === 'practice' ? owner : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      };
      const newId = await saveCommitment(payload);
      if (!newId) { save.disabled = false; save.innerHTML = origLabel; sayErr('Couldn’t save. Check your connection and try again.'); return; }
      track(EVENTS.VC_SCHEDULED, {
        type: d.type, audience: d.audience_kind, hasLocation: !!d.location_id,
      });
      DRAFT = null;
      if (owner) {
        RT.vcCommitments = await loadCommitments(owner, CD.kind, true);
        await loadBoard(owner, CD.kind, todayISO(), true);
      }
      location.hash = '#coach-commit-manage';
    });
  },
};
