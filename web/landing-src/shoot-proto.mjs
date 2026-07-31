// Regenerate the landing-site product screenshot set from the CURRENT proto.
//
//   node scripts/serve-proto.mjs 8799     # in one shell
//   node web/landing-src/shoot-proto.mjs  # in another
//
// Output: web/landing/assets/product/<name>.webp at 3x (1170x2532), webp q88.
// Every screen is rendered by the real app from seeded EVIDENCE — see lib/seeds.mjs and
// lib/sb-stub.mjs. No number in these images is painted by this script.
import { launch, goto, evalJs, seedOnNewDocument, screenshot, sleep } from './lib/cdp.mjs';
import { SEEDS } from './lib/seeds.mjs';
import { sbStubSource, ROSTER_ATHLETES, BOOK_CLIENTS } from './lib/sb-stub.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'http://localhost:8799/index.html';
const TODAY = '2026-07-30';
const OUT = join(process.cwd(), 'web', 'landing', 'assets', 'product');

// One frozen clock for the whole set: 8:10 PM on the seeded day. Without it the greeting, the
// countdowns and the "now" ladder drift with wall-clock time and the set stops being reproducible.
const clockAt = (h, m) => `(() => { const FAKE = new Date(2026,6,30,${h},${m},0).getTime(); const R = Date;
  const D = function(...a){ return a.length ? new R(...a) : new R(FAKE); };
  D.now = () => FAKE; D.parse = R.parse; D.UTC = R.UTC; D.prototype = R.prototype;
  Object.setPrototypeOf(D, R); globalThis.Date = D; })();`;

const theme = (t) => `(async () => { const st = await import('/js/state.js');
  st.RT.theme = '${t}'; st.applyTheme(); window.__render(); return 1; })()`;

/**
 * SHOTS — every image the rewritten site will consume.
 * `at` freezes the clock so the screen is internally consistent with its seed.
 */
const SHOTS = [
  // ---------- the athlete's daily loop, in order (index.html + athletes.html) ----------
  { name: 'loop-1-home-morning', seed: 'dayMorning', route: 'home', at: [7, 52],
    use: 'Step 1 — open the app; breakfast is the one thing to do next' },
  { name: 'loop-2-camera', seed: 'dayMorning', route: 'camera/lunch', at: [12, 40],
    use: 'Step 2 — point the camera at the plate' },
  { name: 'loop-3-meal-read', seed: 'dayMidday', route: 'meal-detail/lunch', at: [13, 8],
    use: 'Step 3 — the AI read: foods, macros, quality, timing' },
  { name: 'loop-4-home-midday', seed: 'dayMidday', route: 'home', at: [13, 10],
    use: 'Step 4 — the score moved; dinner still open' },
  { name: 'loop-5-checkin', seed: 'dayMidday', route: 'recovery', at: [21, 30],
    use: 'Step 5 — the nightly recovery check-in' },
  { name: 'loop-6-commitment', seed: 'dayMidday', route: 'commitment', at: [21, 40],
    use: 'Step 6 — close the day honestly' },
  { name: 'loop-7-home-complete', seed: 'dayComplete', route: 'home', at: [21, 50],
    use: 'Step 7 — the day lands; streak locks at midnight' },
  { name: 'loop-8-breakdown', seed: 'dayComplete', route: 'score-breakdown', at: [21, 52],
    use: 'Step 8 — why the score is what it is' },

  // ---------- honest states the skeptic asks about ----------
  { name: 'state-late-dinner', seed: 'dayLate', route: 'home', at: [22, 5],
    use: 'What happens if you are late — "still counts, log it late"' },
  { name: 'state-first-day', seed: 'dayFirst', route: 'home', at: [15, 20],
    use: 'Day one — "Not scored yet", closed windows read "Not required"' },
  { name: 'state-progress', seed: 'dayComplete', route: 'progress', at: [21, 55],
    use: 'Weekly averages, streak, trend — never a daily verdict' },
  { name: 'state-plan', seed: 'dayComplete', route: 'plan', at: [21, 56],
    use: 'The standard the athlete is held to' },
  { name: 'state-privacy', seed: 'dayComplete', route: 'privacy', at: [21, 57],
    use: 'Who sees what, shown in-app' },
  { name: 'state-connect', seed: 'dayComplete', route: 'connect', at: [21, 58],
    use: 'Joining a coach: confirm what they will see, before anything is shared' },
  { name: 'state-trust-pass', seed: 'dayComplete', route: 'trust', at: [21, 59],
    use: 'Trust Pass — earned with 7 photo-proven days' },
  { name: 'state-training-log', seed: 'dayComplete', route: 'log-training', at: [20, 5],
    use: 'Training log — tracked, not scored' },

  // ---------- plan styles: the same complete day, measured three ways ----------
  { name: 'style-structured', seed: 'styleStructured', route: 'plan', at: [21, 40],
    use: 'Structured — exact targets' },
  { name: 'style-guided', seed: 'styleGuided', route: 'plan', at: [21, 40],
    use: 'Guided — flexible ranges + meal quality' },
  { name: 'style-intuitive', seed: 'styleIntuitive', route: 'plan', at: [21, 40],
    use: 'Intuitive — no calorie or macro surface at all' },

  // ---------- operator: coach ----------
  { name: 'coach-1-home', seed: 'coachIdentity', route: 'coach-home', at: [20, 10], book: 'team',
    use: 'The coach opens the app: group score, who needs attention' },
  { name: 'coach-2-roster', seed: 'coachIdentity', route: 'coach-roster', at: [20, 10], book: 'team',
    use: 'The whole roster with live scores and honest flags' },
  { name: 'coach-3-inbox', seed: 'coachIdentity', route: 'coach-inbox', at: [20, 10], book: 'team',
    use: 'The daily briefing, computed from the real roster' },
  { name: 'coach-4-insights', seed: 'coachIdentity', route: 'coach-insights', at: [20, 10], book: 'team',
    use: 'Insights — silence over noise; no data means no sentence' },
  { name: 'coach-5-create', seed: 'coachIdentity', route: 'coach-create', at: [20, 10], book: 'team',
    use: 'Put something in motion: assign, announce, message, schedule' },
  { name: 'coach-6-announce', seed: 'coachIdentity', route: 'coach-announce', at: [20, 10], book: 'team',
    use: 'One broadcast, fanned out server-side to every active athlete' },
  { name: 'coach-7-commitments', seed: 'coachIdentity', route: 'coach-commitments', at: [6, 5], book: 'team',
    use: 'Verified Commitments — the coach board: who is up, who is excused, who could not be verified' },

  // ---------- Verified Commitments, athlete side ----------
  { name: 'vc-1-rollcall', seed: 'dayMorning', route: 'home', at: [5, 5], vc: 'open',
    use: 'The athlete sees the coach\'s own title and one button — never the word "commitment"' },
  { name: 'vc-2-accountability', seed: 'dayComplete', route: 'accountability', at: [20, 20], vc: 'earned',
    use: 'Accountability — its own number, weighted ack 10 / arrive 30 / complete 60' },
  { name: 'vc-3-record', seed: 'dayComplete', route: 'verified-discipline', at: [20, 22], vc: 'earned',
    use: 'The record an athlete can choose to show' },

  // ---------- operator: trainer ----------
  { name: 'trainer-1-book', seed: 'trainerIdentity', route: 'coach-roster', at: [7, 30], book: 'practice',
    use: 'The whole book before the first session' },
  { name: 'trainer-2-home', seed: 'trainerIdentity', route: 'coach-home', at: [7, 30], book: 'practice',
    use: 'Who executed, who slipped, who needs a word today' },
  { name: 'trainer-3-grow', seed: 'trainerIdentity', route: 'trainer-grow', at: [7, 30], book: 'practice',
    use: 'Public page, offers and applications — OnStandard Pay' },

  // ---------- parent ----------
  { name: 'parent-1-dashboard', seed: 'parentIdentity', route: 'parent', at: [19, 15], book: 'team',
    use: 'Score, grade, latest day — never photos, weight, or check-ins' },
  { name: 'parent-2-fund', seed: 'parentIdentity', route: 'fund-plan', at: [19, 16], book: 'team',
    use: 'Fund a plan — parent pays the trainer package for their child' },

  // ---------- the meal thread: the flagship section (index.html #thread) ----------
  { name: 'thread-athlete', seed: 'dayMidday', route: 'meal-thread/lunch', at: [13, 30], scroll: '#meal-thread', vh: 1050,
    use: 'Flagship — athlete side: AI read, coach reply, correction, UPDATED ANALYSIS, facepile' },
  { name: 'thread-coach', seed: 'coachIdentity', route: 'coach-meal/meal-1', at: [13, 30], book: 'team', scroll: '.thread',
    use: 'Flagship — the coach side of a live conversation' },
  { name: 'thread-season', seed: 'dayMidday', route: 'nutrition-chat', at: [20, 15],
    use: 'The season-long merged stream: every meal, every reply, one conversation' },
  { name: 'thread-analysis', seed: 'dayMidday', route: 'meal-detail/lunch', at: [13, 8],
    use: 'The AI read: quality band, rubric, per-food confidence, correction chips' },
];

// A screen that waits on data the fixtures don't serve can hang forever; one bad shot must not
// cost the whole run. `node shoot-proto.mjs style-,coach-7` re-shoots only matching names.
const withTimeout = (p, ms, what) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms: ${what}`)), ms)),
]);
const FILTER = (process.argv[2] || '').split(',').map((x) => x.trim()).filter(Boolean);
const TARGETS = FILTER.length ? SHOTS.filter((s) => FILTER.some((f) => s.name.includes(f))) : SHOTS;

// Default 3x matches the original set. The flagship thread shots ship at 2x (SHOT_SCALE=2):
// they render in a ~250px-wide phone frame, so 2x is visually identical while cutting decode
// area ~55% — at 3x the two thread images alone dragged Lighthouse mobile perf from 94 to 63,
// because Chrome prefetches lazy images that sit within its viewport-distance threshold.
const SCALE = Number(process.env.SHOT_SCALE) || 3;
const b = await launch({ port: 9340, scale: SCALE });
const made = [];
try {
  await mkdir(OUT, { recursive: true });
  for (const s of TARGETS) {
    // Almost every shot is one real device screen (390x844). The flagship meal-thread shot is the
    // one deliberate exception: it has to hold a full 3-way exchange (AI read, coach reply,
    // athlete correction, updated AI analysis) plus the facepile in a single frame, and that run
    // of messages is taller than one screen — so it gets a taller capture canvas instead of being
    // cropped mid-conversation. Nothing on the site references this asset's exact pixel size yet.
    const page = await b.newPage({ width: 390, height: s.vh || 844 });
    const [h, m] = s.at || [20, 10];
    await seedOnNewDocument(page, clockAt(h, m));
    // The first-run spotlight tour (2026-07-30) fires for any account that has never dismissed it
    // — which every fresh RT in this harness is. Marketing screenshots are meant to look like a
    // real, settled user's app, not someone's first ten seconds in it, so every role's tour is
    // pre-marked seen before the app boots. Written straight into the RT blob state.js's load()
    // reads on startup, so it is in place before the app's own script runs.
    await seedOnNewDocument(page, `localStorage.setItem('onstd-proto-rt-v1', JSON.stringify({
      tourSeen: { 'tour:athlete': '2026-01-01T00:00:00.000Z', 'tour:coach': '2026-01-01T00:00:00.000Z',
        'tour:trainer': '2026-01-01T00:00:00.000Z', 'tour:parent': '2026-01-01T00:00:00.000Z' },
    }));`);
    if (s.vc) await seedOnNewDocument(page, `window.__VC_MODE = ${JSON.stringify(s.vc)};`);
    await seedOnNewDocument(page, sbStubSource({
      todayISO: TODAY,
      athletes: s.book === 'practice' ? BOOK_CLIENTS : ROSTER_ATHLETES,
    }));
    try {
      await withTimeout((async () => {
        await goto(page, BASE, { settleMs: 1200 });
        await evalJs(page, `(async () => { ${SEEDS[s.seed]} return 1; })()`);
        await evalJs(page, theme(s.theme || 'dark'));
        await evalJs(page, `(() => { location.hash = '#${s.route}'; return 1; })()`);
        // Operator screens fetch through the stub before they can paint real rows.
        await sleep(s.route.startsWith('coach') || s.route === 'parent' ? 2600 : 1300);
        await evalJs(page, s.scroll
          ? `(() => { const el = document.querySelector(${JSON.stringify(s.scroll)}); if (el) el.scrollIntoView({block:'start'}); return 1; })()`
          : `(() => { window.scrollTo(0,0); return 1; })()`);
        await sleep(250);
      })(), 45000, s.name);

      const txt = await evalJs(page, `(document.body.innerText||'').replace(/\\s+/g,' ').trim()`);
      const thin = txt.length < 120 || /Loading…|Failed to fetch|couldn't load/i.test(txt);
      const buf = await screenshot(page, { format: 'webp' });
      await writeFile(join(OUT, s.name + '.webp'), buf);
      made.push({ name: s.name, kb: Math.round(buf.length / 1024), thin, use: s.use, head: txt.slice(0, 90) });
      console.log(`${thin ? 'THIN ' : 'ok   '} ${s.name.padEnd(24)} ${String(Math.round(buf.length / 1024)).padStart(4)}kb  ${txt.slice(0, 70)}`);
    } catch (e) {
      console.log(`FAIL  ${s.name.padEnd(24)} ${String(e.message).slice(0, 80)}`);
      made.push({ name: s.name, failed: String(e.message) });
    }
    await b.send('Target.closeTarget', { targetId: page.targetId });
  }
} finally {
  await b.close();
}

await writeFile(join(process.cwd(), 'web', 'landing-src', 'shot-manifest.json'), JSON.stringify(made, null, 2));
const bad = made.filter((m) => m.failed || m.thin);
console.log(`\n${made.length} shots · ${bad.length} need attention`);
if (bad.length) console.log(bad.map((x) => ' - ' + x.name + (x.failed ? ` FAILED: ${x.failed}` : ' THIN')).join('\n'));
