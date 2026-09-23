/* I3: only consented words reach the model; everyone else is a role word and a placeholder.
 * Run: node --test supabase/functions/meal-chat/consent-scrub.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrubContext, scrubRows, authorIds, placeholderFor, roleWord } from './consent-scrub.mjs';

const OWNER = 'ath', COACH = 'c1', PARENT = 'p1', RUDE = 'bad';

test('context thread: consented kept, others a placeholder with no text, no name, no photo', () => {
  const ctx = { meal: { name: 'Lunch' }, thread: [
    { senderId: OWNER, senderName: 'Jay Cole', senderRole: 'athlete', text: 'rice and chicken' },
    { senderId: PARENT, senderName: 'Dana Cole', senderRole: 'parent', text: 'he skipped breakfast', photo: true, mentions: ['ai'], replyToSender: 'Jay' },
    { senderId: RUDE, senderName: 'Bad Actor', senderRole: 'coach', text: 'nope' },
    { role: 'ai', text: 'Solid plate.' },
    { role: 'coach', text: 'unattributed coach line' },
    { role: 'athlete', text: 'owner line without id' },
  ] };
  const out = scrubContext(ctx, { consented: new Set([OWNER]), ownerId: OWNER, blocked: new Set([RUDE]) });
  const s = JSON.stringify(out);
  assert.doesNotMatch(s, /Dana|skipped breakfast|Bad Actor|nope|unattributed/);
  assert.equal(out.thread.length, 5, 'the blocked author is dropped');
  const parent = out.thread[1];
  assert.equal(parent.text, '[a message from the parent]');
  assert.equal(parent.senderName, 'the parent');
  assert.equal(parent.photo, false);
  assert.equal(parent.mentions, undefined);
  assert.equal(out.thread[2].text, 'Solid plate.', 'AI rows kept');
  assert.equal(out.thread[3].text, '[a message from the coach]', 'no id and not the owner: not provably consented');
  assert.equal(out.thread[4].text, 'owner line without id');
  assert.equal(out.meal.name, 'Lunch');
});

test('database rows: placeholders keep the row, drop the text and the photo; AI rows always kept', () => {
  const rows = [
    { id: 1, role: 'athlete', author_id: OWNER, text: 'my lunch', meta: { photo: 'ath/x.jpg' } },
    { id: 2, role: 'coach', author_id: COACH, text: 'second coach private note', meta: { photo: 'c1/y.jpg' } },
    { id: 3, role: 'ai', author_id: COACH, text: 'AI answer' },
    { id: 4, role: 'coach', author_id: RUDE, text: 'rude' },
  ];
  const { rows: out } = scrubRows(rows, { consented: new Set([OWNER]), blocked: new Set([RUDE]) });
  assert.equal(out.length, 3);
  assert.equal(out[1].text, '[a message from the coach]');
  assert.equal(out[1].meta.photo, undefined);
  assert.equal(out[0].meta.photo, 'ath/x.jpg');
  assert.equal(out[2].text, 'AI answer');
  assert.deepEqual(authorIds({ thread: [{ senderId: 'x' }] }, rows).sort(), ['ath', 'bad', 'c1', 'x']);
  assert.equal(roleWord('Dietitian'), 'dietitian');
  assert.equal(placeholderFor('mystery'), '[a message from someone in the thread]');
});

test('meal-chat wires the scrub into every prompt source and names only consented people', () => {
  const src = readFileSync(join(process.cwd(), 'supabase', 'functions', 'meal-chat', 'index.ts'), 'utf8');
  assert.match(src, /JSON\.stringify\(promptContext\)/);
  assert.doesNotMatch(src, /Context \(deterministic, computed by the app\):\\n\$\{JSON\.stringify\(context\)\}/);
  assert.match(src, /threadRows = scrubRows\(raw, \{ consented: threadConsented, blocked: ownerBlocked \}\)\.rows/);
  assert.match(src, /threadConsented\.has\(v\)/);
});
