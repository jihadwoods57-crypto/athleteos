/* One team, one set of numbers (review pass 2026-09-23, C-M1 / C-M3).
   Home's legend, the Inbox briefing, Insights' read and the Roster's chips and bands used to each
   count for themselves, in four vocabularies: "1 need attention · 2 overdue" on Home beside
   "2 below the bar" in the Inbox, and the same athlete red "Overdue" on Home and amber "Building"
   on the Roster. This test loads ONE seeded team through the real loadBook, renders the four
   screens, and asserts they print the same counts in the same words, and that the requirement
   total comes from the standard, not from whichever day rows exist. */
import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/* ---- a frozen clock: Tuesday 2026-09-22, 3:00 PM local. Breakfast (9:30 AM) and lunch (2:00 PM)
   are past due, dinner and recovery are not, and the Mon/Wed/Fri weigh-in is off today. ---- */
const FIXED = new Date(2026, 8, 22, 15, 0, 0).getTime();
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
}
globalThis.Date = FrozenDate;

/* ---- DOM + storage stubs (module-eval only) ---- */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const store = new Map();
globalThis.window = { location: { hash: '' }, addEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), __render() {} };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = globalThis.window.location;

const TODAY = '2026-09-22';
const YESTERDAY = '2026-09-21';
const MEMBERS = [
  { athlete_id: 'a1', athlete_name: 'Avery One', position: 'LB', room_id: null },
  { athlete_id: 'a2', athlete_name: 'Tyrek Two', position: 'LB', room_id: null },
  { athlete_id: 'a3', athlete_name: 'Cam Three', position: 'WR', room_id: null },
  { athlete_id: 'a4', athlete_name: 'Dre Four', position: 'WR', room_id: null },
  { athlete_id: 'a5', athlete_name: 'Eli Five', position: 'DB', room_id: null },
  { athlete_id: 'a6', athlete_name: 'Finn Six', position: 'DB', room_id: null },
];
const DAYS = [
  // a1: both meals in, 92 -> on standard. 2 of 2.
  { athlete_id: 'a1', date: TODAY, score: 92, grade: 'A', tasks: [], meals: { breakfast: true, lunch: true } },
  // a2: breakfast only, 64 -> OVERDUE (lunch), even though 64 is a "Building" score. 1 of 2.
  { athlete_id: 'a2', date: TODAY, score: 64, grade: 'D', tasks: [], meals: { breakfast: true } },
  // a3: both meals in, 71, dinner still open -> IN PROGRESS (no verdict until the day settles,
  //     the athlete Home's own rule; coach score truth 2026-09-24). 2 of 2.
  { athlete_id: 'a3', date: TODAY, score: 71, grade: 'C', tasks: [], meals: { breakfast: true, lunch: true } },
  // a4: NO day row today (logged yesterday) -> overdue on both. 0 of 2. The old row-sum left
  //     this athlete out of the requirement total entirely.
  { athlete_id: 'a4', date: YESTERDAY, score: 80, grade: 'B', tasks: [], meals: { breakfast: true, lunch: true } },
  // a5: excused today (below) -> excused, out of the totals.
  // a6: both meals in, score not resolved yet -> needs review. 2 of 2.
  { athlete_id: 'a6', date: TODAY, score: null, grade: null, tasks: [], meals: { breakfast: true, lunch: true } },
];
const MEALS = [{ id: 'm1', athlete_id: 'a1', day_date: TODAY, type: 'lunch', logged_at: `${TODAY}T12:30:00`, photo_path: null, name: 'Bowl', protein: 40, kcal: 700, quality: 80 }];
const EXCEPTIONS = [{ id: 'x1', athlete_id: 'a5', starts_on: TODAY, ends_on: TODAY, reason: 'Travel' }];

function table(name) {
  const rowsFor = () => {
    if (name === 'teams') return [{ id: 't1', name: 'Northside Prep', join_code: 'NPREP' }];
    if (name === 'days') return DAYS;
    if (name === 'meals') return MEALS;
    if (name === 'athlete_exceptions') return EXCEPTIONS;
    if (name === 'profiles') return [];
    if (name === 'team_staff') return [{ role: 'head_coach', scope_kind: null, scope_value: null }];
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
    if (fn === 'team_roster') return { data: MEMBERS, error: null };
    if (fn === 'team_activity_batch') return { data: MEALS, error: null };
    return { data: [], error: null };
  },
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  functions: { invoke: async () => ({ data: null, error: null }) },
};

const { loadAllScreens } = await import('./screens/index.js');
const screens = await loadAllScreens();
const { S, RT } = await import('./state.js');
const { CD, loadBook, entriesFor } = await import('./coach-data.js');
const { teamCounts, requirementsDue } = await import('./team-count.js');

RT.userId = 'u1';
RT.authRole = 'coach';
await loadBook(true, 'team');

const EXPECT = { onStandard: 1, inProgress: 1, attention: 1, overdue: 2, noActivity: 0, excused: 1, reqDue: 10, reqDone: 7 };
const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the seeded team resolves to the statuses the fixture describes', () => {
  const byId = Object.fromEntries(entriesFor({ kind: 'team', value: null }).map(e => [e.row.athleteId, e.status.key]));
  assert.deepStrictEqual(byId, {
    a1: 'on_standard', a2: 'overdue', a3: 'in_progress', a4: 'overdue', a5: 'excused', a6: 'needs_review',
  });
});

test('teamCounts: one count, requirements totalled from the standard with excused left out', () => {
  const c = teamCounts(entriesFor({ kind: 'team', value: null }));
  for (const [k, v] of Object.entries(EXPECT)) assert.strictEqual(c[k], v, `${k}`);
  assert.strictEqual(c.total, 6);
  assert.strictEqual(c.scored, 3, 'a1, a2, a3: a pending score and a missing row add no score');
});

test('requirementsDue: an athlete with no day row still owes every past-due item', () => {
  const e = entriesFor({ kind: 'team', value: null }).find(x => x.row.athleteId === 'a4');
  assert.strictEqual(e.row.loggedToday, false);
  assert.deepStrictEqual(requirementsDue(e), { due: 2, done: 0 });
});

test('Home, Inbox, Insights and Roster print the same numbers in the same words', () => {
  const home = strip(screens['coach-home'].render({ sub: null, S }));
  const inbox = strip(screens['coach-inbox'].render({ sub: null, S }));
  const insights = strip(screens['coach-insights'].render({ sub: null, S }));
  const roster = strip(screens['coach-roster'].render({ sub: null, S }));

  // Home's legend and Insights' legend are the same buckets.
  for (const text of [home, insights]) {
    assert.match(text, /\b1 on standard\b/);
    assert.match(text, /\b1 in progress\b/);
    assert.match(text, /\b1 needs attention\b/);
    assert.match(text, /\b2 overdue\b/);
    assert.match(text, /\b1 excused\b/);
    assert.doesNotMatch(text, /no activity/, 'nobody is in the no-activity bucket, and excused is not lumped into it');
  }
  // The Inbox briefing reads the same counts.
  assert.match(inbox, /\b2 overdue\b/);
  assert.match(inbox, /\b1 in progress\b/);
  assert.match(inbox, /\b1 needs attention\b/);
  assert.doesNotMatch(inbox, /below the bar/);
  // The Roster: status chips and status bands, one vocabulary, same counts.
  assert.match(roster, /Overdue 2/);
  assert.match(roster, /In progress 1/);
  assert.doesNotMatch(roster, /Below standard/, 'no verdict while dinner is still open');
  assert.match(roster, /Needs review 1/);
  assert.match(roster, /On standard 1/);
  assert.doesNotMatch(roster, /OnStandard|Locked In|Building|No log today/, 'no tier bands under status chips; the brand is never a tier label');
  // Home's requirement line is the standard's total, not the row sum.
  assert.match(home, /7 of 10 requirements due so far are in/);
});

test('the same athlete wears the same word on Home and on the Roster', () => {
  const homeHtml = screens['coach-home'].render({ sub: null, S });
  const rosterHtml = screens['coach-roster'].render({ sub: null, S });
  // Tyrek (64, lunch overdue): the priority card says Overdue, never a tier name.
  const card = homeHtml.slice(homeHtml.indexOf('Tyrek Two'));
  assert.match(card.slice(0, 600), /status-pill r">Overdue</);
  // On the Roster he sits under the Overdue band, which comes before any other band.
  const overdueBand = rosterHtml.indexOf('Overdue</span>');
  const tyrek = rosterHtml.indexOf('Tyrek Two');
  const nextBand = rosterHtml.indexOf('<header class="ro-band"', overdueBand + 1);
  assert.ok(overdueBand > 0 && tyrek > overdueBand && (nextBand === -1 || tyrek < nextBand), 'Tyrek is in the Overdue band');
});

test('C-B9: "Adjust a schedule" opens Select every time it is chosen, never on a plain return', async () => {
  const { armRosterTask } = await import('./screens/coach-roster.js');
  const roster = (sub) => screens['coach-roster'].render({ sub, S });
  const selecting = (html) => html.includes('class="aud-box"');
  armRosterTask('excuse');
  assert.ok(selecting(roster('excuse')), 'first choice opens Select');
  assert.ok(selecting(roster('excuse')), 'a repaint keeps it');
  assert.ok(!selecting(roster(null)), 'a plain return to the Roster tab clears the Select the intent opened');
  assert.ok(!selecting(roster('excuse')), 'the old hash alone does not re-open it');
  assert.match(roster('excuse'), /Tap Select, then the/, 'and says how, instead of pointing at checkboxes that are not there');
  armRosterTask('excuse');
  assert.ok(selecting(roster('excuse')), 'choosing it again opens Select again');
  roster(null);
});

test('C-M3: the Roster chips read teamCounts()', () => {
  const src = readFileSync(new URL('./screens/coach-roster.js', import.meta.url), 'utf8');
  assert.match(src, /const statusCount = teamCounts\(entries\)\.byStatus;/);
});

test.after(() => { globalThis.Date = RealDate; });
void CD;
