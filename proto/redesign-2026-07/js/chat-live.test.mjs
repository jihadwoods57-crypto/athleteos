/* The live thread (2026-09-22): one send is one intent, messages render in full, replies carry a
 * quote, and the AI at work is visible. Pins chat-live.js's state machine, chat-view.js's new
 * row helpers, and, structurally, that no renderer clamps a message or posts twice.
 *
 * The incident: a coach's "The nutrition facts is in the picture" was stored twice, 15s apart.
 * The coach composer had no send lock, the input only cleared once the post returned, and the
 * sparkle re-posted text that had just been sent. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  beginSend, endSend, takeFailed, justSent, isSending, pendingOf, setAiWorking, aiWorkingOf,
  setReply, replyOf, clearReply, noteArrivals, bindLive, DUP_WINDOW_MS, __resetChatLive,
} from './chat-live.js';
import {
  replyRefOf, replyTargetMeta, replyQuote, replyQuoteHtml, linkify, personText, richText,
  receiptCardHtml, typingRowHtml, workingLabel, pendingRowHtml,
} from './chat-view.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, p), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RENDERERS = ['screens/meal.js', 'screens/nutrition-chat.js', 'screens/coach.js', 'screens/trust.js'];

beforeEach(() => __resetChatLive());

/* ---- one send, one intent ---- */

test('a second tap while a send is in flight is the same tap', () => {
  const a = beginSend('m1', { text: 'The nutrition facts is in the picture' });
  assert.equal(a.ok, true);
  assert.equal(isSending('m1'), true);
  const b = beginSend('m1', { text: 'The nutrition facts is in the picture' });
  assert.deepEqual(b, { ok: false, reason: 'inflight' });
  assert.equal(pendingOf('m1').length, 1, 'one bubble, not two');
});

test('the same words re-sent inside the window are recognised as already sent', () => {
  const a = beginSend('m1', { text: 'The nutrition facts is in the picture' });
  endSend('m1', a.item.lid, { ok: true });
  assert.equal(pendingOf('m1').length, 0, 'a landed send leaves the outbox (the real row replaces it)');
  // Case, spacing and a trailing full stop do not make it a different message.
  const b = beginSend('m1', { text: '  the nutrition facts is in the picture. ' });
  assert.deepEqual(b, { ok: false, reason: 'duplicate' });
  assert.equal(justSent('m1', 'The nutrition facts is in the picture'), true, "the coach's sparkle asks, it does not re-post");
  // A different thread, or different words, is a different intent.
  assert.equal(beginSend('m2', { text: 'The nutrition facts is in the picture' }).ok, true);
  assert.ok(DUP_WINDOW_MS >= 15000, 'the incident was 15 seconds apart');
});

test('a send that failed is not a duplicate: it stays as Not delivered and can be retried', () => {
  const a = beginSend('m1', { text: 'had this too' });
  endSend('m1', a.item.lid, { ok: false });
  const [p] = pendingOf('m1');
  assert.equal(p.state, 'failed');
  assert.equal(isSending('m1'), false, 'a failure frees the thread');
  const back = takeFailed('m1', p.lid);
  assert.equal(back.text, 'had this too');
  assert.equal(beginSend('m1', { text: 'had this too' }).ok, true, 'the retry goes out');
});

test('a photo is never swallowed as a duplicate of its caption', () => {
  const a = beginSend('m1', { text: 'this' });
  endSend('m1', a.item.lid, { ok: true });
  assert.equal(beginSend('m1', { text: 'this', photo: { dataUrl: 'data:image/jpeg;base64,x' } }).ok, true);
});

test('state changes reach the screen through bindLive, not a re-render', () => {
  let n = 0;
  bindLive('m1', { sync: () => { n++; } });
  const a = beginSend('m1', { text: 'x' });
  endSend('m1', a.item.lid, { ok: true });
  setAiWorking('m1', true, { label: 'Reading the photo' });
  assert.equal(aiWorkingOf('m1').label, 'Reading the photo');
  setAiWorking('m1', false);
  assert.equal(aiWorkingOf('m1'), null);
  assert.equal(n, 4);
});

/* ---- arrivals ---- */

test('opening a thread plays no entrances; a row that arrives later does, once', () => {
  const rows = [{ id: 'a', author_id: 'u2', role: 'coach' }];
  assert.equal(noteArrivals('m1', rows, 'me').fresh.size, 0);
  const r2 = noteArrivals('m1', [...rows, { id: 'b', author_id: 'u2', role: 'coach' }, { id: 'c', author_id: 'me', role: 'athlete' }], 'me');
  assert.deepEqual([...r2.fresh], ['b'], 'your own row made its entrance as the outbox bubble');
  assert.equal(r2.added, 1, 'the unread count is what someone else said');
  assert.equal(noteArrivals('m1', rows, 'me').added, 0);
});

/* ---- replies ---- */

test('a reply pointer is bounded on the way in and re-read from the live message on the way out', () => {
  const orig = { id: 'c1', author_id: 'coach1', role: 'coach', text: 'Make sure that gets **added** in' };
  const ref = replyTargetMeta(orig, 'Coach Brooks');
  assert.deepEqual(ref, { id: 'c1', who: 'Coach Brooks', text: 'Make sure that gets added in', aid: 'coach1' });
  const reply = { id: 'r1', meta: { replyTo: { ...ref, text: 'forged words' } } };
  const q = replyQuote(reply, [orig]);
  assert.equal(q.text, 'Make sure that gets added in', 'the live message wins over what a client stored');
  // Off-screen original: the stored excerpt stands in, unless its author is muted.
  assert.equal(replyQuote(reply, []).text, 'forged words');
  assert.equal(replyQuote(reply, [], ['coach1']), null, 'a muted person is never quoted');
  // A pointer that is not an id is no pointer.
  assert.equal(replyRefOf({ meta: { replyTo: { id: '"><img src=x>' } } }), null);
  assert.equal(replyRefOf({ meta: '{"replyTo":{"id":"ok_1","who":"<b>x</b>"}}' }).who, 'bx/b', 'strings from meta are stripped of angle brackets');
});

test('the quote is a button that jumps to the original, and escapes what it prints', () => {
  const h = replyQuoteHtml({ id: 'c1', who: '<Coach>', text: 'a <b>b</b>' }, esc);
  assert.match(h, /^<button type="button" class="quote rq" data-jump="c1"/);
  assert.doesNotMatch(h, /<b>b<\/b>/);
  assert.equal(replyQuoteHtml({ id: 'c1', who: 'x', text: '' }, esc), '', 'nothing to quote, no chip');
  assert.match(replyQuoteHtml({ id: 'c1', who: 'Jihad', text: '', photo: true }, esc), /Photo/);
});

test('the reply being written is held per thread and cleared after the send', () => {
  setReply('m1', { id: 'c1', who: 'You', text: 'hi' });
  assert.equal(replyOf('m1').id, 'c1');
  assert.equal(replyOf('m2'), null);
  clearReply('m1');
  assert.equal(replyOf('m1'), null);
});

/* ---- bubbles ---- */

test('links: https only, escaped first, trailing punctuation left outside', () => {
  const h = personText('label: https://example.com/a?b=1&c=2. thanks', esc);
  assert.match(h, /<a class="blink" href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">/);
  assert.match(h, /<\/a>\. thanks/);
  assert.doesNotMatch(linkify('http://insecure.example'), /<a /, 'http is not a link: only https reaches the system browser');
  assert.doesNotMatch(personText('javascript:alert(1)', esc), /<a /);
  assert.match(personText('a\nb', esc), /a<br>b/, 'a person\'s line breaks are kept');
  assert.match(richText('see https://x.example/y', esc), /<a class="blink"/, 'the AI\'s links are live too');
  assert.match(personText('**not bold**', esc), /\*\*not bold\*\*/, 'only the AI is parsed for marks');
});

test('one receipt card, with the reason line when the server wrote one', () => {
  const c = { id: 'r1', role: 'ai', meta: { t: 'correction_receipt', note: "Added from Jihad's photo at Coach Brooks' request", rows: [{ label: 'Protein', unit: 'g', from: 52, to: 94 }] } };
  const h = receiptCardHtml(c, esc);
  assert.match(h, /data-cid="r1"/);
  assert.match(h, /class="corr-note">Added from Jihad&#39;s photo/);
  assert.match(h, /52g/);
  assert.equal(receiptCardHtml({ role: 'athlete', meta: c.meta }, esc), '', 'only an AI row is a receipt');
});

test('the AI at work says what it is doing when it is reading a photo', () => {
  assert.equal(workingLabel([{ role: 'ai' }, { role: 'athlete', meta: { photo: 'u/chat/1.jpg' }, text: "I'm also drinking this" }]), 'Reading the photo');
  assert.equal(workingLabel([{ role: 'athlete', meta: { photo: 'u/chat/1.jpg' } }, { role: 'ai' }]), '', 'an answered photo is not being read');
  assert.match(typingRowHtml(esc, { label: 'Reading the photo' }), /Reading the photo…/);
  assert.match(typingRowHtml(esc), /tdots/);
  assert.match(typingRowHtml(esc), /live-row/, 'placed by syncLive, removable by it');
});

test('the outbox bubble says Sending, then Not delivered with a real retry button', () => {
  const img = (u) => u;
  const s = pendingRowHtml({ lid: 'l1', text: 'hi', state: 'sending' }, esc, img);
  assert.match(s, /Sending…/);
  const f = pendingRowHtml({ lid: 'l1', text: 'hi', state: 'failed' }, esc, img);
  assert.match(f, /<button type="button" class="dlv out-retry" data-out-retry="l1">/);
  assert.match(pendingRowHtml({ lid: 'l2', text: '', photo: { dataUrl: 'data:image/jpeg;base64,x' }, state: 'sending' }, esc, img), /msg athlete last pend live-row photo/);
});

/* ---- structural: the four renderers ---- */

test('messages render in full: the Read more clamp is gone from every renderer', () => {
  assert.equal(existsSync(join(HERE, 'thread-readmore.js')), false, 'the clamp module is retired');
  for (const f of RENDERERS) {
    const s = src(f);
    assert.doesNotMatch(s, /wireReadMore|thread-readmore|EXPANDED_BUBBLES/, `${f} still clamps`);
  }
  assert.doesNotMatch(src('../css/screens.css'), /\.bt-clamp|\.read-more/, 'and its CSS is gone');
});

test('every composer sends through the shared guard, and none keeps a mount-scoped lock for it', () => {
  for (const f of RENDERERS) {
    const s = src(f);
    assert.match(s, /beginSend\(/, `${f}: the send is claimed`);
    assert.match(s, /endSend\(/, `${f}: and settled`);
    assert.match(s, /bindLive\(/, `${f}: live rows re-place on state change`);
    assert.match(s, /syncLive\(/, `${f}: and after every paint`);
  }
  const coach = src('screens/coach.js');
  assert.match(coach, /if \(!\(justSent\(sub, text\) && !pendingPhoto\)\)/, "the sparkle does not re-post words the coach just sent");
  assert.match(coach, /setAiWorking\(sub, true/, 'the coach sees the AI at work in the thread');
  assert.match(coach, /CM_WIRED\.has\(root\)/, 'the photo-tap listener is added once, not once per repaint');
});

test('the header never lets content show above it', () => {
  const glass = src('../css/glass.css');
  assert.match(glass, /\.back-head::before \{\n\s*content: ''; position: absolute; inset: calc\(-1 \* var\(--vp-top, 0px\)\) 0 0;/);
  assert.match(src('../css/app.css'), /--vp-top: max\(14px, env\(safe-area-inset-top\)\); padding-top: var\(--vp-top\);/);
});
