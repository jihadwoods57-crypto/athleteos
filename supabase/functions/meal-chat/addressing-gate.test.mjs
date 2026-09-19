// run: node --test supabase/functions/meal-chat/addressing-gate.test.mjs
//
// The client decides whether to call at all; this is the half that cannot be talked out of it.
// What these pin: a refused turn costs nothing, a coach's own modes are never gated, and a client
// that predates the contract is never silently muted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gateVerdict, isStructured, participantsFromThread } from './addressing-gate.mjs';

const msg = (o) => ({
  id: o.id || 'c1', senderId: o.senderId || null, senderName: o.senderName || null,
  senderRole: o.senderRole, text: o.text,
});
const COACH = msg({ id: 'c1', senderId: 'u-hc', senderName: 'Alex Grinch', senderRole: 'coach', text: 'Good job' });
const AI = msg({ id: 'c2', senderRole: 'ai', senderName: 'AI Nutritionist', text: 'You have 35g of protein remaining.' });
const ATHLETE = { id: null, senderId: 'u-ath', senderName: 'Jihad Woods', senderRole: 'athlete' };

const body = (question, thread, extra) => ({
  question, speaker: { ...ATHLETE, text: question }, ...(extra || {}),
});
const ctx = (thread) => ({ thread });

test('"Thank you Coach" after the coach spoke is refused server-side too', () => {
  const v = gateVerdict(body('Thank you Coach'), ctx([COACH]), {});
  assert.equal(v.shouldRespond, false);
  assert.equal(v.intendedRecipient.name, 'Alex Grinch');
  assert.ok(v.reason);
});

test('a real question still passes the gate', () => {
  const v = gateVerdict(body('how much protein do I have left?'), ctx([AI]), {});
  assert.equal(v.shouldRespond, true);
});

test('the coach’s own modes are never gated — they are addressed to the AI by construction', () => {
  for (const modes of [{ coachMode: true }, { correctionUpdate: true }, { receiptRows: [{}] }]) {
    assert.equal(gateVerdict(body('Thank you Coach'), ctx([COACH]), modes), null, JSON.stringify(modes));
  }
});

test('a pre-contract client is left alone rather than silently muted', () => {
  // The old shape: flat {role,text} entries and no speaker. Nothing to judge.
  const oldBody = { question: 'Thank you Coach' };
  const oldCtx = { thread: [{ role: 'coach', text: 'Good job' }] };
  assert.equal(gateVerdict(oldBody, oldCtx, {}), null);
  assert.equal(isStructured(oldBody, oldCtx.thread), false);
});

test('the FIRST message in a room is judged — an empty thread is not an excuse', () => {
  // This was the gap the client/server cross-check below caught: the contract marker used to be
  // "the thread has a structured entry", which is false for a brand-new thread, so the opening
  // message of every conversation skipped the server gate entirely.
  const v = gateVerdict(body('Yeah coach I will get it done.'), ctx([]), {});
  assert.ok(v, 'a structured speaker is enough to judge, at any thread length');
  assert.equal(v.shouldRespond, false);
});

test('the gate reads the question off the body, not only off the speaker', () => {
  const b = { question: 'AI what should I eat?', speaker: { ...ATHLETE, text: 'stale' } };
  assert.equal(gateVerdict(b, ctx([COACH]), {}).shouldRespond, true);
});

test('the roster the client sends is preferred, and the thread is the floor', () => {
  const derived = participantsFromThread([COACH, AI]);
  assert.deepEqual(derived.map((p) => p.role).sort(), ['ai', 'coach']);
  assert.equal(derived.find((p) => p.role === 'coach').name, 'Alex Grinch');

  // A coach who has NOT spoken yet is unknown to the transcript but known to the client roster,
  // so "thanks Dana" still resolves to a person.
  const withRoster = gateVerdict(
    body('thanks Dana', null, { participants: [{ id: 'u-tr', name: 'Dana Reyes', role: 'trainer' }, { id: null, name: 'AI Nutritionist', role: 'ai' }] }),
    ctx([AI]),
    {},
  );
  assert.equal(withRoster.shouldRespond, false);
  assert.equal(withRoster.intendedRecipient.name, 'Dana Reyes');
});

test('participantsFromThread de-duplicates a speaker who said several things', () => {
  const rows = [COACH, { ...COACH, id: 'c9', text: 'again' }, AI];
  assert.equal(participantsFromThread(rows).length, 2);
});

test('a missing or junk thread does not throw, and a body with no speaker is left alone', () => {
  assert.equal(gateVerdict(body('hi'), {}, {}).shouldRespond, false, 'no thread is still judgeable');
  assert.equal(gateVerdict({}, undefined, {}), null, 'no speaker means a pre-contract client');
  assert.equal(gateVerdict({ speaker: { text: 'hi' } }, ctx([]), {}), null, 'a speaker without a role is not the contract');
});

/* ---------------------------------------------------------------------------------------------
   CLIENT AND SERVER MUST AGREE.

   The decision file is byte-identical across the two module graphs (lint:mirror), but identical
   code reached through different inputs can still produce different answers — and a disagreement
   here is the worst outcome available: the composer spends a call the server then refuses, or the
   composer stays quiet about something the server would have answered.

   So this reaches ACROSS the trees on purpose: it drives the real proto composer path
   (decideAiTurn over raw meal_comments rows) and then feeds its output through the real server
   gate, exactly as the request body carries it, and asserts the two verdicts match.
--------------------------------------------------------------------------------------------- */
import { decideAiTurn } from '../../../proto/redesign-2026-07/js/ai-thread.js';

const row = (o) => ({ id: o.id, role: o.role, author_id: o.author_id || null, text: o.text, kind: 'message', created_at: '2026-09-18T12:00:00Z', meta: null });
const ROSTER = [
  { id: 'u-ath', name: 'Jihad Woods', kind: 'athlete' },
  { id: 'u-hc', name: 'Alex Grinch', kind: 'head_coach' },
  { id: 'u-tr', name: 'Dana Reyes', kind: 'trainer' },
];

const CONVERSATIONS = [
  ['Thank you Coach', [row({ id: 'a', role: 'coach', author_id: 'u-hc', text: 'Good job' })], false],
  ['Got you.', [row({ id: 'a', role: 'coach', author_id: 'u-hc', text: 'Make sure you eat before meetings.' })], false],
  ['A little sore today.', [row({ id: 'a', role: 'coach', author_id: 'u-tr', text: 'How are your legs feeling?' })], false],
  ['Yeah coach I will get it done.', [], false],
  ['Are you sure?', [row({ id: 'a', role: 'ai', text: 'You have 35g of protein remaining.' })], true],
  ['AI, how much protein do I have left?', [], true],
  ['how much protein do I have left?', [row({ id: 'a', role: 'ai', text: 'Lunch scored 72.' })], true],
  ['long day', [row({ id: 'a', role: 'coach', author_id: 'u-hc', text: 'good work' })], false],
];

test('the composer and the server reach the SAME verdict on every conversation', () => {
  for (const [text, comments, expected] of CONVERSATIONS) {
    const turn = decideAiTurn({
      text, comments, participants: ROSTER,
      self: { id: 'u-ath', name: 'Jihad Woods', role: 'athlete' },
      athleteName: 'Jihad',
    });
    assert.equal(turn.decision.shouldRespond, expected, 'client: ' + text);

    // exactly what the composer puts on the wire
    const server = gateVerdict(
      { question: text, speaker: turn.outgoing, participants: turn.participants },
      { thread: turn.thread },
      {},
    );
    assert.ok(server, 'server judged the request: ' + text);
    assert.equal(server.shouldRespond, expected, 'server: ' + text);
    assert.equal(server.reason, turn.decision.reason, 'same reason, not just the same answer: ' + text);
  }
});
