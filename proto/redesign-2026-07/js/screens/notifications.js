import { S, RT, roleNav, notifsFetchFailed } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, skeletonRows, emptyState, errorState } from '../components.js';
import { openFeedback } from './feedback.js';

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
      ${/* An announcement is a coach's free text on an athlete's screen (Guideline 1.2): it needs
            a way to report it. Straight into the safety queue, which is human-read and urgent. */''}
      ${n.level === 'info' && !isOperator() ? `<span class="nf-acts"><button type="button" class="btn ghost xs nf-report" data-report-announcement>Report</button>${n.kind === 'announcement' && n.id ? `<button type="button" class="btn ghost xs nf-report" data-block-announcement="${esc(String(n.id))}">Block sender</button>` : ''}</span>` : ''}
    </div>
    ${/* The chevron follows the ROUTE, not the read state (2026-09-07 audit). It used to render
          only on read rows, so the newest and most actionable notifications — the unread ones,
          which is the whole point of the screen — were the ones with no affordance at all,
          while the inert "Notification settings" link below them had a chevron. Unread now
          shows its dot AND the chevron; a row with nowhere to go still shows neither. */''}
    <span class="nmeta"><span class="nw">${n.when}</span>${read ? '' : '<span class="udot" aria-hidden="true"></span>'}${n.route ? icon('chevron', 15, 'style="color:var(--text-3)"') : ''}</span>
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
  async mount(root) {
    if (root) root.addEventListener('click', async (e) => {
      /* Block (0244, G-R3): the coach behind an announcement, found by the server. Their future
         announcements and pushes stop; they are not told. */
      const blk = e.target.closest && e.target.closest('[data-block-announcement]');
      if (blk) {
        e.stopPropagation();
        blk.disabled = true; blk.textContent = 'Blocking…';
        const { blockAnnouncementAuthor } = await import('../blocks.js');
        const r = await blockAnnouncementAuthor(blk.getAttribute('data-block-announcement'));
        blk.textContent = r.ok ? 'Blocked' : 'Couldn’t block. Try again';
        blk.disabled = r.ok;
        return;
      }
      const b = e.target.closest && e.target.closest('[data-report-announcement]');
      if (!b) return;
      e.stopPropagation();
      openFeedback('notifications', 'safety');
      location.hash = '#feedback';
    });
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
      ${backHead('Notifications', '')}
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
    ${backHead('Notifications', '')}

    ${/* The count rides on the "New" heading ("New · 2", the same shape as Home's "Upcoming · 1")
          instead of a separate "2 new" line two rows above a "NEW" label saying the same thing.
          The summary row survives for the two states the heading cannot carry: all caught up,
          and unread items that only exist in Earlier. */''}
    ${hasRows ? (newCount > 0
        ? (N.new.some(isNew) ? '' : `<div class="nhead"><span class="nsummary"><span class="cnt">${newCount}</span> new</span></div>`)
        : `<div class="nhead"><span class="nsummary allclear">${icon('checkCircle', 16)} All caught up</span></div>`) : ''}

    ${N.new.length ? `<h2 class="eyebrow">${N.new.some(isNew) ? `New · ${newCount}` : 'Recent'}</h2>${N.new.map(row).join('')}` : ''}

    ${N.earlier.length ? `<h2 class="eyebrow">Earlier</h2>${N.earlier.map(row).join('')}` : ''}

    ${/* The shared errorState (role="alert"), not a hand-rolled amber block: amber is the
          warning hue, and a failed fetch is a failure, which the primitive already dresses. */''}
    ${!hasRows && notifsFetchFailed ? errorState({
      title: "Couldn't check notifications",
      body: "Nothing was cleared; this screen just couldn't reach the server. It retries on its own, so check back in a moment.",
    }) : ''}
    ${!hasRows && !notifsFetchFailed ? `
    ${emptyState({
      icon: 'checkCircle',
      title: "You're all caught up",
      body: `No accountability moments waiting. When something needs you, it lands here first: ${isOperator()
        ? 'meals the AI flags for your eyes, join requests and roll-call escalations, and your weekly team digest.'
        : 'meal and weigh-in nudges, requirements your coach adds, and streak reminders before midnight.'}`,
    })}` : ''}

    <div style="height:6px"></div>
    <div class="sidebox" data-go="${isOperator() ? 'coach-notif-settings' : 'notif-settings'}" style="cursor:pointer">
      <div class="req-icon b s38">${icon('gear', 17)}</div>
      <div style="flex:1"><div class="tt">Notification settings</div>
      <div class="ts">${isOperator() ? 'What reaches you, and when.' : S.coach.hasCoach ? `${esc(S.coach.name)} sets urgency. You set tone and quiet hours.` : 'Tone and quiet hours.'}</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>
    <div style="height:10px"></div>
    </div>`;
  },
};
