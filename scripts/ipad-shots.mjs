// Headless iPad render of the proto: four viewports, both themes, the shell's structural promises
// asserted, PNGs for the eye. Opt-in (`npm run shots:ipad`), NOT a verify gate: the cloud founder
// sessions have no browser, and a gate that cannot run must never read as one that passed.
//
// What it proves per page:
//   1. nothing scrolls sideways (document and #device),
//   2. at 700px+ the tab bar is the rail (absolute, --rail-w wide),
//   3. at 1000px+ a master route renders .screen.split with both panes,
//   4. below 700px (Slide Over) the phone layout is untouched: no rail, no split.
//
// playwright-core is borrowed from the sibling Formation IQ checkout, the way the headless recipe
// in memory does; the browsers live in %LOCALAPPDATA%\ms-playwright and are shared. If it cannot
// be required this exits 2 and says how to get it. Serves proto/ from disk on a free port.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROTO = join(ROOT, 'proto', 'redesign-2026-07');
const OUT = join(ROOT, '.tmp', 'ipad-shots');
const SIBLING = 'c:/Users/Administrator/Downloads/Formation IQ/app/package.json';

let chromium;
try {
  const req = createRequire(existsSync(SIBLING) ? SIBLING : join(ROOT, 'package.json'));
  ({ chromium } = req('playwright-core'));
} catch (e) {
  console.error(`ipad-shots: playwright-core is not available (${e.message}).`);
  console.error('  It is read from the sibling Formation IQ checkout; or `npm i -D playwright-core` here and');
  console.error('  `npx playwright install chromium`.');
  process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(PROTO, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html?layout=auto`;

// [width, height, label]. 820x1180 is the iPad Air / 11" portrait; 1180x820 its landscape;
// 1024x1366 the 12.9" portrait; 375x1024 a Slide Over strip (must stay the phone).
const VIEWPORTS = [[820, 1180, 'air-portrait'], [1180, 820, 'air-landscape'], [1024, 1366, 'pro-portrait'], [375, 1024, 'slide-over']];
const THEMES = ['dark', 'light'];

// The screens. `seed` pages run after a coach session is faked in-page (module mutation: the boot
// gate wipes a persisted fake, so the runtime is mutated live and the hash navigated, no reload).
const PAGES = [
  { hash: '#welcome', seed: false, name: 'welcome' },
  { hash: '#coach-home', seed: true, name: 'coach-home' },
  { hash: '#coach-roster', seed: true, name: 'coach-roster', master: true },
  { hash: '#coach-athlete/a1', seed: true, name: 'coach-athlete', detail: true },
  { hash: '#coach-inbox', seed: true, name: 'coach-inbox', master: true },
  { hash: '#log', seed: false, name: 'log-sheet', athlete: true },
  // The roll call's team board (2026-09-23): the athlete's board and Your day, and the coach's
  // board, in the iPad column. `board` seeds the team board through the harness seam.
  { hash: '#rollcall-board/rb-ipad', seed: false, name: 'rollcall-board', athlete: true, board: true },
  { hash: '#rollcall-board/rb-ipad/day', seed: false, name: 'rollcall-day', athlete: true, board: true },
  { hash: '#rollcall-board/rb-ipad', seed: true, name: 'rollcall-board-coach', board: true },
];

const SEED_COACH = `(async () => {
  const st = await import('./js/state.js');
  st.RT.userId = 'ipad-shots'; st.RT.authRole = 'coach';
  st.RT.profile = Object.assign({}, st.RT.profile || {}, { name: 'Coach Reyes', handle: 'Coach Reyes', role: 'coach' });
  const sb = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (res) => res({ data: [], error: null }) : (k === 'auth' ? { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) } : sb)), apply: () => sb });
  window.sb = sb;
  const cd = await import('./js/coach-data.js');
  const roles = await import('./js/roles.js');
  // Rows through the real projector (roles.buildRosterRow) so the status engine reads a true shape.
  const hist = (n) => [7, 6, 5, 4, 3, 2, 1].map((d) => ({ date: new Date(Date.now() - d * 864e5).toISOString().slice(0, 10), score: Math.max(0, n - d * 3) }));
  const rows = [
    roles.buildRosterRow({ athlete_id: 'a1', athlete_name: 'Marcus Hill', position: 'LB' }, { score: 88, tasks: [{ done: true }, { done: true }, { done: false }] }, { scoreHistory: hist(88) }),
    roles.buildRosterRow({ athlete_id: 'a2', athlete_name: 'Devin Carter', position: 'LB' }, { score: 64, tasks: [{ done: true }, { done: false }, { done: false }] }, { scoreHistory: hist(64) }),
    roles.buildRosterRow({ athlete_id: 'a3', athlete_name: 'Jalen Brooks', position: 'LB' }, null, { scoreHistory: [] }),
    roles.buildRosterRow({ athlete_id: 'a4', athlete_name: 'Tyrese Adams', position: 'LB' }, { score: 91, tasks: [{ done: true }, { done: true }, { done: true }] }, { scoreHistory: hist(91) }),
  ];
  const book = [{ id: 't1', name: 'UCF Linebackers', code: 'YQRB9Q' }];
  // ROSTER / EXTRAS are module-private behind CD's getters; the loader is what sets them. A fake
  // client that answers every query empty lets loadCoachRoster settle, then the rows are swapped in
  // through the one seam that exists for tests: CD.roster's own object, mutated in place.
  try { await cd.loadCoachRoster(true); } catch { /* the fake client is enough */ }
  if (cd.CD.roster) { cd.CD.roster.book = book; cd.CD.roster.teams = book; cd.CD.roster.rows = rows; cd.CD.roster.offline = false; cd.CD.roster.pending = []; }
  cd.CD.extras = Object.assign(cd.CD.extras || {}, { sets: [], exceptions: [], rooms: [] });
})()`;
const SEED_ATHLETE = `(async () => {
  const st = await import('./js/state.js');
  st.RT.userId = 'ipad-shots'; st.RT.authRole = 'athlete';
  st.RT.profile = Object.assign({}, st.RT.profile || {}, { name: 'Marcus Hill', role: 'athlete' });
})()`;

// Twelve teammates, the signed-in athlete 4th, one late, three not up, relative to the page clock.
const SEED_BOARD = `(async () => {
  const cd = await import('./js/commitment-data.js');
  const now = Date.now(); const T = (m) => new Date(now + m * 60000).toISOString();
  const P = [['r1','DeShawn Cole',-20],['r2','Andre Wells',-15],['r3','Jaylen Brooks',-12],['ipad-shots','Marcus Reed',-11],
    ['r5','Kofi Owusu',-10],['r6','Luis Soto',-9],['r7','Ben Price',-8],['r8','Chris James',-7],['r9','Tyrek Malone',-4,'late'],
    ['r10','Tommy Vargas',null],['r11','Ray Gomez',null],['r12','Eli Walker',null]];
  let place = 0;
  const rows = P.map(([id, name, m, v]) => ({ athlete_id: id, name, avatar_path: null, acknowledged_at: m == null ? null : T(m),
    verdict: m == null ? 'pending' : (v || 'on_standard'), arrival_verdict: null, place: m == null ? null : ++place }));
  cd.seedTeamBoardForHarness('rb-ipad', { instance_id: 'rb-ipad', title: 'Morning Roll Call', coach_name: 'Coach Brooks', mode: 'wake',
    starts_at: T(-12), respond_by_at: T(-7), closes_at: T(18), asks_arrival: false, rows });
  cd.seedMineForHarness([{ instance_id: 'rb-ipad', type: 'morning_roll_call', title: 'Morning Roll Call',
    message: 'Up and at it. Lift at 7, be early. Protein at breakfast.', action_label: 'I’m Up', coach_name: 'Coach Brooks',
    occurs_on: new Date().toISOString().slice(0, 10), starts_at: T(-12), respond_by_at: T(-7), closes_at: T(18),
    status: 'acknowledged', acknowledged_at: T(-11), verdict: 'on_standard', instance_status: 'scheduled' }]);
})()`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const rows = [];
let failed = 0;
for (const [width, height, label] of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.goto(`${base}#welcome`);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* fine */ } });
    await page.goto(`${base}#welcome`);
    await page.waitForSelector('#view');
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    let seeded = null;
    for (const pg of PAGES) {
      const want = pg.seed ? 'coach' : (pg.athlete ? 'athlete' : null);
      if (want && seeded !== want) { await page.evaluate(want === 'coach' ? SEED_COACH : SEED_ATHLETE); seeded = want; }
      if (pg.board) await page.evaluate(SEED_BOARD);
      await page.evaluate((h) => { location.hash = h; }, pg.hash);
      await page.waitForTimeout(900);
      try { await page.evaluate(() => document.fonts.ready); } catch { /* fine */ }
      const m = await page.evaluate(() => {
        const dev = document.getElementById('device');
        const bar = document.querySelector('.tabbar');
        const cs = bar ? getComputedStyle(bar) : null;
        return {
          tier: document.documentElement.getAttribute('data-layout'),
          docOverflow: document.documentElement.scrollWidth > window.innerWidth,
          devOverflow: dev ? dev.scrollWidth > dev.clientWidth + 1 : false,
          rail: !!(cs && cs.position === 'absolute' && Math.round(parseFloat(cs.width)) === 88 && Math.round(parseFloat(cs.height)) > 300),
          split: !!document.querySelector('.screen.split .pane-master') && !!document.querySelector('.screen.split .pane-detail'),
          viewW: (() => { const v = document.getElementById('view'); return v ? Math.round(v.getBoundingClientRect().width) : 0; })(),
          route: location.hash,
        };
      });
      const wide = width >= 700, split = width >= 1000;
      const problems = [];
      if (m.docOverflow) problems.push('document scrolls sideways');
      if (m.devOverflow) problems.push('#device scrolls sideways');
      const hasBar = await page.evaluate(() => !!document.querySelector('.tabbar'));
      if (wide && hasBar && !m.rail) problems.push('no rail at a wide width');
      if (!wide && m.rail) problems.push('rail on a narrow width');
      if (!wide && m.tier) problems.push(`tier ${m.tier} on a narrow width`);
      if (split && (pg.master || pg.detail) && !m.split) problems.push('no split panes on a master/detail route');
      if (!split && m.split) problems.push('split panes below 1000px');
      if (errors.length) problems.push(`page errors: ${errors.splice(0).join(' | ')}`);
      const file = `${width}x${height}-${theme}-${pg.name}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: false });
      if (problems.length) failed++;
      rows.push({ viewport: label, theme, page: pg.name, tier: m.tier || 'phone', view: m.viewW, split: m.split ? 'yes' : '', ok: problems.length ? problems.join('; ') : 'ok' });
    }
    await ctx.close();
  }
}
await browser.close();
server.close();
console.table(rows);
console.log(`ipad-shots: ${rows.length} renders, ${failed} with problems. PNGs in ${OUT}`);
process.exit(failed ? 1 : 0);
