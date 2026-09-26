// Nia's dining hall context (phase C): the athlete's today and clock, the reads it makes (their
// active teams, today, PUBLISHED only), the Intuitive rail, and where meal-chat uses it (the
// athlete's own turns only). Run: npm run test:fn
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minuteOf, athleteToday, loadDiningToday, diningContextFor } from './dining-context.mjs';
import { DEFAULT_HOURS } from './dining-menu.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-09-28T17:00:00Z');

/** A tiny PostgREST stand-in that records every filter it is given. */
function fakeService(tables) {
  const log = [];
  const from = (t) => {
    const q = { t, filters: [] };
    log.push(q);
    let rows = (tables[t] || []).slice();
    const api = {
      select: () => api,
      eq: (c, v) => { q.filters.push(['eq', c, v]); rows = rows.filter((r) => r[c] === v); return api; },
      in: (c, vs) => { q.filters.push(['in', c, vs]); rows = rows.filter((r) => vs.includes(r[c])); return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return api;
  };
  return { from, log };
}

const TABLES = {
  team_members: [{ athlete_id: 'a1', team_id: 't1', status: 'active' }, { athlete_id: 'a1', team_id: 't0', status: 'left' }],
  dining_menus: [
    { team_id: 't1', hall_id: 'h1', menu_date: '2026-09-28', period: 'lunch', status: 'published', items: [{ name: 'Grilled chicken', per_serving: { protein: 35 } }] },
    { team_id: 't1', hall_id: 'h1', menu_date: '2026-09-28', period: 'dinner', status: 'draft', items: [{ name: 'Secret draft steak' }] },
    { team_id: 't1', hall_id: 'h1', menu_date: '2026-09-29', period: 'lunch', status: 'published', items: [{ name: 'Tomorrow tacos' }] },
    { team_id: 't0', hall_id: 'h0', menu_date: '2026-09-28', period: 'lunch', status: 'published', items: [{ name: 'Old team pasta' }] },
  ],
  dining_halls: [{ id: 'h1', name: 'Knights Plaza', hours: DEFAULT_HOURS }, { id: 'h0', name: 'Old Hall', hours: DEFAULT_HOURS }],
};

test("the athlete's clock and calendar: parsed strictly, and a date far from the server's is refused", () => {
  assert.equal(minuteOf('3:40 PM'), 940);
  assert.equal(minuteOf('12:05 AM'), 5);
  assert.equal(minuteOf('12:00 PM'), 720);
  assert.equal(minuteOf('25:00'), null);
  assert.equal(athleteToday({ localDate: '2026-09-28' }, NOW), '2026-09-28');
  assert.equal(athleteToday({ localDate: '2026-09-27' }, NOW), '2026-09-27', 'a day behind UTC is the Americas in the evening');
  assert.equal(athleteToday({ localDate: '2026-09-20' }, NOW), null, 'a stale or forged date');
  assert.equal(athleteToday({ localDate: 'today' }, NOW), null);
  assert.equal(athleteToday(null, NOW), null);
});

test("the reads: the athlete's ACTIVE teams, today's date, PUBLISHED rows only", async () => {
  const svc = fakeService(TABLES);
  const got = await loadDiningToday(svc, 'a1', '2026-09-28');
  assert.deepEqual(got.menus.map((m) => m.items[0].name), ['Grilled chicken']);
  const menusQ = svc.log.find((q) => q.t === 'dining_menus');
  assert.deepEqual(menusQ.filters, [['in', 'team_id', ['t1']], ['eq', 'menu_date', '2026-09-28'], ['eq', 'status', 'published']]);
  assert.deepEqual(svc.log.find((q) => q.t === 'team_members').filters, [['eq', 'athlete_id', 'a1'], ['eq', 'status', 'active']]);
  assert.equal(await loadDiningToday(svc, 'nobody', '2026-09-28'), null, 'no team, no read of menus');
  assert.equal(await loadDiningToday(null, 'a1', '2026-09-28'), null);
});

test('the block: remaining periods, figures only for a numbers style, nothing without a menu', async () => {
  const at = (athlete, style) => diningContextFor(fakeService(TABLES), 'a1', athlete, style, { serverNow: NOW });
  const noon = await at({ localDate: '2026-09-28', localTime: '12:10 PM' }, 'structured');
  assert.match(noon, /Knights Plaza, lunch \(11 AM to 2 PM\): Grilled chicken \(about 35g protein\)/);
  assert.doesNotMatch(noon, /Secret draft steak|Tomorrow tacos|Old team pasta/);
  assert.doesNotMatch(await at({ localDate: '2026-09-28', localTime: '12:10 PM' }, 'intuitive'), /\d+g/);
  assert.equal(await at({ localDate: '2026-09-28', localTime: '3:00 PM' }, 'structured'), '', 'lunch is over');
  assert.equal(await at({ localDate: '2026-09-10', localTime: '12:10 PM' }, 'structured'), '');
  assert.equal(await at({}, 'structured'), '', 'an old client without a date gets nothing');
});

test("meal-chat: the menu rides the athlete's OWN turns only, and never costs a model call", () => {
  const src = readFileSync(join(HERE, '..', 'meal-chat', 'index.ts'), 'utf8');
  assert.match(src, /const diningP: Promise<string> = !coachMode && !correctionUpdate && mealRow\.athlete_id === callerId\s*\? diningContextFor\(service, mealRow\.athlete_id, body\?\.athlete, planStyle, /);
  assert.match(src, /dining \? `\\n\\n\$\{dining\} With this menu in hand/);
  const mod = readFileSync(join(HERE, 'dining-context.mjs'), 'utf8');
  assert.doesNotMatch(mod, /anthropic|messages\.create/i);
});

test("FILTERED: the athlete's allergies (by tag and by name), intolerances, dislikes and confirmed facts never reach Nia", async () => {
  const tables = {
    ...TABLES,
    dining_menus: [{ team_id: 't1', hall_id: 'h1', menu_date: '2026-09-28', period: 'lunch', status: 'published', items: [
      { name: 'Pad thai', kind: 'protein', per_serving: { protein: 25 }, tags: ['contains nuts'] },
      { name: 'Alfredo', kind: 'carb', per_serving: { protein: 18 }, tags: ['contains dairy', 'contains wheat'] },
      { name: 'Mushroom risotto', kind: 'carb', tags: [] },
      { name: 'Kiwi cup', kind: 'fruit', tags: [] },
      { name: 'Grilled chicken', kind: 'protein', per_serving: { protein: 35 }, tags: ['gluten free'] },
    ] }],
    dietary_restrictions: [{ athlete_id: 'a1', data: { allergies: [{ name: 'Peanuts', severity: 'severe' }], intolerances: ['Lactose'] } }],
    profiles: [{ id: 'a1', food_prefs: { dislikes: ['mushrooms'] } }],
  };
  const block = await diningContextFor(fakeService(tables), 'a1', { localDate: '2026-09-28', localTime: '12:10 PM' }, 'structured',
    { serverNow: NOW, extraAvoid: ['kiwi'] });
  assert.doesNotMatch(block, /Pad thai/, 'the nuts tag covers a peanut allergy');
  assert.doesNotMatch(block, /Alfredo/, 'the dairy tag covers a lactose intolerance');
  assert.doesNotMatch(block, /Mushroom/, 'a dislike');
  assert.doesNotMatch(block, /Kiwi/, 'a confirmed allergy fact from memory');
  assert.match(block, /Grilled chicken \(about 35g protein\)/);
  // With nothing ruled out, the rest carries its allergen tags.
  const open = await diningContextFor(fakeService({ ...tables, dietary_restrictions: [], profiles: [] }), 'a1',
    { localDate: '2026-09-28', localTime: '12:10 PM' }, 'structured', { serverNow: NOW });
  assert.match(open, /Pad thai \(about 25g protein; nuts\)/);
  assert.match(open, /Alfredo \(about 18g protein; dairy, wheat\)/);
});

test('meal-chat hands the confirmed memory facts to the menu filter', () => {
  const src = readFileSync(join(HERE, '..', 'meal-chat', 'index.ts'), 'utf8');
  assert.match(src, /diningContextFor\(service, mealRow\.athlete_id, body\?\.athlete, planStyle, \{ extraAvoid: avoidFromFacts\(memFacts\) \}\)/);
});
