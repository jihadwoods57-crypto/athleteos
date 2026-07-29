#!/usr/bin/env node
// QC capture + automated defect sweep for the shipped WebView app.
//
// Screenshots every meaningful screen across roles, themes and viewport widths, and — more
// importantly — runs a page-side audit on each one so regressions are found by machine instead
// of by squinting at a contact sheet. Built on the dependency-free CDP driver already in the
// repo (web/landing-src/lib/cdp.mjs), so it adds no npm dependency.
//
//   node scripts/serve-proto.mjs 8799        # in one shell
//   node scripts/qc-capture.mjs              # default set, dark, 390w
//   node scripts/qc-capture.mjs --all        # every route registered in js/screens/index.js
//   node scripts/qc-capture.mjs --themes dark,light --widths 320,390,430
//   node scripts/qc-capture.mjs --audit-only # no PNGs, just the defect report
//   node scripts/qc-capture.mjs --scroll-to '#meal-thread'   # frame a section below the fold
//   node scripts/qc-capture.mjs home,score   # only shots whose name matches
//
// Output: qc/<out>/<theme>-<width>/<name>.png, plus report.json and index.html (contact sheet).
//
// Every screen is rendered by the REAL app from seeded evidence + a stubbed Supabase — no
// production network calls, and no number in these images is painted by this script.
import { launch, goto, evalJs, seedOnNewDocument, screenshot, sleep } from '../web/landing-src/lib/cdp.mjs';
import { SEEDS } from '../web/landing-src/lib/seeds.mjs';
import { sbStubSource, ROSTER_ATHLETES, BOOK_CLIENTS } from '../web/landing-src/lib/sb-stub.mjs';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'http://localhost:8799/index.html';
const TODAY = '2026-07-23';
const ROOT = process.cwd();

/* ---------------- args ---------------- */
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? def : argv[i + 1];
};
const has = (name) => argv.includes('--' + name);
const THEMES = String(flag('themes', 'dark')).split(',').map((s) => s.trim()).filter(Boolean);
const WIDTHS = String(flag('widths', '390')).split(',').map((s) => Number(s.trim())).filter(Boolean);
const OUT_DIR = join(ROOT, 'qc', flag('out', 'transformation'));
const AUDIT_ONLY = has('audit-only');
const ALL = has('all');
const FILTER = argv.filter((a) => !a.startsWith('--') && !/^\d/.test(a) && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);

/* ---------------- deterministic clock ---------------- */
const clockAt = (h, m) => `(() => { const FAKE = new Date(2026,6,23,${h},${m},0).getTime(); const R = Date;
  const D = function(...a){ return a.length ? new R(...a) : new R(FAKE); };
  D.now = () => FAKE; D.parse = R.parse; D.UTC = R.UTC; D.prototype = R.prototype;
  Object.setPrototypeOf(D, R); globalThis.Date = D; })();`;

const setTheme = (t) => `(async () => { const st = await import('/js/state.js');
  st.RT.theme = '${t}'; st.applyTheme(); window.__render(); return 1; })()`;

/* ---------------- the screen set ----------------
 * `seed` picks the evidence fixture, `at` freezes the clock so countdowns are reproducible,
 * `book` selects which roster the Supabase stub serves. Grouped by role so the contact sheet
 * reads as a product walkthrough, not an alphabetical dump. */
const SHOTS = [
  // athlete — the daily loop
  { g: 'athlete', name: 'home-morning', seed: 'dayMorning', route: 'home', at: [7, 52] },
  { g: 'athlete', name: 'home-midday', seed: 'dayMidday', route: 'home', at: [13, 10] },
  { g: 'athlete', name: 'home-complete', seed: 'dayComplete', route: 'home', at: [21, 50] },
  { g: 'athlete', name: 'home-late', seed: 'dayLate', route: 'home', at: [22, 5] },
  { g: 'athlete', name: 'home-first-day', seed: 'dayFirst', route: 'home', at: [15, 20] },
  { g: 'athlete', name: 'score-breakdown', seed: 'dayComplete', route: 'score-breakdown', at: [21, 52] },
  { g: 'athlete', name: 'plan', seed: 'dayComplete', route: 'plan', at: [21, 56] },
  { g: 'athlete', name: 'progress', seed: 'dayComplete', route: 'progress', at: [21, 55] },
  { g: 'athlete', name: 'profile', seed: 'dayComplete', route: 'profile', at: [21, 57] },
  { g: 'athlete', name: 'notifications', seed: 'dayMidday', route: 'notifications', at: [13, 15] },

  // athlete — the meal state machine
  { g: 'meal', name: 'camera', seed: 'dayMorning', route: 'camera/lunch', at: [12, 40] },
  { g: 'meal', name: 'analyzing', seed: 'dayMorning', route: 'analyzing', at: [12, 41] },
  { g: 'meal', name: 'meal-analysis', seed: 'dayMidday', route: 'meal-analysis', at: [13, 5] },
  { g: 'meal', name: 'meal-detail', seed: 'dayMidday', route: 'meal-detail/lunch', at: [13, 8] },
  { g: 'meal', name: 'meal-thread', seed: 'dayMidday', route: 'meal-thread/lunch', at: [13, 9] },
  { g: 'meal', name: 'nutrition-chat', seed: 'dayMidday', route: 'nutrition-chat', at: [13, 30] },
  { g: 'meal', name: 'meal-questions', seed: 'dayMidday', route: 'meal-questions', at: [13, 6] },
  { g: 'meal', name: 'food-search', seed: 'dayMidday', route: 'food-search', at: [13, 7] },
  { g: 'meal', name: 'history', seed: 'dayComplete', route: 'history', at: [21, 58] },

  // athlete — the rest of the day
  { g: 'athlete2', name: 'weight', seed: 'dayMorning', route: 'weight', at: [7, 10] },
  { g: 'athlete2', name: 'recovery', seed: 'dayMidday', route: 'recovery', at: [21, 30] },
  { g: 'athlete2', name: 'commitment', seed: 'dayMidday', route: 'commitment', at: [21, 40] },
  { g: 'athlete2', name: 'checkin', seed: 'dayMidday', route: 'checkin', at: [21, 35] },
  { g: 'athlete2', name: 'log-training', seed: 'dayComplete', route: 'log-training', at: [20, 5] },
  { g: 'athlete2', name: 'training-history', seed: 'dayComplete', route: 'training-history', at: [20, 6] },
  { g: 'athlete2', name: 'progress-photos', seed: 'dayComplete', route: 'progress-photos', at: [20, 7] },
  { g: 'athlete2', name: 'monthly-report', seed: 'dayComplete', route: 'monthly-report', at: [21, 59] },
  { g: 'athlete2', name: 'accountability', seed: 'dayComplete', route: 'accountability', at: [20, 20], vc: 'earned' },
  { g: 'athlete2', name: 'streak', seed: 'dayComplete', route: 'streak', at: [21, 45] },
  { g: 'athlete2', name: 'trust', seed: 'dayComplete', route: 'trust', at: [21, 59] },

  // Connected Standards (0155). Four moments, because the states that matter most are the ones
  // where the DEVICE failed rather than the athlete — 'cs-gap' is the shot to look at hardest.
  { g: 'standards', name: 'cs-home-live', seed: 'dayMidday', route: 'home', at: [18, 42], cs: 'live' },
  { g: 'standards', name: 'cs-home-done', seed: 'dayComplete', route: 'home', at: [21, 30], cs: 'done' },
  { g: 'standards', name: 'cs-home-gap', seed: 'dayMidday', route: 'home', at: [21, 30], cs: 'gap' },
  { g: 'standards', name: 'cs-detail', seed: 'dayMidday', route: 'connected-standard/csr-steps', at: [18, 45], cs: 'live' },
  { g: 'standards', name: 'cs-detail-gap', seed: 'dayMidday', route: 'connected-standard/csr-steps', at: [21, 30], cs: 'gap' },
  { g: 'standards', name: 'cs-list', seed: 'dayMidday', route: 'connected-standards', at: [18, 45], cs: 'live' },
  { g: 'standards', name: 'cs-edit', seed: 'dayMidday', route: 'connected-standard-edit', at: [18, 45], cs: 'live' },
  { g: 'standards', name: 'cs-coach-board', seed: 'coachIdentity', route: 'coach-standards', at: [20, 4], cs: 'live', book: 'team' },
  { g: 'standards', name: 'cs-coach-build', seed: 'coachIdentity', route: 'coach-standard-edit', at: [14, 12], cs: 'live', book: 'team' },
  { g: 'standards', name: 'cs-coach-manage', seed: 'coachIdentity', route: 'coach-standards-manage', at: [14, 10], cs: 'live', book: 'team' },
  { g: 'standards', name: 'cs-coach-home', seed: 'coachIdentity', route: 'coach-home', at: [20, 4], cs: 'live', book: 'team' },
  { g: 'standards', name: 'cs-coach-clear', seed: 'coachIdentity', route: 'coach-standards', at: [22, 30], cs: 'live', board: 'clear', book: 'team' },

  // plan styles
  { g: 'styles', name: 'style-structured', seed: 'styleStructured', route: 'plan', at: [21, 40] },
  { g: 'styles', name: 'style-guided', seed: 'styleGuided', route: 'plan', at: [21, 40] },
  { g: 'styles', name: 'style-intuitive', seed: 'styleIntuitive', route: 'plan', at: [21, 40] },
  { g: 'styles', name: 'plan-style-picker', seed: 'dayComplete', route: 'plan-style', at: [21, 41] },

  // coach
  { g: 'coach', name: 'coach-home', seed: 'coachIdentity', route: 'coach-home', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-roster', seed: 'coachIdentity', route: 'coach-roster', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-inbox', seed: 'coachIdentity', route: 'coach-inbox', at: [20, 10], book: 'team' },
  // The coach half of the conversation. Was never captured, so every change to it - names,
  // timestamps, the draft affordance - shipped unreviewed.
  { g: 'coach', name: 'coach-meal', seed: 'coachIdentity', route: 'coach-meal/meal-seed-lunch', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-insights', seed: 'coachIdentity', route: 'coach-insights', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-create', seed: 'coachIdentity', route: 'coach-create', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-announce', seed: 'coachIdentity', route: 'coach-announce', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-rooms', seed: 'coachIdentity', route: 'coach-rooms', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-commitments', seed: 'coachIdentity', route: 'coach-commitments', at: [6, 5], book: 'team' },
  { g: 'coach', name: 'coach-plan', seed: 'coachIdentity', route: 'coach-plan', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-profile', seed: 'coachIdentity', route: 'coach-profile', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'copilot', seed: 'coachIdentity', route: 'copilot', at: [20, 10], book: 'team' },

  // trainer
  { g: 'trainer', name: 'trainer-home', seed: 'trainerIdentity', route: 'coach-home', at: [7, 30], book: 'practice' },
  { g: 'trainer', name: 'trainer-book', seed: 'trainerIdentity', route: 'coach-roster', at: [7, 30], book: 'practice' },
  { g: 'trainer', name: 'trainer-grow', seed: 'trainerIdentity', route: 'trainer-grow', at: [7, 30], book: 'practice' },
  { g: 'trainer', name: 'trainer-inbox', seed: 'trainerIdentity', route: 'trainer-inbox', at: [7, 30], book: 'practice' },

  // parent
  { g: 'parent', name: 'parent-home', seed: 'parentIdentity', route: 'parent', at: [19, 15], book: 'team' },
  { g: 'parent', name: 'parent-fund', seed: 'parentIdentity', route: 'fund-plan', at: [19, 16], book: 'team' },

  // account / money / settings
  { g: 'account', name: 'settings', seed: 'dayComplete', route: 'settings', at: [21, 57] },
  { g: 'account', name: 'privacy', seed: 'dayComplete', route: 'privacy', at: [21, 57] },
  { g: 'account', name: 'paywall', seed: 'dayComplete', route: 'paywall', at: [21, 57] },
  { g: 'account', name: 'billing', seed: 'dayComplete', route: 'billing', at: [21, 57] },
  { g: 'account', name: 'connect', seed: 'dayComplete', route: 'connect', at: [21, 58] },
  { g: 'account', name: 'notif-settings', seed: 'dayComplete', route: 'notif-settings', at: [21, 57] },
  { g: 'account', name: 'edit-profile', seed: 'dayComplete', route: 'edit-profile', at: [21, 57] },
  { g: 'account', name: 'restrictions', seed: 'dayComplete', route: 'restrictions', at: [21, 57] },

  // pre-auth
  { g: 'auth', name: 'welcome', seed: 'dayFirst', route: 'welcome', at: [9, 0], preAuth: true },
  { g: 'auth', name: 'signin', seed: 'dayFirst', route: 'signin', at: [9, 0], preAuth: true },
  { g: 'auth', name: 'role', seed: 'dayFirst', route: 'role', at: [9, 0], preAuth: true },
];

/* ---------------- page-side defect audit ----------------
 * Runs inside the rendered page. Everything here is measurement, not opinion: a number a
 * reviewer can re-derive. Returns plain JSON. */
const AUDIT_JS = `(() => {
  const vw = window.innerWidth;
  const out = { vw, overflowX: 0, wideEls: [], smallTargets: [], clipped: [], lowContrast: [], textLen: 0, tapTotal: 0 };

  // 1. horizontal overflow of the page itself
  const de = document.documentElement;
  out.overflowX = Math.max(0, Math.round(de.scrollWidth - vw));

  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null;
    return r;
  };
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
    return (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).slice(0,2).join('.') : '') + ' — ' + t).slice(0, 90);
  };

  const all = Array.from(document.querySelectorAll('body *'));

  // 2. elements wider than the viewport (the usual cause of a sideways-scrolling screen)
  for (const el of all) {
    const r = vis(el);
    if (!r) continue;
    if (r.width > vw + 1 || r.right > vw + 1.5) out.wideEls.push({ el: label(el), w: Math.round(r.width), right: Math.round(r.right) });
  }

  // 3. touch targets below the 44x44 accessibility floor.
  //
  // Measures the EFFECTIVE hit area, not the painted box. The app expands small controls with a
  // centred absolutely-positioned ::after carrying min-width/min-height, so the pill stays small
  // while the target is full size. Measuring getBoundingClientRect alone would report those as
  // failures forever, and a metric that can never go green gets ignored — which is the exact
  // normalisation that let a red security suite sit unnoticed.
  const TAP = 'a,button,[role=button],input,select,textarea,[tabindex]:not([tabindex="-1"]),.tap,.tab,.chip';
  const hitBox = (el, r) => {
    let w = r.width, h = r.height;
    const a = getComputedStyle(el, '::after');
    if (a && a.content && a.content !== 'none' && a.position === 'absolute') {
      const mw = parseFloat(a.minWidth) || 0;
      const mh = parseFloat(a.minHeight) || 0;
      // An absolutely-positioned ::after carrying an explicit min-width/min-height is a hit
      // expander; a decorative dot has neither. Do NOT test left === '50%' — getComputedStyle
      // resolves percentage offsets to pixels, so that check silently never matches.
      if (mw > 0 || mh > 0) { w = Math.max(w, mw); h = Math.max(h, mh); }
    }
    return { w, h };
  };
  for (const el of document.querySelectorAll(TAP)) {
    const r = vis(el);
    if (!r) continue;
    out.tapTotal++;
    const { w, h } = hitBox(el, r);
    if (w < 44 || h < 44) out.smallTargets.push({ el: label(el), w: Math.round(w), h: Math.round(h) });
  }

  // 4. text clipped by its container (truncation that loses meaning)
  for (const el of all) {
    if (!el.childNodes.length) continue;
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const r = vis(el);
    if (!r) continue;
    const cs = getComputedStyle(el);
    const hidden = cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis';
    if (hidden && el.scrollWidth > el.clientWidth + 2) {
      out.clipped.push({ el: label(el), scroll: el.scrollWidth, client: el.clientWidth });
    }
  }

  // 5. text contrast against the nearest painted background (WCAG relative luminance)
  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  // Walk up to the nearest opaque painted background. Returns null when a gradient is in the
  // way: a gradient has no single colour to measure, and guessing produced false failures on
  // every gradient-filled button (dark ink on bright green was reported as 1.06:1).
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (/gradient/i.test(cs.backgroundImage)) return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0.85) return c;
      n = n.parentElement;
    }
    const c = parse(getComputedStyle(document.body).backgroundColor);
    return c && c.a > 0 ? c : { r: 8, g: 11, b: 10, a: 1 };
  };
  for (const el of all) {
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasText) continue;
    const r = vis(el);
    if (!r) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.5) continue;
    const bg = bgOf(el);
    if (!bg) continue; // unmeasurable (gradient fill) — never report a guess as a failure
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize) || 16;
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      out.lowContrast.push({ el: label(el), ratio: Math.round(ratio * 100) / 100, need, px: Math.round(px) });
    }
  }

  out.textLen = (document.body.innerText || '').replace(/\\s+/g, ' ').trim().length;
  out.head = (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 110);
  // de-dupe + cap so one repeated component doesn't drown the report
  const uniq = (arr, k) => { const s = new Set(); return arr.filter((x) => { const v = k(x); if (s.has(v)) return false; s.add(v); return true; }); };
  out.wideEls = uniq(out.wideEls, (x) => x.el).slice(0, 8);
  out.smallTargets = uniq(out.smallTargets, (x) => x.el).slice(0, 12);
  out.clipped = uniq(out.clipped, (x) => x.el).slice(0, 8);
  out.lowContrast = uniq(out.lowContrast, (x) => x.el).slice(0, 12);
  return out;
})()`;

/* ---------------- runner ---------------- */
const withTimeout = (p, ms, what) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms: ${what}`)), ms)),
]);

let TARGETS = SHOTS;
if (ALL) {
  // Every registered route, using a sensible default seed. Finds screens nothing else covers.
  const idx = await readFile(join(ROOT, 'proto/redesign-2026-07/js/screens/index.js'), 'utf8');
  const names = Array.from(idx.matchAll(/^\s*'?([a-z0-9-]+)'?\s*:/gim)).map((m) => m[1]);
  const known = new Set(SHOTS.map((s) => s.route.split('/')[0]));
  const extra = [...new Set(names)].filter((n) => !known.has(n));
  TARGETS = SHOTS.concat(extra.map((n) => ({
    g: 'sweep', name: 'sweep-' + n, route: n, seed: 'dayComplete', at: [20, 10], book: 'team',
  })));
}
// Positional args are name filters. Skip anything that is a flag or a flag's value, then split
// on commas so `qc-capture.mjs home,meal` matches both rather than looking for one literal
// "home,meal" screen.
const flagValues = new Set(['themes', 'widths', 'out', 'scroll-to'].map((f) => flag(f, null)).filter(Boolean));
const nameFilter = argv
  .filter((a) => !a.startsWith('--') && !flagValues.has(a))
  .flatMap((a) => a.split(',').map((s) => s.trim()).filter(Boolean));
if (nameFilter.length) TARGETS = TARGETS.filter((s) => nameFilter.some((f) => s.name.includes(f)));

const SCROLL_TO = flag('scroll-to', null);
const b = await launch({ port: 9341, scale: 2 });
const report = [];
try {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const dir = join(OUT_DIR, `${theme}-${width}`);
      if (!AUDIT_ONLY) await mkdir(dir, { recursive: true });
      for (const s of TARGETS) {
        const page = await b.newPage({ width, height: 844 });
        const errors = [];
        b.on((msg) => {
          if (msg.sessionId !== page.sessionId) return;
          if (msg.method === 'Runtime.exceptionThrown') {
            errors.push(String(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'exception').slice(0, 160));
          }
          if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
            errors.push(String((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')).slice(0, 160));
          }
        });
        const [h, m] = s.at || [20, 10];
        const rec = { theme, width, group: s.g, name: s.name, route: s.route };
        try {
          await seedOnNewDocument(page, clockAt(h, m));
          if (s.vc) await seedOnNewDocument(page, `window.__VC_MODE = ${JSON.stringify(s.vc)};`);
          if (s.cs) await seedOnNewDocument(page, `window.__CS_MODE = ${JSON.stringify(s.cs)};`);
          if (s.board) await seedOnNewDocument(page, `window.__CS_BOARD = ${JSON.stringify(s.board)};`);
          await seedOnNewDocument(page, sbStubSource({
            todayISO: TODAY,
            athletes: s.book === 'practice' ? BOOK_CLIENTS : ROSTER_ATHLETES,
          }));
          await withTimeout((async () => {
            await goto(page, BASE, { settleMs: 1100 });
            if (!s.preAuth) await evalJs(page, `(async () => { ${SEEDS[s.seed]} return 1; })()`);
            await evalJs(page, setTheme(theme));
            await evalJs(page, `(() => { location.hash = '#${s.route}'; return 1; })()`);
            await sleep(/^(coach|trainer|parent|copilot)/.test(s.route) ? 2600 : 1400);
            // Shots start at the top unless asked otherwise. --scroll-to lets a run frame a
            // section that lives below the fold (the meal thread, a long settings list) without
            // hand-driving a browser — the audit still runs on the whole document either way.
            await evalJs(page, SCROLL_TO
              ? `(() => { const el = document.querySelector(${JSON.stringify(SCROLL_TO)}); if (el) el.scrollIntoView({ block: 'start' }); else window.scrollTo(0,0); return 1; })()`
              : `(() => { window.scrollTo(0,0); return 1; })()`);
            await sleep(220);
          })(), 45000, s.name);

          const audit = await evalJs(page, AUDIT_JS);
          Object.assign(rec, audit);
          rec.errors = [...new Set(errors)].filter((e) => !/favicon/i.test(e)).slice(0, 5);
          // 90, not 120: #settings legitimately renders 118 chars. Tuned against verified screens
          // so THIN stays a real signal — it still catches #monthly-report's stuck loading state.
          rec.thin = audit.textLen < 90;
          if (!AUDIT_ONLY) {
            const buf = await screenshot(page, { format: 'png' });
            await writeFile(join(dir, s.name + '.png'), buf);
            rec.kb = Math.round(buf.length / 1024);
          }
          const flags = [
            rec.thin && 'THIN',
            rec.overflowX > 0 && `OVERFLOW+${rec.overflowX}`,
            rec.errors.length && `ERR:${rec.errors.length}`,
            rec.smallTargets.length && `TAP:${rec.smallTargets.length}`,
            rec.clipped.length && `CLIP:${rec.clipped.length}`,
            rec.lowContrast.length && `CONTRAST:${rec.lowContrast.length}`,
          ].filter(Boolean);
          console.log(`${flags.length ? '!' : ' '} ${theme}/${width} ${s.name.padEnd(22)} ${flags.join(' ') || 'clean'}`);
        } catch (e) {
          rec.failed = String(e.message).slice(0, 140);
          console.log(`X ${theme}/${width} ${s.name.padEnd(22)} FAILED: ${rec.failed}`);
        }
        report.push(rec);
        await b.send('Target.closeTarget', { targetId: page.targetId });
      }
    }
  }
} finally {
  await b.close();
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

/* ---------------- contact sheet ---------------- */
if (!AUDIT_ONLY) {
  const groups = [...new Set(report.map((r) => r.group))];
  const cell = (r) => `<figure class="${r.failed ? 'bad' : ''}">
    <img loading="lazy" src="./${r.theme}-${r.width}/${r.name}.png" alt="${r.name}">
    <figcaption><b>${r.name}</b><span>#${r.route} · ${r.theme} · ${r.width}w</span>
    ${[r.thin && 'THIN', r.overflowX > 0 && 'OVERFLOW', r.errors?.length && 'JS ERROR',
       r.smallTargets?.length && `${r.smallTargets.length} small taps`,
       r.clipped?.length && `${r.clipped.length} clipped`,
       r.lowContrast?.length && `${r.lowContrast.length} contrast`, r.failed && 'FAILED']
      .filter(Boolean).map((f) => `<em>${f}</em>`).join('')}</figcaption></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><title>OnStandard QC — ${new Date().toISOString().slice(0, 10)}</title>
<style>body{background:#0b0f0e;color:#e8efeb;font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px}
h1{font-size:20px}h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#8fa89c;margin:32px 0 12px;border-top:1px solid #1d2725;padding-top:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px}
figure{margin:0}img{width:100%;border-radius:10px;border:1px solid #1d2725;display:block;background:#000}
figcaption{font-size:11px;color:#8fa89c;padding-top:6px;display:flex;flex-direction:column;gap:2px}
figcaption b{color:#e8efeb;font-size:12px}em{font-style:normal;background:#3a1d1d;color:#ff9d9d;border-radius:4px;padding:1px 5px;font-size:10px;align-self:flex-start}
.bad img{outline:2px solid #ff5f5f}</style>
<h1>OnStandard QC — ${report.length} captures</h1>
${groups.map((g) => `<h2>${g}</h2><div class="grid">${report.filter((r) => r.group === g).map(cell).join('')}</div>`).join('')}`;
  await writeFile(join(OUT_DIR, 'index.html'), html);
}

/* ---------------- summary ---------------- */
const n = (k) => report.reduce((a, r) => a + (Array.isArray(r[k]) ? r[k].length : 0), 0);
const failed = report.filter((r) => r.failed);
const thin = report.filter((r) => r.thin);
const overflow = report.filter((r) => r.overflowX > 0);
console.log(`\n${report.length} captures → ${OUT_DIR}`);
console.log(`  failed:        ${failed.length}${failed.length ? '  ' + failed.map((r) => r.name).join(', ') : ''}`);
console.log(`  thin/empty:    ${thin.length}${thin.length ? '  ' + thin.map((r) => r.name).join(', ') : ''}`);
console.log(`  h-overflow:    ${overflow.length}${overflow.length ? '  ' + overflow.map((r) => `${r.name}(+${r.overflowX})`).join(', ') : ''}`);
console.log(`  js errors:     ${n('errors')}`);
console.log(`  small taps:    ${n('smallTargets')}`);
console.log(`  clipped text:  ${n('clipped')}`);
console.log(`  low contrast:  ${n('lowContrast')}`);
