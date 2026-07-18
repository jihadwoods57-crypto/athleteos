import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import { CD, loadCoachRoster } from '../coach-data.js';
import { allowedCreateKeys, isReadonly } from '../staff-access.js';

/* The + is a CREATE MENU now, not a single composer (Coach OS spec §3). Announcements, check-ins,
   and schedule adjustments landed in Slice C alongside this rebuild.
   Slice F: options filter by the staff member's role (staff-access.js capability map; the
   role rides in CD.extras.myRole from the roster load — one fetch for all coach screens).
   The server (0077/0078) enforces regardless; this just never dangles a dead button. */
const OPTIONS = [
  { key: 'assign',          icon: 'clipboard', title: 'Assign a requirement',  sub: 'Team, room, group, or one athlete', go: 'coach-assign' },
  { key: 'announce',        icon: 'share',     title: 'Send an announcement',  sub: 'Feed + push to the room you pick',  go: 'coach-announce' },
  { key: 'message_athlete', icon: 'message',   title: 'Message an athlete',    sub: 'Pick from the roster',              go: 'coach-roster' },
  { key: 'message_group',   icon: 'users',     title: 'Message a group',       sub: 'Announce to a custom group',        go: 'coach-announce' },
  { key: 'standards',       icon: 'bars',      title: 'Standards & templates', sub: 'Meals, windows, check-ins by room', go: 'coach-plan' },
  { key: 'schedule',        icon: 'clock',     title: 'Adjust a schedule',     sub: 'Mark travel or an excused stretch', go: 'coach-roster' },
  { key: 'add_athlete',     icon: 'user',      title: 'Add an athlete',        sub: 'Share your team code',              go: 'coach-profile' },
  { key: 'invite_staff',    icon: 'users',     title: 'Invite staff',          sub: 'Coordinator, room, or view-only',   go: 'coach-profile' },
  { key: 'team_diet',       icon: 'heart',     title: 'Team diet',             sub: 'Meal-plan tools',                   go: 'team-diet' },
];

export const coachCreate = {
  nav: 'coach', tab: 'create', transient: true,
  render() {
    const myRole = CD.extras ? CD.extras.myRole : null;
    if (CD.extras && isReadonly(myRole)) {
      return `${backHead('Create', 'What do you want to put in motion?', 'coach-home')}
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('eye', 17)}</div>
        <div><div class="tt">You have view-only access</div>
        <div class="ts">You can see the roster, standards, and activity for your scope — creating and assigning is for the coaching staff. Ask the head coach if that should change.</div></div>
      </div>`;
    }
    const allowed = allowedCreateKeys(myRole);
    const opts = OPTIONS.filter((o) => allowed.includes(o.key));
    return `${backHead('Create', 'What do you want to put in motion?', 'coach-home')}
    <section class="card" style="padding:6px 16px">
      ${opts.map(o => `
      <div class="lrow" data-go="${o.go}" style="cursor:pointer">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon(o.icon, 17)}</div>
        <div class="lm"><div class="lt">${esc(o.title)}</div><div class="ls">${esc(o.sub)}</div></div>
        <span style="color:var(--text-3)">›</span>
      </div>`).join('')}
    </section>`;
  },
  mount() {
    // Roster load also fills CD.extras (incl. myRole) and repaints this route when it lands.
    loadCoachRoster();
  },
};
