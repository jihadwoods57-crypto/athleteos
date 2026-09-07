/* The Connected Standards HOME CARD, on its own.
 *
 * It lived inside screens/connected-standards.js, and Home imported the three card functions from
 * there — which is why a 750-line SCREEN sat in the boot graph so that Home could draw one card.
 * The screen registry had correctly made it a lazy route; a static import from Home defeated that.
 * Measured 2026-09-07: 38 KB of eager parse for the ~90 lines Home actually needs.
 *
 * So the card is the lower layer now and the screen imports UP from it, rather than Home reaching
 * DOWN into a screen. The detail screen still shares `column`, `standardRow`, `pillFor` and
 * `METRIC_ICON`, which are exported here for it.
 *
 * The sibling case, roll-call.js, was measured and deliberately NOT split: its card functions are
 * roughly 63%% of that module, so extracting them would move the weight rather than remove it.
 */

import { icon } from '../icons.js';
import { esc } from '../components.js';
import {
  csStatus, remainingLabel, syncedLabel, paceToGoal, activeOn, completedLabel, fmtValue, unitNoun, toDisplay, isComplete, columnGeometry,
} from '../connected-standards.js';
import { todayISO } from '../connected-standard-data.js';

/* Tone → the pill class the rest of the app already uses. One mapping, so a status can never
   render green on Home and amber on the detail screen. */
export const PILL = { green: 'g', cyan: 'b', blue: 'b', purple: 'p', amber: 'a', red: 'r', slate: 'muted' };
export const pillFor = (status) => PILL[csStatus(status).tone] || 'muted';

export const METRIC_ICON = {
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
export function column(geo, { mini = false } = {}) {
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
export function countAttrs(value, metric, unit) {
  const shown = fmtValue(value, metric, unit);
  const dec = (shown.split('.')[1] || '').length;
  return { shown, attrs: `data-cs-count="${toDisplay(value, metric, unit)}" data-cs-dec="${dec}"` };
}

/* ---------------------------------------------------------------- the shared row
   Home card and the Activity Standards list draw the same row. They used to draw two different
   things — a bar-and-title block on Home, a generic icon row in the list — which made one feature
   look like two. */

export function standardRow(row, todayIso) {
  const st = csStatus(row.status);
  const pace = paceToGoal(row, todayIso);
  const geo = columnGeometry(row, pace);
  const done = isComplete(row.status);
  const id = esc(row.result_id || '');

  // The line under the number changes with what the athlete actually needs to know next.
  const sub = done
    ? esc(completedLabel(row))
    : row.status === 'awaiting_sync' ? 'Your watch hasn’t reported yet. This won’t count against you'
    : row.status === 'disconnected' ? 'Health access is off. Reconnect or log it by hand'
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
    <span class="status-pill ${pillFor(row.status)}">${esc(st.label)}</span>
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
      <h2 class="cs-eyebrow">TODAY’S STANDARDS</h2>
      <span class="note">Tracked · not scored</span>
    </div>
    ${today.map((r) => standardRow(r, todayIso || todayISO())).join('')}
  </section>`;
}

/** Shown when the fetch failed and nothing is cached. Silence and an outage look identical to an
 *  athlete, and they mean opposite things. */
export function standardsOfflineCard() {
  // See commitmentOfflineCard (roll-call.js): distinct title, its own Retry, no duplicate alarm.
  return `<div class="xrow-item" style="border-color:var(--hairline)">
    <div class="xico sm" style="background:var(--surface-2);color:var(--text-3)">${icon('wifiOff', 16)}</div>
    <div class="xr"><div class="xa">Activity standard isn’t loading</div>
    <div class="xb">If your coach set one, it shows the moment you reconnect. Nothing is lost.</div></div>
    <button class="btn ghost sm" data-cs-retry style="width:auto;padding:0 14px;height:44px;flex:none">Try again</button>
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
