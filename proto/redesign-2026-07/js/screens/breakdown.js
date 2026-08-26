import { S } from '../state.js';
import { DAY } from '../day.js';
import { icon } from '../icons.js';
import { backHead, scoreRing, esc } from '../components.js';
import { reveal } from '../motion.js';
import { shareDay } from '../share-card.js';
import { ON_STANDARD } from '../score-band.js';
import { pressTilt } from '../tilt.js';

/* Score Breakdown (spec §2): every category explains its exact math — weight, earned/available,
   why points were earned or lost, what remains, and whether the remainder is guaranteed or
   "up to". Categories expand inline (native <details>) into requirement-by-requirement rows.
   The reach plan is engine-exact: each row's "up to" is its marginal gain on the ceiling path,
   so the rows sum to exactly (max possible − current score). */

const ROW_STATE = {
  done: { cls: 'g', ic: 'check' },
  late: { cls: 'a', ic: 'clock' },
  open: { cls: 'b', ic: 'chevron' },
  overdue: { cls: 'r', ic: 'clock' },
  flagged: { cls: 'a', ic: 'alert' },
  info: { cls: 'muted', ic: 'info' },
};

function catCard(b) {
  const st = (s) => ROW_STATE[s] || ROW_STATE.info;
  return `
  <details class="bd-cat" data-cat="${b.id}">
    <summary class="bd-row">
      <div class="bd-top">
        <span class="bd-name">${esc(b.key)} <span class="bd-weight">${b.weightPct}% of score</span></span>
        <span class="bd-val">${b.earned}<small>/${b.possible}</small></span>
      </div>
      <div class="bd-bar"><div class="bd-fill ${b.accent}" style="transform:scaleX(${b.possible ? (b.earned / b.possible).toFixed(3) : 0})"></div></div>
      <div class="bd-note">${esc(b.note)}</div>
      ${b.remaining > 0 ? `<div class="bd-remaining">${b.remainingKind === 'guaranteed' ? `+${b.remaining} available · guaranteed` : `Up to +${b.remaining} still available`}</div>` : ''}
      <span class="bd-chev">${icon('chevron', 14)}</span>
    </summary>
    <div class="bd-detail">
      ${b.rows.map(r => `
        <div class="bd-req">
          <span class="bd-req-dot ${st(r.state).cls}"></span>
          <div class="bd-req-main">
            <div class="t">${esc(r.label)}</div>
            ${r.sub ? `<div class="s">${esc(r.sub)}</div>` : ''}
          </div>
          ${r.value ? `<div class="bd-req-val">${esc(r.value)}</div>` : ''}
        </div>`).join('')}
      <div class="bd-remaining-note">${esc(b.remainingNote)}</div>
      ${b.action ? `<button class="btn primary sm" data-go="${b.action.route}" style="margin-top:10px">${esc(b.action.label)}</button>` : ''}
    </div>
  </details>`;
}

export default {
  tab: 'home',
  render() {
    const cats = S.explain;
    const reach = S.reach;
    const upTotal = reach.maxPossible;
    const anyVariable = reach.rows.some(r => r.kind === 'upTo');
    return `
    ${backHead('Score Breakdown', 'Why you have this score, and how to climb')}

    <!-- The tier rides BELOW the ring here, not inside it. This ring is 200px (the home hero's is
         338), but the centre stack kept the hero's metrics: the chip is ~123px wide and sits ~71px
         below centre, where the band's inner edge only clears ~18px of half-width, so its ends
         crossed straight through the arc. Outside the ring it is simply legible, and it reads the
         same way home already states the tier under its own ring. -->
    <div class="bd-hero bd-hero-calm">
      ${scoreRing({ score: S.score, size: 200, stroke: 13, uid: 'bd', vt: 'score' })}
      <span class="tier-chip bd-tier ${S.tier.cls}">${esc(S.tier.name)}</span>
    </div>

    <section class="card bd-comp">
      ${cats.map(catCard).join('')}
    </section>

    <div class="eyebrow">Not in today's score</div>
    <div class="sidebox">
      <div class="req-icon muted" style="width:38px;height:38px">${icon('scale', 19)}</div>
      <div>
        <div class="tt">Morning Weight${S.weightLine.state === 'missed' ? ' · missed today, not scored' : ''}</div>
        <div class="ts">${S.weightLine.state === 'open' ? esc(S.weightLine.note) + ' ' : ''}Morning weight tracks long-term progress and never lowers your daily score.</div>
      </div>
    </div>

    ${reach.rows.length ? `
    <div class="eyebrow">How to reach ${anyVariable ? `up to ${upTotal}` : upTotal} today</div>
    <section class="card reach">
      ${reach.rows.map(r => `
        <div class="reach-row" data-go="${r.route}">
          <div class="ic req-icon ${r.accent}">${icon(r.accent === 'g' ? 'bowl' : r.accent === 'p' ? 'moon' : 'check', 18)}</div>
          <div class="reach-main">
            <span class="t">${esc(r.label)}</span>
            <span class="s">${esc(r.sub)}</span>
          </div>
          <span class="gain">${r.kind === 'upTo' ? 'up to ' : ''}+${r.gain}</span>
        </div>`).join('')}
      <div class="reach-proj">Projected: ${S.score} → ${anyVariable ? `up to ${upTotal}` : upTotal}</div>
      ${anyVariable ? `<div class="reach-fine">“Up to” totals assume on-time logs that reach your protein target and your best check-in answers.</div>` : ''}
      <div style="padding-top:12px">
        <button class="btn ${reach.rows[0].accent === 'p' ? 'primary' : 'green'} sm" data-go="${reach.rows[0].route}">${icon(reach.rows[0].accent === 'p' ? 'moon' : reach.rows[0].accent === 'g' ? 'camera' : 'check', 19)} ${esc(reach.rows[0].label)} now</button>
      </div>
    </section>` : `
    <div class="eyebrow">Day complete</div>
    <div class="day-done">
      <div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
      <div><div class="tt">Every point that was on the table is in.</div>
      <div class="ts">${S.score} of 100. ${S.score >= ON_STANDARD ? 'This is what OnStandard looks like.' : 'Every requirement is in; meal quality is what lifts it toward the standard.'}</div></div>
    </div>`}
    <div style="height:8px"></div>
    ${S.score != null ? `<button class="btn ghost sm" id="bd-share" style="width:100%">${icon('share', 17)} Share today's score</button>
    <div style="height:8px"></div>` : ''}
    `;
  },
  // Same reveal as Home and the meal chip — this screen is the score explaining itself, so it plays
  // the score's moment. Silent: the number was already announced wherever the athlete tapped in
  // from, and a second haptic for the same fact reads as a stutter.
  mount(root) {
    reveal(root, { key: `breakdown:${DAY.date}:${S.score}`, haptic: null });
    // Depth response on the big ring, same physics as Home's hero (tilt.js).
    pressTilt(root.querySelector('.bd-hero .ring-wrap'), { max: 5.5 });
    // Today's number, on the card. The share renderer draws the app's real signature, so this is the
    // one surface that markets the product for free — it should be reachable from the screen that
    // explains the score, not only from the monthly report.
    const share = root.querySelector('#bd-share');
    if (share) share.addEventListener('click', () => {
      void shareDay({
        score: S.score,
        streak: S.streakDays,
        met: S.exec ? S.exec.met : null,
        total: S.exec ? S.exec.total : null,
        dateISO: String(DAY.date),
      });
    });
  },
};
