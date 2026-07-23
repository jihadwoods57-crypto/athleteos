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
   bundled assets, self-produced data:image base64 (camera captures, downscaled avatars), and
   signed URLs from OUR storage host (meal photos resolved by photo-store.js). Every pattern
   rejects quotes, parens and whitespace, so a crafted value can never break out of the url()
   context. Returns '' (harmless) when disallowed. */
export function safeImg(v) {
  const s = String(v == null ? '' : v);
  const ok = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(s)
    || /^assets\/[\w./-]+$/.test(s)
    || /^https:\/\/[\w-]+\.supabase\.(?:co|in)\/storage\/v1\/[\w/.\-?=&%~]+$/.test(s);
  return ok ? s : '';
}

/* ---------- GS-2 state primitives (universal state coverage, T-22) ----------
   One visual language for the states every data-bearing surface owes the user: loading (a
   skeleton, never a spinner-in-content), empty (teaches + a DIRECT action, never a dead pointer),
   error (honest + retry, no fabricated data), and permission-denied (honest, role-scoped, no
   dangling controls). Built on the existing .state-demo / .err-box / .sk-* CSS so every screen
   reads identically. Pure string builders — the caller wires any button id in its own mount(). */

/** The honest loading state: `n` shimmer rows shaped like the list they stand in for. */
export function skeletonRows(n = 3, label = 'Loading') {
  const row = '<div class="sk-row"><div class="sk-dot"></div><div class="sk-lines"><div class="sk-line"></div><div class="sk-line sk-line-2"></div></div></div>';
  return `<section class="card sk-card" aria-busy="true" aria-label="${esc(label)}" style="padding:6px 16px">${row.repeat(Math.max(1, n | 0))}</section>`;
}

/** Empty state that teaches and offers a DIRECT action — never a dead pointer. `action` is
 *  { label, go } (a data-go route) or { label, id } (a button the caller's mount wires), or null. */
export function emptyState({ icon: ic = 'sparkle', title, body = '', action = null } = {}) {
  const a = action
    ? `<div class="sd-cta"><button class="btn ghost sm" ${action.go ? `data-go="${esc(action.go)}"` : ''}${action.id ? ` id="${esc(action.id)}"` : ''} style="width:auto;padding:0 18px">${esc(action.label)}</button></div>`
    : '';
  return `<section class="state-demo"><div class="sd-ic">${icon(ic, 24)}</div>
    <div class="sd-t">${esc(title)}</div>${body ? `<div class="sd-s">${esc(body)}</div>` : ''}${a}</section>`;
}

/** Honest error + retry. `retryId` is wired by the caller's mount(); omit for a non-retryable note. */
export function errorState({ title = "Couldn't load this", body = 'Reconnect and it loads right here — nothing was lost.', retryId = null } = {}) {
  const a = retryId ? `<div class="sd-cta"><button class="btn ghost sm" id="${esc(retryId)}" style="width:auto;padding:0 18px">${icon('wifiOff', 15)} Retry</button></div>` : '';
  return `<section class="state-demo err-box"><div class="sd-ic">${icon('wifiOff', 24)}</div>
    <div class="sd-t">${esc(title)}</div><div class="sd-s">${esc(body)}</div>${a}</section>`;
}

/** Permission-denied — honest and role-scoped, with no dangling controls. */
export function permissionState({ title = 'Not your access', body = 'Your head coach can open this for you.' } = {}) {
  return `<section class="state-demo"><div class="sd-ic">${icon('shield', 24)}</div>
    <div class="sd-t">${esc(title)}</div><div class="sd-s">${esc(body)}</div></section>`;
}

/* Honest disclosure badge for a gallery-picked meal photo. Gallery photos SCORE now (founder
   reversal 2026-07-15; the integrity wall is the 0062 photo-hash duplicate check) — this badge
   is pure transparency for athlete + coach, never a scoring signal. Neutral by design (spec
   §5.7): gallery uploads aren't treated differently in scoring, so no warning color. */
export function nonLiveBadge() {
  return `<span class="status-pill muted">${icon('image', 12)} Gallery upload</span>`;
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

/* Brand mark: the "Performance Dial" (docs/brand/LOGO.md — the founder's hi-fi handoff,
   the same mark as the app icon and onstandard.app) — a score gauge reading at the very
   top of its scale whose silhouette reads as the letter "O". The progress arc carries the
   signature green→teal→blue sweep (founder-ratified 2026-07-14); on-dark track/marker. */
export function logoMark(size = 96, uid = 'lm') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" fill="none">
    <defs>
      <linearGradient id="dial${uid}" x1="26" y1="82" x2="58" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#34D399"/>
        <stop offset="50%" stop-color="#22D3EE"/>
        <stop offset="100%" stop-color="#60A5FA"/>
      </linearGradient>
    </defs>
    <path d="M33 81.4 A34 34 0 1 1 67 81.4" stroke="rgba(255,255,255,0.16)" stroke-width="12" stroke-linecap="round"/>
    <path d="M33 81.4 A34 34 0 0 1 50 18" stroke="url(#dial${uid})" stroke-width="12" stroke-linecap="round"/>
    <circle cx="50" cy="18" r="10.5" fill="#0F172A"/>
    <circle cx="50" cy="18" r="6" fill="#FFFFFF"/>
  </svg>`;
}

export function appHead(sub, extra) {
  const n = S.unreadNotifs;
  return `<header class="apphead">
    <div>
      <div class="greeting">${S.greeting},</div>
      <div class="name">${esc(S.athlete.first)}</div>
      ${sub ? `<div class="apphead-sub">${esc(sub)}</div>` : ''}
    </div>
    <div class="actions">
      ${extra || ''}
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
  // `to` is the FALLBACK only: data-back pops the per-tab origin stack (exact screen + scroll,
  // router.js), so back always returns where the user actually came from.
  return `<div class="back-head">
    <div class="bk" data-back="${to}" role="button" aria-label="Back">${icon('back', 20)}</div>
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

/* A coach tab-root header: titleHead + the account avatar (initials) top-right.
   Profile left the tab bar (Coach OS slice A) — the avatar is its one home. */
export function avatarHead(title, sub, initials) {
  return `<div class="back-head" style="align-items:center">
    <div style="flex:1;min-width:0"><div class="ht">${esc(title)}</div>${sub ? `<div class="hs">${esc(sub)}</div>` : ''}</div>
    <div role="button" aria-label="Your profile" data-go="coach-profile"
      style="width:40px;height:40px;border-radius:50%;background:var(--blue-surface);color:var(--blue-bright);display:grid;place-items:center;font-size:13px;font-weight:800;letter-spacing:0.02em;flex:none;cursor:pointer">${esc(initials || 'C')}</div>
  </div>`;
}

export function sparkline(hist) {
  const pts = (hist || []).filter(h => h.score != null).slice(-7);
  if (pts.length < 2) return `<span style="font-size:10px;color:var(--text-3);font-weight:700">—</span>`;
  const w = 44, h = 16, min = 0, max = 100;
  const xy = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - ((p.score - min) / (max - min)) * h}`).join(' ');
  const up = pts[pts.length - 1].score >= pts[0].score;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${xy}" fill="none" stroke="${up ? 'var(--green-bright)' : 'var(--red)'}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/></svg>`;
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

/* Collapsible section (WS6 — the proto's first collapse primitive). Native <details>/<summary>
   so there is no JS state machine; the summary reuses the .xgrp group-header look. Callers
   persist open-state per section id (Home uses RT.homeOpenSections via act.setHomeSection) so
   the 30s exec-tick re-render never resets what the athlete opened. `inner` must be
   pre-escaped HTML (the same strings the sections rendered before). */
export function collapseSection(id, title, count, inner, open) {
  return `<details class="xcollapse" data-sec="${esc(id)}"${open ? ' open' : ''}>
    <summary class="xgrp xsum">${esc(title)}${count != null ? ` · ${count}` : ''}<span class="xchev">${icon('chevron', 14)}</span></summary>
    <div class="xcollapse-body">${inner}</div>
  </details>`;
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

/* ---------------- Plan style card (0142) ----------------
   ONE component for "what plan style am I on, who set it, and can I change it" — used on Plan,
   Settings, and the professional's roster so the answer can never differ between two screens.

   The honesty rules it encodes:
     * a LOCKED athlete still sees their own stated preference, marked as shared with the person
       who owns the setting. Never a dead end, never a silently-ignored answer.
     * `customized` is disclosed. A client on "Guided" whose RD tightened the bands is not on the
       same plan as a client on stock Guided, and the card says so.
     * the source line always names a real person or an honest generic — never a fabricated one.

   `style` is the S.planStyle shape. `onChange` is a data-go route, omitted when locked. */
export function planStyleCard(style, { onChange = null, compact = false } = {}) {
  if (!style) return '';
  const pref = style.preferenceDiffers && style.preferenceName
    ? `<div class="ps-pref">Your preference: <b>${esc(style.preferenceName)}</b> · shared with ${esc(style.lockedBy || 'your coach')}</div>`
    : '';
  const change = onChange && style.canChoose
    ? `<button class="btn ghost sm" data-go="${esc(onChange)}">Change</button>`
    : (style.locked ? `<span class="status-pill a">Set for you</span>` : '');
  return `
  <section class="card ps-card" style="padding:14px 16px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
      <div style="min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--text-3);letter-spacing:.02em">PLAN STYLE</div>
        <div style="font-size:17px;font-weight:800;margin-top:2px">${esc(style.name)}${style.customized ? ' <span style="font-size:12.5px;font-weight:700;color:var(--text-3)">(customized)</span>' : ''}</div>
        <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(style.sourceLabel)}</div>
      </div>
      ${change}
    </div>
    ${compact ? '' : `<div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:10px;line-height:1.55">${esc(style.how)}</div>`}
    ${pref}
  </section>`;
}
