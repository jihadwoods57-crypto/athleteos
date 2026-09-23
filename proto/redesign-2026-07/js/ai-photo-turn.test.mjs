// run: node --test proto/redesign-2026-07/js/ai-photo-turn.test.mjs
//
// THE 12:44 INCIDENT (2026-09-22, live prod rows). Lunch thread: the AI's long meal read, then the
// athlete posts a photo of a protein shake with "I'm also drinking this". No AI call was made.
//
// Three things stacked up to make that silence:
//   1. the composer refreshed the thread BEFORE deciding, so the athlete's own just-posted row was
//      the last line of history, and the adjacency rules saw "the athlete spoke last" instead of
//      "the AI spoke last";
//   2. a photo only kept its turn when it had NO caption — a caption sent the whole message to the
//      words-only gate;
//   3. "I'm also drinking this" is a statement, not a question, and "drinking" was not nutrition
//      vocabulary, so every rule fell through to the silent default.
// These pin the fix, through the exact call the meal thread makes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAiTurn } from './ai-thread.js';
import { shouldAiRespond, addsFoodToThisMeal } from './ai-addressing.js';

const ATH = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const COACH = 'cccccccc-2222-4222-8222-cccccccccccc';
const PEOPLE = [
  { id: ATH, name: 'Jihad Woods', kind: 'athlete' },
  { id: COACH, name: 'Marcus Brooks', kind: 'head_coach' },
];
const row = (o) => ({
  id: o.id, role: o.role, author_id: o.author_id || null, text: o.text, kind: 'message',
  created_at: o.at, meta: o.meta || null,
});

// The rows as prod held them at 12:44:29, AFTER the composer's refresh() (which is what the
// composer decided over).
const LUNCH = [
  row({ id: 'r1', role: 'ai', text: 'Solid lunch. Chicken, rice and greens put you at a good spot for the afternoon lift...', at: '2026-09-22T16:43:57Z' }),
  row({ id: 'r2', role: 'athlete', author_id: ATH, text: "I'm also drinking this", at: '2026-09-22T16:44:29Z', meta: { photo: `${ATH}/chat/1790095466714.jpg` } }),
];

const turnFor = (text, comments, photo) => decideAiTurn({
  text, comments, participants: PEOPLE, photo,
  self: { id: ATH, name: 'Jihad', role: 'athlete' },
  athleteName: 'Jihad', fallbackNoun: 'coach',
});

test('12:44 — a photo + "I\'m also drinking this" with a coach in the room now reaches the AI', () => {
  const t = turnFor("I'm also drinking this", LUNCH, true);
  assert.equal(t.decision.shouldRespond, true, t.decision.reason);
  assert.equal(t.decision.intendedRecipient.kind, 'ai');
  assert.equal(t.outgoing.photo, true, 'the outgoing message says it carries a photo, for the server gate');
});

test('12:44 without the photo: the words alone are still addressed to the AI', () => {
  const t = turnFor("I'm also drinking this", LUNCH, false);
  assert.equal(t.decision.shouldRespond, true, t.decision.reason);
});

test('the message being decided is never its own history (the refresh-before-decide echo)', () => {
  // A question right after the AI spoke is for the AI. With the echo left in, the athlete's own
  // row sat between them and the adjacency rule never fired.
  const rows = [
    LUNCH[0],
    row({ id: 'r9', role: 'athlete', author_id: ATH, text: 'why only 72', at: '2026-09-22T16:45:00Z' }),
  ];
  assert.equal(turnFor('why only 72', rows, false).decision.shouldRespond, true);
});

test('a bare photo from the athlete is always a turn', () => {
  const rows = [LUNCH[0], row({ id: 'r3', role: 'athlete', author_id: ATH, text: '', at: '2026-09-22T16:44:29Z', meta: { photo: `${ATH}/chat/1.jpg` } })];
  assert.equal(turnFor('', rows, true).decision.shouldRespond, true);
});

test('a photo that NAMES a person is for that person, not the AI', () => {
  const t = turnFor('coach is this enough?', LUNCH, true);
  assert.equal(t.decision.shouldRespond, false);
  assert.equal(t.decision.intendedRecipient.kind, 'human');
});

test('a photo @mentioning the coach stays between them', () => {
  const t = turnFor('@Marcus look', LUNCH, true);
  assert.equal(t.decision.shouldRespond, false);
});

test('food and drink added to this meal is addressed to the AI', () => {
  for (const s of ["I'm also drinking this", 'had this too', 'I also had a roll', 'forgot the milk', 'ate that as well', 'im having this with it']) {
    assert.equal(addsFoodToThisMeal(s.toLowerCase()), true, s);
    const d = shouldAiRespond({ senderId: ATH, senderName: 'Jihad', senderRole: 'athlete', text: s }, { participants: [], history: [] });
    assert.equal(d.shouldRespond, true, s);
  }
});

test('ordinary talk that happens to use "had" or "this" stays quiet', () => {
  for (const s of ['I had practice too', 'I had a great day too', 'long day', 'I\'ll eat that next time', 'this is hard', 'I got this']) {
    assert.equal(addsFoodToThisMeal(s.toLowerCase()), false, s);
  }
});

test('food words aimed at a named human stay with the human', () => {
  const d = shouldAiRespond(
    { senderId: ATH, senderName: 'Jihad', senderRole: 'athlete', text: 'coach I also had a roll' },
    { participants: [], history: [] },
  );
  assert.equal(d.shouldRespond, false);
});

test('danger still outranks everything, photo or not', () => {
  const d = shouldAiRespond(
    { senderId: ATH, senderName: 'Jihad', senderRole: 'athlete', text: 'coach im gonna stop eating till weigh ins', photo: true },
    { participants: [], history: [] },
  );
  assert.equal(d.shouldRespond, true);
  assert.match(d.reason, /unsafe/);
});

test('a coach\'s photo is not an athlete photo: the coach speaking to the athlete stays theirs', () => {
  const d = shouldAiRespond(
    { senderId: COACH, senderName: 'Marcus Brooks', senderRole: 'coach', text: 'eat more of this', photo: true },
    { participants: [], history: [] },
  );
  assert.equal(d.shouldRespond, false);
});
