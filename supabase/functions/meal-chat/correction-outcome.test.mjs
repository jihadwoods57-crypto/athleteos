// run: node --test supabase/functions/meal-chat/correction-outcome.test.mjs
//
// THE DOUBLE CHICKEN INCIDENT, server half (2026-09-24). meal-chat filed "Good catch, Jihad. Double
// chicken it is, your numbers and score are updating now" the moment the model called
// apply_correction, before the client had tried to apply anything; the client then could not, and
// the thread held a promise nobody kept. These pin the new order: the ack is signed and handed back,
// and only an outcome the client reports with that token puts words in the thread, the ack when the
// numbers moved exactly as described, a sentence built from what landed when they moved some other
// way, and what is true when they did not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  signPending, readPending, correctionHash, allowedNames, sanitizeOutcome, askText, outcomeRows, composeDone, stillHappening, stripName,
} from './correction-outcome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// CRLF-normalised: a Windows checkout (autocrlf) otherwise misses every '\n'-anchored slice below.
const SRC = readFileSync(join(HERE, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = readFileSync(join(HERE, '..', '..', 'migrations', '0249_meal_comment_ct_unique.sql'), 'utf8');
const KEY = 'service-role-key-for-tests';
const MEAL = 'f4c982bb-4b2c-464c-930a-d14f168c3b5b';
const ATH = '4c580c5e-c79b-4495-ac8b-1184d50e11b9';
const ACK = 'Good catch, Jihad. Double chicken it is, your numbers and score are updating now.';
const T0 = Date.parse('2026-09-25T01:09:59Z');
const CORR = { item: 'Grilled chicken', newName: null, quantity: 'double', per: { protein: null, kcal: null, carbs: null, fat: null }, perBasis: 'stated', add: [], more: [], missed: [] };
const DETECTED = [{ name: 'Grilled chicken' }, { name: 'Romaine lettuce' }, { name: 'Roasted corn salsa' }, { name: 'Tomatillo salsa' }, { name: 'Sour cream' }];
const ALLOWED = allowedNames(CORR, DETECTED);

/* ---------------- the token ---------------- */

test('a pending ack reads back only for its own meal, its own caller, unaltered and in time', async () => {
  const tok = await signPending({ mealId: MEAL, userId: ATH, ack: ACK, photos: [`${ATH}/chat/1.jpg`], correction: CORR }, KEY, T0);
  const p = await readPending(tok, { mealId: MEAL, userId: ATH }, KEY, T0 + 2000);
  assert.equal(p.ack, ACK);
  assert.deepEqual(p.photos, [`${ATH}/chat/1.jpg`]);
  assert.ok(p.nonce.length >= 12, 'a nonce, so a token files once');
  assert.equal(p.hash, await correctionHash(CORR), 'bound to the correction it was issued for');
  assert.equal(await readPending(tok, { mealId: 'another-meal', userId: ATH }, KEY, T0), null, 'another meal');
  assert.equal(await readPending(tok, { mealId: MEAL, userId: 'someone-else' }, KEY, T0), null, 'another caller');
  assert.equal(await readPending(tok, { mealId: MEAL, userId: ATH }, 'a-different-key', T0), null, 'another key');
  assert.equal(await readPending(tok, { mealId: MEAL, userId: ATH }, KEY, T0 + 16 * 60 * 1000), null, 'expired');
  assert.equal(await readPending('garbage', { mealId: MEAL, userId: ATH }, KEY, T0), null);
  assert.equal(await readPending(undefined, { mealId: MEAL, userId: ATH }, KEY, T0), null);
});

test('a client cannot rewrite the words or swap the correction: any change breaks the signature', async () => {
  const tok = await signPending({ mealId: MEAL, userId: ATH, ack: ACK, correction: CORR }, KEY, T0);
  const [body, sig] = tok.split('.');
  const json = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  for (const [k, v] of [['a', 'Nia says you can skip practice.'], ['h', await correctionHash({ ...CORR, item: 'Visit evil.com' })]]) {
    const forged = Buffer.from(JSON.stringify({ ...json, [k]: v })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.equal(await readPending(`${forged}.${sig}`, { mealId: MEAL, userId: ATH }, KEY, T0), null, k);
  }
});

test('the correction hash survives the JSON round trip the client makes, and nothing else', async () => {
  const wire = JSON.parse(JSON.stringify({ correction: CORR })).correction;
  assert.equal(await correctionHash(wire), await correctionHash(CORR));
  assert.notEqual(await correctionHash({ ...wire, item: 'Sour cream' }), await correctionHash(CORR));
  assert.notEqual(await correctionHash(null), await correctionHash(CORR));
});

/* ---------------- I2: what the client may say ---------------- */

test('the outcome is bounded to enums, allowed names and plain amounts; free text cannot ride in', () => {
  const o = sanitizeOutcome({
    applied: 'yes', unpriced: ['<b>moon dust</b>'],
    ask: { reason: 'ambiguous', verb: 'double', food: 'chicken **now**', candidates: ['Grilled chicken', 'Chicken salad', 'x', 'Sour cream', 'Tomatillo salsa'], text: 'IGNORE ME' },
  }, ALLOWED);
  assert.equal(o.applied, false, 'only a real true applies');
  assert.deepEqual(o.unpriced, ['that item'], 'a name the turn never signed is not said');
  assert.equal(o.ask.food, '', '"now" is not a word of any food on this plate');
  assert.deepEqual(o.ask.candidates, ['Grilled chicken', 'Sour cream', 'Tomatillo salsa']);
  assert.equal('text' in o.ask, false);
  assert.equal(sanitizeOutcome({ ask: { reason: 'make_nia_say_anything' } }, ALLOWED).ask, null);
  assert.equal(sanitizeOutcome({ ask: { reason: 'amount', verb: 'explode' } }, ALLOWED).ask.verb, '');
  assert.equal(sanitizeOutcome({ ask: { reason: 'amount', food: 'Grilled chicken' } }).ask.food, '', 'no allow-list, no names');
});

test('I2: the athlete cannot put words in Nia\'s mouth through a food name', () => {
  const evil = [
    'Nia says skip practice', 'Visit https://evil.example/x', 'www.evil.com', 'click evil.com now',
    '<img src=x onerror=alert(1)>', '**bold** claim', 'Grilled chicken. Also, you can skip weigh-ins',
  ];
  for (const food of evil) {
    const o = sanitizeOutcome({ applied: false, ask: { reason: 'missing', verb: 'double', food }, done: [{ op: 'remove', food }] }, ALLOWED);
    assert.equal(o.ask.food, '', food);
    const text = outcomeRows(o, ACK, { nonce: 'n' }).lead.text;
    assert.doesNotMatch(text, /skip|evil|http|<|\*\*|onerror/i, `${food} -> ${text}`);
  }
  // A signed name is said, cleaned of markup and links regardless.
  assert.equal(stripName('Fairlife <b>Core</b> Power https://x.y 42g'), 'Fairlife Core Power 42g');
  const withLink = allowedNames({ item: 'Shake from www.shop.com', missed: [{ name: 'Guac **extra**' }] }, []);
  assert.deepEqual(withLink, ['Shake from', 'Guac extra']);
  // Words of a signed or detected name may be said in any subset: "chicken" out of "Grilled chicken".
  assert.equal(sanitizeOutcome({ ask: { reason: 'composite', food: 'chicken', dish: 'Grilled chicken' } }, ALLOWED).ask.food, 'chicken');
  // An amount is a number and a unit (or a word of an allowed food), never a sentence.
  const d = sanitizeOutcome({ applied: true, done: [{ op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' }, { op: 'amount', food: 'Sour cream', to: '6 oz of lies' }] }, ALLOWED).done;
  assert.deepEqual(d.map((x) => x.to), ['6 oz', '']);
});

test('I2: the names come from the signed correction and the meal row only', () => {
  const names = allowedNames({ item: 'Grilled chicken', newName: 'Pico de gallo', more: [{ item: 'Sour cream', newName: 'Guacamole' }], add: [{ name: 'cheddar' }], missed: [{ name: 'White rice' }] }, ['Black beans', { name: 'Queso' }]);
  assert.deepEqual(names, ['Grilled chicken', 'Pico de gallo', 'cheddar', 'Sour cream', 'Guacamole', 'White rice', 'Black beans', 'Queso']);
});

/* ---------------- what Nia files ---------------- */

const ask = (a) => askText(sanitizeOutcome({ ask: a }, allowedNames({ item: 'Chicken burrito bowl', missed: [{ name: 'steak' }, { name: 'tofu' }, { name: 'moon dust' }], newName: 'Adobo chicken' }, ['Chicken', 'Chicken salad', 'Grilled chicken', 'Sour cream', 'Corn salsa', 'Tomatillo salsa'])).ask);

test('Nia says one precise thing for every kind of miss', () => {
  assert.equal(ask({ reason: 'ambiguous', verb: 'double', food: 'chicken', candidates: ['Chicken', 'Chicken salad'] }),
    'Which one should I double: the chicken or the chicken salad?');
  assert.match(ask({ reason: 'composite', verb: 'double', food: 'chicken', dish: 'Chicken burrito bowl' }),
    /part of the chicken burrito bowl, not its own item\. Should I count another portion of chicken on top of it, or double the whole chicken burrito bowl\?$/);
  assert.match(ask({ reason: 'missing', verb: 'double', food: 'steak' }), /^I don't see steak in this meal's read yet\. Was it on this plate\?/);
  assert.match(ask({ reason: 'no_match', food: 'tofu', candidates: ['Grilled chicken', 'Sour cream'] }), /Which one did you mean: grilled chicken or sour cream\?$/);
  assert.match(ask({ reason: 'amount', food: 'Grilled chicken' }), /^How much grilled chicken was it: double the portion, half, or an amount like 8 oz\?$/);
  assert.match(ask({ reason: 'unpriced', unpriced: ['moon dust'] }), /^I don't have numbers for moon dust yet, so your totals haven't changed\./);
  assert.match(ask({ reason: 'unchanged', newName: 'Adobo chicken' }), /^Got it, it's adobo chicken now\. The numbers are the same/);
  assert.equal(ask({ reason: 'counted', verb: 'double', food: 'Grilled chicken', amount: '6 oz' }), 'Already counted as a double, 6\u00a0oz.');
  assert.equal(ask({ reason: 'counted', verb: '', food: 'Grilled chicken', amount: '' }), 'The grilled chicken is already in this read, so nothing changed.');
  assert.equal(ask({ reason: 'confirm', verb: 'remove', food: 'chicken', candidates: ['Grilled chicken'] }), 'Should I take the grilled chicken off this meal?');
  for (const reason of ['ambiguous', 'composite', 'missing', 'already', 'no_match', 'amount', 'unpriced', 'unchanged', 'nothing', 'counted', 'confirm']) {
    const t = ask({ reason, verb: 'double', food: 'chicken', candidates: ['Chicken', 'Chicken salad'], dish: 'Chicken burrito bowl', unpriced: ['moon dust'] });
    assert.ok(t.length > 15, reason);
    assert.doesNotMatch(t, /updat(ing|ed)|recalculat/i, `${reason} must never claim a change`);
    assert.doesNotMatch(t, /—/, 'no em dashes');
  }
});

test('R2: an ack still "updating now" is replaced whole by the server\'s lead, never rewritten word by word', () => {
  for (const t of [ACK, 'Got it. Recalculating now.', 'Updating now!', 'Good catch, 42g it is. Updating your numbers and score now.',
    "I'll update your macros now.", 'Your numbers will update now.', 'Two cups, got it, your score is recalculating.', 'Updating your protein, carbs and fat now.']) {
    assert.equal(stillHappening(t), true, t);
    const r = outcomeRows(sanitizeOutcome({ applied: true, exact: true, done: [{ op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' }], correction: CORR }, ALLOWED), t, { nonce: 'n' });
    assert.equal(r.lead.text, 'Doubled the grilled chicken to 6\u00a0oz.', t);
  }
  for (const t of ['Good catch, that is the 42g bottle.', 'Double chicken it is. Your numbers and score are updated.']) assert.equal(stillHappening(t), false, t);
});

test('the composed lead says what landed, in the past tense, and pluralises honestly', () => {
  assert.equal(composeDone([{ op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' }]), 'Doubled the grilled chicken to 6\u00a0oz.');
  assert.equal(composeDone([{ op: 'remove', food: 'Sour cream' }, { op: 'add', food: 'Guacamole' }, { op: 'add', food: 'White rice' }]), 'Took the sour cream off. Added guacamole and white rice.');
  assert.equal(composeDone([{ op: 'scale', verb: 'extra', food: 'Grilled chicken', to: '6 oz' }]), 'Counted extra grilled chicken, 6\u00a0oz now.');
  assert.equal(composeDone([{ op: 'rename', food: 'Roasted corn salsa', newName: 'Pico de gallo' }]), 'Changed the roasted corn salsa to pico de gallo.', 'names are lowercase mid-sentence');
  assert.equal(composeDone([{ op: 'amount', food: '', to: '2 medium bananas' }]), 'Set that item to 2\u00a0medium bananas.');
  assert.equal(composeDone([]), 'Your numbers are updated.');
});

/* ---------------- I5: the ack is checked against the outcome ---------------- */

test('applied exactly as described: the signed ack leads, verbatim (with the photos it counted)', () => {
  const ack = 'Good catch, Jihad. Double chicken it is. Your numbers and score are updated.';
  const o = sanitizeOutcome({ applied: true, exact: true, done: [{ op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' }], correction: CORR }, ALLOWED);
  const r = outcomeRows(o, ack, { nonce: 'n1', photos: ['p'] });
  assert.deepEqual(r, { lead: { text: ack, meta: { t: 'analysis_update', ct: 'n1', photos: ['p'] } }, follow: null });
});

test('R2 I5: the client\'s "exact" is believed only when what landed covers the signed correction', () => {
  const ack = 'Good catch, Jihad. Double chicken it is. Your numbers and score are updated.';
  const lead = (o) => outcomeRows(sanitizeOutcome({ applied: true, exact: true, correction: CORR, ...o }, ALLOWED), ack, { nonce: 'n' }).lead.text;
  assert.equal(lead({ done: [] }), 'Your numbers are updated.', 'nothing landed: not the model\'s words');
  assert.equal(lead({ done: [{ op: 'remove', food: 'Sour cream' }] }), 'Took the sour cream off.', 'landed, but not the part the model described');
  assert.equal(lead({ applied: false, done: [{ op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' }] }) === ack, false);
  const both = { ...CORR, missed: [{ name: 'Guacamole' }] };
  const two = allowedNames(both, DETECTED);
  const r = outcomeRows(sanitizeOutcome({ applied: true, exact: true, correction: both, done: [{ op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' }] }, two), ack, { nonce: 'n' });
  assert.equal(r.lead.text, 'Doubled the grilled chicken to 6\u00a0oz.', 'the guacamole the model promised never landed');
  assert.equal(outcomeRows(sanitizeOutcome({ applied: true, exact: true, correction: both, done: [{ op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' }, { op: 'add', food: 'Guacamole' }] }, two), ack, { nonce: 'n' }).lead.text, ack);
});

test('R2 I2: a name is checked whole: tags stripped, and every word from ONE allowed food', () => {
  const nm = (food) => sanitizeOutcome({ applied: true, done: [{ op: 'remove', food }] }, ALLOWED).done[0].food;
  assert.equal(nm('<b>Grilled chicken</b>'), 'Grilled chicken', 'no "b grilled chicken /b"');
  assert.equal(nm('**Grilled** chicken'), 'Grilled chicken');
  assert.equal(nm('sour chicken lettuce'), '', 'not stitched from three foods');
  assert.equal(nm('grilled cream'), '');
  assert.equal(nm('Your coach'), '');
  assert.equal(nm('grilled chicken evil.ru'), 'grilled chicken', 'any domain goes');
});

test('R2: an amount is a real, plate-sized number and a unit, and reads like a cook says it', () => {
  const to = (v) => sanitizeOutcome({ applied: true, done: [{ op: 'amount', food: 'Grilled chicken', to: v }] }, allowedNames({ ...CORR, missed: [{ name: 'Banana' }] }, DETECTED)).done[0].to;
  for (const bad of ['0 oz', '0 cups', '1/0 cup', '-6 oz', '99999 oz', '65 oz', '2001 g', '11 cups', '31 tbsp', '61 tsp', '13 servings', '13 pieces', '6 grilled chicken', '6 of lies']) {
    assert.equal(to(bad), '', bad);
  }
  assert.equal(to('8 fl oz'), '8 fl oz');
  assert.equal(to('150 g'), '150 g');
  assert.equal(to('0.5 cup'), '1/2 cup');
  assert.equal(to('1.5 cups'), '1 1/2 cups');
  assert.equal(to('2 medium bananas'), '2 medium bananas');
  assert.equal(to('3 eggs'), '3 eggs');
  assert.equal(composeDone([{ op: 'amount', food: 'Rice', to: '1 1/2 cups' }]), 'Set the rice to 1\u00a01/2\u00a0cups.', 'one line, never "1" and "1/2 cups" apart');
});

test('R2: two foods with no numbers are "their", and names are lowercase in the middle of a sentence', () => {
  const r = outcomeRows(sanitizeOutcome({ applied: true, done: [{ op: 'add', food: 'Sour cream' }], unpriced: ['Grilled chicken', 'Romaine lettuce'] }, ALLOWED), ACK, { nonce: 'n' });
  assert.equal(r.follow.text, "I don't have numbers for grilled chicken and romaine lettuce yet, so those parts aren't counted. What are their protein and calories?");
  const one = outcomeRows(sanitizeOutcome({ applied: true, done: [{ op: 'add', food: 'Sour cream' }], unpriced: ['Grilled chicken'] }, ALLOWED), ACK, { nonce: 'n' });
  assert.match(one.follow.text, /for grilled chicken yet, so that part isn't counted\. What are its protein/);
});

test('I5: a part that became a question: the lead is composed from what landed, and the question follows', () => {
  const o = sanitizeOutcome({
    applied: true, exact: false, done: [{ op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' }],
    asks: [{ reason: 'ambiguous', verb: 'remove', food: 'salsa', candidates: ['Roasted corn salsa', 'Tomatillo salsa'] }],
  }, ALLOWED);
  const r = outcomeRows(o, ACK, { nonce: 'n2' });
  assert.equal(r.lead.text, 'Doubled the grilled chicken to 6\u00a0oz.', 'never the model\'s ack, which described something else');
  assert.equal(r.lead.meta.ct, 'n2');
  assert.equal(r.follow.meta.t, 'correction_ask', 'a question the athlete can answer (not a system record)');
  assert.equal(r.follow.meta.ct, 'n2:q', 'each row files once on its own ct');
  assert.equal(r.follow.text, 'Which one should I take off: the roasted corn salsa or the tomatillo salsa?');
  // A client claiming exact while asking something is not believed on the words.
  const lie = outcomeRows(sanitizeOutcome({ applied: true, exact: true, done: [], unpriced: ['moon dust'] }, ALLOWED), ACK, { nonce: 'n' });
  assert.match(lie.follow.text, /that item/);
});

test('not applied: the ack is never filed; what is true is', () => {
  const r = outcomeRows(sanitizeOutcome({ applied: false, ask: { reason: 'ambiguous', verb: 'double', food: 'chicken', candidates: ['Grilled chicken', 'Sour cream'] } }, ALLOWED), ACK, { nonce: 'n3', photos: ['p'] });
  assert.equal(r.follow, null);
  assert.equal(r.lead.text, 'Which one should I double: the grilled chicken or the sour cream?');
  assert.deepEqual(r.lead.meta, { t: 'correction_ask', ct: 'n3', reason: 'ambiguous' }, 'no photos: nothing was counted');
  assert.doesNotMatch(r.lead.text, /updat/);
  // C1: the second "double chicken" is already counted. No receipt, no numbers, no "updated".
  const c1 = outcomeRows(sanitizeOutcome({ applied: false, asks: [{ reason: 'counted', verb: 'double', food: 'Grilled chicken', amount: '6 oz' }] }, ALLOWED), ACK, { nonce: 'n4' });
  assert.equal(c1.lead.text, 'Already counted as a double, 6\u00a0oz.');
  assert.equal(c1.follow, null);
});

/* ---------------- the wiring in index.ts ---------------- */

test('a client that confirms gets the ack back signed and bound to the correction; nothing is written before it reports', () => {
  const i = SRC.indexOf('if (hasChange && canConfirmCorrection)');
  assert.ok(i > 0);
  const branch = SRC.slice(i, SRC.indexOf('\n      }\n', i));
  assert.match(branch, /signPending\(\{ mealId, userId: callerId, ack: text, photos: photoKeys, correction:/);
  assert.match(branch, /pending, correction \}/, 'the same object that was signed goes back');
  assert.doesNotMatch(branch, /\.insert\(/, 'the promise is not filed here');
  assert.ok(i < SRC.indexOf(".insert({ ...ackRow, kind: 'message', meta: hasChange"), 'and it returns before the legacy insert');
});

test('I1: only a confirming client is told "double" is fine; an older one keeps the master tool, word for word', () => {
  const base = SRC.slice(SRC.indexOf('const CORRECTION_TOOL = {'), SRC.indexOf('const CORRECTION_TOOL_CONFIRM = {'));
  assert.doesNotMatch(base, /"double", "half" or "2x" is fine/, 'an old client files the ack at once and cannot apply a word');
  assert.match(base, /say their numbers and score are updating now/, 'the master ack wording, unchanged, for the client that still files at once');
  const conf = SRC.slice(SRC.indexOf('const CORRECTION_TOOL_CONFIRM = {'), SRC.indexOf('// Coach OS Slice D draft mode'));
  assert.match(conf, /"double", "half" or "2x" is fine/);
  assert.match(conf, /past tense, never "updating now"/);
  assert.match(SRC, /canApplyCorrection \? \[canConfirmCorrection \? CORRECTION_TOOL_CONFIRM : CORRECTION_TOOL\] : \[\]/);
});

test('the outcome mode spends nothing, checks the token and its correction before writing, and files each row once', () => {
  const i = SRC.indexOf('if (outcomeIn) {');
  assert.ok(i > 0);
  assert.ok(i < SRC.indexOf('await missingConsent('), 'before the consent read and the model');
  assert.ok(i < SRC.indexOf('withinKeyCap(`meal_draft:'), 'and before any daily cap');
  const block = SRC.slice(i, SRC.indexOf('return ok({ reply: lead.text, receipt, question', i));
  assert.ok(block.indexOf('readPending(') < block.indexOf('.insert('), 'token first');
  assert.ok(block.indexOf('correctionHash(outcomeIn.correction') < block.indexOf('.insert('), 'bound to its turn\'s correction');
  assert.match(block, /allowedNames\(outcomeIn\.correction, detRow\?\.detected\)/, 'names from the signed correction and the meal row');
  assert.match(block, /meta->>ct/, 'and a token files once');
  assert.match(block, /outcome\.applied && receiptRows/, 'a receipt only follows words that say the numbers moved');
  assert.match(block, /ct: `\$\{pending\.nonce\}:r`/, 'the receipt has a ct of its own');
  assert.match(block, /if \(leadErr && leadErr\.code !== '23505'\) return bad\(503/, 'a lost race is "already filed", not an error');
  assert.doesNotMatch(block, /insert\(\{ \.\.\.base, text: row\.text \}\)/, 'never a fallback insert without meta');
  assert.doesNotMatch(block, /recordAiCall\(/, 'no zero-token ai_calls row: ai_calls is one row per paid call');
  assert.match(block, /const put = async .*return !e \|\| e\.code === '23505'; \};/, 'the device is told when its receipt did not land (R2)');
  assert.match(SRC, /receiptCt = !coachReceiptIn && typeof body\?\.receiptCt === 'string' && \/\^\[A-Za-z0-9_-\]\{8,40\}:f\$\/\.test/, 'a fallback receipt files under nonce:f');
  assert.match(SRC, /recErr && recErr\.code === '23505' && receiptCt/, 'and a second copy of it is "already filed"');
  assert.match(SRC, /!receiptRows && !outcomeIn && !context/, 'an outcome needs no context');
});

test('0249 closes the one-time race: a unique partial index on meta->>ct, additive and idempotent', () => {
  const sql = MIGRATION.replace(/--.*$/gm, '');
  assert.match(sql, /create unique index if not exists meal_comments_ct_once\s+on public\.meal_comments \(\(meta->>'ct'\)\)\s+where meta \? 'ct';/);
  assert.doesNotMatch(sql, /\bdrop\b|\balter table\b|\bdelete\b|\bupdate\b/i, 'additive only');
});

/* ============================ REVIEW ROUND 3 (2026-09-25) ============================
 * rr/i3.mjs and rr/i4.mjs, pinned. */

test('R3 I3: accented names are kept whole (jalapeño, açaí, crème brûlée)', () => {
  const det = [{ name: 'Jalapeño poppers' }, { name: 'Açaí bowl' }, { name: 'Crème brûlée' }, { name: 'Pão de queijo' }];
  const allowed = allowedNames({ item: 'Jalapeño poppers', quantity: '0' }, det);
  assert.deepEqual(allowed.slice(1), ['Jalapeño poppers', 'Açaí bowl', 'Crème brûlée', 'Pão de queijo']);
  const said = (food) => composeDone(sanitizeOutcome({ applied: true, done: [{ op: 'remove', food }] }, allowed).done);
  assert.equal(said('Jalapeño poppers'), 'Took the jalapeño poppers off.');
  assert.equal(said('Açaí bowl'), 'Took the açaí bowl off.');
  assert.equal(said('Crème brûlée'), 'Took the crème brûlée off.');
  assert.equal(said('Grilled chícken'), 'Took that item off.', 'an accent does not smuggle in a word the turn never signed');
});

test('R3: "&" stays in a name ("mac & cheese")', () => {
  const allowed = allowedNames({}, [{ name: 'Mac & cheese' }]);
  assert.deepEqual(allowed, ['Mac & cheese']);
  assert.equal(composeDone(sanitizeOutcome({ applied: true, done: [{ op: 'remove', food: 'Mac & cheese' }] }, allowed).done), 'Took the mac & cheese off.');
});

test('R3: fractions and plural units and counts are amounts', () => {
  const allowed = allowedNames({}, [{ name: 'Rice' }, { name: 'Breakfast sandwich' }, { name: 'Protein shake' }, { name: 'Flour tortillas' }]);
  const to = (v) => sanitizeOutcome({ applied: true, done: [{ op: 'amount', food: 'Rice', to: v }] }, allowed).done[0].to;
  for (const [v, want] of [['1/2 cup', '1/2 cup'], ['3/4 cup', '3/4 cup'], ['1 1/2 cups', '1 1/2 cups'], ['2 bottles', '2 bottles'], ['2 pieces', '2 pieces'],
    ['2 slices', '2 slices'], ['2 scoops', '2 scoops'], ['2 sandwiches', '2 sandwiches'], ['3 eggs', '3 eggs'], ['2 tortillas', '2 tortillas'], ['8 fl oz', '8 fl oz']]) {
    assert.equal(to(v), want, v);
  }
  for (const bad of ['1/0 cup', '0/4 cup', '1 1/0 cups', '13 slices', '6 of lies']) assert.equal(to(bad), '', bad);
  assert.equal(composeDone([{ op: 'scale', verb: 'half', food: 'Rice', to: to('1/2 cup') }]), 'Halved the rice to 1/2 cup.');
});

test('R3: covers() checks the operation on the same food, not a shared word', () => {
  const corr = { item: 'Grilled chicken', newName: null, quantity: 'double', per: { protein: null }, perBasis: 'stated', add: [], more: [{ item: 'Chicken salad', quantity: '0' }], missed: [] };
  const allowed = allowedNames(corr, [{ name: 'Grilled chicken' }, { name: 'Chicken salad' }]);
  const exact = (done) => sanitizeOutcome({ applied: true, exact: true, correction: corr, done }, allowed).exact;
  const dbl = { op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' };
  const off = { op: 'remove', food: 'Chicken salad' };
  assert.equal(exact([dbl, off]), true, 'both parts landed as described');
  assert.equal(exact([dbl]), false, 'the chicken salad was never taken off');
  assert.equal(exact([off]), false, 'the chicken was never doubled');
  assert.equal(exact([{ op: 'remove', food: 'Grilled chicken' }, off]), false, 'the chicken was removed, not doubled');
});

test('R3: stillHappening() is about an update in progress, not the word "changing"', () => {
  for (const t of ['Changing the chicken to steak was the right call.', 'Keep changing it up.', 'Your numbers are updated.']) assert.equal(stillHappening(t), false, t);
  for (const t of ['Updating your numbers now.', 'Your score is changing now.', 'Your macros are recalculating.']) assert.equal(stillHappening(t), true, t);
});

test('R3: a retried report fills in whatever of its rows is missing, and says what it could not file', () => {
  const i = SRC.indexOf('if (outcomeIn) {');
  const block = SRC.slice(i, SRC.indexOf('return ok({ reply: lead.text, receipt, question });', i));
  assert.match(block, /const has = async \(ct: string\)/, 'each row looked up by its own ct');
  assert.match(block, /await has\(`\$\{pending\.nonce\}:r`\)\) \|\| \(await has\(`\$\{pending\.nonce\}:f`\)\)/, 'a receipt is the server\'s or the device\'s fallback');
  assert.match(block, /question = \(await has\(`\$\{pending\.nonce\}:q`\)\) \|\| await put\(follow\)/, 'a follow-up that failed to file is reported (question: false)');
  assert.doesNotMatch(block, /duplicate: true \}\);\s*\/\/ Names/, 'a duplicate no longer returns before checking the receipt');
});

test('R4 I2: a meal read that failed is a 503 (retry), not a 403 (refused)', () => {
  const i = SRC.indexOf("const { data: mealRow, error: mealErr } = await userClient.from('meals')");
  assert.ok(i > 0);
  const next = SRC.slice(i, i + 700);
  assert.ok(next.indexOf("if (mealErr) return bad(503, 'unavailable', cors);") < next.indexOf("if (!mealRow) return bad(403, 'unauthorized', cors);"));
});
