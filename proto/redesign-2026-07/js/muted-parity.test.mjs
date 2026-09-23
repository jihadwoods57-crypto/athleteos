/* Mute parity across the four thread renderers, pinned structurally (source-string pins, the
 * shape this repo uses for wiring no unit test can see — the proto has no build step, so a
 * drifted anchor fails at click time, silently, as vanished reactions or a blank thread).
 *
 * The contract under pin (2026-09-16): every renderer slices, counts, anchors and QUOTES from
 * visibleThread(...) — the SAME list layoutThread paints — never from the pre-filter messages;
 * a thread (or one meal's segment) whose every author is muted says MUTED_HIDDEN_NOTE instead
 * of painting blank or claiming "no messages yet"; and reactions with no visible bubble to
 * ride fall back to a mute-filtered strip instead of vanishing. trust.js has said the sentence
 * since 09-09; the other three anchored pre-filter, so muting the newest author swallowed the
 * meal's reactions with the bubble that carried them.
 *
 * Both ends of each wire are pinned — the computation line AND the usage site (the Delivered
 * tag, the reaction pill, the quote stem) — so re-keying a usage inline cannot pass. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, p), 'utf8');

test('meal thread: preview, reactions, Delivered, receipt, quote and the coach pin all follow the mute filter', () => {
  const m = src('screens/meal.js');
  assert.match(m, /const visible = visibleThread\(msgs, RT\.mutedUsers\);/, 'one filtered list, computed once');
  assert.match(m, /const shown = visible\.slice\(-PREVIEW_MSGS\);/, 'the 4-message preview slices what the reader sees');
  assert.match(m, /const hiddenCount = visible\.length - shown\.length;/, 'the "earlier messages" count agrees with it');
  assert.match(m, /const lastMsg = visible\.length \? visible\[visible\.length - 1\] : null;/, 'the anchor is the last VISIBLE message');
  assert.doesNotMatch(m, /lastMsg = msgs\.length \? msgs\[msgs\.length - 1\]/, 'the pre-filter anchor that vanished reactions is gone');
  // Both usage sites of the anchor, so re-keying one inline cannot slip past the pin above.
  assert.match(m, /const rx = c === rxAt \? reactionGroups\(comments\) : \[\];/, 'the reaction pill rides the anchor');
  assert.match(m, /\$\{deliveredHtml\(\{ mine, isLast: c === lastMsg \}\)\}/, 'the Delivered tag rides the anchor');
  assert.match(m, /const quoted = update \? quotedFor\(c, visible\) : null;/, 'a quote stem cannot resurface muted words');
  assert.match(m, /const lastCoach = \[\.\.\.visible\]\.reverse\(\)/, 'the pin cannot resurface a muted coach');
  assert.match(m, /const lastMsgAt = visible\.length\n\s*\? Math\.max\(\.\.\.visible\.map/, 'the receipt freshness gate reads what the reader sees');
  assert.match(m, /if \(msgs\.length && !visible\.length\) tail\.push\(MUTED_HIDDEN_NOTE\);/, 'all-muted says so instead of painting blank');
  assert.match(m, /const strandedRx = !visible\.length \? reactionGroups\(visibleThread\(comments, RT\.mutedUsers\)\) : \[\];/,
    'reactions with no bubble to ride fall back to a strip, mute-filtered so a hidden person never paints above the line hiding them');
});

test("coach's meal view: same anchors, and all-muted is named, not blank and not 'No comments yet'", () => {
  const c = src('screens/coach.js');
  assert.match(c, /const visible = visibleThread\(msgs, RT\.mutedUsers\);/);
  assert.match(c, /const lastMsg = visible\.length \? visible\[visible\.length - 1\] : null;/);
  assert.doesNotMatch(c, /lastMsg = msgs\.length \? msgs\[msgs\.length - 1\]/);
  assert.match(c, /const bubbleRx = c === rxAt \? rx : \[\];/, 'the reaction pill rides the anchor');
  assert.match(c, /\$\{deliveredHtml\(\{ mine, isLast: c === lastMsg \}\)\}/, 'the Delivered tag rides the anchor');
  assert.match(c, /const quoted = update \? quotedFor\(c, visible\) : null;/, 'a quote stem cannot resurface muted words');
  assert.match(c, /\$\{!visible\.length \? `/, 'the empty branch keys on what is painted');
  assert.match(c, /reactionGroups\(visibleThread\(MC\.comments, RT\.mutedUsers\)\)/, 'the bare strip is mute-filtered too');
  assert.match(c, /\$\{msgs\.length\n\s*\? \/\* Messages exist but the mute filter dropped every one/, 'and tells muted apart from truly empty');
  assert.match(c, /`<div class="msg-status">\$\{MUTED_HIDDEN_NOTE\}<\/div>`/);
});

test('nutrition chat: run anchors follow the filter, and an all-muted meal says so under its own card', () => {
  const n = src('screens/nutrition-chat.js');
  assert.match(n, /const vis = visibleThread\(list, RT\.mutedUsers\);/);
  assert.match(n, /if \(list\.length && !vis\.length\) return `<div class="msg-status">\$\{MUTED_HIDDEN_NOTE\}<\/div>`;/,
    'a meal whose whole discussion is muted is named per segment, not silence under a divider');
  assert.match(n, /const lastMsg = vis\.length \? vis\[vis\.length - 1\] : null;/);
  assert.doesNotMatch(n, /lastMsg = list\.length \? list\[list\.length - 1\]/, 'the pre-filter run anchor is gone');
  assert.match(n, /const newest = visAll\.length \? visAll\[visAll\.length - 1\] : null;/, 'Delivered keys to the newest VISIBLE message');
  assert.doesNotMatch(n, /allMsgs/, 'no pre-filter window survives in renderRun to re-key an anchor to');
  assert.match(n, /const rx = c === rxAt && c\.meal_id/, 'the reaction pill rides the run anchor');
  assert.match(n, /\$\{deliveredHtml\(\{ mine, isLast: c === newest \}\)\}/, 'the Delivered tag rides the window anchor');
  assert.match(n, /const quoted = update \? quotedFor\(c, visAll\) : null;/, 'a quote stem cannot resurface muted words');
  assert.match(n, /const visAll = visibleThread\(msgs, RT\.mutedUsers\);\n\s*let run = \[\];/, 'filtered once per repaint, not once per meal');
});

test('trust thread quotes from the painted list and reads the same sentence from the same constant', () => {
  const t = src('screens/trust.js');
  assert.match(t, /const visible = msgItems\.map\(\(i\) => i\.comment\);/, 'the painted messages, straight from layoutThread');
  assert.match(t, /const quoted = update \? quotedFor\(c, visible\) : null;/, 'a quote stem cannot resurface muted words');
  assert.match(t, /`<div class="msg-status">\$\{MUTED_HIDDEN_NOTE\}<\/div>`/);
  assert.doesNotMatch(t, /'Messages from people you muted are hidden\.'/, 'no second copy of the sentence to drift');
});
