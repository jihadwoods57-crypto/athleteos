/* Shared UI pieces */
import { S, RT, act, roleProfileRoute } from './state.js';
import { icon } from './icons.js';
import { scoreColor } from './score-band.js';

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
   ring → comet tip + lens sparkle → center stack (label / N / /100 / delta / streak).

   The markup renders the ring AT ITS SCORE — a full arc and the real number — rather than at zero
   waiting to be animated. It used to render empty with a literal "0", which made animateRing
   mandatory on every single paint: any repaint that didn't re-animate (and once reveals are keyed,
   most don't) left an undrawn ring reading 0 where the athlete's score belongs. The resting state
   is now the honest one, and motion.js winds it back only for the one reveal it plays — the same
   arrangement the meal score chip has always used. */
export function scoreRing({ score = 82, size = 338, stroke = 20, glow = true, showCenter = true, uid = 'r', delta = null, streak = null, tierName = null, tierCls = 'b', centerNum = false, possible = null } = {}) {
  const r = (size - stroke) / 2 - 14;
  const rEcho = Math.max(0, r - stroke/2 - 8);
  const cx = size / 2, cy = size / 2;
  // ---- Brand-dial geometry (docs/brand/LOGO.md v2) ----
  // The mark is a 300° gauge with a 60° gap centered on 6 o'clock: the arc runs from the
  // bottom-left (120° from 3 o'clock, screen coords) clockwise through 12 up to the
  // bottom-right (60°). 0% sits at the bottom-left end, 50% is dead top — exactly where the
  // logo's own progress arc terminates — and 100% lands at the bottom-right end. Every score
  // surface in the app draws THIS silhouette so the working rings and the mark are one thing.
  const A0 = 120, SWEEP = 300;
  const pt = (rad, deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`;
  };
  // One 300° arc command (large-arc=1, sweep=1) — the same path shape as the brand masters.
  const dial = (rad) => `M ${pt(rad, A0)} A ${rad.toFixed(2)} ${rad.toFixed(2)} 0 1 1 ${pt(rad, A0 + SWEEP - 360)}`;
  // pathLength="100" normalizes every animated layer: dasharray "100", dashoffset 100-score.
  // windBack (motion.js) reads the first dasharray token to hide, animateRing drives data-off —
  // both work unchanged on paths.
  const off = (100 - score).toFixed(1);
  // Ceiling arc: the points STILL REACHABLE today, drawn as a dim continuation of the same band
  // from `score` to `possible` — the whole path rotated so its start sits at the progress tip.
  // Since possible ≤ 100 the dash segment never crosses the gap.
  const ceil = (possible != null && possible > score) ? {
    span: (possible - score).toFixed(1),
    rot: ((score / 100) * SWEEP).toFixed(2),
  } : null;
  // Specular edge: a thin light-catch riding the OUTER edge of the band, which is what makes the
  // band read as a lit solid instead of a flat stroke (the flat-dial's answer to dial-lit's sheen).
  const specW = Math.max(1.6, stroke * 0.16);
  const rSpec = r + stroke / 2 - specW / 2 - 0.6;
  // Marker knob at the progress tip — the dial's seated jewel (bezel + enamel core), replacing
  // the old comet starburst. Proportions from the mark: bezel 10.5/12 of the band, core 6/12.
  // Theme-adaptive exactly like logoMark().
  const light = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light';
  const tipDeg = A0 + (score / 100) * SWEEP;
  const tipA = (tipDeg * Math.PI) / 180;
  const tipX = cx + Math.cos(tipA) * r, tipY = cy + Math.sin(tipA) * r;
  const bezelR = Math.max(5, stroke * 0.875), coreR = Math.max(2.6, stroke * 0.5);
  // No marker until there's arc to lead — at score 0 it would sit orphaned at the start of an
  // empty ring, so it only renders once score >= 6 (the dotted "unstarted" track below).
  const marker = score >= 6 ? `
      <g class="ring-tip" opacity="1">
        <circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="${(bezelR * 0.9).toFixed(1)}" fill="#FFFFFF" opacity="0.5" filter="url(#tip${uid})"/>
        ${light
          ? `<circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="${bezelR.toFixed(1)}" fill="#FFFFFF" stroke="#DBEAFE" stroke-width="1.5"/>
             <circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="${coreR.toFixed(1)}" fill="#2563EB"/>`
          : `<circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="${bezelR.toFixed(1)}" fill="#0F172A"/>
             <circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="${coreR.toFixed(1)}" fill="#FFFFFF"/>`}
      </g>` : '';

  return `
  <div class="ring-wrap" style="width:${size}px;height:${size}px">
    ${glow ? '<div class="aurora"></div><div class="glow"></div>' : ''}
    <svg class="ring-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        ${/* The signature sweep — the SAME three stops as the brand masters, from the theme
              tokens (--ring-a/b/c flip on light), on the mark's own axis: bottom-left of the
              arc up toward the marker (LOGO.md gradient (26,82)→(58,18), scaled to this r). */''}
        <linearGradient id="g${uid}" gradientUnits="userSpaceOnUse"
          x1="${(cx - 0.71 * r).toFixed(1)}" y1="${(cy + 0.88 * r).toFixed(1)}" x2="${(cx + 0.24 * r).toFixed(1)}" y2="${(cy - r).toFixed(1)}">
          <stop offset="0%" stop-color="var(--ring-a)"/>
          <stop offset="50%" stop-color="var(--ring-b)"/>
          <stop offset="100%" stop-color="var(--ring-c)"/>
        </linearGradient>
        ${/* THE BLURRED BOX BEHIND THE RING (founder, 2026-08-02) was this filter's region clipping
              its own glow. An SVG filter region is measured from the element's OBJECT BOUNDING BOX,
              which for a shape EXCLUDES its stroke — and the under-glow below carries a stroke 14px
              wider than the band, and blur stdDeviation 9 needs ~3σ of bleed each side.
              260% stays clear of what the glow actually needs, with headroom, stated in PERCENT so
              it scales with every call site. */''}
        <filter id="soft${uid}" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="9"/>
        </filter>
        <filter id="tip${uid}" x="-160%" y="-160%" width="420%" height="420%">
          <feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="spec${uid}" x1="0.1" y1="0.0" x2="0.9" y2="0.9">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.65"/>
          <stop offset="45%" stop-color="#FFFFFF" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.40"/>
        </linearGradient>
      </defs>
      <!-- under-glow: same arc, wider + blurred, light spills onto the canvas -->
      <path class="ring-arc ring-under" d="${dial(r)}" fill="none" stroke="url(#g${uid})"
        stroke-width="${stroke + 14}" stroke-linecap="round" opacity="0.55" filter="url(#soft${uid})"
        pathLength="100" stroke-dasharray="100" stroke-dashoffset="${off}" data-off="${off}"/>
      <!-- track: the dial's glass track; dotted "ready" style below score 6 so an empty day reads
           as unstarted, not broken (no pathLength here — the dot pattern needs user units) -->
      <path d="${dial(r)}" fill="none" stroke="rgba(148,176,224,0.10)" stroke-width="${stroke}" stroke-linecap="round"${score < 6 ? ' stroke-dasharray="1.4 5"' : ''}/>
      <!-- ceiling: sits between the track and the main band so the band's round cap paints over
           the seam. butt cap, not round — a round cap would bulge past the marker and read as
           a second competing band. animateRing() drives it like any other .ring-arc. -->
      ${ceil ? `<path class="ring-arc ring-ceil" d="${dial(r)}" fill="none" stroke="url(#g${uid})"
        stroke-width="${stroke}" stroke-linecap="butt"
        pathLength="100" stroke-dasharray="${ceil.span} ${(100 - ceil.span)}"
        stroke-dashoffset="0" data-off="0"
        transform="rotate(${ceil.rot} ${cx} ${cy})"/>` : ''}
      <!-- main band -->
      <path class="ring-arc" d="${dial(r)}" fill="none" stroke="url(#g${uid})"
        stroke-width="${stroke}" stroke-linecap="round"
        pathLength="100" stroke-dasharray="100" stroke-dashoffset="${off}" data-off="${off}"/>
      <!-- specular edge: the band's lit outer rim (see rSpec above) -->
      <path class="ring-arc ring-spec" d="${dial(rSpec)}" fill="none" stroke="url(#spec${uid})"
        stroke-width="${specW.toFixed(1)}" stroke-linecap="round" opacity="0.5"
        pathLength="100" stroke-dasharray="100" stroke-dashoffset="${off}" data-off="${off}"/>
      <!-- inner echo ring (clamped ≥0: compact rings would otherwise compute a negative radius) -->
      ${rEcho > 0 ? `<path class="ring-arc ring-echo" d="${dial(rEcho)}" fill="none" stroke="url(#g${uid})"
        stroke-width="1.5" opacity="0.35"
        pathLength="100" stroke-dasharray="100" stroke-dashoffset="${off}" data-off="${off}"/>` : ''}
      ${marker}
    </svg>
    ${showCenter ? `<div class="ring-center">
      <span class="score${score >= 100 ? ' d3' : ''}" data-count="${score}">${score}</span>
      <span class="outof">/100</span>
      ${tierName ? `<span class="tier-chip ${tierCls}">${tierName}</span>` : ''}
    </div>` : ''}
    ${centerNum ? `<div class="ring-center num"><span class="score${score >= 100 ? ' d3' : ''}" data-count="${score}">${score}</span></div>` : ''}
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
  // Completion flare: a one-shot halo bloom as the band lands — the moment the number becomes
  // final gets a physical exhale. Class-driven (CSS one-shot animation, fill forwards) so a
  // repaint can't replay it; windBack in motion.js strips it before a genuine re-reveal.
  setTimeout(() => {
    root.querySelectorAll('.ring-wrap').forEach((w) => { if (w.isConnected) w.classList.add('flare'); });
  }, 1250);
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

/* The column's half of the reveal — the same choreography animateRing plays, for the mark that
   fills instead of sweeping. Separate function rather than a branch inside animateRing so that
   every existing ring call site is byte-for-byte unaffected; motion.js calls both.

   Like the ring, the markup RESTS AT ITS REAL VALUE (height already set, number already printed).
   motion.js winds it back to zero for the one reveal it plays. A paint that doesn't animate must
   still be honest — an undrawn column reading 0 is the same bug the ring shipped with once.

   Two data hooks:
     [data-fill]      final height as a percentage; the lit lip rides the fill's own ::after
     [data-cs-count]  final numeric value + [data-cs-dec] decimals, so the count-up formats as it
                      ticks. animateRing's [data-count] can't serve here: it Math.rounds, which
                      turns a 1.24 mi target into a counter that reads 0,0,1,1. */
export function animateFills(root) {
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  root.querySelectorAll('[data-fill]').forEach((el) => {
    const to = `${el.dataset.fill}%`;
    if (reduceMotion) { el.style.transition = 'none'; el.style.height = to; return; }
    el.style.transition = 'height var(--dur-ring) var(--ease-out)';
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.height = to; }));
    } else { el.style.height = to; }
  });

  // Completion bloom on the column, mirroring the ring's flare. Class-driven and one-shot so a
  // repaint can't replay it; motion.js strips it before a genuine re-reveal.
  if (!reduceMotion) setTimeout(() => {
    root.querySelectorAll('.cscol.done').forEach((c) => { if (c.isConnected) c.classList.add('flare'); });
  }, 900);

  root.querySelectorAll('[data-cs-count]').forEach((el) => {
    const target = Number(el.dataset.csCount);
    const dec = Number(el.dataset.csDec) || 0;
    if (!Number.isFinite(target)) return;
    const paint = (v) => {
      const [whole, frac] = v.toFixed(dec).split('.');
      el.textContent = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
    };
    if (reduceMotion) { paint(target); return; }
    const dur = 1200, t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      paint(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step); else paint(target);
  });
}

/* Brand mark: the "Performance Dial" (docs/brand/LOGO.md — the founder's hi-fi handoff,
   the same mark as the app icon and onstandard.app) — a score gauge reading at the very
   top of its scale whose silhouette reads as the letter "O". The progress arc carries the
   signature green→teal→blue sweep (founder-ratified 2026-07-14); on-dark track/marker. */
export function logoMark(size = 96, uid = 'lm') {
  // Theme-adaptive: mirrors assets/brand/dial-flat-{dark,light}.svg exactly.
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  const track = light ? '#DCE7FB' : 'rgba(255,255,255,0.16)';
  const tip = light ? '#3B82F6' : '#60A5FA';
  const bezel = light ? '<circle cx="50" cy="18" r="10.5" fill="#FFFFFF" stroke="#DBEAFE" stroke-width="1.5"/>' : '<circle cx="50" cy="18" r="10.5" fill="#0F172A"/>';
  const core = light ? '#2563EB' : '#FFFFFF';
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" fill="none">
    <defs>
      <linearGradient id="dial${uid}" x1="26" y1="82" x2="58" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#34D399"/>
        <stop offset="50%" stop-color="#22D3EE"/>
        <stop offset="100%" stop-color="${tip}"/>
      </linearGradient>
    </defs>
    <path d="M33 81.4 A34 34 0 1 1 67 81.4" stroke="${track}" stroke-width="12" stroke-linecap="round"/>
    <path d="M33 81.4 A34 34 0 0 1 50 18" stroke="url(#dial${uid})" stroke-width="12" stroke-linecap="round"/>
    ${bezel}
    <circle cx="50" cy="18" r="6" fill="${core}"/>
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

export function backHead(title, sub, to = 'home', action = null) {
  // title/sub can carry cross-user text (e.g. a coach-assigned requirement title) — escape here
  // so every caller is safe. All current callers pass plain text, so this only hardens.
  // `to` is the FALLBACK only: data-back pops the per-tab origin stack (exact screen + scroll,
  // router.js), so back always returns where the user actually came from.
  //
  // `action` is an OPTIONAL trailing control — { id, label, icon } — for screens that have real
  // actions which do not belong in the body. The meal thread is the reason it exists: its actions
  // were stacked as five rows of chips between the last message and the composer, and a
  // conversation with a control panel welded under it is not a conversation.
  return `<div class="back-head">
    <div class="bk" data-back="${to}" role="button" aria-label="Back">${icon('back', 20)}</div>
    <div class="bh-t"><div class="ht">${esc(title)}</div>${sub ? `<div class="hs">${esc(sub)}</div>` : ''}</div>
    ${action ? `<button type="button" class="bh-act" id="${esc(action.id)}" aria-label="${esc(action.label || 'More')}" aria-expanded="false" aria-haspopup="true">${icon(action.icon || 'more', 20)}</button>` : ''}
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

/* An operator tab-root header: titleHead + the account avatar (initials) top-right.
   Profile left the tab bar (Coach OS slice A) — the avatar is its one home, so it must
   (a) point at the SIGNED-IN role's profile and (b) actually look like a control.

   (a) was a hard lockout: this route was hardcoded to 'coach-profile', but all three screens
   that call avatarHead() are nav:'operator' — they render for a TRAINER too. coachProfile is
   nav:'coach', so the router's role guard bounced every trainer straight back to their own
   home. A trainer could not open account settings or sign out at all, from anywhere in the app.
   roleProfileRoute() resolves per role (state.js), which is what the athlete header already did.

   (b) a bare tinted circle of initials read as decoration — a monogram, not a door. Profile,
   preferences and SIGN OUT live behind it and nothing else in the app leads there, so it now
   carries a visible edge and a caret badge. Same 40px hit target, same position. */
export function avatarHead(title, sub, initials) {
  return `<div class="back-head" style="align-items:center">
    <div style="flex:1;min-width:0"><div class="ht">${esc(title)}</div>${sub ? `<div class="hs">${esc(sub)}</div>` : ''}</div>
    <div class="hd-avatar" role="button" tabindex="0" aria-label="Your profile and settings" data-go="${roleProfileRoute()}"
      style="position:relative;width:40px;height:40px;border-radius:50%;background:var(--blue-surface);color:var(--blue-bright);border:1.5px solid var(--blue-border);display:grid;place-items:center;font-size:13px;font-weight:800;letter-spacing:0.02em;flex:none;cursor:pointer">${esc(initials || 'C')}
      <span aria-hidden="true" style="position:absolute;right:-2px;bottom:-2px;width:16px;height:16px;border-radius:50%;background:var(--surface-3);border:1.5px solid var(--bg);display:grid;place-items:center;color:var(--text-2)">${icon('chevron', 10)}</span>
    </div>
  </div>`;
}

/* Seven-day score line for a roster row. ALWAYS the same box: this used to collapse to a bare
   em-dash below two data points, which changed the row's width and broke the list's rhythm —
   and it was only the rows that DID have a line that got squeezed into a mid-word ellipsis.
   A constant box means every row measures the same.
   Domain is fixed 0-100 on purpose. Auto-zooming to [min,max] would make a 92->94 wiggle and a
   40->45 wiggle look identical; the coach's question is where this athlete sits against the
   standard, which only a fixed domain answers. The reference line is what makes a flat line
   readable, not rescaling. */
export function sparkline(hist) {
  const pts = (hist || []).filter(h => h.score != null).slice(-7);
  const w = 34, h = 16;
  const y = (s) => h - (s / 100) * h;
  const ref = `<line x1="0" y1="${y(80).toFixed(1)}" x2="${w}" y2="${y(80).toFixed(1)}" stroke="var(--hairline)" stroke-width="1" stroke-dasharray="2 3"/>`;
  let mark;
  if (pts.length === 0) {
    // No history is not a flat line at zero — say "nothing yet" without drawing a claim.
    mark = `<line x1="0" y1="${(h - 0.75).toFixed(2)}" x2="${w}" y2="${(h - 0.75).toFixed(2)}" stroke="var(--text-3)" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.55"/>`;
  } else if (pts.length === 1) {
    mark = `<circle cx="${w / 2}" cy="${y(pts[0].score).toFixed(1)}" r="2" fill="${scoreColor(pts[0].score)}"/>`;
  } else {
    const xy = pts.map((p, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
    // Banded by where the athlete IS, not by whether they drifted up since last week — the old
    // rule painted a 44 -> 46 slide green.
    mark = `<polyline points="${xy}" fill="none" stroke="${scoreColor(pts[pts.length - 1].score)}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${ref}${mark}</svg>`;
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
  autocompleteOff = true, decorativeSend = false, attachId = '', attachLabel = 'Attach a photo',
} = {}) {
  const sendAttrs = `class="send"${sendId ? ` id="${sendId}"` : ''}${sendStyle ? ` style="${sendStyle}"` : ''}`;
  const sendEl = decorativeSend
    ? `<span ${sendAttrs} aria-hidden="true">${icon(sendIcon, sendIconSize)}</span>`
    : `<button type="button" ${sendAttrs} aria-label="${esc(sendLabel)}">${icon(sendIcon, sendIconSize)}</button>`;
  // OPT-IN, and deliberately so: this helper backs seven bars including a food SEARCH box and a
  // private-note field, none of which should sprout a camera. Only a caller that passes attachId
  // gets the control. The hidden <input type="file"> is the same web-platform capture the camera
  // screen already relies on (no native bridge exists for photo capture), so this adds no new
  // permission surface — accept="image/*" with no `capture` attribute lets the OS offer BOTH
  // camera and library, which is what a chat attachment wants.
  const attachEl = attachId
    ? `<button type="button" class="attach" id="${attachId}" aria-label="${esc(attachLabel)}">${icon('camera', 18)}</button>
    <input type="file" accept="image/*" id="${attachId}-file" hidden aria-hidden="true" tabindex="-1" />`
    : '';
  return `<div class="composer"${wrapStyle ? ` style="${wrapStyle}"` : ''}>
    ${attachEl}
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

/* Verify-your-email banner (2026-08-02). Shared across every role's home — athlete, coach,
   trainer, parent — because email_verified is a per-account fact, not a role-specific one.
   Mirrors home.js's syncBanner: a `.lrow` card that renders '' when there's nothing to say, so
   callers just splice it into the template and it disappears on its own once verified.

   Renders ONLY when the server has confirmed the address is NOT verified (RT.emailVerified ===
   false). Two other states — null (not loaded yet) and true (verified) — both render nothing,
   which means an unloaded state never flashes a false accusation for one frame.

   Dismiss is a plain module variable, not RT: RT persists to localStorage (state.js save()), so
   putting the flag there would make "dismiss" permanent across relaunches — the opposite of the
   intent. This hides it for the rest of THIS app session only; it returns after a relaunch,
   because an unverified address stays a real, recurring risk (see friendlyAuth's "already
   registered" line — an unverified duplicate signup is exactly the enumeration/lockout case a
   verified email closes off). Resend stays available from here even after a dismiss. */
let EV_DISMISSED = false;
export function emailVerifyBanner() {
  if (RT.emailVerified !== false || EV_DISMISSED) return '';
  // A restrained single row (syncBanner's weight, not the full-amber-fill "your team isn't ready"
  // alert's) — this is a low-urgency nag that never blocks using the app, so it must not visually
  // compete with a card that actually does. Icon + one line of text on the left; Resend and a
  // small × dismiss sit inline on the right, never stacked into a tall column.
  return `<div class="lrow" id="ev-banner" style="margin:12px 0 10px;background:rgba(var(--amber-rgb),0.08);border:1px solid var(--amber-border);border-radius:14px;padding:10px 11px;gap:10px">
    <div class="xico sm" style="background:rgba(var(--amber-rgb),0.18);color:var(--amber-bright);flex:none">${icon('mail', 15)}</div>
    <div class="xr" style="cursor:default;min-width:0">
      <div class="xa">Verify your email</div>
      <div class="xb" id="ev-banner-msg">${esc(RT.email || 'Confirm your address')}</div>
    </div>
    <button class="btn ghost sm" id="ev-resend" style="width:auto;padding:0 12px;height:28px;font-size:11.5px;flex:none">Resend</button>
    <span role="button" tabindex="0" aria-label="Dismiss for now" id="ev-dismiss" style="cursor:pointer;color:var(--text-3);flex:none;padding:4px;display:grid;place-items:center">${icon('x', 14)}</span>
  </div>`;
}
/* Wires the banner's two controls. querySelector-null-guarded (self-guarding, like coach-home.js
   mount()) so a screen can call this unconditionally even when the banner didn't render. */
export function wireEmailVerifyBanner(root) {
  const banner = root.querySelector('#ev-banner');
  if (!banner) return;
  const resend = banner.querySelector('#ev-resend');
  const dismiss = banner.querySelector('#ev-dismiss');
  const msg = banner.querySelector('#ev-banner-msg');
  const say = (text) => { if (msg) msg.textContent = text; };
  if (resend) resend.addEventListener('click', async () => {
    if (resend.disabled) return;
    resend.disabled = true;
    const was = resend.textContent;
    resend.textContent = '…';
    const r = await act.requestEmailVerification();
    resend.disabled = false;
    resend.textContent = was;
    if (!r.ok) { say(r.error); return; }
    say(r.emailed ? `Sent — check ${esc(RT.email || 'your inbox')}.` : "Saved — check your inbox shortly.");
  });
  const doDismiss = () => { EV_DISMISSED = true; if (window.__render) window.__render(); };
  if (dismiss) {
    dismiss.addEventListener('click', doDismiss);
    dismiss.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doDismiss(); } });
  }
}
