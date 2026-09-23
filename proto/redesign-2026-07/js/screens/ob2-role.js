/* ============================================================
   OB2 role select — the fork for the adaptive onboarding.
   "How will you use OnStandard?" Seven benefit-first roles; the
   entire narrative downstream (problem framing, discovery,
   demo, social proof, paywall, destination) adapts to this
   choice. Replaces the 4-card picker at route `role`; the
   legacy flows stay registered for rollback.
   ============================================================ */
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { esc } from '../components.js';
import { track, EVENTS } from '../analytics.js';

/* Every door wears the same blue tile (2026-09-22); the GLYPH tells them apart. The tiles used to
   be green (client, dietitian), purple (trainer) and cyan (nutrition pro): status hues doing an
   identity job, the same mistake the 2026-08-25 pass fixed for amber (coach) and red (parent).
   Subtitles are one line each so all seven doors fit on a 390x844 screen. */
const ROLES = [
  { go: 'oba/why', key: 'athlete', ic: 'bolt', t: 'Athlete', s: 'Prove your work, every day.' },
  { go: 'obf/why', key: 'client', ic: 'user', t: 'Fitness Client', s: 'Stay on track between sessions.' },
  { go: 'obk/why', key: 'coach', ic: 'users', t: 'Coach', s: 'Set the standard. See who meets it.' },
  { go: 'obt/why', key: 'trainer', ic: 'bars', t: 'Trainer', s: 'Keep clients accountable all week.' },
  { go: 'obp/why', key: 'parent', ic: 'heart', t: 'Parent', s: 'Support them without hovering.' },
  /* Two nutrition entries on purpose (2026-08-18): a college RD covering a roster and a
     private-practice pro run different books. The subtitles carry the fork, and each has its
     own glyph (2026-08-19): the bowl for the roster door, the stethoscope for private practice. */
  { go: 'obd/why', key: 'dietitian', ic: 'bowl', t: 'Team Dietitian / RD', s: 'Fuel a whole roster, any sport.' },
  { go: 'obn/why', key: 'nutritionist', ic: 'stethoscope', t: 'Nutrition Professional', s: 'Your own practice and clients.' },
];

/* Resume crumb written by the OB2 engine on every step view. Only offered while the
   person is still signed out — once the account exists the flow is finished or the
   app itself is the right destination. Route must match a known flow or it's ignored. */
const ROUTE_ROLE = { oba: 'athlete', obf: 'client', obk: 'coach', obt: 'trainer', obp: 'parent', obn: 'nutritionist', obd: 'dietitian' };
let started = false;
function resumeTarget() {
  if (RT.userId) return null;
  const raw = String(((RT.ob || {}).obResume) || '');
  const [route, step] = raw.split('/');
  if (!route || !step || !ROUTE_ROLE[route]) return null;
  const role = ROLES.find((r) => r.key === ROUTE_ROLE[route]);
  return role ? { go: raw, role } : null;
}

/** Set by the Sign-in screen when an Apple or Google account had no OnStandard profile yet. */
function ssoNew() { try { return sessionStorage.getItem('os.sso.new'); } catch { return null; } }

export const ob2Role = {
  hideTabs: true,
  render() {
    const resume = resumeTarget();
    const card = (r) => `
      <div class="role-card" data-go="${r.go}" data-role="${r.key}" role="button" aria-label="${esc(r.t)}. ${esc(r.s)}">
        <div class="role-ic">${icon(r.ic, 20)}</div>
        <div class="role-tt"><div class="role-t">${esc(r.t)}</div><div class="role-s">${esc(r.s)}</div></div>
        <div class="role-chev">${icon('chevron', 18)}</div>
      </div>`;
    return `
    <div class="ob ob-role">
      <div class="ob-nav"><button type="button" class="ob-back" data-go="welcome" aria-label="Back">${icon('chevron', 18)}</button></div>
      <h1 class="ob-title">How will you use OnStandard?</h1>
      <div class="ob-body">
        ${resume ? `
        <div class="role-card role-resume" id="ob2-resume" data-go="${esc(resume.go)}" role="button" aria-label="Continue where you left off. ${esc(resume.role.t)}">
          <div class="role-ic">${icon('back', 20)}</div>
          <div class="role-tt"><div class="role-t">Pick up where you left off</div><div class="role-s">Your ${esc(resume.role.t.toLowerCase())} answers are saved.</div></div>
          <div class="role-chev">${icon('chevron', 18)}</div>
        </div>
        <div class="role-note role-note-gap">Or start over with a different role.</div>` : ''}
        ${ssoNew() ? `<div class="role-note role-sso" role="status">You’re new to OnStandard. Pick how you’ll use it and answer a few questions, including your age. Then continue with ${ssoNew() === 'google' ? 'Google' : 'Apple'} on the last step.</div>` : ''}
        <div class="role-list">${ROLES.map(card).join('')}</div>
        <div class="role-note">Invited by a coach, trainer, or athlete? Pick your role. You’ll connect with your code in a minute.</div>
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
