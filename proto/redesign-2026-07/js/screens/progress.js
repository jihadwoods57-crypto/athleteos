import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { esc } from '../components.js';

/* Progress (spec §8): day one is a real baseline, never an empty tab; populated stays
   athlete-friendly — one score trend, one consistency summary, one category breakdown,
   one weight trend, ONE actionable insight. Trend unlock is a precise rule (3 days). */

/* Baseline card shared by day-0 and day-1..2 states: real numbers + the exact unlock rule. */
function baseline(P) {
  const dots = Array.from({ length: P.unlockNeed }, (_, i) => `<i class="${i < P.unlockHave ? 'on' : ''}"></i>`).join('');
  return `
  <section class="card pad">
    <div class="eyebrow" style="margin:0 0 10px">Progress starts today</div>
    <div class="bigstat"><span class="n">${S.score}</span><span class="d">Today's score</span></div>
    <div class="unlock-row">
      <div class="xsegs" style="flex:1">${dots}</div>
      <span class="unlock-k">${P.unlockHave} of ${P.unlockNeed} days</span>
    </div>
    <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:6px;line-height:1.45">Log ${P.unlockNeed} days to unlock your first weekly trend. ${P.unlockNeed - P.unlockHave === 0 ? 'Unlocked tomorrow.' : `${P.unlockNeed - P.unlockHave} more to go.`}</div>
    <div class="base-stats">
      <div><div class="k">Current streak</div><div class="v">${S.streakDays} day${S.streakDays === 1 ? '' : 's'}</div></div>
      <div><div class="k">Best score</div><div class="v">${P.bestScore}</div></div>
      <div><div class="k">Days logged</div><div class="v">${P.daysLogged}</div></div>
    </div>
    <div style="font-size:11px;font-weight:600;color:var(--text-3);margin-top:8px">Early baseline — these sharpen as days accumulate.</div>
  </section>`;
}

function weightCard() {
  const W = S.weight;
  return `
  <div class="eyebrow">Weight Trend</div>
  <section class="card pad">
    ${W.current != null ? `
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <!-- weight direction is goal-dependent (a gain can be good or bad depending on the athlete's
           target) — the honest signal is the S.weight.pace pill, never color this by sign -->
      <div class="bigstat"><span class="n" style="font-size:32px">${W.current}</span>${W.deltaMonth ? `<span class="d">${W.deltaMonth}</span>` : ''}</div>
      ${W.pace ? `<span class="status-pill ${W.pace === 'On pace' ? 'g' : 'a'}">${W.pace}</span>` : ''}
    </div>
    <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${W.start != null ? `Started ${W.start} lb · ` : ''}${W.target != null ? `goal ${W.target} lb · ` : ''}never affects your daily score</div>
    <button class="btn ghost sm" data-go="weight" style="margin-top:12px;width:auto;padding:0 18px">${icon('scale', 16)} Log weight</button>`
    : `
    <div style="font-size:15px;font-weight:800">Start your weight trend</div>
    <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:4px;line-height:1.45">Weight tracks long-term progress and does not affect your daily score.</div>
    <button class="btn primary sm" data-go="weight" style="margin-top:12px;width:auto;padding:0 20px">${icon('scale', 16)} Log weight</button>`}
  </section>`;
}

export default {
  tab: 'progress',
  render() {
    const P = S.progress;
    // Day one / early days: a REAL baseline (spec §8.2) — score, streak, best, days logged,
    // and the exact unlock rule. Never a dashed "come back later" card.
    if (RT.day0 || !P.hasHistory) {
      return `
      <div class="screen-title">Progress</div>
      <div style="height:10px"></div>
      ${baseline(P)}
      ${RT.day0 ? `
      <div class="sidebox" style="margin-top:12px">
        <div class="req-icon g" style="width:38px;height:38px">${icon('camera', 17)}</div>
        <div><div class="tt">Today counts the moment you log</div>
        <div class="ts">Your first meal photo starts the record.</div>
        <div class="sd-cta" style="margin-top:8px"><button class="btn green sm" style="width:auto;padding:0 22px" data-go="camera">${icon('camera', 17)} Log a Meal</button></div></div>
      </div>` : ''}
      <div style="height:4px"></div>
      ${weightCard()}
      <div style="height:10px"></div>`;
    }

    // Grace-aware streak leads the retention surface (same S.streak getter and the same
    // grace-calibrated urgency rule as Home: amber ONLY when the grace day is spent).
    const st = S.streak;
    let streakRow = '';
    if (st.days >= 2) {
      if (!st.todayCounted) {
        const strong = st.graceUsedRecently;
        streakRow = `<div class="streak-ribbon ${strong ? 'strong' : 'mild'}" data-go="streak" style="margin-top:2px">
          <div class="sr-ic">${icon(strong ? 'flame' : 'shield', 18)}</div>
          <div class="sr-body"><div class="sr-t">${st.days}-day streak${strong ? ' · at risk' : ''}</div>
          <div class="sr-s">${strong ? 'This week’s grace is used — reach 80 before the day closes to continue your streak.' : 'Today is still live. Reach 80 before the day closes to continue your streak.'}</div></div>
          <span class="sr-cta">Details</span>
        </div>`;
      } else {
        streakRow = `<div class="streak-ribbon mild" data-go="streak" style="margin-top:2px">
          <div class="sr-ic" style="background:rgba(52,211,153,0.10);color:var(--green-bright)">${icon('check', 18)}</div>
          <div class="sr-body"><div class="sr-t">${st.days}-day streak · secured</div>
          <div class="sr-s">Today counts. Day ${st.days} locks at midnight.</div></div>
          <span class="sr-cta">Details</span>
        </div>`;
      }
    }
    const wd = parseFloat(P.weekDelta);
    const ddir = wd > 0 ? ' up' : wd < 0 ? ' down' : '';
    const trends = S.categoryTrends;
    const insight = S.progressInsight;
    return `
    <div class="screen-title">Progress</div>
    ${streakRow}
    <div class="eyebrow">Score Trend</div>
    <section class="card pad">
      <div class="bigstat"><span class="n">${P.weekAvg}</span>${P.weekDelta ? `<span class="d${ddir}">${P.weekDelta} vs prior week</span>` : ''}</div>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${P.onDays} days on standard (≥80) · best streak ${P.bestStreak}d</div>
      <div class="weekbars">
        ${P.weekScores.map((v, i) => `
          <div class="wb ${v >= 80 ? 'hi' : ''}">
            <div class="bar" style="height:${Math.round((v / 100) * 86)}px"></div>
            <span class="d">${P.weekDayLabels[i] || ''}</span>
          </div>`).join('')}
      </div>
    </section>

    <div style="height:16px"></div>
    <div class="coach-stats">
      <div class="coach-stat" data-go="streak" style="cursor:pointer"><div class="v" style="color:var(--amber-bright)">${S.streakDays}d</div><div class="k">Current streak</div></div>
      ${P.monthConsistency != null ? `<div class="coach-stat"><div class="v">${P.monthConsistency}%</div><div class="k">Consistency (≥80)</div></div>` : ''}
      <div class="coach-stat" data-go="history" style="cursor:pointer"><div class="v" style="color:var(--blue-bright)">${icon('clipboard', 22)}</div><div class="k">History</div></div>
    </div>

    ${trends ? `
    <div class="eyebrow">Category Trends</div>
    <section class="card pad" style="padding-top:8px;padding-bottom:8px">
      ${trends.map(t => `
        <div class="cat-trend">
          <span class="ct-k">${esc(t.key)}</span>
          <div class="track"><div class="fillb ${t.accent}" style="width:${t.now}%"></div></div>
          <span class="ct-v">${t.now}%</span>
          <span class="ct-d ${t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : ''}">${t.delta > 0 ? `↑ ${t.delta}` : t.delta < 0 ? `↓ ${Math.abs(t.delta)}` : '–'}</span>
        </div>`).join('')}
    </section>` : ''}

    ${weightCard()}

    <div style="height:10px"></div>
    <div class="sidebox" data-go="monthly-report" style="cursor:pointer">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt" style="display:flex;align-items:center;gap:7px">Monthly report <span class="status-pill b" style="display:inline-flex;align-items:center;gap:4px">${icon('lock', 10)} Premium</span></div><div class="ts">Your month in review</div></div>
    </div>

    ${insight ? `
    <div class="eyebrow">Your biggest opportunity</div>
    <div class="insight">
      <div class="req-icon g" style="width:38px;height:38px;flex:none">${icon('target', 18)}</div>
      <p>${esc(insight)}</p>
    </div>` : ''}
    <div style="height:10px"></div>
    `;
  },
};
