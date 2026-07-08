import { S } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

export default {
  tab: 'profile',
  render() {
    return `
    ${backHead('Connect a Coach', 'Enter the code your coach gave you', 'profile')}

    <div style="height:14px"></div>
    <input id="cc-code" class="ob-input" placeholder="Coach code" autocapitalize="characters" autocorrect="off" spellcheck="false" style="text-align:center;letter-spacing:0.2em;font-weight:800" />
    <div style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);margin-top:10px">Ask your coach or team group chat for the code.</div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">What connecting will share</div>
      <div class="ts">Once you join a coach, they see your daily score, requirement completion, meal logs, and check-ins. Nothing is shared until you connect.</div></div>
    </div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon a" style="width:38px;height:38px">${icon('clock', 17)}</div>
      <div><div class="tt">Coming soon</div>
      <div class="ts">Team-code join is being wired to the real roster. Your Standard works solo in the meantime — nothing here is faked.</div></div>
    </div>

    <div style="height:18px"></div>
    <button class="btn ghost" data-go="profile">Back to profile</button>
    <div style="height:10px"></div>
    `;
  },
};
