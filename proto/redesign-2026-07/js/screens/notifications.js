import { S } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';

function notif(n) {
  // title/body are built from cross-user text (coach-assigned titles, plan updates, trainer
  // notes) — escape at the sink so stored XSS can't fire when coach→athlete goes live.
  return `<div class="notif ${n.level}" ${n.route ? `data-go="${n.route}" style="cursor:pointer"` : ''}>
    <div class="nic">${icon(n.icon, 19)}</div>
    <div style="flex:1">
      <span class="level-tag ${n.level}">${n.level === 'positive' ? 'nice work' : n.level}</span>
      <div class="nt">${esc(n.title)}</div>
      <div class="nb">${esc(n.body)}</div>
    </div>
    <span class="nw">${n.when}</span>
  </div>`;
}

export default {
  tab: 'home',
  mount() { window.__act.readNotifs(); },
  render() {
    const N = S.notifications;
    return `
    ${backHead('Notifications', 'Accountability moments, not spam')}

    <div class="eyebrow">New</div>
    ${N.new.map(notif).join('')}

    <div class="eyebrow">Earlier today</div>
    ${N.earlier.map(notif).join('')}

    <div style="height:6px"></div>
    <div class="sidebox" data-go="notif-settings" style="cursor:pointer">
      <div class="req-icon b" style="width:38px;height:38px">${icon('gear', 17)}</div>
      <div style="flex:1"><div class="tt">Notification settings</div>
      <div class="ts">${S.coach.name} sets urgency per requirement. You set pressure level and quiet hours.</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>
    <div style="height:10px"></div>
    `;
  },
};
