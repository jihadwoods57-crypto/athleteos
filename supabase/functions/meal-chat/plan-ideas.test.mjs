/* meal-chat's plan ideas (goals and eating plan A1, 2026-09-25): the pure half round-trips in
 * Node, and the wiring in index.ts is pinned structurally (cache before cost, consent before the
 * model, caps before the model, the filter after it, telemetry on the one paid call), because a
 * unit test cannot see a door that quietly started billing twice.
 * Run: node --test supabase/functions/meal-chat/plan-ideas.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PLAN_IDEAS_TOOL, PLAN_IDEAS_SYSTEM, planIdeasRequest, planIdeasUserText, parsePlanIdeas,
} from './suggest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'index.ts'), 'utf8');
const TURN = SRC.slice(SRC.indexOf('async function planIdeasTurn('));

test('the tool: names, figures and fit tags, three at most, no em dash anywhere the model reads', () => {
  assert.equal(PLAN_IDEAS_TOOL.name, 'plan_ideas');
  const item = PLAN_IDEAS_TOOL.input_schema.properties.ideas.items;
  assert.deepEqual(Object.keys(item.properties).sort(), ['kcal', 'name', 'protein_g', 'tags']);
  assert.deepEqual(item.properties.tags.items.enum, ['budget', 'no_cook', 'grab_and_go']);
  assert.equal(PLAN_IDEAS_TOOL.input_schema.properties.ideas.maxItems, 3);
  assert.doesNotMatch(JSON.stringify(PLAN_IDEAS_TOOL) + PLAN_IDEAS_SYSTEM, /—|`/);
  assert.match(PLAN_IDEAS_SYSTEM, /Never suggest a food the athlete is allergic or intolerant to/);
  assert.match(PLAN_IDEAS_SYSTEM, /Never suggest supplements, diet products or eating less/);
});

test('the request is bounded: a known slot, a date next to the server\'s, sane targets', () => {
  const ok = planIdeasRequest({ slot: 'Dinner', dayDate: '2026-09-25', slotTitle: 'Dinner', proteinTarget: 45, kcalTarget: 900, usuals: ['Chicken bowl', 'x'.repeat(200)] }, '2026-09-25');
  assert.equal(ok.slot, 'dinner');
  assert.equal(ok.proteinTarget, 45);
  assert.equal(ok.usuals.length, 2);
  assert.ok(ok.usuals[1].length <= 30);
  assert.equal(planIdeasRequest({ slot: 'meal-5', dayDate: '2026-09-24' }, '2026-09-25').slot, 'meal-5', 'yesterday in UTC is the athlete\'s today');
  assert.equal(planIdeasRequest({ slot: 'dinner', dayDate: '2026-09-20' }, '2026-09-25'), null, 'the cache cannot be walked across dates');
  assert.equal(planIdeasRequest({ slot: 'brunch; drop table', dayDate: '2026-09-25' }, '2026-09-25'), null);
  assert.equal(planIdeasRequest(null, '2026-09-25'), null);
  const r = planIdeasRequest({ slot: 'lunch', dayDate: '2026-09-25', proteinTarget: 9999, kcalTarget: -3 }, '2026-09-25');
  assert.equal(r.proteinTarget, null);
  assert.equal(r.kcalTarget, null);
});

test('the prompt carries the slot, its target, the usuals not to repeat, and the prefs as data', () => {
  const req = planIdeasRequest({ slot: 'dinner', slotTitle: 'Dinner', dayDate: '2026-09-25', proteinTarget: 45, kcalTarget: 900, usuals: ['Chicken bowl'] }, '2026-09-25');
  const t = planIdeasUserText(req, { prefs: { budget: true, dislikes: ['tuna'] }, dossier: 'About the athlete: ...', memory: '' });
  assert.match(t, /Meal slot: Dinner\./);
  assert.match(t, /Slot target: about 45g protein and about 900 calories\./);
  assert.match(t, /do not repeat these: Chicken bowl\./);
  assert.match(t, /budget-friendly \(about \$5 or less\)/);
  assert.match(t, /never suggest: tuna/);
  assert.match(t, /About the athlete/);
});

test('the parse: scrubbed, plain, figure-free names; avoid words dropped; tags mapped; clamped', () => {
  const ideas = parsePlanIdeas({ ideas: [
    { name: 'Turkey & rice bowl', protein_g: 42, kcal: 650, tags: ['budget', 'no_cook', 'nope'] },
    { name: '40g protein shake', protein_g: 40, kcal: 300 },
    { name: 'Peanut noodles', protein_g: 20, kcal: 500 },
    { name: 'Greek yogurt parfait</name><parameter name="x">', protein_g: 25, kcal: 350, tags: ['grab_and_go'] },
    { name: 'Tuna wrap', protein_g: 9999, kcal: -4 },
    { name: 'Another one', protein_g: 10, kcal: 100 },
  ] }, { avoid: ['peanuts'] });
  assert.deepEqual(ideas, [
    { name: 'Turkey & rice bowl', protein: 42, kcal: 650, tags: ['budget', 'noCook'] },
    { name: 'Greek yogurt parfait', protein: 25, kcal: 350, tags: ['grabGo'] },
    { name: 'Tuna wrap', protein: 300, kcal: 0, tags: [] },
  ]);
  assert.deepEqual(parsePlanIdeas(null), []);
  assert.deepEqual(parsePlanIdeas({ ideas: 'x' }), []);
  assert.deepEqual(parsePlanIdeas({ ideas: [{ name: 'Big 2 lb steak', protein_g: 1, kcal: 1 }] }), [], 'a figure in a name is not a name');
});

test('WIRING: its own door, before the mealId requirement, for the caller only', () => {
  const door = SRC.indexOf('if (body?.planIdeas && typeof body.planIdeas === \'object\') return await planIdeasTurn(');
  assert.ok(door > -1 && door < SRC.indexOf('const mealId = body?.mealId;'));
  assert.match(TURN, /const uid = userData\?\.user\?\.id;\s*if \(!uid\) return bad\(401/);
  assert.doesNotMatch(TURN, /body\.athleteId|athlete_id: raw/, 'nobody can ask for someone else');
});

test('WIRING: cache first, then consent, then the two caps, then ONE recorded model call, then the filter', () => {
  const at = (s) => { const i = TURN.indexOf(s); assert.ok(i > -1, `missing: ${s}`); return i; };
  const cache = at(".from('plan_ideas').select('ideas, prefs_key')");
  const consent = at('await missingConsent(service, [uid])');
  const cap = at('await withinKeyCap(`plan_ideas:${uid}`, PLAN_IDEAS_CAP)');
  const spend = at('await checkSpend(EST_USD.text)');
  const model = at('await anthropic.messages.create(');
  const record = at("mode: 'plan_ideas'");
  const filter = at('parsePlanIdeas(tool?.input, { avoid })');
  const store = at(".from('plan_ideas').upsert(");
  assert.ok(cache < consent && consent < cap && cap < spend && spend < model && model < record && model < filter && filter < store);
  assert.match(TURN, /hit\.prefs_key === key/, 'a cache row built for other prefs is stale');
  assert.match(TURN, /tool_choice: \{ type: 'tool', name: 'plan_ideas' \}/);
  assert.match(TURN, /avoidWords\(prefs, facts\?\.restrictions \?\? null\)/, 'allergies from the server record, not the request');
  assert.match(TURN, /select\('food_prefs'\)/, 'prefs are read server-side, never taken from the request');
  assert.match(TURN, /NIA_IDENTITY\} \$\{NIA_HONESTY\}/);
});
