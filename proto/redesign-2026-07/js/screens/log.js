import { S, RT } from '../state.js';
import { icon } from '../icons.js';

/* Quick-log action sheet — the FAB with no context. "Capture proof. Move your score." */
export default {
  tab: 'camera',
  hideTabs: true,
  bleed: true,
  render() {
    const dinnerRow = RT.dinnerLogged
      ? `<div class="sheet-row" data-go="meal-detail/dinner">
          <div class="si" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 20)}</div>
          <div class="st"><div class="t">Dinner logged</div><div class="s">Scored 90 · view details</div></div>
        </div>`
      : `<div class="sheet-row" data-go="camera">
          <div class="si" style="background:rgba(52,211,153,0.20);color:var(--green-bright)">${icon('camera', 20)}</div>
          <div class="st"><div class="t">Log Meal</div><div class="s">Dinner due by 8:00 PM · photo proof</div></div>
          <span class="sv" style="color:var(--green-bright)">+6</span>
        </div>`;
    const recRow = RT.recoveryDone
      ? `<div class="sheet-row" data-go="recovery-confirm">
          <div class="si" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 20)}</div>
          <div class="st"><div class="t">Recovery done</div><div class="s">Submitted tonight</div></div>
        </div>`
      : `<div class="sheet-row" data-go="recovery">
          <div class="si" style="background:rgba(168,85,247,0.22);color:var(--purple-bright)">${icon('moon', 20)}</div>
          <div class="st"><div class="t">Recovery Check-In</div><div class="s">Before bed · 20 seconds</div></div>
          <span class="sv" style="color:var(--purple-bright)">+6</span>
        </div>`;
    return `
    <div class="sheet-scrim" data-go="home"></div>
    <div class="sheet">
      <div class="grab"></div>
      <div class="sh-title">Capture proof</div>
      <div class="sh-sub">Move your score. ${S.coach.name} sees what you log.</div>
      ${dinnerRow}
      <div class="sheet-row" data-go="weight">
        <div class="si" style="background:rgba(245,165,36,0.20);color:var(--amber-bright)">${icon('scale', 20)}</div>
        <div class="st"><div class="t">Log Weight</div><div class="s">${RT.weightLogged ? 'Logged late tonight · trend only' : 'Missed 9:00 AM · log late for the trend'}</div></div>
        <span class="sv" style="color:var(--text-3)">trend</span>
      </div>
      <div class="sheet-row">
        <div class="si" style="background:var(--cyan-surface);color:var(--cyan)">${icon('droplet', 20)}</div>
        <div class="st"><div class="t">Log Water</div><div class="s">${RT.hydrationOz} of 120 oz today</div></div>
        <div class="water-btns">
          <span class="wb2" data-act="addWater:8" data-then="log">+8</span>
          <span class="wb2" data-act="addWater:16" data-then="log">+16</span>
        </div>
      </div>
      ${recRow}
      <div class="sheet-row" data-go="checkin">
        <div class="si" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('clipboard', 19)}</div>
        <div class="st"><div class="t">Weekly Check-In</div><div class="s">${S.weekly.status}</div></div>
      </div>
      <div class="cancel" data-go="home">Cancel</div>
    </div>`;
  },
};
