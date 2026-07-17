import { S } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';

function notif(n, read) {
  // title/body are built from cross-user text (coach-assigned titles, plan updates, trainer
  // notes) — escape at the sink so stored XSS can't fire when coach→athlete goes live.
  return `<div class="notif ${n.level} ${read ? 'read' : 'unread'}" ${n.route ? `data-go="${n.route}" style="cursor:pointer"` : ''}>
    <div class="nic">${icon(n.icon, 19)}</div>
    <div style="flex:1">
      <span class="level-tag ${n.level}">${{ high: 'urgent', medium: 'reminder', positive: 'nice work', critical: 'now', info: 'announcement' }[n.level] || n.level}</span>
      <div class="nt">${esc(n.title)}</div>
      <div class="nb">${esc(n.body)}</div>
    </div>
    <span class="nmeta"><span class="nw">${n.when}</span>${read ? (n.route ? icon('chevron', 15, 'style="color:var(--text-3)"') : '') : '<span class="udot" aria-hidden="true"></span>'}</span>
  </div>`;
}

export default {
  tab: 'home',
  async mount() {
    // Pull the server feed (coach nudges, join events, digests) first so THIS visit shows
    // fresh rows with their honest unread grouping, then ack everything as read (badge
    // clears; the grouping updates on the next visit's fetch). Repaint at most once.
    try {
      const changed = await window.__act.loadNotifications();
      if (changed && window.__render) window.__render();
    } catch { /* offline — cached rows already rendered */ }
    window.__act.readNotifs();
  },
  render() {
    const N = S.notifications;
    const hasRows = N.new.length || N.earlier.length;
    // Derived rows keep the coarse all-or-nothing read model (RT.notifsRead); server rows
    // (0027) carry REAL per-row read state (read_at) and render it honestly.
    const rowsRead = S.unreadNotifs === 0;
    const row = (n) => notif(n, n.server ? n.read : rowsRead);
    return `
    ${backHead('Notifications', 'Accountability moments, not spam')}

    ${hasRows ? (S.unreadNotifs > 0
        ? `<div class="nhead"><span class="nsummary"><span class="cnt">${S.unreadNotifs}</span> unread</span><button class="markread" data-act="readNotifs" data-then="notifications">Mark all read</button></div>`
        : `<div class="nhead"><span class="nsummary allclear">${icon('checkCircle', 16)} All caught up</span><button class="markread" disabled>Mark all read</button></div>`) : ''}

    ${N.new.length ? `<div class="eyebrow">New</div>${N.new.map(row).join('')}` : ''}

    ${N.earlier.length ? `<div class="eyebrow">Earlier</div>${N.earlier.map(row).join('')}` : ''}

    ${!hasRows ? `
    <div class="ne-empty">
      <div class="ne-ring">${icon('checkCircle', 30)}</div>
      <div class="ne-t">You're all caught up</div>
      <div class="ne-s">No accountability moments waiting. When something needs you, it lands here first.</div>
      <div class="ne-list">
        <div class="ne-item"><span class="ne-d">${icon('utensils', 15)}</span> Meal and weigh-in nudges</div>
        <div class="ne-item"><span class="ne-d">${icon('clipboard', 15)}</span> Requirements your coach adds</div>
        <div class="ne-item"><span class="ne-d">${icon('flame', 15)}</span> Streak reminders before midnight</div>
      </div>
    </div>` : ''}

    <div style="height:6px"></div>
    <div class="sidebox" data-go="notif-settings" style="cursor:pointer">
      <div class="req-icon b" style="width:38px;height:38px">${icon('gear', 17)}</div>
      <div style="flex:1"><div class="tt">Notification settings</div>
      <div class="ts">${S.coach.hasCoach ? `${esc(S.coach.name)} sets urgency per requirement.` : 'Urgency comes with each requirement.'} You set pressure level and quiet hours.</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>
    <div style="height:10px"></div>
    `;
  },
};
