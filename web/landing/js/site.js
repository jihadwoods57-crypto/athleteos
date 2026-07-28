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

  /* ---------- boot preloader ("The Number") ----------
     The head script decides whether it plays (html.pre set pre-paint:
     first page of the session, no hash, motion OK) and arms window.__preT
     as a 3.5s failsafe in case this script never runs. Here: count 0→100
     in 14 chunky ticks, tick in STANDARD, lift the curtain (html.pre-up —
     which also releases the hero's paused entrance animations). The curtain
     ALWAYS lifts: hard 3s timeout + try/catch + idempotent end(). */
  const preEl = document.getElementById('pre');
  if (preEl) {
    const root = document.documentElement;
    if (!root.classList.contains('pre')) {
      preEl.remove();
    } else {
      clearTimeout(window.__preT);
      const numEl = document.getElementById('pre-num');
      let ended = false;
      const gone = () => { root.classList.remove('pre', 'pre-up'); preEl.remove(); };
      const end = () => {
        if (ended) return;
        ended = true;
        clearTimeout(hard);
        root.classList.add('pre-up');
        preEl.addEventListener('transitionend', gone, { once: true });
        setTimeout(gone, 800); /* transitionend can be swallowed in hidden tabs */
      };
      const hard = setTimeout(end, 3000);
      try {
        const run = () => {
          const t0 = performance.now();
          const DUR = 1150, STEPS = 14;
          const ease = (t) => 1 - Math.pow(1 - t, 3);
          const step = (now) => {
            if (ended) return;
            const t = Math.min(1, (now - t0) / DUR);
            numEl.textContent = Math.round(Math.round(ease(t) * STEPS) / STEPS * 100);
            if (t < 1) requestAnimationFrame(step);
            else { preEl.classList.add('done'); setTimeout(end, 420); }
          };
          requestAnimationFrame(step);
        };
        /* start in the display face if it lands within 200ms; don't wait longer */
        Promise.race([
          document.fonts.load('900 1rem Archivo'),
          new Promise((r) => setTimeout(r, 200)),
        ]).then(run, run);
      } catch (e) { end(); }
    }
  }

  /* ---------- nav ---------- */
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- reveals (IO + scroll sweep fallback) ----------
     Runs under reduce-motion too: the reveal is a gentle OPACITY fade (the CSS drops the 26px
     slide under reduce-motion, so nothing translates). Fading content in on scroll is not a
     vestibular trigger, and it's the difference between "alive" and "frozen". */
  {
    const revealables = [...document.querySelectorAll('.reveal, .an-row')].filter((el) => !el.closest('.hero'));
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

  /* ---------- plan styles: interactive spectrum comparison ----------
     Left tabs drive one morphing phone. The spectrum glide + data-active carry
     the structure->autonomy read. Gently auto-advances the first time it scrolls
     into view, and stops for good the moment the visitor takes over. */
  const ps = document.getElementById('pstyles');
  if (ps) {
    const tabs = [...ps.querySelectorAll('.pstyle-tab')];
    const screens = [...ps.querySelectorAll('.pshot')];
    let idx = 0, auto = 0, touched = false;
    const select = (i, focus) => {
      idx = (i + tabs.length) % tabs.length;
      const style = tabs[idx].dataset.style;
      ps.dataset.active = style;
      ps.style.setProperty('--pos', idx);
      tabs.forEach((t, n) => {
        const on = n === idx;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      screens.forEach((s) => s.classList.toggle('on', s.dataset.style === style));
      if (focus) tabs[idx].focus();
    };
    const stop = () => { if (auto) { clearInterval(auto); auto = 0; } };
    const take = () => { touched = true; stop(); };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => { take(); select(i); });
      t.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); take(); select(idx + 1, true); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); take(); select(idx - 1, true); }
        else if (e.key === 'Home') { e.preventDefault(); take(); select(0, true); }
        else if (e.key === 'End') { e.preventDefault(); take(); select(tabs.length - 1, true); }
      });
    });
    select(0);
    if (!reduced) {
      new IntersectionObserver((es) => {
        const seen = es.some((e) => e.isIntersecting);
        if (seen && !touched && !auto) auto = setInterval(() => { if (!touched) select(idx + 1); }, 3400);
        else if (!seen) stop();
      }, { threshold: 0.45 }).observe(ps);
    }
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
  if (dialStage) {
    // The count-up runs under reduce-motion too — a number ticking in place, plus a gauge ring
    // filling within its own widget, is not a vestibular trigger. Only the WebGL 3D dial below
    // stays off under reduce-motion (that one tilts and parallaxes).
    {
      paintSVG(0);
      paintNum(0); // markup ships 94 for no-JS visitors; animation starts from 0
      let started = false;
      const start = () => {
        if (started) return; started = true;
        const t0 = performance.now() + (reduced ? 120 : 350);
        const DUR = reduced ? 1400 : 2400;
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

  /* ---------- nav: "Who are you?" role dropdown ---------- */
  const solWrap = document.querySelector('.nav-sol');
  if (solWrap) {
    const solBtn = solWrap.querySelector('.sol-btn');
    const solMenu = solWrap.querySelector('.sol-menu');
    let closeT = 0;
    const setOpen = (on) => {
      solMenu.classList.toggle('open', on);
      solBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    };
    const isOpen = () => solMenu.classList.contains('open');
    solBtn.addEventListener('click', () => setOpen(!isOpen()));
    // hover intent (desktop pointers only)
    if (matchMedia('(pointer: fine)').matches) {
      solWrap.addEventListener('mouseenter', () => { clearTimeout(closeT); setOpen(true); });
      solWrap.addEventListener('mouseleave', () => { closeT = setTimeout(() => setOpen(false), 160); });
    }
    // keyboard: Escape closes and refocuses; arrows walk the items
    solWrap.addEventListener('keydown', (e) => {
      const items = [...solMenu.querySelectorAll('a, button')];
      if (e.key === 'Escape' && isOpen()) { setOpen(false); solBtn.focus(); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
        e.preventDefault();
        if (!isOpen()) setOpen(true);
        const i = items.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown'
          ? (i < 0 ? 0 : Math.min(i + 1, items.length - 1))
          : (i <= 0 ? 0 : i - 1);
        items[next].focus();
      }
    });
    // close when focus or clicks land outside
    solWrap.addEventListener('focusout', (e) => {
      if (!solWrap.contains(e.relatedTarget)) setOpen(false);
    });
    document.addEventListener('click', (e) => {
      if (isOpen() && !solWrap.contains(e.target)) setOpen(false);
    });
  }

  /* ---------- nav: mobile menu ---------- */
  const burger = document.getElementById('nav-burger');
  const mMenu = document.getElementById('m-menu');
  if (burger && mMenu) {
    const setMenu = (on) => {
      mMenu.classList.toggle('open', on);
      burger.setAttribute('aria-expanded', on ? 'true' : 'false');
      document.documentElement.style.overflow = on ? 'hidden' : '';
    };
    burger.addEventListener('click', () => setMenu(!mMenu.classList.contains('open')));
    mMenu.addEventListener('click', (e) => {
      if (e.target.closest('a, .js-wl')) setMenu(false);
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mMenu.classList.contains('open')) { setMenu(false); burger.focus(); }
    });
  }

  /* ---------- waitlist dialog (intent-aware) ---------- */
  const INTENTS = {
    trial: {
      k: 'Founding access',
      h: 'Claim a founding spot.',
      sub: 'The first 50 coaches and facilities lock 50% off for 12 months. We reach out personally, usually within a day, and your free 14-day trial starts when we onboard you.',
      submit: 'Request founding access',
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
