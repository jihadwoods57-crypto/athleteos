/* End-to-end for the operator book: run the REAL loadBook against a stub supabase client, once
   as a coach's team and once as a trainer's practice, then render every shared operator screen
   off the result. This is the regression net for the generalization — it proves the coach path
   is unchanged and the trainer path produces the same row shape rather than a degraded one. */
import assert from 'node:assert';

/* ---- DOM + storage stubs (module-eval only; no screen is mounted) ---- */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const store = new Map();
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = globalThis.window.location;

/* Must match roles.js `iso()` — LOCAL date parts, not toISOString(). On a machine behind UTC the
   two disagree and "today's row" silently resolves to yesterday's score. */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = iso(new Date());
const YESTERDAY = iso(new Date(Date.now() - 864e5));

/* ---- Fixtures: the same two athletes reachable either way. A practice roster carries NO
       position (practice_roster hardcodes it null), which is the shape difference that matters. ---- */
const TEAM_MEMBERS = [
  { athlete_id: 'a1', athlete_name: 'Devin Cole', position: 'LB', room_id: null },
  { athlete_id: 'a2', athlete_name: 'Sam Rivera', position: 'WR', room_id: null },
];
const PRACTICE_MEMBERS = [
  { athlete_id: 'a1', athlete_name: 'Devin Cole', position: null, room_id: null },
  { athlete_id: 'a2', athlete_name: 'Sam Rivera', position: null, room_id: null },
];
const DAYS = [
  { athlete_id: 'a1', date: TODAY, score: 62, grade: 'C', tasks: [{ id: 'breakfast', done: true }, { id: 'dinner', done: false }] },
  { athlete_id: 'a1', date: YESTERDAY, score: 88, grade: 'B', tasks: [] },
  { athlete_id: 'a2', date: TODAY, score: 91, grade: 'A', tasks: [{ id: 'breakfast', done: true }] },
  { athlete_id: 'a2', date: YESTERDAY, score: 74, grade: 'C', tasks: [] },
];
const MEALS = [{ id: 'm1', athlete_id: 'a1', day_date: TODAY, type: 'breakfast', logged_at: `${TODAY}T08:12:00Z`, photo_path: null, name: 'Eggs', protein: 30, kcal: 420, quality: 4 }];

let KIND = 'team';   // flipped per pass; the stub answers as that book

/* Minimal chainable stand-in for supabase-js: every filter returns `this`, and awaiting the
   builder resolves { data, error }. Enough for roles.js's read paths. */
function table(name) {
  const rowsFor = () => {
    if (name === 'teams') return KIND === 'team' ? [{ id: 't1', name: 'Northside Prep', join_code: 'NPREP' }] : [];
    if (name === 'practices') return KIND === 'practice' ? [{ id: 'p1', name: 'Rivera Strength', join_code: 'RIV77', owner_id: 'u1', handle: 'rivera' }] : [];
    if (name === 'days') return DAYS;
    if (name === 'meals') return MEALS;
    if (name === 'profiles') return [{ id: 'a1', timezone: 'America/New_York' }, { id: 'a2', timezone: null }];
    return [];
  };
  const b = {
    select() { return b; }, eq() { return b; }, gte() { return b; }, lte() { return b; },
    in() { return b; }, is() { return b; }, not() { return b; }, neq() { return b; },
    order() { return b; }, limit() { return b; },
    maybeSingle() { return Promise.resolve({ data: rowsFor()[0] || null, error: null }); },
    insert() { return Promise.resolve({ data: null, error: null }); },
    update() { return Promise.resolve({ data: null, error: null }); },
    delete() { return Promise.resolve({ data: null, error: null }); },
    upsert() { return Promise.resolve({ data: null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: rowsFor(), error: null }).then(res, rej); },
  };
  return b;
}
globalThis.window.sb = {
  from: table,
  async rpc(fn) {
    if (fn === 'team_roster') return { data: TEAM_MEMBERS, error: null };
    if (fn === 'practice_roster') return { data: PRACTICE_MEMBERS.map(m => ({ client_id: m.athlete_id, client_name: m.athlete_name })), error: null };
    return { data: [], error: null };
  },
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  functions: { invoke: async () => ({ data: null, error: null }) },
};

const { screens } = await import('./screens/index.js');
const { S, RT } = await import('./state.js');
const { CD, loadBook, loadAthleteProfile, entriesFor, getScope } = await import('./coach-data.js');

RT.userId = 'u1';

/* Shared operator modules — each must render for a coach AND a trainer. */
const OPERATOR_SCREENS = ['coach-home', 'coach-roster', 'coach-create', 'coach-inbox', 'coach-athlete'];
const snapshots = {};
const snapshotStatus = {};

for (const kind of ['team', 'practice']) {
  KIND = kind;
  RT.authRole = kind === 'practice' ? 'trainer' : 'coach';
  await loadBook(true, kind);

  /* ---- the book itself ---- */
  assert.strictEqual(CD.kind, kind, `CD.kind must be ${kind}`);
  assert.ok(CD.roster, `${kind}: roster must load`);
  assert.strictEqual(CD.roster.offline, false, `${kind}: a good fetch must not read as offline`);
  assert.strictEqual(CD.roster.kind, kind);

  // THE ALIAS: teams and book must be the SAME array object, or every shipped coach screen's
  // CD.roster.teams[0].id read silently returns undefined on one of the two paths.
  assert.strictEqual(CD.roster.teams, CD.roster.book, `${kind}: teams must alias book (same reference)`);
  assert.strictEqual(CD.roster.book.length, 1, `${kind}: exactly one book`);
  assert.strictEqual(CD.roster.book[0].id, kind === 'team' ? 't1' : 'p1');

  /* ---- rows: a practice book must be as rich as a team book ---- */
  assert.strictEqual(CD.roster.rows.length, 2, `${kind}: both athletes present`);
  const devin = CD.roster.rows.find(r => r.athleteId === 'a1');
  assert.ok(devin, `${kind}: Devin must be in the book`);
  assert.strictEqual(devin.score, 62, `${kind}: today's real score`);
  assert.strictEqual(devin.loggedToday, true);
  // These four were ALL missing from the trainer book before Slice A.
  assert.ok(Array.isArray(devin.scoreHistory) && devin.scoreHistory.length >= 2,
    `${kind}: scoreHistory drives the sparkline — a 1-day fetch left it empty`);
  assert.strictEqual(devin.scoreHistory[0].date, YESTERDAY, `${kind}: history must be oldest-first`);
  assert.strictEqual(devin.lastMealAt, `${TODAY}T08:12:00Z`, `${kind}: lastMealAt drives staleness`);
  assert.strictEqual(devin.timezone, 'America/New_York', `${kind}: timezone drives athlete-local overdue`);
  // Rows sort by score descending, both books.
  assert.deepStrictEqual(CD.roster.rows.map(r => r.score), [91, 62], `${kind}: rows sort by score`);

  /* ---- capability gating actually took effect ---- */
  assert.ok(CD.extras, `${kind}: extras must be populated`);
  for (const k of ['sets', 'groups', 'exceptions', 'interventions', 'rooms']) {
    assert.ok(Array.isArray(CD.extras[k]), `${kind}: extras.${k} must be an array, never undefined`);
  }
  if (kind === 'practice') {
    // Team-owned tables are not fetched for a practice — the shape survives, the data is honestly empty.
    assert.deepStrictEqual(CD.extras.sets, [], 'a practice has no requirement sets until 0136');
    assert.deepStrictEqual(CD.extras.rooms, [], 'rooms are a team concept');
    assert.strictEqual(CD.extras.myRole, null, 'staff roles are a team concept');
    assert.strictEqual(CD.caps.standards, 0);
    assert.strictEqual(CD.caps.offers, 1, 'a trainer keeps their monetization surface');
  } else {
    assert.strictEqual(CD.caps.standards, 1);
    assert.strictEqual(CD.caps.offers, 0, 'a coach must not get the trainer monetization surface');
  }

  /* ---- the status engine runs on either book ---- */
  const KNOWN = ['excused', 'overdue', 'needs_review', 'below_standard', 'due_soon', 'no_activity', 'on_standard'];
  const entries = entriesFor(getScope());
  assert.ok(Array.isArray(entries) && entries.length === 2, `${kind}: entriesFor must resolve both athletes`);
  for (const e of entries) {
    assert.ok(e.status && KNOWN.includes(e.status.key), `${kind}: unknown status '${e.status && e.status.key}'`);
    assert.ok(e.status.label && e.status.detail, `${kind}: every status needs a label and a detail`);
  }
  // Which key wins is clock-dependent, so record it and compare the two books below — that
  // equality is the real invariant: the same data must score the same either way.
  snapshotStatus[kind] = Object.fromEntries(entries.map(e => [e.row.athleteId, e.status.key]));

  /* ---- every shared screen renders ---- */
  // The deep dive renders a skeleton until its profile lands, so load it for real first —
  // that also exercises loadAthleteProfile's own capability gating on either book.
  await loadAthleteProfile('a1', true);
  assert.ok(CD.profile && CD.profile.athleteId === 'a1', `${kind}: the athlete profile must load`);
  assert.strictEqual(CD.profile.offline, false, `${kind}: a good profile fetch must not read as offline`);
  if (kind === 'practice') {
    assert.deepStrictEqual(CD.profile.notes, [], 'a practice must not fetch team-owned coach notes');
    assert.deepStrictEqual(CD.profile.interventions, [], 'a practice must not fetch team-owned interventions');
  }
  snapshots[kind] = {};
  for (const route of OPERATOR_SCREENS) {
    const mod = screens[route];
    let html;
    try {
      html = mod.render({ sub: route === 'coach-athlete' ? 'a1' : null, S });
    } catch (e) {
      assert.fail(`${kind}/${route} threw during render: ${e.message}`);
    }
    assert.strictEqual(typeof html, 'string', `${kind}/${route} must render a string`);
    assert.ok(html.length > 200, `${kind}/${route} rendered suspiciously little (${html.length} chars)`);
    assert.ok(!/undefined|\[object Object\]|NaN/.test(html), `${kind}/${route} leaked a raw undefined/NaN into the DOM`);
    snapshots[kind][route] = html;
  }
  // Real names must reach the screen — proof it rendered the BOOK, not an empty state.
  assert.ok(snapshots[kind]['coach-roster'].includes('Devin Cole'), `${kind}: the roster must show real names`);
  assert.ok(snapshots[kind]['coach-athlete'].includes('Devin Cole'), `${kind}: the profile must show the real athlete`);
}

/* ---- THE core invariant: identical athlete data scores identically on either book ----
   A practice has no requirement sets, so it resolves the built-in CATALOG; a team here has none
   configured either, so it resolves the same one. Same inputs, same verdict. If this ever
   diverges, a trainer and a coach looking at the same athlete would disagree. */
assert.deepStrictEqual(snapshotStatus.practice, snapshotStatus.team,
  'the same athlete data must produce the same status on a team book and a practice book');

/* ---- cross-book differences that SHOULD exist ---- */
{
  // The create menu is capability-filtered. Assert on the ROUTE, not the prose — the trainer's
  // explanatory sidebox mentions announcements by name while correctly not offering them.
  const teamMenu = snapshots.team['coach-create'];
  const practiceMenu = snapshots.practice['coach-create'];
  for (const route of ['coach-announce', 'coach-assign', 'coach-plan', 'coach-profile/staff']) {
    assert.ok(teamMenu.includes(`data-go="${route}"`), `a coach must be offered ${route}`);
    assert.ok(!practiceMenu.includes(`data-go="${route}"`), `a trainer must NOT be offered ${route} (no practice-owned table until 0136)`);
  }
  assert.ok(practiceMenu.includes('data-go="trainer-roster"'), 'a trainer keeps "message a client"');
  assert.ok(practiceMenu.includes('Built for teams'), 'a trainer must be told WHY the menu is shorter, not just handed a stub');
  // Position/unit only exists on a team book.
  assert.ok(snapshots.team['coach-roster'].includes('LB'), 'a team roster shows units');

  /* RISK E.1 — the priority card's Assign button writes into requirement_assignments, whose
     team_id FKs to teams. On a practice book the id is a practice uuid, so the insert would
     violate the FK — and logIntervention swallows the error, so it would fail SILENTLY and the
     card would just never clear. The button must not exist on a practice book at all. */
  const teamHome = snapshots.team['coach-home'];
  const practiceHome = snapshots.practice['coach-home'];
  assert.ok(teamHome.includes('data-passign='), 'a coach keeps the Assign action');
  assert.ok(!practiceHome.includes('data-passign='), 'a trainer must NOT be shown Assign before 0136');
  // Nudge is a push, not a team-table write — it survives on both.
  assert.ok(teamHome.includes('data-pnudge=') && practiceHome.includes('data-pnudge='),
    'Nudge is role-agnostic and must survive on both books');

  /* Operator vocabulary — a trainer must never be addressed as a coach or told they have a team. */
  assert.ok(practiceHome.includes('All clients'), 'a trainer sees client vocabulary');
  assert.ok(practiceHome.includes('Client priorities'), 'a trainer sees "Client priorities"');
  assert.ok(!/Entire team|Coach priorities|setting up your team/.test(practiceHome),
    'no team vocabulary may leak onto a practice book');
  assert.ok(teamHome.includes('Entire team') && teamHome.includes('Coach priorities'),
    'the coach vocabulary is unchanged');
  assert.ok(practiceHome.includes('Rivera Strength'), 'the practice name heads the trainer dashboard');
  assert.ok(teamHome.includes('Northside Prep'), 'the team name heads the coach dashboard');

  /* Every OTHER control backed by a team-owned table must be absent on a practice book too.
     Each of these would otherwise write a practice uuid into a `team_id` column that FKs to
     teams, and roles.js swallows the resulting error — so the user gets a phantom
     "check your connection" instead of a real one. */
  // Roster: the group control is in the default render. (The bulk-action bar only paints in
  // multi-select mode; its Assign/Group/Excuse buttons carry the same CD.caps guards.)
  const teamRoster = snapshots.team['coach-roster'];
  const practiceRoster = snapshots.practice['coach-roster'];
  assert.ok(teamRoster.includes('data-groups'), 'a coach keeps the ＋ Group control');
  assert.ok(!practiceRoster.includes('data-groups'), 'a trainer must NOT be shown ＋ Group before 0136');
  assert.ok(practiceRoster.includes('data-selmode'), 'multi-select still works on a practice book');
  // Roster vocabulary follows the book too.
  assert.ok(practiceRoster.includes('Search clients') && !practiceRoster.includes('Search athletes'),
    'a trainer searches clients, not athletes');
  assert.ok(teamRoster.includes('Search athletes'), 'the coach roster copy is unchanged');

  // The athlete deep-dive drops the two sections whose tables are team-owned.
  const teamAthlete = snapshots.team['coach-athlete'];
  const practiceAthlete = snapshots.practice['coach-athlete'];
  for (const sec of ['requirements', 'notes']) {
    assert.ok(teamAthlete.includes(`data-psec="${sec}"`), `a coach keeps the ${sec} section`);
    assert.ok(!practiceAthlete.includes(`data-psec="${sec}"`), `a trainer must NOT get the ${sec} section before 0136`);
  }
  for (const sec of ['overview', 'today', 'score', 'activity', 'conversation']) {
    assert.ok(practiceAthlete.includes(`data-psec="${sec}"`), `a trainer must keep the ${sec} section (can_view already grants it)`);
  }
}

console.log('operator book (team + practice): all assertions passed');
