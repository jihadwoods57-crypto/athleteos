/* OnStandard, Sleep: the athlete's own record of what they got and what they said about it.
 *
 * PHASE 1 OF TWO, AND THIS HALF TOUCHES NO SCORE. Measured duration is evidence; the nightly
 * check-in still scores the ACT of answering and nothing here changes that. Phase 2 adds a
 * coach-assigned Recovery Standard as its own component beside wakeup (its own `assigned` flag,
 * out of the denominator when there is no reading), which is why this screen is built to gain a
 * target line rather than to be replaced by one.
 *
 * NOT WIRED INTO SHIPPED NAV. The route is registered so #sleep renders, and nothing links to it
 * from a shipped surface while 1.0 is in App Store review.
 *
 * TWO AXES PER NIGHT. Duration comes from a wearable through HealthKit, so Oura, Whoop, Garmin
 * and Apple Watch all arrive the same way and none of them needs its own integration. Quality is
 * the check-in's own "Sleep quality: Poor to Great". Neither substitutes for the other: eight
 * hours and still wrecked is information, and so is five hours and fine.
 *
 * ⚠ ONLY LAST NIGHT IS MEASURABLE TODAY. readRecoverySample() reads a rolling 24 hours and nothing
 * persists a past night's duration, so the measured column is thin by construction until a nightly
 * store exists. That is also why phase 2 cannot start yet: a rolling 24-hour window catches naps
 * and can straddle two nights, which is tolerable for context and not tolerable for points.
 */
import { backHead, esc, skeletonRows } from '../components.js';
import { icon } from '../icons.js';
import { DAY } from '../day.js';
import { HK, probeHealth } from './apple-health.js';
import {
  buildNights, baselineOf, baselineState, nightsUntilBaseline,
  deltaFrom, fmtDuration, qualityWord, sleepState,
} from '../sleep.js';

const DAYS_SHOWN = 14;

/** The last N dates, newest first, as 'YYYY-MM-DD'. */
function recentDates(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);          // midday, so a DST shift cannot roll the date
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** "Last night" for the most recent, then a weekday. A date nobody can place is not a label. */
function whenLabel(dateStr, index) {
  if (index === 0) return 'Last night';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}

/* What the athlete SAID, by date: the check-in's sleep answer, stored on the engine's 0 to 10
   scale. Today's lives on DAY.ci once submitted; past days ride each history row's checkin jsonb. */
function qualityByDate() {
  const out = {};
  for (const row of DAY.scoreHistory || []) {
    const v = row && row.checkin && row.checkin.sleep;
    if (row && row.date && v != null) out[row.date] = v;
  }
  if (DAY.ciSubmitted && DAY.ci && DAY.ci.sleep != null) out[DAY.date] = DAY.ci.sleep;
  return out;
}

/* What a wearable MEASURED, by date. See the header: only last night is readable today, so this
   map is deliberately shallow rather than faked. An absent date stays absent; it never becomes 0. */
function measuredByDate() {
  const out = {};
  // Forward compatibility, and it costs two lines: the day a nightly store persists each night's
  // duration it will ride the history row exactly like `checkin` does, and this screen will fill
  // in without a rewrite. Rows that do not carry it are simply absent, never zero.
  for (const row of DAY.scoreHistory || []) {
    const h = row && row.sleepHours;
    if (row && row.date && typeof h === 'number' && Number.isFinite(h) && h > 0) out[row.date] = h;
  }
  const hrs = HK.recovery && HK.recovery.sleepHours;
  if (typeof hrs === 'number' && Number.isFinite(hrs) && hrs > 0) out[DAY.date] = hrs;
  return out;
}

/* The average only exists where measurement does. Rendering "7 more measured nights" to an
   athlete with no wearable promises nights that will never arrive, and to one whose Health
   categories are still off it names the wrong problem: neither is waiting, and the lead above
   already told each of them the truth. */
function avgBlock(nights, screenState) {
  if (screenState === 'no-device' || screenState === 'no-data') return '';
  const base = baselineOf(nights);
  const state = baselineState(nights);
  if (state === 'none') {
    const left = nightsUntilBaseline(nights);
    return `
    <div class="sl-avg learning">
      <div class="sl-avg-k">Your average</div>
      <div class="sl-avg-wait">Still learning your normal</div>
      <div class="sl-avg-s">${left === 1 ? 'One more measured night' : `${left} more measured nights`}. An average of a couple of nights is just those nights.</div>
    </div>`;
  }
  return `
    <div class="sl-avg">
      <div class="sl-avg-k">Your average</div>
      <div class="sl-avg-v">${esc(fmtDuration(base))}</div>
      <div class="sl-avg-s">${state === 'provisional'
        ? 'Provisional, from your first measured nights. It will settle.'
        : 'Your own normal, from your measured nights. Never anybody else’s.'}</div>
    </div>`;
}

/* `markGaps` is only true once measuring is actually the athlete's habit. A gap is worth naming
   to someone whose ring reports most nights; printing "No reading" down all fourteen rows of
   someone who has never measured anything shouts an absence they cannot fix and buries the record
   they DO have. Absence is the norm until it isn't, and the lead above has already explained it. */
function nightRow(n, index, base, markGaps) {
  const said = qualityWord(n.quality);
  const delta = deltaFrom(n.hours, base);
  const dur = n.measured
    ? `<div class="sl-dur">${esc(fmtDuration(n.hours))}</div>`
    : (markGaps ? '<div class="sl-dur none">No reading</div>' : '');
  return `
    <div class="sl-night" role="listitem">
      <div class="sl-l">
        <div class="sl-when">${esc(whenLabel(n.date, index))}</div>
        ${said ? `<div class="sl-said">You said ${esc(said)}</div>` : '<div class="sl-said none">No check-in</div>'}
      </div>
      <div class="sl-r">
        ${dur}
        ${delta ? `<div class="sl-delta ${delta.dir}">${esc(delta.text)}</div>` : ''}
      </div>
    </div>`;
}

function leadFor(state) {
  if (state === 'no-device') {
    return `<div class="sl-lead">
      <div class="sl-lead-ic">${icon('moon', 18)}</div>
      <div><div class="sl-lead-t">Your own read is the record</div>
      <div class="sl-lead-s">No wearable is sharing sleep with OnStandard, so this is what you told the check-in. Connect a ring or a watch and the hours land beside it.</div></div>
    </div>`;
  }
  if (state === 'no-data') {
    return `<div class="sl-lead">
      <div class="sl-lead-ic">${icon('alert', 18)}</div>
      <div><div class="sl-lead-t">Connected, nothing shared yet</div>
      <div class="sl-lead-s">Apple never tells an app which categories you allowed. Turn Sleep on for OnStandard in the Health app, then check again.</div>
      <button class="btn ghost sm sl-lead-act" data-go="apple-health">Open Apple Health settings</button></div>
    </div>`;
  }
  return '';
}

export default {
  tab: 'profile',
  hideTabs: true,

  render() {
    const head = backHead('Sleep', 'What you got, and what you said', 'profile');
    if (!HK.probed) return `${head}${skeletonRows(4, 'Checking sleep')}`;

    const dates = recentDates(DAYS_SHOWN);
    const nights = buildNights(dates, measuredByDate(), qualityByDate());
    const state = sleepState({ available: HK.available !== false, nights });
    const base = baselineOf(nights);

    if (!nights.length) {
      return `${head}
      <div class="sl-lead">
        <div class="sl-lead-ic">${icon('moon', 18)}</div>
        <div><div class="sl-lead-t">Nothing to show yet</div>
        <div class="sl-lead-s">Your nightly check-in asks how you slept. Answer it tonight and this becomes a record.</div></div>
      </div>`;
    }

    return `${head}
    ${leadFor(state)}
    ${avgBlock(nights, state)}
    <h2 class="eyebrow">Last ${DAYS_SHOWN} nights</h2>
    <section class="card rows sl-list" role="list">
      ${nights.map((n) => nightRow(n, dates.indexOf(n.date), base, state === 'reading')).join('')}
    </section>
    <div class="sl-foot">Sleep is not scored. Your Recovery points come from answering the check-in, and hours are here so the answer has something to sit against.</div>`;
  },

  async mount(root) {
    if (!HK.probed) {
      await probeHealth();
      if (root.isConnected && window.__render) window.__render();
    }
  },
};
