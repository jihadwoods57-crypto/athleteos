/* The meal thread, polished (2026-09-25): Nia's read as short texts, "Seen by" per meal, and
   tap-to-answer chips. Pure-module tests (node --test) plus the source contracts that keep all four
   renderers on the one shared path. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  splitOldRead, splitAiText, isMovePart, partsOf, bubblesHtml,
  seenByLine,
  askOf, askChipsFor, askReplyText, askChipsHtml, SIZE_CHIPS,
  COMPOSER_CHIPS, composerChipOf, composerChipsVisible, composerChipsHtml,
} from './thread-polish.js';
import { decideAiTurn } from './ai-thread.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/* What the server writes now (meal-opener.ts composeOpener): parts joined by a paragraph break. */
const NEW_READ = [
  'Solid plate. The chicken carries it and the rice is doing its job on a lift day.',
  "==Land around **50g of protein** at each of your last 2 meals== and you'll hit today's target without forcing the last one.",
  "You've hit your protein bar in 3 of your last 4 dinners.",
  "I'm least sure on the white rice portion, so tell me how much and I'll tighten the numbers.",
].join('\n\n');
/* What it wrote before: the same parts joined by a space. */
const OLD_READ = NEW_READ.replace(/\n\n/g, ' ');
const opener = (text, meta = {}) => ({ id: 'op1', role: 'ai', author_id: 'ath', text, meta: { t: 'analysis', ...meta }, created_at: '2026-09-25T16:40:00Z' });

/* ---------------- #3 the read as short texts ---------------- */

test('a paragraph break is a text boundary: one row, several texts, in order', () => {
  const parts = splitAiText(NEW_READ, { opener: true });
  assert.equal(parts.length, 4);
  assert.ok(parts[0].startsWith('Solid plate.'));
  assert.ok(parts[3].startsWith("I'm least sure"));
  // CRLF from any store still splits, and blank-ish lines between texts do not make empty bubbles.
  assert.deepEqual(splitAiText('One.\r\n\r\nTwo.\n \n\nThree.'), ['One.', 'Two.', 'Three.']);
});

test('the same break splits any row of Nia\'s, not only the read', () => {
  assert.deepEqual(splitAiText('First thought.\n\nSecond thought.'), ['First thought.', 'Second thought.']);
  const reply = { id: 'r', role: 'ai', text: 'First thought.\n\nSecond thought.', meta: null };
  assert.deepEqual(partsOf(reply), ['First thought.', 'Second thought.']);
});

test('a single newline stays a line break inside one bubble', () => {
  assert.deepEqual(splitAiText('Line one\nline two.'), ['Line one\nline two.']);
});

test('only Nia\'s plain rows split: never a person, a photo, or a what-to-eat card', () => {
  assert.equal(partsOf({ role: 'athlete', text: 'a.\n\nb.' }), null);
  assert.equal(partsOf({ role: 'coach', text: 'a.\n\nb.' }), null);
  assert.equal(partsOf({ role: 'ai', text: 'a.\n\nb.' }, { photo: true }), null);
  assert.equal(partsOf({ role: 'ai', text: 'a.\n\nb.', meta: { t: 'meal_suggest', framing: 'x' } }), null);
  assert.equal(partsOf({ role: 'ai', text: 'One text only.' }), null);
});

test('OLD ROWS: split before the move and before the uncertainty line', () => {
  const parts = splitOldRead(OLD_READ);
  assert.deepEqual(parts, [
    'Solid plate. The chicken carries it and the rice is doing its job on a lift day.',
    "==Land around **50g of protein** at each of your last 2 meals== and you'll hit today's target without forcing the last one. You've hit your protein bar in 3 of your last 4 dinners.",
    "I'm least sure on the white rice portion, so tell me how much and I'll tighten the numbers.",
  ]);
  // Only an opener gets the heuristic; any other one-paragraph row stays whole.
  assert.equal(splitAiText(OLD_READ).length, 1);
  assert.equal(splitAiText(OLD_READ, { opener: true }).length, 3);
});

test('OLD ROWS: every uncertainty opener the server can write is a cut', () => {
  for (const line of [
    "I'm not sure how big that bowl was, so tell me.",
    'I’m least sure what the stew actually is, so tell me.',
    "I'm estimating the rice portion on this one, so tell me the amount if it's off.",
    "If anything was cooked or portioned differently than it looks, tell me and I'll tighten the numbers.",
  ]) {
    const parts = splitOldRead(`Good plate here. ${line}`);
    assert.deepEqual(parts, ['Good plate here.', line], line);
  }
});

test('OLD ROWS: "One meal left." travels with the move it introduces', () => {
  const parts = splitOldRead('Good plate here with real protein. One meal left. ==Bring it in around **60g of protein**== and the day closes out.');
  assert.deepEqual(parts, ['Good plate here with real protein.', 'One meal left. ==Bring it in around **60g of protein**== and the day closes out.']);
});

test('OLD ROWS: unsure means one bubble', () => {
  // Nothing to cut on.
  assert.deepEqual(splitOldRead('Solid plate. Real protein. Good timing.'), ['Solid plate. Real protein. Good timing.']);
  // One sentence.
  assert.deepEqual(splitOldRead('==Eat more protein== tonight.'), ['==Eat more protein== tonight.']);
  // The read IS the move from its first sentence, and nothing uncertain follows: no cut.
  assert.deepEqual(splitOldRead('==Eat more protein== tonight. It helps.'), ['==Eat more protein== tonight. It helps.']);
  // A highlight spanning sentences stays in one text (no cut falls between its marks)...
  assert.deepEqual(splitOldRead('Good plate. ==Land it. Then more== later.'), ['Good plate.', '==Land it. Then more== later.']);
  // ...and when a cut WOULD fall inside one, the row stays whole rather than break the mark.
  const spanning = 'Good plate. ==Land it. I’m least sure on the rice portion, so tell me== now.';
  assert.deepEqual(splitOldRead(spanning), [spanning]);
  // A decimal is not a sentence end.
  assert.deepEqual(splitOldRead('Aim for 3.5 oz more chicken. Good.'), ['Aim for 3.5 oz more chicken. Good.']);
  assert.deepEqual(splitOldRead(''), []);
});

test('"Your move" finds the text carrying the highlight', () => {
  assert.equal(isMovePart('==Land around 50g== and done.'), true);
  assert.equal(isMovePart('**50g** in bold only.'), false);
  assert.equal(isMovePart('an unclosed == mark'), false);
});

test('bubblesHtml: one sender line (the caller\'s), the move labelled once, tail and extras on the ends', () => {
  const html = bubblesHtml(opener(NEW_READ), esc, { body: 'WHOLE', head: '<i>HEAD</i>', after: '<i>AFTER</i>' });
  const bubbles = html.match(/<div class="bubble[^"]*">/g);
  assert.equal(bubbles.length, 4);
  assert.equal(html.includes('WHOLE'), false, 'split parts are drawn, not the whole body');
  assert.equal((html.match(/Your move/g) || []).length, 1);
  assert.match(bubbles[1], /tp-move/);
  // Every part but the last hides its tail; the last keeps it.
  assert.equal((html.match(/tp-mid/g) || []).length, 3);
  assert.doesNotMatch(bubbles[3], /tp-mid/);
  // head on the first bubble, after on the last.
  assert.ok(html.indexOf('HEAD') < html.indexOf('Solid plate'));
  assert.ok(html.indexOf('AFTER') > html.indexOf("I'm least sure"));
  // Marks are drawn exactly as richText draws them, and nothing is double-escaped.
  assert.match(html, /<em class="hl">Land around <b>50g of protein<\/b>/);
  assert.match(html, /you&#39;ll|you'll/);
});

test('bubblesHtml: an unsplit row is exactly the old single bubble', () => {
  assert.equal(bubblesHtml({ role: 'ai', text: 'Just one.' }, esc, { body: 'B', head: 'H', after: 'A' }), '<div class="bubble">HBA</div>');
  assert.equal(bubblesHtml({ role: 'athlete', text: 'a\n\nb' }, esc, { body: 'B' }), '<div class="bubble">B</div>');
});

test('bubblesHtml: "Your move" is the READ\'s label, never on a chat reply using the same mark', () => {
  const reply = { role: 'ai', text: 'Here is the thing.\n\n==Eat the eggs first.==' };
  assert.doesNotMatch(bubblesHtml(reply, esc), /Your move/);
});

test('bubblesHtml: an old opener is split by the heuristic and still gets its move', () => {
  const html = bubblesHtml(opener(OLD_READ), esc);
  assert.equal((html.match(/<div class="bubble/g) || []).length, 3);
  assert.equal((html.match(/Your move/g) || []).length, 1);
});

/* ---------------- #4 Seen by, per meal ---------------- */

const fmt = (iso) => {
  const d = new Date(iso);
  let h = d.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getUTCMinutes()).padStart(2, '0')} ${ap}`;
};
const ROOM = [
  { id: 'ath', name: 'Jihad', kind: 'athlete' },
  { id: 'c1', name: 'Coach Grinch', kind: 'head_coach' },
  { id: 'c2', name: 'Coach Brooks', kind: 'position_coach' },
  { id: 'g1', name: 'Mom', kind: 'guardian' },
];

test('nothing until someone on staff opens THIS meal', () => {
  assert.equal(seenByLine({ views: [], selfId: 'ath', participants: ROOM, fmtTime: fmt }), '');
  // The athlete's own stamp is not a coach seeing it.
  assert.equal(seenByLine({ views: [{ viewer_id: 'ath', seen_at: '2026-09-25T16:44:00Z' }], selfId: 'ath', participants: ROOM, fmtTime: fmt }), '');
  assert.equal(seenByLine({ views: null, selfId: 'ath', participants: ROOM, fmtTime: fmt }), '');
});

test('"Seen by Coach Grinch · 12:44 PM", named as the thread names them', () => {
  const line = seenByLine({ views: [{ viewer_id: 'c1', seen_at: '2026-09-25T12:44:00Z' }], selfId: 'ath', participants: ROOM, fmtTime: fmt });
  assert.equal(line, 'Seen by Coach Grinch · 12:44 PM');
});

test('two or more: the most recent by name, "and 1 other", at their time', () => {
  const views = [
    { viewer_id: 'c1', seen_at: '2026-09-25T12:44:00Z' },
    { viewer_id: 'c2', seen_at: '2026-09-25T13:02:00Z' },
    { viewer_id: 'ath', seen_at: '2026-09-25T13:05:00Z' },
  ];
  assert.equal(seenByLine({ views, selfId: 'ath', participants: ROOM, fmtTime: fmt }), 'Seen by Coach Brooks and 1 other · 1:02 PM');
  const three = [...views, { viewer_id: 'c3', seen_at: '2026-09-25T12:00:00Z' }];
  assert.equal(seenByLine({ views: three, selfId: 'ath', participants: [...ROOM, { id: 'c3', name: 'Coach Lee', kind: 's_and_c' }], fmtTime: fmt }),
    'Seen by Coach Brooks and 2 others · 1:02 PM');
});

test('a parent, or someone no longer in the room, is never claimed as a coach', () => {
  assert.equal(seenByLine({ views: [{ viewer_id: 'g1', seen_at: '2026-09-25T12:44:00Z' }], selfId: 'ath', participants: ROOM, fmtTime: fmt }), '');
  assert.equal(seenByLine({ views: [{ viewer_id: 'gone', seen_at: '2026-09-25T12:44:00Z' }], selfId: 'ath', participants: ROOM, fmtTime: fmt }), '');
  // With no room at all (that read failed), a viewer is the screen's own noun, as authorName does.
  assert.equal(seenByLine({ views: [{ viewer_id: 'x', seen_at: '2026-09-25T12:44:00Z' }], selfId: 'ath', participants: [], fmtTime: fmt, fallbackNoun: 'trainer' }),
    'Seen by Trainer · 12:44 PM');
});

test('a view older than the athlete\'s newest message is not shown under it', () => {
  const views = [{ viewer_id: 'c1', seen_at: '2026-09-25T12:44:00Z' }];
  const lastMineAt = Date.parse('2026-09-25T13:00:00Z');
  assert.equal(seenByLine({ views, selfId: 'ath', participants: ROOM, lastMineAt, fmtTime: fmt }), '');
  assert.equal(seenByLine({ views: [{ viewer_id: 'c1', seen_at: '2026-09-25T13:10:00Z' }], selfId: 'ath', participants: ROOM, lastMineAt, fmtTime: fmt }),
    'Seen by Coach Grinch · 1:10 PM');
});

test('a bad timestamp is not a view, and a missing clock drops only the time', () => {
  assert.equal(seenByLine({ views: [{ viewer_id: 'c1', seen_at: 'nope' }], selfId: 'ath', participants: ROOM, fmtTime: fmt }), '');
  assert.equal(seenByLine({ views: [{ viewer_id: 'c1', seen_at: '2026-09-25T12:44:00Z' }], selfId: 'ath', participants: ROOM }), 'Seen by Coach Grinch');
});

/* ---------------- #5a answering Nia's question ---------------- */

const asked = opener(NEW_READ, { ask: { food: 'white rice', aspect: 'portion' } });
const mine = (min) => ({ id: `a${min}`, role: 'athlete', author_id: 'ath', text: 'hi', created_at: `2026-09-25T16:${min}:00Z` });

test('size chips show while Nia\'s question is the newest thing said', () => {
  assert.deepEqual(askChipsFor([asked]), { id: 'op1', food: 'white rice' });
  // The athlete has written since: gone.
  assert.equal(askChipsFor([asked, mine(45)]), null);
  // Something else was said after it (Nia, a coach): the question is no longer the latest word.
  assert.equal(askChipsFor([asked, { id: 'x', role: 'coach', author_id: 'c1', text: 'nice' }]), null);
  // A message is on its way, or it was answered this session: gone before the refetch.
  assert.equal(askChipsFor([asked], { sending: true }), null);
  assert.equal(askChipsFor([asked], { answered: new Set(['op1']) }), null);
  assert.equal(askChipsFor([]), null);
});

test('only Nia\'s opener carries an ask, and only a PORTION question gets size chips', () => {
  assert.equal(askOf(opener(NEW_READ)), null);
  assert.equal(askOf({ ...asked, role: 'athlete' }), null, 'a client can write meta on its own rows; it is not an ask');
  assert.equal(askOf({ ...asked, meta: { t: 'analysis_update', ask: { food: 'rice' } } }), null);
  assert.equal(askOf(opener('x', { ask: { food: 'core power', aspect: 'product' } })), null);
  assert.equal(askOf(opener('x', { ask: { food: 'stew', aspect: 'identity' } })), null);
  assert.deepEqual(askOf(opener('x', { ask: { food: 'Rice' } })), { id: 'op1', food: 'rice' }, 'no aspect: treated as portion');
  assert.equal(askOf(opener('x', { ask: { food: '  ' } })), null);
  assert.equal(askOf(opener('x', { ask: 'rice' })), null);
});

test('a chip sends "Nia, the <food> was a <size> portion."', () => {
  assert.deepEqual(SIZE_CHIPS.map((c) => c.label), ['Small', 'Regular', 'Large']);
  assert.equal(askReplyText('white rice', 'small'), 'Nia, the white rice was a small portion.');
  assert.equal(askReplyText('white rice', 'large'), 'Nia, the white rice was a large portion.');
  const html = askChipsHtml({ id: 'op1', food: 'rice <b>' }, esc);
  assert.equal((html.match(/<button type="button" class="fx-chip tp-chip"/g) || []).length, 3);
  assert.doesNotMatch(html, /<b>/);
  assert.equal(askChipsHtml(null, esc), '');
});

/* ---------------- #5b the starters above the box ---------------- */

test('the three starters and what each does', () => {
  assert.deepEqual(COMPOSER_CHIPS.map((c) => [c.label, c.text, c.send]), [
    ['What should I eat next?', 'Nia, what should I eat next?', true],
    ['It was more', 'Nia, it was more than that: ', false],
    ['Wrong food', 'Nia, that’s not right, it was ', false],
  ]);
  assert.equal(composerChipOf('more').text, 'Nia, it was more than that: ');
  assert.equal(composerChipOf('nope'), null);
  const html = composerChipsHtml(esc);
  assert.equal((html.match(/<button type="button" class="fx-chip tp-chip" data-tp-cmp=/g) || []).length, 3);
  assert.match(composerChipsHtml(esc, { hidden: true }), / hidden>/);
});

test('starters show only on the athlete\'s own meal, with Nia on, and an empty box', () => {
  const base = { authRole: 'athlete', ownMeal: true, mealId: 'm1', consent: true, minorPending: false, draft: '' };
  assert.equal(composerChipsVisible(base), true);
  assert.equal(composerChipsVisible({ ...base, authRole: null }), true, 'role not known yet: still the athlete meal page');
  for (const authRole of ['coach', 'trainer', 'parent']) assert.equal(composerChipsVisible({ ...base, authRole }), false, authRole);
  assert.equal(composerChipsVisible({ ...base, ownMeal: false }), false);
  assert.equal(composerChipsVisible({ ...base, mealId: null }), false, 'a meal not synced yet has no thread');
  assert.equal(composerChipsVisible({ ...base, consent: null }), false, 'never asked: no chips, and no prompt');
  assert.equal(composerChipsVisible({ ...base, consent: false }), false);
  assert.equal(composerChipsVisible({ ...base, minorPending: true }), false);
  assert.equal(composerChipsVisible({ ...base, draft: 'hey' }), false);
  assert.equal(composerChipsVisible({ ...base, draft: '   ' }), true);
});

/* Every chip's words start "Nia," so the addressing gate hands them to her even with a coach in the
   room, where an unaddressed message would be left between the people. */
test('every chip message is routed to Nia by the addressing gate, coach in the room', () => {
  const participants = [{ id: 'ath', name: 'Jihad', kind: 'athlete' }, { id: 'c1', name: 'Coach Grinch', kind: 'head_coach' }];
  const comments = [{ id: 'k', role: 'coach', author_id: 'c1', text: 'Good lunch', created_at: new Date().toISOString() }];
  const texts = [
    ...SIZE_CHIPS.map((c) => askReplyText('white rice', c.size)),
    'Nia, what should I eat next?',
    'Nia, it was more than that: two cups',
    'Nia, that’s not right, it was brown rice',
  ];
  for (const text of texts) {
    const turn = decideAiTurn({ text, comments, participants, self: { id: 'ath', name: 'Jihad', role: 'athlete' }, athleteName: 'Jihad', fallbackNoun: 'coach' });
    assert.equal(turn.decision.shouldRespond, true, text);
  }
});

/* ---------------- the wiring ---------------- */

test('all four renderers draw bubbles through the shared path', () => {
  for (const f of ['./screens/meal.js', './screens/coach.js', './screens/trust.js', './screens/nutrition-chat.js']) {
    const s = src(f);
    assert.match(s, /import \{[^}]*bubblesHtml[^}]*\} from '\.\.\/thread-polish\.js'/, f);
    assert.match(s, /\$\{bubblesHtml\(c, esc, \{/, f);
  }
});

test('the meal page never says the coach has not opened it, and its chips cannot stack', () => {
  const s = src('./screens/meal.js');
  assert.doesNotMatch(s, /hasn't opened this yet'|hasn't opened this yet\.`/);
  assert.match(s, /seenByLine\(\{/);
  assert.match(s, /mealViews === null \? dayLine/, 'the day receipt only stands in when the per-meal read failed');
  assert.match(s, /!S\.coach\.hasCoach \? ''/, 'a solo athlete never sees a coach line');
  // Delegated on #view (rebuilt each render), not the persistent device root.
  assert.match(s, /viewEl\.addEventListener\('click', \(ev\) => \{\s*\/\/ Nia's portion question/);
  assert.match(s, /beginSend\(M\.mealId, \{ text, photo: null, replyTo: null \}\)/, 'chips send through the normal outbox path');
});

test('thread-polish is lazy: never in the boot graph', () => {
  const router = src('./router.js');
  assert.doesNotMatch(router, /thread-polish/);
});
