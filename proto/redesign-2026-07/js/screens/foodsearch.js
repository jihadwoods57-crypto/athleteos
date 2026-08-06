import { S, RT, slotTitle } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, composer } from '../components.js';
import { fetchFoodByBarcode } from '../roles.js';

/* Food database (proto-local; the real app notes "fuller database lands with backend"). */
const DB = [
  { n: 'Grilled chicken breast', p: 31, c: 0,  f: 4,  kc: 165, unit: '100g' },
  { n: 'White rice, cooked',     p: 3,  c: 28, f: 0,  kc: 130, unit: '1 cup' },
  { n: 'Steak, sirloin',         p: 26, c: 0,  f: 8,  kc: 183, unit: '100g' },
  { n: 'Roasted potatoes',       p: 2,  c: 21, f: 4,  kc: 130, unit: '1 cup' },
  { n: 'Eggs, whole',            p: 6,  c: 0,  f: 5,  kc: 72,  unit: '1 egg' },
  { n: 'Greek yogurt, plain',    p: 17, c: 6,  f: 1,  kc: 100, unit: '170g' },
  { n: 'Oats, dry',              p: 5,  c: 27, f: 3,  kc: 150, unit: '40g' },
  { n: 'Banana',                 p: 1,  c: 27, f: 0,  kc: 105, unit: '1 med' },
  { n: 'Chipotle chicken bowl',  p: 45, c: 65, f: 22, kc: 650, unit: '1 bowl' },
  { n: 'Protein shake',          p: 25, c: 5,  f: 2,  kc: 140, unit: '1 scoop' },
  { n: 'Green beans',            p: 2,  c: 8,  f: 0,  kc: 35,  unit: '1 cup' },
  { n: 'Tuna, canned',           p: 24, c: 0,  f: 1,  kc: 108, unit: '1 can' },
];

/* ---------- Search Food: type, tap to build the plate, log it ---------- */
export const foodSearch = {
  tab: 'camera',
  transient: true,
  hideTabs: true,
  render() {
    const slot = S.currentSlot;
    const slotName = slot ? slotTitle(slot) : 'meal';
    return `
    ${backHead(`Log without a photo · ${slotName}`, 'When a photo isn’t possible. Same score rules.', 'camera')}

    ${composer({ inputId: 'fs-input', placeholder: 'Search foods…', inputLabel: 'Search foods', decorativeSend: true, sendIcon: 'search', sendIconSize: 18, sendStyle: 'background:var(--surface-2);color:var(--text)', wrapStyle: 'margin-top:2px' })}

    <div class="eyebrow">Results</div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:-4px 2px 8px;line-height:1.4">Common foods. For anything not listed, a photo or the nutrition label reads best.</div>
    <section class="card" style="padding:2px 0" id="fs-results"></section>

    <div class="lrow" data-go="barcode-scan" style="border:1px solid var(--hairline);border-radius:15px;padding:12px 15px;margin-top:10px">
      <div class="lic">${icon('barcode', 17)}</div>
      <div class="lm"><div class="lt">Scan a barcode</div><div class="ls">Packaged food, exact from the maker's own data</div></div>
      ${icon('chevron', 16, 'style="color:var(--text-3)"')}
    </div>

    <div class="lrow" data-go="label-scan" style="border:1px solid var(--hairline);border-radius:15px;padding:12px 15px;margin-top:10px">
      <div class="lic">${icon('edit', 17)}</div>
      <div class="lm"><div class="lt">Enter a nutrition label</div><div class="ls">Type the panel numbers — exact, never estimated</div></div>
      ${icon('chevron', 16, 'style="color:var(--text-3)"')}
    </div>

    <div class="eyebrow">Your plate <span class="link" id="fs-clear">Clear</span></div>
    <section class="card pad" id="fs-plate">
      <div class="tiny" style="font-size:13px;font-weight:600" id="fs-empty">Tap results to build the plate.</div>
      <div id="fs-items"></div>
      <div class="macro-row" id="fs-totals" style="margin-top:12px;display:none">
        <div class="macro"><div class="mv" id="t-p">0g</div><div class="mk">Protein</div></div>
        <div class="macro"><div class="mv" id="t-c">0g</div><div class="mk">Carbs</div></div>
        <div class="macro"><div class="mv" id="t-f">0g</div><div class="mk">Fat</div></div>
        <div class="macro"><div class="mv" id="t-k">0</div><div class="mk">Calories</div></div>
      </div>
    </section>

    <div style="height:16px"></div>
    ${!slot
      ? `<button class="btn ghost" data-back="home">All meals logged · Done</button>`
      : `<button class="btn green" id="fs-log" style="opacity:.45;pointer-events:none">${icon('check', 19)} Log ${slotName}</button>`}
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const SLOT = S.currentSlot;
    const input = root.querySelector('#fs-input');
    const results = root.querySelector('#fs-results');
    const items = root.querySelector('#fs-items');
    const totals = root.querySelector('#fs-totals');
    const empty = root.querySelector('#fs-empty');
    const logBtn = root.querySelector('#fs-log');
    const plate = [];

    const renderTotals = () => {
      const sum = plate.reduce((a, x) => ({ p: a.p + x.p * x.q, c: a.c + x.c * x.q, f: a.f + x.f * x.q, kc: a.kc + x.kc * x.q }), { p: 0, c: 0, f: 0, kc: 0 });
      root.querySelector('#t-p').textContent = Math.round(sum.p) + 'g';
      root.querySelector('#t-c').textContent = Math.round(sum.c) + 'g';
      root.querySelector('#t-f').textContent = Math.round(sum.f) + 'g';
      root.querySelector('#t-k').textContent = Math.round(sum.kc);
      totals.style.display = plate.length ? 'flex' : 'none';
      empty.style.display = plate.length ? 'none' : 'block';
      if (logBtn) { logBtn.style.opacity = plate.length ? '1' : '.45'; logBtn.style.pointerEvents = plate.length ? 'auto' : 'none'; }
    };
    const renderPlate = () => {
      items.innerHTML = plate.map((x, i) => `
        <div class="chip-row" style="display:flex;flex-wrap:nowrap;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--hairline-soft)">
          <span style="flex:1;font-size:14px;font-weight:700">${esc(x.n)} <small style="color:var(--text-3)">· ${esc(x.unit)}</small></span>
          <span class="chp" data-i="${i}" data-d="-1" role="button" aria-label="One less ${esc(x.n)}">−</span>
          <span style="font-size:14px;font-weight:800;width:26px;text-align:center">${x.q}</span>
          <span class="chp" data-i="${i}" data-d="1" role="button" aria-label="One more ${esc(x.n)}">+</span>
        </div>`).join('');
      items.querySelectorAll('.chp').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.i, d = +b.dataset.d;
        plate[i].q = Math.max(0, plate[i].q + d);
        if (plate[i].q === 0) plate.splice(i, 1);
        renderPlate(); renderTotals();
      }));
      renderTotals();
    };
    const renderResults = (q) => {
      const hits = DB.filter(x => x.n.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
      results.innerHTML = hits.length ? hits.map((x, i) => `
        <div class="lrow" data-add="${DB.indexOf(x)}" style="padding:12px 16px">
          <div class="lic">${icon('plus', 16)}</div>
          <div class="lm"><div class="lt">${esc(x.n)}</div><div class="ls">${esc(x.unit)} · ${x.p}g protein · ${x.kc} cal</div></div>
        </div>`).join('')
        : `<div style="padding:16px;font-size:13px;font-weight:600;color:var(--text-3)">No match. The full database lands with the backend; photo logging always works.</div>`;
      results.querySelectorAll('[data-add]').forEach(r => r.addEventListener('click', () => {
        const f = DB[+r.dataset.add];
        const hit = plate.find(x => x.n === f.n);
        if (hit) hit.q += 1; else plate.push({ ...f, q: 1 });
        renderPlate();
      }));
    };
    // Stage the REAL assembled plate and route through the SAME confirm gate the photo path
    // gets (#meal-analysis) — an accidental tap no longer commits instantly (WS7). The
    // athlete reviews the plate + totals, then "Log" commits.
    if (logBtn) logBtn.addEventListener('click', () => {
      if (!plate.length || !SLOT) return;
      const sum = plate.reduce((a, x) => ({ p: a.p + x.p * x.q, c: a.c + x.c * x.q, f: a.f + x.f * x.q, kc: a.kc + x.kc * x.q }), { p: 0, c: 0, f: 0, kc: 0 });
      window.__act.captureManual({ protein: sum.p, carbs: sum.c, fat: sum.f, kcal: sum.kc }, plate.map(x => x.n), SLOT, 'manual');
      location.hash = '#meal-analysis';
    });

    // "Clear" was rendered but never wired (router only wires data-go/data-act at render
    // time) — the third instance of this bug class. Plate is local UI state only.
    const clear = root.querySelector('#fs-clear');
    if (clear) clear.addEventListener('click', () => { plate.length = 0; renderPlate(); });

    input.addEventListener('input', () => renderResults(input.value));
    renderResults('');
    renderTotals();
  },
};

/* ---------- Enter Label: honest manual panel entry × servings (no fake OCR) ---------- */
export const labelScan = {
  tab: 'camera',
  transient: true,
  hideTabs: true,
  render() {
    const slot = S.currentSlot;
    const slotName = slot ? slotTitle(slot) : 'meal';
    const allergies = (RT.allergies || []).filter(Boolean);
    const numField = 'width:100%;height:52px;border-radius:14px;background:var(--surface-1);border:1.5px solid var(--hairline);color:var(--text);font-size:17px;font-weight:800;text-align:center;font-variant-numeric:tabular-nums';
    return `
    ${backHead('Enter the Label', 'Type the numbers straight off the panel — exact, never estimated', 'camera')}

    ${allergies.length ? `
    <div class="sidebox" style="border-color:var(--amber-border);background:rgba(245,165,36,0.08)">
      <div class="req-icon a" style="width:38px;height:38px;color:var(--amber-bright)">${icon('bell', 17)}</div>
      <div><div class="tt">Check it against your restrictions</div>
      <div class="ts">You flagged ${esc(allergies.join(', '))}. Read the ingredients before you log this.</div></div>
    </div>
    <div style="height:14px"></div>` : ''}

    <div class="eyebrow">Per serving, off the panel</div>
    <section class="card pad">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><div class="bk" style="margin-bottom:6px">Calories</div><input id="ls-kcal" type="number" inputmode="numeric" placeholder="0" style="${numField}" /></div>
        <div><div class="bk" style="margin-bottom:6px">Protein (g)</div><input id="ls-p" type="number" inputmode="numeric" placeholder="0" style="${numField};color:var(--green-bright)" /></div>
        <div><div class="bk" style="margin-bottom:6px">Carbs (g)</div><input id="ls-c" type="number" inputmode="numeric" placeholder="0" style="${numField}" /></div>
        <div><div class="bk" style="margin-bottom:6px">Fat (g)</div><input id="ls-f" type="number" inputmode="numeric" placeholder="0" style="${numField}" /></div>
      </div>
    </section>

    <div class="eyebrow">Servings you ate</div>
    <div class="chip-row" id="serv" data-toggle-group>
      <span class="chp on" data-m="1">1</span>
      <span class="chp" data-m="1.5">1.5</span>
      <span class="chp" data-m="2">2</span>
      <span class="chp" data-m="3">3</span>
    </div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">Exact, because you read it</div>
      <div class="ts">You copy the numbers off the real panel; we just multiply by your servings. No guessing a packaged food — and no fake scan.</div></div>
    </div>

    <div id="ls-err" style="color:var(--red-bright);font-size:13px;font-weight:600;min-height:18px;margin-top:12px;text-align:center"></div>
    ${!slot
      ? `<button class="btn ghost" data-back="home">All meals logged · Done</button>`
      : `<button class="btn green" id="ls-log">${icon('check', 19)} Add to ${slotName}</button>`}
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const { wireToggles } = await import('./settings.js');
    wireToggles(root);
    let mult = 1;
    root.querySelectorAll('#serv .chp').forEach(ch => ch.addEventListener('click', () => { mult = +ch.dataset.m || 1; }));
    const lsBtn = root.querySelector('#ls-log');
    const err = root.querySelector('#ls-err');
    const SLOT = S.currentSlot;
    if (lsBtn && SLOT) lsBtn.addEventListener('click', () => {
      const val = (id) => Math.max(0, parseFloat(root.querySelector('#' + id).value) || 0);
      const p = val('ls-p'), c = val('ls-c'), f = val('ls-f'), kcalIn = val('ls-kcal');
      // At least protein or calories must be entered — logging an all-zero label is meaningless.
      if (p <= 0 && kcalIn <= 0) { err.textContent = 'Enter at least the calories or protein from the label.'; return; }
      // If calories were left blank, derive them (Atwater) so the plate still carries energy.
      const kcal = kcalIn > 0 ? kcalIn : (4 * p + 4 * c + 9 * f);
      window.__act.captureManual(
        { protein: Math.round(p * mult), carbs: Math.round(c * mult), fat: Math.round(f * mult), kcal: Math.round(kcal * mult) },
        ['Label entry'], SLOT, 'label');
      // Same confirm gate as the photo path (WS7): review before it counts.
      location.hash = '#meal-analysis';
    });
  },
};

/* ---------- Barcode: one exact packaged product off the maker's own data (2026-08-05) ----------
   The server half (food-lookup fn → Open Food Facts, cached, licensing settled by founder
   decision D5) shipped weeks ago with zero callers — this is the missing client half. Two honest
   input paths, never a fake scan:
     · LIVE SCAN where the WebView has BarcodeDetector (Android today; iOS when WebKit ships it)
     · TYPED DIGITS everywhere — the numbers printed under the bars ARE the barcode, so the
       feature works on every device the day it lands, no vendored decoder, no native build.
   The resolved product is per-100g; the athlete says how much they ate and we multiply — the
   same "exact because the source is exact" contract as the label screen. */
export const barcodeScan = {
  tab: 'camera',
  transient: true,
  hideTabs: true,
  render() {
    const slot = S.currentSlot;
    const slotName = slot ? slotTitle(slot) : 'meal';
    const canLive = typeof window !== 'undefined' && 'BarcodeDetector' in window;
    return `
    ${backHead(`Scan a barcode · ${slotName}`, "Packaged food, exact from the maker's own data", 'food-search')}

    ${canLive ? `
    <section class="card" style="padding:0;overflow:hidden;position:relative">
      <video id="bc-video" autoplay playsinline muted style="width:100%;height:190px;object-fit:cover;display:block;background:#000"></video>
      <div style="position:absolute;left:0;right:0;bottom:0;padding:8px 12px;background:linear-gradient(transparent, rgba(0,0,0,0.65));color:#fff;font-size:12px;font-weight:700;text-align:center">Hold the bars inside the frame</div>
    </section>
    <div style="height:12px"></div>` : ''}

    <div class="eyebrow">${canLive ? 'Or type the numbers' : 'Type the numbers under the bars'}</div>
    <section class="card pad">
      <div style="display:flex;gap:10px">
        <input id="bc-digits" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 038000138416" aria-label="Barcode digits"
          style="flex:1;min-width:0;height:52px;border-radius:14px;background:var(--surface-1);border:1.5px solid var(--hairline);color:var(--text);font-size:17px;font-weight:800;text-align:center;font-variant-numeric:tabular-nums;letter-spacing:0.06em" />
        <button class="btn green" id="bc-lookup" aria-label="Look up barcode" style="width:auto;padding:0 18px;height:52px;flex:none">${icon('search', 18)}</button>
      </div>
      ${canLive ? '' : `<div style="font-size:11.5px;font-weight:600;color:var(--text-3);margin-top:8px;line-height:1.4">Live camera scanning isn't supported in this app's browser engine yet. The printed digits are the same code, so typing them is just as exact.</div>`}
    </section>

    <div id="bc-status" style="font-size:13px;font-weight:600;color:var(--text-3);min-height:20px;margin:10px 2px"></div>

    <div id="bc-result" style="display:none">
      <div class="eyebrow">Found</div>
      <section class="card pad">
        <div class="tt" id="bc-name" style="font-size:15px"></div>
        <div class="ts" id="bc-serving" style="margin-top:2px"></div>
        <div class="macro-row" style="margin-top:12px">
          <div class="macro"><div class="mv" id="bc-p">0g</div><div class="mk">Protein</div></div>
          <div class="macro"><div class="mv" id="bc-c">0g</div><div class="mk">Carbs</div></div>
          <div class="macro"><div class="mv" id="bc-f">0g</div><div class="mk">Fat</div></div>
          <div class="macro"><div class="mv" id="bc-k">0</div><div class="mk">Calories</div></div>
        </div>
        <div class="eyebrow" style="margin-top:14px">How much did you eat?</div>
        <div class="chip-row" id="bc-grams">
          <span class="chp" data-g="50">50g</span>
          <span class="chp on" data-g="100">100g</span>
          <span class="chp" data-g="150">150g</span>
          <span class="chp" data-g="250">250g</span>
        </div>
        <div id="bc-attr" style="font-size:10.5px;font-weight:600;color:var(--text-3);margin-top:12px"></div>
      </section>
      <div style="height:14px"></div>
      ${slot ? `<button class="btn green" id="bc-log">${icon('check', 19)} Add to ${slotName}</button>`
        : `<button class="btn ghost" data-back="home">All meals logged · Done</button>`}
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const SLOT = S.currentSlot;
    const status = root.querySelector('#bc-status');
    const digits = root.querySelector('#bc-digits');
    let found = null;   // { name, serving, per100, attribution }
    let grams = 100;
    let stream = null, scanTimer = null, busy = false;

    const paint = () => {
      const box = root.querySelector('#bc-result');
      if (!found) { box.style.display = 'none'; return; }
      const m = found.per100 || {};
      const x = grams / 100;
      root.querySelector('#bc-name').textContent = found.name;
      root.querySelector('#bc-serving').textContent = found.serving
        ? `Label serving: ${found.serving} · numbers below are for your ${grams}g`
        : `Numbers below are for your ${grams}g`;
      root.querySelector('#bc-p').textContent = Math.round((m.protein || 0) * x) + 'g';
      root.querySelector('#bc-c').textContent = Math.round((m.carbs || 0) * x) + 'g';
      root.querySelector('#bc-f').textContent = Math.round((m.fat || 0) * x) + 'g';
      root.querySelector('#bc-k').textContent = Math.round((m.kcal || 0) * x);
      root.querySelector('#bc-attr').textContent = found.attribution ? `Source: ${found.attribution}` : '';
      box.style.display = 'block';
    };

    const lookup = async (code) => {
      if (busy) return;
      busy = true;
      status.textContent = 'Looking it up…';
      const res = await fetchFoodByBarcode(code);
      busy = false;
      if (!res) {
        found = null; paint();
        status.textContent = navigator.onLine === false
          ? 'You need a connection for a barcode lookup. The label screen works offline.'
          : 'No match for that code. Not every product is in the database — the label screen always works.';
        return;
      }
      found = res;
      status.textContent = '';
      paint();
    };

    root.querySelector('#bc-lookup').addEventListener('click', () => {
      const code = (digits.value || '').replace(/\D/g, '');
      if (code.length < 8) { status.textContent = 'A barcode is at least 8 digits.'; return; }
      lookup(code);
    });
    digits.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') root.querySelector('#bc-lookup').click(); });

    root.querySelectorAll('#bc-grams .chp').forEach((ch) => ch.addEventListener('click', () => {
      root.querySelectorAll('#bc-grams .chp').forEach((c) => c.classList.remove('on'));
      ch.classList.add('on');
      grams = +ch.dataset.g || 100;
      paint();
    }));

    // Live scan — only where the engine really has it. detect() on an interval rather than rAF:
    // a decode every 350ms reads a steady hand fine and doesn't cook the battery.
    const video = root.querySelector('#bc-video');
    const stop = () => {
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    };

    const logBtn = root.querySelector('#bc-log');
    if (logBtn && SLOT) logBtn.addEventListener('click', () => {
      if (!found) return;
      const m = found.per100 || {}, x = grams / 100;
      window.__act.captureManual({
        protein: (m.protein || 0) * x, carbs: (m.carbs || 0) * x,
        fat: (m.fat || 0) * x, kcal: (m.kcal || 0) * x,
      }, [`${found.name} (${grams}g)`], SLOT, 'label');
      stop();
      location.hash = '#meal-analysis';   // same confirm gate as every other path (WS7)
    });

    if (video && 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      (async () => {
        try {
          const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          video.srcObject = stream;
          scanTimer = setInterval(async () => {
            if (busy || !stream) return;
            try {
              const codes = await det.detect(video);
              const hit = codes && codes[0] && (codes[0].rawValue || '').replace(/\D/g, '');
              if (hit && hit.length >= 8) {
                digits.value = hit;
                if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* no-op */ } }
                lookup(hit);
              }
            } catch { /* a bad frame is not an error state */ }
          }, 350);
        } catch {
          // Camera refused — the typed path above is the whole feature on this device.
          const vf = video.closest('section'); if (vf) vf.style.display = 'none';
        }
      })();
    }
    // The router replaces innerHTML on navigation; stop the camera when the screen goes away
    // (visibilitychange covers backgrounding mid-scan, pagehide covers a WebView teardown).
    window.addEventListener('pagehide', stop, { once: true });
    document.addEventListener('visibilitychange', function onVis() {
      if (document.visibilityState !== 'visible') { stop(); document.removeEventListener('visibilitychange', onVis); }
    });
  },
};
