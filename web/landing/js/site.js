/* OnStandard landing — motion + dial driver.
   The dial has two renderers over one animator: an SVG arc (default everywhere)
   and a WebGL scene (desktop enhancement, dynamically imported). Both read the
   same progress value so the number, tier, and arc can never disagree. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- nav ---------- */
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- reveals ---------- */
  const revealables = [...document.querySelectorAll('.reveal, .an-row')];
  if (reduced) {
    revealables.forEach((el) => el.classList.add('in'));
  } else {
    const pending = new Set(revealables);
    const show = (el) => { el.classList.add('in'); pending.delete(el); io.unobserve(el); };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting || e.boundingClientRect.bottom < 0) show(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    revealables.forEach((el) => io.observe(el));
    // belt and braces: IO delivery can be throttled or coalesced (occluded windows,
    // some mobile browsers under fast flicks) — sweep pending elements on scroll.
    let sweepAt = 0;
    const sweep = () => {
      const now = performance.now();
      if (now < sweepAt) return;
      sweepAt = now + 200;
      const line = innerHeight * 0.94;
      for (const el of [...pending]) {
        const r = el.getBoundingClientRect();
        if (r.top < line && r.bottom > -40) show(el);
        else if (r.bottom <= 0) show(el);
      }
      if (!pending.size) removeEventListener('scroll', sweep);
    };
    addEventListener('scroll', sweep, { passive: true });
  }

  /* ---------- dial ---------- */
  const TARGET = 94;               // the day from the product demo: 94, OnStandard
  const SPAN = 306;                // arc degrees (the brand mark's opening at the bottom)
  const R = 132, C = 2 * Math.PI * R, ARC = C * SPAN / 360;
  const stage = document.getElementById('dial-stage');
  const arcEl = document.querySelector('.dial-arc');
  const glowEl = document.querySelector('.dial-glow');
  const headEl = document.querySelector('.dial-head');
  const countEl = document.getElementById('dial-count');
  const tierEl = document.getElementById('dial-tier');

  const tierFor = (n) => n >= 90 ? ['on', 'OnStandard'] : n >= 75 ? ['lock', 'Locked In'] : n >= 60 ? ['build', 'Building'] : ['off', 'Off Standard'];

  // shared dial state (the WebGL renderer reads this)
  const dial = { p: 0, target: TARGET / 100, done: false };
  window.__dial = dial;

  const paintSVG = (p) => {
    if (stage.classList.contains('gl')) return;
    const len = ARC * p;
    arcEl.style.strokeDasharray = `${len} ${C}`;
    glowEl.style.strokeDasharray = `${len} ${C}`;
    const th = (SPAN * p) * Math.PI / 180;
    headEl.setAttribute('cx', (180 + R * Math.cos(th)).toFixed(2));
    headEl.setAttribute('cy', (180 + R * Math.sin(th)).toFixed(2));
  };
  const paintNum = (n) => {
    countEl.textContent = n;
    const [key, label] = tierFor(n);
    if (tierEl.dataset.tier !== key) { tierEl.dataset.tier = key; tierEl.textContent = label; }
  };

  const finish = () => { dial.p = dial.target; dial.done = true; paintSVG(dial.p); paintNum(TARGET); };

  if (reduced) {
    finish();
  } else {
    paintSVG(0);
    paintNum(0); // markup ships the finished 94 for no-JS visitors; animation starts from 0
    let started = false;
    const start = () => {
      if (started) return; started = true;
      const t0 = performance.now() + 350;      // beat of stillness first
      const DUR = 2400;
      const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
      const step = (now) => {
        const t = Math.min(1, Math.max(0, (now - t0) / DUR));
        const p = easeOutQuart(t) * dial.target;
        dial.p = p;
        paintSVG(p);
        paintNum(Math.round(p * 100));
        if (t < 1) requestAnimationFrame(step); else { dial.done = true; paintNum(TARGET); }
      };
      requestAnimationFrame(step);
    };
    // start when the dial is actually on screen
    const dio = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { start(); dio.disconnect(); }
    }, { threshold: 0.35 });
    dio.observe(stage);
    setTimeout(start, 2600); // failsafe
  }

  /* ---------- WebGL enhancement (desktop, wide, motion-ok) ---------- */
  const wantGL = !reduced
    && matchMedia('(pointer: fine)').matches
    && innerWidth >= 980
    && !!document.createElement('canvas').getContext?.('webgl2');
  if (wantGL) {
    const boot = () => {
      import('./dial3d.js')
        .then((m) => m.mount(document.getElementById('dial-gl'), stage, dial))
        .catch(() => {}); // SVG dial remains — never a broken hero
    };
    if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 1800 });
    else setTimeout(boot, 600);
  }
})();
