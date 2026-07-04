import { S, computeScore } from '../state.js';
import { icon, checkFill } from '../icons.js';
import { backHead } from '../components.js';

const M = S.meal;

function macroRow(m) {
  return `<div class="macro-row">
    <div class="macro"><div class="mv">${m.protein}g</div><div class="mk">Protein</div></div>
    <div class="macro"><div class="mv">${m.carbs}g</div><div class="mk">Carbs</div></div>
    <div class="macro"><div class="mv">${m.fat}g</div><div class="mk">Fat</div></div>
    <div class="macro"><div class="mv">${m.cals}</div><div class="mk">Calories</div></div>
  </div>`;
}

/* ---------- Meal Analysis (AI, pre-log) ---------- */
export const analysis = {
  tab: 'camera',
  hideTabs: true,
  render() {
    return `
    ${backHead(`${S.logging.name} Analysis`, 'Check it before it counts', 'camera')}

    <div class="photo-hero" style="background-image:url('assets/meal-lunch.jpg')">
      <div class="ph-grad"></div>
      <div class="ph-meta">
        <div><div class="ph-t">${S.logging.name}</div><div class="ph-s">Captured just now · on time</div></div>
        <div class="scorechip"><span class="v">${M.score}</span><span class="k">Meal</span></div>
      </div>
    </div>

    <div class="eyebrow">Detected</div>
    <div class="foodchips">
      ${M.foods.map(f => `<span class="foodchip"><span class="dot"></span>${f}</span>`).join('')}
    </div>

    <div class="eyebrow">Estimated</div>
    ${macroRow(M.macros)}

    <div class="eyebrow">One quick check</div>
    <section class="card pad" style="display:flex;align-items:center;gap:12px">
      <div style="flex:1;font-size:14px;font-weight:700">Was the chicken grilled or fried?</div>
      <span class="status-pill g" style="cursor:pointer">Grilled</span>
      <span class="status-pill b" style="cursor:pointer;opacity:.55">Fried</span>
    </section>

    <div style="height:16px"></div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">AI Feedback</div><p>${S.logging.ai}</p></div>
    </div>

    <div style="height:20px"></div>
    <div class="btn-row">
      <button class="btn ghost sm" style="flex:1">${icon('edit', 17)} Edit</button>
      <button class="btn green sm" style="flex:1.6" data-go="meal-confirm">${icon('check', 18)} Log ${S.logging.name}</button>
    </div>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Log Confirmation ---------- */
export const confirm = {
  tab: 'camera',
  hideTabs: true,
  render() {
    const before = S.score;                                       // 82
    const after = computeScore({ ...S.components.now, nutrition: 92 }); // dinner logged → 88
    return `
    <div class="confirm-wrap">
      <div class="big-check"><div class="core">${icon('check', 36)}</div></div>
      <div class="confirm-title">${S.logging.name} Logged</div>
      <div class="confirm-sub">Captured on time · Added to today's score · Coach can see it</div>

      <div class="score-move">
        <span class="from" data-anim-from>${before}</span>
        <span class="arr">${icon('arrowRight', 26)}</span>
        <span class="to" data-anim-to>${after}</span>
      </div>
      <div class="confirm-sub" style="margin-top:0">OnStandard Score</div>

      <div style="height:22px"></div>
      <div class="sidebox" style="text-align:left">
        <div class="req-icon p" style="width:38px;height:38px">${icon('moon', 18)}</div>
        <div>
          <div class="tt">One move left tonight</div>
          <div class="ts">Recovery Check-In before bed is worth <b style="color:var(--green-bright)">+6</b>. It takes you to <b style="color:var(--green-bright)">${S.possible}</b> and keeps your ${S.streakDays}-day streak.</div>
        </div>
      </div>
    </div>

    <div style="height:22px"></div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">AI Insight</div><p>${S.logging.ai}</p></div>
    </div>

    <div style="height:20px"></div>
    <button class="btn green" data-go="recovery">${icon('moon', 19)} Do Recovery Check-In</button>
    <div style="height:10px"></div>
    <div class="btn-row">
      <button class="btn ghost sm" style="flex:1" data-go="home">Back Home</button>
      <button class="btn ghost sm" style="flex:1" data-go="meal-detail">View Details</button>
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const to = root.querySelector('[data-anim-to]');
    if (to) {
      const target = +to.textContent; const t0 = performance.now(); const from = +root.querySelector('[data-anim-from]').textContent;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / 900);
        to.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  },
};

/* ---------- Meal Detail / Conversation ---------- */
export const detail = {
  tab: 'home',
  render() {
    return `
    ${backHead('Lunch', `Logged ${M.loggedAt} · On time`)}

    <div class="photo-hero" style="background-image:url('assets/meal-lunch.jpg')">
      <div class="ph-grad"></div>
      <div class="ph-meta">
        <div><div class="ph-t">Lunch</div><div class="ph-s">On time · counted toward Nutrition (50%)</div></div>
        <div class="scorechip"><span class="v">${M.score}</span><span class="k">Meal</span></div>
      </div>
    </div>

    <div class="eyebrow">Detected foods</div>
    <div class="foodchips">
      ${M.foods.map(f => `<span class="foodchip"><span class="dot"></span>${f}</span>`).join('')}
    </div>

    <div class="eyebrow">Macros</div>
    ${macroRow(M.macros)}

    <div style="height:16px"></div>
    <div class="sidebox">
      <div class="req-icon g" style="width:38px;height:38px">${checkFill(20)}</div>
      <div><div class="tt">Plan check</div><div class="ts">${M.planNote}</div></div>
    </div>

    <div class="eyebrow">Conversation</div>
    <div class="thread">
      ${M.thread.map(m => `
        <div class="msg ${m.who}">
          ${m.who !== 'athlete' ? `<div class="av">${m.who === 'coach' ? 'M' : icon('sparkle', 15)}</div>` : ''}
          <div>
            ${m.who !== 'athlete' ? `<div class="who">${m.name}</div>` : ''}
            <div class="bubble">${m.text}</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="composer">
      <input placeholder="Ask about this meal…" />
      <div class="send">${icon('arrowUp', 19)}</div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};
