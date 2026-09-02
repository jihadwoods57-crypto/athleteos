import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { esc, segBar } from '../components.js';
import { scoreBand } from '../score-band.js';
import { maybeShowTip } from '../tour.js';
import { cutoverIndex } from '../score-cutover.js';
import { ROLLCALL_OFF } from '../commitments.js';

/* Progress (spec §8): day one is a real baseline, never an empty tab; populated stays
   athlete-friendly — one score trend, one consistency summary, one category breakdown,
   one weight trend, ONE actionable insight. Trend unlock is a precise rule (3 days).

   HIERARCHY (2026-08-19 pass): the week average is THE headline and renders first, always at
   the same height — before this pass a conditional streak ribbon pushed it up and down by
   streak state, and the streak itself was drawn twice in two visual languages from two
   DIFFERENT getters (grace-aware S.streak in the ribbon, raw S.streakDays in a borrowed
   coach-dashboard tile) that could disagree on a grace day. One getter now, one render each. */

/* Baseline card shared by day-0 and day-1..2 states: real numbers + the exact unlock rule. */
function baseline(P) {
  const dots = segBar(P.unlockHave, P.unlockNeed, `${P.unlockHave} of ${P.unlockNeed} days logged toward your first trend`, 'flex:1');
  return `
  <section class="card pad">
    <h2 class="eyebrow" style="margin:0 0 10px">Progress starts today</h2>
    <div class="bigstat"><span class="n">${S.score}</span><span class="d">Today's score</span></div>
    <div class="unlock-row">
      ${dots}
      <span class="unlock-k">${P.unlockHave} of ${P.unlockNeed} days</span>
    </div>
    <div style="font-size:var(--t-sm);font-weight:600;color:var(--text-2);margin-top:6px;line-height:1.45">Log ${P.unlockNeed} days to unlock your first weekly trend. ${P.unlockNeed - P.unlockHave} more to go.</div>
    <div class="base-stats">
      <div><div class="k">Current streak</div><div class="v">${S.streak.days} day${S.streak.days === 1 ? '' : 's'}</div></div>
      <div><div class="k">Best score</div><div class="v">${P.bestScore}</div></div>
      <div><div class="k">Days logged</div><div class="v">${P.daysLogged}</div></div>
    </div>
    <div style="font-size:var(--t-xs);font-weight:600;color:var(--text-3);margin-top:8px">Early baseline. These sharpen as days accumulate.</div>
  </section>`;
}

function weightCard() {
  const W = S.weight;
  return `
  <section class="card pad">
    ${W.current != null ? `
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <!-- weight direction is goal-dependent (a gain can be good or bad depending on the athlete's
           target): the honest signal is the S.weight.pace pill, never color this by sign -->
      <div class="bigstat"><span class="n" style="font-size:var(--t-3xl)">${W.current}</span>${W.deltaMonth ? `<span class="d">${W.deltaMonth}</span>` : ''}</div>
      ${W.pace ? `<span class="status-pill ${W.pace === 'On pace' ? 'g' : 'a'}">${W.pace}</span>` : ''}
    </div>
    <div style="font-size:var(--t-sm);font-weight:600;color:var(--text-2);margin-top:2px">${W.start != null ? `Started ${W.start} lb · ` : ''}${W.target != null ? `goal ${W.target} lb · ` : ''}never affects your daily score</div>
    <button class="btn ghost sm" data-go="weight" style="margin-top:12px;width:auto;padding:0 18px">${icon('scale', 16)} Log weight</button>`
    : `
    <div style="font-size:var(--t-md);font-weight:800">Start your weight trend</div>
    <div style="font-size:var(--t-sm);font-weight:600;color:var(--text-2);margin-top:4px;line-height:1.45">Weight tracks long-term progress and does not affect your daily score.</div>
    <button class="btn primary sm" data-go="weight" style="margin-top:12px;width:auto;padding:0 20px">${icon('scale', 16)} Log weight</button>`}
  </section>`;
}

/* Entry to the progress-photo timeline (0133). A quiet link-out card — the real grid/compare live
   in #progress-photos. Photos are private to the athlete and any linked coach; they never touch
   the daily score, same as weight. */
function photoCard() {
  return `
  <section class="card" style="padding:6px 16px;margin-top:10px">
    <div class="lrow" data-go="progress-photos">
      <div class="lic">${icon('camera', 17)}</div>
      <div class="lm"><div class="lt">Progress photos</div><div class="ls">Your before &amp; after · private to you &amp; your ${esc(S.coach.noun)}</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>
  </section>`;
}

/* Weight + photos are the same story (the body the work is building), so they share ONE group
   under one eyebrow instead of two peer sections announcing themselves separately. */
function bodySection() {
  return `
  <h2 class="eyebrow">Body</h2>
  ${weightCard()}
  ${photoCard()}`;
}

/* Entry to the training log (0135). Quiet link-out; sessions live in #training-history. Tracked,
   not scored — same as weight/photos. */
function trainingCard() {
  return `
  <h2 class="eyebrow">Training</h2>
  <section class="card" style="padding:6px 16px">
    <div class="lrow" data-go="training-history">
      <div class="lic">${icon('bolt', 17)}</div>
      <div class="lm"><div class="lt">Training log</div><div class="ls">Your sessions &amp; notes · tracked, not scored</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>
    ${/* Morning Readiness is the roll-call / commitments record. With the feature switched off
          (ROLLCALL_OFF) the server returns no rows, so this link led to a permanently empty
          screen. The row is hidden rather than the screen changed: the record itself is intact
          and reappears with the feature. */''}
    ${ROLLCALL_OFF ? '' : `
    <div class="lrow" data-go="accountability">
      <div class="lic">${icon('sun', 17)}</div>
      <div class="lm"><div class="lt">Morning Readiness</div><div class="ls">Wake-ups, arrivals &amp; sessions · a separate record from your score</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>`}
  </section>`;
}

/* Plan-style bands on the score timeline (0142). A style change moves what the number MEASURES,
   so a trend break across one has to be explained rather than left looking like a slump. Renders
   nothing when the athlete has only ever been on one style — which is most of them. */
function styleBandRow() {
  const bands = S.styleBands;
  if (!bands || bands.length < 2) return '';
  return `
  <div class="ps-band" aria-label="Plan style history">
    ${bands.map(b => `<span class="seg s-${esc(b.style)}"><i></i>${esc(b.name)} · ${b.days}d · avg ${b.avg}</span>`).join('')}
  </div>
  <div style="font-size:var(--t-xs);font-weight:600;color:var(--text-3);margin-top:6px;line-height:1.45">Your plan style changed during this stretch. Each style measures your day differently, so compare within a band, not across.</div>`;
}

export default {
  tab: 'progress',
  render() {
    const P = S.progress;
    // Day one / early days: a REAL baseline (spec §8.2) — score, streak, best, days logged,
    // and the exact unlock rule. Never a dashed "come back later" card.
    // Gate on the real 3-day trend-unlock window, NOT RT.day0 — RT.day0 just means "nothing
    // logged yet today" and goes true every morning for established athletes, which used to show
    // them the "Progress starts today" baseline right beside "Days logged: 30".
    if (P.daysLogged < P.unlockNeed) {
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
      ${bodySection()}
      ${trainingCard()}
      <div style="height:10px"></div>`;
    }

    // The streak, ONCE, from the grace-aware getter. It rides as a ribbon only while today is
    // still unsecured (that's when it can drive an action); a secured streak is a fact, and
    // facts live in the stat row below with the other numbers.
    const st = S.streak;
    let streakRow = '';
    if (st.days >= 2 && !st.todayCounted) {
      const strong = st.graceUsedRecently;
      streakRow = `<div class="streak-ribbon ${strong ? 'strong' : 'mild'}" data-go="streak" style="margin-top:14px">
        <div class="sr-ic">${icon(strong ? 'flame' : 'shield', 18)}</div>
        <div class="sr-body"><div class="sr-t">${st.days}-day streak${strong ? ' · at risk' : ''}</div>
        <div class="sr-s">${strong ? 'This week’s grace is used. Reach 80 before the day closes to continue your streak.' : 'Today is still live. Reach 80 before the day closes to continue your streak.'}</div></div>
        ${icon('chevron', 16, 'style="color:var(--text-3);flex:none"')}
      </div>`;
    }
    const wd = parseFloat(P.weekDelta);
    const ddir = wd > 0 ? ' up' : wd < 0 ? ' down' : '';
    const trends = S.categoryTrends;
    const insight = S.progressInsight;
    // The first bar scored under the new weights, only when the chart also shows an older bar
    // scored the old way — otherwise there's no visible step to explain.
    const cutIdx = cutoverIndex(P.weekDates);
    const CUTOVER_LABEL = 'Scoring changed. Days before this were scored a different way';

    const scoreTrendSection = `
    <h2 class="eyebrow" data-tour="trend">Score Trend</h2>
    <section class="card pad">
      <div class="bigstat"><span class="n">${P.weekAvg}</span>${P.weekDelta ? `<span class="d${ddir}">${P.weekDelta} vs prior week</span>` : ''}</div>
      <div style="font-size:var(--t-sm);font-weight:600;color:var(--text-2);margin-top:2px">${P.onDays} days on standard (≥80) · best streak ${P.bestStreak}d</div>
      <div class="weekbars" role="img" aria-label="Last ${P.weekScores.length} days: ${P.weekScores.map((v, i) => `${P.weekDayLabels[i] || ''} ${v}`).join(', ')}. The standard is 80.${cutIdx !== -1 ? ` ${esc(CUTOVER_LABEL)}.` : ''}">
        ${P.weekScores.map((v, i) => `
          ${i === cutIdx ? `<div class="wb-cutover" aria-hidden="true" title="${esc(CUTOVER_LABEL)}" style="align-self:stretch;width:2px;border-radius:1px;background:var(--text-3);opacity:.4"></div>` : ''}
          <div class="wb b-${scoreBand(v) || 'off'}">
            <div class="track"><div class="bar" style="height:${Math.max(0, Math.min(100, v))}%"></div></div>
            <span class="d">${P.weekDayLabels[i] || ''}</span>
          </div>`).join('')}
      </div>
      ${cutIdx !== -1 ? `<div style="font-size:var(--t-xs);font-weight:600;color:var(--text-3);margin-top:6px;line-height:1.4">${esc(CUTOVER_LABEL)}</div>` : ''}
      ${styleBandRow()}
      <div class="sd-cta" style="margin-top:12px">
        <button class="btn ghost sm" id="pg-share" style="width:auto;padding:0 18px" aria-label="Share today's score as an image">${icon('share', 16)} Share today</button>
      </div>
    </section>
    ${streakRow}

    ${/* One stat row, one visual language: three numerals, always three columns. The old row
          borrowed the coach dashboard's .coach-stat, put an icon in a numeral slot, and left a
          visible hole in the grid whenever consistency was still null. */''}
    <div class="pg-stats">
      <div class="pg-stat tap" data-go="streak" role="button" tabindex="0" aria-label="Current streak, ${st.days} days. Open streak details"><div class="v">${st.days}d</div><div class="k">Streak</div></div>
      <div class="pg-stat"><div class="v">${P.bestStreak}d</div><div class="k">Best streak</div></div>
      <div class="pg-stat${P.monthConsistency == null ? ' dim' : ''}"><div class="v">${P.monthConsistency != null ? `${P.monthConsistency}%` : '–'}</div><div class="k">Consistency</div></div>
    </div>

    <h2 class="eyebrow">Category trends</h2>
    ${trends ? `
    <section class="card pad" style="padding-top:8px;padding-bottom:8px">
      ${trends.map(t => `
        <div class="cat-trend">
          <span class="ct-k">${esc(t.key)}</span>
          <div class="track"><div class="fillb ${t.accent}" style="width:${t.now}%"></div></div>
          <span class="ct-v">${t.now}%</span>
          <span class="ct-d ${t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : ''}">${t.delta > 0 ? `↑ ${t.delta}` : t.delta < 0 ? `↓ ${Math.abs(t.delta)}` : '–'}</span>
        </div>`).join('')}
    </section>` : `
    <div class="pl-standard" style="margin-top:0">More appears as you log: category trends need four scored days of history.</div>`}`;

    // ONE actionable sentence, and it used to render dead last — under Weight, Photos, Training,
    // Squad and Monthly report, well below the fold on every phone. The most useful thing on the
    // screen was the least likely to be read. It sits directly under the trend that produced it.
    const insightSection = insight ? `
    <h2 class="eyebrow">Your biggest opportunity</h2>
    <div class="insight">
      <div class="req-icon g" style="width:38px;height:38px;flex:none">${icon('target', 18)}</div>
      <p>${esc(insight)}</p>
    </div>` : '';

    // A client is chasing a body outcome, not a sport standard — their Progress tab leads with
    // weight + photos; a team athlete keeps the score-first order (unchanged). Same sections,
    // same helpers, just reordered — see brainstorm decision "body outcome + trainer
    // accountability" and plan.md §C.
    const isClient = S.audience === 'client';
    return `
    <div class="screen-title">Progress</div>
    ${isClient ? bodySection() + scoreTrendSection + insightSection : scoreTrendSection + insightSection + bodySection()}
    ${trainingCard()}

    <!-- Squad and Monthly report used to follow trainingCard() with no eyebrow of their own, so
         both sat visually inside the "TRAINING" group. Neither is training. Own heading. -->
    <h2 class="eyebrow">More</h2>
    ${S.coach.hasCoach && S.coach.kind === 'coach' ? `
    <div class="sidebox" data-go="squad" style="cursor:pointer">
      <div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
      <div><div class="tt">Squad</div><div class="ts">Your team's board · opt-in, score number only</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>` : ''}
    <div class="sidebox" data-go="history" style="cursor:pointer">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Score history</div><div class="ts">The proof trail, day by day</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>
    <div class="sidebox" data-go="monthly-report" style="cursor:pointer">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt" style="display:flex;align-items:center;gap:7px">Monthly report <span class="status-pill b">Premium</span></div><div class="ts">Your month in review</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },

  /* The share card renderer has existed since the premium reports build and only the monthly report
     ever called it, so the DAILY score — the number the whole product is built around — could not
     leave the app. This is the athlete's own number, shared by their own tap. Teammate visibility is
     separately governed by the Squad board's opt-in (0180): nothing here makes one teammate visible
     to another. */
  mount(root) {
    // One-line spotlight the first time someone opens Progress — the main tour never covers this
    // screen. Held back until the main tour has been seen, so a new athlete is never spotlighted
    // twice in a session, and dropped entirely on the early-days branch where there is no trend
    // to explain yet (its anchor doesn't render). Before the early return below.
    maybeShowTip('tip:progress', {
      anchor: 'trend',
      title: 'Your last seven days',
      body: 'One bar per day against the 80 standard. The pattern matters more than any single day.',
    });
    const btn = root.querySelector('#pg-share');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const { shareDay } = await import('../share-card.js');
        const st = S.streak;
        await shareDay({
          score: S.score,
          streak: st && st.days ? st.days : 0,
          met: S.metCount,
          total: S.reqTotal,
        });
      } catch { /* a share is never worth breaking the screen over */ } finally {
        btn.disabled = false;
      }
    });
  },
};
