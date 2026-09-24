// run: node --test proto/redesign-2026-07/js/ai-thread.test.mjs
//
// The regression: every renderer flattened the thread to `{role, text}`, so two coaches, a trainer
// and a parent all reached the model as "coach" and nothing said who a message answered. These pin
// that identity survives the trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiThread, describeMessage, describeOutgoing, aiParticipants, normalizeRole, decideAiTurn } from './ai-thread.js';

const PEOPLE = [
  { id: 'u-ath', name: 'Jihad Woods', kind: 'athlete' },
  { id: 'u-hc', name: 'Alex Grinch', kind: 'head_coach' },
  { id: 'u-tr', name: 'Dana Reyes', kind: 'trainer' },
  { id: 'u-mom', name: 'Renee Woods', kind: 'guardian' },
];
const row = (o) => ({ id: o.id || 'c1', role: o.role, author_id: o.author_id || null, text: o.text, kind: o.kind || 'message', created_at: o.at || '2026-09-18T12:00:00Z', meta: o.meta || null });

test('roles collapse to the words people actually type', () => {
  assert.equal(normalizeRole('head_coach'), 'coach');
  assert.equal(normalizeRole('position_coach'), 'coach');
  assert.equal(normalizeRole('guardian'), 'parent');
  assert.equal(normalizeRole('trainer'), 'trainer');
  assert.equal(normalizeRole('strength_and_conditioning_coach'), 'coach');
});

test('a thread row carries the speaker’s real name and role, not just "coach"', () => {
  const people = aiParticipants(PEOPLE.map((p) => ({ id: p.id, name: p.name, role: normalizeRole(p.kind) })), {});
  const d = describeMessage(row({ role: 'coach', author_id: 'u-tr', text: 'How are your legs?' }), { participants: people });
  assert.equal(d.senderName, 'Dana Reyes');
  assert.equal(d.senderRole, 'trainer', 'the trainer is not reported as a team coach');
  assert.equal(d.senderId, 'u-tr');
});

test('the AI is named and carries no sender id', () => {
  const d = describeMessage(row({ role: 'ai', text: 'Lunch scored 72.' }), {});
  assert.equal(d.senderName, 'Nia');
  assert.equal(d.senderRole, 'ai');
  assert.equal(d.senderId, null);
});

test('the athlete is their own name, never "You" — the model is not the reader', () => {
  const people = aiParticipants([{ id: 'u-ath', name: 'Jihad Woods', role: 'athlete' }], {});
  const d = describeMessage(row({ role: 'athlete', author_id: 'u-ath', text: 'ok' }), { participants: people, selfId: 'u-ath' });
  assert.equal(d.senderName, 'Jihad Woods');
});

test('reactions and private notes are not conversation; receipts are, flagged as system', () => {
  const t = buildAiThread([
    row({ id: 'a', role: 'athlete', text: 'chicken and rice' }),
    row({ id: 'b', role: 'athlete', text: '\u{1F525}', kind: 'reaction' }),
    row({ id: 'c', role: 'coach', text: 'private thought', kind: 'note' }),
    row({ id: 'd', role: 'ai', text: 'Protein updated to 42g.', meta: { t: 'correction_receipt' } }),
  ], {});
  assert.deepEqual(t.map((m) => m.id), ['a', 'd']);
  assert.equal(t[0].system, false);
  assert.equal(t[1].system, true, 'a receipt is the app writing, not somebody talking');
});

test('a reply target rides through when the row carries one', () => {
  const d = describeMessage(row({ role: 'athlete', text: 'are you sure', meta: { replyTo: 'm-99' } }), {});
  assert.equal(d.replyToMessageId, 'm-99');
});

test('meta arrives as a JSON string from some writers and is still read', () => {
  const d = describeMessage(row({ role: 'ai', text: 'x', meta: JSON.stringify({ t: 'analysis_update' }) }), {});
  assert.equal(d.system, true);
});

test('the transcript keeps the newest `limit` rows, oldest first', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row({ id: 'r' + i, role: 'athlete', text: 'm' + i }));
  const t = buildAiThread(rows, {}, 5);
  assert.deepEqual(t.map((m) => m.text), ['m25', 'm26', 'm27', 'm28', 'm29']);
});

test('the AI is always a participant, even when the roster does not list it', () => {
  const people = aiParticipants([{ id: 'u-ath', name: 'Jihad Woods', role: 'athlete' }], {});
  assert.ok(people.some((p) => p.role === 'ai'));
});

test('describeOutgoing shapes the unsent message the same way, mentions included', () => {
  const o = describeOutgoing('@ai how much protein', { id: 'u-ath', name: 'Jihad Woods', role: 'athlete' });
  assert.equal(o.senderName, 'Jihad Woods');
  assert.equal(o.senderRole, 'athlete');
  assert.deepEqual(o.mentions, ['ai']);
  assert.equal(o.id, null);
});

/* ---- the whole decision, the way a composer makes it ---- */

test('decideAiTurn reproduces the founder’s case from raw rows', () => {
  const turn = decideAiTurn({
    text: 'Thank you Coach',
    comments: [row({ id: 'c1', role: 'coach', author_id: 'u-hc', text: 'Good job' })],
    participants: PEOPLE,
    self: { id: 'u-ath', name: 'Jihad Woods', role: 'athlete' },
    athleteName: 'Jihad',
  });
  assert.equal(turn.decision.shouldRespond, false);
  assert.equal(turn.decision.intendedRecipient.name, 'Alex Grinch');
  assert.equal(turn.thread[0].senderName, 'Alex Grinch', 'the transcript sent to the model names the coach');
});

test('decideAiTurn still lets a real question through', () => {
  const turn = decideAiTurn({
    text: 'how much protein do I have left?',
    comments: [row({ id: 'c1', role: 'ai', text: 'Lunch scored 72.' })],
    participants: PEOPLE,
    self: { id: 'u-ath', name: 'Jihad Woods', role: 'athlete' },
  });
  assert.equal(turn.decision.shouldRespond, true);
  assert.equal(turn.decision.intendedRecipient.kind, 'ai');
});

test('a trainer in the room is addressed as a trainer, not a coach', () => {
  const turn = decideAiTurn({
    text: 'sore today trainer',
    comments: [row({ id: 'c1', role: 'coach', author_id: 'u-tr', text: 'How are your legs?' })],
    participants: PEOPLE,
    self: { id: 'u-ath', name: 'Jihad Woods', role: 'athlete' },
  });
  assert.equal(turn.decision.shouldRespond, false);
  assert.equal(turn.decision.intendedRecipient.name, 'Dana Reyes');
});

test('an empty thread with nobody addressed stays silent', () => {
  const turn = decideAiTurn({ text: 'long day', comments: [], participants: PEOPLE, self: { id: 'u-ath', role: 'athlete' } });
  assert.equal(turn.decision.shouldRespond, false);
});
