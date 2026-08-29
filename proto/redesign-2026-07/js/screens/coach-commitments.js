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
import { backHead, esc, errorState, skeletonRows, segBar, collapseSection } from '../components.js';
import { CD, bookId } from '../coach-data.js';
// The shared no-book trio (coach-connected.js): kick the book without forcing, the honest
// "can't reach / no book yet / loading" screen for a book-less landing, and the Retry that
// force-loads past a cached offline ROSTER (a plain kick early-returns on it).
import { ensureBook, bookless, wireBookRetry, bookBack } from './coach-connected.js';
import { allowedCreateKeys, isReadonly } from '../staff-access.js';
import { boardCounts, missingFrom, TYPE_LABEL, presenceOf, PRESENCE } from '../commitments.js';
import { fmtMin } from '../requirements.js';
import {
  VC, loadBoard, loadCommitments, loadLocations, saveCommitment, saveLocation,
  setResponse, remindMissing, excuseAthlete, setCommitmentActive, todayISO, shiftISO,
} from '../commitment-data.js';

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
      <div class="eyebrow" style="margin:0 0 6px">${esc(inst.title || TYPE_LABEL[inst.type] || 'Commitment')}</div>
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
    <div class="eyebrow">Still waiting on ${missing.length}</div>
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
    <div class="eyebrow">Responded</div>
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
    if (id) {
      const before = JSON.stringify(VC.board);
      loadBoard(id, CD.kind, todayISO()).then(() => {
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
      const { sent, reason } = await remindMissing(sub);
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
      if (bid) await loadBoard(bid, CD.kind, todayISO(), true);
      window.__render && window.__render();
    };

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

/* "Mon to Fri", not "Mon, Tue, Wed, Thu, Fri". The summary is a sentence a coach reads once
   before tapping, so a run of consecutive days collapses and the two common weeks get a name. */
function daysPhrase(days) {
  const ds = [...new Set(days)].sort((a, b) => a - b);
  if (!ds.length) return 'no days yet';
  if (ds.length === 7) return 'every day';
  if (ds.join() === '1,2,3,4,5') return 'Mon to Fri';
  if (ds.join() === '0,6') return 'weekends';
  let run = 1;
  for (let i = 1; i < ds.length; i++) if (ds[i] === ds[i - 1] + 1) run++; else { run = 0; break; }
  if (run === ds.length && ds.length > 2) return `${DOW_FULL[ds[0]]} to ${DOW_FULL[ds[ds.length - 1]]}`;
  return ds.map((i) => DOW_FULL[i]).join(', ');
}

/* Who it lands on, in the coach's own vocabulary rather than an id. */
function audiencePhrase(d, rooms, groups) {
  if (d.audience_kind === 'room') {
    const r = rooms.find((x) => x.id === d.audience_value);
    return r ? r.label : 'a room';
  }
  if (d.audience_kind === 'group') {
    const g = groups.find((x) => x.id === d.audience_value);
    return g ? g.name : 'a group';
  }
  return CD.kind === 'practice' ? 'all clients' : 'the entire team';
}

/* A confirmation, not a settings recap: one sentence naming what goes out, to whom, when, and by
   when it has to be answered. Anything left at its default is not mentioned at all, so the common
   case stays one line; only settings the coach actually switched on earn a second. */
function summaryLines(d, rooms, groups) {
  const title = (d.title || '').trim() || TYPE_LABEL[d.type];
  const lead = `<b>${esc(title)}</b> goes out to <b>${esc(audiencePhrase(d, rooms, groups))}</b>, ${esc(daysPhrase(d.repeat_days))}.`;
  const timing = d.respond_by_min != null
    ? `It appears at <b>${esc(fmtMin(d.starts_min))}</b> and has to be answered by <b>${esc(fmtMin(d.respond_by_min))}</b>.`
    : `It appears at <b>${esc(fmtMin(d.starts_min))}</b>.`;
  const extras = [];
  const esc0 = d.escalation || {};
  if (esc0.breakthrough) extras.push('a louder second push after the deadline');
  if (esc0.notify_coach_on_miss) extras.push('a message to you naming who missed');
  if (d.location_id) {
    const l = (VC.locations || []).find((x) => x.id === d.location_id);
    extras.push(`arrival confirmed at ${l ? l.name : 'the place you picked'}`);
  }
  if (d.linked_commitment_id) extras.push('a linked event shown under your message');
  return { lead, timing, extras };
}
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
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('clock', 17)}</div>
        <div class="lm" style="flex:1">
          <div class="lt">${esc(r.title || TYPE_LABEL[r.type] || 'Commitment')}</div>
          <div class="ls">${esc(daysLabel(r.repeat_days))} · ${esc(fmtMin(r.starts_min))}${
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
    ${live.length ? `<div class="eyebrow">Running</div>
      <section class="card" style="padding:2px 16px">${live.map(card).join('')}</section>` : ''}
    ${paused.length ? `<div class="eyebrow">Paused</div>
      <section class="card" style="padding:2px 16px">${paused.map(card).join('')}</section>
      <div class="ts" style="padding-top:8px">Paused commitments stop appearing for ${CD.nouns} tomorrow. Everything already recorded against them stays exactly as it is.</div>` : ''}
    <div style="height:14px"></div>
    <button class="btn green" id="vc-new" style="width:100%">${icon('plus', 18)} Schedule a commitment</button>
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

    // Advanced holds the settings most commitments never touch. It opens by itself the moment it
    // holds anything real, which matters because this same screen EDITS existing commitments
    // (editCommitment): collapsing a live location or escalation out of sight would hide settings
    // from the person who came here to change them.
    const advOn = !!(d.action_label || d.location_id || d.linked_commitment_id
      || (d.escalation && (d.escalation.breakthrough || d.escalation.notify_coach_on_miss)));
    const sum = summaryLines(d, rooms, groups);

    const advanced = `
      <div class="vc-f">
        <div class="vc-fl">Button label <span class="opt">· defaults to "${d.type === 'morning_roll_call' ? 'I’m Up' : 'I’m here'}"</span></div>
        <input class="ob-input" id="vc-action" maxlength="24" value="${esc(d.action_label)}" placeholder="${d.type === 'morning_roll_call' ? 'I’m Up' : 'I’m here'}" />
      </div>

      <div class="vc-f">
        <div class="vc-fl">If they miss it</div>
        <div class="vc-esc" id="vc-esc" role="group" aria-label="If they miss it">
          <button class="chip ${d.escalation && d.escalation.breakthrough ? 'on' : ''}" role="checkbox" aria-checked="${d.escalation && d.escalation.breakthrough ? 'true' : 'false'}" data-esc="breakthrough">Louder second push</button>
          <button class="chip ${d.escalation && d.escalation.notify_coach_on_miss ? 'on' : ''}" role="checkbox" aria-checked="${d.escalation && d.escalation.notify_coach_on_miss ? 'true' : 'false'}" data-esc="notify_coach_on_miss">Tell me who missed</button>
        </div>
        <div class="vc-note">The push lands once, right after the deadline. The miss list is one message to you, not one per ${CD.noun}.</div>
      </div>

      <div class="vc-f">
        <div class="vc-fl">Where <span class="opt">· confirms they got there</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="vc-place" role="radiogroup" aria-label="Location">
          <button class="chip ${!d.location_id ? 'on' : ''}" role="radio" aria-checked="${!d.location_id ? 'true' : 'false'}" data-place="">No location</button>
          ${(VC.locations || []).map((l) => `<button class="chip ${d.location_id === l.id ? 'on' : ''}" role="radio" aria-checked="${d.location_id === l.id ? 'true' : 'false'}" data-place="${esc(l.id)}">${esc(l.name)}</button>`).join('')}
        </div>
        <div style="height:10px"></div>
        <button class="btn ghost sm" id="vc-newplace" style="width:100%">${icon('target', 16)} Add the place I'm standing in</button>
        <div id="vc-placeform" hidden>
          <div style="height:10px"></div>
          <label for="vc-placename" class="vc-fl" style="display:block">Call it what your ${CD.nouns} call it</label>
          <input class="ob-input" id="vc-placename" maxlength="60" placeholder="e.g. Football Facility" />
          <div style="height:10px"></div>
          <label for="vc-placeradius" class="vc-fl" style="display:block">How close counts <span class="opt">· metres</span></label>
          <input class="ob-input" id="vc-placeradius" type="number" min="50" max="1000" step="10" value="120" />
          <div class="vc-note">120m covers a field and its building. Below 50m a phone's own GPS error starts marking honest ${CD.nouns} absent.</div>
          <div style="height:10px"></div>
          <button class="btn green" id="vc-saveplace" style="width:100%">${icon('check', 17)} Use my current location</button>
          <div id="vc-placemsg" class="vc-note"></div>
        </div>
        ${d.location_id ? `
        <div style="height:12px"></div>
        <div style="display:flex;gap:10px">
          ${timeInput('vc-arrive', 'Arrive by', d.arrive_by_min)}
          <div style="flex:1">
            <label for="vc-dwell" class="vc-fl" style="display:block">Stay at least <span class="opt">· min</span></label>
            <input class="ob-input" id="vc-dwell" type="number" min="0" max="480" step="5" value="${d.min_dwell_min == null ? '' : esc(String(d.min_dwell_min))}" placeholder="45" />
          </div>
        </div>
        ${/* 0208. The stay minimum is real and enforced; the note says what is actually checked,
              including the fallback, because a phone that cannot report leaving is common. */''}
        <div class="vc-note">Arrival counts when their phone reaches the place inside the window. A minimum stay counts once their phone has been there that long without leaving; a phone that cannot report leaving falls back to arrival alone. Neither proves the work got done.</div>
        ` : ''}
      </div>

      <div class="vc-f">
        <label for="vc-link" class="vc-fl" style="display:block">Linked event <span class="opt">· shown under your message</span></label>
        <select class="ob-input" id="vc-link">
          <option value="">Nothing, it stands alone</option>
          ${(RT.vcCommitments || []).filter((c) => c.type !== 'morning_roll_call')
            .map((c) => `<option value="${esc(c.id)}" ${d.linked_commitment_id === c.id ? 'selected' : ''}>${esc(c.title)} · ${esc(fmtMin(c.starts_min))}</option>`).join('')}
        </select>
      </div>`;

    return `
    ${backHead('Schedule a commitment', CD.kind === 'practice' ? 'Clients see it when it opens' : 'Athletes see it when it opens', back)}

    <div class="eyebrow">Commitment</div>
    <section class="card vc-sec">
      <div class="chips-wrap" id="vc-type" style="display:flex;flex-wrap:wrap;gap:6px" role="radiogroup" aria-label="Commitment type">
        ${TYPES.map((t) => `<button class="chip ${d.type === t ? 'on' : ''}" role="radio" aria-checked="${d.type === t ? 'true' : 'false'}" data-type="${t}">${esc(TYPE_LABEL[t])}</button>`).join('')}
      </div>
      <div class="vc-f">
        <label for="vc-title" class="vc-fl" style="display:block">Title</label>
        <input class="ob-input" id="vc-title" maxlength="60" value="${esc(d.title)}" placeholder="${esc(TYPE_LABEL[d.type])}" />
      </div>
      <div class="vc-f">
        <label for="vc-msg" class="vc-fl" style="display:block">Your message <span class="opt">· optional</span></label>
        <textarea class="ob-input" id="vc-msg" maxlength="200" rows="2" style="min-height:58px;resize:vertical" placeholder="Say it how you'd say it in the room.">${esc(d.message)}</textarea>
        ${starters.length ? `<div class="vc-starters">
          ${starters.map((s, i) => `<button class="chip" data-starter="${i}">${esc(s.length > 34 ? s.slice(0, 32) + '…' : s)}</button>`).join('')}
        </div>` : ''}
      </div>
    </section>

    <div class="eyebrow">Who &amp; when</div>
    <section class="card vc-sec">
      <div style="display:flex;flex-wrap:wrap;gap:6px" id="vc-aud" role="radiogroup" aria-label="Who gets it">
        <button class="chip ${d.audience_kind === 'team' ? 'on' : ''}" role="radio" aria-checked="${d.audience_kind === 'team' ? 'true' : 'false'}" data-aud="team">${CD.kind === 'practice' ? 'All clients' : 'Entire team'}</button>
        ${rooms.map((r) => `<button class="chip ${d.audience_value === r.id ? 'on' : ''}" role="radio" aria-checked="${d.audience_value === r.id ? 'true' : 'false'}" data-aud="room:${esc(r.id)}">${esc(r.label)}</button>`).join('')}
        ${groups.map((g) => `<button class="chip ${d.audience_value === g.id ? 'on' : ''}" role="radio" aria-checked="${d.audience_value === g.id ? 'true' : 'false'}" data-aud="group:${esc(g.id)}">${esc(g.name)}</button>`).join('')}
      </div>
      <div class="vc-f">
        <div style="display:flex;gap:5px" id="vc-days" role="group" aria-label="Repeat on days">
          ${DOW.map((n, i) => `<button class="chip vc-day ${d.repeat_days.includes(i) ? 'on' : ''}" role="checkbox" aria-checked="${d.repeat_days.includes(i) ? 'true' : 'false'}" aria-label="${DOW_FULL[i]}" data-day="${i}">${n}</button>`).join('')}
        </div>
      </div>
      <div class="vc-f">
        <div style="display:flex;gap:10px">
          ${timeInput('vc-start', 'Appears at', d.starts_min)}
          ${timeInput('vc-respond', 'Answer by', d.respond_by_min)}
        </div>
        <div class="vc-note">Reminders go out 15 and 5 minutes before, only to ${CD.nouns} who haven't answered.</div>
      </div>
    </section>

    ${collapseSection('vc-adv', 'Advanced', null, `<section class="card vc-sec vc-adv">${advanced}</section>`, advOn)}

    ${/* The confirmation, immediately above the button it describes. */''}
    <div class="vc-sum">
      <div class="l">${sum.lead}</div>
      <div class="l">${sum.timing}</div>
      ${sum.extras.length ? `<div class="x">Plus ${esc(sum.extras.join(', '))}.</div>` : ''}
    </div>

    <button class="btn green" id="vc-save" style="width:100%">${icon('check', 19)} Schedule it</button>
    <div id="vc-save-err" class="vc-err"></div>
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
      // The field's placeholder has been showing this the whole time, and blankDraft() pre-fills
      // it; the only way to reach here is to CLEAR it, and refusing to save then made the coach
      // retype a word the form was already displaying to them.
      if (!d.title) d.title = TYPE_LABEL[d.type];
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
