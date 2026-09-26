/* Phase C (dining hall menus), the staff side: who manages halls (the database's role list),
 * how a day reads (draft, published, changes waiting), the hours editor, the publish gating on the
 * day screen (a Publish button only over a draft, never for view-only staff), and the coach Home
 * door. Run: node --test proto/redesign-2026-07/js/dining-staff.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const mem = new Map();
const fakeStore = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => {}, localStorage: fakeStore,
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = fakeStore;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const SM = await import('./dining-staff-model.js');
const { TARGET_ROLES } = await import('./staff-access.js');
const DC = await import('./dining-coach.js');
await import('./screens/dining-halls.js');   // the screens module loads without a DOM
const { DEFAULT_HOURS } = await import('./dining-menu.js');

test("WHO: the standards editors, the same list as 0255's can_set_team_phase; fails closed", () => {
  const caps = { standards: 1 };
  for (const r of ['head_coach', 'coordinator', 'assistant', 'nutritionist', 's_and_c', 'team_admin']) assert.equal(SM.canManageDining(r, caps), true, r);
  for (const r of ['readonly', 'position_coach', 'athletic_trainer', null, undefined, '']) assert.equal(SM.canManageDining(r, caps), false, String(r));
  assert.equal(SM.canManageDining('head_coach', { standards: 0 }), false, 'a lapsed plan loses the writes (0223)');
  assert.equal(SM.canManageDining('head_coach', caps, 'practice'), false, 'teams only');
  // The database's list, read from the migration, is the client's list.
  const mig = readFileSync(join(ROOT, 'supabase', 'migrations', '0252_season_phase.sql'), 'utf8');
  const m = /create or replace function can_set_team_phase[\s\S]*?s\.role::text in \(([^)]*)\)/.exec(mig);
  const dbRoles = m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort();
  assert.deepEqual(dbRoles, [...TARGET_ROLES].sort());
  const c = readFileSync(join(ROOT, 'supabase', 'migrations', '0255_dining_halls.sql'), 'utf8');
  for (const t of ['dining_halls_insert', 'dining_halls_update', 'dining_halls_delete', 'dining_uploads_insert', 'dining_menus_update', 'dining_menus_delete']) {
    assert.match(c, new RegExp(`create policy ${t} [\\s\\S]*?can_set_team_phase`), t);
  }
});

test('DAYS: draft, published, changes waiting; the list line; what the day screen shows', () => {
  const rows = [
    { menu_date: '2026-09-28', period: 'lunch', status: 'published', items: [{ name: 'A' }] },
    { menu_date: '2026-09-28', period: 'dinner', status: 'draft', items: [{ name: 'B' }] },
    { menu_date: '2026-09-29', period: 'lunch', status: 'draft', items: [{ name: 'C' }] },
    { menu_date: '2026-09-30', period: 'breakfast', status: 'published', items: [{ name: 'D' }] },
    { menu_date: '2026-09-30', period: 'nope', status: 'published', items: [] },
  ];
  const g = SM.dayGroups(rows);
  assert.deepEqual(g.map((x) => [x.date, SM.dayState(x)]), [['2026-09-28', 'changes'], ['2026-09-29', 'draft'], ['2026-09-30', 'published']]);
  assert.equal(SM.dayPeriods(g[0]), 'Lunch, Dinner');
  assert.equal(SM.todayLine(rows, '2026-09-28'), 'Today: Lunch live · changes waiting');
  assert.equal(SM.todayLine(rows, '2026-09-29'), 'Today: a draft is waiting to be published');
  assert.equal(SM.todayLine(rows, '2026-10-09'), 'No menu for today');
  assert.equal(SM.shownRow({ draft: { id: 'd' }, published: { id: 'p' } }).id, 'd', 'staff edit the draft');
  assert.equal(SM.fmtDay('2026-09-28'), 'Mon, Sep 28');
  assert.equal(SM.itemMeta({ name: 'X', station: 'Grill', kind: 'protein', per_serving: { protein: 35, kcal: 280 } }), 'Grill · Protein · 35g protein · 280 cal');
  assert.equal(SM.itemMeta({ name: 'X', kind: 'veg', per_serving: null }), 'Vegetable · No figures');
});

test('HOURS: lines read plainly; the editor round-trips and refuses nonsense in plain words', () => {
  assert.deepEqual(SM.hoursLines(DEFAULT_HOURS), ['Breakfast · Every day · 7 AM to 10 AM', 'Lunch · Every day · 11 AM to 2 PM', 'Dinner · Every day · 5 PM to 8 PM']);
  assert.deepEqual(SM.hoursLines([]), ['No hours set']);
  assert.equal(SM.daysLabel([1, 2, 3, 4, 5]), 'Mon to Fri');
  assert.equal(SM.daysLabel([6, 0]), 'Weekends');
  assert.equal(SM.daysLabel([1, 3, 5]), 'Mon, Wed, Fri');
  assert.equal(SM.daysLabel([0, 1, 2, 3, 4]), 'Sun to Thu');
  const form = SM.hoursForm(DEFAULT_HOURS);
  assert.equal(form.length, 4);
  assert.equal(form[3].on, false, 'late is off by default');
  assert.deepEqual(SM.hoursFromForm(form).hours, DEFAULT_HOURS);
  assert.match(SM.hoursFromForm([{ period: 'lunch', on: true, from: '14:00', to: '11:00', days: [1] }]).error, /Lunch has to end after it starts/);
  assert.match(SM.hoursFromForm([{ period: 'dinner', on: true, from: '17:00', to: '20:00', days: [] }]).error, /at least one day/);
  assert.match(SM.hoursFromForm([{ period: 'late', on: true, from: '', to: '23:00', days: [1] }]).error, /start and an end/);
});

test('MESSAGES: every failure says what happened in plain words; a read says what to do next', () => {
  for (const c of ['limit', 'capacity', 'plan_required', 'forbidden', 'too_large', 'bad_file', 'too_long', 'ai_consent_required', 'upload', 'x']) {
    const line = SM.uploadErrorLine(c);
    assert.ok(line.length > 10 && !/\u2014/.test(line), c);
  }
  assert.equal(SM.readResultLine({ ok: true, entries: 6, days: ['a', 'b', 'c'], items: 41 }), 'Read 3 days and 41 items. Review each day, then publish it.');
  assert.match(SM.readResultLine({ ok: true, entries: 0, days: [], items: 0 }), /couldn't find a menu/);
});

test('PUBLISH GATING: Publish only over a draft, Unpublish only over a live menu, nothing for view-only staff', () => {
  const g = (hasDraft, hasPublished) => ({ date: '2026-09-28', periods: {}, hasDraft, hasPublished });
  assert.deepEqual(SM.dayControls(g(true, false), true), { edit: true, publish: true, unpublish: false, discard: true });
  assert.deepEqual(SM.dayControls(g(false, true), true), { edit: true, publish: false, unpublish: true, discard: false });
  assert.deepEqual(SM.dayControls(g(true, true), true), { edit: true, publish: true, unpublish: true, discard: true });
  for (const role of ['readonly', 'position_coach', 'athletic_trainer', null]) {
    const can = SM.canManageDining(role, { standards: 1 });
    assert.deepEqual(SM.dayControls(g(true, true), can), { edit: false, publish: false, unpublish: false, discard: false }, String(role));
  }
  const src = readFileSync(join(HERE, 'screens', 'dining-halls.js'), 'utf8');
  assert.match(src, /const C = dayControls\(g, manage\(\)\);/);
  assert.match(src, /\$\{C\.publish \? `<button type="button" class="btn primary" id="dh-publish"/);
});

test('PUBLISH GATING in the source: the screens publish only through the RPCs, never by writing a status', () => {
  const src = readFileSync(join(HERE, 'screens', 'dining-halls.js'), 'utf8');
  assert.match(src, /sb\.rpc\('publish_dining_day', \{ p_hall: hallId, p_date: date \}\)/);
  assert.match(src, /sb\.rpc\('unpublish_dining_day', \{ p_hall: hallId, p_date: date \}\)/);
  assert.doesNotMatch(src, /status: 'published'/, 'no client write ever sets a published status');
  assert.match(src, /status: 'draft', items \}/, 'an edit to a live day makes a DRAFT copy');
  assert.match(src, /ensureAiConsent\(RT\.userId, \{ role: RT\.authRole \|\| 'coach', ask: true \}\)/, 'the uploader says yes to AI first');
  assert.match(src, /invokeWithDeadline\('dining-menu', \{ uploadId: id \}/, 'one read per upload: the function is asked with the upload id only');
});

test('COACH HOME: the door shows only for editors, and says what is waiting', () => {
  assert.deepEqual(DC.diningValue({ halls: 0 }), { text: 'Add your dining hall menus', unset: true, go: 'Set up' });
  assert.equal(DC.diningValue({ halls: 2, live: 2 }).text, "2 halls · Today's menu is live");
  assert.equal(DC.diningValue({ halls: 1, drafts: 1 }).text, '1 hall · A draft is waiting');
  assert.equal(DC.diningValue({ halls: 1 }).text, '1 hall · No menu for today');
  const home = readFileSync(join(HERE, 'screens', 'coach-home.js'), 'utf8');
  assert.match(home, /<div id="dh-slot"><\/div>/);
  assert.match(home, /import\('\.\.\/dining-coach\.js'\)\.then\(\(m\) => m\.paintDining\(root\)\)/, 'lazy, never in the boot graph');
  const src = readFileSync(join(HERE, 'dining-coach.js'), 'utf8');
  assert.match(src, /canManageDining\(CD\.extras\.myRole, CD\.caps, CD\.kind\)/);
  // Routes are registered, one per line, lazy.
  const idx = readFileSync(join(HERE, 'screens', 'index.js'), 'utf8');
  for (const r of ['dining-halls', 'dining-hall', 'dining-day']) assert.match(idx, new RegExp(`^\\s*'${r}': lazy\\(dining, `, 'm'));
});
