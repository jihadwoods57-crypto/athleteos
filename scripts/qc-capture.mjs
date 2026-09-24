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
//   node scripts/qc-capture.mjs --full       # capture the whole scrolled document, not one viewport
//   node scripts/qc-capture.mjs --port 9342 --shard 1/4 --out x-1   # one of four parallel shards
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


/** One seeded wake-up row, `startedMinAgo` minutes into its window on the page's own clock. */
const rcSeed = (startedMinAgo) => `const cd = await import('./js/commitment-data.js');
  const now = Date.now(); const min = 60000; const off = ${startedMinAgo};
  const iso = (m) => new Date(now + (off + m) * min).toISOString();
  const day = new Date(now - new Date().getTimezoneOffset() * min).toISOString().slice(0, 10);
  const row = { instance_id: 'rc-shot', type: 'morning_roll_call', title: 'Wake-Up Roll Call',
    message: 'Up and at it. Lift at 7, be early.', action_label: 'I’m Up', coach_name: 'Coach Reed', alarm: true,
    starts_min: 360, respond_by_min: 365, opens_min: 360, ends_min: 390,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, occurs_on: day,
    starts_at: iso(0), respond_by_at: iso(5), closes_at: iso(30),
    status: 'pending', verdict: 'pending', acknowledged_at: null, instance_status: 'scheduled' };
  cd.seedMineForHarness([row], day);`;
const TODAY = '2026-07-23';
/** The composer's bottom bar (composer upgrade, 2026-09-23). `dictOn` stands in for the native
 *  speech module through dictation.js's harness seam, so the mic shows as it does on a phone that
 *  can dictate; `toEnd` rests the thread on its newest message, where the bar is flush with the
 *  bottom edge. `listen` taps the mic and plays a live transcript and a voice level into the box.
 *  qc-capture cannot raise a real keyboard: these are the resting and listening states only. */
const dictOn = `const dm = await import('./js/dictation.js');
  await dm.setDictationBackendForHarness({ available: async () => ({ available: true, onDevice: true }),
    start: async () => ({ ok: true, onDevice: true }), stop() {}, abort() {} });`;
const toEnd = `await new Promise((r) => setTimeout(r, 250));
  const vp = document.querySelector('.viewport'); if (vp) { vp.style.scrollBehavior = 'auto'; vp.scrollTop = vp.scrollHeight; }`;
const listen = `const mic = document.querySelector('.chat-dock .composer .cmp-mic, .composer.at-end .cmp-mic');
  if (!mic) console.error('composer shot: no .cmp-mic in the dock');
  else { mic.click(); await new Promise((r) => setTimeout(r, 60));
    const sid = (await import('./js/dictation.js')).currentDictationSid();
    window.__onDictation({ sid, type: 'text', text: 'two eggs, turkey bacon and a bowl of oatmeal with', final: false });
    window.__onDictation({ sid, type: 'level', value: 0.55 }); }`;
const typed = `const box = document.querySelector('.chat-dock .composer textarea');
  if (box) { box.value = 'Was the rice portion right?'; box.dispatchEvent(new Event('input', { bubbles: true })); }`;
/** The team board (roll call rebuilt, 2026-09-23), seeded through the harness seams on the frozen
 *  clock: twelve athletes, the signed-in athlete ('seed-athlete') 4th at 6:01. `o.now` is the
 *  shot's clock; anyone whose tap is after it is not up yet, and once the board has closed the
 *  not-up are missed (the server's rule, applied here because the seed stands in for the server).
 *  `o.me` 'open' leaves the athlete unanswered; `o.mode` is the board's mode. */
const rbSeed = (o) => `const cd = await import('./js/commitment-data.js');
  const O = ${JSON.stringify(o)};
  const T = (h, m) => new Date(2026, 6, 23, h, m, 0).toISOString();
  const now = T(O.now[0], O.now[1]);
  const arrival = O.mode === 'arrival';
  const closed = !arrival && Date.parse(now) > Date.parse(T(6, 30));
  const P = [
    ['r1', 'DeShawn Cole', 5, 52, 'on_standard', 6, 31], ['r2', 'Andre Wells', 5, 57, 'on_standard', 6, 38],
    ['r3', 'Jaylen Brooks', 6, 0, 'on_standard', null, null], ['seed-athlete', 'Marcus Reed', 6, 1, 'on_standard', 6, 41],
    ['r5', 'Kofi Owusu', 6, 2, 'on_standard', 6, 44], ['r6', 'Luis Soto', 6, 3, 'on_standard', null, null],
    ['r7', 'Ben Price', 6, 4, 'on_standard', 6, 40], ['r8', 'Chris James', 6, 5, 'on_standard', null, null],
    ['r9', 'Tyrek Malone', 6, 8, 'late', 6, 57], ['r10', 'Tommy Vargas', null, null, 'pending', null, null],
    ['r11', 'Ray Gomez', null, null, 'pending', null, null], ['r12', 'Eli Walker', null, null, 'pending', null, null],
  ];
  const meOpen = O.me === 'open';
  const byT = arrival ? T(15, 30) : T(6, 45);
  let place = 0;
  const rows = P.map(([id, name, h, m, v, ah, am]) => {
    let ack = h == null ? null : T(h, m);
    if (ack && Date.parse(ack) > Date.parse(now)) ack = null;
    if (id === 'seed-athlete' && meOpen) ack = null;
    let verdict = ack ? v : (closed ? 'missed' : 'pending');
    if (arrival) { ack = null; verdict = 'pending'; }
    // Arrival-only runs in the afternoon: the same spread, moved to 3:00 to 3:45.
    let arr = ah == null ? null : (arrival ? T(ah + 9, am - 30 < 0 ? am + 30 : am - 30) : T(ah, am));
    if (arr && Date.parse(arr) > Date.parse(now)) arr = null;
    if (id === 'seed-athlete' && meOpen) arr = null;
    // The server's arrival rule (rollcall_arrival_verdict): missed only once BOTH the roll call's
    // close and the be-there time + 10 grace have passed (final review M-4: this seed used to keep
    // everyone "Not here yet" forever).
    const arrClosed = Date.parse(now) > Math.max(arrival ? 0 : Date.parse(T(6, 30)), Date.parse(byT) + 600000);
    const av = O.mode === 'wake' ? null
      : arr ? (Date.parse(arr) > Date.parse(byT) + 600000 ? 'late' : 'on_standard')
      : id === 'r6' ? 'unverified' : arrClosed ? 'missed' : 'pending';
    return { athlete_id: id, name, avatar_path: null, acknowledged_at: ack, arrived_at: arr,
      verdict, arrival_verdict: av, place: (verdict === 'on_standard' || verdict === 'late') ? ++place : null };
  });
  const board = { instance_id: 'rb-shot', title: arrival ? 'Stadium walkthrough' : 'Morning Roll Call', coach_name: 'Coach Brooks',
    mode: O.mode, starts_at: arrival ? T(15, 0) : T(6, 0), respond_by_at: arrival ? null : T(6, 5),
    closes_at: arrival ? null : T(6, 30), arrive_by_at: O.mode === 'wake' ? null : byT,
    asks_arrival: O.mode !== 'wake', location_name: O.mode === 'wake' ? null : (arrival ? 'Bright House Stadium' : 'Lincoln Weight Room'),
    rows };
  cd.seedTeamBoardForHarness('rb-shot', board);
  const me = rows.find((r) => r.athlete_id === 'seed-athlete');
  cd.seedMineForHarness([{ instance_id: 'rb-shot', type: arrival ? 'practice' : 'morning_roll_call', title: board.title,
    message: 'Up and at it. Lift at 7, be early. Protein at breakfast.', action_label: 'I’m Up', coach_name: 'Coach Brooks',
    occurs_on: '2026-07-23', starts_at: board.starts_at, respond_by_at: board.respond_by_at, closes_at: board.closes_at,
    opens_at: arrival ? null : T(5, 50), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    status: me.acknowledged_at ? 'acknowledged' : 'pending', acknowledged_at: me.acknowledged_at, verdict: me.verdict,
    // The board's own asks_arrival/location fields, mirrored onto the athlete's cached row: the
    // router's redirect() bails out of the OLD roll-call/<id> screen only when ONE of these three
    // is set (js/screens/rollcall-board.js redirect()). Missing them here sent ONLY the arrival
    // shot to the retired screen instead of the rebuilt team board (redirect()'s first line
    // exempts type: 'morning_roll_call' unconditionally, which is what 'both' seeds, so 'both'
    // was never affected) — a harness gap, not a product one: the server's real my_commitments
    // row carries these fields for any commitment with a place (js/commitments.js).
    location_id: O.mode === 'wake' ? null : 'loc-rb-shot', asks_arrival: board.asks_arrival, location_name: board.location_name,
    instance_status: 'scheduled' }], '2026-07-23');`;
/** A NEW build (final fix round, items 2 and 3): the native capability line says location, walk-in
 *  and the map are compiled in, and the location bridge answers with `state` ('undetermined' |
 *  'when_in_use' | 'always' | 'denied'). Without this a harness shot is an OLD binary, which is
 *  what the old-build shots rely on. */
const newBuild = (state = 'when_in_use') => `const cdN = await import('./js/commitment-data.js');
  cdN.setNativeCapsForHarness({ location: true, walkIn: true, maps: true });
  window.OnStandardNative = Object.assign(window.OnStandardNative || {}, {
    location: { available: async () => ({ available: true, state: '${state}', presence: true, walkIn: true }),
      request: async () => '${state}', arm: async () => ({ armed: 1, capped: 0, state: '${state}', walkIn: 'on' }),
      disarm: async () => true, check: async () => ({ within: true, reason: null, distance_m: 40 }), settings() {} },
    maps: { pick: async () => null } });
  const LN = await import('./js/location.js'); LN.setLocationStateForHarness('${state}'); LN.setConsentCachedForHarness(true);
`;
/** The coach's roll call (Task 10): one standing wake-up ('rc-rule', Mon to Fri 6:00 AM), its
 *  saved places, the week ahead on the frozen clock (Thu 23 Jul: Fri moved to 5:30, Tue cancelled,
 *  the weekend not scheduled) and 30 days of history with both kinds of athlete. `o.draft` starts
 *  the setup screen from a draft (a picked place, arrival only). All through the harness seams. */
const rsSeed = (o = {}) => `const cd = await import('./js/commitment-data.js');
  const O = ${JSON.stringify(o)};
  const T = (d, h, m) => new Date(2026, 6, d, h, m, 0).toISOString();
  const rule = { id: 'rc-rule', type: 'morning_roll_call', title: 'Morning Roll Call', message: 'Up and at it. Lift at 7.',
    audience_kind: 'team', audience_value: null, repeat_days: [1, 2, 3, 4, 5], starts_min: 360, respond_by_min: 365,
    ends_min: 390, opens_min: 360, location_id: null, arrive_by_min: null, arrival_grace_min: 10,
    escalation: { alarm: true, breakthrough: true, notify_coach_on_miss: true }, active: true, timezone: 'America/New_York' };
  const places = [
    { id: 'loc-1', name: 'Lincoln Weight Room', address: '1200 Stadium Dr', lat: 28.6, lng: -81.2, radius_m: 150 },
    { id: 'loc-2', name: 'Bright House Stadium', address: null, lat: 28.61, lng: -81.19, radius_m: 300 },
  ];
  cd.seedCommitmentsForHarness([rule], places);
  const day = (d, h, m, x) => Object.assign({ instance_id: 'i-' + d, commitment_id: 'rc-rule', occurs_on: '2026-07-' + d,
    instance_status: 'scheduled', skipped: false, starts_at: T(d, h, m), starts_min: h * 60 + m, rule_starts_min: 360,
    starts_override_min: null }, x || {});
  cd.seedUpcomingForHarness('rc-rule', [
    day(23, 6, 0), day(24, 5, 30, { starts_override_min: 330 }), day(27, 6, 0),
    day(28, 6, 0, { skipped: true, instance_status: 'cancelled' }), day(29, 6, 0),
  ]);
  const A = (id, name, on, late, missed, trend, streak, first) => ({ athlete_id: id, name, avatar_path: null,
    mornings: on + late + missed, on_time: on, late, missed, on_time_pct: Math.round(100 * on / (on + late + missed)),
    trend, streak, first_up: first });
  cd.seedHistoryForHarness('rc-rule', { team_on_time_pct: 84, team_trend: -3, athletes: [
    A('r10', 'Tommy Vargas', 13, 4, 5, -18, 0, 0), A('r9', 'Tyrek Malone', 16, 6, 0, -6, 1, 0),
    A('r11', 'Ray Gomez', 17, 3, 2, 4, 3, 1), A('r3', 'Jaylen Brooks', 20, 2, 0, 0, 9, 2),
    A('r2', 'Andre Wells', 21, 1, 0, 3, 14, 3), A('r1', 'DeShawn Cole', 22, 0, 0, 0, 22, 16),
  ] });
  if (O.draft) { const rs = await import('./js/screens/rollcall-setup.js'); rs.seedSetupForHarness(O.draft); }`;
/** Roll call v3, Task 9: the athlete's next roll call (Home) and the assignment screen. Four
 *  mornings ahead on the frozen clock (Thu 23 Jul 8:10 PM: Fri 24, Mon 27, Wed 29, Fri 31, 4:45 AM)
 *  for commitment 'rc-v3', and the phone's alarm state. `o.alarm`: 'set' (this phone holds Friday's
 *  alarm), 'sync' (allowed, not armed), 'ask' (never asked), 'denied', or 'none' (no rows at all). */
const rnSeed = (o = {}) => `const cd = await import('./js/commitment-data.js');
  const O = ${JSON.stringify(o)};
  const T = (d, h, m) => new Date(2026, 6, d, h, m, 0).toISOString();
  const row = (d) => ({ instance_id: 'rn-' + d, commitment_id: 'rc-v3', type: 'morning_roll_call', title: 'Morning Roll Call',
    message: 'Up and at it. Lift at 7, be early.', action_label: 'I’m Up', coach_name: 'Coach Brooks', alarm: true,
    occurs_on: '2026-07-' + d, starts_at: T(d, 4, 45), respond_by_at: T(d, 4, 50), closes_at: T(d, 5, 15),
    starts_min: 285, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    status: 'pending', verdict: 'pending', acknowledged_at: null, instance_status: 'scheduled' });
  cd.seedMineForHarness(O.alarm === 'none' ? [] : [24, 27, 29, 31].map(row), '2026-07-23');
  const st = { set: { authorization: 'authorized', armed: 1, ids: ['rn-24'] }, sync: { authorization: 'authorized', armed: 0, ids: [] },
    ask: { authorization: 'notDetermined', armed: 0, ids: [] }, denied: { authorization: 'denied', armed: 0, ids: [] } }[O.alarm] || { authorization: 'authorized', armed: 0, ids: [] };
  window.__AP_STATE = { at: '2026-07-20T12:00:00Z', answer: 'not_now' };
  window.OnStandardNative = Object.assign(window.OnStandardNative || {}, { push: { token: async () => null },
    notify: { sync() {}, permission: async () => 'granted' }, location: { settings() {} },
    wakeAlarms: { sync: async () => 0, state: async () => Object.assign({ supported: true }, st) } });`;
/** Roll call v3, Task 10: the coach's one roll call screen. 'rc-rule' rings Mon to Fri at 6:00 AM;
 *  fourteen days ahead from Thu 23 Jul on the frozen clock (Tue 28 cancelled, weekends off). Thursday's
 *  morning is 'i-23' (opens 5:50, closes 6:30), the team board is rbSeed's under that id, and Friday's
 *  'i-24' carries the arming list: every step the coach can see. `o.arming`: 'mixed' (every step),
 *  'one' (one left to set), 'all' (every alarm set). `o.told` seeds the line Start leaves. */
const rhbSeed = (o = {}) => `const cd = await import('./js/commitment-data.js');
  const v3 = await import('./js/rollcall-v3-data.js');
  const O = ${JSON.stringify(o)};
  const rule = { id: 'rc-rule', type: 'morning_roll_call', title: 'Morning Roll Call', message: 'Up and at it. Lift at 7.',
    audience_kind: 'team', audience_value: null, repeat_days: [1, 2, 3, 4, 5], starts_min: 360, respond_by_min: 365,
    ends_min: 390, opens_min: 350, location_id: null, arrive_by_min: null, arrival_grace_min: 10,
    escalation: { alarm: O.alarm !== false, breakthrough: true, notify_coach_on_miss: true }, active: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  cd.seedCommitmentsForHarness([rule], []);
  const iso = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  const rows = [];
  for (let d = 23; d < 37; d++) {
    const day = new Date(2026, 6, d, 6, 0, 0);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const at = (h, m) => new Date(2026, 6, d, h, m, 0).toISOString();
    rows.push({ instance_id: 'i-' + d, commitment_id: 'rc-rule', occurs_on: iso(day), instance_status: d === 28 ? 'cancelled' : 'scheduled',
      skipped: d === 28, starts_at: at(6, 0), respond_by_at: at(6, 5), opens_at: at(5, 50), closes_at: at(6, 30),
      starts_min: 360, rule_starts_min: 360, starts_override_min: null, timezone: rule.timezone,
      total: 8, reachable: 7, armed: d === 24 ? ({ mixed: 4, one: 7, all: 8 }[O.arming || 'mixed']) : d < 28 ? 3 : 0 });
  }
  cd.seedUpcomingForHarness('rc-rule', rows);
  const A = (id, name, step) => ({ athlete_id: id, name, status: step === 'excused' ? 'excused' : 'pending',
    notified_at: step === 'untold' || step === 'no_push' ? null : '2026-07-23T18:00:00Z',
    seen_at: step === 'seen' || step === 'armed' ? '2026-07-23T19:00:00Z' : null,
    alarm_armed_at: step === 'armed' ? '2026-07-23T19:01:00Z' : null, can_push: step !== 'no_push' });
  const mixed = [A('r1', 'DeShawn Cole', 'armed'), A('r2', 'Andre Wells', 'armed'), A('seed-athlete', 'Marcus Reed', 'armed'),
    A('r3', 'Jaylen Brooks', 'armed'), A('r10', 'Tommy Vargas', 'seen'), A('r11', 'Ray Gomez', 'unseen'),
    A('r12', 'Eli Walker', 'no_push'), A('r5', 'Kofi Owusu', 'untold'), A('r6', 'Luis Soto', 'excused')];
  const arm = O.arming === 'all' ? mixed.map((r) => (r.status === 'excused' ? r : A(r.athlete_id, r.name, 'armed')))
    : O.arming === 'one' ? mixed.map((r) => (r.status === 'excused' || r.athlete_id === 'r10' ? r : A(r.athlete_id, r.name, 'armed')))
    : mixed;
  v3.seedArmingForHarness('i-24', { instance_id: 'i-24', commitment_id: 'rc-rule', alarm: O.alarm !== false, rows: arm });
  if (O.told) v3.seedToldForHarness('rc-rule', O.told, 6);`;
const ROOT = process.cwd();

/* ---------------- args ---------------- */
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? def : argv[i + 1];
};
const has = (name) => argv.includes('--' + name);
// --serve N: the port the proto server listens on (default 8799). A worktree runs its own server
// on another port, so a capture renders THAT tree's proto rather than whichever checkout owns 8799.
// --ipad renders the real iPad layout (rail, 720 column, split) instead of the desktop bezel at
// 700px+ widths: js/layout.js honours ?layout=auto, as scripts/ipad-shots.mjs does.
const BASE = `http://localhost:${Number(flag('serve', 8799)) || 8799}/index.html${argv.includes('--ipad') ? '?layout=auto' : ''}`;
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

/* Every first-visit tip and tour reads as already seen in a capture. Tips became lazy
 * (tour.js is imported by the screen's mount, 2026-09), and a seed account has no server
 * birthday, so maybeShowTip's "wait for the main tour" gate never held one back: "Your last
 * seven days" sat over every Progress shot. A Proxy answers "seen" for ANY id, so a tip added
 * later cannot cover a shot either. Harness only: the app's own seen logic is untouched. A shot
 * that means to capture a tour or tip sets `tour: true` and gets the product's real state. */
const TIPS_SEEN = `(async () => { const st = await import('/js/state.js');
  const own = {}; const at = '2026-01-01T00:00:00.000Z';
  st.RT.tourSeen = new Proxy(own, { get: (o, k) => (typeof k === 'string' && k !== 'toJSON' ? (o[k] || at) : o[k]), has: () => true });
  return 1; })()`;

/* Progress states (2026-09-23 cleanup). Each rewrites DAY.scoreHistory through the page's own
 * modules after a day seed: `days` is [back, score|null, weight?] with back = days before today;
 * a missing back is a day with no row at all (nothing logged), which is what a real miss looks
 * like on the server. Evidence only: every average and count on the screen is still computed
 * by state.js. */
const pgHist = (days, extra = '') => `const { DAY } = await import('./js/day.js'); const { RT } = await import('./js/state.js');
  const iso = (back) => { const d = new Date(DAY.date + 'T12:00:00'); d.setDate(d.getDate() - back);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
  DAY.scoreHistory = ${JSON.stringify(days)}.map(([b, s, w]) => ({ date: iso(b), score: s, weight: w == null ? null : w }));
  ${extra}`;
/** Five weeks of a mixed athlete: good weeks, two days with no log, a 52 and a 71 this week. */
const MIXED = [
  ...Array.from({ length: 28 }, (_, i) => [35 - i, [88, 91, 84, 79, 93, 86, 90][i % 7]]).filter(([b]) => b !== 20 && b !== 13),
  [6, 92], [5, 71], [3, 52], [2, 88],
];
const WEIGHED = MIXED.map(([b, s], i) => [b, s, b % 4 === 0 ? +(191.5 - (35 - b) * 0.12).toFixed(1) : null]);

const setTheme = (t) => `(async () => { const st = await import('/js/state.js');
  st.RT.theme = '${t}'; st.applyTheme(); window.__render(); return 1; })()`;

/* ---------------- the screen set ----------------
 * `seed` picks the evidence fixture, `at` freezes the clock so countdowns are reproducible,
 * `book` selects which roster the Supabase stub serves. Grouped by role so the contact sheet
 * reads as a product walkthrough, not an alphabetical dump. */
const SHOTS = [
  // athlete — the daily loop
  { g: 'athlete', name: 'home-open', seed: 'dayOpen', route: 'home', at: [7, 5] },
  { g: 'athlete', name: 'home-morning', seed: 'dayMorning', route: 'home', at: [7, 52] },
  { g: 'athlete', name: 'home-midday', seed: 'dayMidday', route: 'home', at: [13, 10] },
  { g: 'athlete', name: 'home-complete', seed: 'dayComplete', route: 'home', at: [21, 50] },
  { g: 'athlete', name: 'home-late', seed: 'dayLate', route: 'home', at: [22, 5] },
  // The OVERDUE now-card had no coverage, which is how it kept a display-size "Late" numeral and
  // three competing reds through two polish passes. Morning seed + an afternoon clock leaves
  // lunch past its window and unlogged — the one state that renders .xnow.red.
  { g: 'athlete', name: 'home-overdue', seed: 'dayMorning', route: 'home', at: [16, 10] },
  // The wake-up roll call, athlete side (2026-09-16). The stub's my_commitments is a pre-0212
  // shape, so these seed one row through the harness seam (the same one rollcall-detail.test.mjs
  // uses) at a clock relative to the page's own, then repaint. Three surfaces that had no shot:
  // the detail while open, the Home card once late, and the in-app alarm face.
  { g: 'athlete', name: 'roll-call-open', seed: 'dayMorning', route: 'roll-call/rc-shot', at: [6, 2],
    act: rcSeed(-2) + ` window.__render();`, actMs: 900 },
  // The face takes over Home at 6:12 (which is the point); "Not now" dismisses it so the card
  // underneath is what this shot proves.
  { g: 'athlete', name: 'home-roll-call-late', seed: 'dayMorning', route: 'home', at: [6, 12],
    act: rcSeed(-12) + ` window.__render(); await new Promise((r) => setTimeout(r, 500));
    const later = document.querySelector('[data-wf-later]'); if (later) later.click();`, actMs: 1200 },
  { g: 'athlete', name: 'wake-face', seed: 'dayMorning', route: 'home', at: [6, 2],
    act: rcSeed(-2) + ` const wf = await import('./js/wake-face.js'); wf.showWakeFace(row);`, actMs: 900 },
  // The team board and Your day (roll call rebuilt, Task 9): the athlete 4th with the window still
  // open, the athlete before answering (I'm Up is the one primary), their day, the coach's live
  // board and a face's sheet, the closed board with its misses, the both-parts board with the
  // place per face, and an arrival-only board (I'm here is the action).
  { g: 'rollcall', name: 'rollcall-board-athlete', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [6, 12], pre: rbSeed({ now: [6, 12], mode: 'wake' }) },
  { g: 'rollcall', name: 'rollcall-board-athlete-open', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [6, 3], pre: rbSeed({ now: [6, 3], mode: 'wake', me: 'open' }) },
  { g: 'rollcall', name: 'rollcall-board-day', seed: 'dayOpen', route: 'rollcall-board/rb-shot/day', at: [6, 12], pre: rbSeed({ now: [6, 12], mode: 'wake' }) },
  { g: 'rollcall', name: 'rollcall-board-coach', seed: 'coachIdentity', route: 'rollcall-board/rb-shot', at: [6, 12], book: 'team', pre: rbSeed({ now: [6, 12], mode: 'wake' }) },
  { g: 'rollcall', name: 'rollcall-board-coach-sheet', seed: 'coachIdentity', route: 'rollcall-board/rb-shot', at: [6, 12], book: 'team', pre: rbSeed({ now: [6, 12], mode: 'wake' }),
    act: `const f = document.querySelector('[data-rb-athlete="r10"]'); if (f) f.click();`, actMs: 700 },
  { g: 'rollcall', name: 'rollcall-board-closed', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [6, 45], pre: rbSeed({ now: [6, 45], mode: 'wake' }) },
  { g: 'rollcall', name: 'rollcall-board-both', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [6, 42], pre: newBuild('always') + rbSeed({ now: [6, 42], mode: 'both' }) },
  { g: 'rollcall', name: 'rollcall-board-both-closed', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [7, 0], pre: newBuild('always') + rbSeed({ now: [7, 0], mode: 'both' }) },
  { g: 'rollcall', name: 'rollcall-board-arrival', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [15, 26], pre: newBuild('always') + rbSeed({ now: [15, 26], mode: 'arrival', me: 'open' }) },
  // Location, asked in context (final fix round, item 2): a phone never asked (While Using,
  // explained first), While Using granted (Always offered, "Not now" beside it), a No (Settings),
  // and the location check-in screen itself, never asked and with Always on. Then an OLD binary
  // (items 3/I-2): no I'm here button, one "Update OnStandard" line.
  { g: 'rollcall', name: 'rollcall-loc-ask', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [15, 26], pre: newBuild('undetermined') + rbSeed({ now: [15, 26], mode: 'arrival', me: 'open' }) },
  { g: 'rollcall', name: 'rollcall-loc-always', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [15, 26], pre: newBuild('when_in_use') + rbSeed({ now: [15, 26], mode: 'arrival', me: 'open' }) },
  { g: 'rollcall', name: 'rollcall-loc-denied', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [15, 26], pre: newBuild('denied') + rbSeed({ now: [15, 26], mode: 'arrival', me: 'open' }) },
  { g: 'rollcall', name: 'location-consent', seed: 'dayMorning', route: 'location-consent', at: [15, 26],
    pre: newBuild('undetermined') + `const lc = await import('./js/screens/location-consent.js'); lc.setConsentForHarness(true);` },
  { g: 'rollcall', name: 'location-consent-on', seed: 'dayMorning', route: 'location-consent', at: [15, 26],
    pre: newBuild('always') + `const lc = await import('./js/screens/location-consent.js'); lc.setConsentForHarness(true);` },
  { g: 'rollcall', name: 'rollcall-board-oldbuild', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [15, 26], pre: rbSeed({ now: [15, 26], mode: 'arrival', me: 'open' }) },
  // The coach's roll call (Task 10): setup blank, with a picked place, the Where step with saved
  // places (no map on this "binary"), arrival only, the week strip and a morning's sheet, history.
  // rollcall-new is a NEW build (the Also check door); rollcall-new-oldbuild is an OLD binary with
  // no saved place (final review I-1: one "Update OnStandard to add a place" line, no door).
  { g: 'rollcall', name: 'rollcall-new', seed: 'coachIdentity', route: 'rollcall-new', at: [20, 10], book: 'team', pre: newBuild('when_in_use') + rsSeed() },
  { g: 'rollcall', name: 'rollcall-new-oldbuild', seed: 'coachIdentity', route: 'rollcall-new', at: [20, 10], book: 'team',
    pre: rsSeed() + ` cd.seedCommitmentsForHarness([rule], []);` },
  { g: 'rollcall', name: 'rollcall-new-map', seed: 'coachIdentity', route: 'rollcall-new', at: [20, 10], book: 'team',
    pre: newBuild('when_in_use') + rsSeed({ draft: { mode: 'both', arrive_by_min: 405 } }) },
  { g: 'rollcall', name: 'rollcall-new-place', seed: 'coachIdentity', route: 'rollcall-new', at: [20, 10], book: 'team',
    pre: rsSeed({ draft: { mode: 'both', location_id: 'loc-1', place: { id: 'loc-1', name: 'Lincoln Weight Room', radius_m: 150, address: '1200 Stadium Dr' }, arrive_by_min: 405 } }) },
  { g: 'rollcall', name: 'rollcall-new-where', seed: 'coachIdentity', route: 'rollcall-new', at: [20, 10], book: 'team',
    pre: rsSeed({ draft: { mode: 'both', arrive_by_min: 405, change: true } }) },
  { g: 'rollcall', name: 'rollcall-new-arrival', seed: 'coachIdentity', route: 'rollcall-new', at: [20, 10], book: 'team',
    pre: rsSeed({ draft: { mode: 'arrival', location_id: 'loc-2', place: { id: 'loc-2', name: 'Bright House Stadium', radius_m: 300 }, arrive_by_min: 930, repeat_days: [1, 3, 5] } }) },
  { g: 'rollcall', name: 'rollcall-week', seed: 'coachIdentity', route: 'rollcall-week/rc-rule', at: [20, 10], book: 'team', pre: rsSeed() },
  { g: 'rollcall', name: 'rollcall-week-sheet', seed: 'coachIdentity', route: 'rollcall-week/rc-rule', at: [20, 10], book: 'team', pre: rsSeed(),
    act: `const d = document.querySelector('[data-rw-day="i-24"]'); if (d) d.click();`, actMs: 700 },
  { g: 'rollcall', name: 'rollcall-history', seed: 'coachIdentity', route: 'rollcall-history/rc-rule', at: [20, 10], book: 'team', pre: rsSeed() },
  // Roll call v3, Task 10: the coach's one roll call screen, before / during / after, every step,
  // one left (named), all set, the line Start leaves, a day's sheet from Cancel, and the Home card.
  { g: 'rollcall', name: 'rhb-before', seed: 'coachIdentity', route: 'rollcall/rc-rule', at: [20, 10], book: 'team', pre: rhbSeed() },
  { g: 'rollcall', name: 'rhb-before-one', seed: 'coachIdentity', route: 'rollcall/rc-rule', at: [20, 10], book: 'team', pre: rhbSeed({ arming: 'one' }) },
  { g: 'rollcall', name: 'rhb-before-all', seed: 'coachIdentity', route: 'rollcall/rc-rule', at: [20, 10], book: 'team', pre: rhbSeed({ arming: 'all' }) },
  { g: 'rollcall', name: 'rhb-landed', seed: 'coachIdentity', route: 'rollcall/rc-rule', at: [20, 10], book: 'team', pre: rhbSeed({ told: 'ok' }) },
  { g: 'rollcall', name: 'rhb-live', seed: 'coachIdentity', route: 'rollcall/rc-rule', at: [6, 12], book: 'team',
    pre: `{ ${rhbSeed()} } { ${rbSeed({ now: [6, 12], mode: 'wake' }).split("'rb-shot'").join("'i-23'")} }` },
  { g: 'rollcall', name: 'rhb-after', seed: 'coachIdentity', route: 'rollcall/rc-rule', at: [6, 45], book: 'team',
    pre: `{ ${rhbSeed()} } { ${rbSeed({ now: [6, 45], mode: 'wake' }).split("'rb-shot'").join("'i-23'")} }` },
  { g: 'rollcall', name: 'rhb-cancel-sheet', seed: 'coachIdentity', route: 'rollcall/rc-rule', at: [20, 10], book: 'team', pre: rhbSeed(),
    act: `const b = document.querySelector('[data-rhb-cancel]'); if (b) b.click(); await new Promise((r) => setTimeout(r, 400));`, actMs: 500 },
  { g: 'rollcall', name: 'rhb-week-redirect', seed: 'coachIdentity', route: 'rollcall-week/rc-rule', at: [20, 10], book: 'team', pre: rhbSeed() },
  { g: 'rollcall', name: 'rhb-home-card', seed: 'coachIdentity', route: 'coach-home', at: [20, 10], book: 'team',
    // Today's board empty, so Home follows rc-rule (the stub's own 5 AM Club would win otherwise).
    pre: rhbSeed() + ' cd.seedBoardForHarness([]);' },
  // Roll call v3 (Task 9): the next roll call on Home, with THIS phone's alarm status, and the
  // assignment screen the assignment push opens. Seeded after the page settles, then repainted.
  { g: 'rollcall', name: 'rn-home-set', seed: 'dayComplete', route: 'home', at: [20, 10], act: rnSeed({ alarm: 'set' }) + ' window.__render();', actMs: 1400 },
  { g: 'rollcall', name: 'rn-home-unset', seed: 'dayComplete', route: 'home', at: [20, 10], act: rnSeed({ alarm: 'sync' }) + ' window.__render();', actMs: 1400 },
  { g: 'rollcall', name: 'rn-home-open-day', seed: 'dayMidday', route: 'home', at: [20, 10], act: rnSeed({ alarm: 'ask' }) + ' window.__render();', actMs: 1400 },
  { g: 'rollcall', name: 'rn-home-none', seed: 'dayComplete', route: 'home', at: [20, 10], act: rnSeed({ alarm: 'none' }) + ' window.__render();', actMs: 1400 },
  { g: 'rollcall', name: 'ra-assigned-set', seed: 'dayComplete', route: 'rollcall-assigned/rc-v3', at: [20, 10], pre: rnSeed({ alarm: 'set' }) },
  { g: 'rollcall', name: 'ra-assigned-unset', seed: 'dayComplete', route: 'rollcall-assigned/rc-v3', at: [20, 10], pre: rnSeed({ alarm: 'denied' }) },
  // The "Day N locked." stamp: a body-level overlay, so it is captured by rendering Home with the
  // lock unacknowledged. Every other athlete seed marks it seen, or it would appear over whichever
  // screen rendered first and make the contact sheet nondeterministic.
  { g: 'athlete', name: 'home-day-locked', seed: 'dayLockStamp', route: 'home', at: [7, 40] },
  // The same stamp for a day that closed UNDER 80. Before 2026-09-16 this state did not exist —
  // a bad day closed silently — so it had no shot. It is the quieter half of the app's one
  // end-of-day moment and the half most likely to drift into scolding, so it gets its own frame.
  { g: 'athlete', name: 'home-day-closed', seed: 'dayLockStampClosed', route: 'home', at: [7, 40] },
  { g: 'athlete', name: 'home-first-day', seed: 'dayFirst', route: 'home', at: [15, 20] },
  { g: 'athlete', name: 'score-breakdown', seed: 'dayComplete', route: 'score-breakdown', at: [21, 52] },
  { g: 'athlete', name: 'plan', seed: 'dayComplete', route: 'plan', at: [21, 56] },
  { g: 'athlete', name: 'progress', seed: 'dayComplete', route: 'progress', at: [21, 55] },
  // Progress across the states an athlete really meets (2026-09-23 cleanup): the first day, two
  // days in, a mixed week with no-log days, no weight logged, a weigh-in trend, no coach, and a
  // trainer's client (whose page leads with the body).
  { g: 'athlete', name: 'progress-first-day', seed: 'dayFirst', route: 'progress', at: [15, 20] },
  { g: 'athlete', name: 'progress-early', seed: 'dayMorning', route: 'progress', at: [9, 30],
    pre: pgHist([[2, 84], [1, 91]], `RT.activationDate = iso(2); DAY.currentWeight = null;`) },
  { g: 'athlete', name: 'progress-mixed', seed: 'dayMorning', route: 'progress', at: [9, 30], pre: pgHist(MIXED) },
  { g: 'athlete', name: 'progress-no-weight', seed: 'dayComplete', route: 'progress', at: [21, 55],
    pre: pgHist(MIXED, `DAY.currentWeight = null;`) },
  { g: 'athlete', name: 'progress-weight-trend', seed: 'dayComplete', route: 'progress', at: [21, 55],
    pre: pgHist(WEIGHED, `RT.profile.seasonGoal = { target: 185, start: 192 };`) },
  { g: 'athlete', name: 'progress-no-coach', seed: 'dayComplete', route: 'progress', at: [21, 55],
    pre: `const { RT } = await import('./js/state.js'); RT.myCoach = null;` },
  { g: 'athlete', name: 'progress-client', seed: 'dayComplete', route: 'progress', at: [21, 55],
    pre: pgHist(WEIGHED, `RT.myCoach = null; RT.myTrainer = { name: 'Dana Ruiz', practiceName: 'Ruiz Performance' }; RT.profile.seasonGoal = { target: 185, start: 192 };`) },
  { g: 'athlete', name: 'profile', seed: 'dayComplete', route: 'profile', at: [21, 57] },
  { g: 'athlete', name: 'notifications', seed: 'dayMidday', route: 'notifications', at: [13, 15] },

  // athlete — the meal state machine
  // `pre` marks the device as already primed: the camera shot used to capture the one-time
  // permission primer (camera-priming covers that) and the real viewfinder was never seen.
  { g: 'meal', name: 'camera', seed: 'dayMorning', route: 'camera/lunch', at: [12, 40], pre: `const st = await import('./js/state.js'); st.RT.camPrimed = true;` },
  // This entry was named 'analyzing' and captured the CAMERA PRIMING screen for its whole life:
  // #analyzing with nothing staged bounces to #camera by design, so the contact sheet has been
  // showing a permission prompt under the name of the scan interstitial — which is part of why
  // nobody noticed the scan had dropped out of the meal flow entirely. Named for what it is.
  // The scan itself is a sub-2-second timed hand-off; it is verified by driving the real flow
  // (camera-confirm → analyzing → thread) rather than by a still, which would race its own ceiling.
  { g: 'meal', name: 'camera-priming', seed: 'dayMorning', route: 'analyzing', at: [12, 41] },
  { g: 'meal', name: 'camera-confirm', seed: 'stagedCapture', route: 'camera-confirm', at: [12, 41] },
  // Feedback intake (0162): the picker, and the compose step for the two kinds whose treatment
  // differs — a bug (which announces its auto-attached context) and safety (which is deliberately
  // set apart in red and routed urgent).
  { g: 'athlete2', name: 'feedback-pick', seed: 'dayComplete', route: 'feedback', at: [21, 40] },
  { g: 'athlete2', name: 'feedback-bug', seed: 'feedbackBug', route: 'feedback', at: [21, 41] },
  { g: 'athlete2', name: 'feedback-safety', seed: 'feedbackSafety', route: 'feedback', at: [21, 42] },
  // Subscription surfaces (0163/0164): the operator plan shop, and the keep-your-record card an
  // athlete sees when a roster ends — the two purchase moments the review found missing entirely.
  { g: 'athlete2', name: 'plan-upgrade', seed: 'coachUpgrade', route: 'plan-upgrade', at: [10, 0] },
  { g: 'athlete2', name: 'coach-home-planpick', seed: 'coachPickedPlan', route: 'coach-home', at: [10, 1] },
  { g: 'athlete2', name: 'plan-upgrade-picked', seed: 'coachPickedPlan', route: 'plan-upgrade', at: [10, 2] },
  { g: 'athlete2', name: 'home-roster-ended', seed: 'rosterEnded', route: 'home', at: [10, 5] },
  // A staged plate WITH the read the analyze call returns, so the confirm-before-it-counts screen
  // shows what an athlete sees after a real scan. It rendered 0g tiles and a "take a photo" prompt
  // in every capture before, so the one screen between the scan and the log was never reviewed.
  { g: 'meal', name: 'meal-analysis', seed: 'stagedCapture', route: 'meal-analysis', at: [13, 5], pre: `const st = await import('./js/state.js'); st.RT.camPrimed = true;
    st.MEAL.source = 'photo';
    st.MEAL.result = { quality: 84, protein: 52, carbs: 74, fat: 18, kcal: 780, fiber: 6,
      detected: ['Grilled chicken', 'Brown rice', 'Edamame', 'Soft-boiled egg'],
      detectedRich: [{ name: 'Grilled chicken', confidence: 'high' }, { name: 'Brown rice', confidence: 'high' },
        { name: 'Edamame', confidence: 'medium' }, { name: 'Soft-boiled egg', confidence: 'medium' }],
      note: 'Solid lunch. Fibre is the thin part, so a piece of fruit would round it out.' };` },
  { g: 'meal', name: 'meal-detail', seed: 'dayMidday', route: 'meal-detail/lunch', at: [13, 8] },
  // The score rubric lives in a closed <details>, so every sweep before 09-16 audited it shut —
  // which is how its notes clipped at 320 through two polish passes. Open it so the rows render
  // and the defect sweep sees them; pair with --scroll-to 'details.rub' to frame it in the PNG.
  { g: 'meal', name: 'meal-rubric', seed: 'dayMidday', route: 'meal-detail/lunch', at: [13, 8],
    act: `const d = document.querySelector('details.rub'); if (d) d.open = true; else console.error('meal-rubric: details.rub not found — shot is a silent duplicate of meal-detail');` },
  { g: 'meal', name: 'meal-thread', seed: 'dayMidday', route: 'meal-thread/lunch', at: [13, 9] },
  { g: 'meal', name: 'nutrition-chat', seed: 'dayMidday', route: 'nutrition-chat', at: [13, 30] },
  // The clarifying moment needs the questions the analyze call sends back; without them the
  // route correctly bounces to the camera, which is all this shot ever showed.
  { g: 'meal', name: 'meal-questions', seed: 'stagedCapture', route: 'meal-questions', at: [13, 6], pre: `const st = await import('./js/state.js'); st.RT.camPrimed = true;
    st.MEAL.questions = ['Is that chicken breast or thigh?', 'About how much rice is under it?'];` },
  { g: 'meal', name: 'food-search', seed: 'dayMidday', route: 'food-search', at: [13, 7] },
  { g: 'meal', name: 'history', seed: 'dayComplete', route: 'history', at: [21, 58] },
  // The PAST-meal conversation — where a follow-up notification lands. Never captured before,
  // so it was the one thread surface still rendering 'Coach' with a hardcoded letter for a face.
  { g: 'meal', name: 'meal-view', seed: 'dayMidday', route: 'meal-view/meal-seed-lunch', at: [21, 5] },

  // The bottom bar of all four threads (composer upgrade, 2026-09-23): one flush bar, the mic in
  // send's slot, send once there is text, and the listening state. Run: `node scripts/qc-capture.mjs
  // composer --themes dark,light`.
  { g: 'composer', name: 'composer-meal', seed: 'dayMidday', route: 'meal-thread/lunch', at: [13, 9], act: `${dictOn} ${toEnd}` },
  { g: 'composer', name: 'composer-meal-listening', seed: 'dayMidday', route: 'meal-thread/lunch', at: [13, 9], act: `${dictOn} ${toEnd} ${listen}` },
  { g: 'composer', name: 'composer-meal-typed', seed: 'dayMidday', route: 'meal-thread/lunch', at: [13, 9], act: `${dictOn} ${toEnd} ${typed}` },
  { g: 'composer', name: 'composer-meal-nomic', seed: 'dayMidday', route: 'meal-thread/lunch', at: [13, 9], act: toEnd },
  { g: 'composer', name: 'composer-past', seed: 'dayMidday', route: 'meal-view/meal-seed-lunch', at: [21, 5], act: `${dictOn} ${toEnd}` },
  { g: 'composer', name: 'composer-past-listening', seed: 'dayMidday', route: 'meal-view/meal-seed-lunch', at: [21, 5], act: `${dictOn} ${toEnd} ${listen}` },
  { g: 'composer', name: 'composer-chat', seed: 'dayMidday', route: 'nutrition-chat', at: [13, 30], act: `${dictOn} ${toEnd}` },
  { g: 'composer', name: 'composer-chat-listening', seed: 'dayMidday', route: 'nutrition-chat', at: [13, 30], act: `${dictOn} ${toEnd} ${listen}` },
  { g: 'composer', name: 'composer-coach', seed: 'coachIdentity', route: 'coach-meal/meal-seed-lunch', at: [20, 10], book: 'team', act: `${dictOn} ${toEnd}` },
  { g: 'composer', name: 'composer-coach-listening', seed: 'coachIdentity', route: 'coach-meal/meal-seed-lunch', at: [20, 10], book: 'team', act: `${dictOn} ${toEnd} ${listen}` },

  // athlete — the rest of the day
  { g: 'athlete2', name: 'weight', seed: 'dayMorning', route: 'weight', at: [7, 10] },
  { g: 'athlete2', name: 'recovery', seed: 'dayMidday', route: 'recovery', at: [21, 30] },
  { g: 'athlete2', name: 'commitment', seed: 'dayMidday', route: 'commitment', at: [21, 40] },
  // 'checkin' was removed 2026-09-07: the Weekly Check-In ritual was deleted in v2 and its route
  // went with it, so this shot rendered the 404 screen and the sweep counted it clean. Nothing in
  // the app links to 'checkin'; the nightly ritual that survived is 'recovery', captured above.
  { g: 'athlete2', name: 'log-training', seed: 'dayComplete', route: 'log-training', at: [20, 5] },
  // The quick-log SHEET. Uncovered until now, which is how a stray position:relative on #view could
  // throw it off the top of the screen without the harness noticing: .sheet/.sheet-scrim are
  // absolutely positioned inside a screen's markup, so they break whenever something upstream
  // becomes their containing block.
  { g: 'athlete2', name: 'log-sheet', seed: 'dayMidday', route: 'log', at: [15, 30] },
  { g: 'athlete2', name: 'training-history', seed: 'dayComplete', route: 'training-history', at: [20, 6] },
  // The progress-photo timeline and its compare mode were removed with the feature 2026-09-07
  // (founder call). Both shots came out of the shot list with it — a route that no longer exists
  // renders #notfound and the sweep counts it clean, which is exactly how 'checkin' hid for a
  // release cycle.
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
  { g: 'styles', name: 'meal-view-intuitive', seed: 'styleIntuitive', route: 'meal-view/meal-seed-lunch', at: [21, 40] },
  { g: 'styles', name: 'memory-edit-structured', seed: 'memoryEditStructured', route: 'memory-edit/seed-fm', at: [21, 40] },
  { g: 'styles', name: 'memory-edit-intuitive', seed: 'memoryEditIntuitive', route: 'memory-edit/seed-fm', at: [21, 40] },
  // A professional's calories-hidden-alone override: macros stay, every kcal figure goes.
  { g: 'styles', name: 'meal-view-calories-off', seed: 'styleCaloriesOff', route: 'meal-view/meal-seed-lunch', at: [21, 40] },
  { g: 'styles', name: 'memory-edit-calories-off', seed: 'memoryEditCaloriesOff', route: 'memory-edit/seed-fm', at: [21, 40] },
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
  { g: 'coach', name: 'coach-assign', seed: 'coachIdentity', route: 'coach-assign', at: [20, 10], book: 'team' },
  // The audience picker open with two people ticked, a quick title tapped in, the preview live.
  { g: 'coach', name: 'coach-assign-pick', seed: 'coachIdentity', route: 'coach-assign', at: [20, 10], book: 'team',
    act: `const c = (q) => { const el = document.querySelector(q); if (el) el.click(); };
      c('[data-aud="athletes"]'); await new Promise((r) => setTimeout(r, 150));
      const rows = document.querySelectorAll('[data-aud-id]'); if (rows[0]) rows[0].click(); if (rows[2]) rows[2].click();
      c('[data-sugg]');` },
  // The sent state: two people picked, a quick title, Send tapped, the stub answers the fan-out.
  { g: 'coach', name: 'coach-assign-sent', seed: 'coachIdentity', route: 'coach-assign', at: [20, 10], book: 'team',
    act: `const c = (q) => { const el = document.querySelector(q); if (el) el.click(); };
      c('[data-aud="athletes"]'); await new Promise((r) => setTimeout(r, 150));
      const rows = document.querySelectorAll('[data-aud-id]'); if (rows[0]) rows[0].click(); if (rows[2]) rows[2].click();
      c('[data-sugg]'); await new Promise((r) => setTimeout(r, 100)); c('#as-send');`, actMs: 1500 },
  // Roster Select mode with two ticked: the bulk bar now reads Assign 2.
  { g: 'coach', name: 'coach-roster-select', seed: 'coachIdentity', route: 'coach-roster', at: [20, 10], book: 'team',
    act: `document.querySelector('[data-selmode]').click(); await new Promise((r) => setTimeout(r, 400));
      const rows = document.querySelectorAll('[data-sel]'); if (rows[0]) rows[0].click(); await new Promise((r) => setTimeout(r, 300)); if (rows[3]) rows[3].click();` },
  { g: 'trainer', name: 'trainer-assign', seed: 'trainerIdentity', route: 'coach-assign', at: [7, 30], book: 'practice' },
  { g: 'coach', name: 'coach-announce', seed: 'coachIdentity', route: 'coach-announce', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-rooms', seed: 'coachIdentity', route: 'coach-rooms', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-commitments', seed: 'coachIdentity', route: 'coach-commitments', at: [6, 5], book: 'team' },
  // The roll-call surfaces had NO shot between them (founder audit 2026-09-14), which is part of
  // why they drifted: the composer's footer sentence sat in a height:0 box and nothing looked.
  // 6:05 is inside the window (the board is live); 7:10 is after it closes, which is the only
  // clock that renders the morning summary with real counts.
  { g: 'coach', name: 'coach-wakeup-edit', seed: 'coachIdentity', route: 'coach-wakeup-edit', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-wakeup-more', seed: 'coachIdentity', route: 'coach-wakeup-edit', at: [20, 10], book: 'team',
    act: `const m = document.querySelector('#wk-more'); if (m) m.click(); await new Promise((r) => setTimeout(r, 300));` },
  { g: 'coach', name: 'wakeup-morning', seed: 'coachIdentity', route: 'wakeup-morning', at: [7, 10], book: 'team' },
  // ONE WAY IN (roll call rebuilt, Task 11). The three shots above are retired routes now: each
  // must land on the rebuilt screen (coach-wakeup-edit -> the setup, wakeup-morning -> the board on
  // the misses). These prove the doors and the cold deep links: a tap on the coach Home card and
  // the create menu's Roll call, an old roll-call/<id> push before the row is cached (the board's
  // skeleton, never the old detail), the same link once the row resolves, and an old coach link.
  { g: 'rollcall', name: 'rc-door-coach-home', seed: 'coachIdentity', route: 'coach-home', at: [6, 12], book: 'team',
    pre: rbSeed({ now: [6, 12], mode: 'wake' }),
    act: `const c = document.querySelector('.wk-homecard[data-go]'); if (c) c.click(); await new Promise((r) => setTimeout(r, 900)); `, actMs: 900 },
  { g: 'rollcall', name: 'rc-door-create', seed: 'coachIdentity', route: 'coach-create', at: [20, 10], book: 'team',
    act: `const rows = [...document.querySelectorAll('[data-go]')]; const r = rows.find((x) => /Roll call/.test(x.textContent)); if (r) r.click(); await new Promise((r) => setTimeout(r, 900));`, actMs: 900 },
  { g: 'rollcall', name: 'rc-old-link-cold', seed: 'dayMorning', route: 'roll-call/rc-not-cached', at: [6, 12] },
  { g: 'rollcall', name: 'rc-old-link-resolves', seed: 'dayMorning', route: 'roll-call/rb-cold', at: [6, 12],
    act: rbSeed({ now: [6, 12], mode: 'wake' }).split("'rb-shot'").join("'rb-cold'") + ` window.__render(); await new Promise((r) => setTimeout(r, 900));`, actMs: 900 },
  { g: 'rollcall', name: 'rc-old-link-coach', seed: 'coachIdentity', route: 'coach-commitments/rb-shot', at: [6, 12], book: 'team',
    pre: rbSeed({ now: [6, 12], mode: 'wake' }) },
  { g: 'coach', name: 'coach-plan', seed: 'coachIdentity', route: 'coach-plan', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-profile', seed: 'coachIdentity', route: 'coach-profile', at: [20, 10], book: 'team' },

  // trainer
  { g: 'trainer', name: 'trainer-home', seed: 'trainerIdentity', route: 'coach-home', at: [7, 30], book: 'practice' },
  { g: 'trainer', name: 'trainer-book', seed: 'trainerIdentity', route: 'coach-roster', at: [7, 30], book: 'practice' },
  { g: 'trainer', name: 'trainer-inbox', seed: 'trainerIdentity', route: 'trainer-inbox', at: [7, 30], book: 'practice' },
  // A trainer reading a client's meal. Same screen as the coach (nav:'operator'), different
  // identity and vocabulary — the half that would call a client's trainer 'Coach'.
  { g: 'trainer', name: 'trainer-meal', seed: 'trainerIdentity', route: 'coach-meal/meal-seed-lunch', at: [7, 30], book: 'practice' },

  // dietitian (the team nutrition lens: the meal review queue leads the board)
  { g: 'dietitian', name: 'diet-home', seed: 'dietitianIdentity', route: 'coach-home', at: [20, 10], book: 'team' },
  { g: 'dietitian', name: 'diet-roster', seed: 'dietitianIdentity', route: 'coach-roster', at: [20, 10], book: 'team' },
  { g: 'dietitian', name: 'diet-meal', seed: 'dietitianIdentity', route: 'coach-meal/meal-seed-lunch', at: [20, 10], book: 'team' },
  // The retry tap: a deep link into an athlete while the book is still loading lands in the
  // offline state (coach-data.js loadAthleteProfile races loadBook); Try again recovers it.
  { g: 'dietitian', name: 'diet-athlete', seed: 'dietitianIdentity', route: 'coach-athlete/ath-4', at: [20, 10], book: 'team',
    act: `const b = document.getElementById('coach-ath-retry'); if (b) b.click();`, actMs: 2500 },
  { g: 'dietitian', name: 'diet-inbox', seed: 'dietitianIdentity', route: 'coach-inbox', at: [20, 10], book: 'team' },
  { g: 'coach', name: 'coach-athlete', seed: 'coachIdentity', route: 'coach-athlete/ath-4', at: [20, 10], book: 'team',
    act: `const b = document.getElementById('coach-ath-retry'); if (b) b.click();`, actMs: 2500 },

  // parent
  { g: 'parent', name: 'parent-home', seed: 'parentIdentity', route: 'parent', at: [19, 15], book: 'team' },

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

  // Review pass 2026-09-23, stream B (privacy, AI consent, safety, sign-up). Every screen that
  // stream changed, in the state that proves the change. `sso` stands in for a phone that offers
  // Sign in with Apple and Google; `np` for one never asked about notifications or alarms.
  { g: 'review-b', name: 'b-aic-sheet', seed: 'dayMorning', route: 'camera/lunch', at: [12, 40], pre: `const st = await import('./js/state.js'); st.RT.camPrimed = true;`,
    act: `(await import('./js/ai-consent.js')).openAiConsentSheet('athlete');`, actMs: 700 },
  { g: 'review-b', name: 'b-aic-sheet-coach', seed: 'coachIdentity', route: 'coach-meal/meal-seed-lunch', at: [20, 10], book: 'team',
    act: `(await import('./js/ai-consent.js')).openAiConsentSheet('coach');`, actMs: 700 },
  { g: 'review-b', name: 'b-camera-priming', seed: 'dayMorning', route: 'camera/lunch', at: [12, 40], pre: `const st = await import('./js/state.js'); st.RT.camPrimed = false;` },
  { g: 'review-b', name: 'b-meal-thread-ai-off', seed: 'dayMidday', route: 'meal-thread/lunch', at: [13, 9],
    pre: `const d = await import('./js/day.js'); const L = d.DAY.slotMacros.lunch || {};
      d.DAY.slotMacros.lunch = { mealId: L.mealId, name: 'Lunch', pending: true, analysisFailed: 'ai_off', protein: 0, kcal: 0, carbs: 0, fat: 0, quality: null, foods: [], detectedRich: [], highlights: [], analysis: '' };` },
  { g: 'review-b', name: 'b-privacy-athlete', seed: 'dayComplete', route: 'privacy', at: [21, 57] },
  { g: 'review-b', name: 'b-privacy-coach', seed: 'coachIdentity', route: 'privacy', at: [20, 10], book: 'team' },
  { g: 'review-b', name: 'b-terms-signed-out', seed: 'dayFirst', route: 'terms/oba', at: [9, 0], preAuth: true },
  { g: 'review-b', name: 'b-location-consent', seed: 'dayMorning', route: 'location-consent', at: [15, 26],
    pre: newBuild('undetermined') + `const lc = await import('./js/screens/location-consent.js'); lc.setConsentForHarness(true);` },
  { g: 'review-b', name: 'b-loc-ask', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [15, 26], pre: newBuild('undetermined') + rbSeed({ now: [15, 26], mode: 'arrival', me: 'open' }) },
  { g: 'review-b', name: 'b-loc-ask-notnow', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [15, 26],
    pre: newBuild('undetermined') + `localStorage.setItem('os.loc.wiuNotNow', '1');` + rbSeed({ now: [15, 26], mode: 'arrival', me: 'open' }) },
  { g: 'review-b', name: 'b-loc-ask-always', seed: 'dayMorning', route: 'rollcall-board/rb-shot', at: [15, 26], pre: newBuild('when_in_use') + rbSeed({ now: [15, 26], mode: 'arrival', me: 'open' }) },
  // Alarms already answered: Home's slot falls back to the notification primer.
  { g: 'review-b', name: 'b-home-primer', seed: 'dayMorning', route: 'home', at: [5, 40],
    pre: `window.OnStandardNative = Object.assign(window.OnStandardNative || {}, { push: { token: async () => null },
      notify: { sync() {}, permission: async () => 'undetermined' },
      wakeAlarms: { sync: async () => 0, state: async () => ({ supported: true, authorization: 'authorized', armed: 1 }) } });`,
    act: rcSeed(20) + ` window.__render();`, actMs: 1500 },
  // Roll call v3 (Task 8): the once-per-account alarm primer, at the next open (Home) for an
  // athlete already on a team, and right after joining one (Connect).
  { g: 'review-b', name: 'b-home-alarm-primer', seed: 'dayMorning', route: 'home', at: [5, 40],
    pre: `window.OnStandardNative = Object.assign(window.OnStandardNative || {}, { push: { token: async () => null },
      notify: { sync() {}, permission: async () => 'undetermined' },
      wakeAlarms: { sync: async () => 0, state: async () => ({ supported: true, authorization: 'notDetermined', armed: 0 }) } });`,
    act: rcSeed(20) + ` window.__render();`, actMs: 1500 },
  { g: 'review-b', name: 'b-connect-alarm-primer', seed: 'dayMorning', route: 'connect', at: [19, 10],
    pre: `window.OnStandardNative = Object.assign(window.OnStandardNative || {}, { push: { token: async () => null },
      notify: { sync() {}, permission: async () => 'undetermined' },
      wakeAlarms: { sync: async () => 0, state: async () => ({ supported: true, authorization: 'notDetermined', armed: 0 }) } });` },
  { g: 'review-b', name: 'b-roll-call-primer', seed: 'dayMorning', route: 'roll-call/rc-shot', at: [6, 2],
    pre: `window.OnStandardNative = Object.assign(window.OnStandardNative || {}, { push: { token: async () => null },
      notify: { sync() {}, permission: async () => 'undetermined' },
      wakeAlarms: { sync: async () => 0, state: async () => ({ supported: true, authorization: 'notDetermined', armed: 0 }) } });`,
    act: rcSeed(-2) + ` window.__render();`, actMs: 1200 },
  { g: 'review-b', name: 'b-notif-settings-primer', seed: 'dayComplete', route: 'notif-settings', at: [21, 57],
    pre: `window.OnStandardNative = Object.assign(window.OnStandardNative || {}, { notify: { sync() {}, permission: async () => 'undetermined' } });` },
  { g: 'review-b', name: 'b-oba-dob', seed: 'dayFirst', route: 'oba/dob', at: [9, 0], preAuth: true },
  { g: 'review-b', name: 'b-oba-minor', seed: 'dayFirst', route: 'oba/minor', at: [9, 0], preAuth: true,
    pre: `const st = await import('./js/state.js'); st.act.captureOb({ firstName: 'Jay', name: 'Jay Cole', dob: '2010-05-01', dobMinor: true, dobBlocked: false });` },
  { g: 'review-b', name: 'b-oba-blocked', seed: 'dayFirst', route: 'oba/blocked', at: [9, 0], preAuth: true,
    pre: `const st = await import('./js/state.js'); st.act.captureOb({ dobBlocked: true });` },
  { g: 'review-b', name: 'b-oba-demo', seed: 'dayFirst', route: 'oba/demo', at: [9, 0], preAuth: true },
  { g: 'review-b', name: 'b-age-check', seed: 'dayMorning', route: 'age-check', at: [9, 0] },
  { g: 'review-b', name: 'b-signin-sso', seed: 'dayFirst', route: 'signin', at: [9, 0], preAuth: true,
    pre: `window.OnStandardNative = Object.assign(window.OnStandardNative || {}, { apple: { available: async () => true, signIn: async () => null }, google: { available: async () => true, signIn: async () => null } });` },
  { g: 'review-b', name: 'b-role-sso-new', seed: 'dayFirst', route: 'role', at: [9, 0], preAuth: true, pre: `sessionStorage.setItem('os.sso.new', 'apple');` },
  { g: 'review-b', name: 'b-oba-account-sso', seed: 'dayFirst', route: 'oba/account', at: [9, 0], preAuth: true,
    pre: `window.OnStandardNative = Object.assign(window.OnStandardNative || {}, { apple: { available: async () => true, signIn: async () => null }, google: { available: async () => true, signIn: async () => null } });
      const st = await import('./js/state.js'); st.act.captureOb({ firstName: 'Jay', name: 'Jay Cole', dob: '2001-05-01' });` },
  { g: 'review-b', name: 'b-members-sheet', seed: 'dayMidday', route: 'meal-thread/lunch', at: [13, 9],
    act: `(await import('./js/members-sheet.js')).openMembersSheet([{ kind: 'athlete', self: true, id: 'seed-athlete', name: 'Marcus Reed' }, { kind: 'coach', id: 'c-reed', name: 'Coach Reed' }, { kind: 'parent', id: 'p-1', name: 'Dana Reed' }, { kind: 'ai', name: 'AI Nutritionist' }]);`, actMs: 900 },
  { g: 'review-b', name: 'b-coach-meal', seed: 'coachIdentity', route: 'coach-meal/meal-seed-lunch', at: [20, 10], book: 'team' },
];

/* ---------------- page-side defect audit ----------------
 * Runs inside the rendered page. Everything here is measurement, not opinion: a number a
 * reviewer can re-derive. Returns plain JSON. */
const AUDIT_JS = `(() => {
  const vw = window.innerWidth;
  const out = { vw, overflowX: 0, wideEls: [], smallTargets: [], clipped: [], lowContrast: [], textLen: 0, tapTotal: 0,
    // Heading outline: a screen that renders h2s with no h1 has lost its title for a screen
    // reader (crew backlog #7, audit 2026-09-05). Counted here so the sweep, not a reviewer, notices.
    h1: document.querySelectorAll('h1').length, h2: document.querySelectorAll('h2').length };

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
    // The composer's text box is 30px inside a 40px pill, and the PILL is the target: keyboard.js
    // carries a document-level click handler that focuses the box from anywhere in the field that
    // is not itself a button. Measuring the input alone reported every thread screen as a failure
    // that no CSS change could fix. If that handler ever goes, this line is wrong and the flag
    // should come back, so it names the file that makes it true.
    const pill = el.closest && el.closest('.composer .field');
    if (pill && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      const pr = pill.getBoundingClientRect();
      w = Math.max(w, pr.width); h = Math.max(h, pr.height);
    }
    // BOTH pseudo-elements, and width/height as well as the min-* pair. focus.css owns ::after for
    // most controls, but where ::after is already spent on something visible (the switch knob, a
    // chevron) the expander moves to ::before, and those rules size it outright rather than with a
    // minimum. Reading only ::after/min-* reported the settings switches as 30px tall forever,
    // which is how a metric teaches people to ignore it.
    for (const pseudo of ['::before', '::after']) {
      const a = getComputedStyle(el, pseudo);
      if (!a || !a.content || a.content === 'none' || a.position !== 'absolute') continue;
      // An absolutely-positioned pseudo sized explicitly is a hit expander; a decorative dot is
      // not absolutely positioned. Do NOT test left === '50%' — getComputedStyle resolves
      // percentage offsets to pixels, so that check silently never matches.
      const pw = Math.max(parseFloat(a.minWidth) || 0, parseFloat(a.width) || 0);
      const ph = Math.max(parseFloat(a.minHeight) || 0, parseFloat(a.height) || 0);
      if (pw > 0 || ph > 0) { w = Math.max(w, pw); h = Math.max(h, ph); }
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
    // .sr-only is clipped ON PURPOSE (1px box for screen readers); it is not lost meaning.
    if (el.classList.contains('sr-only')) continue;
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
  out.landed = String(location.hash || '');
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
const flagValues = new Set(['themes', 'widths', 'out', 'scroll-to', 'port', 'shard', 'scroll-by', 'serve'].map((f) => flag(f, null)).filter(Boolean));
const nameFilter = argv
  .filter((a) => !a.startsWith('--') && !flagValues.has(a))
  .flatMap((a) => a.split(',').map((s) => s.trim()).filter(Boolean));
if (nameFilter.length) TARGETS = TARGETS.filter((s) => nameFilter.some((f) => s.name.includes(f)));
// --shard 0/4 keeps every 4th shot starting at 0, so four runs (each with its own --port and
// --out) cover the set once between them in a quarter of the wall-clock.
const SHARD = flag('shard', null);
if (SHARD) { const [si, sn] = SHARD.split('/').map(Number); TARGETS = TARGETS.filter((_, k) => k % sn === si); }

const SCROLL_TO = flag('scroll-to', null);
const FULL = has('full');
// --touch: emulate a touchscreen, so `(pointer: coarse) and (hover: none)` matches and a 700px+
// width renders as the iPad does (phone-native frame, no desktop bezel) instead of the phone
// drawn inside a bezel. Without it every 820 shot is the desktop preview, not an iPad.
const TOUCH = has('touch');
// --scroll-by N: scroll .viewport N px before the shot (implies a viewport-sized shot, not
// --full), for the states that only exist mid-scroll: a sticky header with content under it.
const SCROLL_BY = Number(flag('scroll-by', 0)) || 0;
const b = await launch({ port: Number(flag('port', 9341)), scale: 2 });
const report = [];
try {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const dir = join(OUT_DIR, `${theme}-${width}`);
      if (!AUDIT_ONLY) await mkdir(dir, { recursive: true });
      for (const s of TARGETS) {
        const baseH = TOUCH && width >= 700 ? 1180 : 844;
        const page = await b.newPage({ width, height: baseH });
        if (TOUCH) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
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
            // Intuitive seeds get the thread prose a real Intuitive athlete's server writes —
            // no stored figures. Everyone else keeps the numbers voice they really see.
            voice: /Intuitive/.test(s.seed || '') ? 'signals' : 'numbers',
          }));
          await withTimeout((async () => {
            await goto(page, BASE, { settleMs: 1100 });
            if (!s.preAuth) await evalJs(page, `(async () => { ${SEEDS[s.seed]} return 1; })()`);
            if (!s.tour) await evalJs(page, TIPS_SEEN);
            // `pre` runs after the seed and before navigation: device state a seed does not own.
            if (s.pre) await evalJs(page, `(async () => { ${s.pre} return 1; })()`);
            await evalJs(page, setTheme(theme));
            await evalJs(page, `(() => { location.hash = '#${s.route}'; return 1; })()`);
            await sleep(/^(coach|trainer|parent)/.test(s.route) ? 2600 : 1400);
            // `act` drives the screen after it settles: a JS snippet run in-page (tap a chip, open a
            // picker, tick rows), so a state that only exists after interaction gets a still too.
            if (s.act) { await evalJs(page, `(async () => { ${s.act} return 1; })()`); await sleep(s.actMs || 700); }
            // Shots start at the top unless asked otherwise. --scroll-to lets a run frame a
            // section that lives below the fold (the meal thread, a long settings list) without
            // hand-driving a browser — the audit still runs on the whole document either way.
            await evalJs(page, SCROLL_TO
              ? `(() => { const el = document.querySelector(${JSON.stringify(SCROLL_TO)}); if (el) el.scrollIntoView({ block: 'start' }); else window.scrollTo(0,0); return 1; })()`
              : `(() => { window.scrollTo(0,0); return 1; })()`);
            if (SCROLL_BY) await evalJs(page, `(() => { const v = document.querySelector('.viewport'); if (v) { v.style.scrollBehavior = 'auto'; v.scrollTop = ${SCROLL_BY}; v.dispatchEvent(new Event('scroll')); } return 1; })()`);
            await sleep(220);
          })(), 45000, s.name);

          const audit = await evalJs(page, AUDIT_JS);
          Object.assign(rec, audit);
          rec.errors = [...new Set(errors)].filter((e) => !/favicon/i.test(e)).slice(0, 5);
          // 90, not 120: #settings legitimately renders 118 chars. Tuned against verified screens
          // so THIN stays a real signal — it still catches #monthly-report's stuck loading state.
          rec.thin = audit.textLen < 90;
          rec.noH1 = audit.h1 === 0 && audit.h2 > 0;
          if (!AUDIT_ONLY) {
            // --full frames the whole screen, not one viewport. The page never scrolls; .viewport
            // does (app.css), so the window is grown until .viewport's content fits, then shot.
            // Capped so a runaway list cannot make a 40MB PNG. The tab bar lands at the bottom.
            // Not with --touch at a tablet width: Chromium's capture of a touch-emulated 820px page
            // grown past ~4000px never returns (measured 2026-09-22; the page itself stays live).
            // Those runs take viewport shots; frame a section with --scroll-to / --scroll-by.
            const extra = FULL && !SCROLL_BY && !(TOUCH && width >= 700) ? await evalJs(page, `(() => { const v = document.querySelector('.viewport');
              return v ? Math.max(0, v.scrollHeight - v.clientHeight) : 0; })()`) : 0;
            if (extra > 0) {
              const tall = Math.min(6000, baseH + extra);
              await page.send('Emulation.setDeviceMetricsOverride', { width, height: tall, deviceScaleFactor: 2, mobile: true, screenWidth: width, screenHeight: tall });
              await sleep(350);
            }
            const buf = await screenshot(page, { format: 'png' });
            await writeFile(join(dir, s.name + '.png'), buf);
            rec.kb = Math.round(buf.length / 1024);
          }
          const flags = [
            rec.thin && 'THIN',
            rec.noH1 && 'NOH1',
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
const noH1 = report.filter((r) => r.noH1);
console.log(`  no h1:         ${noH1.length}${noH1.length ? '  ' + [...new Set(noH1.map((r) => r.name))].join(', ') : ''}`);
console.log(`  h-overflow:    ${overflow.length}${overflow.length ? '  ' + overflow.map((r) => `${r.name}(+${r.overflowX})`).join(', ') : ''}`);
console.log(`  js errors:     ${n('errors')}`);
console.log(`  small taps:    ${n('smallTargets')}`);
console.log(`  clipped text:  ${n('clipped')}`);
console.log(`  low contrast:  ${n('lowContrast')}`);
