import { icon } from '../icons.js';
import { logoMark } from '../components.js';

/* Welcome / auth entry. Simulated auth: both paths land where they should.
   Styling is self-contained under `.wel` (see flows.css "Welcome (v2)") so the
   sign-in / reset screens — which still share the old .welcome/.logo-wrap/.wordmark
   rules — are untouched by this screen's premium reshape. */
export default {
  hideTabs: true,
  render() {
    return `
    <div class="wel">
      <div class="wel-hero">
        <div class="wel-logo">${logoMark(104, 'welcome')}</div>
        <div class="wel-mark"><span class="on">On</span>Standard</div>
        <div class="wel-kicker">Execution &amp; accountability platform</div>
        <h1 class="wel-head">The coach sets the standard.<br>You prove the work.<br><span class="accent">The score never lies.</span></h1>
      </div>

      <div class="wel-actions">
        <button class="btn primary wel-cta" data-go="role"><span>Get Started</span><span class="wel-arrow" aria-hidden="true">→</span></button>
        <button class="wel-signin" data-go="signin">Already have an account? <b>Sign in</b></button>
        <div class="wel-trust">${icon('lock', 13)}<span>Built for accountability</span></div>
      </div>
    </div>`;
  },
};
