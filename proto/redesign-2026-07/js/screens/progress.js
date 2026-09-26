import { S, RT } from '../state.js';
import { DAY } from '../day.js';
import { icon } from '../icons.js';
import { esc } from '../components.js';
import { dayBars } from '../week-bars.js';
import { weekHeadline, weekSubline } from '../progress-week.js';
import { tierFor } from '../score-band.js';
import { cutoverIndex } from '../score-cutover.js';
import { ROLLCALL_OFF } from '../commitments.js';
import { MONTHS_SHORT } from '../fmt-date.js';

/* Progress (cleanup 2026-09-23): is my week consistent, how are my weeks trending, my streak,
   my body, the doors to my records. What Home owns (today's score and requirements, the streak
   nudge, Share on the breakdown) is not repeated. Every number is ONE calendar reading
   (js/progress-week.js via S.progress.read). Cut: plan-style chips (jargon; one sentence when the
   style changed this week), the early-days baseline card, the "split is not available" apology,
   and the Premium pill on Monthly report (its numbers are free; only the written review is paid,
   pricing.js MEMBERSHIP_ADDS). */

let WW = null;   // what-works.js, once it has landed

/* A score number in its tier colour; below 60 stays neutral on the athlete's own history. */
const ink = (v) => { const c = tierFor(v).cls; return c === 'r' ? '' : ` tier-ink ${c}`; };
const shortDate = (key) => { const [, m, d] = String(key).split('-').map(Number); return `${MONTHS_SHORT[m - 1]} ${d}`; };

/* A plan-style change inside the chart's seven days, as one sentence. Nothing otherwise: most
   athletes have only ever had one style, and a change weeks ago no longer bends this chart. */
function styleChangeLine(weekFrom) {
  const bands = S.styleBands || [];
  if (bands.length < 2) return '';
  const now = bands[bands.length - 1], before = bands[bands.length - 2];
  if (!now.from || now.from < weekFrom) return '';
  const when = now.from === DAY.date ? 'today' : `on ${new Date(`${now.from}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}`;
  return `<p class="pg-note">Your plan changed to ${esc(now.name)} ${when}. Days before that were scored as ${esc(before.name)}.</p>`;
}

function weekCard(P) {
  const r = P.read;
  const head = weekHeadline(r);
  const sub = weekSubline(r);
  const cutIdx = cutoverIndex(P.weekDates);
  const CUT = 'Scoring changed. Days before this were scored a different way';
  const logNow = RT.day0 && !r.days;
  return `
  <h2 class="eyebrow">Last 7 days</h2>
  <section class="card pad pg-week" data-tour="trend">
    <p class="pg-head">${head ? esc(head) : 'Your first week starts today'}</p>
    <p class="pg-sub">${sub ? esc(sub) : 'Each day you log adds a bar here.'}</p>
    ${dayBars(r.week, { cutIdx, cutLabel: CUT })}
    ${cutIdx !== -1 ? `<p class="pg-note">${esc(CUT)}</p>` : ''}
    ${styleChangeLine(r.week[0].key)}
    ${logNow ? `<button class="btn primary sm pg-wbtn" data-go="camera">${icon('camera', 16)} Log a meal</button>` : ''}
  </section>`;
}

/* The weekly averages as one line against the 80 line, once there are three weeks to compare.
   The floor sits at 60 (lower only for a lower week), so a 92 to 94 wiggle is not a climb. */
function weeksCard(r) {
  const pts = r.weeks.filter((w) => w.avg != null);
  if (pts.length < 3) return '';
  // Plotted in a fixed-height box, x in percent: the line stretches to any width (phone or the
  // iPad column) while the dots and numbers stay their real size. A scaled SVG drew 30px numerals
  // and a 6px line on the iPad.
  const H = 84, top = 24, bot = 8, lo = Math.min(60, ...pts.map((p) => p.avg - 5));
  const n = r.weeks.length;
  const x = (i) => 10 + (i / Math.max(1, n - 1)) * 86;
  const y = (v) => top + (1 - (v - lo) / (100 - lo)) * (H - top - bot);
  const seq = r.weeks.map((w, i) => (w.avg == null ? null : [x(i), y(w.avg), w.avg]));
  const path = seq.reduce((d, p, i) => (p ? `${d}${d && seq[i - 1] ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(1)}` : d), '');
  const spoken = r.weeks.map((w) => `week of ${shortDate(w.from)} ${w.avg == null ? 'no log' : w.avg}`).join(', ');
  const at = (px, py) => `style="--x:${px.toFixed(2)}%;--y:${py.toFixed(1)}px"`;
  return `
  <section class="card pad pg-weeks">
    <p class="pg-k">Weekly average</p>
    <div class="pg-plot" role="img" aria-label="Weekly average, ${esc(spoken)}. The standard is 80.">
      <svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line class="pg-std" x1="7" x2="100" y1="${y(80).toFixed(1)}" y2="${y(80).toFixed(1)}"/>
        <path class="pg-path" d="${path}"/>
      </svg>
      <span class="pg-stdk" ${at(0, y(80))} aria-hidden="true">80</span>
      ${seq.map((p) => (p ? `<i class="pg-dot" ${at(p[0], p[1])}></i><span class="pg-v${ink(p[2])}" ${at(p[0], p[1] - 14)} aria-hidden="true">${p[2]}</span>` : '')).join('')}
    </div>
    <div class="pg-axis"><span>${esc(shortDate(r.weeks[0].from))}</span><span>This week</span></div>
  </section>`;
}

/* Three record facts in one hairline strip (the .pf-stats primitive), each a door to its screen. */
function statStrip(P) {
  const r = P.read;
  const st = S.streak;
  const best = Math.max(r.bestRun, st.days);
  const plural = (n) => (n === 1 ? 'day' : 'days');
  // Counts, not a percentage: "20 of 30" says the same thing without making anyone do the math.
  const third = r.month30
    ? `<button type="button" class="pf-stat" data-go="history"><b>${r.month30.on} of ${r.month30.days}</b><small>days on standard</small></button>`
    : `<button type="button" class="pf-stat" data-go="history"><b>${r.logged}</b><small>${plural(r.logged)} logged</small></button>`;
  // Nothing earned yet is not three zeros: the week card above already says the week starts today.
  if (!r.logged && !st.days) return '';
  return `
  <div class="pf-stats pg-stats">
    <button type="button" class="pf-stat" data-go="streak"><b>${st.days}</b><small>day streak</small></button>
    <button type="button" class="pf-stat" data-go="streak"><b>${best}${r.bestCut && best === r.bestRun ? '+' : ''}</b><small>best streak</small></button>
    ${third}
  </div>`;
}

/* Nutrition and Recovery direction, and the one sentence it produced. Absent until real. */
function movingSection() {
  const trends = S.categoryTrends;
  const insight = S.progressInsight;
  if (!trends && !insight) return '';
  return `
  <h2 class="eyebrow">What's moving</h2>
  <section class="card pad">
    ${trends ? `
    <div class="cat-trends">
      ${trends.map((t) => `
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
  </section>`;
}

/* Weigh-ins with their dates: the history rows that carry one, then today's. */
function weighIns() {
  const out = (DAY.scoreHistory || []).filter((h) => h.weight != null && Number.isFinite(Number(h.weight)))
    .map((h) => ({ key: h.date, v: Number(h.weight) }));
  if (DAY.currentWeight != null && Number.isFinite(Number(DAY.currentWeight))) out.push({ key: DAY.date, v: Number(DAY.currentWeight) });
  return out;
}

function weightLine(pts) {
  // Spaced by DATE: two weigh-ins a week apart sit a week apart, not one step apart.
  const H = 56, vals = pts.map((p) => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const t = (k) => Date.parse(`${k}T12:00:00Z`);
  const t0 = t(pts[0].key), span = t(pts[pts.length - 1].key) - t0 || 1;
  const xy = pts.map((p) => [2 + ((t(p.key) - t0) / span) * 96, H - 8 - ((p.v - min) / (max - min || 1)) * (H - 16)]);
  const last = xy[xy.length - 1];
  return `<div class="pg-plot pg-wline" aria-hidden="true">
    <svg viewBox="0 0 100 ${H}" preserveAspectRatio="none">
      <path class="pg-path" d="${xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(1)}`).join('')}"/>
    </svg>
    <i class="pg-dot" style="--x:${last[0].toFixed(2)}%;--y:${last[1].toFixed(1)}px"></i>
  </div>`;
}

function bodySection() {
  const W = S.weight;
  const pts = weighIns();
  if (W.current == null) return `
  <h2 class="eyebrow">Body</h2>
  <section class="card pad">
    <p class="pg-head">No weigh-ins yet</p>
    <p class="pg-sub">Log your weight to see your trend. It is not part of your score.</p>
    <button class="btn ghost sm pg-wbtn" data-go="weight">${icon('scale', 16)} Log weight</button>
  </section>`;
  const change = pts.length >= 2 ? pts[pts.length - 1].v - pts[0].v : null;
  const changeLine = change == null ? '' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change).toFixed(1)} lb since ${shortDate(pts[0].key)}`;
  const facts = [changeLine, W.target != null ? `Goal ${W.target} lb` : ''].filter(Boolean).join(' · ');
  return `
  <h2 class="eyebrow">Body</h2>
  <section class="card pad">
    <div class="pg-wrow">
      ${/* Weight direction is goal-dependent, so the number is never coloured by sign: the pace
            pill, against the athlete's own goal, is the only judgement on this card. */''}
      <div class="bigstat md"><span class="n">${esc(W.current)}</span><span class="u">lb</span></div>
      ${W.pace ? `<span class="status-pill ${W.pace === 'On pace' ? 'g' : 'a'}">${esc(W.pace)}</span>` : ''}
    </div>
    ${facts ? `<p class="pg-sub">${esc(facts)}</p>` : ''}
    ${pts.length >= 3 ? weightLine(pts) : ''}
    <div class="pg-wfoot">
      <button class="btn ghost sm pg-wbtn" data-go="weight">${icon('scale', 16)} Log weight</button>
      <span class="pg-note">Not part of your score</span>
    </div>
  </section>`;
}

/* The doors to the athlete's records, most used first. */
function recordsSection() {
  const row = (go, ic, title, sub) => `
    <div class="lrow" data-go="${go}">
      <div class="lic">${icon(ic, 17)}</div>
      <div class="lm"><div class="lt">${title}</div><div class="ls">${sub}</div></div>
      ${icon('chevron', 17)}
    </div>`;
  const onTeam = S.coach.hasCoach && S.coach.kind === 'coach';
  return `
  <h2 class="eyebrow">Records</h2>
  <section class="card pg-rows">
    ${row('history', 'clock', 'Activity history', 'Your meals and scores, day by day')}
    ${/* Roll calls come from a coach or trainer; with nobody to send one, the record is empty.
          ROLLCALL_OFF hides it with the feature, as before. */''}
    ${ROLLCALL_OFF || !S.coach.hasCoach ? '' : row('accountability', 'sun', 'Roll call record', 'Your roll calls and sessions')}
    ${onTeam ? row('squad', 'users', 'Squad', 'Teammates who share their score') : ''}
    ${row('monthly-report', 'clipboard', 'Monthly report', 'Your month in numbers')}
  </section>`;
}

export default {
  tab: 'progress',
  render() {
    const P = S.progress;
    // A trainer's client is chasing a body outcome, so their page leads with it; a team athlete
    // leads with the week. Same sections, reordered.
    const isClient = S.audience === 'client';
    // What works for you (A2): lazy, drawn into #ww-slot; inline once the module has landed.
    const score = `${weekCard(P)}${weeksCard(P.read)}${statStrip(P)}${movingSection()}<div id="ww-slot">${WW ? WW.worksHtml() : ''}</div>`;
    return `
    <h1 class="screen-title">Progress</h1>
    ${isClient ? bodySection() + score : score + bodySection()}
    ${recordsSection()}
    <div class="pg-tail"></div>
    `;
  },

  mount(root) {
    if (!WW) {
      import('../what-works.js').then((m) => {
        WW = m;
        const slot = root && root.isConnected && root.querySelector('#ww-slot');
        if (slot) slot.innerHTML = m.worksHtml();
      }, () => {});
    }
    // One-line spotlight the first time someone opens Progress (the main tour never covers this
    // screen). Lazy: the tour runs once per account, so it stays out of the boot graph.
    import('../tour.js').then((T) => T.maybeShowTip('tip:progress', {
      anchor: 'trend',
      title: 'Your last seven days',
      body: 'Each bar is one day’s score. The dashed line is 80, the standard.',
    }), () => {});
  },
};
