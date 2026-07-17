import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';

/* The + is a CREATE MENU now, not a single composer (Coach OS spec §3). Slice A ships
   the options that have real destinations today; announcements, check-ins, and schedule
   adjustments arrive with slice C — they are NOT listed until they exist. */
const OPTIONS = [
  { icon: 'clipboard', title: 'Assign a requirement', sub: 'Team, room, group, or one athlete', go: 'coach-assign' },
  { icon: 'message',   title: 'Message an athlete',   sub: 'Pick from the roster',              go: 'coach-roster' },
  { icon: 'bars',      title: 'Standards',            sub: 'Meals, weigh-ins, check-ins by room', go: 'coach-plan' },
  { icon: 'user',      title: 'Add an athlete',       sub: 'Share your team code',              go: 'coach-profile' },
  { icon: 'users',     title: 'Invite staff',         sub: 'Assistant or dietitian codes',      go: 'coach-profile' },
];

export const coachCreate = {
  nav: 'coach', tab: 'create', transient: true,
  render() {
    return `${backHead('Create', 'What do you want to put in motion?', 'coach-home')}
    <section class="card" style="padding:6px 16px">
      ${OPTIONS.map(o => `
      <div class="lrow" data-go="${o.go}" style="cursor:pointer">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon(o.icon, 17)}</div>
        <div class="lm"><div class="lt">${esc(o.title)}</div><div class="ls">${esc(o.sub)}</div></div>
        <span style="color:var(--text-3)">›</span>
      </div>`).join('')}
    </section>`;
  },
};
