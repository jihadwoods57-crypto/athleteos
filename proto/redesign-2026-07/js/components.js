/* Shared UI pieces */
import { S } from './state.js';
import { icon } from './icons.js';

/* Signature score ring — cinematic, uncontained. Layers:
   rotating aurora (CSS) → under-glow arc → thick gradient band → inner echo
   ring → comet tip + lens sparkle → center stack (label / N / /100 / delta / streak). */
export function scoreRing({ score = 82, size = 338, stroke = 20, glow = true, showCenter = true, uid = 'r', delta = null, streak = null, tierName = null, tierCls = 'b' } = {}) {
  const r = (size - stroke) / 2 - 14;
  const cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;
  const off = C * (1 - score / 100);
  // comet tip position (start at top, clockwise)
  const tipA = -Math.PI / 2 + (score / 100) * 2 * Math.PI;
  const tipX = cx + Math.cos(tipA) * r, tipY = cy + Math.sin(tipA) * r;
  const sparkle = `
      <g class="ring-tip" opacity="0">
        <circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="${(stroke/2+2).toFixed(1)}" fill="#F2FDF8" filter="url(#tip${uid})"/>
        <path d="M ${tipX.toFixed(1)} ${(tipY-16).toFixed(1)} L ${(tipX+2.4).toFixed(1)} ${(tipY-2.4).toFixed(1)} L ${(tipX+16).toFixed(1)} ${tipY.toFixed(1)} L ${(tipX+2.4).toFixed(1)} ${(tipY+2.4).toFixed(1)} L ${tipX.toFixed(1)} ${(tipY+16).toFixed(1)} L ${(tipX-2.4).toFixed(1)} ${(tipY+2.4).toFixed(1)} L ${(tipX-16).toFixed(1)} ${tipY.toFixed(1)} L ${(tipX-2.4).toFixed(1)} ${(tipY-2.4).toFixed(1)} Z"
          fill="#FFFFFF" opacity="0.9" filter="url(#tip${uid})"/>
      </g>`;

  return `
  <div class="ring-wrap" style="width:${size}px;height:${size}px">
    ${glow ? '<div class="aurora"></div><div class="glow"></div>' : ''}
    <svg class="ring-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="g${uid}" x1="0.05" y1="0.15" x2="0.95" y2="0.75">
          <stop offset="0%" stop-color="#A3E635"/>
          <stop offset="30%" stop-color="#34D399"/>
          <stop offset="60%" stop-color="#22D3EE"/>
          <stop offset="100%" stop-color="#3B82F6"/>
        </linearGradient>
        <filter id="soft${uid}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="9"/>
        </filter>
        <filter id="tip${uid}" x="-160%" y="-160%" width="420%" height="420%">
          <feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <!-- under-glow: same arc, wider + blurred, light spills onto the canvas -->
      <circle class="ring-arc ring-under" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#g${uid})"
        stroke-width="${stroke + 14}" stroke-linecap="round" opacity="0.55" filter="url(#soft${uid})"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-off="${off.toFixed(1)}"
        transform="rotate(-90 ${cx} ${cy})"/>
      <!-- track -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(148,176,224,0.10)" stroke-width="${stroke}"/>
      <!-- main band -->
      <circle class="ring-arc" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#g${uid})"
        stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-off="${off.toFixed(1)}"
        transform="rotate(-90 ${cx} ${cy})"/>
      <!-- inner echo ring -->
      <circle class="ring-arc ring-echo" cx="${cx}" cy="${cy}" r="${r - stroke/2 - 8}" fill="none" stroke="url(#g${uid})"
        stroke-width="1.5" opacity="0.35"
        stroke-dasharray="${(2*Math.PI*(r - stroke/2 - 8)).toFixed(1)}"
        stroke-dashoffset="${(2*Math.PI*(r - stroke/2 - 8)).toFixed(1)}"
        data-off="${((2*Math.PI*(r - stroke/2 - 8)) * (1 - score/100)).toFixed(1)}"
        transform="rotate(-90 ${cx} ${cy})"/>
      ${sparkle}
    </svg>
    ${showCenter ? `<div class="ring-center">
      <span class="label">OnStandard Score</span>
      <span class="score" data-count="${score}">0</span>
      <span class="outof">/100</span>
      ${tierName ? `<span class="tier-chip ${tierCls}">${tierName}</span>` : ''}
      ${delta ? `<span class="delta"><span class="up">${icon('arrowUp', 15)} ${delta}</span><span class="muted">vs yesterday</span></span>` : ''}
      ${streak ? `<span class="streak-pill">${icon('flame', 15, 'class="flame"')} ${streak}</span>` : ''}
    </div>` : ''}
  </div>`;
}

/* animate ring draw (all arc layers) + number count-up + comet tip fade. Call in mount(). */
export function animateRing(root) {
  root.querySelectorAll('.ring-arc').forEach(arc => {
    arc.style.transition = 'stroke-dashoffset var(--dur-ring) var(--ease-out)';
    requestAnimationFrame(() => requestAnimationFrame(() => { arc.style.strokeDashoffset = arc.dataset.off; }));
  });
  const tip = root.querySelector('.ring-tip');
  if (tip) { tip.style.transition = 'opacity 600ms ease'; setTimeout(() => { tip.style.opacity = '1'; tip.classList.add('pulse'); }, 1150); }
  const num = root.querySelector('[data-count]');
  if (num) {
    const target = +num.dataset.count; const dur = 1200; const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      num.textContent = Math.round(target * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

/* Brand mark: the score ring broken open at the top-right, with the check's
   long stroke rising through the gap — "clear the standard, then rise past it." */
export function logoMark(size = 96, uid = 'lm') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
    <defs>
      <linearGradient id="lg${uid}" x1="0.1" y1="0.85" x2="0.9" y2="0.15">
        <stop offset="0%" stop-color="#34D399"/>
        <stop offset="50%" stop-color="#22D3EE"/>
        <stop offset="100%" stop-color="#3B82F6"/>
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="25" stroke="url(#lg${uid})" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="118 39" transform="rotate(76 32 32)"/>
    <path d="M19 34 L29 44 L51 15" stroke="url(#lg${uid})" stroke-width="7.5"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function appHead() {
  const n = S.unreadNotifs;
  return `<header class="apphead">
    <div>
      <div class="greeting">${S.greeting},</div>
      <div class="name">${S.athlete.first}</div>
    </div>
    <div class="actions">
      <div class="iconbtn" data-go="notifications">${icon('bell', 20)}${n ? `<span class="dot">${n}</span>` : ''}</div>
      <div class="avatar" data-go="profile">${S.athlete.initials}</div>
    </div>
  </header>`;
}

export function backHead(title, sub, to = 'home') {
  return `<div class="back-head">
    <div class="bk" data-go="${to}">${icon('back', 20)}</div>
    <div><div class="ht">${title}</div>${sub ? `<div class="hs">${sub}</div>` : ''}</div>
  </div>`;
}

/* a stylized "plate of food" thumbnail (no photo dependency, reads premium) */
export function mealMedia(hue = '20', h = 96) {
  return `<div class="act-media" style="height:${h}px;background:
    radial-gradient(60% 80% at 50% 40%, hsl(${hue} 45% 22%), hsl(${(+hue+30)} 40% 12%));">
    <svg width="100%" height="100%" viewBox="0 0 156 ${h}" preserveAspectRatio="xMidYMid slice" style="position:absolute;inset:0">
      <ellipse cx="78" cy="${h/2+6}" rx="46" ry="30" fill="hsl(${hue} 20% 90% / .08)"/>
      <circle cx="62" cy="${h/2}" r="16" fill="hsl(${hue} 55% 55% / .55)"/>
      <circle cx="92" cy="${h/2-6}" r="12" fill="hsl(${(+hue+40)} 60% 60% / .5)"/>
      <circle cx="94" cy="${h/2+12}" r="9" fill="hsl(${(+hue+80)} 55% 55% / .5)"/>
    </svg>
  </div>`;
}
