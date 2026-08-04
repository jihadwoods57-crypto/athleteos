import { S } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { freqLabel, fmtMin } from '../requirements.js';

/* The schedule this screen states must be the SAME row Plan → Schedule renders — the weigh-in
   frequency and deadline are coach-configurable, so a hardcoded "Mon / Wed / Fri · 9:00 AM"
   lies the moment a coach moves it. No row (nothing scheduled) → neutral copy, never a claim. */
function weighSubtitle() {
  try {
    const r = (S.scheduleCatalog || []).find(x => x.proof === 'scale');
    if (r && r.freq && r.window) {
      return `${freqLabel(r.freq)} · ${r.window.label || `Due by ${fmtMin(r.window.due)}`}`;
    }
  } catch { /* honest default below */ }
  return 'Same time, same conditions — we read the trend';
}

function sparkline(hist, w = 300, h = 70) {
  const min = Math.min(...hist), max = Math.max(...hist);
  const pts = hist.map((v, i) => {
    const x = (i / (hist.length - 1)) * (w - 12) + 6;
    const y = h - 10 - ((v - min) / (max - min || 1)) * (h - 24);
    return [x, y];
  });
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="trendline" width="100%" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="wg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#3B82F6" stop-opacity="0.4"/><stop offset="100%" stop-color="#34D399"/>
    </linearGradient></defs>
    <path d="${d}" fill="none" stroke="url(#wg)" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="#34D399"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="8.5" fill="#34D399" opacity="0.25"/>
  </svg>`;
}

export default {
  tab: 'home',
  render() {
    const W = S.weight;
    // The stepper is an INPUT: seed it with a real prior value if we have one, else the season
    // start; only fall back to a neutral number so ± works. It's what you're about to log, not
    // a claim about the past.
    const seed = W.current != null ? parseFloat(W.current) : (W.start != null ? W.start : 150);
    const hasTrend = W.history.length >= 2;
    // Time-honest "late": derived from the exec engine's real window state, never asserted.
    // On a non-weigh-in day weight isn't in exec items → not late. If exec throws → not late.
    let isLate = false;
    try {
      const wItem = (S.exec.items || []).find(i => i.id === 'weight');
      isLate = !!wItem && (wItem.state === 'overdue' || wItem.state === 'done_late');
    } catch { /* honest default: no late claim */ }
    return `
    ${backHead('Morning Weight', weighSubtitle())}

    <section class="card" style="padding: 8px 18px 20px">
      <div class="weight-display">
        <input class="wv" id="wv-input" type="text" inputmode="decimal" autocomplete="off"
          value="${seed.toFixed(1)}" aria-label="Weight in ${W.unit}" maxlength="5"> <span class="wu">${W.unit}</span>
      </div>
      <div class="stepper">
        <div class="sbtn" aria-label="Down 0.1">−</div>
        <div style="font-size:12px;font-weight:700;color:var(--text-3)">tap the number to type it</div>
        <div class="sbtn" aria-label="Up 0.1">+</div>
      </div>
      <div id="wv-err" style="display:none;text-align:center;font-size:12px;font-weight:700;color:var(--amber-bright);margin-top:10px">Enter a weight between 50 and 500 ${W.unit}</div>
    </section>

    ${W.target != null ? `
    <div class="eyebrow">Season goal</div>
    <section class="card pad">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-size:14px;font-weight:700;color:var(--text-2)">Trend toward ${S.coach.hasCoach ? `your ${S.coach.noun}'s` : 'your'} target</div>
        ${W.pace ? `<span class="status-pill ${W.pace === 'On pace' ? 'g' : 'a'}">${W.pace}</span>` : ''}
      </div>
      ${hasTrend ? sparkline(W.history) : `<div style="font-size:13px;font-weight:600;color:var(--text-3);padding:14px 0 6px">Log a few days and your trend line shows up here.</div>`}
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        <div><div class="tiny" style="font-size:11px;font-weight:700">CURRENT</div><div style="font-size:17px;font-weight:800">${W.current != null ? W.current + ' lb' : '—'}</div></div>
        ${W.deltaMonth ? `<div><div class="tiny" style="font-size:11px;font-weight:700">CHANGE</div><div style="font-size:17px;font-weight:800;color:var(--text-2)">${W.deltaMonth}</div></div>` : ''}
        <div style="text-align:right"><div class="tiny" style="font-size:11px;font-weight:700">TARGET</div><div style="font-size:17px;font-weight:800">${W.target} lb</div></div>
      </div>
    </section>` : `
    <div class="eyebrow">Season goal</div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('target', 18)}</div>
      <div><div class="tt">No season target set yet</div>
      <div class="ts">Your ${S.coach.noun} sets your weight goal. Until then, logging still builds your season trend.</div></div>
    </div>`}

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">Doesn't touch today's score</div>
      <div class="ts">Weight tracks your season goal, not your daily execution. ${S.coach.hasCoach ? `Logging it gives ${esc(S.coach.nameMid)} the real trend.` : 'Logging it keeps your season trend honest.'}</div></div>
    </div>

    <div style="height:18px"></div>
    <button class="btn primary" id="log-weight-btn">${icon('check', 19)} ${isLate ? 'Log Weight (late)' : 'Log Weight'}</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    // The big number is a real decimal INPUT now (founder 2026-08-04: stepping by 0.1 was too
    // slow) — tap it to type, or nudge with the ± steppers. Both drive the same value.
    const wv = root.querySelector('#wv-input');
    const err = root.querySelector('#wv-err');
    const read = () => parseFloat(String(wv.value).replace(',', '.'));
    const valid = (v) => isFinite(v) && v >= 50 && v <= 500;
    const showErr = (bad) => { if (err) err.style.display = bad ? 'block' : 'none'; };
    const [minus, plus] = root.querySelectorAll('.stepper .sbtn');
    const nudge = (d) => {
      const v = read();
      const base = valid(v) ? v : 150;
      wv.value = Math.min(500, Math.max(50, base + d)).toFixed(1);
      showErr(false);
    };
    if (wv && minus && plus) {
      minus.addEventListener('click', () => nudge(-0.1));
      plus.addEventListener('click', () => nudge(+0.1));
      // Tap-to-type: select the whole value so typing replaces it — no cursor fiddling.
      wv.addEventListener('focus', () => { try { wv.select(); } catch { /* older WebView */ } });
      wv.addEventListener('input', () => showErr(false));
      wv.addEventListener('blur', () => { const v = read(); if (valid(v)) wv.value = v.toFixed(1); });
    }
    // Log the REAL value shown — never a demo constant. Out-of-range never logs (act.logWeight
    // carries the same 50–500 rail), it explains instead.
    const btn = root.querySelector('#log-weight-btn');
    if (btn && wv) btn.addEventListener('click', async () => {
      const v = read();
      if (!valid(v)) { showErr(true); try { wv.focus(); } catch { /* no-op */ } return; }
      await window.__act.logWeight(v);
      window.__back('home'); // return to the exact origin (Progress, the sheet's origin, or Home)
    });
  },
};
