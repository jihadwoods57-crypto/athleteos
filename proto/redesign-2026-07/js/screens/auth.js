import { icon } from '../icons.js';
import { scoreRing } from '../components.js';

/* Welcome / auth entry. Simulated auth: both paths land where they should. */
export default {
  hideTabs: true,
  render() {
    return `
    <div class="welcome">
      <div class="logo-ring">${scoreRing({ score: 94, size: 96, stroke: 9, showCenter: false, uid: 'logo' })}</div>
      <div class="wordmark"><span class="on">On</span>Standard</div>
      <div class="tagline">The coach sets the standard.<br>You prove the work.<br>The score never lies.</div>
      <div class="spacer"></div>

      <button class="btn green" data-go="onboarding/1">Get Started</button>
      <div style="height:10px"></div>
      <button class="btn ghost" data-go="home">Sign In</button>
      <div class="role-note">Coach, parent, or trainer? Your view starts from an athlete's invite.<br>Sign in above and pick your role.</div>
      <div style="height:14px"></div>
    </div>`;
  },
};
