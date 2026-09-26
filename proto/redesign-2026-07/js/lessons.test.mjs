/* The 60-second lessons (goals and eating plan, phase D, 2026-09-26).
 *
 * Lints every word of lessons-content.js (word caps, no em dashes, the Intuitive and minor variants
 * wherever a figure or a weight word appears, the supplements caution line, one right answer per
 * quick check), pins the lesson list and titles to 0256, and pins the rules Home and the weekly
 * focus read: which lesson a focus points at, which assigned lesson shows, the card priority.
 * Run: node --test proto/redesign-2026-07/js/lessons.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LESSONS, LESSON_IDS, FIGURE_RE, WEIGHT_RE, lessonFor, pickVariant, lessonForFocus, openAssignments,
  homeCards, dueLabel, assignedCardCopy, isCorrect, audience,
} from './lessons-model.js';
import { candidates } from './weekly-focus-model.js';
import { slotOrder } from './plan-today-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const MIG = readFileSync(join(ROOT, 'supabase', 'migrations', '0256_lessons_challenges.sql'), 'utf8');

const AUDIENCES = [
  { name: 'adult, numbers', intuitive: false, minor: false },
  { name: 'adult, Intuitive', intuitive: true, minor: false },
  { name: 'minor, numbers', intuitive: false, minor: true },
  { name: 'minor, Intuitive', intuitive: true, minor: true },
];
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const CAUTION = 'Talk to your team dietitian first. Some supplements contain substances banned by the NCAA and other governing bodies, and labels are not always accurate.';

/** Every string in the content, variants included. */
function allStrings() {
  const out = [];
  for (const l of LESSONS) {
    out.push(l.title, l.summary);
    for (const c of l.cards) for (const k of ['text', 'intuitive', 'minor', 'minorIntuitive']) if (typeof c[k] === 'string') out.push(c[k]);
    const ch = l.check;
    for (const v of [ch, ch.intuitive, ch.minor, ch.minorIntuitive]) if (v && typeof v === 'object') out.push(v.q, v.why, ...v.options);
  }
  return out;
}

test('twelve lessons, the spec\'s topics, ids unique and the database\'s', () => {
  assert.equal(LESSONS.length, 12);
  assert.equal(new Set(LESSON_IDS).size, 12);
  const sqlIds = MIG.split('create or replace function lesson_ids()')[1].split('$$;')[0].match(/'([a-z-]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(sqlIds, LESSON_IDS, '0256 lesson_ids() is the app list, in order');
  const titles = MIG.split('create or replace function lesson_title')[1].split('$$;')[0];
  for (const l of LESSONS) assert.ok(titles.includes(`when '${l.id}' then '${l.title.replace(/'/g, "''")}'`), `0256 lesson_title knows ${l.id}`);
});

test('no em dashes, no Nia signature, no markup anywhere in the content', () => {
  for (const s of allStrings()) {
    assert.doesNotMatch(s, /[—–]/, `dash in: ${s}`);
    assert.doesNotMatch(s, /\bNia\b/, `signed as Nia: ${s}`);
    assert.doesNotMatch(s, /[<>{}]/, `markup in: ${s}`);
  }
});

test('every card is one short idea: at most 60 words, 3 to 5 cards for every reader', () => {
  for (const l of LESSONS) {
    assert.ok(l.cards.length >= 3 && l.cards.length <= 5, `${l.id} has ${l.cards.length} cards`);
    for (const c of l.cards) for (const k of ['text', 'intuitive', 'minor', 'minorIntuitive']) {
      if (typeof c[k] === 'string') assert.ok(words(c[k]) <= 60, `${l.id} ${k} is ${words(c[k])} words: ${c[k]}`);
    }
    for (const a of AUDIENCES) {
      const v = lessonFor(l.id, a);
      assert.ok(v.cards.length >= 3 && v.cards.length <= 5, `${l.id} for ${a.name}: ${v.cards.length} cards`);
    }
  }
});

test('titles and summaries read right for everyone: no figures, no weight words', () => {
  for (const l of LESSONS) {
    for (const s of [l.title, l.summary]) {
      assert.doesNotMatch(s, FIGURE_RE, `${l.id}: ${s}`);
      assert.doesNotMatch(s, WEIGHT_RE, `${l.id}: ${s}`);
    }
    assert.ok(words(l.summary) <= 16, `${l.id} summary is one line`);
  }
});

test('the Intuitive and minor variants exist wherever a figure or a weight word appears', () => {
  for (const l of LESSONS) {
    for (const a of AUDIENCES) {
      const v = lessonFor(l.id, a);
      for (const t of [...v.cards, v.check.q, v.check.why, ...v.check.options]) {
        if (a.intuitive) assert.doesNotMatch(t, FIGURE_RE, `${l.id} for ${a.name} shows a figure: ${t}`);
        if (a.minor) assert.doesNotMatch(t, WEIGHT_RE, `${l.id} for ${a.name} shows weight talk: ${t}`);
      }
    }
  }
  // And the lint really bites: the adult numbers version of these carries figures and weight words.
  assert.match(lessonFor('breakfast-that-holds', AUDIENCES[0]).cards.join(' '), FIGURE_RE);
  assert.match(lessonFor('hydration-basics', AUDIENCES[0]).cards.join(' '), WEIGHT_RE);
  assert.match(lessonFor('carbs-are-fuel', AUDIENCES[0]).cards.join(' '), WEIGHT_RE);
});

test('every quick check has 3 options and exactly one right answer', () => {
  for (const l of LESSONS) {
    for (const a of AUDIENCES) {
      const c = lessonFor(l.id, a).check;
      assert.ok(c, `${l.id} has a check for ${a.name}`);
      assert.equal(c.options.length, 3, `${l.id} options`);
      assert.equal(new Set(c.options).size, 3, `${l.id} options are distinct`);
      assert.ok(Number.isInteger(c.answer) && c.answer >= 0 && c.answer <= 2, `${l.id} answer index`);
      assert.equal([0, 1, 2].filter((i) => isCorrect(c, i)).length, 1, `${l.id} exactly one right answer`);
      assert.ok(c.why && words(c.why) <= 30, `${l.id} the explanation is one line`);
      assert.ok(words(c.q) <= 25, `${l.id} the question is short`);
    }
  }
});

test('the supplements lesson carries the caution line for every reader, and names no product', () => {
  for (const a of AUDIENCES) {
    const v = lessonFor('food-first-supplements', a);
    assert.ok(v.cards.some((t) => t.includes(CAUTION)), `caution line for ${a.name}`);
    const all = [...v.cards, v.check.q, v.check.why, ...v.check.options].join(' ');
    assert.doesNotMatch(all, /creatine|whey|beta-alanine|®|™|\bbrand\b|we recommend/i);
  }
  // The under-18 card is for minors only.
  assert.ok(lessonFor('food-first-supplements', { minor: true }).cards.some((t) => /under 18/.test(t)));
  assert.ok(!lessonFor('food-first-supplements', { minor: false }).cards.some((t) => /under 18/.test(t)));
});

test('the voice is second person, and no card makes a medical claim', () => {
  for (const l of LESSONS) {
    const text = l.cards.map((c) => c.text || c.minor).join(' ');
    assert.match(text, /\byou(r)?\b/i, `${l.id} speaks to the reader`);
    assert.doesNotMatch(text, /\b(cures?|treatment|treats? (an? )?(disease|injury|condition)|prevents? (disease|injury|illness)|diagnos|guarantee)/i, `${l.id} no medical claims`);
  }
});

test('a variant set to null skips the card; undefined falls through', () => {
  assert.equal(pickVariant({ text: 'a', minor: null }, { minor: true }), null);
  assert.equal(pickVariant({ text: 'a' }, { minor: true, intuitive: true }), 'a');
  assert.equal(pickVariant({ text: 'a', intuitive: 'b', minor: 'c' }, { minor: true, intuitive: true }), 'c');
  assert.equal(pickVariant({ text: 'a', intuitive: 'b', minorIntuitive: 'd' }, { minor: true, intuitive: true }), 'd');
  assert.deepEqual(audience({ showMacros: false, minor: true }), { intuitive: true, minor: true });
});

test('the weekly focus points at the lesson that teaches it', () => {
  assert.equal(lessonForFocus('protein:breakfast'), 'breakfast-that-holds');
  assert.equal(lessonForFocus('protein:lunch'), 'protein-every-meal');
  assert.equal(lessonForFocus('protein:dinner'), 'protein-every-meal');
  assert.equal(lessonForFocus('protein:meal-5'), 'protein-every-meal');
  assert.equal(lessonForFocus('missed'), 'eating-on-the-road');
  assert.equal(lessonForFocus('snack'), 'snacks-that-count');
  assert.equal(lessonForFocus('late'), null, 'no lesson teaches logging on time');
  // Every focus a lesson claims is a real weekly-focus candidate.
  const every = new Set([...candidates(slotOrder({ slots: ['breakfast', 'lunch', 'snack', 'dinner'] })), 'protein:breakfast']);
  for (const l of LESSONS) for (const k of l.focus) assert.ok(every.has(k), `${l.id} focus ${k}`);
});

test('THE HOME CARD PRIORITY: an assigned lesson on top; a challenge replaces the focus card', () => {
  assert.deepEqual(homeCards({ lesson: true, challenge: true, focus: true }), ['lesson', 'challenge']);
  assert.deepEqual(homeCards({ lesson: true, challenge: false, focus: true }), ['lesson', 'focus']);
  assert.deepEqual(homeCards({ lesson: false, challenge: true, focus: true }), ['challenge']);
  assert.deepEqual(homeCards({ lesson: false, challenge: false, focus: true }), ['focus']);
  assert.deepEqual(homeCards({}), []);
});

test('assigned lessons: the undone ones, most pressing first, each lesson once', () => {
  const rows = [
    { id: '1', lesson_id: 'carbs-are-fuel', due_on: null, created_at: '2026-09-20T10:00:00Z' },
    { id: '2', lesson_id: 'game-day', due_on: '2026-09-30', created_at: '2026-09-25T10:00:00Z' },
    { id: '3', lesson_id: 'hydration-basics', due_on: '2026-09-28', created_at: '2026-09-26T10:00:00Z' },
    { id: '4', lesson_id: 'game-day', due_on: null, created_at: '2026-09-19T10:00:00Z' },
    { id: '5', lesson_id: 'recovery-meal', due_on: null, created_at: '2026-09-18T10:00:00Z' },
    { id: '6', lesson_id: 'not-a-lesson', due_on: null, created_at: '2026-09-18T10:00:00Z' },
  ];
  assert.deepEqual(openAssignments(rows, ['recovery-meal']).map((r) => r.id), ['3', '2', '1']);
  assert.deepEqual(openAssignments(rows, LESSON_IDS), []);
});

test('the assigned card: who it is from, the lesson, a minute, and the due date', () => {
  assert.equal(dueLabel('2026-09-26', '2026-09-26'), 'Due today');
  assert.equal(dueLabel('2026-09-27', '2026-09-26'), 'Due tomorrow');
  assert.equal(dueLabel('2026-10-02', '2026-09-26'), 'Due Fri');
  assert.equal(dueLabel('2026-10-12', '2026-09-26'), 'Due Oct 12');
  assert.equal(dueLabel('2026-09-24', '2026-09-26'), 'Was due Thu');
  assert.equal(dueLabel(null, '2026-09-26'), '');
  assert.deepEqual(assignedCardCopy({ lesson_id: 'carbs-are-fuel', from: 'Coach Grinch', due_on: '2026-10-02' }, '2026-09-26'),
    { from: 'From Coach Grinch', title: 'Carbs are fuel', meta: '1 min · Due Fri' });
  assert.deepEqual(assignedCardCopy({ lesson_id: 'carbs-are-fuel', from: '' }, '2026-09-26'),
    { from: 'From Your coach', title: 'Carbs are fuel', meta: '1 min' });
});

/* ---------------- review fix round (2026-09-26) ---------------- */

test('fix: Intuitive readers never see the scale or the percent figures', () => {
  for (const l of LESSONS) {
    for (const a of AUDIENCES.filter((x) => x.intuitive)) {
      const v = lessonFor(l.id, a);
      for (const t of [...v.cards, v.check.q, v.check.why, ...v.check.options]) {
        assert.doesNotMatch(t, /\bweigh(?:ing)?\b|\bpounds?\b|\bpercent\b|%/i, `${l.id} for ${a.name}: ${t}`);
      }
    }
  }
});

test('fix: the snack example really reaches 15 grams, and breakfast makes no appetite promise', () => {
  const snack = lessonFor('snacks-that-count', { intuitive: false, minor: false }).cards.join(' ');
  assert.match(snack, /chocolate milk and a string cheese/i);
  assert.doesNotMatch(snack, /chocolate milk with a granola bar/i, 'about 10 g is not a 15 g example');
  const breakfast = lessonFor('breakfast-that-holds', { intuitive: false, minor: false }).cards.join(' ');
  assert.doesNotMatch(breakfast, /week or two/);
  assert.match(breakfast, /many athletes find/i);
});
