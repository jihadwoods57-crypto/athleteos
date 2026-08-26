import { S, RT, roleNav, notifsFetchFailed } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, skeletonRows } from '../components.js';

const isOperator = () => RT.authRole === 'coach' || RT.authRole === 'trainer';

function notif(n, read) {
  // title/body are built from cross-user text (coach-assigned titles, plan updates, trainer
  // notes) — escape at the sink so stored XSS can't fire when coach→athlete goes live.
  return `<div class="notif ${n.level} ${read ? 'read' : 'unread'}" ${n.route ? `data-go="${n.route}" style="cursor:pointer"` : ''}>
    <div class="nic">${icon(n.icon, 19)}</div>
    <div style="flex:1">
      <span class="level-tag ${n.level}">${n.tag || { high: 'urgent', medium: 'reminder', positive: 'nice work', critical: 'now', info: 'announcement' }[n.level] || n.level}</span>
      <div class="nt">${esc(n.title)}</div>
      <div class="nb">${esc(n.body)}</div>
    </div>
    <span class="nmeta"><span class="nw">${n.when}</span>${read ? (n.route ? icon('chevron', 15, 'style="color:var(--text-3)"') : '') : '<span class="udot" aria-hidden="true"></span>'}</span>
  </div>`;
}

/* One visit, one truth. The old flow acked everything read the moment the screen mounted, while
   the rows on screen still claimed "N unread" with a live "Mark all read" button, so the header
   contradicted the (already cleared) bell badge. Now the unread set is SNAPSHOTTED once, after
   the first fetch settles and BEFORE the ack, and that snapshot drives the "New" grouping for
   the whole visit. The header counts the snapshot ("N new"), which never claims unread-ness the
   badge no longer shows, and the vestigial Mark-all-read button is gone: opening the bell IS the
   read. Until that first fetch settles, the screen shows a skeleton instead of prematurely
   declaring "You're all caught up" over rows that haven't arrived yet. */
let VISIT = { settled: false, fetching: false, snap: null };
const keyOf = (n) => (n.server ? `s:${n.id || n.title}` : `d:${n.title}`);

export default {
  // Per-role nav so the router's guards admit every signed-in role. This screen was always
  // role-neutral (RLS scopes the rows to the caller) — but its implicit nav:'athlete' meant the
  // mirror guard bounced a coach to #coach-home, so escalations landed in the table and no coach
  // could ever see them. The feed itself needs no role branches; only the empty state and the
  // settings row below differ.
  get nav() { return roleNav(); },
  tab: 'home',
  async mount() {
    if (VISIT.settled || VISIT.fetching) return;
    VISIT.fetching = true;
    try {
      await window.__act.loadNotifications();
    } catch { /* offline: cached rows still render */ }
    // Snapshot which rows are unread RIGHT NOW, before the ack below clears the badge. This is
    // exactly the read-state the old renderer would have painted: server rows by their own
    // read_at, derived rows by the coarse device flag.
    const N = S.notifications;
    const rowsRead = S.unreadNotifs === 0;
    const snap = new Set();
    for (const n of [...N.new, ...N.earlier]) {
      const unread = n.server ? !n.read : !rowsRead;
      if (unread) snap.add(keyOf(n));
    }
    VISIT.snap = snap;
    VISIT.settled = true;
    VISIT.fetching = false;
    window.__act.readNotifs();
    if (window.__render) window.__render();
  },
  render() {
    // Fresh arrival vs in-visit repaint: when render() runs, the PREVIOUS screen is still in the
    // DOM, so the absence of this screen's own root is a reliable "coming from somewhere else"
    // (the feedback.js pattern). A repaint during the visit keeps the snapshot untouched.
    if (typeof document !== 'undefined' && !document.querySelector('#ntf-root')) {
      VISIT = { settled: false, fetching: false, snap: null };
    }
    if (!VISIT.settled) {
      return `<div id="ntf-root">
      ${backHead('Notifications', 'Accountability moments, not spam')}
      ${skeletonRows(3, 'Checking notifications')}
      </div>`;
    }
    const N = S.notifications;
    const snap = VISIT.snap || new Set();
    const isNew = (n) => snap.has(keyOf(n));
    const row = (n) => notif(n, !isNew(n));
    const hasRows = N.new.length || N.earlier.length;
    const newCount = [...N.new, ...N.earlier].filter(isNew).length;
    return `<div id="ntf-root">
    ${backHead('Notifications', 'Accountability moments, not spam')}

    ${hasRows ? (newCount > 0
        ? `<div class="nhead"><span class="nsummary"><span class="cnt">${newCount}</span> new</span></div>`
        : `<div class="nhead"><span class="nsummary allclear">${icon('checkCircle', 16)} All caught up</span></div>`) : ''}

    ${N.new.length ? `<div class="eyebrow">${N.new.some(isNew) ? 'New' : 'Recent'}</div>${N.new.map(row).join('')}` : ''}

    ${N.earlier.length ? `<div class="eyebrow">Earlier</div>${N.earlier.map(row).join('')}` : ''}

    ${!hasRows && notifsFetchFailed ? `
    <div class="ne-empty">
      <div class="ne-ring" style="color:var(--amber-bright)">${icon('wifiOff', 30)}</div>
      <div class="ne-t">Couldn't check notifications</div>
      <div class="ne-s">Nothing was cleared; this screen just couldn't reach the server. It retries on its own, so check back in a moment.</div>
    </div>` : ''}
    ${!hasRows && !notifsFetchFailed ? `
    <div class="ne-empty">
      <div class="ne-ring">${icon('checkCircle', 30)}</div>
      <div class="ne-t">You're all caught up</div>
      <div class="ne-s">No accountability moments waiting. When something needs you, it lands here first.</div>
      <div class="ne-list">
        ${isOperator() ? `
        <div class="ne-item"><span class="ne-d">${icon('alert', 15)}</span> Meals the AI flags for your eyes</div>
        <div class="ne-item"><span class="ne-d">${icon('users', 15)}</span> Join requests and roll-call escalations</div>
        <div class="ne-item"><span class="ne-d">${icon('clipboard', 15)}</span> Your weekly team digest</div>` : `
        <div class="ne-item"><span class="ne-d">${icon('utensils', 15)}</span> Meal and weigh-in nudges</div>
        <div class="ne-item"><span class="ne-d">${icon('clipboard', 15)}</span> Requirements your coach adds</div>
        <div class="ne-item"><span class="ne-d">${icon('flame', 15)}</span> Streak reminders before midnight</div>`}
      </div>
    </div>` : ''}

    <div style="height:6px"></div>
    ${isOperator() ? '' : `
    <div class="sidebox" data-go="notif-settings" style="cursor:pointer">
      <div class="req-icon b" style="width:38px;height:38px">${icon('gear', 17)}</div>
      <div style="flex:1"><div class="tt">Notification settings</div>
      <div class="ts">${S.coach.hasCoach ? `${esc(S.coach.name)} sets urgency per requirement.` : 'Urgency comes with each requirement.'} You set pressure level and quiet hours.</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>`}
    <div style="height:10px"></div>
    </div>`;
  },
};
