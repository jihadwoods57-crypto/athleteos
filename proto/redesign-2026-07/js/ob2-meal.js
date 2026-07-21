/* ============================================================
   OB2 meal demo — the interactive product moment for athlete
   and client onboarding. Two paths:
     · Analyze My Meal — a REAL analyze-meal call (Sonnet vision,
       anonymous rail; the edge fn already rate-limits anon
       callers per-IP/day + per-minute + global bill backstop).
     · Try a sample meal — bundled photo + prewritten result;
       zero AI tokens spent.
   Both land on the same result → correction → score → group
   thread screens. The AI nutritionist line is DERIVED from the
   result via the real openingMessage(); the coach/trainer reply
   is derived from the same result and is always chipped
   "simulated" — it is never presented as a real person.

   Client-side abuse guards on the live path (server caps remain
   the authority): 2 live analyses per device/day, an in-flight
   lock, and a duplicate-photo check so a re-tap never spends a
   second call on the same picture.
   ============================================================ */
import { RT } from './state.js';
import { icon } from './icons.js';
import { esc } from './components.js';
import { openingMessage, openingSummary, qualityBand, groundExtras } from './meal-intel.js';
import { capture, simChip, meter, chatSim, phoneCard, gateCta } from './ob2.js';

/* Demo scratch — module-level, never persisted (photos are heavy and this is a
   throwaway trial; a refresh honestly restarts the demo). */
const DEMO = { photoDataUrl: null, photoBase64: null, result: null, removed: [], busy: false, lastSig: null, error: null };
export const demoState = DEMO;

/* ---- device-day live-call budget (client courtesy cap; server caps still apply) ---- */
const LIVE_CAP = 2;
function liveBudget() {
  const today = new Date().toISOString().slice(0, 10);
  const d = RT.ob2DemoAi && RT.ob2DemoAi.day === today ? RT.ob2DemoAi : { day: today, n: 0 };
  return d;
}
function spendLive() {
  const d = liveBudget();
  RT.ob2DemoAi = { day: d.day, n: d.n + 1 };
  capture({}); /* triggers save() */
}
const liveLeft = () => Math.max(0, LIVE_CAP - liveBudget().n);

/* Cheap content signature so a double-tap / same photo never buys a second call. */
function sigOf(b64) {
  let h = 5381;
  for (let i = 0; i < b64.length; i += 977) h = ((h * 33) ^ b64.charCodeAt(i)) >>> 0;
  return `${b64.length}:${h}`;
}

/* ---- downscale + encode (same pipeline shape as camera.js, local copy — the
   camera module doesn't export its helper and pulls in the full capture screen) ---- */
function fileToJpeg(file, maxDim = 1000, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        let w = img.width, h = img.height;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = cv.toDataURL('image/jpeg', quality);
        resolve({ dataUrl, base64: dataUrl.split(',')[1] });
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = url;
  });
}

/* ---- the sample meal (bundled asset; content hand-matched to the photo) ---- */
export const SAMPLE_MEAL = {
  photo: 'assets/meal-dinner.jpg',
  name: 'Steak & Fries',
  quality: 64,
  protein: 48, carbs: 58, fat: 38, kcal: 766, fiber: 5,
  highlights: ['Iron and B12 from the steak', 'Potassium from the potatoes'],
  detectedRich: [
    { name: 'Grilled skirt steak', confidence: 'high', quantity: '~8 oz' },
    { name: 'French fries', confidence: 'high', quantity: '~2 cups' },
    { name: 'Parsley garnish', confidence: 'medium', quantity: 'sprinkle' },
  ],
  detected: ['Grilled skirt steak', 'French fries', 'Parsley garnish'],
  note: 'Strong protein anchor, but the plate is missing a vegetable.',
  analysis: 'This is a real dinner, not a snack — the steak carries roughly 48g of protein, which is the kind of anchor that actually moves a day. The fries are the honest concern: as the only carb source they bring most of the fat with them, and there is no vegetable on the plate beyond the garnish. Keep the steak exactly as it is. Swapping even half the fries for a green vegetable or rice would raise the quality of this plate significantly without shrinking it.',
};

/* ---- derived, clearly-simulated human feedback (structure: recognize → concern →
   one action; grounded in the actual detected foods + the user's stated goal) ---- */
export function simulatedHumanLine(result, goal, voice) {
  const foods = (result.detectedRich || []).map((f) => f.name.toLowerCase());
  const anchor = foods.find((f) => /steak|chicken|beef|fish|salmon|turkey|egg|tofu|pork/.test(f)) || (foods[0] || 'that meal');
  const hasVeg = foods.some((f) => /salad|broccoli|spinach|green|vegetable|pepper|carrot|cucumber|tomato|lettuce|kale|edamame|cabbage/.test(f));
  const g = goal || 'performance';
  const goalLine = {
    gain: 'with your weight-gain target this needs to be a full plate every time',
    lose: 'for the weight you want to drop, the portions matter as much as the picks',
    maintain: 'holding your weight means plates like this need to stay consistent',
    performance: 'this is the kind of fuel that shows up in how you finish practice',
    health: 'this is exactly the consistency your goal is built on',
  }[g] || 'keep it tied to the goal you told me about';
  const open = `Good — you logged it. Keep the ${anchor.replace(/^(grilled|fried|baked)\s+/, '')}`;
  const fix = hasVeg
    ? `and don't let the portion shrink on busy days; ${goalLine}.`
    : `but get a vegetable on that plate next time; ${goalLine}.`;
  const action = hasVeg
    ? 'One thing before tomorrow: log your first meal before noon so I can see the whole day.'
    : 'One thing before tomorrow: add one green vegetable to dinner and log it the same way.';
  return `${open} ${fix} ${action}`;
}

/* ---- shared render pieces ---- */
function foodsList(result, removable) {
  const rows = (result.detectedRich || []).filter((f) => !DEMO.removed.includes(f.name));
  return `<div class="ob2-foods">${rows.map((f) => `
    <div class="fr" data-food="${esc(f.name)}">
      <div class="fn">${esc(f.name)}</div>
      <div class="fq">${esc(f.quantity || '')}</div>
      <div class="fc ${esc(f.confidence || 'medium')}">${esc(f.confidence || 'medium')}</div>
      ${removable ? `<div class="fx" role="button" aria-label="Remove ${esc(f.name)}" data-remove="${esc(f.name)}">${icon('x', 14)}</div>` : ''}
    </div>`).join('')}</div>`;
}
function macroGrid(r) {
  const cell = (v, k) => `<div class="mc"><div class="mv">${v}</div><div class="mk">${k}</div></div>`;
  return `<div class="ob2-macros">${cell(r.kcal, 'kcal')}${cell(r.protein + 'g', 'protein')}${cell(r.carbs + 'g', 'carbs')}${cell(r.fat + 'g', 'fat')}</div>`;
}

/* Example-day score: OnStandard's REAL blend (WEIGHTS from the engine), applied to
   an example day so the demo never pretends the user has earned anything. */
export function exampleDayScore(quality, computeScore) {
  return computeScore({ nutrition: Math.max(0, Math.min(100, quality)), recovery: 80, commitment: 80, checkin: 100 });
}

/* ============================================================
   Steps factory. voice: 'coach' | 'trainer'. Splice into a flow
   inside the "See it" chapter (ch 1).
   ============================================================ */
export function mealDemoSteps({ route, voice = 'coach', computeScore }) {
  const HUMAN = voice === 'trainer'
    ? { name: 'Trainer Mills', init: 'TM', role: 'trainer' }
    : { name: 'Coach Daniels', init: 'CD', role: 'coach' };

  return [
    /* ---- choose the demo ---- */
    {
      id: 'demo', ch: 1, noFoot: true,
      title: () => 'See OnStandard in action',
      sub: () => 'One meal is all it takes to understand the whole system.',
      body: () => `
        <div class="ob2-demo-choice">
          <div class="ob2-demo-card rec" id="demo-live" role="button" aria-label="Analyze my meal — recommended">
            <div class="dc-tag">Recommended</div>
            <div class="dc-ic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('camera', 20)}</div>
            <div><div class="dc-t">Analyze my meal</div>
            <div class="dc-s">Snap your next meal or pick a photo. Real AI analysis — foods, portions, macros — in seconds.</div></div>
          </div>
          <div class="ob2-demo-card" id="demo-sample" role="button" aria-label="Try a sample meal">
            <div class="dc-ic" style="background:var(--green-surface);color:var(--green-bright)">${icon('utensils', 20)}</div>
            <div><div class="dc-t">Try a sample meal</div>
            <div class="dc-s">No meal handy? Walk the same experience with a prepared plate.</div></div>
          </div>
        </div>
        <input id="demo-file" type="file" accept="image/*" style="display:none" aria-hidden="true" />
        <div class="ob2-scan-note" id="demo-note">${liveLeft() ? 'The live analysis runs on the same engine the full app uses.' : 'Live analysis limit reached for today — the sample meal shows the same experience.'}</div>`,
      mount(root, ctx) {
        const file = root.querySelector('#demo-file');
        const live = root.querySelector('#demo-live');
        const start = () => {
          if (!liveLeft()) { root.querySelector('#demo-note').textContent = 'Live analysis limit reached for today — try the sample meal instead.'; return; }
          file.click();
        };
        live.addEventListener('click', start);
        file.addEventListener('change', async () => {
          const f = file.files && file.files[0];
          if (!f) return;
          try {
            const { dataUrl, base64 } = await fileToJpeg(f);
            DEMO.photoDataUrl = dataUrl; DEMO.photoBase64 = base64;
            DEMO.result = null; DEMO.removed = []; DEMO.error = null;
            capture({ demoMode: 'live' });
            ctx.go(`${route}/demo-scan`);
          } catch { root.querySelector('#demo-note').textContent = 'Could not read that photo — try another, or use the sample meal.'; }
        });
        root.querySelector('#demo-sample').addEventListener('click', () => {
          DEMO.result = { ...SAMPLE_MEAL }; DEMO.removed = []; DEMO.photoDataUrl = SAMPLE_MEAL.photo;
          capture({ demoMode: 'sample' });
          ctx.go(`${route}/demo-result`);
        });
      },
    },

    /* ---- live analysis in flight ---- */
    {
      id: 'demo-scan', ch: 1, noFoot: true,
      when: () => ob2mode() === 'live',
      body: () => `
        <div class="analyzing">
          <div class="scanbox"><div class="img" style="background-image:url('${DEMO.photoDataUrl || ''}')"></div><div class="scanline"></div></div>
          <div class="phase" id="scan-phase">Reading the plate<span class="dots"></span></div>
          <div class="phase-sub" id="scan-sub">Detecting foods and estimating portions</div>
          <div id="scan-err" style="margin-top:18px"></div>
        </div>`,
      mount(root, ctx) {
        runLiveAnalysis(root, ctx);
      },
    },

    /* ---- result + correction ---- */
    {
      id: 'demo-result', ch: 1, cta: 'Looks right — continue',
      title: () => (DEMO.result ? esc(DEMO.result.name) : 'Your analysis'),
      sub: () => 'Check the read. Remove anything the camera got wrong — estimates stay honest either way.',
      body: () => {
        const r = DEMO.result;
        if (!r) return `<div class="state-demo"><div class="sd-t">No analysis yet</div><div class="sd-s">Go back one step to run the demo.</div></div>`;
        const isSample = ob2mode() === 'sample';
        return `
          ${isSample ? simChip('Sample analysis — no AI call was made') : ''}
          <img class="ob2-meal-photo" src="${esc(DEMO.photoDataUrl || '')}" alt="Your meal photo" />
          <div style="height:14px"></div>
          ${phoneCard('Detected foods', foodsList(r, true))}
          <div style="height:10px"></div>
          ${phoneCard('Estimated macros', macroGrid(r) + `<div class="ob2-scan-note" style="text-align:left;margin-top:10px">Photo estimates — portions, oil, or sauce can move them. In the full app you can correct any line and the numbers stay yours.</div>`)}`;
      },
      mount(root) {
        root.querySelectorAll('[data-remove]').forEach((x) => x.addEventListener('click', () => {
          const name = x.getAttribute('data-remove');
          if (!DEMO.removed.includes(name)) DEMO.removed.push(name);
          const row = root.querySelector(`.fr[data-food="${CSS.escape(name)}"]`);
          if (row) row.remove();
        }));
      },
    },

    /* ---- score impact (internal scoring logic, labeled example) ---- */
    {
      id: 'demo-score', ch: 1, cta: 'Show me the conversation',
      title: () => 'What this does to a Daily Score',
      sub: () => 'OnStandard turns every log into one number your whole circle can trust.',
      body: () => {
        const r = DEMO.result || SAMPLE_MEAL;
        const score = exampleDayScore(r.quality, computeScore);
        const band = qualityBand(r.quality);
        return `
          ${simChip('Example day — your real score starts fresh and is earned')}
          <div style="display:flex;justify-content:center;padding:6px 0 2px">${meter(score, { value: String(score), label: 'Example score', uid: 'ds' })}</div>
          <div style="height:12px"></div>
          ${phoneCard('How the number is built', `
            <div class="comp-read">
              <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">Nutrition</div><div class="cv">50% of the score — this meal grades ${r.quality}/100${band ? ' (' + esc(band.label || band.name || '') + ')' : ''}</div></div>
              <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">Recovery</div><div class="cv">25% — sleep and recovery check-ins</div></div>
              <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">Commitment</div><div class="cv">15% — doing what you said, on time</div></div>
              <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">Check-in</div><div class="cv">10% — showing up daily</div></div>
            </div>`)}`;
      },
    },

    /* ---- the accountability loop: AI + human, one thread ---- */
    {
      id: 'demo-chat', ch: 1, cta: 'That’s the loop', green: true,
      title: () => 'This is not a food scanner',
      sub: () => `Every meal opens a shared thread — you, the AI nutritionist, and your ${HUMAN.role}. Nobody has to chase anybody.`,
      body: (o) => {
        const r = DEMO.result || SAMPLE_MEAL;
        /* Demo bubble is SHORT — the plate's own one-line note (aligned with the coach reply
           below), falling back to the compact openingSummary. The full openingMessage
           paragraph was a 14-line wall that buried the coach/trainer reply; the whole point
           of the screen is the shared thread, not the AI monologue. */
        const s = openingSummary({
          quality: r.quality, macros: { protein: r.protein, carbs: r.carbs, fat: r.fat, kcal: r.kcal },
          fiber: r.fiber, highlights: r.highlights, goal: o.goal || null, late: null,
          detected: r.detectedRich, source: ob2mode() === 'sample' ? 'gallery' : 'live',
        });
        const aiRaw = (r.note || '').trim() || [s.opportunity, s.next].filter(Boolean).join(' ') || 'Logged and analyzed.';
        const ai = aiRaw.charAt(0).toUpperCase() + aiRaw.slice(1);
        return `
          ${simChip(`Simulated preview — ${HUMAN.name} stands in for your real ${HUMAN.role}`)}
          ${chatSim([
            { who: 'me', name: 'You', text: `Logged: ${r.name}` },
            { who: 'ai', name: 'OnStandard AI · Nutritionist', text: ai },
            { who: voice === 'trainer' ? 'trainer' : 'coach', name: HUMAN.name, init: HUMAN.init, sim: true, text: simulatedHumanLine(r, o.goal, voice) },
          ])}`;
      },
    },
  ];
}

/* Which demo path the user chose (kept in RT.ob so refresh keeps the branch). */
function ob2mode() { return (RT.ob && RT.ob.demoMode) || 'sample'; }

/* ---- the live call: one request, deduped, budgeted, honest failure → sample ---- */
async function runLiveAnalysis(root, ctx) {
  const err = root.querySelector('#scan-err');
  const fail = (msg) => {
    if (!err) return;
    /* clear the in-progress scan UI so "Reading the plate…" doesn't sit above the error */
    const ph = root.querySelector('#scan-phase'); if (ph) ph.textContent = 'Analysis stopped';
    const ps = root.querySelector('#scan-sub'); if (ps) ps.style.display = 'none';
    const box = root.querySelector('.scanbox'); if (box) box.style.display = 'none';
    err.innerHTML = `
      <div class="state-demo err-box" style="text-align:center">
        <div class="sd-t">Analysis didn’t go through</div>
        <div class="sd-s">${esc(msg)}</div>
        <div class="sd-cta"><button class="btn ghost sm" id="scan-fallback">Use the sample meal instead</button></div>
      </div>`;
    const b = err.querySelector('#scan-fallback');
    if (b) b.addEventListener('click', () => {
      DEMO.result = { ...SAMPLE_MEAL }; DEMO.removed = []; DEMO.photoDataUrl = SAMPLE_MEAL.photo;
      capture({ demoMode: 'sample' });
      ctx.go(ctx.nextRoute);
    });
  };
  if (!window.sb) { fail('No connection to the analysis service.'); return; }
  if (!DEMO.photoBase64) { fail('The photo didn’t make it — go back and pick it again.'); return; }
  if (DEMO.busy) return; /* in-flight lock: a re-mount never double-spends */
  const sig = sigOf(DEMO.photoBase64);
  if (DEMO.lastSig === sig && DEMO.result) { ctx.go(ctx.nextRoute); return; } /* same photo → reuse result */
  if (!liveLeft()) { fail('Live analysis limit reached for today.'); return; }
  DEMO.busy = true;
  try {
    const body = {
      mode: 'meal', mealType: 'Meal', phase: 'analyze',
      goal: (RT.ob && RT.ob.goal) || null,
      photoBase64: DEMO.photoBase64,
      athleteNote: 'Onboarding trial analysis.',
    };
    spendLive();
    let { data, error } = await window.sb.functions.invoke('analyze-meal', { body });
    if (!error && data && data.kind === 'questions') {
      /* Demo stays one screen: finalize without answers (the model estimates, honestly). */
      ({ data, error } = await window.sb.functions.invoke('analyze-meal', { body: { ...body, phase: 'finalize', clarifications: [] } }));
    }
    if (error || !data || data.kind !== 'result') { fail('The analysis service is busy. Your photo was not stored.'); return; }
    const extras = groundExtras(data);
    DEMO.result = {
      name: String(data.name || 'Meal').replace(/[<>]/g, '').slice(0, 80),
      quality: Math.max(0, Math.min(100, Math.round(data.quality || 0))),
      protein: Math.max(0, Math.min(120, Math.round(data.protein || 0))),
      carbs: Math.max(0, Math.min(250, Math.round(data.carbs || 0))),
      fat: Math.max(0, Math.min(150, Math.round(data.fat || 0))),
      kcal: Math.max(0, Math.min(2200, Math.round(data.kcal || 0))),
      fiber: extras.fiber, highlights: extras.highlights,
      detectedRich: extras.detectedRich, detected: extras.detectedNames,
      note: String(data.note || '').replace(/[<>]/g, '').slice(0, 200),
      analysis: extras.analysis,
    };
    DEMO.lastSig = sig;
    DEMO.removed = [];
    ctx.go(ctx.nextRoute);
  } catch {
    fail('Connection dropped mid-analysis. Nothing was stored.');
  } finally {
    DEMO.busy = false;
  }
}
