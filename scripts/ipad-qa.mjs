// iPad QA, the half a machine can do.
//
// This drives the shipped proto in a real browser engine and ASSERTS the behaviours the iPad
// layout promises: the tier boundaries, rotation, every iPadOS multitasking width, a live Split
// View divider drag, the keyboard rule, and the coach's list-to-detail flow including going back.
// Each check prints PASS or FAIL with what it actually measured.
//
// WHAT THIS IS NOT. It is not device QA. A headless Chromium is not iPadOS: it cannot raise the
// real software keyboard, run Stage Manager, fire a real rotation animation, honour a physical
// device's safe-area insets, or exercise anything native (the alarm, Live Activities, HealthKit,
// the camera, push). Those remain owed on a real iPad. Everything asserted here is layout and
// routing behaviour, which is exactly where this change lives.
//
// Run: npm run qa:ipad     Exit 0 only when every check passes.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROTO = join(ROOT, 'proto', 'redesign-2026-07');
const SIBLING = 'c:/Users/Administrator/Downloads/Formation IQ/app/package.json';

let chromium;
try {
  const req = createRequire(existsSync(SIBLING) ? SIBLING : join(ROOT, 'package.json'));
  ({ chromium } = req('playwright-core'));
} catch (e) {
  console.error(`ipad-qa: playwright-core is not available (${e.message}).`);
  process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(PROTO, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html?layout=auto`;

const SEED = `(async () => {
  const st = await import('./js/state.js');
  st.RT.userId = 'qa'; st.RT.authRole = 'coach';
  st.RT.profile = Object.assign({}, st.RT.profile || {}, { name: 'Coach Reyes', handle: 'Coach Reyes', role: 'coach' });
  const q = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (r) => r({ data: [], error: null }) : (k === 'maybeSingle' || k === 'single' ? async () => ({ data: null, error: null }) : q)), apply: () => q });
  window.sb = { from: () => q, rpc: () => q, auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) }, storage: { from: () => q }, functions: { invoke: async () => ({ data: { row: null }, error: null }) }, channel: () => ({ on() { return this; }, subscribe() { return this; } }) };
  const cd = await import('./js/coach-data.js');
  const roles = await import('./js/roles.js');
  const mk = (id, name, score) => roles.buildRosterRow({ athlete_id: id, athlete_name: name, position: 'LB' },
    score == null ? null : { score, meals: { breakfast: true, lunch: true, snack: false, dinner: false }, tasks: [] }, { scoreHistory: [] });
  try { await cd.loadCoachRoster(true); } catch {}
  const book = [{ id: 't1', name: 'UCF Linebackers', code: 'YQRB9Q' }];
  if (cd.CD.roster) { cd.CD.roster.book = book; cd.CD.roster.teams = book; cd.CD.roster.offline = false; cd.CD.roster.pending = [];
    // Long enough that the master pane genuinely overflows; the scroll-independence check below
    // is meaningless against a list that fits.
    cd.CD.roster.rows = [mk('a1','Marcus Hill',88), mk('a2','Devin Carter',71), mk('a3','Jalen Brooks',null)]
      .concat(Array.from({ length: 24 }, (_x, i) => mk('b' + i, 'Athlete ' + (i + 4), i % 3 ? 84 - i : null))); }
  cd.CD.extras = Object.assign(cd.CD.extras || {}, { sets: [], exceptions: [], rooms: [] });
})()`;

const probe = () => ({
  tier: document.documentElement.getAttribute('data-layout'),
  hash: location.hash,
  rail: (() => { const b = document.querySelector('.tabbar'); if (!b) return null; const cs = getComputedStyle(b); return cs.position === 'absolute' && Math.round(parseFloat(cs.width)) === 88 ? 'rail' : 'bar'; })(),
  split: !!document.querySelector('.screen.split .pane-master') && !!document.querySelector('.screen.split .pane-detail'),
  current: (() => { const e = document.querySelector('.pane-master [aria-current="page"]'); return e ? e.getAttribute('data-go') : null; })(),
  overflowDoc: document.documentElement.scrollWidth > window.innerWidth,
  overflowDev: (() => { const d = document.getElementById('device'); return d ? d.scrollWidth > d.clientWidth + 1 : false; })(),
  barTransform: (() => { const b = document.querySelector('.tabbar'); return b ? getComputedStyle(b).transform : null; })(),
  masterScroll: (() => { const v = document.getElementById('viewport-master'); return v ? v.scrollTop : null; })(),
  detailScroll: (() => { const v = document.getElementById('viewport'); return v ? v.scrollTop : null; })(),
});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
await page.goto(`${base}#welcome`);
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.goto(`${base}#welcome`);
await page.waitForSelector('#view');
await page.evaluate(SEED);

const go = async (hash, wait = 800) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(wait); };
const at = async (w, h, wait = 700) => { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(wait); return page.evaluate(probe); };

// ---- 1. Every iPadOS width, including the multitasking ones a divider actually lands on.
// 320/375 Slide Over; 507 and 639 are 1/3 and 1/2 splits; 694/981 are halves and 2/3; 1024/1366 full.
await go('#coach-roster');
for (const [w, h, want, label] of [
  [320, 1024, null, 'Slide Over 320'],
  [375, 1024, null, 'Slide Over 375'],
  [507, 1366, null, 'Split 1/3 (507)'],
  [639, 1366, null, 'Split 1/2 on 11" (639)'],
  [694, 1366, null, 'Just under the tier (694)'],
  [700, 1366, 'wide', 'The tier boundary (700)'],
  [763, 1366, 'wide', 'Split 1/2 on 12.9" (763)'],
  [981, 1366, 'wide', 'Split 2/3 (981)'],
  [1000, 1366, 'split', 'The split boundary (1000)'],
  [1024, 1366, 'split', '12.9" portrait'],
  [1366, 1024, 'split', '12.9" landscape'],
]) {
  const m = await at(w, h);
  const tierOk = m.tier === want;
  const railOk = want ? m.rail === 'rail' : m.rail === 'bar';
  check(`${label}: tier + chrome`, tierOk && railOk && !m.overflowDoc && !m.overflowDev,
    `tier=${m.tier || 'phone'} chrome=${m.rail} overflow=${m.overflowDoc || m.overflowDev}`);
}

// ---- 2. Rotation, both ways, on a master route.
await at(1024, 1366); const rotP = await page.evaluate(probe);
const rotL = await at(1366, 1024);
const rotBack = await at(1024, 1366);
check('Rotation portrait -> landscape -> portrait keeps the route and the split',
  rotP.split && rotL.split && rotBack.split && rotBack.hash === '#coach-roster',
  `portrait=${rotP.split} landscape=${rotL.split} back=${rotBack.split} hash=${rotBack.hash}`);

// ---- 3. A Split View divider dragged live, while a DETAIL is open. The detail must survive the
// collapse to one column and the route must not change.
await go('#coach-roster');
await page.evaluate(() => { const r = document.querySelector('.pane-master [data-go^="coach-athlete/"], [data-go^="coach-athlete/"]'); if (r) r.click(); });
await page.waitForTimeout(900);
const opened = await page.evaluate(probe);
check('Tapping a roster row opens the athlete BESIDE the roster, and the row is marked',
  opened.split && opened.hash.startsWith('#coach-athlete/') && opened.current === opened.hash.slice(1),
  `split=${opened.split} hash=${opened.hash} marked=${opened.current}`);

const narrowed = await at(600, 1024);
check('Dragging the divider narrow collapses to one column WITHOUT losing the athlete',
  !narrowed.split && narrowed.tier === null && narrowed.hash === opened.hash,
  `tier=${narrowed.tier || 'phone'} split=${narrowed.split} hash=${narrowed.hash}`);
const widened = await at(1180, 820);
check('Dragging it back restores the split on the same athlete',
  widened.split && widened.hash === opened.hash && widened.current === opened.hash.slice(1),
  `split=${widened.split} hash=${widened.hash} marked=${widened.current}`);

// ---- 4. Back from a detail returns to the list, which in split shows its prompt.
await page.evaluate(() => { const b = document.querySelector('.pane-detail [data-back], [data-back]'); if (b) b.click(); });
await page.waitForTimeout(900);
const backed = await page.evaluate(probe);
check('Back from the athlete lands on the roster with the choose-an-athlete prompt',
  backed.hash === '#coach-roster' && backed.split === false || backed.hash === '#coach-roster',
  `hash=${backed.hash}`);
const prompt = await page.evaluate(() => !!document.querySelector('.pane-empty'));
check('The roster alone shows the prompt in the detail pane', prompt, `pane-empty=${prompt}`);

// ---- 5. The keyboard rule: the rail must NOT slide away, because nothing is under it.
await at(1180, 820);
const kb = await page.evaluate(() => {
  document.body.classList.add('kb-open');
  const t = getComputedStyle(document.querySelector('.tabbar')).transform;
  document.body.classList.remove('kb-open');
  return t;
});
check('With the keyboard up the rail stays put', kb === 'none' || kb === 'matrix(1, 0, 0, 1, 0, 0)', `transform=${kb}`);

// ---- 6. The two panes scroll independently.
await go('#coach-roster');
await page.evaluate(() => { const r = document.querySelector('[data-go^="coach-athlete/"]'); if (r) r.click(); });
await page.waitForTimeout(900);
// .viewport sets `scroll-behavior: smooth`, so assigning scrollTop starts an ANIMATION and reading
// it back in the same tick returns the old value. Both zeros here once read as a bug and were not.
// scrollTo with behavior:'instant' overrides it, the same idiom router.js uses to restore a scroll.
const scrolled = await page.evaluate(() => {
  const m = document.getElementById('viewport-master');
  const d = document.getElementById('viewport');
  const can = m ? m.scrollHeight > m.clientHeight + 1 : false;
  if (m) m.scrollTo({ top: 240, behavior: 'instant' });
  return { can, master: m ? m.scrollTop : null, detail: d ? d.scrollTop : null };
});
check('The roster scrolls on its own and does not drag the athlete with it',
  scrolled.can && scrolled.master > 0 && scrolled.detail === 0,
  `scrollable=${scrolled.can} master=${scrolled.master} detail=${scrolled.detail}`);
// And a repaint must put the roster back where it was, not at the top.
const kept = await page.evaluate(async () => {
  if (window.__render) window.__render();
  await new Promise((r) => setTimeout(r, 400));
  const m = document.getElementById('viewport-master');
  return m ? m.scrollTop : null;
});
check('A repaint keeps the roster where it was scrolled to', kept > 0, `master=${kept}`);

// ---- 7. The phone is untouched: a narrow viewport still gets the floating capsule and no rail.
const phone = await at(402, 872);
check('At phone width nothing from the iPad layer applies',
  phone.tier === null && phone.rail === 'bar' && !phone.split && !phone.overflowDoc,
  `tier=${phone.tier || 'phone'} chrome=${phone.rail}`);

// ---- 8. Nothing threw the whole way through.
check('No page errors during the whole pass', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nipad-qa: ${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join('; ')); process.exit(1); }
console.log('Still owed on a REAL iPad: the software keyboard, Stage Manager, rotation animation,');
console.log('device safe-area insets, and every native surface (alarm, Live Activity, HealthKit, camera, push).');
