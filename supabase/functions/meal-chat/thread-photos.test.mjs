// run: node --test supabase/functions/meal-chat/thread-photos.test.mjs
//
// THE 12:44 INCIDENT, server half (2026-09-22). The coach's "Make sure that gets added in" and
// "The nutrition facts is in the picture" reached a model that had never been shown the athlete's
// photo, because only an image attached to the CURRENT message was ever sent. These pin that a
// coach_ask turn now sees the thread's photo, under the same key and folder rules as before, and
// that a coach-requested addition is refused unless the athlete's own message grounds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pickThreadPhotos, additionGrounds, validateCoachAddition, sanitizeFood, additionReceiptText,
  photoKeyOk, appliedPhotoKeys, threadTranscript, requesterLabel, firstName, photoPreamble,
} from './thread-photos.mjs';
import { gateVerdict } from './addressing-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ATH = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const COACH = 'cccccccc-2222-4222-8222-cccccccccccc';
const OTHER = 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee';
const SHAKE = `${ATH}/chat/1790095466714.jpg`;
const NOW = Date.parse('2026-09-22T17:31:30Z');

// The lunch thread as prod held it when the coach asked (newest last).
const LUNCH = [
  { id: 'r1', role: 'ai', author_id: ATH, text: 'Solid lunch...', kind: 'message', meta: { t: 'analysis' }, created_at: '2026-09-22T16:43:57Z' },
  { id: 'r2', role: 'athlete', author_id: ATH, text: "I'm also drinking this", kind: 'message', meta: { photo: SHAKE }, created_at: '2026-09-22T16:44:29Z' },
  { id: 'r3', role: 'coach', author_id: COACH, text: 'Make sure that gets added in', kind: 'message', meta: null, created_at: '2026-09-22T17:29:56Z' },
];

/* ---------------- 2. thread photo memory ---------------- */

test('a coach_ask turn with no attachment receives the athlete\'s photo from the thread', () => {
  const picks = pickThreadPhotos(LUNCH, { athleteId: ATH, callerId: COACH, current: '', now: NOW });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].key, SHAKE);
  assert.equal(picks[0].messageId, 'r2');
  assert.equal(picks[0].text, "I'm also drinking this");
  assert.equal(picks[0].current, false);
});

test('the photo attached to this message comes first, and is never listed twice', () => {
  const mine = `${ATH}/chat/2.jpg`;
  const rows = [...LUNCH, { id: 'r4', role: 'athlete', author_id: ATH, text: '', meta: { photo: mine }, created_at: '2026-09-22T17:40:00Z' }];
  const picks = pickThreadPhotos(rows, { athleteId: ATH, callerId: ATH, current: mine, now: NOW });
  assert.deepEqual(picks.map((p) => p.key), [mine, SHAKE]);
  assert.equal(picks[0].current, true);
});

test('bounded to two, newest first', () => {
  const rows = [1, 2, 3, 4].map((i) => ({ id: `p${i}`, role: 'athlete', author_id: ATH, text: '', meta: { photo: `${ATH}/chat/${i}.jpg` }, created_at: `2026-09-22T17:0${i}:00Z` }));
  const picks = pickThreadPhotos(rows, { athleteId: ATH, callerId: COACH, now: NOW });
  assert.deepEqual(picks.map((p) => p.key), [`${ATH}/chat/4.jpg`, `${ATH}/chat/3.jpg`]);
});

test('a photo some turn already applied is not shown again', () => {
  const rows = [...LUNCH, { id: 'r5', role: 'ai', author_id: ATH, text: 'Added it.', meta: { t: 'analysis_update', photos: [SHAKE] }, created_at: '2026-09-22T16:45:00Z' }];
  assert.ok(appliedPhotoKeys(rows).has(SHAKE));
  assert.equal(pickThreadPhotos(rows, { athleteId: ATH, callerId: COACH, now: NOW }).length, 0);
});

test('the same storage rules as photoPath: shape, and the row author\'s OWN folder, athlete or caller only', () => {
  assert.equal(photoKeyOk(SHAKE, [ATH]), true);
  assert.equal(photoKeyOk(SHAKE, [COACH]), false, 'wrong folder');
  assert.equal(photoKeyOk(`${ATH}/2026-09-22/lunch.jpg`, [ATH]), false, 'not a chat attachment');
  assert.equal(photoKeyOk(`${ATH}/chat/../../x.jpg`, [ATH]), false);
  const rows = [
    // A row whose meta names somebody else's folder: the row cannot borrow a picture.
    { id: 'x1', role: 'athlete', author_id: ATH, text: '', meta: { photo: `${OTHER}/chat/1.jpg` }, created_at: '2026-09-22T17:00:00Z' },
    // A third person's own upload (another staff member): not the athlete, not the caller.
    { id: 'x2', role: 'coach', author_id: OTHER, text: '', meta: { photo: `${OTHER}/chat/2.jpg` }, created_at: '2026-09-22T17:01:00Z' },
    // A reaction row never carries a picture to the model.
    { id: 'x3', role: 'athlete', author_id: ATH, kind: 'reaction', text: '👍', meta: { photo: `${ATH}/chat/3.jpg` }, created_at: '2026-09-22T17:02:00Z' },
  ];
  assert.equal(pickThreadPhotos(rows, { athleteId: ATH, callerId: COACH, now: NOW }).length, 0);
  // And a spoofed "current" key outside the caller's folder is ignored outright.
  assert.equal(pickThreadPhotos([], { athleteId: ATH, callerId: COACH, current: SHAKE, now: NOW }).length, 0);
});

test('an old photo from yesterday is not dragged into today\'s turn', () => {
  const rows = [{ id: 'o1', role: 'athlete', author_id: ATH, text: '', meta: { photo: SHAKE }, created_at: '2026-09-20T12:00:00Z' }];
  assert.equal(pickThreadPhotos(rows, { athleteId: ATH, callerId: ATH, now: NOW }).length, 0);
});

test('meal-chat sends every picked photo as an image block and meters each as vision', () => {
  const src = readFileSync(join(HERE, 'index.ts'), 'utf8');
  assert.match(src, /pickThreadPhotos\(threadRows, \{ athleteId: mealRow\.athlete_id, callerId, current: photoPathRaw \}\)/);
  assert.match(src, /checkSpend\(photos\.length \? EST_USD\.vision \* photos\.length : EST_USD\.text\)/);
  assert.match(src, /\.\.\.photos\.map\(\(p\) => \(\{ type: 'image' as const/);
  // Text-only retries stay text-only: the style retry replays userTurn (a string), never userContent.
  assert.match(src, /\{ role: 'user', content: userTurn \},\s*\{ role: 'assistant', content: `<discarded>/);
});

/* ---------------- 3. label basis ---------------- */

test('a label read keeps its printed figures, servings and basis; an unreadable figure is dropped', () => {
  const f = sanitizeFood({ name: 'Core Power shake', quantity: '1 bottle', basis: 'label', servings: 1, protein: 42, kcal: 230, carbs: 9, fat: 4 });
  assert.deepEqual(f.per, { protein: 42, kcal: 230, carbs: 9, fat: 4 });
  assert.equal(f.basis, 'label');
  assert.equal(f.servings, 1);
  const g = sanitizeFood({ name: 'shake', basis: 'label', protein: 42, kcal: 999, unreadable: ['calories'] });
  assert.equal(g.per.kcal, null, 'a figure it could not read is never a number, even if it guessed one');
  assert.deepEqual(g.unreadable, ['kcal']);
  const e = sanitizeFood({ name: 'roll', protein: 5 });
  assert.equal(e.basis, undefined, 'no label claimed, no label basis');
});

/* ---------------- 4. coach-directed additions ---------------- */

test('the athlete\'s own photo grounds a coach-requested addition', () => {
  const g = additionGrounds(LUNCH, ATH);
  assert.equal(g.length, 1);
  assert.equal(g[0].id, 'r2');
  assert.equal(g[0].photoKey, SHAKE);
  const ok = validateCoachAddition({ sourceMessageId: 'r2', foods: [{ name: 'Core Power shake', basis: 'label', protein: 42, kcal: 230 }] }, g);
  assert.ok(ok);
  assert.equal(ok.source.id, 'r2');
  assert.equal(ok.foods[0].per.protein, 42);
});

test('REFUSED when nothing the athlete posted grounds it', () => {
  // The coach describes food; the athlete never said or showed anything.
  const rows = [
    { id: 'a1', role: 'ai', author_id: ATH, text: 'Solid lunch.', meta: null, created_at: '2026-09-22T16:43:57Z' },
    { id: 'a2', role: 'athlete', author_id: ATH, text: 'thanks', meta: null, created_at: '2026-09-22T16:44:00Z' },
    { id: 'a3', role: 'coach', author_id: COACH, text: 'He also had a 42g shake, add it', meta: { photo: `${COACH}/chat/9.jpg` }, created_at: '2026-09-22T17:29:56Z' },
  ];
  const g = additionGrounds(rows, ATH);
  assert.deepEqual(g, [], 'a coach message or a coach photo is never grounds');
  assert.equal(validateCoachAddition({ sourceMessageId: 'a3', foods: [{ name: 'shake' }] }, g), null);
  // And meal-chat does not even offer the tool when there are no grounds.
  const src = readFileSync(join(HERE, 'index.ts'), 'utf8');
  assert.match(src, /const coachTools = \(grounds\.length\s*\? \[REPLY_TOOL, coachAddTool\(grounds\.map\(\(g\) => g\.id\)\)\]\s*: \[REPLY_TOOL\]\)/);
});

test('REFUSED when the model cites a message that is not one of the grounds, or adds nothing', () => {
  const g = additionGrounds(LUNCH, ATH);
  assert.equal(validateCoachAddition({ sourceMessageId: 'r3', foods: [{ name: 'shake' }] }, g), null, 'the coach\'s own message');
  assert.equal(validateCoachAddition({ sourceMessageId: 'nope', foods: [{ name: 'shake' }] }, g), null);
  assert.equal(validateCoachAddition({ sourceMessageId: 'r2', foods: [] }, g), null);
});

test('the athlete\'s WORDS ground an addition too, and a spent source cannot be used twice', () => {
  const rows = [{ id: 'w1', role: 'athlete', author_id: ATH, text: 'I also had a roll', meta: null, created_at: '2026-09-22T17:00:00Z' }];
  assert.deepEqual(additionGrounds(rows, ATH).map((g) => g.id), ['w1']);
  const spent = [...rows, { id: 'w2', role: 'ai', author_id: COACH, text: 'Added', meta: { t: 'ai_addition', source: { messageId: 'w1' } }, created_at: '2026-09-22T17:01:00Z' }];
  assert.deepEqual(additionGrounds(spent, ATH), []);
});

test('the receipt says whose photo and at whose request, and carries no figures', () => {
  const t = additionReceiptText({ athleteFirst: 'Jihad', requester: 'Coach Brooks', foods: [{ name: 'Core Power shake', quantity: '1 bottle' }], fromPhoto: true });
  assert.match(t, /from Jihad's photo, at Coach Brooks' request: Core Power shake \(1 bottle\)/);
  assert.doesNotMatch(t, /\d+\s*(g|kcal|cal)/i, 'Intuitive athletes read this row too');
  assert.match(additionReceiptText({ athleteFirst: 'Jihad', requester: 'Coach Brooks', foods: [{ name: 'roll' }], fromPhoto: false }), /from what Jihad said/);
});

test('names, not pronouns: first names and "Coach <last>" come from profiles', () => {
  assert.equal(firstName('Jihad Woods'), 'Jihad');
  assert.equal(requesterLabel('Marcus Brooks', 'coach'), 'Coach Brooks');
  assert.equal(requesterLabel('Dana Reyes', 'trainer'), 'Trainer Reyes');
  assert.equal(requesterLabel('', 'coach'), 'your coach');
  const pre = photoPreamble([{ authorId: ATH, text: "I'm also drinking this", current: false }], { athleteId: ATH, athleteFirst: 'Jihad' });
  assert.match(pre, /Image 1: a photo Jihad posted with the words "I'm also drinking this" \(earlier in this thread\)/);
  const tr = threadTranscript(LUNCH, { byId: { [ATH]: 'Jihad Woods', [COACH]: 'Marcus Brooks' } }, [{ key: SHAKE }]);
  assert.match(tr, /id r2 \| Jihad \(athlete\) \[photo: Image 1\]: I'm also drinking this/);
  assert.match(tr, /id r3 \| Marcus \(staff\): Make sure that gets added in/);
});

/* ---------------- 5. prompt quality, read not paid for ---------------- */

test('the prompts forbid the four failures the founder saw', () => {
  const src = readFileSync(join(HERE, 'index.ts'), 'utf8');
  const body = (name) => { const i = src.indexOf(name) + name.length; return src.slice(i, src.indexOf('`;', i)); };
  const coach = body('const COACH_ASK_SYSTEM = `');
  assert.doesNotMatch(coach, /third person/, 'the coach is answered TO, not reported to');
  assert.match(coach, /Never guess a pronoun/);
  assert.match(coach, /Never say you cannot see an image/);
  assert.match(coach, /log something manually/);
  const sys = body('const SYSTEM = `');
  assert.match(sys, /YOU CAN SEE THE PHOTOS IN THIS THREAD/);
  assert.match(sys, /A LABEL IS READ, NOT ESTIMATED/);
  assert.match(sys, /never guess a pronoun/);
  // Deploy trap: a backtick inside a template-literal prompt breaks the bundle with exit code 0.
  for (const b of [coach, sys]) assert.doesNotMatch(b, /`/);
});

/* ---------------- the gate, with the photo ---------------- */

test('the server gate reaches the same verdict for the 12:44 message (photo from body.photoPath)', () => {
  const thread = [
    { id: 'r1', senderId: null, senderName: 'AI Nutritionist', senderRole: 'ai', text: 'Solid lunch...' },
    { id: 'r2', senderId: ATH, senderName: 'Jihad', senderRole: 'athlete', text: "I'm also drinking this" },
  ];
  const body = {
    question: "I'm also drinking this", photoPath: SHAKE,
    speaker: { id: null, senderId: ATH, senderName: 'Jihad', senderRole: 'athlete', text: "I'm also drinking this" },
    participants: [{ id: ATH, name: 'Jihad Woods', role: 'athlete' }, { id: COACH, name: 'Marcus Brooks', role: 'coach' }, { id: null, name: 'AI Nutritionist', role: 'ai' }],
  };
  const v = gateVerdict(body, { thread }, {});
  assert.equal(v.shouldRespond, true, v.reason);
  // A wordless photo reaches the server with a stand-in question, and is still a turn.
  const bare = gateVerdict({ ...body, question: 'I sent a photo. What do you make of it?', speaker: { ...body.speaker, text: '' } }, { thread: [thread[0]] }, {});
  assert.equal(bare.shouldRespond, true, bare.reason);
});

/* ---------------- the addition's receipt ---------------- */
import { additionNote, receiptRowsForStyle } from './thread-photos.mjs';

test('the receipt card note is the attribution line, from the ai_addition row\'s own meta', () => {
  const meta = { t: 'ai_addition', source: { messageId: 'r2', photo: true, athleteFirst: 'Jihad' }, requestedBy: { id: COACH, name: 'Coach Brooks' } };
  assert.equal(additionNote(meta), "Added from Jihad's photo, at Coach Brooks' request");
  assert.equal(additionNote({ ...meta, source: { ...meta.source, photo: false } }), "Added from what Jihad said, at Coach Brooks' request");
});

test('an Intuitive athlete\'s receipt carries the meal score and nothing else', () => {
  const rows = [
    { label: 'Protein', unit: 'g', from: 51, to: 93, score: false },
    { label: 'Calories', unit: '', from: 650, to: 880, score: false },
    { label: 'Meal score', unit: '', from: 70, to: 78, score: true },
  ];
  assert.deepEqual(receiptRowsForStyle(rows, 'intuitive').map((r) => r.label), ['Meal score']);
  assert.equal(receiptRowsForStyle(rows, 'guided').length, 3);
});

test('meal-chat files ONE receipt per addition, with the note, only for the coach who asked', () => {
  const src = readFileSync(join(HERE, 'index.ts'), 'utf8');
  assert.match(src, /\.eq\('meta->>additionId', additionId\)\.limit\(1\)/, 'the second device is a no-op');
  assert.match(src, /coachReceipt && asker\.id !== callerId/, 'a coach files only their own addition\'s receipt');
  assert.match(src, /meta: \{ t: 'correction_receipt', rows, \.\.\.\(note \? \{ note, additionId \} : \{\}\) \}/);
  assert.match(src, /const coachMode = coachSupport \|\| coachAsk \|\| draftMode \|\| coachReceipt;/, 'the caller must not own the meal');
  // The context-less receipt request no longer throws into the outer catch (503).
  assert.match(src, /JSON\.stringify\(context \?\? null\)\.length/);
});
