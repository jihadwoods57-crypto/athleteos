/* ============================================================
   OB2 role select — the fork for the adaptive onboarding.
   "How will you use OnStandard?" Six benefit-first roles; the
   entire narrative downstream (problem framing, discovery,
   demo, social proof, paywall, destination) adapts to this
   choice. Replaces the 4-card picker at route `role`; the
   legacy flows stay registered for rollback.
   ============================================================ */
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

export const ob2Role = {
  hideTabs: true,
  render() {
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
        <div class="role-list">${ROLES.map(card).join('')}</div>
        <div class="role-note" style="text-align:center">Invited by a coach, trainer, or athlete? Pick your role — you’ll connect with your code in a minute.</div>
      </div>
      <div class="ob-foot">
        <div class="ob-textlink" role="button" tabindex="0" aria-label="Back to welcome" data-go="welcome">Back</div>
      </div>
    </div>`;
  },
  mount(root) {
    root.querySelectorAll('.role-card[data-role]').forEach((c) => c.addEventListener('click', () => {
      track(EVENTS.ONBOARDING_ROLE, { role: c.getAttribute('data-role') });
    }));
  },
};
