import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import { RT } from '../state.js';
import * as roles from '../roles.js';
import { CD, loadCoachRoster } from '../coach-data.js';

/* The + is a CREATE MENU now, not a single composer (Coach OS spec §3). Announcements, check-ins,
   and schedule adjustments landed in Slice C alongside this rebuild. */
const OPTIONS = [
  { icon: 'clipboard', title: 'Assign a requirement',  sub: 'Team, room, group, or one athlete', go: 'coach-assign' },
  { icon: 'share',     title: 'Send an announcement',  sub: 'Feed + push to the room you pick',  go: 'coach-announce' },
  { icon: 'message',   title: 'Message an athlete',    sub: 'Pick from the roster',              go: 'coach-roster' },
  { icon: 'users',     title: 'Message a group',       sub: 'Announce to a custom group',        go: 'coach-announce' },
  { icon: 'bars',      title: 'Standards & templates', sub: 'Meals, windows, check-ins by room', go: 'coach-plan' },
  { icon: 'clock',     title: 'Adjust a schedule',     sub: 'Mark travel or an excused stretch', go: 'coach-roster' },
  { icon: 'user',      title: 'Add an athlete',        sub: 'Share your team code',              go: 'coach-profile' },
  { icon: 'users',     title: 'Invite staff',          sub: 'Assistant or dietitian codes',      go: 'coach-profile' },
];

/* This staff member's own role (0061 team_staff), fetched once per team and cached module-level
   — nothing client-side already holds "my role", so this screen owns the one fetch. Until it
   resolves (or the roster hasn't loaded), the base OPTIONS list renders unfiltered: it never
   goes blank waiting on a role we don't have yet. Position-coach audience capping is Slice F —
   not built here, client note only. */
let MYROLE = null; // { teamId, role }
let myRoleLoadingId = null;
async function loadMyRole(teamId) {
  if (!teamId) return;
  if (MYROLE && MYROLE.teamId === teamId) return;
  if (myRoleLoadingId === teamId) return;
  myRoleLoadingId = teamId;
  try {
    const staff = await roles.fetchTeamStaff(teamId);
    const me = staff.find((s) => s.staff_id === RT.userId);
    MYROLE = { teamId, role: me ? me.role : null };
  } finally { myRoleLoadingId = null; }
  if (location.hash === '#coach-create') window.__render();
}

export const coachCreate = {
  nav: 'coach', tab: 'create', transient: true,
  render() {
    const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
    const opts = OPTIONS.slice();
    if (MYROLE && MYROLE.teamId === teamId && MYROLE.role === 'nutritionist') {
      opts.push({ icon: 'heart', title: 'Team diet', sub: 'Meal-plan tools', go: 'team-diet' });
    }
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
    loadCoachRoster().then(() => {
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (teamId) loadMyRole(teamId);
    });
  },
};
