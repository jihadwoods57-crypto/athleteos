import { S, RT } from '../state.js';
import { icon } from '../icons.js';

/* Quick-log action sheet — the FAB with no context. "Capture proof. Move your score." */
export default {
  tab: 'camera',
  hideTabs: true,
  bleed: true,
  render() {
    const openSlot = S.currentSlot; // next open meal slot by time, or null if all logged
    const mealRow = !openSlot
      ? `<div class="sheet-row" data-go="home">
          <div class="si" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 20)}</div>
          <div class="st"><div class="t">All meals logged</div><div class="s">Nutrition is in for today</div></div>
        </div>`
      : `<div class="sheet-row" data-go="camera/${openSlot}">
          <div class="si" style="background:rgba(52,211,153,0.20);color:var(--green-bright)">${icon('camera', 20)}</div>
          <div class="st"><div class="t">Log ${openSlot.charAt(0).toUpperCase() + openSlot.slice(1)}</div><div class="s">Photo proof · Nutrition 50%</div></div>
        </div>`;
    const recRow = RT.recoveryDone
      ? `<div class="sheet-row" data-go="recovery-confirm">
          <div class="si" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 20)}</div>
          <div class="st"><div class="t">Recovery done</div><div class="s">Submitted tonight</div></div>
        </div>`
      : `<div class="sheet-row" data-go="recovery">
          <div class="si" style="background:rgba(168,85,247,0.22);color:var(--purple-bright)">${icon('moon', 20)}</div>
          <div class="st"><div class="t">Recovery Check-In</div><div class="s">Before bed · 20 seconds</div></div>
        </div>`;
    return `
    <div class="sheet-scrim" data-go="home"></div>
    <div class="sheet">
      <div class="grab"></div>
      <div class="sh-title">Capture proof</div>
      <div class="sh-sub">Move your score. ${S.coach.name} sees what you log.</div>
      ${mealRow}
      <div class="sheet-row" data-go="weight">
        <div class="si" style="background:rgba(245,165,36,0.20);color:var(--amber-bright)">${icon('scale', 20)}</div>
        <div class="st"><div class="t">Log Weight</div><div class="s">${RT.weightLogged ? 'Logged late tonight · trend only' : 'Missed 9:00 AM · log late for the trend'}</div></div>
        <span class="sv" style="color:var(--text-3)">trend</span>
      </div>
      ${RT.hydrationOz >= 120
        ? `<div class="sheet-row" style="background:linear-gradient(90deg, rgba(52,211,153,0.14), transparent 85%);border-radius:16px">
            <div class="si" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 20)}</div>
            <div class="st"><div class="t">Hydration standard hit</div><div class="s">${RT.hydrationOz} oz · this week's focus, handled. Coach sees it.</div></div>
          </div>`
        : `<div class="sheet-row">
            <div class="si" style="background:var(--cyan-surface);color:var(--cyan)">${icon('droplet', 20)}</div>
            <div class="st"><div class="t">Log Water</div><div class="s">${RT.hydrationOz} of 120 oz today</div></div>
            <div class="water-btns">
              <span class="wb2" data-act="addWater:8" data-then="log">+8</span>
              <span class="wb2" data-act="addWater:16" data-then="log">+16</span>
            </div>
          </div>`}
      ${recRow}
      <div class="sheet-row" data-go="checkin">
        <div class="si" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('clipboard', 19)}</div>
        <div class="st"><div class="t">Weekly Check-In</div><div class="s">${S.weekly.status}</div></div>
      </div>
      <div class="cancel" data-go="home">Cancel</div>
    </div>`;
  },
};
