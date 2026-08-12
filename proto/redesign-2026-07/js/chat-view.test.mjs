/* The meal thread as a conversation — pure-module tests (node --test).

   These pin the small courtesies that make a room feel like people rather than software: a run of
   messages from one person is one block, the clock shows when time has actually passed, everyone
   has a name, and an unresolved author degrades to their role instead of to nothing. None of them
   would break the app if they regressed, which is exactly why they need tests — a thread that
   feels wrong is easy to ship and hard to notice. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  participantMeta, initialsFor, participantList, participantSummary, authorName,
  layoutThread, isAnalysisUpdate, isAnalysisOpener, quotedFor, GROUP_GAP_MS,
} from './chat-view.js';

const ATHLETE = 'aaa-athlete';
const COACH = 'ccc-coach';
const at = (min) => new Date(Date.UTC(2026, 6, 28, 19, min, 0)).toISOString();
const msg = (role, author, minute, over = {}) =>
  ({ id: `m${minute}`, role, author_id: author, text: `${role} at ${minute}`, created_at: at(minute), ...over });
const clock = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCHours() % 12 || 12)}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

test('everyone in the room has a name and a face', () => {
  const list = participantList(
    [{ id: ATHLETE, name: 'Jordan Woods', kind: 'athlete' }, { id: COACH, name: 'Coach Brown', kind: 'head_coach' }],
    ATHLETE,
  );
  assert.equal(participantSummary(list), 'You, Coach Brown, AI Nutritionist');
  assert.equal(list[0].self, true);
  assert.equal(initialsFor('Coach Brown'), 'CB');
  assert.equal(initialsFor('Jordan'), 'J');
  assert.equal(initialsFor(''), '?');
});

test('the AI is always in the room, even before anyone else is resolved', () => {
  const list = participantList([], null);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'ai');
});

test('a role nobody has taught us about still reads as a person, not as a blank', () => {
  assert.equal(participantMeta('head_coach').noun, 'Head coach');
  assert.equal(participantMeta('guardian').noun, 'Parent or guardian');
  assert.equal(participantMeta('some_new_role_2027').noun, 'Staff');
  assert.ok(participantMeta('trainer').ic);
});

test('a message is attributed to the person who wrote it', () => {
  const parts = [{ id: COACH, name: 'Coach Brown', kind: 'head_coach' }];
  assert.equal(authorName(msg('coach', COACH, 1), parts, ATHLETE), 'Coach Brown');
  assert.equal(authorName(msg('athlete', ATHLETE, 1), parts, ATHLETE), 'You');
  assert.equal(authorName(msg('ai', ATHLETE, 1), parts, ATHLETE), 'AI Nutritionist');
});

test('an author we cannot resolve degrades to their role, never to nothing', () => {
  // The participants RPC can be unavailable: an older database, an offline load, or a staff
  // member who has since left the team. "Coach" is a worse label than their name and a far
  // better one than an empty bubble.
  assert.equal(authorName(msg('coach', 'someone-who-left', 1), [], ATHLETE), 'Coach');
  assert.equal(authorName(msg('athlete', 'not-me', 1), [], ATHLETE), 'Athlete');
});

test('a run from one person is one block, not a stack of repeated labels', () => {
  const msgs = [msg('coach', COACH, 0), msg('coach', COACH, 1), msg('coach', COACH, 2)];
  const items = layoutThread(msgs, { fmtTime: clock });
  const bubbles = items.filter((i) => i.type === 'msg');
  assert.deepEqual(bubbles.map((b) => b.firstOfRun), [true, false, false]);
  assert.deepEqual(bubbles.map((b) => b.lastOfRun), [false, false, true]);
});

test('the speaker changing starts a new block', () => {
  const items = layoutThread([msg('coach', COACH, 0), msg('athlete', ATHLETE, 1)], { fmtTime: clock });
  assert.deepEqual(items.filter((i) => i.type === 'msg').map((b) => b.firstOfRun), [true, true]);
});

test('the clock appears when time has actually passed, not on every line', () => {
  const tight = layoutThread([msg('coach', COACH, 0), msg('coach', COACH, 2)], { fmtTime: clock });
  assert.equal(tight.filter((i) => i.type === 'time').length, 1, 'one separator opens the thread');

  const gapped = layoutThread([msg('coach', COACH, 0), msg('coach', COACH, 30)], { fmtTime: clock });
  assert.equal(gapped.filter((i) => i.type === 'time').length, 2, 'a real gap earns its own stamp');
  assert.ok(GROUP_GAP_MS > 0);
});

test('a new day is always announced, however close the messages are', () => {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const msgs = [
    { id: 'a', role: 'coach', author_id: COACH, text: 'last night', created_at: '2026-07-27T23:58:00Z' },
    { id: 'b', role: 'coach', author_id: COACH, text: 'this morning', created_at: '2026-07-28T00:01:00Z' },
  ];
  const items = layoutThread(msgs, { fmtTime: clock, fmtDay: day });
  assert.equal(items.filter((i) => i.type === 'time').length, 2);
  assert.equal(items.filter((i) => i.type === 'msg')[1].firstOfRun, true);
});

test('an unparseable timestamp never produces a broken separator', () => {
  const items = layoutThread([{ id: 'x', role: 'ai', author_id: null, text: 'hi', created_at: 'not a date' }], { fmtTime: clock });
  assert.equal(items.filter((i) => i.type === 'time').length, 0);
  assert.equal(items.filter((i) => i.type === 'msg').length, 1);
});

test('empty and junk inputs lay out as nothing rather than throwing', () => {
  assert.deepEqual(layoutThread([], {}), []);
  assert.deepEqual(layoutThread(null, {}), []);
  assert.deepEqual(layoutThread([null, undefined], {}), []);
});

test('the AI\'s two kinds of read are told apart', () => {
  const opener = msg('ai', ATHLETE, 1, { meta: { t: 'analysis' } });
  const update = msg('ai', ATHLETE, 5, { meta: { t: 'analysis_update' } });
  const chat = msg('ai', ATHLETE, 9);
  assert.equal(isAnalysisOpener(opener), true);
  assert.equal(isAnalysisUpdate(update), true);
  assert.equal(isAnalysisUpdate(opener), false);
  assert.equal(isAnalysisUpdate(chat), false);
  // meta is only honoured on ai rows — a client can write meta on its own rows, and must not be
  // able to dress one up as an analysis.
  assert.equal(isAnalysisUpdate(msg('athlete', ATHLETE, 3, { meta: { t: 'analysis_update' } })), false);
});

test('an updated read quotes the correction it answers', () => {
  const correction = msg('athlete', ATHLETE, 3, { text: 'That was a 12oz ribeye, not 8' });
  const update = msg('ai', ATHLETE, 4, { meta: { t: 'analysis_update' } });
  const msgs = [msg('ai', ATHLETE, 1, { meta: { t: 'analysis' } }), correction, update];
  assert.equal(quotedFor(update, msgs), correction);
});

test('a correction made through the chip panel has nothing to quote, and says so', () => {
  // Chip corrections never post an athlete message, so there is no line to quote. Returning null
  // is the honest answer; inventing a quote would put words in the athlete's mouth.
  const update = msg('ai', ATHLETE, 4, { meta: { t: 'analysis_update' } });
  const msgs = [msg('ai', ATHLETE, 1, { meta: { t: 'analysis' } }), update];
  assert.equal(quotedFor(update, msgs), null);
  assert.equal(quotedFor(msg('ai', ATHLETE, 1), msgs), null);
});

test('a trainer is called a trainer, not a coach', () => {
  // The operator lane is shared: the same `coach` role carries a team coach and a personal
  // trainer. When the participants list cannot resolve the author, the fallback has to use the
  // word the reader's own screen uses — a client seeing "Coach" would notice.
  const unresolved = msg('coach', 'someone-not-in-the-list', 1);
  assert.equal(authorName(unresolved, [], ATHLETE, 'trainer'), 'Trainer');
  assert.equal(authorName(unresolved, [], ATHLETE, 'coach'), 'Coach');
  assert.equal(authorName(unresolved, [], ATHLETE), 'Coach', 'no noun given falls back to Coach');
  // A resolved name always wins over any fallback.
  assert.equal(authorName(msg('coach', COACH, 1), [{ id: COACH, name: 'Dana Ruiz', kind: 'trainer' }], ATHLETE, 'trainer'), 'Dana Ruiz');
});
