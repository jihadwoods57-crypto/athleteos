/* Premium monthly progress report: deterministic month stats (real day rows, no invented
   numbers) plus an optional AI headline/narrative/wins/focus when the athlete's plan includes it.
   Reached from Progress's "Monthly report" row. Module shape mirrors my-trainer-offers.js:
   CACHE + load() -> roles.fetchMonthlyReport() -> window.__render(), render()/mount(). */
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import { S } from '../state.js';
import * as roles from '../roles.js';
import { buildMonthPayload } from '../monthly.js';
import { track, EVENTS } from '../analytics.js';

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
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function dayLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

async function load(force) {
  if (CACHE.loaded && !force) return;
  const period = lastCompletedPeriod();
  // Same real day-row source Progress reads from (S.history — past days derived from
  // DAY.scoreHistory, newest first). Today is never in a completed past month, so it's
  // excluded on purpose; buildMonthPayload only needs {date, score, weight}.
  const days = (S.history || []).map(h => ({ date: h.iso, score: h.score, weight: h.weight }));
  const payload = buildMonthPayload(days, period);
  CACHE.payload = payload;
  CACHE.period = period;
  CACHE.report = await roles.fetchMonthlyReport(period, payload);
  CACHE.loaded = true;
  // Exposure fires once the fetch has actually resolved to the locked state — never from
  // mount() (which runs before this async call settles) and never twice per screen visit.
  if (isLockedReport(CACHE.report) && !CACHE.paywallFired) {
    CACHE.paywallFired = true;
    track(EVENTS.PAYWALL_VIEWED, { variant: 'monthly_locked', cadence: 'annual' });
  }
  if (window.__render) window.__render();
}

/* Portrait share card: dark background, big blue->teal average score, a few key stats,
   the OnStandard wordmark. Returns a data URL, or null if canvas isn't available. */
function drawShareCard(report, period) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const accent = ctx.createLinearGradient(0, 0, canvas.width, 0);
    accent.addColorStop(0, '#2f6fed');
    accent.addColorStop(1, '#34d399');

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = '600 40px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillText(monthLabel(period).toUpperCase(), canvas.width / 2, 190);

    const avg = report && report.avgScore != null ? report.avgScore : null;
    ctx.fillStyle = accent;
    ctx.font = '800 340px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillText(avg != null ? String(avg) : '—', canvas.width / 2, 620);

    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '600 38px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillText('Average daily score', canvas.width / 2, 690);

    const stats = [
      ['Days logged', report && report.loggedDays != null ? String(report.loggedDays) : '—'],
      ['Best streak', report && report.streakBest != null ? `${report.streakBest} days` : '—'],
      ['Best day', report && report.bestDay ? `${dayLabel(report.bestDay.date)} · ${report.bestDay.score}` : '—'],
    ];
    let y = 840;
    for (const [k, v] of stats) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '600 32px -apple-system, Helvetica, Arial, sans-serif';
      ctx.fillText(k, canvas.width / 2, y);
      ctx.fillStyle = '#fff';
      ctx.font = '700 44px -apple-system, Helvetica, Arial, sans-serif';
      ctx.fillText(v, canvas.width / 2, y + 56);
      y += 140;
    }

    ctx.fillStyle = accent;
    ctx.font = '800 44px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillText('ONSTANDARD', canvas.width / 2, canvas.height - 90);

    return canvas.toDataURL('image/png');
  } catch { return null; }
}

function shareReport(report, period) {
  const dataUrl = drawShareCard(report, period);
  if (dataUrl && window.OnStandardNative && window.OnStandardNative.shareImage) {
    window.OnStandardNative.shareImage(dataUrl, 'My OnStandard month');
  } else if (window.OnStandardNative && window.OnStandardNative.share) {
    window.OnStandardNative.share({ title: 'My OnStandard month' });
  }
}

function statBlock(k, v) {
  return `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
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
  return `
  <section class="card pad">
    <div class="bigstat"><span class="n">${report.avgScore != null ? report.avgScore : '—'}</span><span class="d">Average score</span></div>
    <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(monthLabel(period))} · ${report.loggedDays || 0} day${report.loggedDays === 1 ? '' : 's'} logged</div>
    ${report.loggedDays ? `<div style="height:8px"></div><span class="status-pill g">Your month, already counted</span>` : ''}
  </section>

  <div style="height:14px"></div>
  ${baseStatsBlock(report)}

  <div style="height:16px"></div>
  <div class="eyebrow">Coach's take</div>
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
  <div class="eyebrow">Unlock the full report</div>
  <section class="card pad">
    <button class="btn green" id="mr-trial" style="width:100%">Start free trial</button>
    <div style="text-align:center;font-size:11.5px;font-weight:600;color:var(--text-3);margin-top:8px;line-height:1.4">Individual — free for 7 days, then $10.50/mo billed annually. No card today.</div>
    <div class="mr-or">or unlock now</div>
    <div class="sidebox mr-coderow" data-go="redeem-code" role="button" aria-label="Redeem a sponsor code to unlock premium instantly">
      <div class="req-icon b" style="width:38px;height:38px">${icon('key', 17)}</div>
      <div><div class="tt">Have a sponsor code?</div><div class="ts">Redeem it to unlock premium instantly</div></div>
    </div>
  </section>

  <div style="height:14px"></div>
  <div style="text-align:center;font-size:11.5px;font-weight:600;color:var(--text-3);padding:0 20px;line-height:1.4">Your stats are always yours. Premium adds the written coaching, not the numbers.</div>
  <div style="height:10px"></div>
  `;
}

function reportBody(report, period) {
  const wins = Array.isArray(report.wins) ? report.wins : (report.wins ? [report.wins] : []);
  const focus = Array.isArray(report.focus) ? report.focus : (report.focus ? [report.focus] : []);
  return `
  <section class="card pad">
    <div class="bigstat"><span class="n">${report.avgScore != null ? report.avgScore : '—'}</span><span class="d">Average score</span></div>
    <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(monthLabel(period))} · ${report.loggedDays || 0} day${report.loggedDays === 1 ? '' : 's'} logged</div>
  </section>

  <div style="height:14px"></div>
  ${baseStatsBlock(report)}

  ${report.headline || report.narrative ? `
  <div style="height:16px"></div>
  <div class="eyebrow">Coach's take</div>
  <section class="card pad">
    ${report.headline ? `<div style="font-size:16px;font-weight:800">${esc(report.headline)}</div>` : ''}
    ${report.narrative ? `<p style="font-size:13.5px;font-weight:600;color:var(--text-2);margin-top:8px;line-height:1.5">${esc(report.narrative)}</p>` : ''}
  </section>` : ''}

  ${wins.length ? `
  <div style="height:14px"></div>
  <div class="eyebrow">Wins</div>
  <section class="card pad" style="padding-top:8px;padding-bottom:8px">
    ${wins.map(w => `<div class="lrow" style="cursor:default"><div class="lic">${icon('check', 16)}</div><div class="lm"><div class="ls">${esc(w)}</div></div></div>`).join('')}
  </section>` : ''}

  ${focus.length ? `
  <div style="height:14px"></div>
  <div class="eyebrow">Focus for next month</div>
  <section class="card pad" style="padding-top:8px;padding-bottom:8px">
    ${focus.map(f => `<div class="lrow" style="cursor:default"><div class="lic">${icon('target', 16)}</div><div class="lm"><div class="ls">${esc(f)}</div></div></div>`).join('')}
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
      return `${backHead('Monthly report', 'Your month in review', 'progress')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Building your report…</div></div></div>`;
    }
    const report = CACHE.report;
    const period = CACHE.period;
    const locked = isLockedReport(report);
    return `${backHead('Monthly report', esc(monthLabel(period)), 'progress')}
    ${locked ? lockedCard(CACHE.payload, period) : report && !report.error ? reportBody(report, period) : `
      <div class="state-demo"><div class="sd-ic">${icon('bolt', 24)}</div>
      <div class="sd-t">Report unavailable</div>
      <div class="sd-s">${esc((report && report.error) || 'Could not load your monthly report.')}</div></div>`}
    `;
  },
  mount(root) {
    load();
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
