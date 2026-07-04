import { S } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

export default {
  tab: 'profile',
  render() {
    const code = ['M', '4', 'R', 'K', '7'];
    return `
    ${backHead('Connect a Coach', 'Enter the code your coach gave you', 'profile')}

    <div style="height:14px"></div>
    <div class="code-boxes">
      ${code.map(c => `<div class="cb filled">${c}</div>`).join('')}
      <div class="cb cursor"></div>
    </div>
    <div style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);margin-top:10px">Codes are 6 characters · ask your coach or team group chat</div>

    <div class="eyebrow">Found your team</div>
    <section class="card team-preview">
      <div class="tp-av">M</div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800">${S.coach.name}'s Group</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${S.coach.team} · 24 athletes</div>
      </div>
      <span class="status-pill b">Match</span>
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">What your coach will see</div>
      <div class="ts">Your daily score, requirement completion, meal logs, and check-ins. Your work counts toward the squad leaderboard.</div></div>
    </div>

    <div style="height:18px"></div>
    <button class="btn primary" data-go="profile">${icon('check', 19)} Join ${S.coach.name}'s Group</button>
    <div style="height:10px"></div>
    <button class="btn ghost sm" data-go="profile">I don't have a code</button>
    <div style="height:10px"></div>
    `;
  },
};
