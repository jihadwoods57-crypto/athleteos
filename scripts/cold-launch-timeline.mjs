#!/usr/bin/env node
// Cold-launch timeline for the athlete Home: what a force-close + reopen LOOKS like, frame by frame.
//
// The founder's report (2026-09-23): "when I force close the app and reopen it, the load up doesn't
// feel smooth. Especially when it comes to the meal cards." This reproduces that launch headlessly
// and turns "doesn't feel smooth" into numbers, so a fix can be proven rather than asserted.
//
//   node scripts/serve-proto.mjs 8811                       # one shell (this tree's proto)
//   node scripts/cold-launch-timeline.mjs --serve 8811 --out before
//
// Two browser launches, on purpose:
//   1. WARM: a normal session. The athlete's midday day is seeded through the real engine, Home is
//      opened, and everything the app persists (runtime, the day cache, anything else it chooses to
//      keep) is written by the app itself. Then localStorage is dumped.
//   2. COLD: a FRESH browser (empty HTTP cache, like a photo whose signed URL is new) with that
//      localStorage restored before any proto code runs. CPU throttled, every Supabase call delayed
//      by a network round trip, every meal photo delayed like a real download. An in-page sampler
//      logs every visible state change on every animation frame.
//
// The NUMBERS come from a run with nothing else attached. `--shots <ms>` makes a separate run that
// also screenshots the page every <ms> (screenshots cost the renderer time, so they would skew the
// timings) and composes strip.png from it; use a tall `--height` there so the meal cards are in
// frame (on a 844px phone they sit just under the fold).
//
// Output: qc/cold-launch/<out>/{timeline.json, frames/*.jpg, strip.png}. The summary printed at
// the end is the before/after table. Nothing here touches production: the Supabase client is the
// same stub qc-capture uses (web/landing-src/lib/sb-stub.mjs).
import { launch, evalJs, seedOnNewDocument, sleep } from '../web/landing-src/lib/cdp.mjs';
import { SEEDS } from '../web/landing-src/lib/seeds.mjs';
import { sbStubSource, ROSTER_ATHLETES } from '../web/landing-src/lib/sb-stub.mjs';
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf('--' + name); return i === -1 ? def : argv[i + 1]; };
const PORT = Number(flag('serve', 8799));
const BASE = `http://localhost:${PORT}/index.html`;
const OUT = join(process.cwd(), 'qc', 'cold-launch', flag('out', 'run'));
const W = Number(flag('width', 390));
const H = Number(flag('height', 844));
const CPU = Number(flag('cpu', 4));
const LAT_MIN = Number(flag('lat-min', 150));
const LAT_MAX = Number(flag('lat-max', 400));
const SESSION_MS = Number(flag('session-ms', 300));   // getSession: Keychain + one token refresh
const IMG_MS = Number(flag('img-ms', 700));           // one meal photo download
const RUN_MS = Number(flag('run-ms', 8000));
const SEED = flag('seed', 'dayMidday');
const AT = String(flag('at', '13:10')).split(':').map(Number);
// `--cold-at H:M` and `--next-day`: reopen at another time, or the next morning (no cached day).
const COLD_AT = String(flag('cold-at', flag('at', '13:10'))).split(':').map(Number);
const NEXT_DAY = argv.includes('--next-day');
// `--native`: a stand-in for the native shell's window.ReactNativeWebView, so the splash hold
// (html.splash-held, paused reveals) runs and the time the proto posts PAINTED is recorded.
const NATIVE = argv.includes('--native');
const DEBUG_PORT = Number(flag('port', 9371));
const SHOTS = Number(flag('shots', 0));
const STRIP_AT = String(flag('strip', '300,700,1100,1500,2000,3000,5000,6500')).split(',').map(Number);

/** A clock that is frozen to the scenario's wall time but still MOVES, so timers, the render
 *  coalescer (Date.now deltas) and the exec tick behave as they do on a phone. */
const movingClock = (h, m, d = 23) => `(() => { const R = Date; const START = R.now();
  const FAKE = new R(2026, 6, ${d}, ${h}, ${m}, 0).getTime();
  const D = function (...a) { return a.length ? new R(...a) : new R(FAKE + (R.now() - START)); };
  D.now = () => FAKE + (R.now() - START); D.parse = R.parse; D.UTC = R.UTC; D.prototype = R.prototype;
  Object.setPrototypeOf(D, R); globalThis.Date = D; })();`;

/** Delay every Supabase answer by a network round trip. Wraps the stub's client from the outside:
 *  the query builder is a thenable whose chain methods return itself, so only `then` (and the
 *  terminal single/maybeSingle, which return real promises) are slowed; chaining is untouched. */
const latencySource = ({ min, max, session }) => `(() => {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const lat = () => Math.round(${min} + rnd() * (${max - min}));
  const later = (p, ms) => new Promise((res, rej) => Promise.resolve(p).then(
    (v) => setTimeout(() => res(v), ms), (e) => setTimeout(() => rej(e), ms)));
  const wrap = (obj) => new Proxy(obj, {
    get(t, k) {
      const v = t[k];
      if (k === 'then' && typeof v === 'function') {
        return (res, rej) => later({ then: v.bind(t) }, lat()).then(res, rej);
      }
      if (typeof v !== 'function') return (v && typeof v === 'object') ? wrap(v) : v;
      return (...a) => {
        // Every call the app makes, in order, so a duplicated boot or a serial chain shows up.
        if (k === 'from' || k === 'rpc' || k === 'getSession' || k === 'createSignedUrls' || k === 'createSignedUrl') {
          (window.__SBCALLS = window.__SBCALLS || []).push([Math.round(performance.now()), k, typeof a[0] === 'string' ? a[0] : (Array.isArray(a[0]) ? a[0].length + ' paths' : '')]);
        }
        const r = v.apply(t, a);
        if (r instanceof Promise) return later(r, k === 'getSession' ? ${session} : lat());
        return (r && typeof r === 'object') ? wrap(r) : r;
      };
    },
  });
  const d = Object.getOwnPropertyDescriptor(window, 'supabase');
  Object.defineProperty(window, 'supabase', {
    configurable: true, get: d.get,
    set(v) {
      d.set(v);
      const held = d.get();
      if (held && held.createClient && !held.__slowed) {
        const cc = held.createClient;
        held.createClient = (...a) => wrap(cc(...a));
        held.__slowed = true;
      }
    },
  });
})();`;

/** The in-page recorder. Every time stamp is performance.now() (ms since navigation start). */
const recorderSource = `(() => {
  const T = window.__T = { ev: [], shifts: [], longtasks: [], paints: [], states: [] };
  const now = () => Math.round(performance.now());
  const log = (k, d) => T.ev.push(Object.assign({ t: now(), k }, d || {}));
  const desc = (n) => { if (!n || !n.nodeType) return '?'; if (n.nodeType !== 1) n = n.parentElement; if (!n) return '?';
    return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''); };
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) T.shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src: (e.sources || []).map((s) => desc(s.node)) }); })).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => T.longtasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => T.paints.push({ k: e.name, t: Math.round(e.startTime) }))).observe({ type: 'paint', buffered: true }); } catch (e) {}
  // Which images have actually arrived (a background-image paints nothing until then).
  const loaded = new Map();
  const probe = (url) => { if (url.startsWith('data:')) return true; if (loaded.has(url)) return loaded.get(url); loaded.set(url, false);
    const im = new Image(); im.onload = () => { loaded.set(url, true); log('img-loaded', { url: url.slice(-40) }); }; im.src = url; return false; };
  const ids = new WeakMap(); let nid = 0; const idOf = (n) => { if (!n) return 0; if (!ids.has(n)) ids.set(n, ++nid); return ids.get(n); };
  let last = '';
  let ringFullSeen = false;
  const sample = () => {
    const view = document.getElementById('view');
    const vp = document.getElementById('viewport');
    const hero = document.querySelector('.xhero');
    const arc = document.querySelector('.xhero .ring-arc');
    const dash = arc ? parseFloat(String(arc.getAttribute('stroke-dasharray') || '').split(/[\\s,]+/)[0]) : NaN;
    const off = arc ? parseFloat(getComputedStyle(arc).strokeDashoffset) : NaN;
    // Share of the arc drawn, 0..1 (NaN when no ring).
    const drawn = arc && dash ? +(1 - off / dash).toFixed(2) : null;
    const cards = [...document.querySelectorAll('#view .res-card')].map((c) => {
      const m = c.querySelector('.res-media');
      const bg = m ? (m.style.backgroundImage || '') : '';
      const urls = [...bg.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)].map((x) => x[1]);
      if (!urls.length) return 'icon';
      // 'photo' once the top layer has arrived; 'thumb' while only the kept stand-in is showing.
      if (probe(urls[0])) return 'photo';
      return urls.slice(1).some((u) => u.startsWith('data:')) ? 'thumb' : 'blank';
    });
    const rails = document.querySelectorAll('#view .res-rail').length;
    const firstRail = document.querySelector('#view .res-rail');
    // Position inside #view: the view's own entrance transform cancels out, and the rails are not
    // among the blocks that animate in, so only a real layout change reads as a "move".
    const railTop = firstRail && view ? Math.round(firstRail.getBoundingClientRect().top - view.getBoundingClientRect().top) : null;
    const titles = [...document.querySelectorAll('#view .res-card .res-t')].map((e) => e.textContent).join('|');
    const s = {
      screen: hero ? 'home' : (document.querySelector('.sk-card') ? 'skeleton' : (view ? 'other' : 'blank')),
      view: idOf(view), busy: vp && vp.getAttribute('aria-busy') === 'true',
      drawn, cards: cards.join(','), titles, rails, railTop,
      scroll: vp ? Math.round(vp.scrollTop) : 0,
      homeIn: view ? [...view.children].some((c) => /home-in/.test(c.style.animation || '')) : false,
      enter: view ? view.classList.contains('enter') : false,
      settle: view ? view.classList.contains('settle') : false,
    };
    const key = JSON.stringify(s);
    if (key !== last) { last = key; T.states.push(Object.assign({ t: now() }, s)); }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  document.addEventListener('DOMContentLoaded', () => {
    log('dcl');
    const dev = document.getElementById('device');
    if (dev) new MutationObserver(() => log('device-rebuild')).observe(dev, { childList: true });
  });
})();`;

async function warmSession() {
  const b = await launch({ port: DEBUG_PORT, scale: 1 });
  try {
    const page = await b.newPage({ width: W, height: H });
    await seedOnNewDocument(page, movingClock(AT[0], AT[1]));
    await seedOnNewDocument(page, sbStubSource({ todayISO: '2026-07-23', athletes: ROSTER_ATHLETES, sessionUserId: 'seed-athlete' }));
    await page.send('Page.navigate', { url: BASE + '#home' });
    await sleep(2500);
    await evalJs(page, `(async () => { ${SEEDS[SEED]} return 1; })()`);
    // Persist exactly what a session leaves behind: the day through its own writer, the runtime
    // through its own key. Then let Home run its mount (photo signing, past rails) to completion.
    await evalJs(page, `(async () => { const day = await import('/js/day.js'); const st = await import('/js/state.js');
      day.pushDay(st.RT.userId, true); localStorage.setItem('onstd-proto-rt-v1', JSON.stringify(st.RT));
      location.hash = '#plan'; await new Promise((r) => setTimeout(r, 400)); location.hash = '#home'; return 1; })()`);
    await sleep(2500);
    const dump = await evalJs(page, `JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))`);
    return JSON.parse(dump);
  } finally { await b.close(); }
}

async function coldLaunch(storage) {
  const b = await launch({ port: DEBUG_PORT + 1, scale: 1 });
  const frames = [];
  const errors = [];
  try {
    const page = await b.newPage({ width: W, height: H });
    // Restore the last session's storage before ANY proto code runs (first document only).
    await seedOnNewDocument(page, `(() => { if (location.protocol !== 'http:' || sessionStorage.getItem('__restored')) return;
      const S = ${JSON.stringify(storage)}; for (const k in S) localStorage.setItem(k, S[k]);
      // The Keychain session as the browser adapter keeps it (js/secure-storage.js falls back to
      // localStorage), so the stored-session read finds this athlete, as on a phone.
      localStorage.setItem('sb-stub-auth-token', JSON.stringify({ access_token: 'seed', user: { id: 'seed-athlete' } }));
      sessionStorage.setItem('__restored', '1'); })();`);
    await seedOnNewDocument(page, movingClock(COLD_AT[0], COLD_AT[1], NEXT_DAY ? 24 : 23));
    await seedOnNewDocument(page, sbStubSource({ todayISO: NEXT_DAY ? '2026-07-24' : '2026-07-23', athletes: ROSTER_ATHLETES, sessionUserId: 'seed-athlete' }));
    await seedOnNewDocument(page, latencySource({ min: LAT_MIN, max: LAT_MAX, session: SESSION_MS }));
    await seedOnNewDocument(page, recorderSource);
    if (NATIVE) await seedOnNewDocument(page, `window.ReactNativeWebView = { postMessage(m) {
      if (String(m).indexOf('PAINTED') >= 0) window.__T.ev.push({ t: Math.round(performance.now()), k: 'PAINTED' }); } };`);
    // Meal photos travel like a download; every other request is the local proto (file:// on a phone).
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*.jpg*', requestStage: 'Request' }] });
    b.on((msg) => {
      if (msg.sessionId !== page.sessionId) return;
      if (msg.method === 'Fetch.requestPaused') {
        setTimeout(() => page.send('Fetch.continueRequest', { requestId: msg.params.requestId }).catch(() => {}), IMG_MS);
      }
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    });
    if (CPU > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    // The native shell loads index.html with NO hash (ProtoApp's source uri): boot routes from there.
    const navAt = Date.now() / 1000;
    await page.send('Page.navigate', { url: BASE });
    const end = Date.now() + RUN_MS;
    if (SHOTS) {
      while (Date.now() < end) {
        const at = Date.now();
        try {
          const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
          frames.push({ t: at / 1000, data });
        } catch { /* navigating: next tick */ }
        await sleep(Math.max(0, SHOTS - (Date.now() - at)));
      }
    } else await sleep(RUN_MS);
    const origin = await evalJs(page, 'performance.timeOrigin');
    const T = await evalJs(page, 'JSON.stringify(Object.assign(window.__T, { calls: window.__SBCALLS || [] }))');
    return { T: Object.assign(JSON.parse(T), { errors }), frames, origin, navAt };
  } finally { await b.close(); }
}

function summarize(T) {
  const st = T.states;
  const firstHome = st.find((s) => s.screen === 'home');
  const firstSkeleton = st.find((s) => s.screen === 'skeleton');
  const allCards = (s) => s.cards && s.cards.length && !/icon|blank/.test(s.cards);
  const firstCards = st.find((s) => s.screen === 'home' && s.cards);
  // Every card that has a picture is showing one (icon cards are honest no-photo logs / check-ins).
  const pictured = (s) => s.cards && !/blank/.test(s.cards) && /photo|thumb/.test(s.cards);
  const cardsWithPhotos = st.find((s) => s.screen === 'home' && pictured(s));
  const cardsSharp = st.find((s) => s.screen === 'home' && pictured(s) && !/thumb/.test(s.cards));
  // Settled = the last state change.
  const settled = st.length ? st[st.length - 1].t : null;
  const after = firstHome ? st.filter((s) => s.t >= firstHome.t) : [];
  // Visible jumps after Home first paints: the card set changing, a card's media changing kind,
  // the ring rewinding after it had drawn, the entrance replaying, a rail moving on screen.
  const jumps = [];
  for (let i = 1; i < after.length; i++) {
    const a = after[i - 1], c = after[i];
    if (a.cards !== c.cards) {
      const na = a.cards ? a.cards.split(',').length : 0, nc = c.cards ? c.cards.split(',').length : 0;
      jumps.push({ t: c.t, what: na !== nc ? `cards ${na} -> ${nc}` : `card media ${a.cards} -> ${c.cards}` });
    }
    if (a.drawn != null && c.drawn != null && c.drawn < a.drawn - 0.05) jumps.push({ t: c.t, what: `ring rewound ${a.drawn} -> ${c.drawn}` });
    if (!a.homeIn && c.homeIn) jumps.push({ t: c.t, what: 'entrance replayed (home-in)' });
    if (a.railTop != null && c.railTop != null && Math.abs(a.railTop - c.railTop) > 2 && a.scroll === c.scroll) jumps.push({ t: c.t, what: `rail moved ${a.railTop} -> ${c.railTop}` });
    if (a.view !== c.view) jumps.push({ t: c.t, what: 'view rebuilt', silent: true });
  }
  const cls = T.shifts.reduce((s, x) => s + x.v, 0);
  const paintedEv = (T.ev || []).find((e) => e.k === 'PAINTED');
  // The first frame the ring had started drawing (0 < drawn < 1), and when the entrance first ran.
  const ringStart = st.find((s) => s.drawn != null && s.drawn > 0 && s.drawn < 1);
  return {
    paintedAt: paintedEv ? paintedEv.t : null,
    ringDrawStartAt: ringStart ? ringStart.t : null,
    fcp: (T.paints.find((p) => p.k === 'first-contentful-paint') || {}).t ?? null,
    skeletonAt: firstSkeleton ? firstSkeleton.t : null,
    firstHomeAt: firstHome ? firstHome.t : null,
    firstCardsAt: firstCards ? firstCards.t : null,
    cardsWithPhotosAt: cardsWithPhotos ? cardsWithPhotos.t : null,
    cardsSharpAt: cardsSharp ? cardsSharp.t : null,
    settledAt: settled,
    cls: +cls.toFixed(4),
    shifts: T.shifts.length,
    visibleJumps: jumps.filter((j) => !j.silent).length,
    viewRebuildsAfterHome: jumps.filter((j) => j.what === 'view rebuilt').length,
    longTasks: T.longtasks.length,
    longTaskMs: T.longtasks.reduce((s, x) => s + x.d, 0),
    jumps: jumps.filter((j) => !j.silent),
    allCardsAtFirstHome: firstHome ? firstHome.cards : null,
    ok: !!allCards,
  };
}

/** One PNG: the frame nearest each STRIP_AT time, labelled, side by side. Composed in Chromium so
 *  the harness keeps its no-dependency rule. */
async function composeStrip(index, sum) {
  const picks = STRIP_AT.map((t) => index.reduce((a, f) => (Math.abs(f.t - t) < Math.abs(a.t - t) ? f : a), index[0]));
  const cellW = 260, cellH = Math.round(cellW * H / W);
  const cells = await Promise.all(picks.map(async (f) => {
    const b64 = (await readFile(join(OUT, 'frames', f.file))).toString('base64');
    return `<figure><img src="data:image/jpeg;base64,${b64}"><figcaption>${(f.t / 1000).toFixed(2)} s</figcaption></figure>`;
  }));
  const s1 = (ms) => (ms == null ? 'never' : (ms / 1000).toFixed(2) + ' s');
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font:600 15px system-ui;color:#111">
    <div style="padding:10px 12px 4px;font-size:17px">${flag('out', 'run')} · cold launch · first Home ${s1(sum.firstHomeAt)} · every card pictured ${s1(sum.cardsWithPhotosAt)} · ${sum.visibleJumps} visible jumps · CLS ${sum.cls}</div>
    <div style="display:flex;gap:8px;padding:8px 12px 12px">${cells.join('')}</div>
    <style>figure{margin:0;width:${cellW}px}img{width:${cellW}px;height:${cellH}px;object-fit:cover;object-position:top;display:block;border:1px solid #ccc}figcaption{text-align:center;padding-top:4px}</style></body>`;
  const b = await launch({ port: DEBUG_PORT + 2, scale: 1 });
  try {
    const width = 24 + picks.length * (cellW + 8), height = cellH + 80;
    const page = await b.newPage({ width, height, mobile: false });
    await page.send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
    await sleep(800);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(OUT, 'strip.png'), Buffer.from(data, 'base64'));
  } finally { await b.close(); }
}

const main = async () => {
  await mkdir(join(OUT, 'frames'), { recursive: true });
  process.stdout.write(`warm session (${SEED} @ ${AT.join(':')})...\n`);
  const storage = await warmSession();
  process.stdout.write(`cold launch: cpu ${CPU}x, supabase ${LAT_MIN}-${LAT_MAX} ms, session ${SESSION_MS} ms, photos ${IMG_MS} ms\n`);
  const { T, frames, origin, navAt } = await coldLaunch(storage);
  const sum = summarize(T);
  // Frame times relative to navigation (screencast stamps are wall-clock seconds).
  const rel = frames.map((f) => ({ t: Math.round((f.t - origin / 1000) * 1000), data: f.data }));
  await rm(join(OUT, 'frames'), { recursive: true, force: true });
  await mkdir(join(OUT, 'frames'), { recursive: true });
  const index = [];
  for (const f of rel) {
    const name = `f${String(Math.max(0, f.t)).padStart(5, '0')}.jpg`;
    await writeFile(join(OUT, 'frames', name), Buffer.from(f.data, 'base64'));
    index.push({ t: f.t, file: name });
  }
  await writeFile(join(OUT, 'timeline.json'), JSON.stringify({ config: { W, H, CPU, LAT_MIN, LAT_MAX, SESSION_MS, IMG_MS, SEED, AT, navAt }, summary: sum, frames: index, ...T }, null, 1));
  process.stdout.write(JSON.stringify(Object.assign({}, sum, { jumps: undefined }), null, 1) + '\n');
  for (const e of T.errors) process.stdout.write(`  page error: ${String(e).slice(0, 300)}
`);
  for (const j of sum.jumps) process.stdout.write(`  ${String(j.t).padStart(5)} ms  ${j.what}\n`);
  if (index.length) {
    await composeStrip(index, sum);
    process.stdout.write(`frames: ${index.length} -> ${join(OUT, 'frames')}; strip -> ${join(OUT, 'strip.png')}\n`);
  }
};
main().catch((e) => { console.error(e); process.exit(1); });
