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
  AI_NAME, AI_TITLE, NIA_MARK, whoHtml, facesHtml, threadTitle, composerPrompt, typingRowHtml,
  receiptCardHtml, escalationChip,
  layoutThread, visibleThread, MUTED_HIDDEN_NOTE, isAnalysisUpdate, isAnalysisOpener, quotedFor, GROUP_GAP_MS, dayLabelOf,
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
  assert.equal(participantSummary(list), 'You, Coach Brown, Nia');
  assert.equal(list[0].self, true);
  assert.equal(initialsFor('Coach Brown'), 'CB');
  assert.equal(initialsFor('Jordan'), 'J');
  assert.equal(initialsFor(''), '?');
});

/* ---------------- Nia (2026-09-24) ---------------- */

const escT = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

test('Nia has one name, one title, and a mark that is not the sparkle', () => {
  assert.equal(AI_NAME, 'Nia');
  assert.equal(AI_TITLE, 'OnStandard Nutritionist');
  assert.match(NIA_MARK, />N</);
  assert.doesNotMatch(NIA_MARK, /svg/);
  const meta = participantMeta('ai');
  assert.equal(meta.noun, 'OnStandard Nutritionist');
  assert.equal(meta.access, 'AI. Reads every meal and answers questions');
});

test('the sender block names Nia and discloses AI; a person is just their name', () => {
  const nia = whoHtml('Nia', true, escT);
  assert.match(nia, /Nia<span class="who-sub">OnStandard Nutritionist · AI<\/span>/);
  assert.equal(whoHtml('Coach <B>', false, escT), '<div class="who">Coach &lt;B&gt;</div>');
  assert.match(whoHtml('Nia', true, escT, 'What the athlete was told'), /What the athlete was told · AI/);
  assert.match(typingRowHtml(escT), /Nia is typing/);
  assert.match(typingRowHtml(escT), /class="nia-n"/);
});

test('the room is introduced athlete first, then coaches, then a human nutritionist, then Nia (no guardian)', () => {
  const list = participantList([
    { id: 'n1', name: 'Priya Shah', kind: 'nutritionist' },
    { id: 'g1', name: 'Dana Woods', kind: 'guardian' },
    { id: COACH, name: 'Coach Brown', kind: 'head_coach' },
    { id: ATHLETE, name: 'Jordan Woods', kind: 'athlete' },
  ], ATHLETE);
  assert.deepEqual(list.map((p) => p.name), ['You', 'Coach Brown', 'Priya Shah', 'Nia']);
  assert.equal(participantMeta('nutritionist').noun, 'Team nutritionist', 'a human on staff is never confused with Nia');
});

test('a coach opening the room keeps their own role, and the athlete still leads', () => {
  const list = participantList([{ id: COACH, name: 'Coach Brown', kind: 'head_coach' }, { id: ATHLETE, name: 'Jordan Woods', kind: 'athlete' }], COACH);
  assert.deepEqual(list.map((p) => [p.name, p.kind]), [['Jordan Woods', 'athlete'], ['You', 'head_coach'], ['Nia', 'ai']]);
});

test('Nia wears her mark in the facepile; people wear their initials', () => {
  const html = facesHtml(participantList([{ id: COACH, name: 'Coach Brown', kind: 'head_coach' }], ATHLETE), escT);
  assert.match(html, /class="fpav ai"><span class="nia-n"/);
  assert.match(html, /data-avatar-uid="ccc-coach"/);
  assert.doesNotMatch(html, /svg/);
});

test('the conversation is named for who is in it', () => {
  assert.equal(threadTitle(participantList([], ATHLETE)), 'Chat with Nia');
  assert.equal(threadTitle(participantList([{ id: COACH, name: 'B', kind: 'head_coach' }], ATHLETE)), 'Team discussion');
  assert.equal(threadTitle(participantList([{ id: 't', name: 'Dana', kind: 'trainer' }], ATHLETE)), 'Discussion');
  // Before the participants land, the athlete's own coach link decides, so a coached thread never
  // reads as solo for a beat.
  assert.equal(threadTitle(participantList([], ATHLETE), { hasCoach: true, noun: 'coach' }), 'Team discussion');
  assert.equal(threadTitle(participantList([], ATHLETE), { hasCoach: true, noun: 'trainer' }), 'Discussion');
});

test('a receipt that opens Nia\'s run carries her name; the reply after it does not repeat it', () => {
  const receipt = { id: 'r1', role: 'ai', author_id: ATHLETE, text: 'Updated', created_at: at(1),
    meta: { t: 'correction_receipt', rows: [{ label: 'Protein', from: 52, to: 78, unit: 'g' }] } };
  const reply = { id: 'r2', role: 'ai', author_id: ATHLETE, text: 'Got it, double chicken.', created_at: at(2) };
  const items = layoutThread([msg('athlete', ATHLETE, 0), receipt, reply], { fmtTime: clock }).filter((i) => i.type === 'msg');
  const [, rItem, aItem] = items;
  assert.equal(rItem.firstOfRun, true, 'the receipt opens the run');
  assert.equal(aItem.firstOfRun, false, 'the reply is in the same run, so it shows no name');
  const html = receiptCardHtml(receipt, escT, { first: rItem.firstOfRun });
  assert.equal((html.match(/who-sub">OnStandard Nutritionist · AI/g) || []).length, 1, 'named once, on the receipt');
  assert.doesNotMatch(receiptCardHtml(receipt, escT, { first: false }), /class="who"/, 'mid-run: no second name');
});

test('the escalation chip never claims a coach who was not told', () => {
  const row = (meta) => ({ role: 'ai', meta: { t: 'escalated', ...meta } });
  assert.equal(escalationChip(row({ coach: true }), { hasCoach: false }), 'Nia sent this to your coach');
  assert.equal(escalationChip(row({ coach: false }), { hasCoach: true, kind: 'coach' }), 'Nia can’t answer this one');
  // Older rows carry no stamp: a team athlete had a coach told, a solo athlete or a trainer's client did not.
  assert.equal(escalationChip(row({}), { hasCoach: true, kind: 'coach' }), 'Nia sent this to your coach');
  assert.equal(escalationChip(row({}), { hasCoach: false }), 'Nia can’t answer this one');
  assert.equal(escalationChip(row({}), { hasCoach: true, kind: 'trainer' }), 'Nia can’t answer this one');
});

test('a guardian is never shown as someone in the meal conversation (0081)', () => {
  const list = participantList([
    { id: ATHLETE, name: 'Jordan Woods', kind: 'athlete' }, { id: COACH, name: 'Coach Brown', kind: 'head_coach' },
    { id: 'g1', name: 'Dana Woods', kind: 'guardian' },
  ], ATHLETE);
  assert.deepEqual(list.map((p) => p.name), ['You', 'Coach Brown', 'Nia']);
  assert.equal(participantSummary(list), 'You, Coach Brown, Nia');
  assert.doesNotMatch(facesHtml(list, escT), /g1/);
  // Where a guardian IS described, it is only what 0081's scoped summary returns.
  assert.equal(participantMeta('guardian').access, 'Sees daily scores and grades only, never meals or photos');
  // A parent alone does not make a meal thread a discussion.
  assert.equal(threadTitle(participantList([{ id: 'g1', name: 'Dana', kind: 'guardian' }], ATHLETE)), 'Chat with Nia');
});

test('a thread with a past coach\'s messages is a discussion, not a chat with Nia', () => {
  assert.equal(threadTitle(participantList([], ATHLETE), null, [msg('coach', COACH, 1)]), 'Discussion');
  assert.equal(threadTitle(participantList([], ATHLETE), null, [msg('ai', ATHLETE, 1)]), 'Chat with Nia');
});

test('the message box says who is listening', () => {
  assert.equal(composerPrompt(false), 'Ask Nia about this meal…');
  assert.equal(composerPrompt(true, 'coach'), 'Message your coach or ask Nia…');
  assert.equal(composerPrompt(true, 'trainer'), 'Message your trainer or ask Nia…');
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
  assert.equal(authorName(msg('ai', ATHLETE, 1), parts, ATHLETE), 'Nia');
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

test('the day separator shows the human label, never the compare key', () => {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const items = layoutThread([
    { id: 'a', role: 'coach', author_id: COACH, text: 'x', created_at: '2026-07-27T23:58:00Z' },
    { id: 'b', role: 'coach', author_id: COACH, text: 'y', created_at: '2026-07-28T00:01:00Z' },
  ], { fmtTime: clock, fmtDay: day, fmtDayLabel: () => 'Tuesday, Jul 28' });
  const seps = items.filter((i) => i.type === 'time');
  assert.match(seps[1].label, /^Tuesday, Jul 28 · /);
});

test('dayLabelOf reads Today, Yesterday, then the date', () => {
  // Local-time stamps (no Z) so the same-day math holds in any CI timezone.
  const now = Date.parse('2026-07-28T15:00:00');
  assert.equal(dayLabelOf(Date.parse('2026-07-28T10:00:00'), now), 'Today');
  assert.equal(dayLabelOf(Date.parse('2026-07-27T10:00:00'), now), 'Yesterday');
  const older = dayLabelOf(Date.parse('2026-07-20T10:00:00'), now);
  assert.ok(older && older !== 'Today' && older !== 'Yesterday');
  assert.equal(dayLabelOf(NaN, now), '');
});

test('visibleThread is exactly the list layoutThread paints, so anchors cannot drift', () => {
  const AI = { id: 'ai1', role: 'ai', author_id: null, text: 'the read', created_at: at(0) };
  const msgs = [AI, msg('coach', COACH, 2), msg('athlete', ATHLETE, 3), msg('coach', COACH, 5)];
  const vis = visibleThread(msgs, [COACH]);
  // The muted coach is gone, the AI (no author_id) and the athlete stay, order kept.
  assert.deepEqual(vis.map((c) => c.id), ['ai1', 'm3']);
  // The contract the renderers anchor on: layoutThread paints these messages and no others.
  const painted = layoutThread(msgs, { muted: [COACH] }).filter((i) => i.type === 'msg').map((i) => i.comment);
  assert.deepEqual(painted, vis);
  // A Set mutes the same as an array, and no mutes means the same rows back.
  assert.deepEqual(visibleThread(msgs, new Set([COACH])), vis);
  assert.deepEqual(visibleThread(msgs, []), msgs);
  assert.deepEqual(visibleThread(msgs, null), msgs);
  // Junk in, honest list out — the shape every fetcher-fed caller relies on.
  assert.deepEqual(visibleThread(null, [COACH]), []);
  assert.deepEqual(visibleThread([null, AI, undefined], [COACH]), [AI]);
});

test('muting everyone leaves an empty paint, which is the case the renderers must say out loud', () => {
  const msgs = [msg('coach', COACH, 1), msg('coach', COACH, 2)];
  assert.equal(visibleThread(msgs, [COACH]).length, 0);
  assert.equal(layoutThread(msgs, { muted: [COACH] }).length, 0);
  // The one sentence they all show for it — copy changes here change every thread at once.
  assert.equal(MUTED_HIDDEN_NOTE, 'Messages from people you blocked are hidden.');
});
