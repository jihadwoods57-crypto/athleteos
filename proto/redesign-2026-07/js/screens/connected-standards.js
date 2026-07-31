/* OnStandard — Connected Standards, athlete side (0155).
   The Home card, its detail screen, the list, and the personal editor a solo athlete uses.

   VOCABULARY: the athlete never sees the phrase "connected standard". They see the coach's own
   title ("Daily Movement", "Tuesday Conditioning") and a number moving toward a target. Every
   string that isn't structural comes from the coach's row.

   HONESTY, in three places that matter:
     1. The card says "Tracked · not scored" out loud. v1 does not touch the daily 0-100, and a
        surface that quietly implied otherwise would be lying about the athlete's own score.
     2. A sync gap NEVER reads as a miss. 'Awaiting sync' is amber and says the watch hasn't
        reported — not that the athlete failed.
     3. The rule is stated before the deadline, not after. A standard that counts only workout
        distance says so on the card, so nobody walks three miles and then learns it didn't count.

   THE MARK is the column (see .cscol in screens.css and columnGeometry in the engine), not the
   score ring. Rule 1 is the reason: the ring is the daily score's letterform, and borrowing it
   here would contradict in pixels what the footnote says in words. The column gets the same
   ceremony — the keyed reveal, the count-up, the landing haptic — through motion.js.

   Rule 3 is why the "How this is counted" disclosure does not always collapse. A rule the athlete
   would not guess (recorded workouts only, a minimum session length) stays open on the screen. */
import { icon } from '../icons.js';
import { track, EVENTS } from '../analytics.js';
import { backHead, esc, emptyState } from '../components.js';
import { reveal } from '../motion.js';
import {
  csStatus, csProgressLine, remainingLabel, progressPct, syncedLabel,
  metricLabel, sourceRule, paceToGoal, groupForAthlete, activeOn, completedLabel,
  fmtValue, unitNoun, toCanonical, toDisplay, isComplete,
  columnGeometry, streakOf, momentumOf,
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

/* ---------------------------------------------------------------- the column */

/**
 * The mark, at either size. `geo` comes from the engine so the markup makes no judgements of
 * its own — this function only draws what columnGeometry already decided.
 *
 * The fill carries BOTH its resting height and `data-fill`: the resting state must be the true
 * one, because most paints are repaints that never animate (window.__render() re-runs mount()),
 * and a column resting at 0 would read as "you did nothing" on every one of them. motion.js winds
 * it back to zero only for the single reveal it plays.
 */
function column(geo, { mini = false } = {}) {
  const cls = ['cscol', geo.state, mini ? 'mini' : '', geo.behind ? 'behind' : ''].filter(Boolean).join(' ');
  if (geo.state === 'unknown') {
    return `<div class="${cls}"><span class="qm" aria-hidden="true">?</span></div>`;
  }
  return `<div class="${cls}">
    ${geo.state === 'partial' ? '<span class="hatch"></span>' : ''}
    <span class="fill" style="height:${geo.fillPct}%" data-fill="${geo.fillPct}"></span>
    ${geo.notchPct != null ? `<span class="notch" style="bottom:${geo.notchPct}%"></span>` : ''}
  </div>`;
}

/** The count-up hooks for one value. `dec` is read back off the formatted string rather than
 *  assumed per metric, so the last frame of the tween is byte-identical to fmtValue's output —
 *  a counter that lands on "3.00" where the card says "3" is a counter nobody trusts. */
function countAttrs(value, metric, unit) {
  const shown = fmtValue(value, metric, unit);
  const dec = (shown.split('.')[1] || '').length;
  return { shown, attrs: `data-cs-count="${toDisplay(value, metric, unit)}" data-cs-dec="${dec}"` };
}

/* ---------------------------------------------------------------- the shared row
   Home card and the Activity Standards list draw the same row. They used to draw two different
   things — a bar-and-title block on Home, a generic icon row in the list — which made one feature
   look like two. */

function standardRow(row, todayIso) {
  const st = csStatus(row.status);
  const pace = paceToGoal(row, todayIso);
  const geo = columnGeometry(row, pace);
  const done = isComplete(row.status);
  const id = esc(row.result_id || '');

  // The line under the number changes with what the athlete actually needs to know next.
  const sub = done
    ? esc(completedLabel(row))
    : row.status === 'awaiting_sync' ? 'Your watch hasn’t reported yet — this won’t count against you'
    : row.status === 'disconnected' ? 'Health access is off — reconnect or log it by hand'
    : row.status === 'awaiting_review' ? 'Sent to your coach for review'
    : row.status === 'excused' ? esc(row.excused_reason || 'Excused by your coach')
    : pace ? `${esc(pace.label)}${pace.needLabel ? ` · ${esc(pace.needLabel)}` : ''}`
    : esc(remainingLabel(row) || syncedLabel(row, undefined, todayIso));

  const progress = geo.state === 'unknown'
    ? '—' : `${esc(fmtValue(row.progress, row.metric, row.display_unit))}${geo.state === 'partial' ? '+' : ''}`;

  return `<div class="cs-srow" data-cs-open="${id}">
    ${column(geo, { mini: true })}
    <div class="mid">
      <div class="t">${esc(row.title || 'Standard')}</div>
      <div class="n">${progress} <em>/ ${esc(fmtValue(row.target, row.metric, row.display_unit))} ${esc(unitNoun(row.metric, row.display_unit, row.target))}</em></div>
      <div class="m${geo.state === 'partial' ? ' amber' : ''}">${sub}</div>
    </div>
    <span class="xpill ${pillFor(row.status)}">${esc(st.label)}</span>
  </div>`;
}

/* ---------------------------------------------------------------- the Home card */

/** The Home card. Returns '' when the athlete has no standards today — Home renders nothing
 *  rather than an empty shell, which is what keeps this feature invisible until it's turned on. */
export function standardsCard(rows, todayIso) {
  const today = activeOn(rows, todayIso || todayISO());
  if (!today.length) return '';
  return `<section class="card cs-card">
    <div class="cs-head">
      <span class="cs-eyebrow">TODAY’S STANDARDS</span>
      <span class="note">Tracked · not scored</span>
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

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A daily period is a weekday; a weekly one is the week it started. Same strip, honest label. */
function periodLabel(iso, period) {
  const d = new Date(String(iso) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return period === 'week' ? `${MON[d.getMonth()]} ${d.getDate()}` : DOW[d.getDay()];
}

/** The last seven periods as bars. Below two periods there is no shape to read, so it stays away
 *  rather than presenting a single bar as a trend. */
function momentumCard(rows, current) {
  const bars = momentumOf(rows, current.standard_id, 7);
  if (bars.length < 2) return '';
  const anyGap = bars.some((b) => b.cls === 'gap');
  return `<section class="card pad">
    <div class="cs-eyebrow" style="margin-bottom:10px">LAST ${bars.length} ${current.period === 'week' ? 'WEEKS' : 'DAYS'}</div>
    <div class="cs-mom">
      <span class="tline"></span>
      ${bars.map((b) => `<b class="${b.cls}" style="height:${Math.max(4, b.pct)}%"></b>`).join('')}
    </div>
    <div class="cs-momlabs">${bars.map((b) => `<span>${esc(periodLabel(b.iso, current.period))}</span>`).join('')}</div>
    ${anyGap ? `<div class="cs-p muted" style="margin-top:10px">A hatched bar is a period your device never reported. It never counts against you.</div>` : ''}
  </section>`;
}

/* The rule card. Collapsed when the rule is the one anybody would assume; OPEN when it is not.
   Hiding "recorded workouts only" behind a chevron is precisely the surprise invariant 3 exists
   to prevent, and a disclosure the athlete has to think to open is not a disclosure. */
function ruleCard(row) {
  const surprising = !!row.deliberate_workout || !!row.workout_min_duration_min;
  const body = `<div class="cs-p">${esc(sourceRule(row.metric, row.deliberate_workout, row.workout_min_duration_min))}</div>
    <div class="cs-p muted" style="margin-top:6px">${esc(syncedLabel(row, undefined, todayISO()))}${row.verified_source ? ` · ${esc(sourceLabel(row.verified_source))}` : ''}</div>
    ${row.note ? `<div class="cs-p" style="margin-top:8px">${esc(row.note)}</div>` : ''}
    ${row.owner_label ? `<div class="cs-p muted" style="margin-top:6px">Set by ${esc(row.owner_label)}</div>` : ''}`;

  if (surprising) {
    return `<section class="card pad">
      <div class="cs-eyebrow" style="margin-bottom:8px">HOW THIS IS COUNTED</div>
      ${body}
    </section>`;
  }
  return `<details class="card pad xcollapse" data-sec="cs-rule">
    <summary class="xsum" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer">
      <span class="cs-eyebrow">HOW THIS IS COUNTED</span>
      <span class="xchev">${icon('chevron', 14)}</span>
    </summary>
    <div class="xcollapse-body" style="margin-top:10px">${body}</div>
  </details>`;
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
    const geo = columnGeometry(row, pace);
    const done = isComplete(row.status);
    const canManual = row.allow_manual && !done && row.status !== 'excused';
    const canDispute = row.status === 'missed' && !row.disputed_at;
    const streak = streakOf(CS.mine, row.standard_id);

    const { shown, attrs } = countAttrs(row.progress, row.metric, row.display_unit);
    const value = geo.state === 'unknown'
      ? '<span class="cs-val dim">—</span>'
      : `<div class="cs-val"><span ${attrs}>${esc(shown)}</span>${geo.state === 'partial' ? '<span class="plus">+</span>' : ''}</div>`;

    // The pace line, and the tone it carries. 'behind' is the clock's verdict, never the fill's.
    const paceTone = done ? 'done' : geo.behind ? 'behind' : pace ? 'on' : '';
    const paceText = geo.state === 'unknown' ? 'Health access is off, so nothing is being counted.'
      : geo.state === 'partial' ? `${esc(syncedLabel(row, undefined, todayISO()))}. This won’t count against you.`
      : row.status === 'missed' ? `${esc(remainingLabel(row) || '')} short. The period is closed.`
      : row.status === 'excused' ? esc(row.excused_reason || 'Excused by your coach')
      : done ? esc(completedLabel(row))
      : pace ? `${esc(pace.label)}${pace.needLabel ? ` · ${esc(pace.needLabel)}` : ''}`
      : esc(remainingLabel(row) || 'Target met');

    /* The hero's footer is ONE thing, chosen by state — the streak when there's a run worth
       naming, otherwise the single action this state actually affords. These used to be three
       cards parked on the screen permanently, offering manual entry to someone whose watch was
       working fine and a dispute button to someone who hadn't missed anything. */
    const foot = geo.state === 'unknown'
      ? `<div class="cs-foot gray"><div class="ic">${icon('wifiOff', 14)}</div>
         <div class="tx">Reconnect your health data, or log this by hand below.</div></div>`
      : geo.state === 'partial'
      ? `<div class="cs-foot amber"><div class="ic">${icon('clock', 14)}</div>
         <div class="tx">Your watch hasn’t reported yet. Log it yourself if it doesn’t catch up.</div></div>`
      : streak >= 2
      ? `<div class="cs-foot ${done ? 'green' : ''}"><div class="ic">${icon('flame', 14)}</div>
         <div class="tx">${streak} ${row.period === 'week' ? 'weeks' : 'days'} in a row</div></div>`
      : '';

    return `${backHead(row.title || 'Standard', metricLabel(row.metric, row.deliberate_workout), 'home')}

    <section class="card pad" id="cs-hero">
      <div class="cs-head" style="margin-bottom:13px">
        <span class="cs-eyebrow">${esc(row.period === 'week' ? 'THIS WEEK' : 'TODAY')}</span>
        <span class="xpill ${pillFor(row.status)}">${esc(st.label)}</span>
      </div>
      <div class="cs-colrow">
        ${column(geo)}
        <div class="cs-colside">
          ${value}
          <div class="cs-of">of ${esc(fmtValue(row.target, row.metric, row.display_unit))} ${esc(unitNoun(row.metric, row.display_unit, row.target))}</div>
          <div class="cs-pace ${paceTone}">${paceText}</div>
        </div>
      </div>
      ${foot}
    </section>

    ${momentumCard(CS.mine, row)}

    ${ruleCard(row)}

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

    /* The reveal, keyed to THIS number. __render() re-runs mount() for reasons that have nothing
       to do with the column — a manual entry saving, the cache landing — and an unkeyed reveal
       would replay the fill and the haptic on every one of them. The key changes only when the
       value or the verdict actually changed, which is exactly when the moment is earned. */
    const hero = root.querySelector('#cs-hero');
    const row = CS.result((location.hash.split('/')[1] || ''));
    if (hero && row) {
      reveal(hero, {
        key: `cs:${row.result_id}:${row.status}:${row.progress}`,
        haptic: isComplete(row.status) ? 'reveal' : null,
      });
    }

    const manual = root.querySelector('#cs-manual');
    if (manual) manual.addEventListener('click', async () => {
      if (manual.disabled) return;
      manual.disabled = true; manual.textContent = 'Saving…';
      const r = CS.result((location.hash.split('/')[1] || ''));
      const note = (root.querySelector('#cs-note') || {}).value || '';
      const res = await submitManual(r && r.instance_id, note);
      if (res.ok) {
        try { if (navigator.vibrate) navigator.vibrate(14); } catch { /* no-op */ }
        track(EVENTS.CS_MANUAL, { metric: r && r.metric, review: res.status === 'awaiting_review' });
      } else { manual.disabled = false; manual.textContent = 'I did this'; }
      rerender();
    });

    const dispute = root.querySelector('#cs-dispute');
    if (dispute) dispute.addEventListener('click', async () => {
      if (dispute.disabled) return;
      dispute.disabled = true; dispute.textContent = 'Sending…';
      const r = CS.result((location.hash.split('/')[1] || ''));
      const note = (root.querySelector('#cs-dnote') || {}).value || '';
      const res = await disputeResult(r && r.result_id, note);
      if (res.ok) track(EVENTS.CS_DISPUTED, { metric: r && r.metric });
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
    const today = todayISO();
    const rows = activeOn(CS.mine, today);
    const { assigned, personal } = groupForAthlete(rows);
    const section = (title, list, empty) => `
      <div class="xgrp">${esc(title)}</div>
      ${list.length
        ? `<section class="card" style="padding:2px 16px">${list.map((r) => standardRow(r, today)).join('')}</section>`
        : empty}`;

    return `${backHead('Activity Standards', 'Verified from your device', 'profile')}
    ${section('From your coach', assigned, emptyState({
      icon: 'target',
      title: 'Nothing assigned right now',
      body: 'When your coach sets an activity standard, it shows up here and on your Home screen.',
    }))}
    ${section('Personal', personal, emptyState({
      icon: 'bolt',
      title: 'Set your own target',
      body: 'Steps, distance, workouts or active minutes — checked against your watch, and yours alone.',
    }))}
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
const DOW_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/* Draft state for the editor. Module-scoped so a re-render (which the router does on every hash
   change) doesn't wipe half-entered input. */
let DRAFT = null;

function blankDraft() {
  return {
    id: null, metric: 'steps', display_unit: 'steps', target: 8000,
    period: 'day', repeat_days: [0, 1, 2, 3, 4, 5, 6], deliberate_workout: false, title: '',
  };
}

/* The commitment, read back as a sentence. "8,000 steps a day, every day" is a decision; a number
   sitting in a text field is a value. The preview shows what was already chosen — it adds nothing
   the knobs below don't already control, which is what keeps this a design pass. */
function draftSentence(d) {
  const noun = unitNoun(d.metric, d.display_unit, d.target || 2);
  const cadence = d.period === 'week' ? 'across the week'
    : d.repeat_days.length === 7 ? 'a day, every day'
    : `a day, ${d.repeat_days.length} ${d.repeat_days.length === 1 ? 'day' : 'days'} a week`;
  return `${noun} ${cadence}.`;
}

function previewCard(d) {
  return `<div style="padding:0 20px 11px"><div class="cs-prev">
    <div class="cscol live"><span class="fill"></span></div>
    <div>
      <div class="pv">${esc(fmtValue(toCanonical(d.target, d.metric, d.display_unit), d.metric, d.display_unit))}</div>
      <div class="pl"><span class="ps">${esc(draftSentence(d))}</span><br>Verified from your watch.</div>
    </div>
  </div></div>`;
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

    ${previewCard(d)}

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
        <div class="cs-seg">${DOW_INITIALS.map((lab, i) => `
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

    /* The preview follows the target as it's typed. Deliberately NOT a __render(): re-rendering
       on every keystroke would tear the input's caret out from under the thumb. Patch the two
       nodes that actually changed instead. */
    const target = root.querySelector('#cs-target');
    if (target) target.addEventListener('input', () => {
      DRAFT.target = Number(target.value) || 0;
      const pv = root.querySelector('.cs-prev .pv');
      const ps = root.querySelector('.cs-prev .ps');
      if (pv) pv.textContent = fmtValue(toCanonical(DRAFT.target, DRAFT.metric, DRAFT.display_unit), DRAFT.metric, DRAFT.display_unit);
      if (ps) ps.textContent = draftSentence(DRAFT);
    });
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
