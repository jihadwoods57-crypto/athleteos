/* OnStandard — Connected Standards, athlete side (0155).
   The Home card, its detail screen, and the personal editor a solo athlete uses to set their own.

   VOCABULARY: the athlete never sees the phrase "connected standard". They see the coach's own
   title ("Daily Movement", "Tuesday Conditioning") and a number moving toward a target. Every
   string that isn't structural comes from the coach's row.

   HONESTY, in three places that matter:
     1. The card says "Tracked · not scored" out loud. v1 does not touch the daily 0-100, and a
        surface that quietly implied otherwise would be lying about the athlete's own score.
     2. A sync gap NEVER reads as a miss. 'Awaiting sync' is amber and says the watch hasn't
        reported — not that the athlete failed.
     3. The rule is stated before the deadline, not after. A standard that counts only workout
        distance says so on the card, so nobody walks three miles and then learns it didn't count. */
import { icon } from '../icons.js';
import { track, EVENTS } from '../analytics.js';
import { backHead, esc } from '../components.js';
import {
  csStatus, csProgressLine, remainingLabel, progressPct, syncedLabel,
  metricLabel, sourceRule, paceToGoal, groupForAthlete, activeOn, completedLabel,
  fmtValue, unitNoun, toCanonical, toDisplay, isComplete,
} from '../connected-standards.js';
import {
  CS, loadMine, loadMyDefs, submitManual, disputeResult,
  saveStandard, setStandardActive, todayISO,
} from '../connected-standard-data.js';

/* Tone → the pill class the rest of the app already uses. One mapping, so a status can never
   render green on Home and amber on the detail screen. */
const PILL = { green: 'green', cyan: 'blue', blue: 'blue', purple: 'purple', amber: 'gold', red: 'red', slate: 'gray' };
const pillFor = (status) => PILL[csStatus(status).tone] || 'gray';

const METRIC_ICON = {
  steps: 'bolt', distance: 'bolt', workouts: 'bolt',
  workout_minutes: 'clock', active_minutes: 'clock',
};

/** The progress bar. Green once the target is met, amber when the week is off pace. */
function bar(row, pace) {
  const pct = progressPct(row);
  const tone = isComplete(row.status) ? 'green'
    : (pace && pace.state === 'behind') ? 'amber' : 'blue';
  return `<div class="cs-bar ${tone}"><i style="width:${pct}%"></i></div>`;
}

/* ---------------------------------------------------------------- the Home card */

/** One row inside the Home card. */
function standardRow(row, todayIso) {
  const st = csStatus(row.status);
  const pace = paceToGoal(row, todayIso);
  const id = esc(row.result_id || '');
  const done = isComplete(row.status);

  // The line under the title changes with what the athlete actually needs to know next.
  const sub = done
    ? esc(completedLabel(row))
    : row.status === 'awaiting_sync' ? 'Your watch hasn’t reported yet — this won’t count against you'
    : row.status === 'disconnected' ? 'Health access is off — reconnect or log it by hand'
    : row.status === 'awaiting_review' ? 'Sent to your coach for review'
    : row.status === 'excused' ? esc(row.excused_reason || 'Excused by your coach')
    : pace ? `${esc(pace.label)}${pace.needLabel ? ` · ${esc(pace.needLabel)}` : ''}`
    : esc(remainingLabel(row) || syncedLabel(row, undefined, todayIso));

  return `<div class="cs-row" data-cs-open="${id}">
    <div class="cs-top">
      <span class="cs-title">${esc(row.title || 'Standard')}</span>
      <span class="xpill ${pillFor(row.status)}">${esc(st.label)}</span>
    </div>
    ${row.status === 'excused' ? '' : bar(row, pace)}
    <div class="cs-nums">
      <span class="cs-prog">${esc(csProgressLine(row))}</span>
    </div>
    <div class="cs-meta">${sub}</div>
  </div>`;
}

/** The Home card. Returns '' when the athlete has no standards today — Home renders nothing
 *  rather than an empty shell, which is what keeps this feature invisible until it's turned on. */
export function standardsCard(rows, todayIso) {
  const today = activeOn(rows, todayIso || todayISO());
  if (!today.length) return '';
  return `<section class="card cs-card">
    <div class="cs-head">
      <span class="cs-eyebrow">TODAY’S STANDARDS</span>
      <span class="xpill gray">Tracked · not scored</span>
    </div>
    ${today.map((r) => standardRow(r, todayIso || todayISO())).join('')}
  </section>`;
}

/** Shown when the fetch failed and nothing is cached. Silence and an outage look identical to an
 *  athlete, and they mean opposite things. */
export function standardsOfflineCard() {
  return `<div class="xrow-item" style="border-color:var(--amber-border)">
    <div class="xico sm" style="background:var(--amber-surface);color:var(--amber-bright)">${icon('bolt', 16)}</div>
    <div class="xr"><div class="xa">Can’t reach OnStandard</div>
    <div class="xb">If your coach set an activity standard, it isn’t loading — try again when you have signal.</div></div>
  </div>`;
}

/** Wire the card. Called by whichever screen rendered it. */
export function mountStandardsCard(root) {
  root.querySelectorAll('[data-cs-open]').forEach((el) => el.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;
    // No leading slash: router.js parses the hash with `raw.split('/')`, so `#/x/<id>` yields an
    // empty route name and silently falls back to Home.
    location.hash = `#connected-standard/${el.getAttribute('data-cs-open')}`;
  }));
}

/* ---------------------------------------------------------------- detail screen */

/** The seven most recent periods for this standard, oldest first — the week strip. */
function historyStrip(rows, current) {
  const mine = rows
    .filter((r) => r.standard_id === current.standard_id)
    .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)))
    .slice(-7);
  if (mine.length < 2) return '';

  const glyph = (r) => isComplete(r.status) ? '✓'
    : r.status === 'missed' ? '✕'
    : r.status === 'excused' ? '–'
    : csStatus(r.status).counts === 'excluded' ? '↻' : '•';
  const cls = (r) => isComplete(r.status) ? 'ok'
    : r.status === 'missed' ? 'miss'
    : r.status === 'excused' ? 'exc'
    : csStatus(r.status).counts === 'excluded' ? 'sync' : 'now';
  const dow = (iso) => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][
    new Date(String(iso) + 'T12:00:00').getDay()];

  const anyGap = mine.some((r) => csStatus(r.status).counts === 'excluded');
  return `<section class="card pad">
    <div class="cs-eyebrow" style="margin-bottom:10px">RECENT</div>
    <div class="cs-days">${mine.map((r) => `
      <div class="cs-day ${cls(r)}"><i>${glyph(r)}</i><span>${esc(dow(r.period_start))}</span></div>`).join('')}
    </div>
    ${anyGap ? `<div class="cs-p muted" style="margin-top:10px">A period marked ↻ is waiting on your device. It never counts against you.</div>` : ''}
  </section>`;
}

export default {
  tab: 'home',
  render({ sub }) {
    const row = CS.result(sub);
    if (!row) {
      return `${backHead('Standard', 'Loading…', 'home')}
      <section class="card pad"><div class="cs-p">Loading your standard…</div></section>`;
    }

    const st = csStatus(row.status);
    const pace = paceToGoal(row, todayISO());
    const done = isComplete(row.status);
    const canManual = row.allow_manual && !done && row.status !== 'excused';
    const canDispute = row.status === 'missed' && !row.disputed_at;

    return `${backHead(row.title || 'Standard', metricLabel(row.metric, row.deliberate_workout), 'home')}

    <section class="card pad" style="text-align:center">
      <div class="cs-eyebrow">${esc(row.period === 'week' ? 'THIS WEEK' : 'TODAY')}</div>
      <div class="cs-hero">${esc(fmtValue(row.progress, row.metric, row.display_unit))}<br>
        <small>of ${esc(fmtValue(row.target, row.metric, row.display_unit))} ${esc(unitNoun(row.metric, row.display_unit, row.target))}</small></div>
      ${row.status === 'excused' ? '' : `<div class="cs-bar ${done ? 'green' : pace && pace.state === 'behind' ? 'amber' : 'blue'}" style="margin:14px 24px 6px"><i style="width:${progressPct(row)}%"></i></div>`}
      <div class="cs-p muted">${esc(pace ? `${pace.label}${pace.needLabel ? ` · ${pace.needLabel}` : ''}` : (remainingLabel(row) || 'Target met'))}</div>
      <div style="margin-top:10px"><span class="xpill ${pillFor(row.status)}">${esc(st.label)}</span></div>
    </section>

    <section class="card pad">
      <div class="cs-eyebrow" style="margin-bottom:8px">HOW THIS IS COUNTED</div>
      <div class="cs-p">${esc(sourceRule(row.metric, row.deliberate_workout, row.workout_min_duration_min))}</div>
      <div class="cs-p muted" style="margin-top:6px">${esc(syncedLabel(row, undefined, todayISO()))}${row.verified_source ? ` · ${esc(sourceLabel(row.verified_source))}` : ''}</div>
      ${row.note ? `<div class="cs-p" style="margin-top:8px">${esc(row.note)}</div>` : ''}
      ${row.owner_label ? `<div class="cs-p muted" style="margin-top:6px">Set by ${esc(row.owner_label)}</div>` : ''}
    </section>

    ${historyStrip(CS.mine, row)}

    ${canManual ? `<section class="card pad">
      <div class="cs-eyebrow" style="margin-bottom:8px">WATCH NOT SYNCING?</div>
      <div class="cs-p muted" style="margin-bottom:10px">Log it yourself. ${row.manual_requires_approval
        ? 'Your coach reviews manual entries before they count.'
        : 'It’s recorded as reported rather than verified — nobody assumes you’re being dishonest.'}</div>
      <input class="input" id="cs-note" maxlength="200" placeholder="Anything your coach should know (optional)">
      <button class="btn" id="cs-manual" style="margin-top:10px">I did this</button>
    </section>` : ''}

    ${row.manual_submitted_at ? `<section class="card pad">
      <div class="cs-eyebrow" style="margin-bottom:6px">YOU REPORTED THIS</div>
      <div class="cs-p">${esc(row.manual_note || 'Logged by hand.')}</div>
    </section>` : ''}

    ${canDispute ? `<section class="card pad">
      <div class="cs-p muted" style="margin-bottom:10px">If this is wrong, say so. Your coach sees your note — nothing changes automatically.</div>
      <input class="input" id="cs-dnote" maxlength="200" placeholder="What actually happened">
      <button class="btn ghost" id="cs-dispute" style="margin-top:10px">This isn’t right</button>
    </section>` : ''}

    ${row.disputed_at ? `<section class="card pad">
      <div class="cs-p muted">You flagged this for your coach.</div>
    </section>` : ''}

    <div class="cs-p muted" style="text-align:center;margin:14px 20px 24px">
      Separate from your daily score — this standard is tracked, not scored.
    </div>`;
  },

  mount(root) {
    const rerender = () => loadMine(true).then(() => { if (window.__render) window.__render(); });

    const manual = root.querySelector('#cs-manual');
    if (manual) manual.addEventListener('click', async () => {
      if (manual.disabled) return;
      manual.disabled = true; manual.textContent = 'Saving…';
      const row = CS.result((location.hash.split('/')[1] || ''));
      const note = (root.querySelector('#cs-note') || {}).value || '';
      const res = await submitManual(row && row.instance_id, note);
      if (res.ok) {
        try { if (navigator.vibrate) navigator.vibrate(14); } catch { /* no-op */ }
        track(EVENTS.CS_MANUAL, { metric: row && row.metric, review: res.status === 'awaiting_review' });
      } else { manual.disabled = false; manual.textContent = 'I did this'; }
      rerender();
    });

    const dispute = root.querySelector('#cs-dispute');
    if (dispute) dispute.addEventListener('click', async () => {
      if (dispute.disabled) return;
      dispute.disabled = true; dispute.textContent = 'Sending…';
      const row = CS.result((location.hash.split('/')[1] || ''));
      const note = (root.querySelector('#cs-dnote') || {}).value || '';
      const res = await disputeResult(row && row.result_id, note);
      if (res.ok) track(EVENTS.CS_DISPUTED, { metric: row && row.metric });
      rerender();
    });
  },
};

function sourceLabel(src) {
  return src === 'healthkit' ? 'Verified through Apple Health'
    : src === 'health_connect' ? 'Verified through Health Connect'
    : src === 'staff' ? 'Confirmed by your coach'
    : 'Reported by you';
}

/* ---------------------------------------------------------------- the athlete's list
   Coach-set standards above personal ones: an obligation outranks an intention, and mixing them
   would blur who is actually asking. */

/* Signature of the rows the list last painted, so a reconcile can tell "new data" from "the same
   data again" — see the loop note in mount() below. */
let LIST_SIG = null;

export const connectedStandardsList = {
  tab: 'profile',
  render() {
    const rows = activeOn(CS.mine, todayISO());
    const { assigned, personal } = groupForAthlete(rows);
    const section = (title, list, empty) => `
      <div class="xgrp">${esc(title)}</div>
      ${list.length ? list.map((r) => `
        <div class="xrow-item" data-cs-open="${esc(r.result_id)}">
          <div class="xico sm" style="background:var(--blue-surface);color:var(--blue-bright)">${icon(METRIC_ICON[r.metric] || 'bolt', 16)}</div>
          <div class="xr"><div class="xa">${esc(r.title)}</div>
          <div class="xb">${esc(csProgressLine(r))}</div></div>
          <span class="xpill ${pillFor(r.status)}">${esc(csStatus(r.status).label)}</span>
        </div>`).join('')
      : `<section class="card pad"><div class="cs-p muted">${esc(empty)}</div></section>`}`;

    return `${backHead('Activity Standards', 'Verified from your device', 'profile')}
    ${section('From your coach', assigned, 'Nothing assigned right now.')}
    ${section('Personal', personal, 'Set your own target — steps, distance, or workouts.')}
    <div id="cs-connect-slot"></div>
    <div style="padding:12px 20px">
      <button class="btn" id="cs-new">Set a personal standard</button>
    </div>
    <div style="height:20px"></div>`;
  },
  mount(root) {
    mountStandardsCard(root);
    const nu = root.querySelector('#cs-new');
    if (nu) nu.addEventListener('click', () => { location.hash = '#connected-standard-edit'; });

    // The connect affordance is SELF-GATING: it only exists once the native health module reports
    // available. Until then there is nothing to connect to, and offering the row would promise a
    // capability this build does not have. Same discipline as the #devices row on Recovery.
    (async () => {
      const slot = root.querySelector('#cs-connect-slot');
      if (!slot) return;
      const h = (typeof window !== 'undefined' && window.OnStandardNative)
        ? window.OnStandardNative.health : null;
      if (!h) return;
      const ok = await h.available().catch(() => false);
      if (!ok || !slot.isConnected) return;
      const on = await h.connected().catch(() => false);
      slot.innerHTML = `<section class="card" style="padding:2px 16px">
        <div class="lrow" data-go="health-consent">
          <div class="lic" style="color:var(--blue-bright)">${icon('bolt', 18)}</div>
          <div class="lm"><div class="lt">${on ? 'Apple Health connected' : 'Connect Apple Health'}</div>
          <div class="ls">${on ? 'Your standards verify themselves' : 'Let your standards check themselves'}</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
      </section>`;
    })();

    // ⚠ Re-render ONLY when the payload actually changed. __render() re-runs this mount, so an
    // unconditional refresh here is an infinite loop — and a forced reload would never let the
    // cache go quiet. Comparing a signature terminates after exactly one repaint: the second
    // pass reads the now-fresh cache, the signature matches, and it stops.
    loadMine().then((rows) => {
      const sig = rows.map((r) => `${r.result_id}:${r.status}:${r.progress}`).join('|');
      if (sig === LIST_SIG) return;
      LIST_SIG = sig;
      if (window.__render) window.__render();
    });
  },
};

/* ---------------------------------------------------------------- personal editor
   The five Phase One metrics and nothing else. A knob that doesn't exist can't be set to
   something the verifier can't answer. */

const METRICS = [
  { key: 'steps', label: 'Steps', unit: 'steps', preset: 8000 },
  { key: 'distance', label: 'Distance', unit: 'mi', preset: 3 },
  { key: 'workouts', label: 'Workouts', unit: 'workouts', preset: 4 },
  { key: 'active_minutes', label: 'Active minutes', unit: 'min', preset: 30 },
];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/* Draft state for the editor. Module-scoped so a re-render (which the router does on every hash
   change) doesn't wipe half-entered input. */
let DRAFT = null;

function blankDraft() {
  return {
    id: null, metric: 'steps', display_unit: 'steps', target: 8000,
    period: 'day', repeat_days: [0, 1, 2, 3, 4, 5, 6], deliberate_workout: false, title: '',
  };
}

export const connectedStandardEdit = {
  tab: 'profile',
  render({ sub }) {
    if (!DRAFT || (sub && DRAFT.id !== sub)) {
      const def = sub ? CS.def(sub) : null;
      DRAFT = def ? {
        id: def.id, metric: def.metric, display_unit: def.display_unit,
        target: toDisplay(def.target_value, def.metric, def.display_unit),
        period: def.period, repeat_days: def.repeat_days || [0, 1, 2, 3, 4, 5, 6],
        deliberate_workout: !!def.deliberate_workout, title: def.title || '',
      } : blankDraft();
    }
    const d = DRAFT;
    const m = METRICS.find((x) => x.key === d.metric) || METRICS[0];

    return `${backHead(d.id ? 'Edit standard' : 'New standard', 'Your own target', 'connected-standards')}

    <section class="card pad">
      <div class="cs-knob">
        <div class="cs-knob-label">WHAT YOU’RE TRACKING</div>
        <div class="cs-seg">${METRICS.map((x) => `
          <span class="${x.key === d.metric ? 'on' : ''}" data-cs-metric="${x.key}">${esc(x.label)}</span>`).join('')}
        </div>
      </div>

      ${d.metric === 'distance' ? `<div class="cs-knob">
        <div class="cs-knob-label">WHAT COUNTS</div>
        <div class="cs-seg">
          <span class="${d.deliberate_workout ? '' : 'on'}" data-cs-delib="0">Any walking or running</span>
          <span class="${d.deliberate_workout ? 'on' : ''}" data-cs-delib="1">Recorded workouts only</span>
        </div>
      </div>` : ''}

      <div class="cs-knob">
        <div class="cs-knob-label">TARGET</div>
        <input class="input" id="cs-target" type="number" inputmode="decimal" min="1"
               value="${esc(String(d.target))}" placeholder="${esc(String(m.preset))}">
        <div class="cs-p muted" style="margin-top:6px">${esc(unitNoun(d.metric, d.display_unit, 2))} per ${d.period === 'week' ? 'week' : 'day'}</div>
      </div>

      <div class="cs-knob">
        <div class="cs-knob-label">HOW OFTEN</div>
        <div class="cs-seg">
          <span class="${d.period === 'day' ? 'on' : ''}" data-cs-period="day">Every day</span>
          <span class="${d.period === 'week' ? 'on' : ''}" data-cs-period="week">Across the week</span>
        </div>
      </div>

      ${d.period === 'day' ? `<div class="cs-knob">
        <div class="cs-knob-label">WHICH DAYS</div>
        <div class="cs-seg">${DOW.map((lab, i) => `
          <span class="${d.repeat_days.includes(i) ? 'on' : ''}" data-cs-dow="${i}">${esc(lab)}</span>`).join('')}
        </div>
      </div>` : ''}

      <div class="cs-knob">
        <div class="cs-knob-label">NAME IT (OPTIONAL)</div>
        <input class="input" id="cs-title" maxlength="60" value="${esc(d.title)}"
               placeholder="${esc(defaultTitle(d))}">
      </div>
    </section>

    <div style="padding:0 20px">
      <button class="btn" id="cs-save">${d.id ? 'Save changes' : 'Set this standard'}</button>
      ${d.id ? `<button class="btn ghost" id="cs-del" style="margin-top:8px">Turn this off</button>` : ''}
      <div class="cs-p muted" style="text-align:center;margin-top:12px">
        Personal standards are yours alone — your coach doesn’t see them.
      </div>
    </div>
    <div style="height:24px"></div>`;
  },

  mount(root) {
    const set = (patch) => { DRAFT = { ...DRAFT, ...patch }; if (window.__render) window.__render(); };

    root.querySelectorAll('[data-cs-metric]').forEach((el) => el.addEventListener('click', () => {
      const key = el.getAttribute('data-cs-metric');
      const m = METRICS.find((x) => x.key === key) || METRICS[0];
      set({ metric: key, display_unit: m.unit, target: m.preset, deliberate_workout: false });
    }));
    root.querySelectorAll('[data-cs-delib]').forEach((el) => el.addEventListener('click', () =>
      set({ deliberate_workout: el.getAttribute('data-cs-delib') === '1' })));
    root.querySelectorAll('[data-cs-period]').forEach((el) => el.addEventListener('click', () =>
      set({ period: el.getAttribute('data-cs-period') })));
    root.querySelectorAll('[data-cs-dow]').forEach((el) => el.addEventListener('click', () => {
      const i = Number(el.getAttribute('data-cs-dow'));
      const days = DRAFT.repeat_days.includes(i)
        ? DRAFT.repeat_days.filter((x) => x !== i) : [...DRAFT.repeat_days, i].sort();
      // A standard with no days would never materialize and would look broken rather than off.
      set({ repeat_days: days.length ? days : DRAFT.repeat_days });
    }));

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
      const uid = await currentUserId();
      if (!uid) { save.disabled = false; save.textContent = 'Set this standard'; return; }
      const res = await saveStandard({
        id: d.id || undefined,
        owner_athlete: uid,
        audience_kind: 'self',
        title: (d.title || '').trim() || defaultTitle(d),
        metric: d.metric,
        display_unit: d.display_unit,
        target_value: toCanonical(d.target, d.metric, d.display_unit),
        deliberate_workout: !!d.deliberate_workout,
        period: d.period,
        repeat_days: d.period === 'day' ? d.repeat_days : [0, 1, 2, 3, 4, 5, 6],
        allow_manual: true,
      });
      if (res.ok) {
        track(EVENTS.CS_PERSONAL_SET, { metric: d.metric, period: d.period });
        DRAFT = null;
        await loadMine(true);
        await loadMyDefs(true);
        location.hash = '#connected-standards';
      } else {
        save.disabled = false;
        save.textContent = 'Couldn’t save — try again';
      }
    });

    const del = root.querySelector('#cs-del');
    if (del) del.addEventListener('click', async () => {
      del.disabled = true; del.textContent = 'Turning off…';
      await setStandardActive(DRAFT.id, false);
      DRAFT = null;
      await loadMyDefs(true);
      await loadMine(true);
      location.hash = '#connected-standards';
    });

    loadMyDefs();
  },
};

function defaultTitle(d) {
  const noun = unitNoun(d.metric, d.display_unit, 2);
  if (d.metric === 'steps') return d.period === 'week' ? 'Weekly Steps' : 'Daily Steps';
  if (d.metric === 'distance') return d.period === 'week' ? 'Weekly Miles' : 'Daily Distance';
  if (d.metric === 'workouts') return d.period === 'week' ? 'Weekly Workouts' : 'Daily Workout';
  return d.period === 'week' ? `Weekly ${noun}` : `Daily ${noun}`;
}

async function currentUserId() {
  try {
    const c = window.sb;
    if (!c) return null;
    const { data } = await c.auth.getUser();
    return (data && data.user && data.user.id) || null;
  } catch { return null; }
}
