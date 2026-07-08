import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

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
  hideTabs: true,
  render() {
    const slot = S.currentSlot;
    const slotName = slot ? slot.charAt(0).toUpperCase() + slot.slice(1) : 'meal';
    return `
    ${backHead(`Search Food · ${slotName}`, 'When a photo isn’t possible. Same score rules.', 'camera')}

    <div class="composer" style="margin-top:2px">
      <input id="fs-input" placeholder="Search foods…" autocomplete="off" />
      <div class="send" style="background:var(--surface-2);color:var(--text)">${icon('search', 18)}</div>
    </div>

    <div class="eyebrow">Results</div>
    <section class="card" style="padding:2px 0" id="fs-results"></section>

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
      ? `<button class="btn ghost" data-go="home">All meals logged · Back Home</button>`
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
        <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--hairline-soft)">
          <span style="flex:1;font-size:14px;font-weight:700">${x.n} <small style="color:var(--text-3)">· ${x.unit}</small></span>
          <span class="wb2" data-i="${i}" data-d="-1" style="padding:5px 11px">−</span>
          <span style="font-size:14px;font-weight:800;width:26px;text-align:center">${x.q}</span>
          <span class="wb2" data-i="${i}" data-d="1" style="padding:5px 11px">+</span>
        </div>`).join('');
      items.querySelectorAll('.wb2').forEach(b => b.addEventListener('click', () => {
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
          <div class="lm"><div class="lt">${x.n}</div><div class="ls">${x.unit} · ${x.p}g protein · ${x.kc} cal</div></div>
        </div>`).join('')
        : `<div style="padding:16px;font-size:13px;font-weight:600;color:var(--text-3)">No match. The full database lands with the backend; photo logging always works.</div>`;
      results.querySelectorAll('[data-add]').forEach(r => r.addEventListener('click', () => {
        const f = DB[+r.dataset.add];
        const hit = plate.find(x => x.n === f.n);
        if (hit) hit.q += 1; else plate.push({ ...f, q: 1 });
        renderPlate();
      }));
    };
    // Log the REAL assembled plate into the real open slot — not a demo constant.
    if (logBtn) logBtn.addEventListener('click', () => {
      if (!plate.length || !SLOT) return;
      const sum = plate.reduce((a, x) => ({ p: a.p + x.p * x.q, c: a.c + x.c * x.q, f: a.f + x.f * x.q, kc: a.kc + x.kc * x.q }), { p: 0, c: 0, f: 0, kc: 0 });
      window.__act.captureManual({ protein: sum.p, carbs: sum.c, fat: sum.f, kcal: sum.kc }, plate.map(x => x.n), SLOT);
      window.__act.logMeal(SLOT);
      location.hash = '#meal-confirm';
    });

    input.addEventListener('input', () => renderResults(input.value));
    renderResults('');
    renderTotals();
  },
};

/* ---------- Scan Label: exact transcription, serving multiplier ---------- */
export const labelScan = {
  tab: 'camera',
  hideTabs: true,
  render() {
    const rows = [['Serving size', '1 bar (50g)'], ['Calories', '140'], ['Protein', '25g'], ['Total carbs', '5g'], ['Total fat', '2g'], ['Sodium', '135mg']];
    const peanutAllergy = RT.allergies.some(a => a.toLowerCase().includes('peanut'));
    const slot = S.currentSlot;
    const slotName = slot ? slot.charAt(0).toUpperCase() + slot.slice(1) : 'meal';
    return `
    ${backHead('Scan Label', 'Exact numbers off the panel, never estimates', 'camera')}

    <div class="scanbox" style="width:100%;height:150px;border-radius:20px">
      <div class="img" style="background:linear-gradient(160deg,#e8e6df,#cfcdc6);display:grid;place-items:center">
        <div style="text-align:center;color:#1a1a1a;font-family:Arial">
          <div style="font-weight:800;font-size:13px;letter-spacing:0.02em;border:2px solid #1a1a1a;padding:6px 14px">NUTRITION FACTS</div>
          <div style="font-size:9px;font-weight:700;margin-top:5px">PEANUT BUTTER PROTEIN BAR · CONTAINS: PEANUTS</div>
        </div>
      </div>
      <div class="scanline"></div>
    </div>

    ${peanutAllergy ? `
    <div style="height:14px"></div>
    <div class="state-demo err-box" style="text-align:left;margin-bottom:0;padding:15px 16px">
      <div style="display:flex;gap:12px;align-items:flex-start">
        <div class="sd-ic" style="width:42px;height:42px;margin:0;border-radius:13px">${icon('bell', 20)}</div>
        <div>
          <div class="sd-t" style="font-size:15px">Guardian: contains peanuts</div>
          <div class="sd-s" style="margin-top:4px">Your restriction list flags this as <b style="color:var(--red)">severe</b>. If you log it as eaten, ${S.coach.name} and your parent are notified immediately.</div>
        </div>
      </div>
    </div>` : ''}

    <div class="eyebrow">Transcribed panel</div>
    <section class="card" style="padding:4px 18px">
      ${rows.map(([k, v], i) => `
        <div style="display:flex;justify-content:space-between;padding:11px 0;${i < rows.length - 1 ? 'border-bottom:1px solid var(--hairline-soft)' : ''}">
          <span style="font-size:14px;font-weight:700;color:var(--text-2)">${k}</span>
          <span style="font-size:14.5px;font-weight:800" data-base="${v}">${v}</span>
        </div>`).join('')}
    </section>

    <div class="eyebrow">Servings</div>
    <div class="chip-row" id="serv" data-toggle-group>
      <span class="chp on" data-m="1">1</span>
      <span class="chp" data-m="1.5">1.5</span>
      <span class="chp" data-m="2">2</span>
    </div>

    <div style="height:16px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">Panel numbers are locked</div>
      <div class="ts">The AI transcribes exactly what the label says and only multiplies by your servings. It never guesses a packaged food.</div></div>
    </div>

    <div style="height:16px"></div>
    ${peanutAllergy
      ? `<button class="btn ghost" style="border:1.5px solid var(--red-border);color:var(--red)" data-go="camera">${icon('x', 18)} Not for you · scan something else</button>`
      : !slot
        ? `<button class="btn ghost" data-go="home">All meals logged · Back Home</button>`
        : `<button class="btn green" id="ls-log">${icon('check', 19)} Add to ${slotName}</button>`}
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const { wireToggles } = await import('./settings.js');
    wireToggles(root);
    let mult = 1;
    // serving multiplier really recomputes the numeric rows
    root.querySelectorAll('#serv .chp').forEach(ch => ch.addEventListener('click', () => {
      const m = +ch.dataset.m; mult = m;
      root.querySelectorAll('[data-base]').forEach(el => {
        const base = el.getAttribute('data-base');
        const num = parseFloat(base);
        if (!isNaN(num) && !base.startsWith('1 scoop')) {
          const unit = base.replace(/^[\d.]+/, '');
          el.textContent = (Math.round(num * m * 10) / 10) + unit;
        }
      });
    }));
    // Log the REAL transcribed panel (× servings) into the real open slot.
    const lsBtn = root.querySelector('#ls-log');
    const SLOT = S.currentSlot;
    if (lsBtn && SLOT) lsBtn.addEventListener('click', () => {
      window.__act.captureManual(
        { protein: 25 * mult, carbs: 5 * mult, fat: 2 * mult, kcal: 140 * mult },
        ['Protein bar'], SLOT);
      window.__act.logMeal(SLOT);
      location.hash = '#meal-confirm';
    });
  },
};
