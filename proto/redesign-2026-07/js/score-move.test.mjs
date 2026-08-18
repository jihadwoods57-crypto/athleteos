/* The score move's guard, and the two honesty rules it carries.
 *
 * What matters here is not that an arc draws — it is the bookkeeping around the draw, because that
 * is what the two hand-rolled count-ups this module replaced got wrong. The meal thread repaints
 * about a second into a logged meal, mid-sweep, and the old code responded to that by deleting the
 * line it was animating. So these assert the three states a key can be in (unseen / in flight /
 * spent) from every direction, plus: the ladder drawn on the dial is the ladder score-band.js
 * actually uses, and exactly one haptic fires per move, at the crossing when there is one.
 *
 * score-band.js is loaded FOR REAL (it is dependency-free by design), so a threshold moved there
 * moves these assertions with it. components.js and motion.js are stubbed — they are DOM- and
 * app-heavy, and neither one is the subject.
 *
 * Run: node --test proto/redesign-2026-07/js/score-move.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const LOADER = `
const STUBS = {
  './components.js': 'export const DIAL_A0 = 120;\\nexport const DIAL_SWEEP = 300;\\nexport function dialPoint(cx, cy, rad, deg){ return \\'0 0\\'; }\\nexport function dialPath(){ return \\'M 0 0\\'; }',
  './motion.js': 'export function buzz(kind){ (globalThis.__buzzes ||= []).push(kind); return true; }',
};
export function resolve(spec, ctx, next) {
  if (STUBS[spec]) return { url: 'stub:' + spec, shortCircuit: true };
  return next(spec, ctx);
}
export function load(url, ctx, next) {
  const key = url.startsWith('stub:') ? url.slice(5) : null;
  if (key) return { format: 'module', source: STUBS[key], shortCircuit: true };
  return next(url, ctx);
}
`;
register(`data:text/javascript,${encodeURIComponent(LOADER)}`, import.meta.url);

const {
  scoreMoveDial, scoreMoveBar, playScoreMove,
  resetScoreMoves, scoreMovePlayed, scoreMoveInFlight, TICKS, MOVE_DUR,
} = await import(new URL('./score-move.js', import.meta.url).href);
const { TIERS, tierFor } = await import(new URL('./score-band.js', import.meta.url).href);

/* ---------------------------------------------------------------- harness */

let NOW = 0;
let QUEUE = [];
function installClock({ reduced = false } = {}) {
  NOW = 1000; QUEUE = [];
  globalThis.__buzzes = [];
  globalThis.performance = { now: () => NOW };
  globalThis.requestAnimationFrame = (fn) => { QUEUE.push(fn); return QUEUE.length; };
  globalThis.matchMedia = () => ({ matches: reduced });
}
/** Advance the clock and run whatever was waiting on a frame. */
function tick(ms) {
  NOW += ms;
  const q = QUEUE; QUEUE = [];
  q.forEach((fn) => fn(NOW));
}

function fakeClassList() {
  const s = new Set();
  return { _s: s, add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) };
}
function el(attrs = {}) {
  const style = { _props: {}, setProperty(k, v) { this._props[k] = v; } };
  return {
    style, classList: fakeClassList(), textContent: '', className: '',
    getAttribute: (k) => (k in attrs ? String(attrs[k]) : null),
    setAttribute: (k, v) => { attrs[k] = v; },
  };
}

/* The smallest thing playScoreMove needs. Selectors are answered from a table rather than parsed,
   because the module only ever asks for these six. */
function fakeMove({ from, to, connected = true, tierPrefix = '' } = {}) {
  const span = Math.max(0, to - from);
  const arc = el({ 'data-sm-len': span.toFixed(2) });
  const num = el({ 'data-sm-count': to });
  const chip = el({ 'data-sm-tier': tierPrefix, 'data-sm-base': 'tier-chip' });
  const glow = el();
  const ticks = TICKS.map((v) => el({ 'data-sm-tick': v }));
  const table = {
    '[data-sm-arc]': span > 0 ? [arc] : [],
    '[data-sm-count]': [num],
    '[data-sm-tier]': [chip],
    '[data-sm-tick]': ticks,
    '.sm-glow-to': [glow],
  };
  const node = {
    isConnected: connected,
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; } },
    matches: (sel) => sel === '[data-sm]',
    querySelector: (sel) => (table[sel] || [])[0] || null,
    querySelectorAll: (sel) => table[sel] || [],
    _arc: arc, _num: num, _chip: chip, _glow: glow, _ticks: ticks,
  };
  return node;
}

/* ---------------------------------------------------------------- markup */

test('the ticks on the dial ARE the tier ladder, not a second copy of it', () => {
  const fromLadder = TIERS.map((t) => t.min).filter((m) => m > 0).sort((a, b) => a - b);
  assert.deepEqual(TICKS, fromLadder, 'a threshold that exists only here would be the dial lying');
  assert.ok(TICKS.length >= 2, 'the ladder should still have thresholds worth drawing');
});

test('the dial marks the delta as its own run, seated where the old score ended', () => {
  const html = scoreMoveDial({ from: 74, to: 84, uid: 'x' });
  assert.match(html, /data-sm-from="74"/);
  assert.match(html, /data-sm-to="84"/);
  /* 10 points of delta, resting at its full length (an un-animated paint has to be honest) with the
     offset fixed at 0 — the rotation is what carries the run to 74. The driver grows the dash from
     0 to data-sm-len; nothing ever slides the offset, because that wraps. The gap is the whole
     path, so the pattern cannot begin a second period on the path's last point and leave a bead
     there under the round cap. */
  assert.match(html, /stroke-dasharray="10\.00 100"/);
  assert.match(html, /data-sm-len="10\.00"/);
  assert.match(html, /stroke-dashoffset="0\.00"/);
  // Crossing 80 means the chip has to start life reading the tier it LANDS in; the driver walks it
  // back and flips it live.
  assert.match(html, new RegExp(tierFor(84).name));
});

test('a tick the athlete had already passed renders lit; one they have not does not', () => {
  const html = scoreMoveDial({ from: 62, to: 66 });
  assert.match(html, /class="sm-tick lit" data-sm-tick="60"/, '60 was already behind them');
  assert.match(html, /class="sm-tick" data-sm-tick="80"/, '80 is still ahead');
});

test('a move of zero points draws no delta run at all', () => {
  const html = scoreMoveDial({ from: 88, to: 88 });
  assert.ok(!html.includes('data-sm-arc'), 'nothing moved, so nothing sweeps');
});

test('the bar carries the caller\'s own head under the same root as the hooks', () => {
  const html = scoreMoveBar({ from: 70, to: 82, head: '<span class="k">Daily Score</span>' });
  assert.match(html, /data-sm\b/);
  assert.match(html, /sm-head/);
  assert.match(html, /Daily Score/);
  // The strip has no rotation to reach `from` with, so it shifts its dash pattern instead: the run
  // is seated at -from and grows to its own length from there. Same two numbers the dial ends up
  // with, a different geometry getting to them — which is the whole reason span() computes both.
  assert.match(html, /stroke-dashoffset="-70\.00"/);
  assert.match(html, /data-sm-len="12\.00"/);
});

/* ---------------------------------------------------------------- guard */

test('a move plays once per key, however many times mount() runs', () => {
  installClock(); resetScoreMoves();
  const key = 'move:lunch:2026-08-17:82-88';
  assert.equal(playScoreMove(fakeMove({ from: 82, to: 88 }), { key, from: 82, to: 88 }), true, 'first mount owns it');
  tick(MOVE_DUR + 50);
  assert.equal(scoreMovePlayed(key), true);
  assert.equal(playScoreMove(fakeMove({ from: 82, to: 88 }), { key, from: 82, to: 88 }), false, 'a later repaint does not replay');
});

test('a repaint mid-sweep ADOPTS the move instead of restarting it', () => {
  installClock(); resetScoreMoves();
  const key = 'move:dinner:2026-08-17:60-90';
  playScoreMove(fakeMove({ from: 60, to: 90 }), { key, from: 60, to: 90 });
  tick(MOVE_DUR * 0.4);
  assert.equal(scoreMoveInFlight(key), true, 'still travelling');

  // The repaint: a brand new node, the old one detached.
  const fresh = fakeMove({ from: 60, to: 90 });
  playScoreMove(fresh, { key, from: 60, to: 90 });
  // Elapsed time is carried over, so the number must already be past the start rather than back at
  // it. (Rewinding here is what would replay the ceremony.)
  const mid = +fresh._num.textContent;
  assert.ok(mid > 60 && mid < 90, `resumed part-way, not rewound (saw ${mid})`);

  tick(MOVE_DUR);
  assert.equal(scoreMovePlayed(key), true);
  assert.equal(+fresh._num.textContent, 90, 'and it still lands on the real number');
});

test('a repaint after the move is spent paints the outcome, with no motion and no second buzz', () => {
  installClock(); resetScoreMoves();
  const key = 'move:checkin:2026-08-17:70-86';
  playScoreMove(fakeMove({ from: 70, to: 86 }), { key, from: 70, to: 86 });
  tick(MOVE_DUR + 50);
  const buzzesAfterFirst = globalThis.__buzzes.length;

  const fresh = fakeMove({ from: 70, to: 86 });
  assert.equal(playScoreMove(fresh, { key, from: 70, to: 86 }), false);
  assert.equal(+fresh._num.textContent, 86, 'the number is simply correct');
  assert.equal(fresh._arc.style.transition, 'none', 'and it got there without animating');
  assert.equal(fresh._arc.style.strokeDasharray, '16.00 100', 'the whole run is seated');
  assert.equal(globalThis.__buzzes.length, buzzesAfterFirst, 'the buzz belongs to the event, not to the paint');
});

test('onDone retires the caller\'s gate only when the sweep has actually finished', () => {
  installClock(); resetScoreMoves();
  let done = false;
  playScoreMove(fakeMove({ from: 80, to: 92 }), {
    key: 'move:snack:2026-08-17:80-92', from: 80, to: 92, onDone: () => { done = true; },
  });
  tick(MOVE_DUR * 0.5);
  assert.equal(done, false, 'a line deleted here is the bug this replaced');
  tick(MOVE_DUR);
  assert.equal(done, true);
});

test('a node that went with a repaint stops its own loop rather than writing to a corpse', () => {
  installClock(); resetScoreMoves();
  const node = fakeMove({ from: 50, to: 70 });
  playScoreMove(node, { key: 'move:gone', from: 50, to: 70 });
  tick(MOVE_DUR * 0.2);
  const parked = node._num.textContent;
  node.isConnected = false;
  tick(MOVE_DUR);
  assert.equal(node._num.textContent, parked, 'the detached node is left exactly where it was');
  assert.equal(scoreMovePlayed('move:gone'), false, 'and the move is still owed to whoever repaints next');
});

/* ---------------------------------------------------------------- the moment */

test('exactly one haptic per move, and it lands ON the tier crossing', () => {
  installClock(); resetScoreMoves();
  // 78 -> 84 crosses ON_STANDARD, so the buzz must arrive before the number does.
  playScoreMove(fakeMove({ from: 78, to: 84 }), { key: 'move:cross', from: 78, to: 84 });
  tick(MOVE_DUR * 0.25);
  assert.equal(globalThis.__buzzes.length, 1, 'fired at the crossing, not at the end');
  tick(MOVE_DUR);
  assert.equal(globalThis.__buzzes.length, 1, 'and never a second time');
});

test('a move that crosses nothing still buzzes, once, as the number lands', () => {
  installClock(); resetScoreMoves();
  playScoreMove(fakeMove({ from: 82, to: 86 }), { key: 'move:flat', from: 82, to: 86 });
  tick(MOVE_DUR * 0.5);
  assert.equal(globalThis.__buzzes.length, 0, 'nothing to mark yet');
  tick(MOVE_DUR);
  assert.equal(globalThis.__buzzes.length, 1);
});

test('the tier chip flips mid-sweep and keeps the caller\'s prefix and classes', () => {
  installClock(); resetScoreMoves();
  const node = fakeMove({ from: 74, to: 84, tierPrefix: '▲ ' });
  playScoreMove(node, { key: 'move:chip', from: 74, to: 84 });
  assert.equal(node._chip.textContent, `▲ ${tierFor(74).name}`, 'starts at the tier they were in');
  tick(MOVE_DUR + 50);
  assert.equal(node._chip.textContent, `▲ ${tierFor(84).name}`);
  assert.equal(node._chip.className, `tier-chip ${tierFor(84).cls}`, 'the base classes survive the flip');
});

test('every tick the score passed ends up lit, and none of the ones it did not', () => {
  installClock(); resetScoreMoves();
  const node = fakeMove({ from: 55, to: 84 });
  playScoreMove(node, { key: 'move:ticks', from: 55, to: 84 });
  tick(MOVE_DUR + 50);
  const lit = node._ticks.filter((t) => t.classList.contains('lit')).map((t) => +t.getAttribute('data-sm-tick'));
  assert.deepEqual(lit, TICKS.filter((v) => v <= 84), 'the dial shows which lines were crossed, and only those');
});

test('reduced motion snaps to the truth but still reports the event', () => {
  installClock({ reduced: true }); resetScoreMoves();
  const node = fakeMove({ from: 70, to: 90 });
  assert.equal(playScoreMove(node, { key: 'move:reduced', from: 70, to: 90 }), false, 'no motion was played');
  assert.equal(+node._num.textContent, 90);
  // Progress on the container, not an opacity on a layer: the stylesheet owns how bright that is,
  // per theme, and which of the two layers is carrying it.
  assert.equal(node.style._props['--sm-p'], '1', 'the tier light is simply already correct');
  assert.equal(globalThis.__buzzes.length, 1, 'the haptic is feedback about a real event, not decoration');
});

test('a score that did not rise is settled, never swept', () => {
  installClock(); resetScoreMoves();
  const node = fakeMove({ from: 88, to: 88 });
  assert.equal(playScoreMove(node, { key: 'move:none', from: 88, to: 88 }), false);
  assert.equal(+node._num.textContent, 88);
  assert.equal(globalThis.__buzzes.length, 0, 'nothing happened, so nothing is announced');
});

test('a null root is a no-op, not a throw', () => {
  installClock(); resetScoreMoves();
  assert.equal(playScoreMove(null, { key: 'move:nil', from: 1, to: 2 }), false);
});
