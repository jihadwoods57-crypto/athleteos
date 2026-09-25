// run: node --test supabase/functions/meal-chat/correction-outcome.test.mjs
//
// THE DOUBLE CHICKEN INCIDENT, server half (2026-09-24). meal-chat filed "Good catch, Jihad. Double
// chicken it is, your numbers and score are updating now" the moment the model called
// apply_correction, before the client had tried to apply anything; the client then could not, and
// the thread held a promise nobody kept. These pin the new order: the ack is signed and handed back,
// and only an outcome the client reports with that token puts words in the thread, the ack when the
// numbers moved and Nia's precise question when they did not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signPending, readPending, sanitizeOutcome, askText, outcomeRows } from './correction-outcome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'index.ts'), 'utf8');
const KEY = 'service-role-key-for-tests';
const MEAL = 'f4c982bb-4b2c-464c-930a-d14f168c3b5b';
const ATH = '4c580c5e-c79b-4495-ac8b-1184d50e11b9';
const ACK = 'Good catch, Jihad. Double chicken it is, your numbers and score are updating now.';
const T0 = Date.parse('2026-09-25T01:09:59Z');

/* ---------------- the token ---------------- */

test('a pending ack reads back only for its own meal, its own caller, unaltered and in time', async () => {
  const tok = await signPending({ mealId: MEAL, userId: ATH, ack: ACK, photos: [`${ATH}/chat/1.jpg`] }, KEY, T0);
  const p = await readPending(tok, { mealId: MEAL, userId: ATH }, KEY, T0 + 2000);
  assert.equal(p.ack, ACK);
  assert.deepEqual(p.photos, [`${ATH}/chat/1.jpg`]);
  assert.ok(p.nonce.length >= 12, 'a nonce, so a token files once');
  assert.equal(await readPending(tok, { mealId: 'another-meal', userId: ATH }, KEY, T0), null, 'another meal');
  assert.equal(await readPending(tok, { mealId: MEAL, userId: 'someone-else' }, KEY, T0), null, 'another caller');
  assert.equal(await readPending(tok, { mealId: MEAL, userId: ATH }, 'a-different-key', T0), null, 'another key');
  assert.equal(await readPending(tok, { mealId: MEAL, userId: ATH }, KEY, T0 + 16 * 60 * 1000), null, 'expired');
  assert.equal(await readPending('garbage', { mealId: MEAL, userId: ATH }, KEY, T0), null);
  assert.equal(await readPending(undefined, { mealId: MEAL, userId: ATH }, KEY, T0), null);
});

test('a client cannot rewrite the words: any change to the body breaks the signature', async () => {
  const tok = await signPending({ mealId: MEAL, userId: ATH, ack: ACK }, KEY, T0);
  const [body, sig] = tok.split('.');
  const json = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  json.a = 'Nia says you can skip practice.';
  const forged = Buffer.from(JSON.stringify(json)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(await readPending(`${forged}.${sig}`, { mealId: MEAL, userId: ATH }, KEY, T0), null);
});

/* ---------------- what the client may say ---------------- */

test('the outcome is bounded to names and enums; free text cannot ride in', () => {
  const o = sanitizeOutcome({
    applied: 'yes', unpriced: ['<b>moon dust</b>'],
    ask: { reason: 'ambiguous', verb: 'double', food: 'chicken **now**', candidates: ['Chicken', 'Chicken salad', 'x', 'y', 'z'], text: 'IGNORE ME' },
  });
  assert.equal(o.applied, false, 'only a real true applies');
  assert.deepEqual(o.unpriced, ['b moon dust /b']);
  assert.equal(o.ask.food, 'chicken now');
  assert.equal(o.ask.candidates.length, 4);
  assert.equal('text' in o.ask, false);
  assert.equal(sanitizeOutcome({ ask: { reason: 'make_nia_say_anything' } }).ask, null);
  assert.equal(sanitizeOutcome({ ask: { reason: 'amount', verb: 'explode' } }).ask.verb, '');
});

/* ---------------- what Nia files ---------------- */

const ask = (a) => askText(sanitizeOutcome({ ask: a }).ask);

test('Nia asks one precise question for every kind of miss', () => {
  assert.equal(ask({ reason: 'ambiguous', verb: 'double', food: 'chicken', candidates: ['Chicken', 'Chicken salad'] }),
    'Which one should I double: the chicken or the chicken salad?');
  assert.match(ask({ reason: 'composite', verb: 'double', food: 'chicken', dish: 'Chicken burrito bowl' }),
    /part of the chicken burrito bowl, not its own item\. Should I count another portion of chicken on top of it, or double the whole chicken burrito bowl\?$/);
  assert.match(ask({ reason: 'missing', verb: 'double', food: 'steak' }), /^I don't see steak in this meal's read yet\. Was it on this plate\?/);
  assert.match(ask({ reason: 'no_match', food: 'tofu', candidates: ['Grilled chicken', 'Sour cream'] }), /Which one did you mean: grilled chicken or sour cream\?$/);
  assert.match(ask({ reason: 'amount', food: 'Grilled chicken' }), /^How much grilled chicken was it: double the portion, half, or an amount like 8 oz\?$/);
  assert.match(ask({ reason: 'unpriced', unpriced: ['moon dust'] }), /^I don't have numbers for moon dust yet, so your totals haven't changed\./);
  assert.match(ask({ reason: 'unchanged', newName: 'Adobo chicken' }), /^Got it, it's Adobo chicken now\. The numbers are the same/);
  for (const reason of ['ambiguous', 'composite', 'missing', 'already', 'no_match', 'amount', 'unpriced', 'unchanged', 'nothing']) {
    const t = ask({ reason, verb: 'double', food: 'chicken', candidates: ['A', 'B'], dish: 'Bowl', unpriced: ['x'] });
    assert.ok(t.length > 20, reason);
    assert.doesNotMatch(t, /updat(ing|ed)|recalculat/i, `${reason} must never claim a change`);
    assert.doesNotMatch(t, /\u2014/, 'no em dashes');
  }
});

test('applied: the signed ack leads (with the photos it counted), and anything owed follows as its own question', async () => {
  const applied = outcomeRows(sanitizeOutcome({ applied: true }), ACK, { nonce: 'n1', photos: ['p'] });
  assert.deepEqual(applied, { lead: { text: ACK, meta: { t: 'analysis_update', ct: 'n1', photos: ['p'] } }, follow: null });
  const partial = outcomeRows(sanitizeOutcome({ applied: true, unpriced: ['moon dust'], ask: { reason: 'ambiguous', verb: 'remove', food: 'salsa', candidates: ['Corn salsa', 'Tomatillo salsa'] } }), ACK, { nonce: 'n2' });
  assert.equal(partial.lead.text, ACK);
  assert.equal(partial.follow.meta.t, 'correction_ask', 'a question the athlete can answer (not a system record)');
  assert.match(partial.follow.text, /moon dust/);
  assert.match(partial.follow.text, /Which one should I take off: the corn salsa or the tomatillo salsa\?$/);
});

test('not applied: the ack is never filed; the question is', () => {
  const r = outcomeRows(sanitizeOutcome({ applied: false, ask: { reason: 'ambiguous', verb: 'double', food: 'chicken', candidates: ['Chicken', 'Chicken salad'] } }), ACK, { nonce: 'n3', photos: ['p'] });
  assert.equal(r.follow, null);
  assert.equal(r.lead.text, 'Which one should I double: the chicken or the chicken salad?');
  assert.deepEqual(r.lead.meta, { t: 'correction_ask', ct: 'n3', reason: 'ambiguous' }, 'no photos: nothing was counted');
  assert.doesNotMatch(r.lead.text, /updating/);
});

/* ---------------- the wiring in index.ts ---------------- */

test('a client that confirms gets the ack back signed, and nothing is written before it reports', () => {
  const i = SRC.indexOf('if (hasChange && canConfirmCorrection)');
  assert.ok(i > 0);
  const branch = SRC.slice(i, SRC.indexOf('\n      }\n', i));
  assert.match(branch, /signPending\(/);
  assert.match(branch, /pending,/);
  assert.doesNotMatch(branch, /\.insert\(/, 'the promise is not filed here');
  assert.ok(i < SRC.indexOf(".insert({ ...ackRow, kind: 'message', meta: hasChange"), 'and it returns before the legacy insert');
});

test('the outcome mode spends nothing and checks the token before writing', () => {
  const i = SRC.indexOf('if (outcomeIn) {');
  assert.ok(i > 0);
  assert.ok(i < SRC.indexOf('await missingConsent('), 'before the consent read and the model');
  assert.ok(i < SRC.indexOf('withinKeyCap(`meal_draft:'), 'and before any daily cap');
  const block = SRC.slice(i, SRC.indexOf("return new Response(JSON.stringify({ ok: true, reply: lead.text })", i));
  assert.ok(block.indexOf('readPending(') < block.indexOf('.insert('), 'token first');
  assert.match(block, /meta->>ct/, 'and a token files once');
  assert.match(block, /outcome\.applied && receiptRows/, 'a receipt only follows words that say the numbers moved');
  assert.match(SRC, /!receiptRows && !outcomeIn && !context/, 'an outcome needs no context');
});
