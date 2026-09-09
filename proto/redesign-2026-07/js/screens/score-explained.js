import { S, liveWeightPct } from '../state.js';
import { DAY, LATE_DECAY_MIN } from '../day.js';
import { reveal } from '../motion.js';
import { icon } from '../icons.js';
import { backHead, scoreRing, esc } from '../components.js';
import { dailyLegend, mealLegend } from '../score-legend.js';
import { miniDial } from './meal.js';

/* #score-explained — "Score colors explained" (founder 2026-09-09, after Cal AI's "Ring colors
   explained"). A static page: what each daily-score tier colour means, what builds the daily
   number, and what each meal band means. Every range, label and weight is read from the live
   ladder / weights (score-legend.js, liveWeightPct) so this page cannot drift from the product.
   Reached from Profile › Goals & tracking and from the Score Breakdown. */

function swatch(r) {
  return `<span class="sx-ring${r.dashed ? ' dashed' : ''}" data-tone="${esc(r.tone || 'muted')}" aria-hidden="true"></span>`;
}

function legendRow(r) {
  return `
  <div class="lrow sx-row" role="listitem">
    ${swatch(r)}
    <div class="lm">
      <div class="lt">${esc(r.name || r.label)}${r.range ? ` <span class="sx-range">${esc(r.range)}</span>` : ''}</div>
      <div class="ls">${esc(r.meaning)}</div>
    </div>
  </div>`;
}

export default {
  tab: 'profile',
  render() {
    const food = liveWeightPct('nutrition');
    const sent = liveWeightPct('checkin');
    const answered = liveWeightPct('recovery');
    const score = S.score != null ? S.score : 0;
    return `
    ${backHead('Score colors explained', 'What the rings and numbers mean', 'profile')}

    ${/* Same hero as the Score Breakdown: the 200px ring with the tier chip BELOW it (the
          centre stack only fits inside the 338px home ring; at smaller sizes the chip crosses
          the arc). This page is the legend for that ring, so it opens on the ring. */''}
    <div class="bd-hero bd-hero-calm" aria-hidden="true">
      ${scoreRing({ score, size: 200, stroke: 13, uid: 'sx', vt: 'score', notStarted: !!(S.exec && S.exec.met === 0) })}
      <span class="tier-chip bd-tier ${S.tier ? S.tier.cls : 'b'}">${esc(S.tier ? S.tier.name : '')}</span>
    </div>

    <h2 class="eyebrow">Daily score</h2>
    <p class="sx-lead">The ring on Home is the day, 0 to 100. Its colour is the tier the number sits in:</p>
    <section class="card rows" role="list">
      ${dailyLegend().map(legendRow).join('')}
    </section>

    <h2 class="eyebrow">What builds the daily score</h2>
    <section class="card rows" role="list">
      <div class="lrow sx-row" role="listitem">
        <div class="lic sx-lic-g">${icon('bowl', 17)}</div>
        <div class="lm"><div class="lt">Food</div><div class="ls">Every meal in your standard, logged on time and read well.</div></div>
        <span class="lv">${food} pts</span>
      </div>
      <div class="lrow sx-row" role="listitem">
        <div class="lic sx-lic-p">${icon('moon', 17)}</div>
        <div class="lm"><div class="lt">Check-in submitted</div><div class="ls">Tonight, before the day closes.</div></div>
        <span class="lv">${sent} pts</span>
      </div>
      <div class="lrow sx-row" role="listitem">
        <div class="lic sx-lic-p">${icon('check', 17)}</div>
        <div class="lm"><div class="lt">Check-in answered</div><div class="ls">Every question answered. Your answers are never graded, only that you gave them.</div></div>
        <span class="lv">${answered} pts</span>
      </div>
      <div class="lrow sx-row" role="listitem">
        <div class="lic">${icon('clock', 17)}</div>
        <div class="lm"><div class="lt">Logged late</div><div class="ls">Full credit at the deadline, fading to half over the next ${LATE_DECAY_MIN} minutes. Never a cliff.</div></div>
      </div>
    </section>

    <h2 class="eyebrow">Meal score</h2>
    <div class="sx-meal-lead" aria-hidden="true">
      <div class="scorechip good">${miniDial(100)}<span class="v">100</span><span class="k">Meal</span></div>
      <p class="sx-lead">Each meal you log gets its own read, 0 to 100, on the chip over the photo:</p>
    </div>
    <section class="card rows" role="list">
      ${mealLegend().map(legendRow).join('')}
    </section>

    <div class="sx-gap"></div>
    <div class="sidebox">
      <div class="req-icon b s38">${icon('info', 17)}</div>
      <div><div class="tt">Why the ring is never green</div>
      <div class="ts">The blue-to-teal sweep on every ring is the score itself. Green only ever means a status: on standard, met, done. So a 58 never wears success green, and a 94 never has to.</div></div>
    </div>
    <div class="sx-gap"></div>
    `;
  },
  // The ring plays the score's moment, silently: the number was announced wherever the athlete
  // tapped in from (same ruling as the breakdown).
  mount(root) {
    reveal(root, { key: `sx:${DAY.date}:${S.score}`, haptic: null });
  },
};
