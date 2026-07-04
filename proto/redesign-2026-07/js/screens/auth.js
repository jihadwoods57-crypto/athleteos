import { icon } from '../icons.js';
import { logoMark } from '../components.js';

/* Welcome / auth entry. Simulated auth: both paths land where they should. */
export default {
  hideTabs: true,
  render() {
    return `
    <div class="welcome">
      <div class="logo-wrap">${logoMark(104, 'welcome')}</div>
      <div class="wordmark"><span class="on">On</span>Standard</div>
      <div class="brandline">Athlete execution platform</div>
      <div class="tagline">The coach sets the standard.<br>You prove the work.<br>The score never lies.</div>
      <div class="spacer"></div>

      <button class="btn green" data-go="role">Get Started</button>
      <div style="height:10px"></div>
      <button class="btn ghost" data-go="home">Sign In</button>
      <div class="role-note">Athlete, client, coach, or trainer — every role has its own view.<br>Parents join from an athlete's invite.</div>
      <div style="height:14px"></div>
    </div>`;
  },
};
