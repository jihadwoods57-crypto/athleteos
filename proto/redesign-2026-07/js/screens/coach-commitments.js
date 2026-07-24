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
import { backHead, esc } from '../components.js';
import { CD, bookId } from '../coach-data.js';
import { allowedCreateKeys, isReadonly } from '../staff-access.js';
import { boardCounts, missingFrom, TYPE_LABEL } from '../commitments.js';
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
      <div class="ts" style="padding-top:4px">This isn’t a count of zero — we couldn’t reach the server. Pull to refresh in a moment.</div>
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
      <div style="display:flex;align-items:baseline;gap:10px">
        <div style="font-size:26px;font-weight:800;letter-spacing:-.02em;color:${allIn ? 'var(--green-bright)' : 'var(--text)'}">
          ${c.responded} of ${c.total}</div>
        <div style="font-size:13px;font-weight:700;color:var(--text-2)">in</div>
        <div style="flex:1"></div>
        <span class="xpill ${allIn ? 'green' : 'gold'}">${allIn ? 'All in' : `${c.awaiting} awaiting`}</span>
      </div>
      ${c.excused || c.unverified ? `<div class="ts" style="padding-top:8px">${
        [c.excused ? `${c.excused} excused` : '', c.unverified ? `${c.unverified} unverified` : '']
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

const STATUS_PILL = {
  pending: ['gold', 'Awaiting'], acknowledged: ['green', 'In'],
  arrived: ['green', 'Arrived'], completed: ['green', 'Completed'],
  excused: ['gray', 'Excused'], unverified: ['gold', 'Unverified'], missed: ['red', 'No response'],
};

function athleteRow(r, asksArrival) {
  const [cls, label] = STATUS_PILL[r.status] || ['gray', r.status];
  const when = r.completed_at ? `Completed ${hhmm(r.completed_at)}`
    : r.arrived_at ? `Arrived ${hhmm(r.arrived_at)}`
    : r.acknowledged_at ? `Responded ${hhmm(r.acknowledged_at)}`
    : r.status === 'excused' ? (r.excused_reason || 'Excused')
    : r.status === 'unverified' ? (r.unverified_reason || 'Couldn’t verify')
    : 'No response yet';
  const src = r.arrival_source === 'staff' ? ' · set by staff'
    : r.arrival_source === 'geofence' ? ' · verified at the location'
    : r.arrival_source === 'manual' ? ' · self-reported' : '';
  return `
  <div class="lrow" style="align-items:flex-start">
    <div class="lm" style="flex:1">
      <div class="lt">${esc(r.name || 'Athlete')}</div>
      <div class="ls">${esc(when)}${esc(src)}${r.corrected_by_name ? esc(` · corrected by ${r.corrected_by_name}`) : ''}</div>
      ${r.disputed_at ? `<div class="ls" style="color:var(--amber-bright);font-weight:700">Reported wrong by the athlete${r.dispute_note ? esc(` — ${r.dispute_note}`) : ''}</div>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
      <span class="xpill ${cls}">${esc(label)}</span>
      <div style="display:flex;gap:6px">
        ${r.status !== 'excused' ? `<button class="chip" data-vc-excuse="${esc(r.athlete_id)}">Excuse</button>` : ''}
        ${r.status === 'pending' || r.status === 'unverified' || r.status === 'missed'
          ? `<button class="chip" data-vc-mark="${esc(r.response_id)}">${asksArrival ? 'Mark arrived' : 'Mark in'}</button>` : ''}
      </div>
    </div>
  </div>`;
}

export const coachCommitments = {
  nav: 'operator', tab: 'home',
  render({ sub }) {
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
    const inst = (VC.board || []).find((b) => b.instance_id === sub) || (VC.board || [])[0];
    if (!inst) {
      return `${backHead('Roll call', 'Nothing scheduled today', back)}
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('clock', 17)}</div>
        <div><div class="tt">No commitments today</div>
        <div class="ts">Schedule a morning roll call, a lift, or a study hall and you'll see live responses here — without counting replies in a group chat.</div></div>
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
      <div style="display:flex;align-items:baseline;gap:10px">
        <div style="font-size:30px;font-weight:800;letter-spacing:-.02em;color:${c.awaiting ? 'var(--text)' : 'var(--green-bright)'}">${c.responded} of ${c.total}</div>
        <div style="font-size:14px;font-weight:700;color:var(--text-2)">in</div>
        <div style="flex:1"></div>
        <span class="xpill ${c.awaiting ? 'gold' : 'green'}">${c.awaiting ? `${c.awaiting} awaiting` : 'All in'}</span>
      </div>
      ${inst.respond_by_at ? `<div class="ts" style="padding-top:8px">Responses due by ${esc(hhmm(inst.respond_by_at))}</div>` : ''}
    </section>

    ${missing.length ? `
    <div class="eyebrow">Still waiting on ${missing.length}</div>
    <section class="card" style="padding:2px 16px">${missing.map((r) => athleteRow(r, !!inst.asks_arrival)).join('')}</section>
    <div style="height:10px"></div>
    <button class="btn" id="vc-remind" style="width:100%">${icon('bell', 18)} Remind ${missing.length} missing ${missing.length === 1 ? 'athlete' : 'athletes'}</button>
    <div class="ts" style="text-align:center;padding-top:8px">Only these ${missing.length} get the reminder. Nobody who already responded is pinged.</div>
    ` : `
    <div class="sidebox" style="margin-top:12px">
      <div class="req-icon g" style="width:38px;height:38px">${icon('check', 19)}</div>
      <div><div class="tt">Everyone is in</div>
      <div class="ts">No reminders to send and nobody to chase.</div></div>
    </div>`}

    ${responded.length ? `
    <div class="eyebrow">Responded</div>
    <section class="card" style="padding:2px 16px">${responded.map((r) => athleteRow(r, !!inst.asks_arrival)).join('')}</section>` : ''}

    ${inst.asks_arrival ? `
    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 19)}</div>
      <div><div class="tt">What "Arrived" means</div>
      <div class="ts">The athlete's phone reached ${esc(inst.location_name || 'the location')} inside the scheduled window. It does not prove the session was completed — that's the separate Completed signal.</div></div>
    </div>` : ''}
    <div style="height:20px"></div>`;
  },

  mount(root, { sub }) {
    const id = bookId();
    if (id) loadBoard(id, CD.kind, todayISO(), true).then(() => {
      if (root.isConnected) window.__render && window.__render();
    });

    const remind = root.querySelector('#vc-remind');
    if (remind) remind.addEventListener('click', async () => {
      remind.disabled = true; remind.textContent = 'Sending…';
      const n = await remindMissing(sub);
      if (n) track(EVENTS.VC_REMINDED, { n });
      remind.textContent = n ? `Reminded ${n}` : 'Couldn’t send — try again';
      if (!n) remind.disabled = false;
    });

    const repaint = async () => {
      const bid = bookId();
      if (bid) await loadBoard(bid, CD.kind, todayISO(), true);
      window.__render && window.__render();
    };

    root.querySelectorAll('[data-vc-mark]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = '…';
      const ok = await setResponse(b.getAttribute('data-vc-mark'), 'acknowledged', null);
      if (!ok) { b.disabled = false; b.textContent = 'Mark in'; return; }
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
      wrap.replaceChildren(...opts.map(([label, addDays]) => {
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
      }));
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
  morning_roll_call: ['Everyone up? Ready to rise and conquer?', 'Feet on the floor. Let’s go.', 'Up and moving — today starts now.'],
  study_hall: ['Books open. Two hours, no phones.'],
  rehab: ['Rehab today — don’t skip it, it’s how you get back.'],
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
});

const timeInput = (id, label, val) => `
  <div style="flex:1">
    <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">${esc(label)}</div>
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
    active: row.active !== false,
  };
}

export const coachCommitManage = {
  nav: 'operator', tab: 'home',
  render() {
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
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
    ${!rows.length ? `
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('clock', 17)}</div>
        <div><div class="tt">Nothing scheduled yet</div>
        <div class="ts">Schedule a morning roll call, a lift, or a study hall and it'll live here — editable, pausable, and never silently deleted.</div></div>
      </div>` : ''}
    ${live.length ? `<div class="eyebrow">Running</div>
      <section class="card" style="padding:2px 16px">${live.map(card).join('')}</section>` : ''}
    ${paused.length ? `<div class="eyebrow">Paused</div>
      <section class="card" style="padding:2px 16px">${paused.map(card).join('')}</section>
      <div class="ts" style="padding-top:8px">Paused commitments stop appearing for athletes tomorrow. Everything already recorded against them stays exactly as it is.</div>` : ''}
    <div style="height:14px"></div>
    <button class="btn green" id="vc-new" style="width:100%">${icon('plus', 18)} Schedule a commitment</button>
    <div style="height:20px"></div>`;
  },

  mount(root) {
    const id = bookId();
    if (id) loadCommitments(id, CD.kind, true).then((rows) => {
      RT.vcCommitments = rows;
      if (root.isConnected) window.__render && window.__render();
    });

    const create = root.querySelector('#vc-new');
    if (create) create.addEventListener('click', () => {
      DRAFT = null;                       // a fresh sheet, not the last thing edited
      location.hash = '#/coach-commit-edit';
    });

    root.querySelectorAll('[data-vc-edit]').forEach((b) => b.addEventListener('click', () => {
      const row = (RT.vcCommitments || []).find((r) => r.id === b.getAttribute('data-vc-edit'));
      if (!row) return;
      editCommitment(row);
      location.hash = '#/coach-commit-edit';
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

    <div class="eyebrow">What is it</div>
    <section class="card pad">
      <div class="chips-wrap" id="vc-type" style="display:flex;flex-wrap:wrap;gap:6px">
        ${TYPES.map((t) => `<button class="chip ${d.type === t ? 'on' : ''}" data-type="${t}">${esc(TYPE_LABEL[t])}</button>`).join('')}
      </div>
      <div style="height:14px"></div>
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">What the athletes see as the title</div>
      <input class="ob-input" id="vc-title" maxlength="60" value="${esc(d.title)}" placeholder="${esc(TYPE_LABEL[d.type])}" />
      <div style="height:14px"></div>
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Your message <span style="color:var(--text-3);font-weight:600">· optional, your words</span></div>
      <textarea class="ob-input" id="vc-msg" maxlength="200" rows="2" style="min-height:60px;resize:vertical" placeholder="Say it how you'd say it in the room.">${esc(d.message)}</textarea>
      ${starters.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
        ${starters.map((s, i) => `<button class="chip" data-starter="${i}">${esc(s.length > 34 ? s.slice(0, 32) + '…' : s)}</button>`).join('')}
      </div>
      <div class="ts" style="padding-top:6px">Tap one to load it in and edit it — or ignore them and write your own.</div>` : ''}
      <div style="height:14px"></div>
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Button label</div>
      <input class="ob-input" id="vc-action" maxlength="24" value="${esc(d.action_label)}" placeholder="${d.type === 'morning_roll_call' ? 'I’m Up' : 'I’m here'}" />
    </section>

    <div class="eyebrow">Who gets it</div>
    <section class="card pad">
      <div style="display:flex;flex-wrap:wrap;gap:6px" id="vc-aud">
        <button class="chip ${d.audience_kind === 'team' ? 'on' : ''}" data-aud="team">${CD.kind === 'practice' ? 'All clients' : 'Entire team'}</button>
        ${rooms.map((r) => `<button class="chip ${d.audience_value === r.id ? 'on' : ''}" data-aud="room:${esc(r.id)}">${esc(r.label)}</button>`).join('')}
        ${groups.map((g) => `<button class="chip ${d.audience_value === g.id ? 'on' : ''}" data-aud="group:${esc(g.id)}">${esc(g.name)}</button>`).join('')}
      </div>
    </section>

    <div class="eyebrow">When</div>
    <section class="card pad">
      <div style="display:flex;gap:6px" id="vc-days">
        ${DOW.map((n, i) => `<button class="chip ${d.repeat_days.includes(i) ? 'on' : ''}" data-day="${i}" style="flex:1;padding:8px 0">${n}</button>`).join('')}
      </div>
      <div style="height:14px"></div>
      <div style="display:flex;gap:10px">
        ${timeInput('vc-start', 'Appears / starts', d.starts_min)}
        ${timeInput('vc-respond', 'Respond by', d.respond_by_min)}
      </div>
      <div class="ts" style="padding-top:10px">A reminder goes out 15 and 5 minutes before the deadline — only to athletes who haven’t responded.</div>
    </section>

    <div class="eyebrow">Where <span style="text-transform:none;letter-spacing:0">· optional</span></div>
    <section class="card pad">
      <div class="ts" style="padding-bottom:10px">Attach a place and OnStandard confirms athletes actually got there. Leave it off and this stays a check-in only.</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px" id="vc-place">
        <button class="chip ${!d.location_id ? 'on' : ''}" data-place="">No location</button>
        ${(VC.locations || []).map((l) => `<button class="chip ${d.location_id === l.id ? 'on' : ''}" data-place="${esc(l.id)}">${esc(l.name)}</button>`).join('')}
      </div>
      <div style="height:12px"></div>
      <button class="btn ghost sm" id="vc-newplace" style="width:100%">${icon('target', 16)} Add the place I'm standing in</button>
      <div id="vc-placeform" hidden>
        <div style="height:12px"></div>
        <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Call it what your athletes call it</div>
        <input class="ob-input" id="vc-placename" maxlength="60" placeholder="e.g. Football Facility" />
        <div style="height:10px"></div>
        <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">How close counts <span style="color:var(--text-3);font-weight:600">· metres</span></div>
        <input class="ob-input" id="vc-placeradius" type="number" min="50" max="1000" step="10" value="120" />
        <div class="ts" style="padding-top:6px">120m covers a field and its building. Below 50m a phone's own GPS error starts marking honest athletes absent, so that's the floor.</div>
        <div style="height:10px"></div>
        <button class="btn green" id="vc-saveplace" style="width:100%">${icon('check', 17)} Use my current location</button>
        <div id="vc-placemsg" class="ts" style="padding-top:8px"></div>
      </div>
      ${d.location_id ? `
      <div style="height:14px"></div>
      <div style="display:flex;gap:10px">
        ${timeInput('vc-arrive', 'Arrive by', d.arrive_by_min)}
        <div style="flex:1">
          <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Stay at least <span style="color:var(--text-3);font-weight:600">· min</span></div>
          <input class="ob-input" id="vc-dwell" type="number" min="0" max="480" step="5" value="${d.min_dwell_min == null ? '' : esc(String(d.min_dwell_min))}" placeholder="45" />
        </div>
      </div>
      <div class="ts" style="padding-top:10px">Arriving counts when their phone reaches the place inside this window. It does not prove the work got done — completing the session is a separate signal, and nothing in OnStandard claims otherwise.</div>
      ` : ''}
    </section>

    <div class="eyebrow">Linked event <span style="text-transform:none;letter-spacing:0">· optional</span></div>
    <section class="card pad">
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">What is this roll call for?</div>
      <select class="ob-input" id="vc-link">
        <option value="">Nothing — it stands alone</option>
        ${(RT.vcCommitments || []).filter((c) => c.type !== 'morning_roll_call')
          .map((c) => `<option value="${esc(c.id)}" ${d.linked_commitment_id === c.id ? 'selected' : ''}>${esc(c.title)} · ${esc(fmtMin(c.starts_min))}</option>`).join('')}
      </select>
      <div class="ts" style="padding-top:8px">Pick one and the athlete's card reads "Practice at 6:00 AM" underneath your message.</div>
    </section>

    <div style="height:14px"></div>
    <button class="btn green" id="vc-save" style="width:100%">${icon('check', 19)} Schedule it</button>
    <div style="height:10px"></div>
    <div class="ts" style="text-align:center">Athletes see this on Home when it opens. Responses land on your board live.</div>
    <div style="height:20px"></div>`;
  },

  mount(root) {
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
        if (msg) msg.textContent = 'Capturing a location needs the phone app — this build can’t do it.';
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
    if (save) save.addEventListener('click', async () => {
      if (save.disabled) return;
      capture();
      if (!d.title) { save.textContent = 'Give it a title first'; return; }
      if (!d.repeat_days.length) { save.textContent = 'Pick at least one day'; return; }
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
      if (!newId) { save.disabled = false; save.textContent = 'Couldn’t save — try again'; return; }
      track(EVENTS.VC_SCHEDULED, {
        type: d.type, audience: d.audience_kind, hasLocation: !!d.location_id,
      });
      DRAFT = null;
      if (owner) {
        RT.vcCommitments = await loadCommitments(owner, CD.kind, true);
        await loadBoard(owner, CD.kind, todayISO(), true);
      }
      location.hash = '#/coach-commit-manage';
    });
  },
};
