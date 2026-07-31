#!/usr/bin/env node
// UI motion capture for the "One Day on Standard" commercial.
//
// Screencasts the REAL proto app (same engine, same seeds-as-evidence discipline as
// scripts/qc-capture.mjs — no number painted here) into frame sequences + per-frame
// timestamps, then assembles each sequence into a lossless-ish mp4 via ffmpeg.
//
//   node scripts/serve-proto.mjs 8799        # in one shell (or let this script spawn it)
//   node scripts/commercial/capture-ui.mjs            # all sequences
//   node scripts/commercial/capture-ui.mjs ring,thread # filter by name
//
// Output: .tmp/commercial/ui/<seq>/frame-*.jpg + <seq>.mp4 + stills/*.png
import { launch, goto, evalJs, seedOnNewDocument, screenshot, sleep } from '../../web/landing-src/lib/cdp.mjs';
import { SEEDS } from '../../web/landing-src/lib/seeds.mjs';
import { sbStubSource, ROSTER_ATHLETES, BOOK_CLIENTS } from '../../web/landing-src/lib/sb-stub.mjs';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';

const BASE = 'http://localhost:8799/index.html';
const TODAY = '2026-07-23'; // matches the sb stub's TODAY
const OUT = join(process.cwd(), '.tmp', 'commercial', 'ui');
// --hi: deliver the screencast at native 2x surface size (content 780x1688, ~11fps) for
// punch-in detail shots; default 1x (content 390x844, ~19fps) for smooth motion. The edit
// picks per shot. Everything else is identical between the two profiles.
const HI = process.argv.includes('--hi');
const filter = (process.argv[2] || '').split(',').filter((a) => a && !a.startsWith('--'));

/* ---------------- deterministic clock (same trick as qc-capture) ---------------- */
const clockAt = (h, m) => `(() => { const FAKE = new Date(2026,6,23,${h},${m},0).getTime(); const R = Date;
  const D = function(...a){ return a.length ? new R(...a) : new R(FAKE); };
  D.now = () => FAKE; D.parse = R.parse; D.UTC = R.UTC; D.prototype = R.prototype;
  Object.setPrototypeOf(D, R); globalThis.Date = D; })();`;

/* ---------------- custom seeds ----------------
 * Same evidence-not-outcomes discipline as web/landing-src/lib/seeds.mjs; these two moments
 * (5:02 AM empty day, 7:41 AM staged breakfast) don't exist there. */
const IDENTITY = `
  const day = await import('/js/day.js');
  const st  = await import('/js/state.js');
  const { DAY } = day; const { RT } = st;
  const iso = (back) => { const d = new Date(DAY.date + 'T12:00:00'); d.setDate(d.getDate() - back);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
  RT.authRole = 'athlete';
  RT.userId = 'seed-athlete';
  RT.profile = { name: 'Marcus Reed', sport: 'Football', position: 'WR', school: 'Lincoln High', level: 'Varsity',
    targets: { protein: 180, calories: 3200, weight: 195 } };
  RT.myCoach = { name: 'James Brooks', teamName: 'Lincoln Varsity Football' };
  RT.activationDate = iso(41);
  RT.day0 = false;
  RT.lastLockSeen = iso(1);
  // Every tour/tip id reads as long-seen — the first-run spotlight scrim dims the whole take.
  RT.tourSeen = new Proxy({}, { get: () => '2026-06-01T00:00:00Z', has: () => true });
  const pattern = [92, 88, 95, 84, 91, 87, 93, 86, 90, 94, 82, 89, 96, 85, 91, 88, 93, 90, 87, 92, 84, 95, 89, 86, 91, 93, 88, 90, 85, 94, 87, 92, 89, 91];
  DAY.scoreHistory = Array.from({length: 34}, (_, i) => ({ date: iso(34 - i), score: pattern[i % pattern.length], weight: null }));
  DAY.proteinTarget = 180; DAY.calTarget = 3200; DAY.scoringProfile = 'athlete';
  DAY.currentWeight = 187.4;
`;

// 5:02 AM: nothing logged yet — the day hasn't started; the roll call owns the screen.
const seedRollCall = `${IDENTITY}
  DAY.hydrationL = 0;
  DAY.ciLast = { date: iso(1), recovery: 82 };
  window.__render();
`;

// 7:41 AM: a REAL plate photo staged as breakfast, sitting on the confirm gate.
const seedSnap = `${IDENTITY}
  DAY.hydrationL = 0.4;
  DAY.ciLast = { date: iso(1), recovery: 82 };
  await (async () => {
    const res = await fetch('/assets/meal-breakfast.jpg');
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    const s = Math.min(1000 / bmp.width, 1000 / bmp.height, 1);
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    st.act.captureMeal(dataUrl.split(',')[1], dataUrl, 'breakfast', true, {});
  })();
  window.__render();
`;

/* ---------------- page-side patches (post-boot, pre-navigation) ---------------- */

// The stub has no ack_commitment rpc — a raw call would patch acknowledged_at with [] and the
// receipt would read "Invalid Date". Serve the frozen clock's honest timestamp instead.
const patchAck = `(() => {
  const real = window.sb.rpc.bind(window.sb);
  window.sb.rpc = (name, params) => name === 'ack_commitment'
    ? Promise.resolve({ data: '${TODAY}T09:02:30Z', error: null })  // 5:02:30 AM ET
    : real(name, params);
  return 1; })()`;

// Angela Reed joins the lunch thread: one guardian participant + one warm line, injected at the
// sb seam (the only patchable seam — module state is private). Filters already ran on the stub's
// rows; the appended row carries the thread's meal_id so it only ever lands on that conversation.
const patchParent = `(() => {
  const realFrom = window.sb.from.bind(window.sb);
  window.sb.from = (t) => {
    const b = realFrom(t);
    if (t === 'meal_comments') {
      let mealId = null;
      const realEq = b.eq.bind(b);
      b.eq = (c, v) => { if (c === 'meal_id') mealId = v; return realEq(c, v); };
      const realThen = b.then.bind(b);
      b.then = (res, rej) => realThen((r) => {
        if (mealId === 'meal-seed-lunch' && r && Array.isArray(r.data)) {
          r.data.push({ id: 'mc-p1', meal_id: 'meal-seed-lunch', athlete_id: 'seed-athlete',
            author_id: 'seed-parent', role: 'parent', kind: 'message',
            created_at: '${TODAY}T13:18:00Z',
            text: 'Proud of this one. I\\u2019ll have the grill going when you\\u2019re home.' });
          r.data.sort((a, z) => String(a.created_at).localeCompare(String(z.created_at)));
        }
        return res ? res(r) : r;
      }, rej);
    }
    return b;
  };
  const realRpc = window.sb.rpc.bind(window.sb);
  window.sb.rpc = async (name, params) => {
    const r = await realRpc(name, params);
    if (name === 'meal_thread_participants' && Array.isArray(r.data)) {
      r.data.push({ id: 'seed-parent', name: 'Angela Reed', kind: 'guardian' });
    }
    return r;
  };
  return 1; })()`;

/* ---------------- action helpers (run inside the page during capture) ---------------- */
const click = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'MISSING ${'' /* seq log shows which */}' + ${JSON.stringify(sel)};
  el.click(); return 'clicked'; })()`;

const smoothScroll = (toSel, ms) => `(() => new Promise((done) => {
  // The app scrolls an inner container, not the window — find the real scrolling ancestor.
  const el = document.querySelector(${JSON.stringify(toSel)});
  let sc = el && el.parentElement;
  while (sc && sc !== document.body && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement;
  const isWin = !sc || sc === document.body || sc === document.documentElement;
  const maxTo = isWin ? document.documentElement.scrollHeight - innerHeight : sc.scrollHeight - sc.clientHeight;
  const target = Math.max(0, Math.min(maxTo,
    el ? (isWin ? el.getBoundingClientRect().top + window.scrollY : el.offsetTop - sc.clientHeight + el.offsetHeight + 24) : maxTo));
  const from = isWin ? window.scrollY : sc.scrollTop, t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / ${ms});
    const e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;
    const y = from + (target - from) * e;
    if (isWin) window.scrollTo(0, y); else sc.scrollTop = y;
    if (k < 1) requestAnimationFrame(step); else done('scrolled ' + Math.round(target - from) + 'px ' + (isWin ? 'window' : 'inner')); };
  requestAnimationFrame(step); }))()`;

// Human-speed typing into a composer, then send.
const typeAndSend = (inputSel, sendSel, text, cps) => `(async () => {
  const ta = document.querySelector(${JSON.stringify(inputSel)});
  if (!ta) return 'MISSING ' + ${JSON.stringify(inputSel)};
  ta.focus();
  const msg = ${JSON.stringify(text)};
  for (let i = 1; i <= msg.length; i++) {
    ta.value = msg.slice(0, i);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, ${Math.round(1000 / cps)} + Math.random() * 40));
  }
  await new Promise(r => setTimeout(r, 450));
  const btn = document.querySelector(${JSON.stringify(sendSel)});
  if (btn) { btn.click(); return 'sent'; }
  return 'typed (no send button found)'; })()`;

// The first-run spotlight tour dims any first screen it fires on — every id reads as long-seen.
// keepRecordSeen: boot hydration under the stub infers a roster that "ended" (team_members is
// empty), which plants the churn-parachute card in the middle of the 5 AM beat. Not this story.
const suppressTour = `(async () => { const st = await import('/js/state.js');
  st.RT.tourSeen = new Proxy({}, { get: () => '2026-06-01T00:00:00Z', has: () => true });
  st.RT.keepRecordSeen = true;
  return 1; })()`;

/* ---------------- sequences ---------------- */
const SEQS = [
  { name: 'rollcall', at: [5, 2], seed: seedRollCall, vc: 'open', route: 'home',
    patches: [patchAck],
    steps: [ { wait: 2600 }, { js: click('[data-vc-ack]'), log: true }, { wait: 3400 } ] },

  { name: 'snap', at: [7, 41], seed: seedSnap, route: 'camera-confirm',
    steps: [ { wait: 2800 }, { js: click('#cc-analyze'), log: true }, { wait: 5200 } ] },

  // meal-analysis without a staged capture renders the EMPTY state (0g/0g/0g) — the breakfast
  // DETAIL screen carries the real seeded numbers, and it's the beat-2 "numbers land" payoff.
  { name: 'bfast', at: [8, 27], seed: SEEDS.dayMorning, route: 'meal-detail/breakfast',
    patches: [`(async () => { const d = await import('/js/day.js'); d.DAY.slotMacros.breakfast.fiber = 7; return 1; })()`],
    steps: [ { wait: 3600 }, { js: smoothScroll('.macro-row, #view > *:last-child', 2600) }, { wait: 1400 } ] },

  { name: 'thread', at: [13, 30], seed: SEEDS.dayMidday, route: 'meal-thread/lunch',
    patches: [patchParent,
      // The seed plates carry no fiber key, so the macro tile reads "~0g FIBER" — a real
      // historical bug's silhouette, exactly the wrong thing to freeze-frame in an ad.
      `(async () => { const d = await import('/js/day.js'); d.DAY.slotMacros.lunch.fiber = 9; return 1; })()`],
    steps: [ { wait: 3600 }, { js: smoothScroll('.composer', 3400), log: true }, { wait: 2400 } ] },

  { name: 'coachmeal', at: [13, 32], seed: SEEDS.coachIdentity, route: 'coach-meal/meal-seed-lunch', book: 'team',
    steps: [ { wait: 3400 }, { js: smoothScroll('.composer, #view > *:last-child', 2000) },
             { js: typeAndSend('#cm-input', '#cm-send', "That's the standard. Keep stacking.", 14), log: true }, { wait: 2200 } ] },

  { name: 'parenthome', at: [13, 33], seed: SEEDS.parentIdentity, route: 'parent', book: 'team',
    steps: [ { wait: 3000 }, { js: smoothScroll('#view > *:last-child', 2400) }, { wait: 900 } ] },

  { name: 'ring', at: [21, 58], seed: SEEDS.dayComplete, route: 'home',
    steps: [ { wait: 5200 } ] },

  { name: 'breakdown', at: [21, 52], seed: SEEDS.dayComplete, route: 'score-breakdown',
    steps: [ { wait: 3200 }, { js: smoothScroll('#view > *:last-child', 2400) }, { wait: 900 } ] },

  /* -------- demo-video flows (2026-07-31 role demos). Routes/seeds/clocks mirror the proven
   * qc-capture SHOTS entries; every screen renders real seeded evidence through the engine. -------- */

  // athlete
  { name: 'homeday', at: [7, 52], seed: SEEDS.dayMorning, route: 'home',
    steps: [ { wait: 3400 }, { js: smoothScroll('#view > *:last-child', 3000), log: true }, { wait: 1200 } ] },
  { name: 'plan', at: [13, 20], seed: SEEDS.dayComplete, route: 'plan',
    steps: [ { wait: 3200 }, { js: smoothScroll('#view > *:last-child', 3200) }, { wait: 1200 } ] },
  { name: 'logsheet', at: [15, 30], seed: SEEDS.dayMidday, route: 'log',
    steps: [ { wait: 3600 }, { wait: 1200 } ] },
  { name: 'checkin', at: [21, 35], seed: SEEDS.dayMidday, route: 'checkin',
    steps: [ { wait: 3200 }, { js: smoothScroll('#view > *:last-child', 3000) }, { wait: 1200 } ] },
  { name: 'progress', at: [21, 55], seed: SEEDS.dayComplete, route: 'progress',
    steps: [ { wait: 3400 }, { js: smoothScroll('#view > *:last-child', 3200) }, { wait: 1200 } ] },
  // ensure_* + my_connected_standards round-trips land after first paint — give the loader time.
  { name: 'standards', at: [18, 45], seed: SEEDS.dayMidday, route: 'connected-standard/csr-steps', cs: 'live',
    steps: [ { wait: 6200 }, { js: smoothScroll('#view > *:last-child', 2600) }, { wait: 1200 } ] },
  { name: 'streakmove', at: [21, 45], seed: SEEDS.dayComplete, route: 'streak',
    steps: [ { wait: 3600 }, { js: smoothScroll('#view > *:last-child', 2600) }, { wait: 1000 } ] },

  // coach
  { name: 'coachhome', at: [20, 10], seed: SEEDS.coachIdentity, route: 'coach-home', book: 'team',
    steps: [ { wait: 4000 }, { js: smoothScroll('#view > *:last-child', 3400), log: true }, { wait: 1200 } ] },
  { name: 'roster', at: [20, 10], seed: SEEDS.coachIdentity, route: 'coach-roster', book: 'team',
    steps: [ { wait: 4000 }, { js: smoothScroll('#view > *:last-child', 3200) }, { wait: 1200 } ] },
  { name: 'inbox', at: [20, 10], seed: SEEDS.coachIdentity, route: 'coach-inbox', book: 'team',
    steps: [ { wait: 4000 }, { js: smoothScroll('#view > *:last-child', 2800) }, { wait: 1200 } ] },
  // 5:02, not 6:05 — after respond_by (5:15) the board resolves out and reads "0 of 0 in".
  { name: 'commitboard', at: [5, 2], seed: SEEDS.coachIdentity, route: 'coach-commitments', book: 'team',
    steps: [ { wait: 4800 }, { js: smoothScroll('#view > *:last-child', 2800) }, { wait: 1200 } ] },
  { name: 'insights', at: [20, 10], seed: SEEDS.coachIdentity, route: 'coach-insights', book: 'team',
    steps: [ { wait: 4000 }, { js: smoothScroll('#view > *:last-child', 3200) }, { wait: 1200 } ] },
  { name: 'csboard', at: [20, 4], seed: SEEDS.coachIdentity, route: 'coach-standards', cs: 'live', book: 'team',
    steps: [ { wait: 6800 }, { js: smoothScroll('#view > *:last-child', 2800) }, { wait: 1200 } ] },
  { name: 'announce', at: [20, 10], seed: SEEDS.coachIdentity, route: 'coach-announce', book: 'team',
    steps: [ { wait: 3600 }, { js: smoothScroll('#view > *:last-child', 2400) }, { wait: 1200 } ] },

  // trainer
  { name: 'trainerbook', at: [7, 30], seed: SEEDS.trainerIdentity, route: 'coach-roster', book: 'practice',
    steps: [ { wait: 4000 }, { js: smoothScroll('#view > *:last-child', 3000) }, { wait: 1200 } ] },
  { name: 'trainerhome', at: [7, 30], seed: SEEDS.trainerIdentity, route: 'coach-home', book: 'practice',
    steps: [ { wait: 4000 }, { js: smoothScroll('#view > *:last-child', 3000) }, { wait: 1200 } ] },
  { name: 'trainermeal', at: [7, 30], seed: SEEDS.trainerIdentity, route: 'coach-meal/meal-seed-lunch', book: 'practice',
    steps: [ { wait: 3600 }, { js: smoothScroll('.composer, #view > *:last-child', 2400) }, { wait: 1400 } ] },
  { name: 'trainergrow', at: [7, 30], seed: SEEDS.trainerIdentity, route: 'trainer-grow', book: 'practice',
    steps: [ { wait: 3800 }, { js: smoothScroll('#view > *:last-child', 2800) }, { wait: 1200 } ] },
  { name: 'trainerinbox', at: [7, 30], seed: SEEDS.trainerIdentity, route: 'trainer-inbox', book: 'practice',
    steps: [ { wait: 4000 }, { js: smoothScroll('#view > *:last-child', 2800) }, { wait: 1200 } ] },

  // parent
  { name: 'fundplan', at: [19, 16], seed: SEEDS.parentIdentity, route: 'fund-plan', book: 'team',
    steps: [ { wait: 3800 }, { js: smoothScroll('#view > *:last-child', 2800) }, { wait: 1200 } ] },
];

/* ---------------- stills (for Remotion side-panels / end card) ---------------- */
const STILLS = [
  // The connected-standards loaders resolve under the stills path but wedge under the motion
  // path (page-scale/screencast interaction never diagnosed) — these two ship as slow-pan
  // stills in the demo edit instead.
  { name: 'cs-detail', at: [18, 45], seed: SEEDS.dayMidday, route: 'connected-standard/csr-steps', cs: 'live' },
  { name: 'cs-board', at: [20, 4], seed: SEEDS.coachIdentity, route: 'coach-standards', cs: 'live', book: 'team' },
  { name: 'home-morning', at: [7, 52], seed: SEEDS.dayMorning, route: 'home' },
  { name: 'meal-detail', at: [13, 8], seed: SEEDS.dayMidday, route: 'meal-detail/lunch' },
  { name: 'coach-roster', at: [20, 10], seed: SEEDS.coachIdentity, route: 'coach-roster', book: 'team' },
  { name: 'streak', at: [21, 45], seed: SEEDS.dayComplete, route: 'streak' },
];

/* ---------------- serve the proto (reuse a running server if 8799 is taken) ---------------- */
let server = null;
try {
  await fetch(BASE, { method: 'HEAD' });
  console.log('proto already served on 8799');
} catch {
  server = spawn(process.execPath, [join(process.cwd(), 'scripts', 'serve-proto.mjs'), '8799'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE, { method: 'HEAD' }); break; } catch { await sleep(250); } }
}

// 796x1839: headless=new's screencast surface is (w-16)x(h-151) DIP and the emulated page
// scales to fit its WIDTH (bottom crops if the aspect is short). 780x1688 = 390x844 at exactly
// 2x — full page, no crop, no resample blur. Derived empirically; see .tmp probe.
const b = await launch({ port: 9347, scale: 2, windowSize: [796, 1839] });
const summary = [];
try {
  /* -------- motion sequences -------- */
  for (const s of SEQS) {
    if (filter.length && !filter.some((f) => s.name.includes(f))) continue;
    const dir = join(OUT, s.name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const page = await b.newPage({ width: 390, height: 844 });
    // Headless defaults to prefers-reduced-motion: reduce — no animation would EVER render.
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    // Fill the 780x1688 screencast surface at 2x instead of rendering 1:1 in its corner.
    await page.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await seedOnNewDocument(page, clockAt(...s.at));
    if (s.vc) await seedOnNewDocument(page, `window.__VC_MODE = ${JSON.stringify(s.vc)};`);
    await seedOnNewDocument(page, sbStubSource({
      todayISO: TODAY,
      athletes: s.book === 'practice' ? BOOK_CLIENTS : ROSTER_ATHLETES,
    }));
    await goto(page, BASE, { settleMs: 1100 });
    await evalJs(page, `(async () => { ${s.seed} return 1; })()`);
    await evalJs(page, suppressTour);
    await evalJs(page, `(async () => { const st = await import('/js/state.js'); st.RT.theme = 'dark'; st.applyTheme(); window.__render(); return 1; })()`);
    for (const p of s.patches || []) await evalJs(page, p);
    // Image decode barrier — async-decoded photos otherwise capture blank.
    await evalJs(page, `Promise.all([...document.images].map(i => i.decode().catch(() => 1))).then(() => 1)`);

    // start screencast BEFORE navigation so the mount animation is in the take
    const frames = [];
    const listener = async (msg) => {
      if (msg.method !== 'Page.screencastFrame' || msg.sessionId !== page.sessionId) return;
      frames.push({ data: msg.params.data, t: msg.params.metadata.timestamp });
      try { await page.send('Page.screencastFrameAck', { sessionId: msg.params.sessionId }); } catch { /* raced stop */ }
    };
    b.on(listener);
    // The compositor renders the page at 2x into the surface's top-left; maxWidth decides how
    // much of that resolution survives delivery. Content region: 390x844 (1x) / 780x1688 (--hi).
    const cap = HI ? 3376 : 1690;
    await page.send('Page.startScreencast', { format: 'jpeg', quality: HI ? 82 : 88, everyNthFrame: 1, maxWidth: cap, maxHeight: cap });
    await sleep(300);
    await evalJs(page, `(() => { location.hash = '#${s.route}'; return 1; })()`);
    for (const step of s.steps) {
      if (step.wait) await sleep(step.wait);
      if (step.js) {
        const r = await evalJs(page, step.js).catch((e) => 'ERR ' + e.message);
        if (step.log) console.log(`  [${s.name}] action → ${r}`);
      }
    }
    await page.send('Page.stopScreencast');
    await sleep(200);

    // frames → disk → ffconcat with real per-frame durations → mp4
    let n = 0;
    for (const f of frames) await writeFile(join(dir, `frame-${String(n++).padStart(4, '0')}.jpg`), Buffer.from(f.data, 'base64'));
    if (frames.length > 1) {
      const lines = ['ffconcat version 1.0'];
      for (let i = 0; i < frames.length; i++) {
        const dur = i < frames.length - 1 ? Math.max(0.008, frames[i + 1].t - frames[i].t) : 0.4;
        lines.push(`file 'frame-${String(i).padStart(4, '0')}.jpg'`, `duration ${dur.toFixed(4)}`);
      }
      lines.push(`file 'frame-${String(frames.length - 1).padStart(4, '0')}.jpg'`);
      await writeFile(join(dir, 'list.ffconcat'), lines.join('\n'));
      try {
        // Crop to the page-content region (top-left of the letterboxed surface).
        const crop = HI ? 'crop=780:1688:0:0' : 'crop=390:844:0:0';
        execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.ffconcat'),
          '-vf', `fps=30,${crop},format=yuv420p`, '-c:v', 'libx264', '-crf', '12', '-preset', 'slow',
          join(OUT, s.name + (HI ? '-hi' : '') + '.mp4')], { stdio: 'pipe' });
      } catch (e) {
        console.log(`  [${s.name}] ffmpeg FAILED:\n` + String(e.stderr).split('\n').slice(-6).join('\n'));
      }
    }
    const secs = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t).toFixed(1) : '0';
    console.log(`${s.name.padEnd(11)} ${frames.length} frames over ${secs}s`);
    summary.push({ name: s.name, frames: frames.length, secs });
    await b.send('Target.closeTarget', { targetId: page.targetId });
  }

  /* -------- stills -------- */
  if (!filter.length || filter.includes('stills')) {
    const sd = join(OUT, 'stills');
    await mkdir(sd, { recursive: true });
    for (const s of STILLS) {
      const page = await b.newPage({ width: 390, height: 844 });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await seedOnNewDocument(page, clockAt(...s.at));
      if (s.cs) await seedOnNewDocument(page, `window.__CS_MODE = ${JSON.stringify(s.cs)};`);
      await seedOnNewDocument(page, sbStubSource({
        todayISO: TODAY,
        athletes: s.book === 'practice' ? BOOK_CLIENTS : ROSTER_ATHLETES,
      }));
      await goto(page, BASE, { settleMs: 1100 });
      await evalJs(page, `(async () => { ${s.seed} return 1; })()`);
      await evalJs(page, suppressTour);
      await evalJs(page, `(async () => { const st = await import('/js/state.js'); st.RT.theme = 'dark'; st.applyTheme(); window.__render(); return 1; })()`);
      await evalJs(page, `(() => { location.hash = '#${s.route}'; return 1; })()`);
      await sleep(/^(coach|parent)/.test(s.route) ? 2800 : 1800);
      await evalJs(page, `Promise.all([...document.images].map(i => i.decode().catch(() => 1))).then(() => 1)`);
      await writeFile(join(sd, s.name + '.png'), await screenshot(page, { format: 'png' }));
      console.log(`still: ${s.name}`);
      await b.send('Target.closeTarget', { targetId: page.targetId });
    }
  }
} finally {
  await b.close();
  if (server) server.kill();
}
console.log('\ndone →', OUT);
