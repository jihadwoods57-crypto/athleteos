import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import { CD, loadBook } from '../coach-data.js';
import { allowedCreateKeys, isReadonly } from '../staff-access.js';

/* The + is a CREATE MENU now, not a single composer (Coach OS spec §3). Announcements, check-ins,
   and schedule adjustments landed in Slice C alongside this rebuild.
   Slice F: options filter by the staff member's role (staff-access.js capability map; the
   role rides in CD.extras.myRole from the roster load — one fetch for all coach screens).
   The server (0077/0078) enforces regardless; this just never dangles a dead button.

   Each option also names the CAPABILITY it needs, so a trainer's practice book shows only what
   actually works against it — never a button that would write a practice id into a team-owned
   table and fail silently. `cap: null` means "no book capability required". */
const OPTIONS = [
  { key: 'assign',          cap: 'assignments',    icon: 'clipboard', title: 'Assign a requirement',  sub: 'Team, room, group, or one athlete', go: 'coach-assign' },
  { key: 'announce',        cap: 'announcements',  icon: 'share',     title: 'Send an announcement',  sub: 'Feed + push to the room you pick',  go: 'coach-announce' },
  { key: 'message_athlete', cap: null,             icon: 'message',   title: 'Message an athlete',    sub: 'Pick from the roster',              go: 'coach-roster' },
  { key: 'message_group',   cap: 'announcements',  icon: 'users',     title: 'Message a group',       sub: 'Announce to a custom group',        go: 'coach-announce' },
  { key: 'standards',       cap: 'standards',      icon: 'bars',      title: 'Standards & templates', sub: 'Meals, windows, check-ins by room', go: 'coach-plan' },
  { key: 'schedule',        cap: 'exceptions',     icon: 'clock',     title: 'Adjust a schedule',     sub: 'Mark travel or an excused stretch', go: 'coach-roster' },
  // Verified Commitments (0138). Distinct from 'schedule' above, which excuses an athlete for a
  // stretch of days; this SCHEDULES the thing they're accountable for in the first place.
  { key: 'commitments',     cap: null,             icon: 'sun',       title: 'Schedule a commitment', sub: 'Roll call, lift, study hall — verified', go: 'coach-commit-manage' },
  { key: 'add_athlete',     cap: null,             icon: 'user',      title: 'Add an athlete',        sub: 'Share your team code',              go: 'coach-profile/code' },
  { key: 'invite_staff',    cap: 'staffRoles',     icon: 'users',     title: 'Invite staff',          sub: 'Coordinator, room, or view-only',   go: 'coach-profile/staff' },
  { key: 'team_diet',       cap: 'recruiting',     icon: 'heart',     title: 'Team diet',             sub: 'Meal-plan tools',                   go: 'team-diet' },
];

/* A trainer's create menu points at their own routes for the two options that survive. */
const TRAINER_GO = { message_athlete: 'trainer-roster', add_athlete: 'trainer-profile' };
/* A practice has no rooms or groups, so the team-shaped sub-copy would describe scopes that
   don't exist on this book (assign_practice_requirement refuses anything but all-or-one). */
const TRAINER_SUB = {
  add_athlete: 'Share your practice code',
  message_athlete: 'Pick from your clients',
  assign: 'All clients, or just one',
  standards: 'Meals, windows, and check-ins',
};

export const coachCreate = {
  nav: 'operator', tab: 'create', transient: true,
  render() {
    const practice = CD.kind === 'practice';
    const back = practice ? 'trainer' : 'coach-home';
    const myRole = CD.extras ? CD.extras.myRole : null;
    // Staff roles are a team concept — a trainer owns their practice outright and is never read-only.
    if (!practice && CD.extras && isReadonly(myRole)) {
      return `${backHead('Create', 'What do you want to put in motion?', back)}
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('eye', 17)}</div>
        <div><div class="tt">You have view-only access</div>
        <div class="ts">You can see the roster, standards, and activity for your scope — creating and assigning is for the coaching staff. Ask the head coach if that should change.</div></div>
      </div>`;
    }
    const allowed = practice ? OPTIONS.map(o => o.key) : allowedCreateKeys(myRole);
    const opts = OPTIONS.filter((o) => allowed.includes(o.key) && (!o.cap || CD.caps[o.cap]));
    return `${backHead('Create', 'What do you want to put in motion?', back)}
    <section class="card" style="padding:6px 16px">
      ${opts.map(o => `
      <div class="lrow" data-go="${(practice && TRAINER_GO[o.key]) || o.go}" style="cursor:pointer">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon(o.icon, 17)}</div>
        <div class="lm"><div class="lt">${esc(o.title)}</div><div class="ls">${esc((practice && TRAINER_SUB[o.key]) || o.sub)}</div></div>
        <span style="color:var(--text-3)">›</span>
      </div>`).join('')}
    </section>
    ${practice ? `
    <div style="height:12px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Built for teams</div>
      <div class="ts">Standards, requirements and announcements are team tools today. They're coming to practices — until then this menu only shows what actually works on your book.</div></div>
    </div>` : ''}`;
  },
  mount() {
    // Book load also fills CD.extras (incl. myRole) and repaints this route when it lands.
    loadBook(false, CD.kind);
  },
};
