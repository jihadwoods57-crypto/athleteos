import { S, pct } from '../state.js';
import { icon } from '../icons.js';
import { backHead, scoreRing, animateRing } from '../components.js';

export default {
  tab: 'home',
  render() {
    return `
    ${backHead('Score Breakdown', 'Why you have this score, and how to climb')}

    <div class="bd-hero">
      ${scoreRing({ score: S.score, size: 210, stroke: 14, uid: 'bd' })}
    </div>

    <section class="card bd-comp">
      ${S.breakdown.map(b => `
        <div class="bd-row">
          <div class="bd-top">
            <span class="bd-name">${b.key} <span class="bd-weight">${b.weightPct}% of score</span></span>
            <span class="bd-val">${b.earned}<small>/${b.possible}</small></span>
          </div>
          <div class="bd-bar"><div class="bd-fill ${b.accent}" style="width:${pct(b.earned, b.possible)}%"></div></div>
          <div class="bd-note">${b.note}</div>
        </div>`).join('')}
    </section>

    <div class="eyebrow">Not in today's score</div>
    <div class="sidebox">
      <div class="req-icon a" style="width:38px;height:38px">${icon('scale', 19)}</div>
      <div>
        <div class="tt">${S.weightLine.label}</div>
        <div class="ts">${S.weightLine.note} Weight tracks your <b>season goal</b>, so one busy morning never sinks a good day.</div>
      </div>
    </div>

    <div class="eyebrow">How to reach ${S.possible}</div>
    <section class="card reach">
      ${S.reachPlan.map(r => `
        <div class="reach-row" data-go="${r.label.includes('dinner') ? 'camera' : 'recovery'}">
          <div class="ic ${r.accent === 'g' ? 'req-icon g' : 'req-icon p'}">${icon(r.accent === 'g' ? 'bowl' : 'moon', 18)}</div>
          <span class="t">${r.label}</span>
          <span class="gain">+${r.gain} pts</span>
        </div>`).join('')}
      <div style="padding-top:14px">
        <button class="btn green sm" data-go="camera">${icon('camera', 19)} Log Dinner now</button>
      </div>
    </section>
    <div style="height:8px"></div>
    `;
  },
  mount(root) { animateRing(root); },
};
