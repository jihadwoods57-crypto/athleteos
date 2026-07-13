/* Shared UI pieces */
import { S } from './state.js';
import { icon } from './icons.js';

/* Every screen is rendered by concatenating template literals into device.innerHTML
   (router.js), so any interpolated value that can carry user- or cross-user-authored text
   is an HTML-injection sink. esc() HTML-entity-escapes the five significant characters,
   including BOTH quote styles, so it is safe in text content AND in double/single-quoted
   attribute contexts. Apply it at every such interpolation. */
export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Image values that flow into url('${...}') / background-image / src. Only allow our own
   bundled assets and self-produced data:image base64 (camera captures, downscaled avatars).
   The strict pattern rejects anything containing quotes, parens or whitespace, so a crafted
   value can never break out of the url() context. Returns '' (harmless) when disallowed. */
export function safeImg(v) {
  const s = String(v == null ? '' : v);
  const ok = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(s)
    || /^assets\/[\w./-]+$/.test(s);
  return ok ? s : '';
}

/* Honest disclosure badge for a gallery-picked (non-live) meal photo. Reuses the existing
   amber .status-pill.a token — no new per-screen color fork. Presentation only: never
   changes scoring, only discloses that this photo wasn't captured live. */
export function nonLiveBadge() {
  return `<span class="status-pill a">${icon('image', 12)} NON-LIVE</span>`;
}

/* Signature score ring — cinematic, uncontained. Layers:
   rotating aurora (CSS) → under-glow arc → thick gradient band → inner echo
   ring → comet tip + lens sparkle → center stack (label / N / /100 / delta / streak). */
export function scoreRing({ score = 82, size = 338, stroke = 20, glow = true, showCenter = true, uid = 'r', delta = null, streak = null, tierName = null, tierCls = 'b', centerNum = false } = {}) {
  const r = (size - stroke) / 2 - 14;
  const rEcho = Math.max(0, r - stroke/2 - 8);
  const cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;
  const off = C * (1 - score / 100);
  // comet tip position (start at top, clockwise)
  const tipA = -Math.PI / 2 + (score / 100) * 2 * Math.PI;
  const tipX = cx + Math.cos(tipA) * r, tipY = cy + Math.sin(tipA) * r;
  // No spark until there's arc to lead — at score 0 the tip would sit orphaned at the
  // top of an empty ring, so the comet only renders once score >= 6.
  const sparkle = score >= 6 ? `
      <g class="ring-tip" opacity="0">
        <circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="${(stroke/2+2).toFixed(1)}" fill="#F2FDF8" filter="url(#tip${uid})"/>
        <path d="M ${tipX.toFixed(1)} ${(tipY-16).toFixed(1)} L ${(tipX+2.4).toFixed(1)} ${(tipY-2.4).toFixed(1)} L ${(tipX+16).toFixed(1)} ${tipY.toFixed(1)} L ${(tipX+2.4).toFixed(1)} ${(tipY+2.4).toFixed(1)} L ${tipX.toFixed(1)} ${(tipY+16).toFixed(1)} L ${(tipX-2.4).toFixed(1)} ${(tipY+2.4).toFixed(1)} L ${(tipX-16).toFixed(1)} ${tipY.toFixed(1)} L ${(tipX-2.4).toFixed(1)} ${(tipY-2.4).toFixed(1)} Z"
          fill="#FFFFFF" opacity="0.9" filter="url(#tip${uid})"/>
      </g>` : '';

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
      <!-- track: dotted "ready" style below score 6 so an empty day reads as unstarted, not broken -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(148,176,224,0.10)" stroke-width="${stroke}"${score < 6 ? ' stroke-dasharray="1.4 5"' : ''}/>
      <!-- main band -->
      <circle class="ring-arc" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#g${uid})"
        stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-off="${off.toFixed(1)}"
        transform="rotate(-90 ${cx} ${cy})"/>
      <!-- inner echo ring (clamped ≥0: compact rings, e.g. the 52px score strip, would
           otherwise compute a negative radius and emit an invalid SVG r attribute) -->
      <circle class="ring-arc ring-echo" cx="${cx}" cy="${cy}" r="${rEcho}" fill="none" stroke="url(#g${uid})"
        stroke-width="1.5" opacity="0.35"
        stroke-dasharray="${(2*Math.PI*rEcho).toFixed(1)}"
        stroke-dashoffset="${(2*Math.PI*rEcho).toFixed(1)}"
        data-off="${((2*Math.PI*rEcho) * (1 - score/100)).toFixed(1)}"
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
    ${centerNum ? `<div class="ring-center num"><span class="score" data-count="${score}">0</span></div>` : ''}
  </div>`;
}

/* animate ring draw (all arc layers) + number count-up + comet tip fade. Call in mount().
   Respects prefers-reduced-motion: CSS kills the arc/tip transitions via !important, but the
   JS number tween runs outside CSS — so it snaps to the final value here. */
export function animateRing(root) {
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    root.querySelectorAll('.ring-arc').forEach(arc => { arc.style.strokeDashoffset = arc.dataset.off; });
    const tip = root.querySelector('.ring-tip');
    if (tip) tip.style.opacity = '1';
    const num = root.querySelector('[data-count]');
    if (num) num.textContent = String(Math.round(+num.dataset.count));
    return;
  }
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
      <div class="name">${esc(S.athlete.first)}</div>
    </div>
    <div class="actions">
      <div class="iconbtn" data-go="notifications" role="button" aria-label="${n ? `Notifications, ${n} unread` : 'Notifications'}">${icon('bell', 20)}${n ? `<span class="dot">${n > 9 ? '9+' : n}</span>` : ''}</div>
      ${S.athlete.avatar && safeImg(S.athlete.avatar)
        ? `<div class="avatar" data-go="profile" style="background-image:url('${safeImg(S.athlete.avatar)}');background-size:cover;background-position:center"></div>`
        : `<div class="avatar" data-go="profile">${esc(S.athlete.initials)}</div>`}
    </div>
  </header>`;
}

export function backHead(title, sub, to = 'home') {
  // title/sub can carry cross-user text (e.g. a coach-assigned requirement title) — escape here
  // so every caller is safe. All current callers pass plain text, so this only hardens.
  return `<div class="back-head">
    <div class="bk" data-go="${to}">${icon('back', 20)}</div>
    <div><div class="ht">${esc(title)}</div>${sub ? `<div class="hs">${esc(sub)}</div>` : ''}</div>
  </div>`;
}

/* A tab-root header: same title/sub layout as backHead, but NO back chevron and no data-go —
   there is nowhere "back" to go from a role's own dashboard tab. Using backHead(...,'profile')
   on a tab root was the cross-role back-nav bug (coach/trainer dashboards' chevron landing in
   the ATHLETE profile screen, since 'profile' is the athlete tab route). Tab roots use this
   instead; sub-screens keep backHead pointed at their own role's home. */
export function titleHead(title, sub) {
  return `<div class="back-head">
    <div><div class="ht">${esc(title)}</div>${sub ? `<div class="hs">${esc(sub)}</div>` : ''}</div>
  </div>`;
}

/* Shared composer (text input + send) markup — the single source for every "ask/comment/note"
   bar in the app. A real native <button> gives free keyboard operability (Tab focus, Enter AND
   Space activation) with zero extra JS — a bare <div class="send"> had neither. Both the input
   and the send control carry an accessible name so a screen reader announces something other
   than a silent icon. esc() runs INSIDE this helper: callers must pass RAW placeholder/label/
   sendLabel text, never pre-escaped, or it double-encodes. When a caller has no click handler
   for send (e.g. foodsearch, which searches live on input), pass decorativeSend so it renders
   an aria-hidden <span> instead of an inert, falsely-actionable button. */
export function composer({
  inputId = '', sendId = '', placeholder = '', inputLabel = placeholder, sendLabel = 'Send',
  sendIcon = 'arrowUp', sendIconSize = 19, sendStyle = '', wrapStyle = '',
  autocompleteOff = true, decorativeSend = false,
} = {}) {
  const sendAttrs = `class="send"${sendId ? ` id="${sendId}"` : ''}${sendStyle ? ` style="${sendStyle}"` : ''}`;
  const sendEl = decorativeSend
    ? `<span ${sendAttrs} aria-hidden="true">${icon(sendIcon, sendIconSize)}</span>`
    : `<button type="button" ${sendAttrs} aria-label="${esc(sendLabel)}">${icon(sendIcon, sendIconSize)}</button>`;
  return `<div class="composer"${wrapStyle ? ` style="${wrapStyle}"` : ''}>
    <input${inputId ? ` id="${inputId}"` : ''} placeholder="${esc(placeholder)}" aria-label="${esc(inputLabel)}"${autocompleteOff ? ' autocomplete="off"' : ''} />
    ${sendEl}
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
