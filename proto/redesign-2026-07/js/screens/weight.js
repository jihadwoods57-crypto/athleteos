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
        <span class="wv">${seed.toFixed(1)}</span> <span class="wu">${W.unit}</span>
      </div>
      <div class="stepper">
        <div class="sbtn">−</div>
        <div style="font-size:12px;font-weight:700;color:var(--text-3)">tap to adjust</div>
        <div class="sbtn">+</div>
      </div>
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
    // stepper actually adjusts the display value
    const wv = root.querySelector('.weight-display .wv');
    const [minus, plus] = root.querySelectorAll('.stepper .sbtn');
    if (wv && minus && plus) {
      minus.addEventListener('click', () => { wv.textContent = (parseFloat(wv.textContent) - 0.1).toFixed(1); });
      plus.addEventListener('click', () => { wv.textContent = (parseFloat(wv.textContent) + 0.1).toFixed(1); });
    }
    // Log the REAL value shown in the stepper — never a demo constant.
    const btn = root.querySelector('#log-weight-btn');
    if (btn && wv) btn.addEventListener('click', async () => {
      await window.__act.logWeight(parseFloat(wv.textContent));
      window.__back('home'); // return to the exact origin (Progress, the sheet's origin, or Home)
    });
  },
};
