/* Nia's "why this matters" chip under her opener (goals and eating plan, A2, 2026-09-25).
 *
 * Pins: only an opener row carrying meta.why draws one, its label follows the goal ("Why this
 * matters for gaining"), a minor's is always "for your training", it opens and closes in place and
 * stays open across a repaint, it is drawn in the athlete's own threads and never the coach's, and
 * the server's opener really puts `why` in meta beside the text, never in it.
 * Run: node --test proto/redesign-2026-07/js/opener-why-chip.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');
const TP = await import('./thread-polish.js');
const { composeOpener } = await import('../../../supabase/functions/_shared/meal-opener.ts');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const opener = (why, extra = {}) => ({ id: 'c1', role: 'ai', kind: 'message', text: 'Good plate.', meta: { t: 'analysis', ...(why ? { why } : {}) }, ...extra });

test('only an opener carrying meta.why draws a chip, labelled by the goal', () => {
  assert.equal(TP.whyOf(opener(null)), null);
  assert.equal(TP.whyOf({ ...opener({ text: 'x', goal: 'gain' }), meta: { t: 'meal_suggest', why: { text: 'x', goal: 'gain' } } }), null);
  assert.equal(TP.whyOf(opener({ text: '   ', goal: 'gain' })), null);
  const labels = { gain: 'gaining', lose: 'losing fat', maintain: 'maintaining', perform: 'performing', train: 'your training', nonsense: 'performing' };
  for (const [goal, word] of Object.entries(labels)) {
    assert.equal(TP.whyOf(opener({ text: 'Protein repairs training.', goal })).label, `Why this matters for ${word}`, goal);
  }
});

test('a minor is always "for your training", whatever an old row says', () => {
  assert.equal(TP.whyOf(opener({ text: 'x y z', goal: 'lose' }), { minor: true }).label, 'Why this matters for your training');
});

test('collapsed by default, opens and closes in place, and a repaint keeps it open', () => {
  const w = TP.whyOf(opener({ text: 'Protein at every meal repairs training.', goal: 'perform' }, { id: 'open-me' }));
  const html = TP.whyChipHtml(w, esc);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Protein at every meal repairs training\./);
  const attrs = { 'data-tp-why': 'open-me', 'aria-expanded': 'false' };
  const cls = new Set(['tp-why']);
  const btn = {
    getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; },
    classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
  };
  const target = { closest: (sel) => (sel === '[data-tp-why]' ? btn : null) };
  assert.equal(TP.toggleWhyAt(target), true);
  assert.equal(attrs['aria-expanded'], 'true');
  assert.ok(cls.has('open'));
  assert.match(TP.whyChipHtml(w, esc), /tp-why open/);
  assert.equal(TP.toggleWhyAt(target), true);
  assert.equal(attrs['aria-expanded'], 'false');
  assert.doesNotMatch(TP.whyChipHtml(w, esc), /tp-why open/);
  assert.equal(TP.toggleWhyAt({ closest: () => null }), false);
  // The text is escaped like everything else in the thread.
  assert.doesNotMatch(TP.whyChipHtml(TP.whyOf(opener({ text: '<b>x</b> y', goal: 'gain' })), esc), /<b>/);
});

test('the athlete\'s own threads draw it; the coach\'s never does', () => {
  assert.match(read('screens', 'meal.js'), /staffAccount\(\) \? '' : whyChipHtml\(whyOf\(c, \{ minor: !!S\.consent\.minor \}\), esc\)/);
  assert.match(read('screens', 'nutrition-chat.js'), /whyChipHtml\(whyOf\(c, \{ minor: !!S\.consent\.minor \}\), esc\)/);
  assert.doesNotMatch(read('screens', 'coach.js'), /whyChipHtml|whyOf/);
});

test('the server sends it in meta, beside the text and never inside it', () => {
  const r = composeOpener({ name: 'Bowl', analysis: 'Real protein here. Add fruit next time.' },
    { goal: 'gain', mealId: 'm1', day: { proteinIncludingThisMeal: 50, proteinTarget: 180, mealsRemaining: 3 } });
  assert.ok(r.why && r.why.text);
  assert.equal(r.text.includes(r.why.text), false);
  const src = read('..', '..', '..', 'supabase', 'functions', 'analyze-meal', 'index.ts');
  assert.match(src, /meta: \{ t: 'analysis', \.\.\.\(ask \? \{ ask \} : \{\}\), \.\.\.\(why \? \{ why \} : \{\}\) \}/);
  // The goal and the age band are the server's own read, never the request's.
  assert.match(src, /from\('athlete_profiles'\)\.select\('base_goal, dob, base_age'\)/);
});

test('fix: the opener\'s profile read rides alongside the duplicate check, not after it', () => {
  const src = read('..', '..', '..', 'supabase', 'functions', 'analyze-meal', 'index.ts');
  const fn = src.slice(src.indexOf('async function postOpener('), src.indexOf('Deno.serve('));
  const all = fn.indexOf('Promise.all(');
  assert.ok(all > 0, 'one Promise.all');
  const seg = fn.slice(all, fn.indexOf(']);', all));
  assert.match(seg, /from\('meal_comments'\)/);
  assert.match(seg, /from\('athlete_profiles'\)\.select\('base_goal, dob, base_age'\)/);
});
