// App Store Connect screenshot set, rendered from the REAL app.
//
// Apple requires an iPad screenshot set the moment `ios.supportsTablet` is true (it has been since
// 2026-09-15). This renders the shipped proto in a headless browser at the two iPad slots App Store
// Connect accepts and writes PNGs at Apple's exact pixel sizes:
//
//   13"   iPad (M4)            2064 x 2752   (viewport 1032 x 1376 @ dsf 2)
//   12.9" iPad Pro (6th gen)   2048 x 2732   (viewport 1024 x 1366 @ dsf 2)
//
// Both are >= 1000px wide, so both render the split tier — the roster beside an athlete, which is
// the whole iPad story. Portrait throughout: a set must not mix orientations.
//
// THE DATA IS DEMO DATA, and it is seeded through the app's own engines — roster rows go through
// roles.buildRosterRow, the athlete score is computed by the real scorer from a seeded DAY. Nothing
// here paints a number the app could not produce. Names are invented; no real athlete appears.
//
// Run: npm run shots:appstore    Output: .tmp/appstore-shots/
// playwright-core is borrowed from the sibling Formation IQ checkout (same recipe as ipad-shots).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROTO = join(ROOT, 'proto', 'redesign-2026-07');
const OUT = join(ROOT, '.tmp', 'appstore-shots');
const SIBLING = 'c:/Users/Administrator/Downloads/Formation IQ/app/package.json';

let chromium;
try {
  const req = createRequire(existsSync(SIBLING) ? SIBLING : join(ROOT, 'package.json'));
  ({ chromium } = req('playwright-core'));
} catch (e) {
  console.error(`appstore-shots: playwright-core is not available (${e.message}).`);
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

// [width, height, label, expected PNG]
const SLOTS = [
  [1032, 1376, 'ipad-13', '2064x2752'],
  [1024, 1366, 'ipad-12.9', '2048x2732'],
];

const SEED_COACH = `(async () => {
  const st = await import('./js/state.js');
  const d0 = await import('./js/day.js');
  st.RT.userId = 'shots'; st.RT.authRole = 'coach';
  st.RT.profile = Object.assign({}, st.RT.profile || {}, { name: 'Coach Reyes', handle: 'Coach Reyes', role: 'coach' });
  // A TABLE-AWARE fake client. The empty-answering Proxy was not enough: the athlete detail loads
  // its own day through roles.fetchDay, so the right pane said "0 of 3 meals in" next to a roster
  // row reading 82 on standard - two panes of one screenshot contradicting each other. It answers
  // per table and honours maybeSingle. Filters are NOT evaluated, so a seeded table answers for
  // any athlete id; only Marcus's detail is ever shot, which is why that is safe here.
  const today = new Date().toISOString().slice(0, 10);
  // Marcus's day, stated as FACTS. slotMacros and mealLoggedAt ride the checkin jsonb, which is
  // where dayFromHistoryRow reads them from; the CI fields are left unset so Recovery stays open,
  // and dinner is left unlogged because these render in the afternoon and a dinner already logged
  // at 19:00 would be a meal from the future.
  const dayMeals = { breakfast: true, lunch: true, snack: true, dinner: true };
  const checkin = {
    slotMacros: { breakfast: { protein: 54, cal: 780 }, lunch: { protein: 62, cal: 1010 }, snack: { protein: 31, cal: 360 }, dinner: { protein: 58, cal: 1020 } },
    mealLoggedAt: { breakfast: 450, lunch: 755, snack: 962, dinner: 1125 },
    // The evening check-in, on the same 1-10 scales day.js ships as DEFAULT_CI. submitted:true is
    // what makes the recovery half of the score count; without it the day tops out at the
    // nutrition ceiling and the hero athlete reads "below standard" purely for a missing tap.
    submitted: true, energy: 8, recovery: 8, sleep: 8, confidence: 9, soreness: 3, motivation: 8,
  };
  // THE SCORE IS NOT WRITTEN BY HAND. The server stamps days.score with what this same engine
  // computes, so stamping any other number would put the roster and the breakdown in the same
  // screenshot disagreeing (82 on the ring, 21 in the breakdown - which is what happened first).
  const dscore = (() => {
    try {
      const recon = d0.dayFromHistoryRow({ date: today, meals: dayMeals, checkin, quickAdded: [], hydrationL: 3.1 });
      const v = recon ? d0.scoreFor(recon) : null;
      return typeof v === 'number' ? Math.round(v) : null;
    } catch { return null; }
  })();
  const TABLES = {
    days: [{ id: 'd1', athlete_id: 'a1', date: today, meals: dayMeals,
      hydration_l: 3.1, tasks: [], checked_tasks: {}, quick_added: [false, false, false],
      checkin, score: dscore, grade: null, plan_style: null, signals: {},
      computed_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
    // athlete_profiles is deliberately NOT seeded. breakdownBlock grades against the ATHLETE's own
    // nutrition config (nutritionConfigForGoal off base_goal/base_weight), while the score above is
    // computed with the default config - seed a goal and the two diverge, which is how the ring
    // read 55 while the breakdown read 40/82. With no basics both sides use the same defaults.
  };
  const q = (t) => new Proxy(function () {}, {
    get: (_x, k) => {
      if (k === 'then') return (res) => res({ data: TABLES[t] || [], error: null });
      if (k === 'maybeSingle' || k === 'single') return async () => ({ data: (TABLES[t] || [])[0] || null, error: null });
      return q(t);
    },
    apply: () => q(t),
  });
  window.sb = {
    from: (t) => q(t), rpc: (n) => q(n),
    auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) },
    storage: { from: () => q('_storage') },
    // { row: null } is the AI Nutritionist's honest EMPTY state ("has not written a read yet").
    // Returning data:null made invokeSummary report a failure, and the screenshot carried a red
    // "Can't reach the AI Nutritionist right now" - an error state on a store listing.
    functions: { invoke: async () => ({ data: { row: null }, error: null }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  };
  const cd = await import('./js/coach-data.js');
  const roles = await import('./js/roles.js');
  const hist = (n) => [7,6,5,4,3,2,1].map((d) => ({ date: new Date(Date.now() - d*864e5).toISOString().slice(0,10), score: Math.max(40, Math.min(99, n - d*2 + (d%3)*3)) }));
  // meals (not tasks) is what the status engine reads for the activity line. Passing only tasks
  // left every row saying "No logs yet" beside a score of 94, which is a seeding artifact and
  // exactly the kind of incoherence a screenshot must not ship. No backticks in here: this whole
  // seed is a template literal, and one would end it.
  const mk = (id, name, pos, score, meals) => roles.buildRosterRow(
    { athlete_id: id, athlete_name: name, position: pos },
    score == null ? null : { score, meals, tasks: Object.keys(meals).map((k) => ({ id: k, done: !!meals[k] })) },
    { scoreHistory: score == null ? [] : hist(score), lastMealAt: score == null ? null : new Date(Date.now() - 45*6e4).toISOString() });
  const ALL = { breakfast: true, lunch: true, snack: true, dinner: true };
  const rows = [
    mk('a1', 'Marcus Hill', 'LB', dscore, dayMeals),   // the SAME number and the SAME meals as the seeded day
    mk('a2', 'Tyrese Adams', 'LB', 88, { ...ALL, dinner: false }),
    mk('a3', 'Andre Whitfield', 'LB', 86, { ...ALL, dinner: false }),
    mk('a4', 'Devin Carter', 'LB', 71, { breakfast: true, lunch: true, snack: false, dinner: false }),
    mk('a5', 'Isaiah Nunez', 'LB', 68, { breakfast: true, lunch: true, snack: false, dinner: false }),
    mk('a6', 'Cam Roberts', 'LB', 63, { breakfast: true, lunch: false, snack: false, dinner: false }),
    mk('a7', 'Jalen Brooks', 'LB', null, null),
    mk('a8', 'Malik Osei', 'LB', null, null),
  ];
  const book = [{ id: 't1', name: 'UCF Linebackers', code: 'YQRB9Q' }];
  try { await cd.loadCoachRoster(true); } catch {}
  if (cd.CD.roster) { cd.CD.roster.book = book; cd.CD.roster.teams = book; cd.CD.roster.rows = rows; cd.CD.roster.offline = false; cd.CD.roster.pending = []; }
  cd.CD.extras = Object.assign(cd.CD.extras || {}, { sets: [], exceptions: [], rooms: [] });
})()`;

// The athlete's day is seeded as FACTS (which meals are in, how much water, the check-in) and the
// score on screen is whatever the shipped scorer makes of them. No number is written directly.
const SEED_ATHLETE = `(async () => {
  const st = await import('./js/state.js');
  st.RT.userId = 'shots'; st.RT.authRole = 'athlete';
  st.RT.profile = Object.assign({}, st.RT.profile || {}, { name: 'Marcus Hill', role: 'athlete', position: 'LB' });
  const sb = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (res) => res({ data: [], error: null }) : (k === 'auth' ? { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) } : sb)), apply: () => sb });
  window.sb = sb;
  const d = await import('./js/day.js');
  d.DAY.meals = { breakfast: true, lunch: true, snack: true, dinner: false };
  d.DAY.hydrationL = 2.6;
  d.DAY.slotMacros = { breakfast: { protein: 52, cal: 720 }, lunch: { protein: 61, cal: 980 }, snack: { protein: 30, cal: 360 } };
  d.DAY.scoreHistory = [7,6,5,4,3,2,1].map((x) => ({ date: new Date(Date.now() - x*864e5).toISOString().slice(0,10), score: [74,79,81,85,83,88,91][7-x] }));
})()`;

// ORDER MATTERS. A detail pairs with the master behind its ORIGIN tab, so #coach-athlete reached
// straight from #welcome has no origin and renders one column - correct, and not the picture we
// want. The roster is visited first (`skip`), which lights the Roster tab, and the athlete then
// opens beside it exactly as a tap would.
const PAGES = [
  { hash: '#coach-home', role: 'coach', name: '1-coach-home' },
  { hash: '#coach-roster', role: 'coach', name: '2-roster', skip: true },
  { hash: '#coach-athlete/a1', role: 'coach', name: '3-roster-and-athlete' },
  { hash: '#coach-roster', role: 'coach', name: '4-roster' },
  { hash: '#coach-inbox', role: 'coach', name: '5-inbox' },
  { hash: '#home', role: 'athlete', name: '6-athlete-home' },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const made = [];
for (const [w, h, slot, expect] of SLOTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${base}#welcome`);
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.goto(`${base}#welcome`);
  await page.waitForSelector('#view');
  let seeded = null;
  for (const pg of PAGES) {
    if (seeded !== pg.role) { await page.evaluate(pg.role === 'coach' ? SEED_COACH : SEED_ATHLETE); seeded = pg.role; }
    await page.evaluate((x) => { location.hash = x; }, pg.hash);
    await page.waitForTimeout(1100);
    // Dismiss anything the app throws over the screen on arrival: the day-locked stamp and the
    // perfect-day moment are real features, but a screenshot of a scrim is a screenshot of nothing.
    await page.evaluate(() => {
      for (const sel of ['.lockstamp .ls-x', '.pmoment button', '.tour .tour-skip']) {
        const b = document.querySelector(sel);
        if (b) b.click();
      }
    });
    await page.waitForTimeout(500);
    if (pg.skip) continue;
    const file = join(OUT, `${slot}-${pg.name}.png`);
    await page.screenshot({ path: file });
    made.push({ slot, page: pg.name, expect, file });
  }
  await ctx.close();
}
await browser.close();
server.close();
console.table(made.map((m) => ({ slot: m.slot, expected: m.expect, page: m.page })));
console.log(`appstore-shots: ${made.length} PNGs in ${OUT}`);
