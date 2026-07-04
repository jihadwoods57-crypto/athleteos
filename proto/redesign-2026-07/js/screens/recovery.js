import { S } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

export default {
  tab: 'home',
  render() {
    const R = S.recovery;
    return `
    ${backHead('Recovery Check-In', 'Before bed · Refreshes Recovery (25% of score)')}

    <section class="card" style="padding: 4px 18px 8px">
      ${R.fields.map(f => `
        <div class="rec-field">
          <div class="rec-top">
            <span class="rec-name">${f.k}</span>
            <span class="rec-ends">${f.lo} → ${f.hi}</span>
          </div>
          <div class="chips5">
            ${[1,2,3,4,5].map(n => `<div class="c5 ${n === f.val ? 'on' : ''}">${n}</div>`).join('')}
          </div>
        </div>`).join('')}
    </section>

    <div style="height:14px"></div>
    <div class="lrow" style="border:1px solid var(--hairline);border-radius:15px;padding:13px 15px">
      <div class="lic">${icon('edit', 17)}</div>
      <div class="lm"><div class="lt">Add a note</div><div class="ls">Anything ${S.coach.name} should know tonight</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon p" style="width:38px;height:38px">${icon('moon', 18)}</div>
      <div><div class="tt">Worth +6 tonight → ${S.possible}</div>
      <div class="ts">Takes 20 seconds. ${S.coach.name} sees your readiness before tomorrow's practice.</div></div>
    </div>

    <div style="height:18px"></div>
    <button class="btn primary" style="background:linear-gradient(150deg, var(--purple-bright), #7e22ce); box-shadow: 0 10px 30px rgba(168,85,247,0.35)" data-go="home">
      ${icon('check', 19)} Submit Check-In
    </button>
    <div style="text-align:center;font-size:12px;font-weight:600;color:var(--text-3);margin-top:12px">Coach can see your update</div>
    <div style="height:8px"></div>
    `;
  },
};
