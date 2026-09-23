// Keyboard-motion probe (composer upgrade, 2026-09-23). Headless Chromium cannot raise a real
// keyboard, so this drives the same entry point the native shell does (window.__nativeKeyboard,
// fed from iOS keyboardWillShow/WillHide in ProtoApp.tsx) and samples every animation frame:
// the dock's top, the newest message's bottom, the scroller and the shell. What it proves: one
// motion (the gap between the newest message and the bar holds while the shell shrinks, and no
// second move lands after the animation). What it cannot prove: WKWebView's own behaviour.
//
//   node scripts/serve-proto.mjs 8811 &
//   node scripts/kb-motion-probe.mjs [route] [port] [native|vv]
// Pointing [port] at a server of the pre-branch proto (git archive 91b31656) with `vv` measures the
// old behaviour for comparison.
import { launch, goto, evalJs, seedOnNewDocument, sleep } from '../web/landing-src/lib/cdp.mjs';
import { SEEDS } from '../web/landing-src/lib/seeds.mjs';
import { sbStubSource, ROSTER_ATHLETES } from '../web/landing-src/lib/sb-stub.mjs';

const route = process.argv[2] || 'meal-thread/lunch';
const serve = Number(process.argv[3] || 8811);
// native: the shell's keyboardWillShow path (this branch). vv: only a visualViewport resize, sent
// when the keys have ARRIVED (250ms), which is all the proto had before this branch.
const mode = process.argv[4] || 'native';
const seed = route.startsWith('coach') ? 'coachIdentity' : 'dayMidday';
const b = await launch({ port: 9377, scale: 1 });
try {
  const page = await b.newPage({ width: 390, height: 844 });
  await seedOnNewDocument(page, `(() => { const FAKE = new Date(2026,6,23,13,9,0).getTime(); const R = Date;
    const D = function(...a){ return a.length ? new R(...a) : new R(FAKE); };
    D.now = () => FAKE; D.parse = R.parse; D.UTC = R.UTC; D.prototype = R.prototype;
    Object.setPrototypeOf(D, R); globalThis.Date = D; })();`);
  await seedOnNewDocument(page, sbStubSource({ todayISO: '2026-07-23', athletes: ROSTER_ATHLETES, voice: 'numbers' }));
  await goto(page, `http://localhost:${serve}/index.html`, { settleMs: 1100 });
  await evalJs(page, `(async () => { ${SEEDS[seed]} return 1; })()`);
  await evalJs(page, `(() => { location.hash = '#${route}'; return 1; })()`);
  await sleep(route.startsWith('coach') ? 2600 : 1600);
  const out = await evalJs(page, `(async () => {
    const vp = document.querySelector('.viewport');
    vp.style.scrollBehavior = 'auto'; vp.scrollTop = vp.scrollHeight;
    await new Promise((r) => setTimeout(r, 200));
    const box = document.querySelector('.chat-dock textarea');
    box.focus();
    const msgs = () => { const all = document.querySelectorAll('.thread .msg, .thread .rc-card, .thread > *'); return all[all.length - 1]; };
    const dock = () => document.querySelector('.chat-dock');
    const comp = () => document.querySelector('.chat-dock .composer');
    const MODE = '${mode}';
    let kbNow = 0; const vv = window.visualViewport; const H0 = window.innerHeight;
    if (MODE === 'vv') Object.defineProperty(vv, 'height', { configurable: true, get: () => H0 - kbNow });
    const dev = document.querySelector('.device');
    const sample = (t0) => ({ t: Math.round(performance.now() - t0), dev: Math.round(dev.getBoundingClientRect().height),
      dockTop: Math.round(dock().getBoundingClientRect().top), dockBottom: Math.round(dock().getBoundingClientRect().bottom),
      lastBottom: Math.round(msgs().getBoundingClientRect().bottom), st: Math.round(vp.scrollTop),
      pad: getComputedStyle(dock()).paddingBottom, open: document.body.classList.contains('kb-open'),
      compBottom: Math.round(comp().getBoundingClientRect().bottom),
      keysTop: Math.round(844 - KB * (1 - Math.pow(1 - Math.min(1, (performance.now() - t0) / 250), 3))) });
    let KB = 0;
    const run = async (px, ms, n) => {
      const from = KB; const t0 = performance.now();
      // The keys, animating from where they were to px over 250ms (for the "covered" column).
      KB = px; const s = [];
      if (MODE === 'native') window.__nativeKeyboard(px, ms);
      else setTimeout(() => { kbNow = px; vv.dispatchEvent(new Event('resize')); }, 250);
      s.push(sample(t0));
      await new Promise((res) => { let k = 0; const f = () => { s.push(sample(t0)); if (++k < n) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      return s;
    };
    const up = await run(336, 250, 50);
    await new Promise((r) => setTimeout(r, 300));
    box.blur();
    const down = await run(0, 250, 50);
    return { up, down };
  })()`);
  const show = (name, rows) => {
    console.log(`\n${name}  (t ms | shell h | dock top/bottom | pill bottom | keys top (model) | pill under keys | last msg bottom | gap msg->dock | scrollTop | kb-open)`);
    for (const r of rows.filter((_, i) => i % 3 === 0 || i === rows.length - 1)) {
      console.log(`${String(r.t).padStart(4)} | ${r.dev} | ${r.dockTop}/${r.dockBottom} | ${r.compBottom} | ${r.keysTop} | ${Math.max(0, r.compBottom - r.keysTop)} | ${r.lastBottom} | ${r.dockTop - r.lastBottom} | ${r.st} | ${r.open}`);
    }
    const gaps = rows.map((r) => r.dockTop - r.lastBottom);
    const tops = rows.map((r) => r.dockTop);
    let reversals = 0;
    for (let i = 2; i < tops.length; i++) { const a = tops[i - 1] - tops[i - 2], c = tops[i] - tops[i - 1]; if (a && c && Math.sign(a) !== Math.sign(c)) reversals++; }
    const settledAt = rows.findIndex((r, i) => rows.slice(i).every((x) => x.dockTop === rows[rows.length - 1].dockTop));
    const under = rows.map((r) => Math.max(0, r.compBottom - r.keysTop));
    // rows[0] is sampled synchronously with the call, before the browser has applied any style: on a
    // phone the resting pill sits the home-indicator inset (34px) above the edge, which absorbs it.
    const covered = `${under[1] || 0}px on the first painted frame, ${Math.max(0, ...under.slice(2))}px after it`;
    console.log(`gap msg->dock: min ${Math.min(...gaps)} max ${Math.max(...gaps)} | dock direction reversals: ${reversals} | dock settled at ${rows[settledAt].t}ms | pill under the (modelled) keys: ${covered}`);
  };
  show(`KEYBOARD UP (${mode}, 336px, 250ms)`, out.up);
  show(`KEYBOARD DOWN (${mode}, 0, 250ms)`, out.down);
} finally {
  await b.close();
}
