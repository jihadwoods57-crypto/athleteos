/* OnStandard — Connected Standards, operator side (0155).
   Two screens plus the Home card:
     · standardsBoardCard()  — the live count on coach/trainer Home ("46 of 55 complete")
     · coachStandards        — the roster breakdown: who's short, who's waiting on a device,
                               who submitted by hand, and the staff actions for each
     · coachStandardEdit     — the builder

   ⚠ WHAT THE COACH SEES, AND ONLY THAT. The board payload (connected_standard_board, 0155)
   returns a status and a PERCENTAGE of the target the coach themselves set. There is no raw step
   count in it, no route, no workout time, no heart rate — the function is structurally incapable
   of returning them. A coach asked for 10,000 steps; they learn whether they got 10,000 steps.

   ⚠ AND NO PUBLIC RANKING. Individual status is staff-only by RLS, the rows are sorted by name
   rather than by performance, and there is no team-wide list of who came up short.

   nav:'operator' — one module renders for a coach's team AND a trainer's practice. */
import { icon } from '../icons.js';
import { track, EVENTS } from '../analytics.js';
import { backHead, esc, errorState } from '../components.js';
import { initialsOf } from '../initials.js';
import { CD, bookId } from '../coach-data.js';
import { allowedCreateKeys, isReadonly } from '../staff-access.js';
import {
  boardCounts, needsAttention, csStatus, fmtValue, unitNoun,
  metricLabel, sourceRule, toCanonical, toDisplay,
} from '../connected-standards.js';
import {
  CS, loadBoard, loadOwnerStandards, saveStandard, setStandardActive,
  reviewManual, staffSetResult, todayISO,
} from '../connected-standard-data.js';

const PILL = { green: 'green', cyan: 'blue', blue: 'blue', purple: 'purple', amber: 'gold', red: 'red', slate: 'gray' };
const pillFor = (s) => PILL[csStatus(s).tone] || 'gray';

const hhmm = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const canSet = () => {
  if (CD.kind === 'practice') return true;              // a trainer owns their practice outright
  const role = CD.extras ? CD.extras.myRole : null;
  if (!CD.extras) return true;                          // never blank the menu on a slow fetch
  return !isReadonly(role) && allowedCreateKeys(role).includes('standards');
};

/* ---------------------------------------------------------------- the standing bar
   The coach surface already has an instrument for "what is the shape of my team right now": the
   Standing Bar from the Command Center pass (.co-standing / .co-legend in coach.css). Connected
   Standards uses it rather than inventing a second chart language, so this feature reads as part
   of the coach's dashboard instead of a bolt-on.

   ORDER IS BY PROPORTION, NOT BY SEVERITY. Leading with the exceptions would make a team that is
   54-for-55 look like a crisis every single evening, and a coach who learns the bar always opens
   red stops reading it. The bar answers "how did we do"; the sections below answer "who do I
   talk to". Each does exactly one job.

   The legend says what a person would say. A coach does not care that the enum reads
   'awaiting_sync' — they care that a phone hasn't reported. */
const SEGMENTS = [
  { key: 'complete', cls: 'g', dot: 'g', label: 'met' },
  { key: 'inProgress', cls: 'b', dot: 'b', label: 'still going' },
  { key: 'awaitingReview', cls: 'p', dot: 'p', label: 'waiting on you' },
  { key: 'gap', cls: 'a', dot: 'a', label: 'waiting on a device' },
  { key: 'missed', cls: 'r', dot: 'r', label: 'short' },
  { key: 'excused', cls: 'd', dot: 'd', label: 'excused' },
];

/** Fold the nine statuses into the six things a coach actually distinguishes. */
function segmentCounts(c) {
  return {
    complete: c.complete,
    inProgress: c.inProgress,
    awaitingReview: c.awaitingReview,
    gap: c.awaitingSync + c.disconnected + c.insufficient,
    missed: c.missed,
    excused: c.excused,
  };
}

function standingBar(c) {
  const s = segmentCounts(c);
  const total = SEGMENTS.reduce((t, x) => t + (s[x.key] || 0), 0);
  if (!total) return '';
  return `<div class="co-standing">${SEGMENTS
    .filter((x) => s[x.key] > 0)
    .map((x) => `<div class="seg ${x.cls}" style="flex:${s[x.key]}"></div>`).join('')}</div>`;
}

function standingLegend(c) {
  const s = segmentCounts(c);
  return `<div class="co-legend">${SEGMENTS
    .filter((x) => s[x.key] > 0)
    .map((x) => `<span class="it"><span class="dot ${x.dot}"></span><b>${s[x.key]}</b> ${esc(x.label)}</span>`)
    .join('')}</div>`;
}

/* ---------------------------------------------------------------- Home card */

/** '' when nothing is set today, so an operator who has never used this sees no change at all. */
export function standardsBoardCard() {
  const rows = CS.board;
  // Same honesty rule as the athlete card: a coach must never read "all clear" when the truth is
  // "we couldn't load the board". A wrong count is worse than no count.
  if ((!rows || !rows.length) && CS.boardError) {
    return `<section class="card pad" style="border-color:var(--amber-border);margin-bottom:10px">
      <div class="cs-h">Activity standards didn’t load</div>
      <div class="cs-p" style="padding-top:4px">This isn’t a count of zero — we couldn’t reach the server. Try again in a moment.</div>
    </section>`;
  }
  if (!rows || !rows.length) return '';
  return rows.map((inst) => {
    const c = boardCounts(inst.rows || []);
    if (!c.total) return '';
    const allIn = c.complete === c.total;
    // ONE chip, and only when something is genuinely waiting on this coach. A row of six
    // equal-weight status pills is a data dump wearing a summary's clothes — it hands the sorting
    // back to the person the screen is supposed to be sorting for.
    const waiting = c.awaitingReview;
    return `
    <section class="card pad cs-board" data-go="coach-standards/${esc(inst.instance_id)}">
      <div class="cs-board-head">
        <span class="cs-eyebrow">${esc(inst.title || 'Activity standard')}</span>
        <span class="cs-ask">${esc(`${fmtValue(inst.target, inst.metric, inst.display_unit)} ${unitNoun(inst.metric, inst.display_unit, inst.target)}`)}</span>
      </div>
      <div class="cs-count sm ${allIn ? 'done' : ''}">
        <span class="n">${c.complete}</span>
        <span class="u">of ${c.total} ${esc(inst.period === 'week' ? 'this week' : 'today')}</span>
        <span class="cs-grow"></span>
        ${waiting ? `<span class="xpill purple">${waiting} waiting on you</span>` : ''}
      </div>
      ${standingBar(c)}
    </section>`;
  }).join('');
}

/** Paint the board card into a slot on operator Home. Same async-slot seam Home uses elsewhere. */
export function paintStandardsBoard(root, slotId = '#cs-board-slot') {
  const slot = root.querySelector(slotId);
  if (!slot) return;
  const paint = () => { if (slot.isConnected) slot.innerHTML = standardsBoardCard(); };
  paint();
  const id = bookId();
  if (id) loadBoard(CD.kind === 'practice' ? null : id, CD.kind === 'practice' ? id : null).then(paint);
}

/* ---------------------------------------------------------------- the board */

function athleteRow(r, inst) {
  const st = csStatus(r.status);
  const pct = Math.max(0, Math.min(100, Number(r.progress_pct) || 0));
  // The sub-line names the REASON, so a coach never has to guess whether someone is slacking or
  // whether a phone is dead. These are very different conversations.
  // A verified row gets NO second line. "100% of target" beside a pill that already reads
  // Verified is the same fact twice, and across 46 of them it is the noise that buries the three
  // rows a coach actually has to read. Leaving it out makes the exceptions the only two-line
  // rows on the screen — they stand out because of what they are, not because of a colour.
  const why = r.status === 'awaiting_sync' ? `No data since ${hhmm(r.last_synced_at) || 'yesterday'}`
    : r.status === 'disconnected' ? 'Health access off'
    : r.status === 'insufficient_data' ? 'Never reported'
    : r.status === 'awaiting_review' ? esc(r.manual_note || 'Submitted by hand')
    : r.status === 'completed_manually' ? `Reported by the ${CD.noun}`
    : r.status === 'excused' ? esc(r.excused_reason || 'Excused')
    : r.status === 'verified_complete' ? ''
    : `${pct}% of target`;

  // The bar is drawn only where "how close did they get" is information. On a verified row it
  // would always be 100% and on an excused one it means nothing — a full-width green bar next to
  // a green pill is the same fact said twice.
  const showBar = r.status === 'in_progress' || r.status === 'missed';

  return `<div class="lrow" data-cs-row="${esc(r.result_id)}">
    <div class="lic cs-ini">${esc(initials(r.name))}</div>
    <div class="lm">
      <div class="lt">${esc(r.name || 'Athlete')}</div>
      ${why || r.disputed_at ? `<div class="ls">${why}${r.disputed_at ? `${why ? ' · ' : ''}disputed` : ''}</div>` : ''}
      ${showBar ? `<div class="cs-mini"><i style="width:${pct}%"></i></div>` : ''}
    </div>
    <span class="xpill ${pillFor(r.status)}">${esc(st.label)}</span>
  </div>`;
}

const initials = (name) => initialsOf(name, '?');

/* Signature of the board the screen last painted — see the loop note in mount(). */
let BOARD_SIG = null;

export const coachStandards = {
  nav: 'operator',
  render({ sub }) {
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
    const inst = (CS.board || []).find((b) => b.instance_id === sub) || (CS.board || [])[0];
    if (!inst) {
      // Three honest states — this used to render "Loading…" forever when the board resolved
      // empty (nothing scheduled today / standard turned off) or errored.
      if (CS.boardError) {
        return `${backHead('Activity standard', "Can't reach the board", back)}
        <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
        <div class="sd-t">Can't reach the board</div>
        <div class="sd-s">Check your connection — reopen this screen to retry. Nothing is lost.</div></div>`;
      }
      if (CS.boardAt) {
        return `${backHead('Activity standard', 'Nothing scheduled today', back)}
        <div class="state-demo"><div class="sd-ic">${icon('clipboard', 24)}</div>
        <div class="sd-t">No activity standard today</div>
        <div class="sd-s">When a standard is scheduled, everyone's verified results land here in real time.</div>
        <div class="sd-cta" style="margin-top:16px"><button class="btn primary sm" data-go="coach-standards-manage">${icon('clipboard', 16)} Manage standards</button></div></div>`;
      }
      return `${backHead('Activity standard', 'Loading…', back)}
      <section class="card pad"><div class="cs-p">Loading the board…</div></section>`;
    }
    const rows = inst.rows || [];
    const c = boardCounts(rows);
    // Three DIFFERENT asks, kept apart because they need different things from the coach:
    //   review   — an athlete submitted by hand and is waiting on a ruling
    //   disputed — an athlete says the verdict is wrong; a human has to answer them
    //   gaps     — the device never reported. NOT a miss, and not the athlete's doing.
    // Folding a disputed 'missed' into the gap group would file a verified shortfall under
    // "couldn't be verified", which is exactly the kind of quiet mislabel this feature must not
    // make about someone's record.
    const review = rows.filter((r) => r.status === 'awaiting_review');
    const disputed = rows.filter((r) => r.disputed_at && r.status !== 'awaiting_review');
    const gaps = needsAttention(rows).filter((r) =>
      r.status !== 'awaiting_review' && !r.disputed_at);
    const flagged = new Set([...review, ...disputed, ...gaps]);
    const rest = rows.filter((r) => !flagged.has(r));

    return `${backHead(inst.title || 'Activity standard', [
      inst.audience_label || (CD.kind === 'practice' ? 'All clients' : 'Entire team'),
      `${fmtValue(inst.target, inst.metric, inst.display_unit)} ${unitNoun(inst.metric, inst.display_unit, inst.target)}`,
    ].join(' · '), back)}

    <section class="card pad">
      <div class="cs-count ${c.complete === c.total ? 'done' : ''}">
        <span class="n">${c.complete}</span>
        <span class="u">of ${c.total} complete</span>
      </div>
      ${standingBar(c)}
      ${standingLegend(c)}
      ${inst.deadline_at ? `<div class="cs-p muted" style="margin-top:12px">Due by ${esc(hhmm(inst.deadline_at))}</div>` : ''}
    </section>

    ${!review.length && !disputed.length && !gaps.length ? `
    <section class="card pad">
      <div class="cs-clear">
        <div class="ic">${icon('check', 19)}</div>
        <div>
          <div class="cs-h">Nothing waiting on you</div>
          <div class="cs-p">Every ${CD.noun} either met this or has a reason on file.</div>
        </div>
      </div>
    </section>` : ''}

    ${review.length ? `
    <div class="eyebrow">Waiting on you · ${review.length}</div>
    <section class="card" style="padding:2px 16px">${review.map((r) => `
      ${athleteRow(r, inst)}
      <div style="display:flex;gap:8px;padding:0 0 12px">
        <button class="btn primary sm" data-cs-ok="${esc(r.result_id)}" style="flex:1">Approve</button>
        <button class="btn ghost sm" data-cs-no="${esc(r.result_id)}" style="flex:1">Not this time</button>
      </div>`).join('')}
    </section>` : ''}

    ${disputed.length ? `
    <div class="eyebrow">Disputed · ${disputed.length}</div>
    <section class="card" style="padding:2px 16px">${disputed.map((r) => `
      ${athleteRow(r, inst)}
      ${r.dispute_note ? `<div class="cs-p" style="padding:0 0 10px">“${esc(r.dispute_note)}”</div>` : ''}`).join('')}
    </section>
    <div class="cs-p" style="padding:8px 20px 0">Nothing changed on its own — the record still reads as it did. Correcting it is yours to do, and your name goes on it.</div>` : ''}

    ${gaps.length ? `
    <div class="eyebrow">Couldn’t be verified · ${gaps.length}</div>
    <section class="card" style="padding:2px 16px">${gaps.map((r) => athleteRow(r, inst)).join('')}</section>
    <div class="sidebox" style="margin-top:12px">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 19)}</div>
      <div><div class="cs-h">These are device problems, not misses</div>
      <div class="cs-p">A phone that never reported produces no evidence either way, so these leave the completion rate entirely rather than counting against the athlete. Mark one missed only if you know the work wasn’t done.</div></div>
    </div>` : ''}

    ${rest.length ? `
    <div class="eyebrow">Roster</div>
    <section class="card" style="padding:2px 16px">${rest.map((r) => athleteRow(r, inst)).join('')}</section>` : ''}

    <div class="cs-p" style="text-align:center;padding:14px 20px 24px">
      You see progress toward the target you set — never anyone’s raw health data.
    </div>`;
  },

  mount(root, { sub }) {
    const id = bookId();
    // ⚠ Repaint ONLY on a real change. __render() re-runs this mount, so an unconditional
    // refresh here is an infinite loop — and forcing the reload every pass never lets it settle.
    // Comparing a signature terminates after one repaint.
    if (id) loadBoard(CD.kind === 'practice' ? null : id, CD.kind === 'practice' ? id : null,
      todayISO()).then((rows) => {
      const sig = JSON.stringify((rows || []).map((b) => [b.instance_id,
        (b.rows || []).map((r) => `${r.result_id}:${r.status}:${r.progress_pct}`)]));
      if (sig === BOARD_SIG) return;
      BOARD_SIG = sig;
      if (root.isConnected && window.__render) window.__render();
    });

    const act = (attr, fn, busy) => root.querySelectorAll(`[${attr}]`).forEach((el) =>
      el.addEventListener('click', async () => {
        if (el.disabled) return;
        el.disabled = true; el.textContent = busy;
        await fn(el.getAttribute(attr));
        const bid = bookId();
        if (bid) await loadBoard(CD.kind === 'practice' ? null : bid,
          CD.kind === 'practice' ? bid : null, todayISO(), true);
        if (window.__render) window.__render();
      }));

    act('data-cs-ok', (rid) => reviewManual(rid, true).then((r) => {
      if (r.ok) track(EVENTS.CS_REVIEWED, { approve: true });
    }), 'Approving…');
    act('data-cs-no', (rid) => reviewManual(rid, false).then((r) => {
      if (r.ok) track(EVENTS.CS_REVIEWED, { approve: false });
    }), 'Saving…');
  },
};

/* ---------------------------------------------------------------- the builder */

const METRICS = [
  { key: 'steps', label: 'Steps', unit: 'steps', preset: 10000 },
  { key: 'distance', label: 'Distance', unit: 'mi', preset: 2.5 },
  { key: 'workouts', label: 'Workouts', unit: 'workouts', preset: 3 },
  { key: 'workout_minutes', label: 'Workout minutes', unit: 'min', preset: 150 },
  { key: 'active_minutes', label: 'Active minutes', unit: 'min', preset: 30 },
];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DEADLINES = [
  { min: null, label: 'End of day' }, { min: 1020, label: '5:00 PM' },
  { min: 1140, label: '7:00 PM' }, { min: 1260, label: '9:00 PM' },
];

/* The coach standards editor's own switch (coach.css .std-switch), reused rather than reinvented
   so both builders feel like one product — and so the role="switch" a11y comes along for free. */
/* The WHOLE ROW is the control, not just the 50x30 pill. That clears the 44px touch floor without
   resizing a component the coach standards editor already ships, and it means the label is part
   of the target — which is what a screen reader announces and what a thumb actually hits. The
   pill itself is decorative and hidden from the accessibility tree. */
const sw = (key, on, title, sub) => `
  <div class="std-switch-row cs-sw-row" role="switch" tabindex="0"
       aria-checked="${on ? 'true' : 'false'}" data-cs-toggle="${esc(key)}">
    <div class="std-sw-m">
      <div class="std-sw-t">${esc(title)}</div>
      ${sub ? `<div class="std-sw-s">${esc(sub)}</div>` : ''}
    </div>
    <div class="std-switch ${on ? 'on' : ''}" aria-hidden="true"></div>
  </div>`;

let DRAFT = null;
const blank = () => ({
  id: null, metric: 'steps', display_unit: 'steps', target: 10000, period: 'day',
  repeat_days: [1, 2, 3, 4, 5], deadline_min: null, deliberate_workout: false,
  workout_min_duration_min: null, title: '', allow_manual: true,
  manual_requires_approval: false, audience_kind: 'team', audience_value: null,
});

export const coachStandardEdit = {
  nav: 'operator',
  render({ sub }) {
    const back = 'coach-standards-manage';
    if (!canSet()) {
      return `${backHead('Activity standard', 'View only', back)}
      <section class="card pad"><div class="cs-h">You can see these, not set them</div>
      <div class="cs-p" style="padding-top:4px">Your role can view the board. Ask a head coach to set or change a standard.</div></section>`;
    }
    if (!DRAFT || (sub && DRAFT.id !== sub)) {
      const def = sub ? (CS.defs || []).find((d) => d.id === sub) : null;
      DRAFT = def ? {
        id: def.id, metric: def.metric, display_unit: def.display_unit,
        target: toDisplay(def.target_value, def.metric, def.display_unit),
        period: def.period, repeat_days: def.repeat_days || [1, 2, 3, 4, 5],
        deadline_min: def.deadline_min, deliberate_workout: !!def.deliberate_workout,
        workout_min_duration_min: def.workout_min_duration_min,
        title: def.title || '', allow_manual: def.allow_manual !== false,
        manual_requires_approval: !!def.manual_requires_approval,
        audience_kind: def.audience_kind || 'team', audience_value: def.audience_value || null,
      } : blank();
    }
    const d = DRAFT;
    const preview = {
      metric: d.metric, display_unit: d.display_unit,
      target: toCanonical(d.target, d.metric, d.display_unit), progress: 0,
    };

    return `${backHead(d.id ? 'Edit standard' : 'New activity standard',
      CD.kind === 'practice' ? 'For your clients' : 'For your team', back)}

    <section class="card pad">
      <div class="cs-knob">
        <div class="cs-knob-label">WHAT YOU’RE ASKING FOR</div>
        <div class="cs-seg">${METRICS.map((m) => `
          <span class="${m.key === d.metric ? 'on' : ''}" data-cs-metric="${m.key}">${esc(m.label)}</span>`).join('')}
        </div>
      </div>

      ${d.metric === 'distance' ? `<div class="cs-knob">
        <div class="cs-knob-label">WHAT COUNTS</div>
        <div class="cs-seg">
          <span class="${d.deliberate_workout ? '' : 'on'}" data-cs-delib="0">Any walking or running</span>
          <span class="${d.deliberate_workout ? 'on' : ''}" data-cs-delib="1">A recorded workout</span>
        </div>
        <div class="cs-p muted" style="margin-top:8px">${esc(sourceRule(d.metric, d.deliberate_workout, d.workout_min_duration_min))}</div>
      </div>` : ''}

      <div class="cs-knob">
        <div class="cs-knob-label">TARGET</div>
        <input class="input" id="cs-target" type="number" inputmode="decimal" min="1" value="${esc(String(d.target))}">
        <div class="cs-p muted" style="margin-top:6px">${esc(unitNoun(d.metric, d.display_unit, 2))} per ${d.period === 'week' ? 'week' : 'day'}</div>
      </div>

      <div class="cs-knob">
        <div class="cs-knob-label">HOW OFTEN</div>
        <div class="cs-seg">
          <span class="${d.period === 'day' ? 'on' : ''}" data-cs-period="day">Every day</span>
          <span class="${d.period === 'week' ? 'on' : ''}" data-cs-period="week">Across the week</span>
        </div>
      </div>

      ${d.period === 'day' ? `
      <div class="cs-knob">
        <div class="cs-knob-label">WHICH DAYS</div>
        <div class="cs-seg">${DOW.map((lab, i) => `
          <span class="${d.repeat_days.includes(i) ? 'on' : ''}" data-cs-dow="${i}">${esc(lab)}</span>`).join('')}
        </div>
      </div>
      <div class="cs-knob">
        <div class="cs-knob-label">DUE BY</div>
        <div class="cs-seg">${DEADLINES.map((x) => `
          <span class="${d.deadline_min === x.min ? 'on' : ''}" data-cs-due="${x.min === null ? '' : x.min}">${esc(x.label)}</span>`).join('')}
        </div>
      </div>` : ''}

      <div class="cs-knob">
        <div class="cs-knob-label">IF THE WATCH FAILS</div>
        ${sw('allow_manual', d.allow_manual, 'Allow manual backup',
          d.allow_manual
            ? 'An athlete whose device fails can log it by hand. It shows as reported rather than verified.'
            : 'Only device data will count. An athlete with a dead battery has no way to complete this.')}
        ${d.allow_manual ? sw('manual_requires_approval', d.manual_requires_approval,
          'Manual entries need my approval',
          'They wait in your review queue instead of counting straight away.') : ''}
      </div>

      <div class="cs-knob">
        <div class="cs-knob-label">NAME IT</div>
        <input class="input" id="cs-title" maxlength="60" value="${esc(d.title)}" placeholder="${esc(defaultTitle(d))}">
      </div>
    </section>

    <div class="eyebrow">Athletes will see</div>
    <section class="card cs-card">
      <div class="cs-row" style="padding-top:0">
        <div class="cs-top">
          <span class="cs-title">${esc((d.title || '').trim() || defaultTitle(d))}</span>
          <span class="xpill blue">In progress</span>
        </div>
        <div class="cs-bar"><i style="transform:scaleX(0)"></i></div>
        <div class="cs-nums"><span class="cs-prog">0 of ${esc(fmtValue(preview.target, d.metric, d.display_unit))} ${esc(unitNoun(d.metric, d.display_unit, preview.target))}</span></div>
        <div class="cs-meta">${esc(metricLabel(d.metric, d.deliberate_workout))} · Tracked, not scored</div>
      </div>
    </section>

    <div style="padding:12px 20px 0">
      <button class="btn" id="cs-save">${d.id ? 'Save changes' : 'Set this standard'}</button>
      ${d.id ? `<button class="btn ghost" id="cs-off" style="margin-top:8px">Turn this off</button>` : ''}
    </div>
    <div style="height:24px"></div>`;
  },

  mount(root) {
    const set = (patch) => { DRAFT = { ...DRAFT, ...patch }; if (window.__render) window.__render(); };

    root.querySelectorAll('[data-cs-metric]').forEach((el) => el.addEventListener('click', () => {
      const m = METRICS.find((x) => x.key === el.getAttribute('data-cs-metric')) || METRICS[0];
      set({ metric: m.key, display_unit: m.unit, target: m.preset, deliberate_workout: false });
    }));
    root.querySelectorAll('[data-cs-delib]').forEach((el) => el.addEventListener('click', () =>
      set({ deliberate_workout: el.getAttribute('data-cs-delib') === '1' })));
    root.querySelectorAll('[data-cs-period]').forEach((el) => el.addEventListener('click', () =>
      set({ period: el.getAttribute('data-cs-period') })));
    root.querySelectorAll('[data-cs-due]').forEach((el) => el.addEventListener('click', () => {
      const raw = el.getAttribute('data-cs-due');
      set({ deadline_min: raw === '' ? null : Number(raw) });
    }));
    root.querySelectorAll('[data-cs-dow]').forEach((el) => el.addEventListener('click', () => {
      const i = Number(el.getAttribute('data-cs-dow'));
      const days = DRAFT.repeat_days.includes(i)
        ? DRAFT.repeat_days.filter((x) => x !== i) : [...DRAFT.repeat_days, i].sort();
      // A standard with no days would never materialize and would look broken rather than off.
      set({ repeat_days: days.length ? days : DRAFT.repeat_days });
    }));
    root.querySelectorAll('[data-cs-toggle]').forEach((el) => {
      const flip = () => set({ [el.getAttribute('data-cs-toggle')]: !DRAFT[el.getAttribute('data-cs-toggle')] });
      el.addEventListener('click', flip);
      // role="switch" + tabindex="0" promises keyboard operation; without this it only looks
      // focusable. Space and Enter are what a screen reader user will actually press.
      el.addEventListener('keydown', (ev) => {
        if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); flip(); }
      });
    });

    const target = root.querySelector('#cs-target');
    if (target) target.addEventListener('input', () => { DRAFT.target = Number(target.value) || 0; });
    const title = root.querySelector('#cs-title');
    if (title) title.addEventListener('input', () => { DRAFT.title = title.value; });

    const save = root.querySelector('#cs-save');
    if (save) save.addEventListener('click', async () => {
      if (save.disabled) return;
      const d = DRAFT;
      if (!(Number(d.target) > 0)) { save.textContent = 'Enter a target first'; return; }
      save.disabled = true; save.textContent = 'Saving…';
      const id = bookId();
      const res = await saveStandard({
        id: d.id || undefined,
        team_id: CD.kind === 'practice' ? undefined : id,
        practice_id: CD.kind === 'practice' ? id : undefined,
        title: (d.title || '').trim() || defaultTitle(d),
        metric: d.metric, display_unit: d.display_unit,
        target_value: toCanonical(d.target, d.metric, d.display_unit),
        deliberate_workout: !!d.deliberate_workout,
        workout_min_duration_min: d.workout_min_duration_min || undefined,
        period: d.period,
        repeat_days: d.period === 'day' ? d.repeat_days : [0, 1, 2, 3, 4, 5, 6],
        deadline_min: d.deadline_min == null ? undefined : d.deadline_min,
        audience_kind: d.audience_kind, audience_value: d.audience_value || undefined,
        allow_manual: !!d.allow_manual,
        manual_requires_approval: !!d.manual_requires_approval,
      });
      if (res.ok) {
        track(EVENTS.CS_SET, { metric: d.metric, period: d.period, audience: d.audience_kind });
        DRAFT = null;
        location.hash = '#coach-standards-manage';
      } else {
        save.disabled = false;
        save.textContent = 'Couldn’t save — try again';
      }
    });

    const off = root.querySelector('#cs-off');
    if (off) off.addEventListener('click', async () => {
      off.disabled = true; off.textContent = 'Turning off…';
      await setStandardActive(DRAFT.id, false);
      DRAFT = null;
      location.hash = '#coach-standards-manage';
    });
  },
};

/* ---------------------------------------------------------------- manage list */

let MANAGE = { rows: [], loaded: false, error: false };

export const coachStandardsManage = {
  nav: 'operator',
  render() {
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
    const rows = MANAGE.rows.filter((r) => r.active);
    return `${backHead('Activity standards', 'Verified from athlete devices', back)}
    ${MANAGE.error && !rows.length ? errorState({ title: "Couldn't load your standards", body: 'They are safe. Reconnect and they load right here.', retryId: 'cs-manage-retry' })
    : rows.length ? `<section class="card" style="padding:2px 16px">${rows.map((r) => `
      <div class="lrow" data-go="coach-standard-edit/${esc(r.id)}">
        <div class="lic" style="color:var(--blue-bright)">${icon('bolt', 18)}</div>
        <div class="lm">
          <div class="lt">${esc(r.title)}</div>
          <div class="ls">${esc(`${fmtValue(r.target_value, r.metric, r.display_unit)} ${unitNoun(r.metric, r.display_unit, r.target_value)} · ${r.period === 'week' ? 'per week' : 'per day'}`)}</div>
        </div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>`).join('')}</section>`
    : `<section class="card pad">
        <div class="cs-h">No activity standards yet</div>
        <div class="cs-p" style="padding-top:4px">Set one and it verifies itself from your athletes’ phones and watches — no screenshots, no check-ins.</div>
      </section>`}
    ${canSet() ? `<div style="padding:12px 20px">
      <button class="btn" data-go="coach-standard-edit">Set a standard</button>
    </div>` : ''}
    <div style="height:20px"></div>`;
  },
  mount(root) {
    const id = bookId();
    if (!id) return;
    loadOwnerStandards(CD.kind === 'practice' ? null : id, CD.kind === 'practice' ? id : null)
      .then((rows) => {
        if (rows === null) {
          // FAILED read: keep the last-known list, raise the flag once. The flag (not a
          // refetch) is what repaints, so a persistent outage cannot spin.
          if (!MANAGE.error) { MANAGE.error = true; if (root.isConnected && window.__render) window.__render(); }
          return;
        }
        const sig = rows.map((r) => `${r.id}:${r.active}`).join('|');
        const was = MANAGE.rows.map((r) => `${r.id}:${r.active}`).join('|');
        const cleared = MANAGE.error;
        MANAGE.rows = rows; MANAGE.error = false;
        // Repaint only on a real change — __render re-runs this mount, so an unconditional
        // refresh here would spin forever.
        if ((sig !== was || cleared) && root.isConnected && window.__render) window.__render();
      });
    const retry = root.querySelector('#cs-manage-retry');
    if (retry) retry.addEventListener('click', () => {
      // A repaint re-runs this mount, and the mount always refetches.
      window.__render && window.__render();
    });
  },
};

function defaultTitle(d) {
  if (d.metric === 'steps') return d.period === 'week' ? 'Weekly Steps' : 'Daily Movement';
  if (d.metric === 'distance') return d.period === 'week' ? 'Weekly Distance' : 'Daily Distance';
  if (d.metric === 'workouts') return d.period === 'week' ? 'Weekly Workouts' : 'Daily Workout';
  return d.period === 'week' ? 'Weekly Activity' : 'Daily Activity';
}
