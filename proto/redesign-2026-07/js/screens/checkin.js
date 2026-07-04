import { S } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

/* Weekly Check-In — the 10% weekly ritual (mirrors CheckIn.tsx). Already submitted
   this week in the seeded story; the form is shown as the living design. */
export default {
  tab: 'home',
  render() {
    const W = S.weekly;
    return `
    ${backHead('Weekly Check-In', W.status)}

    <div class="sidebox" style="border-color:var(--green-border)">
      <div class="req-icon g" style="width:38px;height:38px">${icon('check', 18)}</div>
      <div><div class="tt">This week is in</div>
      <div class="ts">Submitted Sunday · counted as 10 of your 100. The form below opens again Sunday.</div></div>
    </div>

    <div class="eyebrow">How the week felt</div>
    <section class="card" style="padding:4px 18px 8px; opacity:0.92">
      ${W.fields.map(f => `
        <div class="rec-field">
          <div class="rec-top"><span class="rec-name">${f.k}</span><span class="rec-ends">1 → 5</span></div>
          <div class="chips5">
            ${[1,2,3,4,5].map(n => `<div class="c5 ${n === f.val ? 'on' : ''}" style="${n === f.val ? 'background:var(--blue-surface);border-color:var(--blue-border);color:var(--blue-bright);box-shadow:none' : ''}">${n}</div>`).join('')}
          </div>
        </div>`).join('')}
    </section>

    <div class="eyebrow">Training readiness</div>
    <section class="card pad" style="display:flex;align-items:center;gap:16px">
      <div class="scorechip" style="border-color:var(--blue-bright); box-shadow: 0 0 20px rgba(59,130,246,0.3)"><span class="v" style="color:var(--blue-bright)">${W.readiness}</span><span class="k">Ready</span></div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:800">Ready to train</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:3px">Energy and motivation strong. Watch the soreness; it tracks with your two missed recovery nights.</div>
      </div>
    </section>

    <div style="height:14px"></div>
    <div class="coachnote">
      <div class="who"><div class="av">M</div><div><div class="nm">${S.coach.name}</div><div class="rl">On last week's check-in</div></div></div>
      <p>“Best week yet. Keep breakfast consistent and clean up the hydration misses.”</p>
    </div>

    <div style="height:18px"></div>
    <button class="btn ghost" data-go="home">Back Home</button>
    <div style="height:10px"></div>
    `;
  },
};
