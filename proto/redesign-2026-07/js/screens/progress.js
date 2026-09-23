import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { esc, segBar } from '../components.js';
import { weekBars } from '../week-bars.js';
import { tierFor } from '../score-band.js';
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

/* A score numeral wears its TIER colour and the score face (lead ruling 2026-09-22: a score shown
   as a number or a bar is coloured by its tier everywhere; the ring alone keeps the sweep). */
const tierInk = (v) => `tier-ink ${tierFor(v).cls}`;

/* Baseline card shared by day-0 and day-1..2 states: real numbers + the exact unlock rule.
   Nothing scored reads as a dash, the way Home's ring reads it, never as a 0: "0 Today's score"
   and "Best score 0" told a brand-new athlete they had scored nothing before they had started.
   The first-log action lives INSIDE this card (it used to be a second, separate empty-state card
   stacked under it, two containers for one message). */
function baseline(P) {
  const dots = segBar(P.unlockHave, P.unlockNeed, `${P.unlockHave} of ${P.unlockNeed} days logged toward your first trend`, 'flex:1');
  const scoredToday = !RT.day0 && !S.notYetScored;
  return `
  <section class="card pad">
    <h2 class="eyebrow pg-base-h">Progress starts today</h2>
    <div class="bigstat score"><span class="n ${scoredToday ? tierInk(S.score) : 'tier-ink none'}">${scoredToday ? S.score : '–'}</span><span class="d">${scoredToday ? "Today's score" : 'Not scored yet'}</span></div>
    <div class="unlock-row">
      ${dots}
      <span class="unlock-k">${P.unlockHave} of ${P.unlockNeed} days</span>
    </div>
    <div class="base-stats">
      <div class="stat"><div class="v">${S.streak.days} day${S.streak.days === 1 ? '' : 's'}</div><div class="k">Current streak</div></div>
      <div class="stat"><div class="v${P.daysLogged ? ` ${tierInk(P.bestScore)}` : ''}">${P.daysLogged ? P.bestScore : '–'}</div><div class="k">Best score</div></div>
      <div class="stat"><div class="v">${P.daysLogged}</div><div class="k">Days logged</div></div>
    </div>
    ${RT.day0 ? `
    <div class="pg-base-act">
      <div class="pg-sub">Today counts the moment you log. Your first meal photo starts the record.</div>
      <button class="btn primary sm pg-wbtn" data-go="camera">${icon('camera', 16)} Log a meal</button>
    </div>` : `
    <div class="pg-sub">Early baseline. These sharpen as days accumulate.</div>`}
  </section>`;
}

function weightCard() {
  const W = S.weight;
  return `
  <section class="card pad">
    ${W.current != null ? `
    <div class="pg-wrow">
      <!-- weight direction is goal-dependent (a gain can be good or bad depending on the athlete's
           target): the honest signal is the S.weight.pace pill, never color this by sign -->
      ${/* The hero carried no unit while its own subtitle printed "lb" twice, so the one number
            an athlete reads first was the only bare figure on the card. */''}
      <div class="bigstat md"><span class="n">${W.current}</span><span class="u">lb</span>${W.deltaMonth ? `<span class="d">${W.deltaMonth}</span>` : ''}</div>
      ${W.pace ? `<span class="status-pill ${W.pace === 'On pace' ? 'g' : 'a'}">${W.pace}</span>` : ''}
    </div>
    <div class="pg-sub">${W.start != null ? `Started ${W.start} lb · ` : ''}${W.target != null ? `goal ${W.target} lb · ` : ''}never affects your daily score</div>
    <button class="btn ghost sm pg-wbtn" data-go="weight">${icon('scale', 16)} Log weight</button>`
    : `
    <div class="pg-wempty">Start your weight trend</div>
    <div class="pg-sub">Weight tracks long-term progress and does not affect your daily score.</div>
    <button class="btn primary sm pg-wbtn" data-go="weight">${icon('scale', 16)} Log weight</button>`}
  </section>`;
}

/* The body the work is building. Progress photos were removed 2026-09-07 (founder call), so this
   group is weight alone; the eyebrow stays because weight is still its own story, separate from
   the score it never touches. */
function bodySection() {
  return `
  <h2 class="eyebrow">Body</h2>
  ${weightCard()}`;
}

/* Every link-out on this screen, in ONE card and ONE row vocabulary.
   It used to be two groups. "Training" held two `.lrow`s in a card; "More" held three
   `.sidebox`es — a different container, a different ground, and a different affordance: Squad
   got a right-hand chevron, Score history's chevron landed INLINE beside its title (`.sidebox`
   is `align-items:flex-start` with no spacer, so a short subtitle lets the third child ride up
   next to the heading), and Monthly report, equally tappable, had no chevron at all. Neither
   heading described its contents either: Squad, Score history and a monthly report are not
   "More" in any sense a reader could act on. They are all records and reports, so they are one
   list, under the one heading that fits them.
   Subtitles say what each row IS. The old ones said "tracked, not scored", "a separate record
   from your score" and "never affects your daily score" — one idea in three voices on one
   screen. The weight card keeps that sentence, once, where the anxiety actually lives.
   The training-log row was cut 2026-09-21 (founder call). #training-history is still routed and
   still reachable; it is no longer promoted from Progress. */
function recordsSection() {
  const row = (go, ic, title, sub, extra) => `
    <div class="lrow" data-go="${go}">
      <div class="lic">${icon(ic, 17)}</div>
      <div class="lm"><div class="lt">${title}${extra || ''}</div><div class="ls">${sub}</div></div>
      ${/* No inline colour: icon() already stamps `ic-chevron`, and app.css's
            `.lrow > .ic-chevron:last-child` is what greys it. Every old row passed
            style="color:var(--text-3)" restating a rule that was already there. */''}
      ${icon('chevron', 17)}
    </div>`;
  return `
  <h2 class="eyebrow">Records</h2>
  <section class="card pg-rows">
    ${/* Morning Readiness is the roll-call / commitments record. With the feature switched off
          (ROLLCALL_OFF) the server returns no rows, so this link led to a permanently empty
          screen. The row is hidden rather than the screen changed: the record itself is intact
          and reappears with the feature. */''}
    ${ROLLCALL_OFF ? '' : row('accountability', 'sun', 'Roll call record', 'Roll calls and sessions')}
    ${S.coach.hasCoach && S.coach.kind === 'coach'
      ? row('squad', 'users', 'Squad', 'Score opt-in only. Your team sees roll call answers') : ''}
    ${/* `clock`, not `clipboard`: Score history and Monthly report both drew the clipboard, so
          the icon column said nothing on either row. */''}
    ${/* "Activity history": the title of the screen it opens (trust.js), the same name Profile's
          row uses. Two names for one screen read as two screens (2026-09-22). */''}
    ${row('history', 'clock', 'Activity history', 'The proof trail, day by day')}
    ${row('monthly-report', 'clipboard', 'Monthly report', 'Your month in review',
    ` <span class="status-pill b">Premium</span>`)}
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
  ${/* One line, not three. The pills above already say the style changed, so the sentence that
        opened by restating it was spending the headline card's last inches on a caveat. */''}
  <div class="pg-note">Each style measures your day differently. Compare within a band, not across.</div>`;
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
      <h1 class="screen-title">Progress</h1>
      <div style="height:10px"></div>
      ${baseline(P)}
      ${bodySection()}
      ${recordsSection()}
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

    // No "SCORE TREND" eyebrow. It sat directly under the h1 "Progress" and labelled a card that
    // opens with a 44px score, a week delta and seven day bars — the one card on the screen that
    // needs no label at all. The tour tip's anchor moved onto the card with it.
    const scoreTrendSection = `
    <section class="card pad" data-tour="trend">
      <div class="bigstat score"><span class="n ${tierInk(P.weekAvg)}">${P.weekAvg}</span>${P.weekDelta ? `<span class="d${ddir}">${P.weekDelta} vs prior week</span>` : ''}</div>
      ${/* "best streak Nd" used to close this line and then render again as its own tile 16px
            below. The tile is the better home for a numeral; the line keeps the fact the tiles
            cannot show. */''}
      <div class="pg-sub">${P.onDays} days on standard (≥80)</div>
      ${/* The builder lives in js/week-bars.js now: the parent hub draws the same week. */''}
      ${weekBars({ scores: P.weekScores, labels: P.weekDayLabels, cutIdx, cutLabel: CUTOVER_LABEL })}
      ${cutIdx !== -1 ? `<div class="pg-note">${esc(CUTOVER_LABEL)}</div>` : ''}
      ${styleBandRow()}
      <div class="sd-cta pg-share-row">
        <button class="btn ghost sm" id="pg-share" aria-label="Share today's score as an image">${icon('share', 16)} Share today</button>
      </div>
    </section>
    ${streakRow}

    ${/* One stat row, one visual language: three numerals, always three columns. The old row
          borrowed the coach dashboard's .coach-stat, put an icon in a numeral slot, and left a
          visible hole in the grid whenever consistency was still null. */''}
    <div class="pg-stats">
      <div class="stat center tap" data-go="streak" role="button" tabindex="0" aria-label="Current streak, ${st.days} days. Open streak details"><div class="v">${st.days}d</div><div class="k">Streak</div></div>
      <div class="stat center"><div class="v">${P.bestStreak}d</div><div class="k">Best streak</div></div>
      <div class="stat center${P.monthConsistency == null ? ' dim' : ''}"><div class="v">${P.monthConsistency != null ? `${P.monthConsistency}%` : '–'}</div><div class="k">Consistency</div></div>
    </div>

    ${/* Category trends and the insight were two eyebrows over two containers, back to back —
          and the second is COMPUTED FROM the first (progressInsight reads categoryTrends). One
          heading, one card: the evidence, then the sentence it produced, under a hairline. The
          card still renders with either half alone: the insight has two branches (a late-meal
          pattern, a week average under 80) that need no trends, and trends arrive a day before
          any of them can fire. */''}
    ${trends || insight ? `
    <h2 class="eyebrow">What's moving</h2>
    <section class="card pad">
      ${trends ? `
      <div class="cat-trends">
        ${trends.map(t => `
        <div class="cat-trend">
          <span class="ct-k">${esc(t.key)}</span>
          <div class="track"><div class="fillb ${t.accent}" style="width:${t.now}%"></div></div>
          <span class="ct-v">${t.now}%</span>
          <span class="ct-d ${t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : ''}">${t.delta > 0 ? `↑${t.delta}` : t.delta < 0 ? `↓${Math.abs(t.delta)}` : '–'}</span>
        </div>`).join('')}
      </div>` : ''}
      ${insight ? `
      <div class="insight">
        <div class="req-icon g s38">${icon('target', 18)}</div>
        <p>${esc(insight)}</p>
      </div>` : ''}
    </section>` : `
    <h2 class="eyebrow">What's moving</h2>
    <div class="pl-standard pg-flush">Category trends appear after your fourth scored day.</div>`}`;

    // A client is chasing a body outcome, not a sport standard — their Progress tab leads with
    // weight + photos; a team athlete keeps the score-first order (unchanged). Same sections,
    // same helpers, just reordered — see brainstorm decision "body outcome + trainer
    // accountability" and plan.md §C.
    const isClient = S.audience === 'client';
    return `
    <h1 class="screen-title">Progress</h1>
    ${isClient ? bodySection() + scoreTrendSection : scoreTrendSection + bodySection()}
    ${recordsSection()}
    <div class="pg-tail"></div>
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
