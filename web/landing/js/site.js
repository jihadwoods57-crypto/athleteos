/* OnStandard landing v3 — motion + dial + waitlist.
   Systems: reveal choreography, sports ticker (CSS), hero 3D phone parallax,
   gold dust particles, sticky scroll-driven system section, the score dial
   (SVG everywhere, WebGL enhancement on desktop), and the intent-aware
   early-access dialog backed by /api/waitlist. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.classList.add('js');
  if (reduced) document.body.classList.add('no-motion');

  /* ---------- nav ---------- */
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- reveals (IO + scroll sweep fallback) ---------- */
  const revealables = [...document.querySelectorAll('.reveal, .an-row')].filter((el) => !el.closest('.hero'));
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
    let sweepAt = 0;
    const sweep = () => {
      const now = performance.now();
      if (now < sweepAt) return;
      sweepAt = now + 200;
      const line = innerHeight * 0.94;
      for (const el of [...pending]) {
        const r = el.getBoundingClientRect();
        if ((r.top < line && r.bottom > -40) || r.bottom <= 0) show(el);
      }
      if (!pending.size) removeEventListener('scroll', sweep);
    };
    addEventListener('scroll', sweep, { passive: true });
  }

  /* ---------- hero: 3D phone parallax ---------- */
  const heroVisual = document.getElementById('hero-visual');
  if (heroVisual && !reduced && matchMedia('(pointer: fine)').matches && innerWidth > 960) {
    const front = heroVisual.querySelector('.p3d-front');
    const back = heroVisual.querySelector('.p3d-back');
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const tick = () => {
      cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
      front.style.setProperty('--ry', (-13 + cx * 7) + 'deg');
      front.style.setProperty('--rx', (3 - cy * 5) + 'deg');
      if (back) {
        back.style.setProperty('--ry2', (11 + cx * 5) + 'deg');
        back.style.setProperty('--rx2', (2 - cy * 3) + 'deg');
      }
      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) raf = requestAnimationFrame(tick);
      else raf = 0;
    };
    addEventListener('pointermove', (e) => {
      const r = heroVisual.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      tx = ((e.clientX / innerWidth) - 0.5) * 2;
      ty = ((e.clientY / innerHeight) - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
  }

  /* ---------- hero: ambient video loop (desktop enhancement) ---------- */
  const hvVideo = document.getElementById('hv-video');
  if (hvVideo && !reduced && innerWidth > 960
      && !(navigator.connection && navigator.connection.saveData)) {
    const start = () => {
      hvVideo.addEventListener('playing', () => hvVideo.classList.add('on'), { once: true });
      hvVideo.preload = 'auto';
      hvVideo.src = 'assets/video/hero-loop.mp4';
      const p = hvVideo.play();
      if (p) p.catch(() => {});
    };
    if (document.readyState === 'complete') setTimeout(start, 400);
    else addEventListener('load', () => setTimeout(start, 400), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (!hvVideo.src) return;
      if (document.hidden) hvVideo.pause();
      else if (hvVideo.classList.contains('on')) hvVideo.play().catch(() => {});
    });
  }

  /* ---------- hero: gold dust ---------- */
  const dust = document.getElementById('dust');
  if (dust && !reduced && matchMedia('(pointer: fine)').matches && innerWidth > 960) {
    const ctx = dust.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let W = 0, H = 0, parts = [], visible = true;
    const resize = () => {
      W = dust.clientWidth; H = dust.clientHeight;
      dust.width = W * dpr; dust.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const seed = () => {
      parts = Array.from({ length: 64 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.6 + Math.random() * 1.8,
        vy: 0.08 + Math.random() * 0.22,
        vx: (Math.random() - 0.5) * 0.08,
        a: 0.15 + Math.random() * 0.5,
        ph: Math.random() * Math.PI * 2,
      }));
    };
    new ResizeObserver(() => { resize(); seed(); }).observe(dust);
    new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }).observe(dust);
    let t = 0;
    const frame = () => {
      requestAnimationFrame(frame);
      if (!visible || document.hidden || !W) return;
      t += 0.016;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.y -= p.vy; p.x += p.vx + Math.sin(t + p.ph) * 0.04;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        const tw = 0.55 + 0.45 * Math.sin(t * 1.7 + p.ph);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232, 180, 74, ${(p.a * tw).toFixed(3)})`;
        ctx.fill();
      }
    };
    resize(); seed(); requestAnimationFrame(frame);
  }

  /* ---------- sticky system section ---------- */
  const stage = document.getElementById('sys-stage');
  if (stage && !reduced) {
    const steps = [...document.querySelectorAll('#sys-steps .ss')];
    const imgs = [...document.querySelectorAll('.sys-img')];
    let active = 0, ticking = false;
    const setStep = (i) => {
      if (i === active) return;
      active = i;
      steps.forEach((s, n) => s.classList.toggle('on', n === i));
      imgs.forEach((im, n) => im.classList.toggle('on', n === i));
    };
    const measure = () => {
      const r = stage.getBoundingClientRect();
      const total = r.height - innerHeight;
      if (total <= 0) return;
      const p = Math.min(0.999, Math.max(0, -r.top / total));
      setStep(Math.min(3, Math.floor(p * 4)));
    };
    addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { measure(); ticking = false; });
    }, { passive: true });
    measure();
    // clicking a step scrolls to its band
    steps.forEach((s, i) => s.addEventListener('click', () => {
      const top = stage.getBoundingClientRect().top + scrollY;
      const total = stage.offsetHeight - innerHeight;
      scrollTo({ top: top + total * (i / 4) + 10, behavior: 'smooth' });
    }));
  }

  /* ---------- dial (score section) ---------- */
  const TARGET = 94;
  const SPAN = 306;
  const R = 132, C = 2 * Math.PI * R, ARC = C * SPAN / 360;
  const dialStage = document.getElementById('dial-stage');
  const arcEl = document.querySelector('.dial-arc');
  const glowEl = document.querySelector('.dial-glow');
  const headEl = document.querySelector('.dial-head');
  const countEl = document.getElementById('dial-count');
  const tierEl = document.getElementById('dial-tier');
  const tierFor = (n) => n >= 90 ? ['on', 'OnStandard'] : n >= 75 ? ['lock', 'Locked In'] : n >= 60 ? ['build', 'Building'] : ['off', 'Off Standard'];
  const dial = { p: 0, target: TARGET / 100, done: false };
  window.__dial = dial;

  const paintSVG = (p) => {
    if (dialStage.classList.contains('gl')) return;
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

  if (dialStage) {
    if (reduced) {
      finish();
    } else {
      paintSVG(0);
      paintNum(0); // markup ships 94 for no-JS visitors; animation starts from 0
      let started = false;
      const start = () => {
        if (started) return; started = true;
        const t0 = performance.now() + 350;
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
      const dio = new IntersectionObserver((es) => {
        if (es.some((e) => e.isIntersecting)) { start(); dio.disconnect(); }
      }, { threshold: 0.3 });
      dio.observe(dialStage);
    }

    const wantGL = !reduced
      && matchMedia('(pointer: fine)').matches
      && innerWidth >= 980
      && !!document.createElement('canvas').getContext?.('webgl2');
    if (wantGL) {
      const boot = () => {
        import('./dial3d.js')
          .then((m) => m.mount(document.getElementById('dial-gl'), dialStage, dial))
          .catch(() => {});
      };
      if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 2500 });
      else setTimeout(boot, 900);
    }
  }

  /* ---------- waitlist dialog (intent-aware) ---------- */
  const INTENTS = {
    trial: {
      k: 'Founding professionals',
      h: 'Start your 14-day trial.',
      sub: 'Full access for you and your roster or book. No card to start. We set up founding professionals personally, usually within a day.',
      submit: 'Request my trial',
      role: 'Coach',
    },
    join: {
      k: 'Athletes & clients',
      h: 'Join through your coach or trainer.',
      sub: "Tell us who coaches you and we'll get your whole team on. Your spot is free with a paying professional.",
      submit: 'Request my invite',
      role: 'Athlete',
    },
    demo: {
      k: 'Programs & facilities',
      h: 'Book a program demo.',
      sub: 'Schools, clubs, and performance facilities: twenty minutes, your roster structure, straight answers on rollout and consent.',
      submit: 'Request a demo',
      role: 'Gym or program',
    },
    access: {
      k: 'Early access',
      h: 'Get on the standard.',
      sub: "Tell us who you are and we'll reach out as spots open.",
      submit: 'Request early access',
      role: null,
    },
  };

  const dlg = document.getElementById('wl');
  if (dlg && typeof dlg.showModal === 'function') {
    const form = document.getElementById('wl-form');
    const emailEl = document.getElementById('wl-email');
    const roleEl = document.getElementById('wl-role');
    const msg = document.getElementById('wl-msg');
    const submit = document.getElementById('wl-submit');
    const kEl = document.getElementById('wl-k');
    const hEl = document.getElementById('wl-h');
    const subEl = document.getElementById('wl-sub');
    const intentEl = document.getElementById('wl-intent');
    let opener = null;

    const open = (intent, role) => {
      const cfg = INTENTS[intent] || INTENTS.access;
      kEl.textContent = cfg.k;
      hEl.textContent = cfg.h;
      subEl.textContent = cfg.sub;
      submit.textContent = cfg.submit;
      intentEl.value = intent || 'access';
      msg.textContent = ''; msg.classList.remove('err');
      submit.disabled = false;
      const pick = role || cfg.role;
      if (pick && roleEl) {
        const opt = [...roleEl.options].find((o) => o.value === pick);
        if (opt) roleEl.value = pick;
      }
      dlg.showModal();
      setTimeout(() => (document.getElementById('wl-name') || emailEl).focus(), 60);
    };

    document.querySelectorAll('.js-wl').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        opener = a;
        open(a.getAttribute('data-intent'), a.getAttribute('data-role'));
      });
    });

    const closeBtn = document.getElementById('wl-close');
    if (closeBtn) closeBtn.addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { if (opener) { try { opener.focus(); } catch (_) {} opener = null; } });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = ''; msg.classList.remove('err');
      const email = (emailEl.value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        msg.textContent = 'Please enter a valid email.'; msg.classList.add('err'); emailEl.focus(); return;
      }
      const label = submit.textContent;
      submit.disabled = true; submit.textContent = 'Sending…';
      try {
        const data = Object.fromEntries(new FormData(form));
        const res = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.ok) throw new Error(out.error || 'failed');
        const panel = dlg.querySelector('.wl-panel');
        panel.innerHTML = '<button type="button" class="wl-close" id="wl-close2" aria-label="Close"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'
          + '<div class="wl-done"><div class="wl-check"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>'
          + '<h3>You’re in the room.</h3><p>We’ll reach out personally, usually within a day. Keep proving the work.</p></div>';
        document.getElementById('wl-close2').addEventListener('click', () => dlg.close());
      } catch (err) {
        submit.disabled = false; submit.textContent = label;
        msg.textContent = 'Couldn’t send just now, please try again, or email support@onstandard.app.';
        msg.classList.add('err');
      }
    });
  }
})();
