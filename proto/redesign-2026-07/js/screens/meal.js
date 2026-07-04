import { S, RT, tier } from '../state.js';
import { icon, checkFill } from '../icons.js';
import { backHead } from '../components.js';

function macroRow(m) {
  return `<div class="macro-row">
    <div class="macro"><div class="mv">${m.protein}g</div><div class="mk">Protein</div></div>
    <div class="macro"><div class="mv">${m.carbs}g</div><div class="mk">Carbs</div></div>
    <div class="macro"><div class="mv">${m.fat}g</div><div class="mk">Fat</div></div>
    <div class="macro"><div class="mv">${m.cals}</div><div class="mk">Calories</div></div>
  </div>`;
}

/* ---------- Analyzing interstitial (branded loading) ---------- */
export const analyzing = {
  tab: 'camera',
  hideTabs: true,
  render() {
    return `
    <div class="analyzing">
      <div class="scanbox">
        <div class="img" style="background-image:url('${S.logging.img}')"></div>
        <div class="scanline"></div>
      </div>
      <div class="phase" id="an-phase">Checking meal quality<span class="dots"></span></div>
      <div class="phase-sub" id="an-sub">Detecting foods and portions</div>
    </div>`;
  },
  mount(root) {
    const phase = root.querySelector('#an-phase');
    const sub = root.querySelector('#an-sub');
    setTimeout(() => {
      if (phase) { phase.innerHTML = 'Matching this meal to your plan<span class="dots"></span>'; sub.textContent = 'Coach Mark set protein + slow carb + vegetable'; }
    }, 1100);
    setTimeout(() => { if (location.hash === '#analyzing') location.hash = '#meal-analysis'; }, 2300);
  },
};

/* ---------- Meal Analysis (AI, pre-log) ---------- */
export const analysis = {
  tab: 'camera',
  hideTabs: true,
  render() {
    const L = S.logging;
    const already = RT.dinnerLogged;
    return `
    ${backHead(`${L.name} Analysis`, 'Check it before it counts', 'camera')}

    <div class="photo-hero" style="background-image:url('${L.img}')">
      <div class="ph-grad"></div>
      <div class="ph-meta">
        <div><div class="ph-t">${L.name}</div><div class="ph-s">Captured just now · on time</div></div>
        <div class="scorechip"><span class="v">${L.score}</span><span class="k">Meal</span></div>
      </div>
    </div>

    <div class="eyebrow">Detected</div>
    <div class="foodchips">
      ${L.foods.map(f => `<span class="foodchip"><span class="dot"></span>${f}</span>`).join('')}
    </div>

    <div class="eyebrow">What the AI sees</div>
    <section class="card" style="padding:6px 16px">
      <div class="comp-read">
        ${L.componentsRead.map(c => `
          <div class="cr">
            <div class="ci ${c.ok === true ? 'ok' : 'warn'}">${icon(c.ok === true ? 'check' : 'clock', 13)}</div>
            <span class="ck">${c.k}</span><span class="cv">${c.v}</span>
          </div>`).join('')}
      </div>
    </section>

    <div class="eyebrow">Estimated</div>
    ${macroRow(L.macros)}

    <div style="height:16px"></div>
    <div class="sidebox" style="border-color:var(--green-border)">
      <div class="req-icon g" style="width:38px;height:38px">${checkFill(20)}</div>
      <div><div class="tt">${L.planMatch.verdict}</div><div class="ts">${L.planMatch.detail}</div></div>
    </div>

    <div style="height:14px"></div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">AI Feedback</div><p>${L.ai}</p></div>
    </div>

    ${already ? '' : `<div class="score-change">${icon('arrowUp', 16)} Logging this moves your score ${S.score} → ${S.score + 6} and closes 1 of ${S.remainingCount} remaining requirements.</div>`}

    <div style="height:20px"></div>
    <div class="btn-row">
      <button class="btn ghost sm" style="flex:1" data-go="camera">${icon('camera', 17)} Retake</button>
      ${already
        ? `<button class="btn ghost sm" style="flex:1.6" data-go="home">Already logged · Back Home</button>`
        : `<button class="btn green sm" style="flex:1.6" data-act="${RT.day0 ? 'day0Meal' : 'logDinner'}" data-then="meal-confirm">${icon('check', 18)} Log ${RT.day0 ? 'Breakfast' : L.name}</button>`}
    </div>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Log Confirmation (live numbers from the actual move) ---------- */
export const confirm = {
  tab: 'camera',
  hideTabs: true,
  render() {
    const mv = RT.lastMove || { from: S.score, to: S.score, gain: 0, what: 'Log' };
    const fromTier = tier(mv.from), toTier = tier(mv.to);
    const promoted = fromTier.name !== toTier.name;
    const next = S.nextMove;
    return `
    <div class="confirm-wrap">
      <div class="big-check"><div class="core">${icon('check', 36)}</div></div>
      <div class="confirm-title">${mv.what} Logged</div>
      <div class="confirm-sub">Captured on time · Added to today's score · Coach can see it</div>

      <div class="score-move">
        <span class="from" data-anim-from>${mv.from}</span>
        <span class="arr">${icon('arrowRight', 26)}</span>
        <span class="to" data-anim-to>${mv.to}</span>
      </div>
      <div class="confirm-sub" style="margin-top:0">OnStandard Score · +${mv.gain} pts</div>
      ${promoted ? `<span class="tier-chip ${toTier.cls}" style="margin-top:14px">Tier up · ${toTier.name}</span>` : ''}

      <div style="height:22px"></div>
      ${next ? `
      <div class="sidebox" style="text-align:left">
        <div class="req-icon ${next.accent}" style="width:38px;height:38px">${icon(next.accent === 'p' ? 'moon' : 'bowl', 18)}</div>
        <div>
          <div class="tt">${next.gain ? 'One move left tonight' : 'Next up'}</div>
          <div class="ts">${next.label}${next.gain ? ` is worth <b style="color:var(--green-bright)">+${next.gain}</b>. It takes you to <b style="color:var(--green-bright)">${S.possible}</b> and keeps your ${S.streakDays}-day streak.` : '.'}</div>
        </div>
      </div>` : `
      <div class="day-done" style="width:100%; text-align:left">
        <div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
        <div><div class="tt">That's everything. You're OnStandard.</div>
        <div class="ts">All requirements in. ${S.coach.name} sees a finished day.</div></div>
      </div>`}
    </div>

    <div style="height:22px"></div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">AI Insight</div><p>${S.logging.ai}</p></div>
    </div>

    <div style="height:20px"></div>
    ${next ? `<button class="btn ${next.accent === 'p' ? 'primary' : 'green'}" style="${next.accent === 'p' ? 'background:linear-gradient(150deg, var(--purple-bright), #7e22ce); box-shadow: 0 10px 30px rgba(168,85,247,0.35)' : ''}" data-go="${next.route}">${icon(next.accent === 'p' ? 'moon' : 'camera', 19)} ${next.label}</button><div style="height:10px"></div>` : ''}
    <div class="btn-row">
      <button class="btn ghost sm" style="flex:1" data-go="home">Back Home</button>
      <button class="btn ghost sm" style="flex:1" data-go="meal-detail/dinner">View Details</button>
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

/* ---------- Meal Detail / Conversation (lunch default, dinner via sub-route) ---------- */
export const detail = {
  tab: 'home',
  render({ sub }) {
    const isDinner = sub === 'dinner' && RT.dinnerLogged;
    const M = isDinner
      ? { name: 'Dinner', loggedAt: '7:12 PM', score: S.logging.score, foods: S.logging.foods, macros: S.logging.macros, img: S.logging.img,
          planNote: S.logging.planMatch.detail, thread: [
            { who: 'ai', name: 'OnStandard AI', text: S.logging.ai },
          ] }
      : { ...S.meal, img: 'assets/meal-lunch.jpg' };
    return `
    ${backHead(M.name, `Logged ${M.loggedAt} · On time`)}

    <div class="photo-hero" style="background-image:url('${M.img}')">
      <div class="ph-grad"></div>
      <div class="ph-meta">
        <div><div class="ph-t">${M.name}</div><div class="ph-s">On time · counted toward Nutrition (50%)</div></div>
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
    ${M.thread.length ? `
    <div class="thread">
      ${M.thread.map(m => `
        <div class="msg ${m.who}">
          ${m.who !== 'athlete' ? `<div class="av">${m.who === 'coach' ? 'M' : icon('sparkle', 15)}</div>` : ''}
          <div>
            ${m.who !== 'athlete' ? `<div class="who">${m.name}</div>` : ''}
            <div class="bubble">${m.text}</div>
          </div>
        </div>`).join('')}
    </div>` : ''}
    ${isDinner ? `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin-top:10px">${S.coach.name} hasn't commented yet. He'll see this log tonight.</div>` : ''}
    <div class="composer">
      <input placeholder="Ask about this meal…" />
      <div class="send">${icon('arrowUp', 19)}</div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};
