import { S, RT, tier, act, MEAL, mealDetail, fmtClock } from '../state.js';
import { DAY, slotDeadline } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg, nonLiveBadge, composer } from '../components.js';
import { openingMessage, reactionGroups, threadMessages, contextForChat, applyFoodEdit, hasUserEdits } from '../meal-intel.js';

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
    const nonLive = MEAL && MEAL.live === false;
    return `
    <div class="analyzing">
      <div class="scanbox">
        <div class="img" style="background-image:url('${img}')"></div>
        <div class="scanline"></div>
      </div>
      ${nonLive ? `<div style="display:flex;justify-content:center;padding-top:10px">${nonLiveBadge()}</div>` : ''}
      <div class="phase" id="an-phase">Reading your meal<span class="dots"></span></div>
      <div class="phase-sub" id="an-sub">Detecting foods and portions</div>
    </div>`;
  },
  async mount(root) {
    analysis._editing = false; // a fresh analysis never opens in edit mode
    const phase = root.querySelector('#an-phase');
    const sub = root.querySelector('#an-sub');
    const phaseTimer = setTimeout(() => { if (phase && location.hash === '#analyzing') { phase.innerHTML = 'Estimating macros<span class="dots"></span>'; if (sub) sub.textContent = 'Matching to your plan'; } }, 1000);

    if (MEAL && MEAL.photoBase64 && !MEAL.result) {
      // REAL analysis via the analyze-meal edge function.
      const r = await act.runAnalysis();
      if (location.hash !== '#analyzing') return; // navigated away
      // THE CLARIFYING MOMENT: the model asked what the photo can't show — collect answers
      // before committing a number. A confident read goes straight to the analysis.
      if (r.ok) { location.hash = r.kind === 'questions' ? '#meal-questions' : '#meal-analysis'; return; }
      // Failure state: stop the "still scanning" animation and give a real >=44px recovery
      // button instead of a 13px gray text tap — the old sub-line was nearly invisible at the
      // exact moment the athlete's core action broke. A fast failure can land before the 1s
      // phase timer, which would overwrite this copy — cancel it.
      clearTimeout(phaseTimer);
      const sl = root.querySelector('.scanline');
      if (sl) sl.style.display = 'none';
      if (phase) phase.textContent = r.error || 'Analysis failed.';
      if (sub) { sub.textContent = 'Nothing was logged — your photo is still here.'; }
      root.querySelector('.analyzing').insertAdjacentHTML('beforeend',
        `<div style="height:18px"></div>
         <button class="btn green sm" id="an-retry" style="width:100%">${icon('camera', 18)} Retake photo</button>`);
      root.querySelector('#an-retry').addEventListener('click', () => { location.hash = '#camera'; });
      return;
    }
    // No photo → nothing to analyze. Send them back to capture instead of a fabricated analysis.
    if (location.hash === '#analyzing') location.hash = '#camera';
  },
};

/* ---------- The Clarifying Moment (Honest Vision) ----------
   The model was genuinely unsure about something that moves the macros (hidden protein,
   portion, prep), so instead of fabricating a number it asks the athlete. They answer what the
   camera can't see, we finalize, and the number they get is one they can trust. Every other app
   guesses silently; this is the honest difference. */
export const mealQuestions = {
  tab: 'camera',
  hideTabs: true,
  render() {
    const qs = (MEAL && Array.isArray(MEAL.questions)) ? MEAL.questions : [];
    // Deep-link / stale entry with nothing to ask: send them back to capture, never a blank screen.
    if (!qs.length) { if (location.hash === '#meal-questions') location.hash = '#camera'; return ''; }
    const img = safeImg((MEAL && MEAL.photoDataUrl) || S.logging.img);
    return `
    ${backHead('Two quick things', "So your numbers are exact", 'camera')}
    ${img ? `<div class="mq-photo" style="background-image:url('${img}')"><div class="mq-grad"></div>
      <div class="mq-badge">${icon('sparkle', 13)} The camera can't see everything</div></div>` : ''}
    <div class="mq-lead">A photo can't show what's hidden under or off the plate. Answer these and your read is dead on.</div>
    <div class="mq-list">
      ${qs.map((q, i) => `
        <label class="mq-item">
          <div class="mq-q"><span class="mq-n">${i + 1}</span><span>${esc(q)}</span></div>
          <input class="mq-input" data-qi="${i}" type="text" autocomplete="off" enterkeyhint="${i === qs.length - 1 ? 'done' : 'next'}"
            placeholder="Your answer" aria-label="${esc(q)}" />
        </label>`).join('')}
    </div>
    <div class="mq-actions">
      <button class="btn green" id="mq-go">${icon('check', 18)} Get my result</button>
      <button class="mq-skip" id="mq-skip">Skip, just estimate</button>
    </div>
    <div class="mq-note">${icon('lock', 12)} Your answers only sharpen this meal's numbers. Nothing else changes.</div>`;
  },
  mount(root) {
    const inputs = () => Array.from(root.querySelectorAll('.mq-input'));
    const answers = () => {
      const a = [];
      inputs().forEach((el) => { a[+el.dataset.qi] = el.value; });
      return a;
    };
    let busy = false;
    const finish = async (ans) => {
      if (busy) return;
      busy = true;
      const go = root.querySelector('#mq-go');
      const skip = root.querySelector('#mq-skip');
      if (go) { go.disabled = true; go.innerHTML = `${icon('sparkle', 18)} Reading your meal...`; }
      if (skip) skip.style.pointerEvents = 'none';
      const r = await act.finalizeAnalysis(ans);
      if (location.hash !== '#meal-questions') return; // navigated away mid-call
      if (r.ok) { location.hash = '#meal-analysis'; return; }
      // Failure: restore the controls and surface an honest, tappable recovery.
      busy = false;
      if (go) { go.disabled = false; go.innerHTML = `${icon('check', 18)} Get my result`; }
      if (skip) skip.style.pointerEvents = '';
      let err = root.querySelector('#mq-err');
      if (!err) {
        root.querySelector('.mq-actions').insertAdjacentHTML('afterend',
          `<div id="mq-err" class="mq-err">${icon('x', 14)} <span></span></div>`);
        err = root.querySelector('#mq-err');
      }
      err.querySelector('span').textContent = r.error || 'Analysis failed. Try again.';
    };
    root.querySelector('#mq-go').addEventListener('click', () => finish(answers()));
    root.querySelector('#mq-skip').addEventListener('click', () => finish([]));
    // Enter on the last field submits; Enter elsewhere advances to the next field.
    inputs().forEach((el, i, arr) => el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (i < arr.length - 1) arr[i + 1].focus(); else finish(answers());
    }));
  },
};

/* ---------- Meal Analysis (AI, pre-log) ----------
   Founder structure (2026-07-15), each fact exactly once:
     photo (with timing vs the slot deadline) → editable breakdown (what + how much) →
     estimated macros → ONE detailed AI analysis → log.
   The old page rendered the AI note three times (planMatch + AI Feedback + thread opener) and
   macros/foods twice (componentsRead + chips/macroRow) — all of that is consolidated here. */

/** "Captured 1:42 PM · 18 min before the 2:00 PM deadline" — real clock math, never canned. */
function captureTimingLine(capturedAtMin, slot) {
  if (capturedAtMin == null) return null;
  const dl = slotDeadline(slot);
  const when = fmtClock(capturedAtMin);
  if (capturedAtMin > dl) return `Captured ${when} · ${capturedAtMin - dl} min past the ${fmtClock(dl)} deadline`;
  return `Captured ${when} · ${dl - capturedAtMin} min before the ${fmtClock(dl)} deadline`;
}

export const analysis = {
  tab: 'camera',
  hideTabs: true,
  render() {
    const L = S.logging;
    const slot = MEAL.key || 'dinner';
    const already = !!DAY.meals[slot];
    const nonLive = MEAL.live === false;
    const timingLine = captureTimingLine(L.capturedAtMin, slot);
    const rich = (MEAL.result && Array.isArray(MEAL.result.detectedRich) && MEAL.result.detectedRich.length)
      ? MEAL.result.detectedRich
      : L.foods.map((f) => ({ name: f, confidence: 'high' }));
    const edited = hasUserEdits(MEAL.result);
    // Source-honest labels (WS7): a typed nutrition label is EXACT, never "estimated from photo".
    const src = MEAL.source;
    const srcLabel = edited ? 'edited by you'
      : src === 'label' ? 'exact, from the nutrition label'
      : src === 'manual' ? 'entered by you'
      : 'estimated from photo';
    return `
    ${backHead(`${L.name} Analysis`, 'Check it before it counts', 'camera')}

    <div class="photo-hero" style="${safeImg(L.img) ? `background-image:url('${safeImg(L.img)}')` : 'background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))'}">
      <div class="ph-grad"></div>
      <div class="ph-meta">
        <div><div class="ph-t">${esc(L.name)}</div><div class="ph-s">${esc(timingLine || (nonLive ? 'From your gallery' : 'Captured just now'))}</div>${nonLive ? `<div style="margin-top:6px">${nonLiveBadge()}</div>` : ''}</div>
        ${L.score != null ? `<div class="scorechip"><span class="v">${L.score}</span><span class="k">Meal</span></div>` : ''}
      </div>
    </div>

    <div class="eyebrow">Breakdown <span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0">· ${srcLabel}</span> <span class="link" id="edit-foods">${'Edit'}</span></div>
    <section class="card" style="padding:4px 16px" id="foods">
      ${rich.map((d) => `
        <div class="food-row" data-name="${esc(d.name)}">
          <span class="conf-dot ${esc(d.confidence)}"></span>
          <span class="fr-name">${esc(d.name)}${d.confidence === 'low' ? '<span class="q" title="AI is unsure — confirm or remove">?</span>' : ''}</span>
          <span class="fr-qty">${d.quantity ? esc(d.quantity) : ''}</span>
        </div>`).join('')}
      <div class="food-row fr-add" id="food-add" style="display:none">
        <span class="conf-dot high"></span>
        <input class="fr-in name" id="add-name" placeholder="Add item (e.g. 2 eggs off-frame)" aria-label="Food name" />
        <input class="fr-in qty" id="add-qty" placeholder="Qty" aria-label="Quantity" />
        <button class="fr-ok" id="add-ok" aria-label="Add">${icon('check', 15)}</button>
      </div>
      ${edited ? `<div style="font-size:11px;font-weight:600;color:var(--text-3);padding:4px 0 8px">Edited by you — macros stay the AI's estimate.</div>` : ''}
    </section>

    <div class="eyebrow">Estimated</div>
    ${macroRow(L.macros)}

    <div style="height:14px"></div>
    <div style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:var(--r-tile);background:var(--green-surface);border:1px solid var(--green-border)">
      ${icon('shield', 15)} <span style="font-size:12.5px;font-weight:700;color:var(--green-bright)">Guardian: no conflicts with your restrictions (${RT.allergies.length ? esc(RT.allergies.join(', ')) : 'none declared'})</span>
    </div>

    <div style="height:12px"></div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">AI Analysis</div><p>${esc(L.analysis || L.ai)}</p></div>
    </div>

    ${already ? '' : `<div class="score-change">${icon('arrowUp', 16)} Logging this counts toward Nutrition (50%) and closes 1 of ${S.remainingCount} remaining tonight.</div>`}

    <div style="height:20px"></div>
    <div class="btn-row">
      ${src === 'manual' ? `<button class="btn ghost sm" style="flex:1" data-go="food-search">${icon('search', 17)} Edit plate</button>`
        : src === 'label' ? `<button class="btn ghost sm" style="flex:1" data-go="label-scan">${icon('barcode', 17)} Edit label</button>`
        : `<button class="btn ghost sm" style="flex:1" data-go="camera/${slot}">${icon('camera', 17)} Retake</button>`}
      ${already
        ? `<button class="btn ghost sm" style="flex:1.6" data-go="home">Already logged · Back Home</button>`
        : `<button class="btn green sm" style="flex:1.6" data-act="logMeal:${slot}" data-then="meal-thread/${slot}">${icon('check', 18)} Log ${esc(L.name)}</button>`}
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    // Edit mode (real editing, not a dead button): remove / rename / set quantity / add.
    // Every mutation goes through applyFoodEdit so MEAL.result.detectedRich and .detected stay
    // in lockstep — act.logMeal reads the arrays, not the DOM. Macros are deliberately never
    // re-estimated; the "edited by you" hint keeps that honest. Repaint via __render so the
    // rendered rows always mirror the arrays (no hand-synced DOM state).
    const btn = root.querySelector('#edit-foods');
    const box = root.querySelector('#foods');
    if (!btn || !box) return;
    const editing = analysis._editing;
    if (editing) {
      btn.textContent = 'Done';
      box.classList.add('editing');
      const addRow = root.querySelector('#food-add');
      if (addRow) addRow.style.display = 'flex';
      // Per-row edit affordances: name/qty become inputs, ✕ removes.
      box.querySelectorAll('.food-row:not(.fr-add)').forEach((row) => {
        const name = row.getAttribute('data-name');
        const nameEl = row.querySelector('.fr-name');
        const qtyEl = row.querySelector('.fr-qty');
        const item = MEAL.result && (MEAL.result.detectedRich || []).find((d) => d && d.name === name);
        row.insertAdjacentHTML('beforeend', '<span class="rm" role="button" aria-label="Remove" style="margin-left:8px;color:var(--red);font-weight:800;cursor:pointer">✕</span>');
        row.querySelector('.rm').addEventListener('click', (e) => {
          e.stopPropagation();
          if (applyFoodEdit(MEAL.result, { kind: 'remove', name })) { analysis._editing = true; window.__render(); }
        });
        if (nameEl) {
          nameEl.innerHTML = `<input class="fr-in name" value="${esc(name)}" aria-label="Food name" />`;
          nameEl.querySelector('input').addEventListener('change', (e) => {
            applyFoodEdit(MEAL.result, { kind: 'rename', name, newName: e.target.value });
            analysis._editing = true; window.__render();
          });
        }
        if (qtyEl) {
          qtyEl.innerHTML = `<input class="fr-in qty" value="${esc((item && item.quantity) || '')}" placeholder="Qty" aria-label="Quantity" />`;
          qtyEl.querySelector('input').addEventListener('change', (e) => {
            applyFoodEdit(MEAL.result, { kind: 'quantity', name, quantity: e.target.value });
            analysis._editing = true; window.__render();
          });
        }
      });
      const addOk = root.querySelector('#add-ok');
      if (addOk) addOk.addEventListener('click', () => {
        const n = root.querySelector('#add-name'), q = root.querySelector('#add-qty');
        if (applyFoodEdit(MEAL.result, { kind: 'add', name: n && n.value, quantity: q && q.value })) {
          analysis._editing = true; window.__render();
        }
      });
    }
    btn.addEventListener('click', () => { analysis._editing = !analysis._editing; window.__render(); });
  },
};
analysis._editing = false;

/* ---------- Meal Thread — the ONE post-log surface (execution summary + honest
   breakdown + team discussion + next action). Post-log data is immutable: this page
   only renders; food editing stays in the pre-log analysis screen. Numbers come from
   S.exec / RT.lastMove / mealDetail — nothing here recomputes score math. ---------- */
export const thread = {
  tab: 'home',
  render({ sub }) {
    const slot = sub || MEAL.key || 'dinner';
    const M = mealDetail(slot);
    const e = S.exec;

    if (!M.logged) {
      return `
      ${backHead(M.name, 'Not logged yet', 'home')}
      <div class="state-demo">
        <div class="sd-ic">${icon('camera', 24)}</div>
        <div class="sd-t">${esc(M.name)} isn't logged yet</div>
        <div class="sd-s">Log it with a photo and its full breakdown — foods, macros, your team's take — lives here.</div>
      </div>
      <button class="btn green" data-go="camera/${M.slot}">${icon('camera', 18)} Log ${esc(M.name)}</button>
      <div style="height:10px"></div>`;
    }

    // ---- 1. LOGGED CONFIRMATION (celebrates the act of logging; never shames) ----
    // Timing appears here ONCE — "Logged 1:47 PM · 42 min late" — and nowhere else on the page.
    const justLogged = RT.lastMove && !RT.lastMove._played && (RT.lastMove.what || '').toLowerCase() === M.slot;
    const dupFlagged = M.flagged === 'dup';
    const timing = M.loggedAt
      ? `Logged ${M.loggedAt} · ${M.minutesLate > 0 ? `${M.minutesLate} min late` : 'on time'}`
      : (M.late ? 'Logged late · still counts' : 'Logged on time');
    const toTier = justLogged ? tier(RT.lastMove.to) : null;
    const scoreStatus = dupFlagged ? "Duplicate photo — doesn't count" : 'Counted toward Nutrition (50%)';
    const execTop = `
    <section class="mt-exec">
      <div class="bigcheck">${icon('check', 26)}</div>
      <div class="t">Logged.</div>
      <div class="s">${timing} · ${scoreStatus} · Coach can see it</div>
      ${justLogged && !dupFlagged ? `
      <div class="mt-move"><span class="from" data-anim-from>${RT.lastMove.from}</span><span style="color:var(--text-3)">${icon('arrowRight', 20)}</span><span class="to" data-anim-to>${RT.lastMove.to}</span></div>
      <div class="s">OnStandard Score · +${RT.lastMove.gain} pts</div>
      ${toTier.name !== tier(RT.lastMove.from).name ? `<span class="tier-chip ${toTier.cls}">▲ ${esc(toTier.name)}</span>` : ''}` : ''}
      <div style="height:12px"></div>
      <div class="xsegs">${Array.from({ length: e.total }, (_, i) => `<i class="${i < e.met ? 'on' : ''}"></i>`).join('')}</div>
      <div class="s" style="margin-top:6px">${e.met} of ${e.total} in today${S.streakDays > 0 ? ` · ${S.streakDays} day streak` : ''}</div>
    </section>`;

    // ---- 2. PHOTO (provenance badges live here; name/timing are NOT repeated) ----
    const photoBlock = `
    <div class="photo-hero" id="meal-hero" style="margin-top:14px;background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))">
      <img id="meal-photo" alt="" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;display:none"/>
      <div class="ph-grad"></div>
      <div class="ph-meta"><div>${M.live === false ? `<div>${nonLiveBadge()}</div>` : '<div></div>'}</div>
      ${M.score != null ? `<div class="scorechip"><span class="v">${M.score}</span><span class="k">Meal</span></div>` : ''}</div>
    </div>
    ${dupFlagged ? `<div style="font-size:11px;font-weight:600;color:var(--amber-bright);margin-top:6px">This exact photo was already logged once — this meal is recorded but doesn't count. Your coach can see the flag.</div>` : ''}`;

    // ---- 3. MEAL BREAKDOWN (one card: foods+quantities line + macro bars; nothing repeated) ----
    const T = S.planTargets || {};
    const bars = [
      ['Protein', M.macros.protein, T.protein, 'g'],
      ['Carbs', M.macros.carbs, null, 'g'],
      ['Fat', M.macros.fat, null, 'g'],
      ['Fiber', M.fiber, null, 'g'],
      ['Calories', M.macros.cals, T.calories, ''],
    ];
    const foodsLine = M.detectedRich
      .map((d) => `${d.name}${d.quantity ? ` (${d.quantity})` : ''}`).join(' · ');
    const breakdown = `
    <div class="eyebrow" style="margin-top:16px">Meal Breakdown <span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0">· ${M.source === 'label' ? 'exact, from the nutrition label' : M.source === 'manual' ? 'entered by you' : 'estimated from photo'}</span></div>
    <section class="card pad" style="margin-top:8px">
      ${foodsLine ? `<div style="font-size:13px;font-weight:700;color:var(--text-2);margin-bottom:12px">${esc(foodsLine)}</div>` : ''}
      ${bars.map(([k, v, target, u]) => `
        <div class="cons-row" style="margin-bottom:10px">
          <span class="k" style="width:64px">${k}</span>
          <div class="track"><div class="fillb" style="width:${target ? Math.min(100, Math.round((v / target) * 100)) : Math.min(100, Math.round((v / (k === 'Calories' ? 900 : 60)) * 100))}%;background:linear-gradient(90deg,#16a34a,var(--green-bright))"></div></div>
          <span class="v" style="width:96px">${v}${u}${target ? ` <small style="color:var(--text-3)">/ ${esc(String(target))}${u} day</small>` : ''}</span>
        </div>`).join('')}
      ${T.protein ? '' : `<div style="font-size:12px;font-weight:600;color:var(--text-3)">No coach targets set yet — these are this meal's estimated totals.</div>`}
    </section>`;

    // ---- 4. GROUPCHAT — the SINGLE AI-insight surface (opening message is DERIVED, never
    // stored; it now carries the timing accountability + the detailed analysis + highlights,
    // which used to leak into separate cards above). Coach + athlete both see and respond. ----
    const discussion = `
    <div class="eyebrow" style="margin-top:18px">Team Discussion</div>
    <div class="rx-strip" id="rx-strip"></div>
    <div class="thread" id="meal-thread">
      <div class="msg ai">
        <div class="av">${icon('sparkle', 15)}</div>
        <div><div class="who">OnStandard AI</div>
        <div class="bubble">${esc(openingMessage({
          name: M.name, quality: M.score, note: M.note, analysis: M.analysis,
          highlights: M.highlights, goal: RT.profile && RT.profile.baseGoal,
          coachTargets: S.planTargets, late: M.late, minutesLate: M.minutesLate,
        }))}</div></div>
      </div>
      <div class="msg-status" id="thread-status">${M.mealId ? 'Loading the thread…' : 'Syncs when connected — your coach sees this log either way.'}</div>
    </div>
    ${M.mealId ? `
    ${composer({ inputId: 'meal-msg', sendId: 'meal-send', placeholder: 'Ask about this meal…', sendLabel: 'Send' })}
    <div id="chat-note" style="min-height:18px"></div>` : ''}`;

    // ---- 4. NEXT ACTION (the exec engine's NOW) ----
    const n = e.now;
    const next = e.celebration ? `
    <div class="day-done" style="margin-top:16px">
      <div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
      <div><div class="tt">That's everything. You're OnStandard at ${e.score}.</div>
      <div class="ts">All requirements in. Day ${S.streakDays} locks at midnight.</div></div>
    </div>` : n ? `
    <div class="eyebrow" style="margin-top:16px">Next Action</div>
    <div class="xrow-item" data-go="${n.route}">
      <div class="xico sm ${n.color}">${icon(n.icon, 17)}</div>
      <div class="xr"><div class="xa">${esc(n.title)}</div><div class="xb">${n.countdown ? `⏱ ${esc(n.countdown)} · ` : ''}${esc(n.dueLabel)} · ${e.score} → ${e.possible}</div></div>
      <span class="xpill ${n.color}">${n.pill}</span>
    </div>` : '';

    return `${backHead(M.name, dupFlagged ? 'Duplicate photo' : (M.late ? 'Late · still counts' : 'On time'), 'home')}${execTop}${photoBlock}${breakdown}${discussion}${next}
    <div style="height:12px"></div>
    <div class="btn-row"><button class="btn ghost sm" style="flex:1" data-go="home">Back Home</button></div>
    <div style="height:10px"></div>`;
  },

  async mount(root, { sub }) {
    const slot = sub || MEAL.key || 'dinner';
    const M = mealDetail(slot);
    // score count-up plays once per log
    const to = root.querySelector('[data-anim-to]');
    if (to) {
      const target = +to.textContent; const from = +root.querySelector('[data-anim-from]').textContent; const t0 = performance.now();
      const step = (t) => { const p = Math.min(1, (t - t0) / 900); to.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
      // in-memory played flag only; worst case the count-up replays once after a reload — acceptable
      if (RT.lastMove) RT.lastMove._played = true;
    }
    if (!M.logged) return;
    const roles = await import('../roles.js');
    // Photo: the in-session capture, else a signed Storage URL so it survives a reload. The URL
    // is set as an img.src property (not HTML), so no injection risk; best-effort.
    const photo = root.querySelector('#meal-photo');
    if (photo) {
      let url = M.img;
      if (!url && RT.userId) url = await roles.signedMealPhotoUrl(`${RT.userId}/${DAY.date}/${M.slot}.jpg`);
      if (url) { photo.src = url; photo.style.display = 'block'; }
    }
    if (!M.mealId) return;

    const threadEl = root.querySelector('#meal-thread');
    const strip = root.querySelector('#rx-strip');
    const statusEl = root.querySelector('#thread-status');
    let threadBusy = false;
    // Rewrites #thread-status in place into an honest failure block + Retry. Reuses statusEl so
    // the existing success-path statusEl.remove() still cleans it up once a load succeeds.
    const showThreadError = () => {
      if (!statusEl) return;
      statusEl.style.cssText = 'align-self:stretch;text-align:center;padding:14px 12px;border-radius:var(--r-tile);background:var(--surface-1);border:1px solid var(--hairline);margin-top:2px';
      statusEl.innerHTML = `<div style="font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.4">Couldn't load the discussion — your log is safe, coach can still see it.</div>
        <button class="btn ghost sm" id="thread-retry" style="margin-top:10px">${icon('wifiOff', 15)} Retry</button>`;
      const retryBtn = statusEl.querySelector('#thread-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => {
        if (threadBusy) return;
        threadBusy = true;
        refresh().finally(() => { threadBusy = false; });
      });
    };
    let gen = 0; // stale-response guard: only the newest refresh paints
    let comments = [];

    const paint = () => {
      if (!threadEl) return;
      const msgs = threadMessages(comments);
      // The FIRST `.msg` in threadEl is assumed to be the derived AI opening message (rendered
      // once, above, and never stored) — it's captured here and re-prepended on every repaint.
      // Do not prepend/insert any other row above it, or the opening line stops being first.
      const openingHtml = threadEl.querySelector('.msg') ? threadEl.querySelector('.msg').outerHTML : '';
      threadEl.innerHTML = openingHtml + (msgs.length ? msgs.map((c) => `
        <div class="msg ${c.role === 'athlete' ? 'athlete' : 'coach'}">
          ${c.role !== 'athlete' ? `<div class="av">${c.role === 'ai' ? icon('sparkle', 15) : 'M'}</div>` : ''}
          <div>${c.role !== 'athlete' ? `<div class="who">${c.role === 'ai' ? 'OnStandard AI' : 'Coach'}</div>` : ''}
          <div class="bubble">${esc(c.text)}</div></div>
        </div>`).join('') : `<div class="msg-status">No replies yet. Ask a question — your AI coach answers from YOUR plan.</div>`);
      if (strip) strip.innerHTML = reactionGroups(comments).map((r) => `<span class="rx">${esc(r.emoji)}<span class="n">${r.count}</span></span>`).join('');
      threadEl.scrollTop = threadEl.scrollHeight;
    };
    const refresh = async () => {
      const myGen = ++gen;
      const fetched = await roles.fetchMealComments(M.mealId);
      if (myGen !== gen) return;
      if (fetched && fetched.error) { showThreadError(); return; }
      comments = fetched; if (statusEl) statusEl.remove(); paint();
    };
    await refresh();

    // Composer: post athlete message → invoke meal-chat with client-composed context.
    // On success the AI reply row is already persisted server-side, so a REFETCH shows
    // it — never append data.reply manually AND refetch.
    const input = root.querySelector('#meal-msg');
    const send = root.querySelector('#meal-send');
    const note = root.querySelector('#chat-note');
    const setNote = (t, retry) => { if (note) note.innerHTML = t ? `<div class="mt-retry" ${retry ? 'id="chat-retry"' : ''}>${esc(t)}</div>` : ''; };
    let busy = false;
    // Reaches the AI for an ALREADY-POSTED question. Retry re-runs only this — the athlete's
    // comment lands in meal_comments exactly once per question, never duplicated by a retry.
    const askAI = async (text) => {
      try {
        const recent = await roles.fetchRecentMeals(RT.userId, roles.daysAgoISO(7)).catch(() => []);
        const ex = S.exec;
        // roles.fetchRecentMeals returns newest-first (day_date descending); contextForChat's
        // 8KB clamp drops from the FRONT of recentMeals, so the caller must hand it oldest→newest
        // or the clamp discards the newest meals instead of the oldest. Reverse to ascending here.
        const recentAscending = (recent || []).slice().reverse();
        const context = contextForChat({
          meal: { name: M.name, slot: M.slot, foods: M.detectedRich, macros: M.macros, fiber: M.fiber, quality: M.score, late: M.late, note: M.note },
          plan: { goal: RT.profile && RT.profile.baseGoal, targets: S.planTargets, allergies: RT.allergies },
          exec: { met: ex.met, total: ex.total, score: ex.score, possible: ex.possible, next: ex.now && ex.now.title },
          recentMeals: recentAscending.map((m) => ({ type: m.type, protein: m.protein, kcal: m.kcal, quality: m.quality, date: m.day_date })),
          thread: threadMessages(comments).slice(-20).map((c) => ({ role: c.role, text: String(c.text).slice(0, 300) })),
        });
        const { data, error } = await window.sb.functions.invoke('meal-chat', { body: { mealId: M.mealId, question: text, context } });
        if (error || !data || data.error) {
          // The vendored supabase-js (js/vendor/supabase.js) throws FunctionsHttpError on any
          // non-2xx response, so `data` is always null and the function's JSON error body never
          // reaches it — `data.error === 'limit'` above can never fire. FunctionsHttpError
          // extends FunctionsError, which stores the raw Response as `.context`; parse the
          // structured error off that instead. `data.error` is kept as a fallback in case a
          // future vendor version ever returns a 2xx with an inline error field.
          let parsed = data && data.error ? data : null;
          if (!parsed && error && error.context && typeof error.context.json === 'function') {
            parsed = await error.context.json().catch(() => null);
          }
          if (parsed && parsed.error === 'limit') setNote("You've hit today's AI coaching limit — back tomorrow. Your coach still sees this.");
          else setNote("Couldn't reach your AI coach — tap to try again.", true);
        } else {
          await refresh();
        }
      } catch { setNote("Couldn't reach your AI coach — tap to try again.", true); }
      // The question is already in the thread — retry only re-reaches the AI (no input refill).
      const retry = root.querySelector('#chat-retry');
      if (retry) retry.addEventListener('click', async () => {
        if (busy) return;
        busy = true; setNote('');
        await askAI(text);
        busy = false;
      });
    };
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text || busy) return;
      // Thread cap (0059, coach-ratified): 3 athlete messages per meal — the DB trigger is
      // the wall; say so up front instead of letting the send bounce.
      const mine = (Array.isArray(comments) ? comments : []).filter((c) => c.role === 'athlete' && (c.kind || 'message') === 'message').length;
      if (mine >= 3) { setNote('Thread cap: 3 messages per meal. Your coach saw them.'); return; }
      busy = true; setNote('');
      input.value = '';
      const posted = await roles.postMealComment(M.mealId, RT.userId, RT.userId, 'athlete', text);
      if (!posted) {
        // Post failed (returns false, never throws): give the text back — re-submitting IS the
        // retry — and don't reach the AI for a question that never landed.
        input.value = text;
        setNote("Couldn't send — try again.");
        busy = false;
        return;
      }
      await refresh();
      await askAI(text);
      busy = false;
    };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e2) => { if (e2.key === 'Enter') submit(); });
  },
};

// Legacy routes/imports (#meal-confirm, #meal-detail) render the same unified page.
export const confirm = thread;
export const detail = thread;
