import { S, pct } from '../state.js';
import { icon } from '../icons.js';
import { backHead, scoreRing, animateRing, esc } from '../components.js';

export default {
  tab: 'home',
  render() {
    return `
    ${backHead('Score Breakdown', 'Why you have this score, and how to climb')}

    <div class="bd-hero">
      ${scoreRing({ score: S.score, size: 210, stroke: 14, uid: 'bd', tierName: S.tier.name, tierCls: S.tier.cls })}
    </div>

    <section class="card bd-comp">
      ${S.breakdown.map(b => `
        <div class="bd-row">
          <div class="bd-top">
            <span class="bd-name">${b.key} <span class="bd-weight">${b.weightPct}% of score</span></span>
            <span class="bd-val">${b.earned}<small>/${b.possible}</small></span>
          </div>
          <div class="bd-bar"><div class="bd-fill ${b.accent}" style="width:${pct(b.earned, b.possible)}%"></div></div>
          <div class="bd-note">${esc(b.note)}</div>
        </div>`).join('')}
    </section>

    <div class="eyebrow">Not in today's score</div>
    <div class="sidebox">
      <div class="req-icon a" style="width:38px;height:38px">${icon('scale', 19)}</div>
      <div>
        <div class="tt">${S.weightLine.label}</div>
        <div class="ts">${esc(S.weightLine.note)} Weight tracks your <b>season goal</b>, so one busy morning never sinks a good day.</div>
      </div>
    </div>

    ${S.reachPlan.length ? `
    <div class="eyebrow">How to reach ${S.possible}</div>
    <section class="card reach">
      ${S.reachPlan.map(r => `
        <div class="reach-row" data-go="${r.accent === 'g' ? 'camera' : 'recovery'}">
          <div class="ic ${r.accent === 'g' ? 'req-icon g' : 'req-icon p'}">${icon(r.accent === 'g' ? 'bowl' : 'moon', 18)}</div>
          <span class="t">${r.label}</span>
          ${r.gain ? `<span class="gain">+${r.gain} pts</span>` : ''}
        </div>`).join('')}
      <div style="padding-top:14px">
        <button class="btn ${S.reachPlan[0].accent === 'g' ? 'green' : 'primary'} sm" data-go="${S.reachPlan[0].accent === 'g' ? 'camera' : 'recovery'}" ${S.reachPlan[0].accent === 'p' ? 'style="background:linear-gradient(150deg, var(--purple-bright), #7e22ce)"' : ''}>${icon(S.reachPlan[0].accent === 'g' ? 'camera' : 'moon', 19)} ${S.reachPlan[0].label.replace('Submit ', 'Do ')} now</button>
      </div>
    </section>` : `
    <div class="eyebrow">Day complete</div>
    <div class="day-done">
      <div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
      <div><div class="tt">Every point that was on the table is in.</div>
      <div class="ts">${S.score} of ${S.possible} possible. This is what OnStandard looks like.</div></div>
    </div>`}
    <div style="height:8px"></div>
    `;
  },
  mount(root) { animateRing(root); },
};
