import { S, RT, tier, act, MEAL, mealDetail } from '../state.js';
import { DAY } from '../day.js';
import { icon, checkFill } from '../icons.js';
import { backHead, esc, safeImg } from '../components.js';

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
    const img = safeImg((MEAL && MEAL.photoDataUrl) || S.logging.img);
    return `
    <div class="analyzing">
      <div class="scanbox">
        <div class="img" style="background-image:url('${img}')"></div>
        <div class="scanline"></div>
      </div>
      <div class="phase" id="an-phase">Reading your meal<span class="dots"></span></div>
      <div class="phase-sub" id="an-sub">Detecting foods and portions</div>
    </div>`;
  },
  async mount(root) {
    const phase = root.querySelector('#an-phase');
    const sub = root.querySelector('#an-sub');
    setTimeout(() => { if (phase && location.hash === '#analyzing') { phase.innerHTML = 'Estimating macros<span class="dots"></span>'; if (sub) sub.textContent = 'Matching to your plan'; } }, 1000);

    if (MEAL && MEAL.photoBase64 && !MEAL.result) {
      // REAL analysis via the analyze-meal edge function.
      const r = await act.runAnalysis();
      if (location.hash !== '#analyzing') return; // navigated away
      if (r.ok) { location.hash = '#meal-analysis'; return; }
      if (phase) phase.textContent = r.error || 'Analysis failed.';
      if (sub) { sub.textContent = 'Tap to retake'; sub.style.cursor = 'pointer'; sub.onclick = () => { location.hash = '#camera'; }; }
      return;
    }
    // No photo → nothing to analyze. Send them back to capture instead of a fabricated analysis.
    if (location.hash === '#analyzing') location.hash = '#camera';
  },
};

/* ---------- Meal Analysis (AI, pre-log) ---------- */
export const analysis = {
  tab: 'camera',
  hideTabs: true,
  render() {
    const L = S.logging;
    const slot = MEAL.key || 'dinner';
    const already = !!DAY.meals[slot];
    return `
    ${backHead(`${L.name} Analysis`, 'Check it before it counts', 'camera')}

    <div class="photo-hero" style="background-image:url('${safeImg(L.img)}')">
      <div class="ph-grad"></div>
      <div class="ph-meta">
        <div><div class="ph-t">${esc(L.name)}</div><div class="ph-s">Captured just now · on time</div></div>
        <div class="scorechip"><span class="v">${L.score}</span><span class="k">Meal</span></div>
      </div>
    </div>

    <div class="eyebrow">Detected <span class="link" id="edit-foods">Edit</span></div>
    <div class="foodchips" id="foods">
      ${L.foods.map(f => `<span class="foodchip"><span class="dot"></span>${esc(f)}</span>`).join('')}
    </div>

    <div class="eyebrow">What the AI sees</div>
    <section class="card" style="padding:6px 16px">
      <div class="comp-read">
        ${L.componentsRead.map(c => `
          <div class="cr">
            <div class="ci ${c.ok === true ? 'ok' : 'warn'}">${icon(c.ok === true ? 'check' : 'clock', 13)}</div>
            <span class="ck">${esc(c.k)}</span><span class="cv">${esc(c.v)}</span>
          </div>`).join('')}
      </div>
    </section>

    <div class="eyebrow">Estimated</div>
    ${macroRow(L.macros)}

    <div style="height:16px"></div>
    <div class="sidebox" style="border-color:var(--green-border)">
      <div class="req-icon g" style="width:38px;height:38px">${checkFill(20)}</div>
      <div><div class="tt">${esc(L.planMatch.verdict)}</div><div class="ts">${esc(L.planMatch.detail)}</div></div>
    </div>

    <div style="height:14px"></div>
    <div style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:var(--r-tile);background:var(--green-surface);border:1px solid var(--green-border)">
      ${icon('shield', 15)} <span style="font-size:12.5px;font-weight:700;color:var(--green-bright)">Guardian: no conflicts with your restrictions (${RT.allergies.length ? esc(RT.allergies.join(', ')) : 'none declared'})</span>
    </div>

    <div style="height:12px"></div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">AI Feedback</div><p>${esc(L.ai)}</p></div>
    </div>

    ${already ? '' : `<div class="score-change">${icon('arrowUp', 16)} Logging this counts toward Nutrition (50%) and closes 1 of ${S.remainingCount} remaining tonight.</div>`}

    <div style="height:20px"></div>
    <div class="btn-row">
      <button class="btn ghost sm" style="flex:1" data-go="camera/${slot}">${icon('camera', 17)} Retake</button>
      ${already
        ? `<button class="btn ghost sm" style="flex:1.6" data-go="home">Already logged · Back Home</button>`
        : `<button class="btn green sm" style="flex:1.6" data-act="logMeal:${slot}" data-then="meal-confirm">${icon('check', 18)} Log ${esc(L.name)}</button>`}
    </div>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const { wireToggles } = await import('./settings.js');
    wireToggles(root);
    // Edit mode: chips become removable — real editing, not a dead button
    const btn = root.querySelector('#edit-foods');
    const box = root.querySelector('#foods');
    if (btn && box) btn.addEventListener('click', () => {
      const editing = box.classList.toggle('editing');
      btn.textContent = editing ? 'Done' : 'Edit';
      box.querySelectorAll('.foodchip').forEach(ch => {
        if (editing && !ch.querySelector('.rm')) {
          ch.insertAdjacentHTML('beforeend', '<span class="rm" style="margin-left:6px;color:var(--red);font-weight:800;cursor:pointer">✕</span>');
          ch.querySelector('.rm').addEventListener('click', (e) => { e.stopPropagation(); ch.remove(); });
        } else if (!editing) { const x = ch.querySelector('.rm'); if (x) x.remove(); }
      });
    });
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
      <div><div class="who">AI Insight</div><p>${esc(S.logging.ai)}</p></div>
    </div>

    <div style="height:20px"></div>
    ${next ? `<button class="btn ${next.accent === 'p' ? 'primary' : 'green'}" style="${next.accent === 'p' ? 'background:linear-gradient(150deg, var(--purple-bright), #7e22ce); box-shadow: 0 10px 30px rgba(168,85,247,0.35)' : ''}" data-go="${next.route}">${icon(next.accent === 'p' ? 'moon' : 'camera', 19)} ${next.label}</button><div style="height:10px"></div>` : ''}
    <div class="btn-row">
      <button class="btn ghost sm" style="flex:1" data-go="home">Back Home</button>
      <button class="btn ghost sm" style="flex:1" data-go="meal-detail/${MEAL.key || 'dinner'}">View Details</button>
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

/* ---------- Meal Detail / Conversation — per-slot, from the REAL persisted plate ---------- */
export const detail = {
  tab: 'home',
  render({ sub }) {
    const M = mealDetail(sub || MEAL.key || 'dinner');
    if (!M.logged) {
      return `
      ${backHead(M.name, 'Not logged yet', 'home')}
      <div class="state-demo">
        <div class="sd-ic">${icon('camera', 24)}</div>
        <div class="sd-t">${esc(M.name)} isn't logged yet</div>
        <div class="sd-s">Log it with a photo and its analysis — foods, macros, meal score — shows up here.</div>
      </div>
      <button class="btn green" data-go="camera/${M.slot}">${icon('camera', 18)} Log ${esc(M.name)}</button>
      <div style="height:10px"></div>`;
    }
    const heroTop = `Logged ${M.loggedAt || 'today'}${M.late ? ' · late' : ' · on time'}`;
    return `
    ${backHead(M.name, heroTop)}

    <div class="photo-hero" id="meal-hero" style="background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))">
      <img id="meal-photo" alt="" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;display:none"/>
      <div class="ph-grad"></div>
      <div class="ph-meta">
        <div><div class="ph-t">${esc(M.name)}</div><div class="ph-s">Counted toward Nutrition (50%)</div></div>
        ${M.score != null ? `<div class="scorechip"><span class="v">${M.score}</span><span class="k">Meal</span></div>` : ''}
      </div>
    </div>

    ${M.foods.length ? `
    <div class="eyebrow">Detected foods</div>
    <div class="foodchips">
      ${M.foods.map(f => `<span class="foodchip"><span class="dot"></span>${esc(f)}</span>`).join('')}
    </div>` : ''}

    <div class="eyebrow">Macros · share of today's targets</div>
    <section class="card pad">
      ${[['Protein', M.macros.protein, 190, 'g', 'g'], ['Carbs', M.macros.carbs, 260, 'g', 'b'], ['Fat', M.macros.fat, 70, 'g', 'a'], ['Calories', M.macros.cals, 2400, '', 'p']].map(([k, v, target, u, cl]) => `
        <div class="cons-row" style="margin-bottom:11px">
          <span class="k" style="width:64px">${k}</span>
          <div class="track"><div class="fillb" style="width:${Math.min(100, Math.round((v / target) * 100))}%;background:linear-gradient(90deg,${cl === 'g' ? '#16a34a,var(--green-bright)' : cl === 'b' ? 'var(--blue-deep),var(--blue-bright)' : cl === 'a' ? '#b45309,var(--amber-bright)' : '#7e22ce,var(--purple-bright)'})"></div></div>
          <span class="v" style="width:86px">${v}${u} <small style="color:var(--text-3)">/ ${target}${u}</small></span>
        </div>`).join('')}
      <div style="font-size:12px;font-weight:600;color:var(--text-3)">One meal's share of the day ${esc(S.coach.name)} set. Not a verdict, a position.</div>
    </section>

    ${M.note ? `
    <div style="height:16px"></div>
    <div class="sidebox">
      <div class="req-icon g" style="width:38px;height:38px">${checkFill(20)}</div>
      <div><div class="tt">AI note</div><div class="ts">${esc(M.note)}</div></div>
    </div>` : ''}

    <div class="eyebrow">Conversation</div>
    <div class="thread" id="meal-thread">
      <div class="msg-status">${M.mealId ? 'Loading…' : 'Comments sync once this meal is uploaded. Your coach sees the log either way.'}</div>
    </div>
    ${M.mealId ? `<div class="composer">
      <input id="meal-msg" placeholder="Message your coach about this meal…" />
      <div class="send" id="meal-send">${icon('arrowUp', 19)}</div>
    </div>` : ''}
    <div style="height:10px"></div>
    `;
  },
  async mount(root, { sub }) {
    const M = mealDetail(sub || MEAL.key || 'dinner');
    const roles = await import('../roles.js');
    // Photo: the in-session capture, else a signed Storage URL so it survives a reload. The URL
    // is set as an img.src property (not HTML), so no injection risk; best-effort.
    const photo = root.querySelector('#meal-photo');
    if (photo && M.logged) {
      let url = M.img;
      if (!url && RT.userId) url = await roles.signedMealPhotoUrl(`${RT.userId}/${DAY.date}/${M.slot}.jpg`);
      if (url) { photo.src = url; photo.style.display = 'block'; }
    }
    if (!M.mealId) return;
    const thread = root.querySelector('#meal-thread');
    const paint = (comments) => {
      if (!thread) return;
      thread.innerHTML = comments.length
        ? comments.map(c => `
          <div class="msg ${c.role === 'athlete' ? 'athlete' : 'coach'}">
            ${c.role !== 'athlete' ? `<div class="av">${c.role === 'ai' ? icon('sparkle', 15) : 'M'}</div>` : ''}
            <div>${c.role !== 'athlete' ? `<div class="who">${c.role === 'ai' ? 'OnStandard AI' : 'Coach'}</div>` : ''}
            <div class="bubble">${esc(c.text)}</div></div>
          </div>`).join('')
        : `<div class="msg-status">No comments yet. Your coach sees this log and can reply.</div>`;
      thread.scrollTop = thread.scrollHeight;
    };
    paint(await roles.fetchMealComments(M.mealId));
    // Athlete posts a REAL comment on their own meal (role 'athlete') so the coach sees it.
    const input = root.querySelector('#meal-msg');
    const send = root.querySelector('#meal-send');
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      await roles.postMealComment(M.mealId, RT.userId, RT.userId, 'athlete', text);
      paint(await roles.fetchMealComments(M.mealId));
    };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};
