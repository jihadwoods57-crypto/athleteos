/* ============================================================
   OB2 role select — the fork for the adaptive onboarding.
   "How will you use OnStandard?" Six benefit-first roles; the
   entire narrative downstream (problem framing, discovery,
   demo, social proof, paywall, destination) adapts to this
   choice. Replaces the 4-card picker at route `role`; the
   legacy flows stay registered for rollback.
   ============================================================ */
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { esc, logoMark } from '../components.js';
import { track, EVENTS } from '../analytics.js';

const ROLES = [
  { go: 'oba/why', key: 'athlete', ic: 'bolt', tint: 'var(--blue-surface)', accent: 'var(--blue-bright)',
    t: 'Athlete', s: 'Build and prove your daily consistency.' },
  { go: 'obf/why', key: 'client', ic: 'user', tint: 'var(--green-surface)', accent: 'var(--green-bright)',
    t: 'Fitness Client', s: 'Stay accountable between training sessions.' },
  { go: 'obk/why', key: 'coach', ic: 'users', tint: 'var(--amber-surface)', accent: 'var(--amber-bright)',
    t: 'Coach', s: 'Set expectations and see who is executing.' },
  { go: 'obt/why', key: 'trainer', ic: 'bars', tint: 'var(--purple-surface)', accent: 'var(--purple-bright)',
    t: 'Trainer', s: 'Scale client accountability and increase your value.' },
  { go: 'obp/why', key: 'parent', ic: 'heart', tint: 'var(--red-surface)', accent: 'var(--red)',
    t: 'Parent', s: 'Support an athlete without constantly checking on them.' },
  { go: 'obn/why', key: 'nutritionist', ic: 'bowl', tint: 'var(--cyan-surface)', accent: 'var(--cyan)',
    t: 'Nutrition Professional', s: 'Review meals, trends, and client progress efficiently.' },
];

/* Resume crumb written by the OB2 engine on every step view. Only offered while the
   person is still signed out — once the account exists the flow is finished or the
   app itself is the right destination. Route must match a known flow or it's ignored. */
const ROUTE_ROLE = { oba: 'athlete', obf: 'client', obk: 'coach', obt: 'trainer', obp: 'parent', obn: 'nutritionist' };
let started = false;
function resumeTarget() {
  if (RT.userId) return null;
  const raw = String(((RT.ob || {}).obResume) || '');
  const [route, step] = raw.split('/');
  if (!route || !step || !ROUTE_ROLE[route]) return null;
  const role = ROLES.find((r) => r.key === ROUTE_ROLE[route]);
  return role ? { go: raw, role } : null;
}

export const ob2Role = {
  hideTabs: true,
  render() {
    const resume = resumeTarget();
    const card = (r) => `
      <div class="role-card" data-go="${r.go}" data-role="${r.key}" role="button" aria-label="${esc(r.t)} — ${esc(r.s)}" style="--role-accent:${r.accent}">
        <div class="role-ic" style="background:${r.tint};color:${r.accent}">${icon(r.ic, 21)}</div>
        <div class="role-tt"><div class="role-t">${esc(r.t)}</div><div class="role-s">${esc(r.s)}</div></div>
        <div class="role-chev">${icon('chevron', 18)}</div>
      </div>`;
    return `
    <div class="ob">
      <div style="width:52px;height:52px;margin:4px auto 14px">${logoMark(52, 'role2')}</div>
      <div class="ob-title" style="text-align:center">How will you use OnStandard?</div>
      <div class="ob-sub" style="text-align:center">Everything that follows is built around your answer.</div>
      <div class="ob-body">
        ${resume ? `
        <div class="role-card" id="ob2-resume" data-go="${esc(resume.go)}" role="button" aria-label="Continue where you left off — ${esc(resume.role.t)}" style="--role-accent:${resume.role.accent};border-color:${resume.role.accent}">
          <div class="role-ic" style="background:${resume.role.tint};color:${resume.role.accent}">${icon('back', 21)}</div>
          <div class="role-tt"><div class="role-t">Pick up where you left off</div><div class="role-s">Your ${esc(resume.role.t.toLowerCase())} answers are saved.</div></div>
          <div class="role-chev">${icon('chevron', 18)}</div>
        </div>
        <div class="role-note" style="text-align:center;margin:10px 0 16px">Or start over with a different role.</div>` : ''}
        <div class="role-list">${ROLES.map(card).join('')}</div>
        <div class="role-note" style="text-align:center">Invited by a coach, trainer, or athlete? Pick your role — you’ll connect with your code in a minute.</div>
      </div>
      <div class="ob-foot">
        <div class="ob-textlink" role="button" tabindex="0" aria-label="Back to welcome" data-go="welcome">Back</div>
      </div>
    </div>`;
  },
  mount(root) {
    /* Top of the funnel. Fired once per install-session so a back-navigation to the
       role picker doesn't inflate the denominator every conversion rate divides by. */
    if (!started) { started = true; track(EVENTS.ONBOARDING_STARTED); }
    root.querySelectorAll('.role-card[data-role]').forEach((c) => c.addEventListener('click', () => {
      track(EVENTS.ONBOARDING_ROLE, { role: c.getAttribute('data-role') });
    }));
  },
};
