/* meal-chat's suggest_meal tool (2026-09-10), pinned the way remember.test.mjs pins the memory
 * loop: the pure half round-trips in Node, and the wiring in index.ts is pinned structurally,
 * because nothing in a unit test can see a tool that silently stopped being offered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SUGGEST_MEAL_TOOL, parseSuggestMeal, suggestRowText, suggestRowMeta } from './suggest.mjs';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

test('the tool schema is what the model is offered: gap, optional kcal gap, framing, fallback', () => {
  assert.equal(SUGGEST_MEAL_TOOL.name, 'suggest_meal');
  const p = SUGGEST_MEAL_TOOL.input_schema.properties;
  assert.deepEqual(Object.keys(p).sort(), ['fallback', 'framing', 'kcal_gap', 'protein_gap_g']);
  assert.deepEqual(SUGGEST_MEAL_TOOL.input_schema.required, ['protein_gap_g', 'framing', 'fallback']);
  assert.match(SUGGEST_MEAL_TOOL.description, /Never call it unprompted/);
  assert.doesNotMatch(JSON.stringify(SUGGEST_MEAL_TOOL), /—/, 'no em dash reaches the model as an example');
});

test('a suggest_meal tool_use round-trips: sanitized, persisted as complete text, meta for the picks', () => {
  const input = {
    protein_gap_g: 42, kcal_gap: 810,
    framing: 'You are 42g short with dinner still open — here is what usually gets you there.',
    fallback: 'A protein-forward plate at dinner closes most of it.',
  };
  const s = parseSuggestMeal(input);
  assert.equal(s.proteinGap, 42);
  assert.equal(s.kcalGap, 810);
  assert.doesNotMatch(s.framing, /—/, 'the em-dash rail applies here like every other reply');
  assert.equal(s.fallback, 'A protein-forward plate at dinner closes most of it.');
  // What a renderer that does not know this bubble sees: one complete plain message.
  assert.equal(suggestRowText(s), `${s.framing} ${s.fallback}`);
  const meta = suggestRowMeta(s);
  assert.equal(meta.t, 'meal_suggest');
  assert.equal(meta.proteinGap, 42);
  assert.equal(meta.kcalGap, 810);
  assert.equal(meta.framing, s.framing);
  assert.equal(meta.fallback, s.fallback);
});

test('a bad gap becomes 0, a missing kcal gap is omitted, and markup is stripped', () => {
  const s = parseSuggestMeal({ protein_gap_g: 'lots', framing: '<b>Eat</b> more', fallback: 'ok' });
  assert.equal(s.proteinGap, 0);
  assert.equal(s.kcalGap, null);
  assert.equal(s.framing, 'bEat/b more');
  assert.equal('kcalGap' in suggestRowMeta(s), false);
});

test('framing and fallback cover for each other, and nothing at all is a refusal', () => {
  const only = parseSuggestMeal({ protein_gap_g: 10, framing: '', fallback: 'One plate closes it.' });
  assert.equal(only.framing, 'One plate closes it.');
  assert.equal(suggestRowText(only), 'One plate closes it.', 'never the same sentence twice');
  assert.equal(parseSuggestMeal({ protein_gap_g: 10 }), null);
  assert.equal(parseSuggestMeal(null), null);
});

test('index.ts offers the tool only to a client that renders the picks, and handles the call', () => {
  assert.match(SRC, /const canSuggestMeal = body\?\.canSuggestMeal === true;/, 'capability-gated like apply_correction and remember');
  assert.match(SRC, /\.\.\.\(canSuggestMeal \? \[SUGGEST_MEAL_TOOL\] : \[\]\)/, 'added to the athlete tools on that flag only');
  const handler = SRC.slice(SRC.indexOf("tool?.name === 'suggest_meal'"), SRC.indexOf("tool?.name === 'remember'"));
  assert.ok(handler.length > 0, 'the handler runs before the other tool branches');
  assert.match(handler, /parseSuggestMeal\(tool\.input\)/, 'the model\'s input goes through the sanitizer');
  assert.match(handler, /meta: suggestRowMeta\(sug\)/, 'the row carries the meta the renderers key on');
  assert.match(handler, /athlete_id: mealRow\.athlete_id/, 'the row belongs to the meal owner');
  assert.match(handler, /styleSafe\(parsed\.framing\)/, 'the plan-style rail applies to both sentences');
  assert.match(handler, /reply: text, suggest: sug/, 'the client gets the suggestion like the other tool results');
});

test('the prompt says when to suggest and, more importantly, when not to', () => {
  assert.match(SRC, /WHAT SHOULD I EAT IS A SUGGESTION, NOT A PARAGRAPH/);
  assert.match(SRC, /never unprompted/);
  assert.match(SRC, /never pick the meals yourself/);
});
