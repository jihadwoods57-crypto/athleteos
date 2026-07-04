import { S } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

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
    return `
    ${backHead('Morning Weight', 'Required Mon / Wed / Fri · Due by 9:00 AM')}

    <section class="card" style="padding: 8px 18px 20px">
      <div class="weight-display">
        <span class="wv">${W.current}</span> <span class="wu">${W.unit}</span>
      </div>
      <div class="stepper">
        <div class="sbtn">−</div>
        <div style="font-size:12px;font-weight:700;color:var(--text-3)">tap to adjust</div>
        <div class="sbtn">+</div>
      </div>
    </section>

    <div class="eyebrow">Season goal</div>
    <section class="card pad">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-size:14px;font-weight:700;color:var(--text-2)">Trend toward coach target</div>
        <span class="status-pill g">${W.pace}</span>
      </div>
      ${sparkline(W.history)}
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        <div><div class="tiny" style="font-size:11px;font-weight:700">CURRENT</div><div style="font-size:17px;font-weight:800">${W.current} lb</div></div>
        <div><div class="tiny" style="font-size:11px;font-weight:700">THIS MONTH</div><div style="font-size:17px;font-weight:800;color:var(--green-bright)">${W.deltaMonth}</div></div>
        <div style="text-align:right"><div class="tiny" style="font-size:11px;font-weight:700">TARGET</div><div style="font-size:17px;font-weight:800">${W.target} lb</div></div>
      </div>
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">Doesn't touch today's score</div>
      <div class="ts">Weight tracks your season goal, not your daily execution. Logging it keeps your streak and gives ${S.coach.name} the real trend.</div></div>
    </div>

    <div style="height:16px"></div>
    <div class="lrow" style="border:1px solid var(--hairline);border-radius:15px;padding:13px 15px">
      <div class="lic">${icon('camera', 18)}</div>
      <div class="lm"><div class="lt">Add photo proof</div><div class="ls">Optional for this requirement</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>

    <div style="height:18px"></div>
    <button class="btn primary" data-act="logWeight" data-then="home">${icon('check', 19)} Log Weight (late · trend only)</button>
    <div style="height:10px"></div>
    `;
  },
};
