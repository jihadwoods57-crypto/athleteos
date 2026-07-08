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

    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 18)}</div>
      <div><div class="tt">Opens Sunday</div>
      <div class="ts">The weekly check-in is worth 10 of your 100. It isn't submitted yet — the form below is a preview of Sunday's questions.</div></div>
    </div>

    <div class="eyebrow">How the week felt</div>
    <section class="card" style="padding:4px 18px 8px; opacity:0.92">
      ${W.fields.map(f => `
        <div class="rec-field">
          <div class="rec-top"><span class="rec-name">${f.k}</span><span class="rec-ends">1 → 5</span></div>
          <div class="chips5">
            ${[1,2,3,4,5].map(n => `<div class="c5">${n}</div>`).join('')}
          </div>
        </div>`).join('')}
    </section>

    ${W.readiness != null ? `
    <div class="eyebrow">Latest readiness</div>
    <section class="card pad" style="display:flex;align-items:center;gap:16px">
      <div class="scorechip" style="border-color:var(--blue-bright); box-shadow: 0 0 20px rgba(59,130,246,0.3)"><span class="v" style="color:var(--blue-bright)">${W.readiness}</span><span class="k">Recovery</span></div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:800">From your last recovery check-in</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:3px">Your weekly readiness will summarize these once the Sunday flow is wired.</div>
      </div>
    </section>` : ''}

    <div style="height:18px"></div>
    <button class="btn ghost" data-go="home">Back Home</button>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const { wireToggles } = await import('./settings.js');
    root.querySelectorAll('.chips5').forEach(g => g.setAttribute('data-toggle-group', ''));
    wireToggles(root);
  },
};
