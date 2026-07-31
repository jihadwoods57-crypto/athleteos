#!/usr/bin/env node
// Frame-stepped scroll capture — "a real person scrolling", at a real 30fps.
//
// The screencast harness delivers ~12fps and its rAF scroll reads robotic. Here the app
// REALLY scrolls (sticky headers, tab bar, scroll shadows all stay honest) but time is
// ours: for every output frame we set the scroller's position along a thumb-flick curve
// (flick → decaying glide → tiny overshoot-settle → pause → flick) and take a full-quality
// screenshot. Output goes straight into the Remotion seq tree as '<name>s' @30fps.
//
//   node scripts/serve-proto.mjs 8799     # in one shell
//   node scripts/commercial/capture-scroll.mjs [names]
import { launch, goto, evalJs, seedOnNewDocument, screenshot, sleep } from '../../web/landing-src/lib/cdp.mjs';
import { SEEDS } from '../../web/landing-src/lib/seeds.mjs';
import { sbStubSource, ROSTER_ATHLETES, BOOK_CLIENTS } from '../../web/landing-src/lib/sb-stub.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8799/index.html';
const TODAY = '2026-07-23';
const ROOT = process.cwd();
const SEQ_ROOT = join(ROOT, 'scripts', 'commercial', 'remotion', 'public', 'seq');
const MANIFEST = join(ROOT, 'scripts', 'commercial', 'remotion', 'src', 'seq-manifest.ts');
const FPS = 30;
const filter = (process.argv[2] || '').split(',').filter(Boolean);

const clockAt = (h, m) => `(() => { const FAKE = new Date(2026,6,23,${h},${m},0).getTime(); const R = Date;
  const D = function(...a){ return a.length ? new R(...a) : new R(FAKE); };
  D.now = () => FAKE; D.parse = R.parse; D.UTC = R.UTC; D.prototype = R.prototype;
  Object.setPrototypeOf(D, R); globalThis.Date = D; })();`;

const suppressTour = `(async () => { const st = await import('/js/state.js');
  st.RT.tourSeen = new Proxy({}, { get: () => '2026-06-01T00:00:00Z', has: () => true });
  st.RT.keepRecordSeen = true; return 1; })()`;

// Same parent-in-thread + fiber patches the motion harness uses (thread/bfast beats).
// The raw file text carries \\u2019 (an escape *for* the eval string) — reading it as text
// keeps both backslashes and the page renders a literal "’". Collapse them.
const patchParent = readFileSync(join(ROOT, 'scripts', 'commercial', 'capture-ui.mjs'), 'utf8')
  .match(/const patchParent = `([\s\S]*?)`;/)[1]
  .replace(/\\\\u/g, '\\u');
const fiberPatch = (slot, g) => `(async () => { const d = await import('/js/day.js'); d.DAY.slotMacros.${slot}.fiber = ${g}; return 1; })()`;

/* ---------------- the screens (route/seed/clock mirror the proven captures) ---------------- */
const SCREENS = [
  { name: 'homedays', at: [7, 52], seed: 'dayMorning', route: 'home', secs: 7 },
  { name: 'plans', at: [13, 20], seed: 'dayComplete', route: 'plan', secs: 7 },
  { name: 'checkins', at: [21, 35], seed: 'dayMidday', route: 'checkin', secs: 5.5 },
  { name: 'progresss', at: [21, 55], seed: 'dayComplete', route: 'progress', secs: 7 },
  { name: 'streaks', at: [21, 45], seed: 'dayComplete', route: 'streak', secs: 7 },
  { name: 'bfasts', at: [8, 27], seed: 'dayMorning', route: 'meal-detail/breakfast', secs: 7.5, patches: [fiberPatch('breakfast', 7)] },
  { name: 'threads', at: [13, 30], seed: 'dayMidday', route: 'meal-thread/lunch', secs: 8, patches: ['PARENT', fiberPatch('lunch', 9)] },
  { name: 'coachhomes', at: [20, 10], seed: 'coachIdentity', route: 'coach-home', book: 'team', secs: 8.5 },
  { name: 'rosters', at: [20, 10], seed: 'coachIdentity', route: 'coach-roster', book: 'team', secs: 7 },
  { name: 'inboxs', at: [20, 10], seed: 'coachIdentity', route: 'coach-inbox', book: 'team', secs: 7 },
  { name: 'insightss', at: [20, 10], seed: 'coachIdentity', route: 'coach-insights', book: 'team', secs: 8 },
  { name: 'announces', at: [20, 10], seed: 'coachIdentity', route: 'coach-announce', book: 'team', secs: 6.5 },
  { name: 'commitboards', at: [5, 2], seed: 'coachIdentity', route: 'coach-commitments', book: 'team', secs: 5 },
  { name: 'trainerhomes', at: [7, 30], seed: 'trainerIdentity', route: 'coach-home', book: 'practice', secs: 8 },
  { name: 'trainerbooks', at: [7, 30], seed: 'trainerIdentity', route: 'coach-roster', book: 'practice', secs: 6.5 },
  { name: 'trainerinboxs', at: [7, 30], seed: 'trainerIdentity', route: 'trainer-inbox', book: 'practice', secs: 6.5 },
  { name: 'trainermeals', at: [7, 30], seed: 'trainerIdentity', route: 'coach-meal/meal-seed-lunch', book: 'practice', secs: 8.5 },
  { name: 'trainergrows', at: [7, 30], seed: 'trainerIdentity', route: 'trainer-grow', book: 'practice', secs: 7 },
  { name: 'parenthomes', at: [19, 15], seed: 'parentIdentity', route: 'parent', book: 'team', secs: 7.5 },
];

/* ---------------- thumb-flick curve ----------------
 * A flick: position eases out along (1-(1-t)^3.1) with a 6px overshoot that settles back.
 * A screen tour: hold → flick(s) → hold, planned to fill `secs` at FPS. */
function flick(from, to, frames) {
  const out = [];
  const over = Math.sign(to - from) * Math.min(7, Math.abs(to - from) * 0.02);
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    const k = 1 - Math.pow(1 - t, 3.1);
    // overshoot rides in during the last 20% and unwinds over the final frames
    const o = t > 0.8 ? over * Math.sin(Math.PI * (t - 0.8) / 0.2) : 0;
    out.push(from + (to - from) * k + o);
  }
  return out;
}

function plan(scrollMax, totalFrames) {
  const pos = [];
  const hold = (n, v) => { for (let i = 0; i < n; i++) pos.push(v); };
  if (scrollMax < 40) { hold(totalFrames, 0); return pos; }
  if (scrollMax < 620) {
    hold(Math.round(totalFrames * 0.34), 0);
    pos.push(...flick(0, scrollMax, 26));
    hold(totalFrames - pos.length, scrollMax);
    return pos;
  }
  const mid = Math.round(scrollMax * 0.56);
  hold(Math.round(totalFrames * 0.24), 0);
  pos.push(...flick(0, mid, 27));
  hold(Math.round(totalFrames * 0.16), mid);
  pos.push(...flick(mid, scrollMax, 29));
  hold(Math.max(0, totalFrames - pos.length), scrollMax);
  return pos.slice(0, totalFrames);
}

/* ---------------- runner ---------------- */
let server = null;
try { await fetch(BASE, { method: 'HEAD' }); } catch {
  const { spawn } = await import('node:child_process');
  server = spawn(process.execPath, [join(ROOT, 'scripts', 'serve-proto.mjs'), '8799'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE, { method: 'HEAD' }); break; } catch { await sleep(250); } }
}

const b = await launch({ port: 9353, scale: 2 });
const manifestAdd = {};
try {
  for (const s of SCREENS) {
    if (filter.length && !filter.some((f) => s.name.includes(f))) continue;
    const page = await b.newPage({ width: 390, height: 844 });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await seedOnNewDocument(page, clockAt(...s.at));
    if (s.cs) await seedOnNewDocument(page, `window.__CS_MODE = ${JSON.stringify(s.cs)};`);
    await seedOnNewDocument(page, sbStubSource({
      todayISO: TODAY, athletes: s.book === 'practice' ? BOOK_CLIENTS : ROSTER_ATHLETES,
    }));
    await goto(page, BASE, { settleMs: 1100 });
    await evalJs(page, `(async () => { ${SEEDS[s.seed]} return 1; })()`);
    await evalJs(page, suppressTour);
    await evalJs(page, `(async () => { const st = await import('/js/state.js'); st.RT.theme = 'dark'; st.applyTheme(); window.__render(); return 1; })()`);
    for (const p of s.patches || []) await evalJs(page, p === 'PARENT' ? patchParent : p);
    await evalJs(page, `(() => { location.hash = '#${s.route}'; return 1; })()`);
    await sleep(/^(coach|trainer|parent|connected)/.test(s.route) ? 3400 : 2200);
    await evalJs(page, `Promise.all([...document.images].map(i => i.decode().catch(() => 1))).then(() => 1)`);

    // find the real scroller and how far it goes
    const info = await evalJs(page, `(() => {
      const cands = [document.scrollingElement, ...document.querySelectorAll('*')]
        .filter(el => el && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 500);
      const sc = cands.sort((a, z) => z.scrollHeight - a.scrollHeight)[0];
      if (!sc) return { max: 0 };
      sc.__demoScroller = true;
      return { max: sc.scrollHeight - sc.clientHeight };
    })()`);
    const totalFrames = Math.round(s.secs * FPS);
    const positions = plan(info.max, totalFrames);

    const dir = join(SEQ_ROOT, s.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < positions.length; i++) {
      await evalJs(page, `(async () => {
        const sc = [document.scrollingElement, ...document.querySelectorAll('*')].find(el => el && el.__demoScroller);
        if (sc) sc.scrollTop = ${positions[i]};
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return 1; })()`);
      writeFileSync(join(dir, `${String(i + 1).padStart(4, '0')}.jpg`), await screenshot(page, { format: 'jpeg' }));
    }
    manifestAdd[s.name] = { fps: FPS, frames: positions.length };
    console.log(`${s.name.padEnd(14)} ${positions.length}f, scrollMax ${info.max}px`);
    await b.send('Target.closeTarget', { targetId: page.targetId });
  }
} finally {
  await b.close();
  if (server) server.kill();
}

// merge into seq-manifest.ts
const cur = JSON.parse(readFileSync(MANIFEST, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//, '').replace('export const SEQS = ', '').replace(/ as const;[\s\S]*/, ''));
Object.assign(cur, manifestAdd);
writeFileSync(MANIFEST, `/* generated by scripts/commercial/explode.mjs + capture-scroll.mjs — do not edit */\n`
  + `export const SEQS = ${JSON.stringify(cur, null, 2)} as const;\nexport type SeqName = keyof typeof SEQS;\n`);
console.log(`manifest merged (+${Object.keys(manifestAdd).length})`);
