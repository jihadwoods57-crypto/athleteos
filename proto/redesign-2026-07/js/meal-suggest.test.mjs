/* The suggest_meal bubble's client half (2026-09-10), DOM-free.
 *
 * meal-chat frames; the client picks. These pin the deterministic fill (the athlete's OWN saved
 * meals ranked against what is left of the day, the same rankForRemaining Plan > Ask uses), the
 * row-to-bubble decode, the never-empty rule, and the bounded usual-meals context the model sees.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isMealSuggest, mealSuggestOf, fillMealSuggestion, mealSuggestHtml, pickLabel } from './chat-view.js';
import { contextForChat, usualMealsForChat } from './meal-intel.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ITEMS = [
  { id: 'a', name: 'Chicken and rice', protein: 45, kcal: 620, times_logged: 6, status: 'active' },
  { id: 'b', name: 'Greek yogurt bowl', protein: 22, kcal: 280, times_logged: 3, status: 'active', verified_at: '2026-09-01' },
  { id: 'c', name: 'Double burger meal', protein: 55, kcal: 1400, times_logged: 2, status: 'active' },
  { id: 'd', name: 'Old order', protein: 40, kcal: 500, times_logged: 9, status: 'archived' },
  { id: 'e', name: 'Black coffee', protein: 0, kcal: 5, times_logged: 20, status: 'active' },
];

const row = (meta, over = {}) => ({ role: 'ai', text: 'framing fallback', meta, ...over });
const SUG_META = { t: 'meal_suggest', proteinGap: 40, kcalGap: 700, framing: 'You are 40g short with dinner open.', fallback: 'A protein-forward plate at dinner closes it.' };

test('only an AI row with meal_suggest meta is a suggestion; an athlete cannot forge one', () => {
  assert.equal(isMealSuggest(row(SUG_META)), true);
  assert.equal(isMealSuggest(row(SUG_META, { role: 'athlete' })), false);
  assert.equal(isMealSuggest(row({ t: 'memory_offer' })), false);
  assert.equal(isMealSuggest(null), false);
  assert.equal(mealSuggestOf(row({ t: 'analysis' })), null);
});

test('the row decodes to gap, kcal gap, framing and fallback, with the text as the last resort', () => {
  assert.deepEqual(mealSuggestOf(row(SUG_META)), {
    proteinGap: 40, kcalGap: 700, framing: SUG_META.framing, fallback: SUG_META.fallback,
  });
  const bare = mealSuggestOf(row({ t: 'meal_suggest' }, { text: 'Eat something real.' }));
  assert.equal(bare.proteinGap, 0);
  assert.equal(bare.kcalGap, null);
  assert.equal(bare.framing, 'Eat something real.');
  assert.equal(bare.fallback, 'Eat something real.');
});

test('the fill is the athlete\'s own meals that FIT what is left, at most three, archived and empty excluded', () => {
  const sug = mealSuggestOf(row(SUG_META));
  const picks = fillMealSuggestion(sug, ITEMS, { protein: 40, kcal: 700 });
  assert.deepEqual(picks.map((p) => p.id), ['a', 'b'], 'the 1400 kcal meal runs past what is left; coffee has no fuel; the archived order is gone');
  assert.deepEqual(picks[0], { id: 'a', name: 'Chicken and rice', protein: 45, kcal: 620 });
});

test('with no client target the model\'s stated gap stands in, so the ranking still has a number', () => {
  const sug = mealSuggestOf(row({ ...SUG_META, kcalGap: undefined }));
  const withGap = fillMealSuggestion(sug, ITEMS, { protein: null, kcal: null });
  assert.equal(withGap[0].id, 'a', 'closest to the 40g gap wins');
  assert.ok(withGap.length <= 3);
  // kcal null on both sides: nothing is "over", so the burger is allowed back in.
  assert.ok(withGap.some((p) => p.id === 'c'));
});

test('the fill never exceeds max and returns nothing from nothing', () => {
  const sug = mealSuggestOf(row(SUG_META));
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, name: `Meal ${i}`, protein: 30, kcal: 400, times_logged: i }));
  assert.equal(fillMealSuggestion(sug, many, { protein: 40, kcal: 700 }).length, 3);
  assert.equal(fillMealSuggestion(sug, many, { protein: 40, kcal: 700 }, 2).length, 2);
  assert.deepEqual(fillMealSuggestion(sug, [], { protein: 40, kcal: 700 }), []);
  assert.deepEqual(fillMealSuggestion(sug, null, null), []);
});

test('the bubble is the framing plus one tap target per pick, on Plan\'s own data-fm-log selector', () => {
  const sug = mealSuggestOf(row(SUG_META));
  const html = mealSuggestHtml(sug, fillMealSuggestion(sug, ITEMS, { protein: 40, kcal: 700 }), esc);
  assert.ok(html.startsWith(esc(SUG_META.framing)));
  assert.equal((html.match(/data-fm-log="/g) || []).length, 2);
  assert.match(html, /data-fm-log="a"[^>]*>Chicken and rice · 45g protein · 620 kcal</);
  assert.doesNotMatch(html, /A protein-forward plate/, 'the fallback is not shown when there are picks');
  assert.doesNotMatch(html, /style="/, 'no inline style; the chips are the shared .fx-chip');
});

test('the bubble is never empty: no fitting meal shows the framing AND the fallback sentence', () => {
  const sug = mealSuggestOf(row(SUG_META));
  const html = mealSuggestHtml(sug, [], esc);
  assert.equal(html, esc(`${SUG_META.framing} ${SUG_META.fallback}`));
  assert.doesNotMatch(html, /data-fm-log/);
  // Identical sentences are not printed twice.
  const same = mealSuggestOf(row({ t: 'meal_suggest', framing: 'One line.', fallback: 'One line.' }));
  assert.equal(mealSuggestHtml(same, [], esc), 'One line.');
  assert.equal(mealSuggestHtml(null, [], esc), '');
});

test('pickLabel reads like Plan > Ask and escapes through the caller', () => {
  assert.equal(pickLabel({ name: 'Eggs', protein: 18, kcal: 0 }), 'Eggs · 18g protein');
  assert.equal(pickLabel({ name: 'Eggs', protein: 0, kcal: 0 }), 'Eggs');
  const html = mealSuggestHtml(mealSuggestOf(row(SUG_META)), [{ id: 'x<y', name: '<b>Bad</b>', protein: 1, kcal: 1 }], esc);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /data-fm-log="x&lt;y"/);
});

test('usual meals reach the model bounded: eight at most, verified and most-logged first, names cleaned', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `Meal <${i}>`, protein: 20 + i, kcal: 300, times_logged: i, status: 'active' }));
  many[2].verified_at = '2026-09-01';
  const out = usualMealsForChat([...many, { id: 'z', name: 'Gone', protein: 99, kcal: 999, status: 'archived' }]);
  assert.equal(out.length, 8);
  assert.equal(out[0].name, 'Meal 2', 'the verified item leads');
  assert.equal(out[1].name, 'Meal 11', 'then the most-logged');
  assert.ok(out.every((c) => !/[<>]/.test(c.name)));
  assert.deepEqual(Object.keys(out[0]).sort(), ['kcal', 'name', 'protein']);
});

test('contextForChat carries usualMeals only when handed a list, and sheds them before the thread', () => {
  const base = contextForChat({ meal: { name: 'x' }, thread: [{ role: 'athlete', text: 'hi' }] });
  assert.equal('usualMeals' in base, false, 'every other caller\'s context stays byte-identical');
  const withUm = contextForChat({ meal: { name: 'x' }, usualMeals: ITEMS });
  assert.equal(withUm.usualMeals.length, 4, 'the archived order is not sent; coffee (5 kcal) still is, as Food Memory holds it');
  assert.equal(usualMealsForChat([{ id: 'n', name: 'Nothing', protein: 0, kcal: 0 }]).length, 0, 'a zero-fuel item is not');
  // Push the context past its clamp with a fat thread and check the order things are shed in:
  // recent meals first, then usual meals, and the thread keeps its last message.
  // The thread is cut to its last 20 rows first, so each row is fat enough that 20 alone overflow.
  const fatThread = Array.from({ length: 40 }, (_, i) => ({ role: 'athlete', text: 'y'.repeat(600) + i }));
  const clamped = contextForChat({ meal: { name: 'x' }, recentMeals: [{ type: 'lunch' }], usualMeals: ITEMS, thread: fatThread });
  assert.ok(JSON.stringify(clamped).length <= 8192);
  assert.equal(clamped.recentMeals.length, 0);
  assert.equal(clamped.usualMeals.length, 0);
  assert.ok(clamped.thread.length >= 1);
});
