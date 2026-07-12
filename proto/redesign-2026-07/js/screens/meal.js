import { S, RT, tier, act, MEAL, mealDetail } from '../state.js';
import { DAY } from '../day.js';
import { icon, checkFill } from '../icons.js';
import { backHead, esc, safeImg, nonLiveBadge } from '../components.js';
import { openingMessage, reactionGroups, threadMessages, contextForChat } from '../meal-intel.js';

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
      <div class="phase-sub" id="an-sub">${nonLive ? "Won't count toward your score — live capture only. Logged for your record." : 'Detecting foods and portions'}</div>
    </div>`;
  },
  async mount(root) {
    const phase = root.querySelector('#an-phase');
    const sub = root.querySelector('#an-sub');
    const phaseTimer = setTimeout(() => { if (phase && location.hash === '#analyzing') { phase.innerHTML = 'Estimating macros<span class="dots"></span>'; if (sub) sub.textContent = 'Matching to your plan'; } }, 1000);

    if (MEAL && MEAL.photoBase64 && !MEAL.result) {
      // REAL analysis via the analyze-meal edge function.
      const r = await act.runAnalysis();
      if (location.hash !== '#analyzing') return; // navigated away
      if (r.ok) { location.hash = '#meal-analysis'; return; }
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

/* ---------- Meal Analysis (AI, pre-log) ---------- */
export const analysis = {
  tab: 'camera',
  hideTabs: true,
  render() {
    const L = S.logging;
    const slot = MEAL.key || 'dinner';
    const already = !!DAY.meals[slot];
    const nonLive = MEAL.live === false;
    return `
    ${backHead(`${L.name} Analysis`, 'Check it before it counts', 'camera')}

    <div class="photo-hero" style="background-image:url('${safeImg(L.img)}')">
      <div class="ph-grad"></div>
      <div class="ph-meta">
        <div><div class="ph-t">${esc(L.name)}</div><div class="ph-s">${nonLive ? "Won't count toward your score — live capture only" : 'Captured just now · on time'}</div>${nonLive ? `<div style="margin-top:6px">${nonLiveBadge()}</div>` : ''}</div>
        <div class="scorechip"><span class="v">${L.score}</span><span class="k">Meal</span></div>
      </div>
    </div>

    <div class="eyebrow">Detected <span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0">· estimated from photo</span> <span class="link" id="edit-foods">Edit</span></div>
    <div class="foodchips" id="foods">
      ${(MEAL.result && MEAL.result.detectedRich ? MEAL.result.detectedRich : L.foods.map((f) => ({ name: f, confidence: 'high' }))).map((d) => `
        <span class="foodchip" data-name="${esc(d.name)}"><span class="conf-dot ${d.confidence}"></span>${esc(d.name)}${d.confidence === 'low' ? '<span class="q" title="AI is unsure — confirm or remove">?</span>' : ''}</span>`).join('')}
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

    ${already ? '' : nonLive
      ? `<div class="score-change">${icon('image', 16)} Logged for your record — won't change your score. Capture live to make it count.</div>`
      : `<div class="score-change">${icon('arrowUp', 16)} Logging this counts toward Nutrition (50%) and closes 1 of ${S.remainingCount} remaining tonight.</div>`}

    <div style="height:20px"></div>
    <div class="btn-row">
      <button class="btn ghost sm" style="flex:1" data-go="camera/${slot}">${icon('camera', 17)} Retake</button>
      ${already
        ? `<button class="btn ghost sm" style="flex:1.6" data-go="home">Already logged · Back Home</button>`
        : `<button class="btn green sm" style="flex:1.6" data-act="logMeal:${slot}" data-then="meal-thread/${slot}">${icon('check', 18)} Log ${esc(L.name)}</button>`}
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
          ch.querySelector('.rm').addEventListener('click', (e) => {
            e.stopPropagation();
            // DOM removal alone is cosmetic — act.logMeal reads MEAL.result.detected /
            // detectedRich, not the rendered chips, so a removed low-confidence food would
            // otherwise still persist to the logged meta and the thread page. Splice the
            // matching entry (by name — chip order can drift from array order after earlier
            // removals) out of both arrays; macros are deliberately left untouched, no
            // re-estimation.
            const name = ch.getAttribute('data-name');
            if (MEAL.result && name) {
              const rich = MEAL.result.detectedRich;
              if (Array.isArray(rich)) {
                const i = rich.findIndex((d) => d && d.name === name);
                if (i !== -1) rich.splice(i, 1);
              }
              const flat = MEAL.result.detected;
              if (Array.isArray(flat)) {
                const j = flat.indexOf(name);
                if (j !== -1) flat.splice(j, 1);
              }
            }
            ch.remove();
          });
        } else if (!editing) { const x = ch.querySelector('.rm'); if (x) x.remove(); }
      });
    });
  },
};

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

    // ---- 1. EXECUTION SUMMARY (celebrates the act of logging; never shames) ----
    const justLogged = RT.lastMove && !RT.lastMove._played && (RT.lastMove.what || '').toLowerCase() === M.slot;
    const nonLiveLogged = M.live === false;
    const timing = nonLiveLogged
      ? (M.late ? 'Logged late' : 'Logged from gallery')
      : (M.late ? 'Logged late · still counts' : 'Captured on time');
    const toTier = justLogged ? tier(RT.lastMove.to) : null;
    const scoreStatus = nonLiveLogged ? "Won't count toward your score" : 'Counted toward Nutrition (50%)';
    const execTop = `
    <section class="mt-exec">
      <div class="bigcheck">${icon('check', 26)}</div>
      <div class="t">${esc(M.name)} Logged</div>
      <div class="s">${timing} · ${scoreStatus} · Coach can see it</div>
      ${justLogged && !nonLiveLogged ? `
      <div class="mt-move"><span class="from" data-anim-from>${RT.lastMove.from}</span><span style="color:var(--text-3)">${icon('arrowRight', 20)}</span><span class="to" data-anim-to>${RT.lastMove.to}</span></div>
      <div class="s">OnStandard Score · +${RT.lastMove.gain} pts</div>
      ${toTier.name !== tier(RT.lastMove.from).name ? `<span class="tier-chip ${toTier.cls}">▲ ${esc(toTier.name)}</span>` : ''}` : ''}
      <div style="height:12px"></div>
      <div class="xsegs">${Array.from({ length: e.total }, (_, i) => `<i class="${i < e.met ? 'on' : ''}"></i>`).join('')}</div>
      <div class="s" style="margin-top:6px">${e.met} of ${e.total} in today${S.streakDays > 0 ? ` · ${S.streakDays} day streak` : ''}</div>
    </section>`;

    // ---- 2. MEAL BREAKDOWN (objective, honest, estimated) ----
    const T = S.planTargets || {};
    const bars = [
      ['Protein', M.macros.protein, T.protein, 'g'],
      ['Carbs', M.macros.carbs, null, 'g'],
      ['Fat', M.macros.fat, null, 'g'],
      ['Fiber', M.fiber, null, 'g'],
      ['Calories', M.macros.cals, T.calories, ''],
    ];
    const coachLine = T.protein
      ? `<div class="hl-row"><span class="ic">${icon(M.macros.protein * 4 >= T.protein ? 'check' : 'clock', 14)}</span>Coach's day bar: ${esc(String(T.protein))}g protein — this plate carries ${M.macros.protein}g of it.</div>`
      : '';
    const breakdown = `
    <div class="eyebrow" style="margin-top:16px">Meal Breakdown <span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0">· estimated from photo</span></div>
    <div class="photo-hero" id="meal-hero" style="background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))">
      <img id="meal-photo" alt="" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;display:none"/>
      <div class="ph-grad"></div>
      <div class="ph-meta"><div><div class="ph-t">${esc(M.name)}</div><div class="ph-s">Logged ${esc(M.loggedAt || 'today')}</div>${M.live === false ? `<div style="margin-top:6px">${nonLiveBadge()}</div>` : ''}</div>
      ${M.score != null ? `<div class="scorechip"><span class="v">${M.score}</span><span class="k">Meal</span></div>` : ''}</div>
    </div>
    ${M.live === false ? `<div style="font-size:11px;font-weight:600;color:var(--text-3);margin-top:6px">Picked from your gallery — logged for your record, but won't count toward your score.</div>` : ''}
    <div class="foodchips">
      ${M.detectedRich.map((d) => `<span class="foodchip"><span class="conf-dot ${esc(d.confidence)}"></span>${esc(d.name)}${d.confidence === 'low' ? '<span class="q" title="AI was unsure about this one">?</span>' : ''}</span>`).join('')}
    </div>
    <section class="card pad" style="margin-top:10px">
      ${bars.map(([k, v, target, u]) => `
        <div class="cons-row" style="margin-bottom:10px">
          <span class="k" style="width:64px">${k}</span>
          <div class="track"><div class="fillb" style="width:${target ? Math.min(100, Math.round((v / target) * 100)) : Math.min(100, Math.round((v / (k === 'Calories' ? 900 : 60)) * 100))}%;background:linear-gradient(90deg,#16a34a,var(--green-bright))"></div></div>
          <span class="v" style="width:96px">${v}${u}${target ? ` <small style="color:var(--text-3)">/ ${esc(String(target))}${u} day</small>` : ''}</span>
        </div>`).join('')}
      ${T.protein ? '' : `<div style="font-size:12px;font-weight:600;color:var(--text-3)">No coach targets set yet — these are this meal's estimated totals.</div>`}
    </section>
    ${coachLine}
    ${(() => { // goal-alignment verdict — presentation only, no new math
      const g = RT.profile && RT.profile.baseGoal;
      if (!g || M.score == null) return '';
      const GOAL_LABEL = { gain: 'gaining', lose: 'leaning out', maintain: 'maintaining', perform: 'performing', build: 'building', health: 'your health goals' };
      return `<div class="hl-row"><span class="ic">${icon(M.score >= 75 ? 'check' : 'target', 14)}</span>${M.score >= 75 ? `Aligned with ${GOAL_LABEL[g] || 'your goal'} — this is the kind of plate that gets you there.` : `Workable for ${GOAL_LABEL[g] || 'your goal'} — the thread below has the one upgrade that matters.`}</div>`;
    })()}
    ${M.highlights.length ? M.highlights.map((h) => `<div class="hl-row"><span class="ic">${icon('sparkle', 14)}</span>${esc(h)}</div>`).join('') : ''}
    <div style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:var(--r-tile);background:var(--green-surface);border:1px solid var(--green-border);margin-top:8px">
      ${icon('shield', 15)} <span style="font-size:12.5px;font-weight:700;color:var(--green-bright)">Guardian: checked against your restrictions (${RT.allergies.length ? esc(RT.allergies.join(', ')) : 'none declared'})</span>
    </div>`;

    // ---- 3. TEAM DISCUSSION (opening message is DERIVED, never stored) ----
    const discussion = `
    <div class="eyebrow" style="margin-top:18px">Team Discussion</div>
    <div class="rx-strip" id="rx-strip"></div>
    <div class="thread" id="meal-thread">
      <div class="msg ai">
        <div class="av">${icon('sparkle', 15)}</div>
        <div><div class="who">OnStandard AI</div>
        <div class="bubble">${esc(openingMessage({ name: M.name, quality: M.score, note: M.note, goal: RT.profile && RT.profile.baseGoal, coachTargets: S.planTargets, late: M.late }))}</div></div>
      </div>
      <div class="msg-status" id="thread-status">${M.mealId ? 'Loading the thread…' : 'Syncs when connected — your coach sees this log either way.'}</div>
    </div>
    ${M.mealId ? `
    <div class="composer">
      <input id="meal-msg" placeholder="Ask about this meal…" />
      <div class="send" id="meal-send">${icon('arrowUp', 19)}</div>
    </div>
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

    return `${backHead(M.name, timing, 'home')}${execTop}${breakdown}${discussion}${next}
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
