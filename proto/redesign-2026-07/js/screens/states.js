import { icon } from '../icons.js';
import { backHead } from '../components.js';

/* Design-states gallery: every empty / loading / error / tier state in one place,
   so nothing ships as an afterthought. */
export default {
  hideTabs: true,
  render() {
    return `
    ${backHead('Design States', 'Empty · loading · error · tiers, all specified', 'profile')}

    <div class="eyebrow">Score tiers</div>
    <section class="card pad" style="display:flex;flex-wrap:wrap;gap:10px">
      <span class="tier-chip r" style="margin:0">Off Standard · 0–59</span>
      <span class="tier-chip a" style="margin:0">Building · 60–74</span>
      <span class="tier-chip b" style="margin:0">Locked In · 75–89</span>
      <span class="tier-chip g" style="margin:0">OnStandard · 90–100</span>
    </section>

    <div class="eyebrow">Empty states</div>
    <div class="state-demo">
      <div class="sd-ic">${icon('camera', 24)}</div>
      <div class="sd-t">No meals logged yet</div>
      <div class="sd-s">Your score starts moving once you log your first meal. Take a photo to begin today's standard.</div>
      <div class="sd-cta"><button class="btn green sm" style="width:auto;padding:0 22px" data-go="camera">Log First Meal</button></div>
    </div>
    <div class="state-demo">
      <div class="sd-ic">${icon('key', 22)}</div>
      <div class="sd-t">No coach connected</div>
      <div class="sd-s">Your work counts more when someone you respect can see it. Enter a coach code to join a group.</div>
      <div class="sd-cta"><button class="btn ghost sm" style="width:auto;padding:0 22px" data-go="connect">Enter Coach Code</button></div>
    </div>
    <div class="state-demo">
      <div class="sd-ic">${icon('bars', 22)}</div>
      <div class="sd-t">Progress builds as you log</div>
      <div class="sd-s">After your first few days, trends, streaks, and patterns show up here.</div>
    </div>

    <div class="eyebrow">Loading states · branded, never a bare spinner</div>
    <section class="card pad">
      ${['Checking meal quality', 'Matching this meal to your plan', 'Updating your score', 'Syncing coach plan'].map(t => `
        <div style="display:flex;align-items:center;gap:12px;padding:9px 0">
          <div class="scanbox" style="width:26px;height:26px;border-radius:8px;flex:none"><div class="scanline" style="height:2px"></div></div>
          <span style="font-size:14px;font-weight:700">${t}<span class="dots"></span></span>
        </div>`).join('')}
    </section>

    <div class="eyebrow">Error states · what happened + what to do</div>
    <div class="state-demo err-box">
      <div class="sd-ic">${icon('camera', 22)}</div>
      <div class="sd-t">Your meal photo didn't upload</div>
      <div class="sd-s">Check your connection and try again. The photo is saved on your phone; nothing is lost.</div>
      <div class="sd-cta"><button class="btn ghost sm" style="width:auto;padding:0 22px" data-go="camera">Try Again</button></div>
    </div>
    <div class="state-demo err-box">
      <div class="sd-ic">${icon('bolt', 22)}</div>
      <div class="sd-t">AI couldn't read this one</div>
      <div class="sd-s">Log it manually with Search Food, or retake with better light. Your on-time credit still counts from the capture.</div>
    </div>
    <div class="state-demo">
      <div class="sd-ic">${icon('shield', 22)}</div>
      <div class="sd-t">Offline · saved on device</div>
      <div class="sd-s">Coach will see this when you're back online. Keep logging; nothing waits on the network.</div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};
