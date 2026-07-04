import { S } from '../state.js';
import { icon } from '../icons.js';

const P = S.plan;

function tabs(active) {
  const T = [['overview','Overview'],['nutrition','Nutrition'],['schedule','Schedule'],['notes','Notes']];
  return `<div class="ptabs">${T.map(([k, l]) =>
    `<div class="pt ${k === active ? 'on' : ''}" data-go="plan/${k}">${l}</div>`).join('')}</div>`;
}

function head() {
  return `
  <div class="screen-title">Plan</div>
  <div style="display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:16px;font-weight:800">${P.title}</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:3px">${P.coachLine}</div>
    </div>
    <span class="status-pill b">${P.phase.split('·')[1].trim()}</span>
  </div>
  <div style="font-size:12px;font-weight:700;color:var(--text-3);margin-top:6px">${P.phase.split('·')[0].trim()}</div>`;
}

const overview = () => `
  <div class="eyebrow">Today's Objective</div>
  <section class="card pad" style="display:flex;gap:14px;align-items:flex-start">
    <div class="req-icon b" style="width:44px;height:44px;border-radius:14px">${icon('bolt', 21)}</div>
    <div>
      <div style="font-size:17px;font-weight:800;letter-spacing:-0.01em">${P.objectiveTitle}</div>
      <p style="font-size:14px;font-weight:600;color:var(--text-2);line-height:1.5;margin-top:6px">${P.objectiveBody}</p>
    </div>
  </section>

  <div class="eyebrow">Plan Summary</div>
  <div class="tiles2">
    <div class="tile"><div class="k">Goal</div><div class="v">${P.goal}</div></div>
    <div class="tile"><div class="k">Target weight</div><div class="v">${P.targetW}</div></div>
    <div class="tile"><div class="k">Current</div><div class="v">${P.currentW}</div></div>
    <div class="tile"><div class="k">Coach focus</div><div class="v" style="font-size:14.5px;line-height:1.3">${P.focus}</div></div>
  </div>

  <div class="eyebrow">Nutrition Structure</div>
  <section class="card pad">
    <div class="macro-row">
      <div class="macro"><div class="mv">${P.macros.protein}</div><div class="mk">Protein</div></div>
      <div class="macro"><div class="mv">${P.macros.carbs}</div><div class="mk">Carbs</div></div>
      <div class="macro"><div class="mv">${P.macros.fat}</div><div class="mk">Fat</div></div>
      <div class="macro"><div class="mv">${P.macros.water}</div><div class="mk">Water</div></div>
    </div>
    <div class="list" style="margin-top:8px">
      ${P.windows.map(w => `<div class="lrow" style="cursor:default"><div class="lm"><div class="lt">${w.k}</div></div><div class="lv">${w.v}</div></div>`).join('')}
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:4px">Structure only. Live progress lives on Home.</div>
  </section>

  <div class="eyebrow">Coach Note</div>
  <div class="coachnote">
    <div class="who"><div class="av">M</div><div><div class="nm">${S.coach.name}</div><div class="rl">${S.coach.role}</div></div></div>
    <p>“${P.coachNote}”</p>
  </div>

  <div class="eyebrow">Need clarity?</div>
  <div class="btn-row">
    <button class="btn ghost sm" style="flex:1" data-go="meal-detail">${icon('message', 17)} Ask Coach</button>
    <button class="btn primary sm" style="flex:1" data-go="plan/notes">${icon('sparkle', 17)} Ask AI</button>
  </div>
  <div style="height:10px"></div>`;

const nutrition = () => `
  <div class="eyebrow">Macro Targets</div>
  <div class="macro-row">
    <div class="macro"><div class="mv">${P.macros.protein}</div><div class="mk">Protein</div></div>
    <div class="macro"><div class="mv">${P.macros.carbs}</div><div class="mk">Carbs</div></div>
    <div class="macro"><div class="mv">${P.macros.fat}</div><div class="mk">Fat</div></div>
    <div class="macro"><div class="mv">${P.macros.cals}</div><div class="mk">Calories</div></div>
  </div>

  <div class="eyebrow">Build Your Plate</div>
  <section class="card pad" style="display:flex;gap:8px">
    ${P.plate.map(p => `<div class="tile" style="flex:1;text-align:center;padding:13px 4px"><div class="v" style="font-size:13.5px;margin-top:0">${p}</div></div>`).join('')}
  </section>

  <div class="eyebrow">Approved Swaps</div>
  <section class="card pad">
    ${P.swaps.map((s, i) => `
      <div style="padding:10px 0;${i < P.swaps.length - 1 ? 'border-bottom:1px solid var(--hairline-soft)' : ''}">
        <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3)">${s.k}</div>
        <div style="font-size:14px;font-weight:700;margin-top:5px;line-height:1.5">${s.v}</div>
      </div>`).join('')}
  </section>

  <div class="eyebrow">Hydration Rules</div>
  <div class="sidebox">
    <div class="req-icon b" style="width:38px;height:38px;color:var(--cyan);background:var(--cyan-surface)">${icon('droplet', 18)}</div>
    <div><div class="tt">${P.macros.water} daily: this week's standard</div>
    <div class="ts">Get 20 oz in before practice. Water with every meal. Finish before 9 PM so sleep stays clean.</div></div>
  </div>

  <div style="height:16px"></div>
  <button class="btn ghost sm">${icon('sparkle', 17)} Ask about this nutrition plan</button>
  <div style="height:10px"></div>`;

const schedule = () => `
  <div class="eyebrow">The rules, set by ${S.coach.name}</div>
  <section class="card" style="padding:6px 16px">
    ${P.schedule.map(r => `
      <div class="bd-row">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="req-icon ${r.accent}" style="width:40px;height:40px">${icon(r.icon, 19)}</div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:800">${r.title}</div>
            <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">${r.freq} · ${r.due}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <span class="bd-weight">${r.proof}</span>
          <span class="bd-weight" style="color:var(--${r.accent === 'g' ? 'green-bright' : r.accent === 'p' ? 'purple-bright' : r.accent === 'b' ? 'blue-bright' : 'amber-bright'})">${r.impact}</span>
        </div>
      </div>`).join('')}
  </section>
  <div style="height:6px"></div>
  <div class="sidebox">
    <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
    <div><div class="tt">Where you complete these</div><div class="ts">This tab is the rulebook. You execute from Home; every requirement above shows up there on its day.</div></div>
  </div>
  <div style="height:10px"></div>`;

const notes = () => `
  <div class="eyebrow">Plan history & updates</div>
  <div class="thread">
    ${P.notes.map(n => `
      <div class="msg ${n.who}">
        <div class="av">${n.who === 'coach' ? 'M' : icon('sparkle', 15)}</div>
        <div>
          <div class="who">${n.name} · ${n.when}</div>
          <div class="bubble">${n.text}</div>
        </div>
      </div>`).join('')}
  </div>
  <div class="composer">
    <input placeholder="Ask about the plan…" />
    <div class="send">${icon('arrowUp', 19)}</div>
  </div>
  <div style="height:10px"></div>`;

export default {
  tab: 'plan',
  render({ sub }) {
    const t = sub || 'overview';
    const body = t === 'nutrition' ? nutrition() : t === 'schedule' ? schedule() : t === 'notes' ? notes() : overview();
    return `${head()}${tabs(t)}${body}`;
  },
};
