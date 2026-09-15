/* The thread as Messages draws it (2026-09-14): the shared row rules, and the four renderers
 * agreeing on them.
 *
 * Every courtesy that lived in one renderer alone took weeks to reach the other three
 * (read-more, memory chips, the composer pill). The row's class list, its separator, its
 * receipt and its per-message clock are now chat-view.js helpers; this file pins the helpers
 * and, structurally, that all four renderers call them and put the face on the LAST bubble. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { layoutThread, msgRowClass, timeSepHtml, deliveredHtml, msgTimeHtml } from './chat-view.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, p), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('msgRowClass: side, run position, tail, reactions, photo', () => {
  assert.equal(msgRowClass({ mine: true }), 'msg athlete last');
  assert.equal(msgRowClass({ mine: false, role: 'ai', firstOfRun: false, lastOfRun: false }), 'msg ai cont');
  assert.equal(msgRowClass({ mine: false, role: 'coach', firstOfRun: true, lastOfRun: false }), 'msg coach');
  assert.equal(msgRowClass({ mine: false, role: 'coach', firstOfRun: false, lastOfRun: true, hasRx: true }), 'msg coach cont last has-rx');
  assert.equal(msgRowClass({ mine: true, photoOnly: true }), 'msg athlete last photo');
});

test('the separator sets the day in the heavier weight and the clock in the lighter', () => {
  assert.equal(timeSepHtml({ day: 'Today', time: '9:07 AM' }, esc), '<div class="tsep"><b>Today</b> 9:07 AM</div>');
  assert.equal(timeSepHtml({ day: '', time: '9:07 AM' }, esc), '<div class="tsep">9:07 AM</div>');
  // An older shape (label only) still prints.
  assert.equal(timeSepHtml({ label: '9:07 AM' }, esc), '<div class="tsep">9:07 AM</div>');
  assert.match(timeSepHtml({ day: '<b>', time: '' }, esc), /&lt;b&gt;/);
});

test('layoutThread names the day on the first separator and on a day change, never in between', () => {
  const msgs = [
    { author_id: 'a', role: 'athlete', text: '1', created_at: '2026-07-27T13:00:00Z' },
    { author_id: 'b', role: 'coach', text: '2', created_at: '2026-07-27T14:00:00Z' },
    { author_id: 'a', role: 'athlete', text: '3', created_at: '2026-07-28T09:00:00Z' },
  ];
  const fmtTime = (iso) => new Date(iso).toISOString().slice(11, 16);
  const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const out = layoutThread(msgs, { fmtTime, fmtDay, fmtDayLabel: (ms) => 'Day ' + fmtDay(ms).slice(8) });
  const seps = out.filter((x) => x.type === 'time');
  assert.equal(seps.length, 3);
  assert.equal(seps[0].day, 'Day 27');       // first separator: the day is said
  assert.equal(seps[0].time, '13:00');
  assert.equal(seps[0].label, '13:00');      // the old label shape is untouched
  assert.equal(seps[1].day, '');             // same day, an hour later: clock only
  assert.equal(seps[2].day, 'Day 28');       // day changed
  assert.equal(seps[2].label, 'Day 28 · 09:00');
});

test('Delivered is stated under the newest message only when it is the reader\'s own', () => {
  assert.equal(deliveredHtml({ mine: true, isLast: true }), '<div class="dlv">Delivered</div>');
  assert.equal(deliveredHtml({ mine: true, isLast: false }), '');
  assert.equal(deliveredHtml({ mine: false, isLast: true }), '');
  // Never "Read": nothing in the app knows that.
  assert.doesNotMatch(deliveredHtml({ mine: true, isLast: true }), /Read/);
});

test('the per-message clock is present, hidden from assistive tech, and escaped', () => {
  const html = msgTimeHtml({ created_at: 'x' }, () => '9:07 <PM>', esc);
  assert.equal(html, '<span class="mt" aria-hidden="true">9:07 &lt;PM&gt;</span>');
  assert.equal(msgTimeHtml({ created_at: 'x' }, () => '', esc), '');
  assert.equal(msgTimeHtml(null, () => '1', esc), '');
});

/* ---- all four renderers, structurally ---- */
const RENDERERS = ['screens/nutrition-chat.js', 'screens/meal.js', 'screens/coach.js', 'screens/trust.js'];

test('every thread renderer builds its rows from the shared helpers', () => {
  for (const f of RENDERERS) {
    const s = src(f);
    assert.match(s, /msgRowClass\(\{/, `${f}: rows come from msgRowClass`);
    assert.match(s, /timeSepHtml\(item, esc\)/, `${f}: separators come from timeSepHtml`);
    assert.match(s, /deliveredHtml\(\{ mine, isLast:/, `${f}: the receipt comes from deliveredHtml`);
    assert.match(s, /msgTimeHtml\(c, \w+, esc\)/, `${f}: the per-message clock is rendered`);
    // The face rides the LAST bubble of a run (the phone's layout), never the first.
    assert.match(s, /!mine && item\.lastOfRun \? `<div class="av"/, `${f}: avatar on the last bubble of the run`);
    assert.doesNotMatch(s, /!mine && item\.firstOfRun \? `<div class="av"/, `${f}: no avatar on the first bubble`);
  }
});

test('the athlete surfaces animate the just-sent row and wire the time-reveal drag', () => {
  for (const f of ['screens/nutrition-chat.js', 'screens/meal.js']) {
    const s = src(f);
    assert.match(s, /JUST_SENT && c\.id === JUST_SENT \? ' in' : ''/, `${f}: the sent row rises`);
    assert.match(s, /wireChatTimes\(\{ root, scope: '#[\w-]+' \}\)/, `${f}: drag-to-reveal is wired with a unique scope`);
  }
});

test('the stylesheet carries the Messages system: flat fills, a tail on .last, no borders', () => {
  const css = src('../css/screens.css');
  assert.match(css, /\.msg\.last \.bubble::before \{/, 'the tail is a ::before on the last bubble (focus.css owns ::after)');
  assert.match(css, /\.msg\.coach \.bubble, \.msg\.ai \.bubble \{ background: var\(--surface-3\); border: none;/, 'one gray for everyone who is not you');
  assert.match(css, /\.msg\.athlete \.bubble \{ background: var\(--blue-deep\); color: var\(--text-on-accent\); \}/, 'a flat blue the tail can inherit');
  assert.match(css, /\.msg\.photo \.bubble::before, \.msg\.typing \.bubble::before \{ display: none; \}/, 'photos and the typing bubble are tail-less');
  assert.match(css, /\.msg\.typing \.who \{ position: absolute; width: 1px;/, 'no visible "is typing" label');
  assert.match(css, /\.chat-dock \{\s*position: sticky;/, 'the composer is docked');
  assert.match(css, /\.tb-veil\{position:fixed;inset:0/, 'the tapback lifts over a veil');
});

test('the tapback lifts the bubble over a veil and offers Copy', () => {
  const s = src('tapback.js');
  assert.match(s, /className = 'tb-veil'/);
  assert.match(s, /function liftBubble\(bubble\)/);
  assert.match(s, /copyText\(words\)/);
  assert.match(s, /extras: \[veil, lift, menu\]\.filter\(Boolean\)/, 'the veil, lift and menu are torn down with the pill');
});

test('the meal page Team discussion is one conversation header, a scoped dock, and a door aimed at the plate', () => {
  const meal = src('screens/meal.js');
  assert.match(meal, /<section class="disc disc-raised" id="meal-disc"/, 'the discussion is its own section (the sticky dock is scoped to it)');
  assert.match(meal, /class="facepile disc-fp" id="meal-members"/, 'the faces are the members button');
  assert.match(meal, /class="disc-open" id="open-full-chat"/, 'Open is a real button');
  assert.match(meal, /<div class="chat-dock disc-dock">/, 'the composer is docked');
  assert.match(meal, /`nutrition-chat\/\$\{M\.mealId\}`/, 'the door carries the meal id');
  assert.doesNotMatch(meal, /id="open-full-chat" role="button"/, 'the old inline text link is gone');
  const nc = src('screens/nutrition-chat.js');
  assert.match(nc, /async mount\(root, \{ sub \} = \{\}\)/, 'the full chat reads the sub-route');
  assert.match(nc, /JUMP_TO = null;\s*jump\.scrollIntoView/, 'and lands on that plate once');
  const css = src('../css/screens.css');
  assert.match(css, /\.disc \{ position: relative;/, 'the section is the containing block of the dock');
});
