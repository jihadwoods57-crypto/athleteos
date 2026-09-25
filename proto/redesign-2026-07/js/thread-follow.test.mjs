/* Three meal-thread bugs the founder found on a real iPhone (2026-09-24), each pinned here.
 *
 *  1. "Delivered" sat UNDER the last bubble: a -6px top margin, and .bubble is position:relative,
 *     so it painted over the top half of the word.
 *  2. "When I get a new message from Nia I need to scroll down to see it every time." The end was
 *     measured AFTER the reply landed (a reader resting on the newest message is one reply short
 *     of it), the pill only showed past 240px, and a same-route re-render dropped the reader
 *     hundreds of pixels because router.js restored scrollTop before the thread had painted.
 *  3. Nia's what-to-eat bubble printed "**180g**": it was the one AI row drawn through esc()
 *     instead of richText.
 * The numbers in the follow tests are the ones measured headless on the meal thread. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { holdThread, followThread, syncJump, jumpLabel, noteArrivals, __resetChatLive, __pinsForTest } from './chat-live.js';
import { richText, plainText, mealSuggestHtml, mealSuggestOf, memoryOfferChips, memoryOfferOf, deliveredHtml } from './chat-view.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, p), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---- a viewport, as far as chat-live.js can see one ---- */
function fakeVp({ h = 2028, ch = 844, top = 0 } = {}) {
  const vp = {
    scrollHeight: h, clientHeight: ch, scrollTop: top, isConnected: true, calls: [], listeners: [],
    scrollTo({ top: t, behavior }) { this.calls.push(behavior); this.scrollTop = Math.max(0, Math.min(t, this.scrollHeight - this.clientHeight)); },
    addEventListener(type, fn) { this.listeners.push(fn); },
    querySelector: () => null,
  };
  vp.closest = (sel) => (sel === '.viewport' ? vp : null);
  return vp;
}
const threadIn = (vp) => ({ closest: (sel) => (sel === '.viewport' ? vp : null) });
const atEnd = (vp) => vp.scrollHeight - vp.clientHeight - vp.scrollTop <= 1;

/* ---- the jump pill needs a dock and document.createElement ---- */
function fakeEl() {
  const el = {
    className: '', innerHTML: '', attrs: {}, cls: new Set(), click: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { if (type === 'click') this.click = fn; },
    classList: { toggle: (n, on) => { if (on) el.cls.add(n); else el.cls.delete(n); } },
  };
  return el;
}
function fakeDock() {
  const dock = {
    isConnected: true, kids: [],
    querySelector(sel) { return sel.includes('jump-latest') ? this.kids.find((k) => k.className === 'jump-latest') || null : null; },
    appendChild(el) { this.kids.push(el); el.remove = () => { dock.kids = dock.kids.filter((k) => k !== el); }; },
  };
  return dock;
}
globalThis.document = globalThis.document || { createElement: () => fakeEl() };
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 0));

beforeEach(() => __resetChatLive());

/* ================= 2. following the conversation ================= */

test('a reader resting on the newest message follows a Nia reply that lands (the measured 167px case)', () => {
  const vp = fakeVp({ h: 2028, top: 1184 });              // gap 0: resting on the newest message
  const hold = holdThread(threadIn(vp), 'meal-1');       // BEFORE the paint
  vp.scrollHeight = 2194;                                 // Nia's reply lands: +166px
  const followed = followThread(hold, { smooth: true });
  assert.equal(followed, true);
  assert.ok(atEnd(vp), 'the reply is in view without a scroll');
  assert.equal(vp.calls.at(-1), 'smooth', 'something arrived, so it glides');
});

test('the old way missed exactly this: measured after the paint, the reader looked 166px away', () => {
  // The rule every renderer used (keyboard.js scrollThreadToEnd, unforced): end - scrollTop > 120
  // means "not at the end, leave them". After the paint that is 166 > 120, so no follow.
  const end = 2194 - 844;
  assert.ok(end - 1184 > 120, 'the post-paint measure said "reading back"');
});

test('a plain repaint (nothing arrived) keeps the end without animating', () => {
  const vp = fakeVp({ h: 2028, top: 1184 });
  const hold = holdThread(threadIn(vp), 'meal-1');
  vp.scrollHeight = 2070;                                 // the typing row, say
  followThread(hold, { smooth: false });
  assert.ok(atEnd(vp));
  assert.equal(vp.calls.at(-1), 'instant');
});

test('a reader scrolled up into history is never moved by an arrival', () => {
  const vp = fakeVp({ h: 2194, top: 850 });               // 500px back
  const hold = holdThread(threadIn(vp), 'meal-1');
  vp.scrollHeight = 2400;
  assert.equal(followThread(hold, { smooth: true }), false);
  assert.equal(vp.scrollTop, 850);
  assert.equal(vp.calls.length, 0, 'not even an instant nudge');
});

test('sending always shows your own message, even from history', () => {
  const vp = fakeVp({ h: 2194, top: 400 });
  const hold = holdThread(threadIn(vp), 'meal-1');
  vp.scrollHeight = 2260;
  assert.equal(followThread(hold, { force: true, smooth: true }), true);
  assert.ok(atEnd(vp));
});

test('a paint landing mid-glide still follows: the glide counts as being at the end', () => {
  const vp = fakeVp({ h: 2028, top: 1184 });
  followThread(holdThread(threadIn(vp), 'meal-1'), {});   // settle a pin
  vp.scrollHeight = 2194;
  followThread(holdThread(threadIn(vp), 'meal-1'), { force: true, smooth: true });
  // A real smooth scroll is still on its way: put the reader short of the end, as its scroll
  // events do, and land another row.
  vp.scrollTop = 1200;
  vp.scrollHeight = 2300;
  const hold = holdThread(threadIn(vp), 'meal-1');
  assert.equal(hold.end, true, 'mid-glide is at the end, not "reading back"');
});

test('a same-route re-render at the end lands back on the newest message (was 617px up)', () => {
  const old = fakeVp({ h: 2194, top: 1350 });             // resting at the end
  followThread(holdThread(threadIn(old), 'meal-1'), {});
  // router.js builds a NEW viewport and restores 1350, clamped by a page with no messages yet.
  const vp = fakeVp({ h: 1411, top: 567 });
  const hold = holdThread(threadIn(vp), 'meal-1');
  assert.equal(hold.end, true, 'the pin from the old viewport is the truth');
  vp.scrollHeight = 2194;                                 // the thread paints from the cache
  followThread(hold, {});
  assert.ok(atEnd(vp));
  assert.equal(vp.calls.at(-1), 'instant', 'a repaint snaps; only an arrival glides');
});

test('a same-route re-render mid-history puts the reader back where they were', () => {
  const old = fakeVp({ h: 2194, top: 850 });
  followThread(holdThread(threadIn(old), 'meal-1'), {});
  const vp = fakeVp({ h: 1411, top: 567 });               // clamped short of 850
  const hold = holdThread(threadIn(vp), 'meal-1');
  vp.scrollHeight = 2194;
  assert.equal(followThread(hold, {}), false);
  assert.equal(vp.scrollTop, 850);
});

test('arriving fresh on a thread (scrollTop 0) is measured, not pinned: the meal page opens at the plate', () => {
  const old = fakeVp({ h: 2194, top: 1350 });
  followThread(holdThread(threadIn(old), 'meal-1'), {});
  const vp = fakeVp({ h: 2194, top: 0 });                  // a real navigation starts at the top
  const hold = holdThread(threadIn(vp), 'meal-1');
  assert.equal(hold.end, false);
  followThread(hold, { smooth: true });
  assert.equal(vp.scrollTop, 0);
});

test('pins are per thread: another meal does not inherit this one', () => {
  const old = fakeVp({ h: 2194, top: 1350 });
  followThread(holdThread(threadIn(old), 'meal-1'), {});
  const vp = fakeVp({ h: 1411, top: 300 });
  const hold = holdThread(threadIn(vp), 'meal-2');
  assert.equal(hold.restore, false);
  assert.equal(hold.end, false);
});

/* ---- the pill ---- */

test('the pill says it in words: "New message", then "3 new messages"', () => {
  assert.equal(jumpLabel(0), '');
  assert.equal(jumpLabel(1), 'New message');
  assert.equal(jumpLabel(3), '3 new messages');
  assert.equal(jumpLabel(140), '99+ new messages');
});

test('scrolled up just past the line (150px, the old dead zone) an arrival shows the pill', () => {
  const vp = fakeVp({ h: 2194, top: 1200 });             // 150px back: neither followed nor pilled before
  const dock = fakeDock();
  const hold = holdThread(threadIn(vp), 'meal-1');
  vp.scrollHeight = 2360;
  followThread(hold, { smooth: true });
  assert.equal(vp.scrollTop, 1200, 'not yanked');
  syncJump(threadIn(vp), 'meal-1', { dock, added: 1 });
  const pill = dock.querySelector('.jump-latest');
  assert.ok(pill, 'the pill is up');
  assert.match(pill.innerHTML, /<span class="jl-t">New message<\/span>/);
  assert.ok(pill.cls.has('has-new'));
  assert.equal(pill.attrs['aria-label'], 'New message. Jump to the latest');
  syncJump(threadIn(vp), 'meal-1', { dock, added: 2 });
  assert.match(pill.innerHTML, /3 new messages/);
  // Tapping it goes to the newest message, and the pill goes.
  pill.click();
  assert.ok(atEnd(vp));
  assert.equal(dock.querySelector('.jump-latest'), null);
});

test('at the end, an arrival is followed and never counted as unread', () => {
  const vp = fakeVp({ h: 2028, top: 1184 });
  const dock = fakeDock();
  const hold = holdThread(threadIn(vp), 'meal-1');
  vp.scrollHeight = 2194;
  followThread(hold, { smooth: true });
  syncJump(threadIn(vp), 'meal-1', { dock, added: 1 });
  assert.equal(dock.querySelector('.jump-latest'), null);
});

test('noteArrivals still counts only other people, so your own send never raises the pill', () => {
  noteArrivals('m', [{ id: 'a', author_id: 'me', role: 'athlete' }], 'me');
  const r = noteArrivals('m', [{ id: 'a', author_id: 'me', role: 'athlete' }, { id: 'b', author_id: 'me', role: 'athlete' }], 'me');
  assert.equal(r.added, 0);
});

/* ---- every renderer uses it ---- */

const RENDERERS = ['screens/meal.js', 'screens/nutrition-chat.js', 'screens/coach.js', 'screens/trust.js'];
test('all four thread renderers read the reader BEFORE painting and follow AFTER', () => {
  for (const f of RENDERERS) {
    const s = src(f);
    assert.match(s, /holdThread\(/, `${f}: holds the reader's place`);
    assert.match(s, /followThread\(/, `${f}: follows the newest message`);
    assert.doesNotMatch(s, /scrollThreadToEnd\((threadEl|el)\b/, `${f}: no post-paint "near the end?" measure left`);
  }
  // The inline paints take the hold before the innerHTML that adds the new rows.
  for (const [f, marker] of [['screens/meal.js', 'threadEl.innerHTML = coachPin'], ['screens/nutrition-chat.js', "threadEl.innerHTML = html.join('')"], ['screens/trust.js', 'threadEl.innerHTML = items.map']]) {
    const s = src(f);
    const at = s.indexOf(marker);
    assert.ok(at > 0, `${f}: paint found`);
    assert.ok(s.lastIndexOf('holdThread(', at) > s.lastIndexOf('const paint = ', at), `${f}: hold is taken inside paint, before the rows land`);
  }
});

test("Nia's reply in the full chat is not forced on a reader who scrolled up while she typed", () => {
  const s = src('screens/nutrition-chat.js');
  const from = s.indexOf('const askAI');
  const ask = s.slice(from, s.indexOf('---- LIVE:', from));
  assert.ok(ask.length > 100, 'askAI found');
  assert.doesNotMatch(ask, /scrollThreadToEnd\(root, \{ force: true \}\)/);
});

/* ================= 1. Delivered ================= */

test('"Delivered" sits below the bubble, never under it', () => {
  assert.equal(deliveredHtml({ mine: true, isLast: true }), '<div class="dlv">Delivered</div>');
  const css = src('../css/screens.css');
  const rule = css.match(/^\.dlv \{([^}]*)\}/m);
  assert.ok(rule, 'the .dlv rule');
  const margin = (rule[1].match(/margin:\s*([^;]+);/) || [])[1] || '';
  assert.ok(margin, '.dlv sets its margin');
  assert.doesNotMatch(margin, /^(-|calc\(\s*-)/, 'no negative top margin pulling it under the positioned bubble');
  // The bubble is what covered it: still positioned (the tail and the reaction pill need it).
  assert.match(css, /\.msg \.bubble \{ position: relative;/);
});

/* ================= 3. Nia's emphasis, drawn ================= */

const FOUNDER = {
  role: 'ai', text: "Jihad, you're at 155g with all required meals done, so a snack tonight gets you to your **180g** target. Go with a protein-forward option like a shake or cottage cheese with fruit to close the last 25g without a heavy plate this late.",
  meta: { t: 'meal_suggest', proteinGap: 25,
    framing: "Jihad, you're at 155g with all required meals done, so a snack tonight gets you to your **180g** target.",
    fallback: 'Go with a protein-forward option like a shake or cottage cheese with fruit to close the last 25g without a heavy plate this late.' },
};

test("the founder's what-to-eat bubble: **180g** is bold, not asterisks", () => {
  const html = mealSuggestHtml(mealSuggestOf(FOUNDER), [], esc);
  assert.match(html, /your <b>180g<\/b> target/);
  assert.doesNotMatch(html, /\*/);
});

test('with picks, the framing line is drawn the same way and the chips stay', () => {
  const html = mealSuggestHtml(mealSuggestOf(FOUNDER), [{ id: 'fm1', name: 'Shake', protein: 40, kcal: 300 }], esc);
  assert.match(html, /<b>180g<\/b>/);
  assert.match(html, /data-fm-plan="fm1"/);
});

test('it escapes FIRST: nothing in a suggestion can open a tag', () => {
  const html = mealSuggestHtml({ framing: '**<img src=x onerror=alert(1)>** eat', fallback: '**<script>**' }, [], esc);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /<b>&lt;img src=x onerror=alert\(1\)&gt;<\/b>/);
});

test('a stray, unmatched ** is dropped, and the words stay', () => {
  assert.equal(richText('close the gap with **180g and a shake', esc), 'close the gap with 180g and a shake');
  assert.equal(richText('**180g** then **more', esc), '<b>180g</b> then more');
  assert.equal(plainText('your **180g target'), 'your 180g target');
  // A person's bubble is not Nia's: their asterisks are theirs (personText never parses).
});

test('older stored rows render cleanly: a plain AI row with marks, and one with none', () => {
  assert.equal(richText('Aim for **40g** at dinner.', esc), 'Aim for <b>40g</b> at dinner.');
  assert.equal(richText('No marks at all.', esc), 'No marks at all.');
});

test('the remember-this question under a bubble never shows raw marks', () => {
  const offer = memoryOfferOf({ role: 'ai', meta: { t: 'memory_offer', factId: 'f1', value: 'lactose intolerant', ask: 'Remember that you are **lactose intolerant**?' } });
  const html = memoryOfferChips(offer, esc);
  assert.match(html, /Remember that you are lactose intolerant\?/);
  assert.doesNotMatch(html, /\*/);
});

/* ---- the pins are bounded and hold no DOM (review 2026-09-24) ---- */
test('where readers rested is remembered for the last 20 threads, as numbers, never elements', () => {
  for (let i = 0; i < 45; i++) {
    const vp = fakeVp({ top: 100 + i });
    followThread(holdThread(threadIn(vp), `meal-${i}`), {});
  }
  const pins = __pinsForTest();
  assert.equal(pins.length, 20, 'bounded');
  assert.deepEqual(pins.map(([k]) => k), Array.from({ length: 20 }, (_, i) => `meal-${25 + i}`), 'oldest out first');
  for (const [, v] of pins) {
    assert.deepEqual(Object.keys(v).sort(), ['end', 'top', 'vpId']);
    assert.equal(typeof v.vpId, 'number', 'a number standing for the viewport, not the viewport');
  }
});

test('a re-mounted viewport is still told apart from the one the pin was taken in', () => {
  const a = fakeVp({ h: 3000, top: 900 });
  followThread(holdThread(threadIn(a), 'meal-x'), {});
  const b = fakeVp({ h: 3000, top: 300 });   // router.js restored a clamped offset
  const hold = holdThread(threadIn(b), 'meal-x');
  assert.equal(hold.restore, true);
  assert.equal(hold.top, 900);
});
