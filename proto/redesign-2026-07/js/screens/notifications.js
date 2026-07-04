import { S } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

function notif(n) {
  return `<div class="notif ${n.level}">
    <div class="nic">${icon(n.icon, 19)}</div>
    <div style="flex:1">
      <span class="level-tag ${n.level}">${n.level === 'positive' ? 'nice work' : n.level}</span>
      <div class="nt">${n.title}</div>
      <div class="nb">${n.body}</div>
    </div>
    <span class="nw">${n.when}</span>
  </div>`;
}

export default {
  tab: 'home',
  render() {
    const N = S.notifications;
    return `
    ${backHead('Notifications', 'Accountability moments, not spam')}

    <div class="eyebrow">New</div>
    ${N.new.map(notif).join('')}

    <div class="eyebrow">Earlier today</div>
    ${N.earlier.map(notif).join('')}

    <div style="height:6px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bell', 18)}</div>
      <div><div class="tt">Reminder level: High</div>
      <div class="ts">${S.coach.name} sets urgency per requirement. You control quiet hours in Profile → Notifications.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};
