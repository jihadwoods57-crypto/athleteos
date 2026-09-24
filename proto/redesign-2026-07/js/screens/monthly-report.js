/* Premium monthly progress report: deterministic month stats (real day rows, no invented
   numbers) plus an optional AI headline/narrative/wins/focus when the athlete's plan includes it.
   Reached from Progress's "Monthly report" row. Module shape mirrors my-trainer-offers.js:
   CACHE + load() -> roles.fetchMonthlyReport() -> window.__render(), render()/mount(). */
import { backHead, esc, skeletonRows, errorState, emptyState } from '../components.js';
import { icon } from '../icons.js';
import { S, RT } from '../state.js';
import { ensureAiConsent, isConsentSkip, aiMinorPending, AI_MINOR_LINE } from '../ai-consent.js';
import * as roles from '../roles.js';
import { buildMonthPayload } from '../monthly.js';
import { track, EVENTS } from '../analytics.js';
import { monthYear, shortDate, longDate } from '../fmt-date.js';
import { shareScoreCard } from '../share-card.js';
import { ENTITLEMENT_LINE } from '../pricing.js';
import { tierFor } from '../score-band.js';

/* The month's average is a score: score face, tier colour (lead ruling 2026-09-22). */
const avgInk = (v) => `tier-ink ${v == null ? 'none' : tierFor(v).cls}`;

let CACHE = { report: null, period: null, loaded: false, payload: null, paywallFired: false };

/* True when the server declined the report because the account isn't on a plan that includes
   it (vs. a real fetch failure) — the one branch that gets the honest locked upsell instead of
   a dead "unavailable" wall. */
function isLockedReport(report) {
  return !!(report && report.error && /requires a plan/i.test(String(report.error)));
}

/* The last fully-completed calendar month relative to today, as 'YYYY-MM'. The current,
   still-in-progress month never gets a report — there's nothing to summarize yet. */
function lastCompletedPeriod() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(period) {
  const [y, m] = String(period).split('-').map(Number);
  if (!y || !m) return period;
  return monthYear(new Date(y, m - 1, 1));
}

const dayLabel = (iso) => shortDate(iso);

async function load(force) {
  if (CACHE.loaded && !force) return;
  const period = lastCompletedPeriod();
  CACHE.period = period;
  try {
    // Same real day-row source Progress reads from (S.history — past days derived from
    // DAY.scoreHistory, newest first). Today is never in a completed past month, so it's
    // excluded on purpose; buildMonthPayload only needs {date, score, weight}.
    const days = (S.history || []).map(h => ({ date: h.iso, score: h.score, weight: h.weight }));
    CACHE.payload = buildMonthPayload(days, period);
    // A month with nothing logged has nothing to report and nothing to sell against: no cold
    // edge-function call, no paywall exposure. render() shows the empty state (2026-09-22).
    CACHE.report = CACHE.payload && CACHE.payload.loggedDays
      ? await roles.fetchMonthlyReport(period, CACHE.payload)
      : null;
  } catch (e) {
    // callFn resolves failures into { error } rather than throwing, so the only way in here is a
    // local one — buildMonthPayload on a malformed history row, or the module failing to reach
    // its client. Whatever it is, the screen must LAND: without this catch the rejection escapes
    // (mount() calls load() bare), `loaded` stays false, and the screen sits on its loading state
    // for the rest of the session with nothing on screen to explain it or to try again.
    CACHE.report = { error: String((e && e.message) || e) };
  }
  CACHE.loaded = true;
  // Exposure fires once the fetch has actually resolved to the locked state — never from
  // mount() (which runs before this async call settles) and never twice per screen visit.
  if (isLockedReport(CACHE.report) && !CACHE.paywallFired) {
    CACHE.paywallFired = true;
    track(EVENTS.PAYWALL_VIEWED, { variant: 'monthly_locked', cadence: 'annual' });
  }
  if (window.__render) window.__render();
}

/* The card itself now lives in share-card.js and is shared with the daily score — a month and a day
   are the same shape of thing (a number, a label, a few supporting stats), and two drawing functions
   would have drifted. This just supplies the month's payload. */
function shareReport(report, period) {
  void shareScoreCard({
    score: report && report.avgScore != null ? report.avgScore : null,
    eyebrow: monthLabel(period),
    caption: 'Average daily score',
    stats: [
      ['Days logged', report && report.loggedDays != null ? String(report.loggedDays) : '—'],
      ['Best streak', report && report.streakBest != null ? `${report.streakBest} days` : '—'],
      ['Best day', report && report.bestDay ? `${dayLabel(report.bestDay.date)} · ${report.bestDay.score}` : '—'],
    ],
  }, 'My OnStandard month');
}

function statBlock(k, v) {
  return `<div class="stat"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`;
}

/* Shared by the locked and unlocked bodies so the two can never drift. */
function weightChangeStr(report) {
  return report.weightStart != null && report.weightEnd != null
    ? `${report.weightEnd - report.weightStart > 0 ? '+' : ''}${(report.weightEnd - report.weightStart).toFixed(1)} lb`
    : '—';
}

/* The real 4-cell stat grid — reused verbatim by lockedCard and reportBody. Degrades to
   '—' placeholders on an empty/error month exactly like the unlocked body always has. */
function baseStatsBlock(report) {
  return `
  <div class="base-stats">
    ${statBlock('Best day', report.bestDay ? `${dayLabel(report.bestDay.date)} · ${report.bestDay.score}` : '—')}
    ${statBlock('Worst day', report.worstDay ? `${dayLabel(report.worstDay.date)} · ${report.worstDay.score}` : '—')}
    ${statBlock('Weight change', weightChangeStr(report))}
    ${statBlock('Best streak', report.streakBest != null ? `${report.streakBest} day${report.streakBest === 1 ? '' : 's'}` : '—')}
  </div>`;
}

/* Locked-state upsell: hands over every real number the athlete already earned this month
   (same payload reportBody renders once unlocked) and locks only the genuinely-premium
   written narrative, under a frosted veil — never fabricated prose, never a dead end. */
function lockedCard(payload, period) {
  const report = payload || {};
  const monthWord = esc(monthLabel(period)).split(' ')[0];
  /* NO PRICE ON THIS CARD (App Review pass 2026-09-23, G-R7 / A-M3). It printed the catalog's
     US-dollar disclosure and "Start free trial" above a button that opens the paywall, not the
     store: a price and a trial promise with no purchase behind them, in dollars in every
     storefront, to Apple IDs that may have used their trial already. The paywall prints the
     store's own price and the trial only when this buyer is eligible; this card says what the
     membership adds and sends them there. */
  return `
  <section class="card pad">
    <div class="bigstat score"><span class="n ${avgInk(report.avgScore)}">${report.avgScore != null ? report.avgScore : '—'}</span><span class="d">Average score</span></div>
    <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(monthLabel(period))} · ${report.loggedDays || 0} day${report.loggedDays === 1 ? '' : 's'} logged</div>
    ${report.loggedDays ? `<div style="height:8px"></div><span class="status-pill g">Your month, already counted</span>` : ''}
  </section>

  <div style="height:14px"></div>
  ${baseStatsBlock(report)}

  <div style="height:16px"></div>
  <h2 class="eyebrow">Nia’s read of your month</h2>
  <section class="card pad mr-locked">
    <div class="mr-skel" aria-hidden="true">
      <div class="mr-skel-line" style="width:78%"></div>
      <div class="mr-skel-line" style="width:94%"></div>
      <div class="mr-skel-line" style="width:60%"></div>
    </div>
    <div class="mr-veil">
      <span class="status-pill b" style="display:inline-flex;align-items:center;gap:5px" aria-label="Premium, locked">${icon('lock', 12)} Premium</span>
      <div class="mr-veil-t">A written read on your ${monthWord}</div>
      <div class="mr-veil-s">Your three biggest wins, one focus for next month, and a coach's-voice summary.</div>
    </div>
  </section>

  <div style="height:16px"></div>
  <h2 class="eyebrow">Unlock the full report</h2>
  <section class="card pad">
    <button class="btn primary" id="mr-trial" style="width:100%">See membership</button>
  </section>

  <div style="height:14px"></div>
  <div style="text-align:center;font-size:11.5px;font-weight:600;color:var(--text-3);padding:0 20px;line-height:1.4">${esc(ENTITLEMENT_LINE)}</div>
  <div style="height:10px"></div>
  `;
}

/* Nothing logged in the reported month. A brand-new athlete used to get the locked upsell over a
   month they did not exist in: dashes, "0 days logged" and "Start free trial". Say when the first
   real report lands instead, and hand them the one action that builds it (2026-09-22). */
function emptyMonth(period) {
  const now = new Date();
  const thisMonth = monthYear(now).split(' ')[0];
  const lands = longDate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const [y, m] = String(period).split('-').map(Number);
  const periodEnd = new Date(y, m, 0);
  const existed = (S.history || []).some((h) => h && h.iso && new Date(h.iso + 'T12:00:00') <= periodEnd);
  return emptyState({
    icon: 'clipboard',
    title: existed ? `Nothing logged in ${monthLabel(period).split(' ')[0]}` : 'Your first report is on its way',
    body: `Reports cover a finished month. ${thisMonth}'s lands ${lands}, built from the days you log.`,
    action: { go: 'camera', label: 'Log a meal' },
  });
}

function reportBody(report, period) {
  const wins = Array.isArray(report.wins) ? report.wins : (report.wins ? [report.wins] : []);
  const focus = Array.isArray(report.focus) ? report.focus : (report.focus ? [report.focus] : []);
  return `
  <section class="card pad">
    <div class="bigstat score"><span class="n ${avgInk(report.avgScore)}">${report.avgScore != null ? report.avgScore : '—'}</span><span class="d">Average score</span></div>
    <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(monthLabel(period))} · ${report.loggedDays || 0} day${report.loggedDays === 1 ? '' : 's'} logged</div>
  </section>

  <div style="height:14px"></div>
  ${baseStatsBlock(report)}

  ${report.headline || report.narrative ? `
  <div style="height:16px"></div>
  <h2 class="eyebrow">Nia’s read of your month</h2>
  <section class="card pad">
    ${report.headline ? `<div style="font-size:16px;font-weight:800">${esc(report.headline)}</div>` : ''}
    ${report.narrative ? `<p style="font-size:13.5px;font-weight:600;color:var(--text-2);margin-top:8px;line-height:1.5">${esc(report.narrative)}</p>` : ''}
  </section>` : ''}

  ${wins.length ? `
  <div style="height:14px"></div>
  <h2 class="eyebrow">Wins</h2>
  <section class="card pad" style="padding-top:8px;padding-bottom:8px" role="list">
    ${wins.map(w => `<div class="lrow" role="listitem" style="cursor:default"><div class="lic">${icon('check', 16)}</div><div class="lm"><div class="ls">${esc(w)}</div></div></div>`).join('')}
  </section>` : ''}

  ${focus.length ? `
  <div style="height:14px"></div>
  <h2 class="eyebrow">Focus for next month</h2>
  <section class="card pad" style="padding-top:8px;padding-bottom:8px" role="list">
    ${focus.map(f => `<div class="lrow" role="listitem" style="cursor:default"><div class="lic">${icon('target', 16)}</div><div class="lm"><div class="ls">${esc(f)}</div></div></div>`).join('')}
  </section>` : ''}

  <div style="height:16px"></div>
  <button class="btn primary sm" id="mr-share" style="width:auto;padding:0 22px">${icon('share', 16)} Share</button>
  <div style="height:10px"></div>
  `;
}

export default {
  tab: 'progress',
  render() {
    if (!CACHE.loaded) {
      // A skeleton shaped like the report, not a one-line "Building your report…" announcement
      // over a screen of empty canvas. The old sidebox told the athlete something was happening
      // and then showed them nothing happening, on the one screen whose fetch is a cold edge
      // function that can genuinely take seconds. skeletonRows also earns the router's .settle
      // fade when the real thing arrives, so the swap reads as resolving rather than snapping.
      return `${backHead('Monthly report', 'Your month in review', 'progress')}
      ${skeletonRows(4, 'Building your monthly report')}`;
    }
    const report = CACHE.report;
    const period = CACHE.period;
    if (CACHE.payload && !CACHE.payload.loggedDays && !(report && report.error)) {
      return `${backHead('Monthly report', esc(monthLabel(period)), 'progress')}
    ${emptyMonth(period)}`;
    }
    const locked = isLockedReport(report);
    return `${backHead('Monthly report', esc(monthLabel(period)), 'progress')}
    ${locked ? lockedCard(CACHE.payload, period) : report && !report.error ? reportBody(report, period) : isConsentSkip(report) ? `
      <section class="card pad aic-off mr-aioff" role="status">
        <span>${aiMinorPending(RT.userId) ? `There is no written report this month. ${AI_MINOR_LINE}` : 'Nia is off, so there is no written review this month.'} Your numbers are all still yours in Progress.</span>
        ${aiMinorPending(RT.userId) ? '' : `<button type="button" class="btn ghost sm" id="mr-ai-on">${icon('sparkle', 15)} Turn on Nia</button>`}
      </section>` : `
      ${errorState({
        title: "Couldn't build your report",
        // Never the raw transport string. "Failed to fetch" is what the browser calls a dropped
        // request; it is not something an athlete can act on, and it reads like the report itself
        // is broken rather than the connection. The month's numbers are all still on the server.
        body: 'Your month is safe. This is the connection, not your record. Try again in a moment.',
        retryId: 'mr-retry',
      })}`}
    `;
  },
  mount(root) {
    load();
    const aiOn = root.querySelector('#mr-ai-on');
    if (aiOn) aiOn.addEventListener('click', async () => {
      if (await ensureAiConsent(RT.userId, { role: 'athlete', ask: true })) { CACHE.loaded = false; load(true); }
    });
    // errorState() hands back a button id rather than a data-act, so the shared primitive stays
    // free of any one screen's action vocabulary (same contract plan.js's #plan-retry uses).
    const retry = root.querySelector('#mr-retry');
    if (retry) retry.addEventListener('click', () => {
      CACHE.loaded = false;
      if (window.__render) window.__render();
      load(true);
    });
    const share = root.querySelector('#mr-share');
    if (share) share.addEventListener('click', () => shareReport(CACHE.report, CACHE.period));
    // The locked-report CTA now opens the real membership paywall (App Store / Play IAP via
    // RevenueCat, with the sponsor-code path alongside) instead of the old inert stub.
    const trial = root.querySelector('#mr-trial');
    if (trial) trial.addEventListener('click', () => {
      track(EVENTS.PAYWALL_CTA ? EVENTS.PAYWALL_CTA : EVENTS.TRIAL_STARTED, { plan: 'individual', cadence: 'annual', from: 'monthly_locked' });
      if (window.__go) window.__go('paywall'); else location.hash = '#paywall';
    });
  },
};
