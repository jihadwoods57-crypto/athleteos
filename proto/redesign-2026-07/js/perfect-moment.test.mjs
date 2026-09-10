/* The full-screen perfect-plate moment.
 *
 * What matters here is not the choreography (CSS owns that) but the things that would hurt a real
 * athlete: a moment that stacks on another overlay, one that never leaves the screen, one that
 * steals a number's own draw, and a dish name from a photo read landing in innerHTML unescaped.
 *
 * perfect-moment.js imports motion.js and components.js, both DOM- and app-heavy, so this stubs
 * the module graph the way motion.test.mjs does rather than booting the app.
 * Run: node --test proto/redesign-2026-07/js/perfect-moment.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const LOADER = `
const STUBS = {
  './motion.js': 'export function buzz(kind){ (globalThis.__buzzed ||= []).push(kind); return true; }',
  './components.js': 'export function animateRing(root){ (globalThis.__drawn ||= []).push(root); }\\nexport function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }',
  './overlay-guard.js': 'export function overlayOpen(except){ (globalThis.__guardAsked ||= []).push(except); return !!globalThis.__overlayUp; }',
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

const { playPerfectMoment, _resetPerfectMoment, PM_PARTICLES, PM_LIFE_MS, PM_RETRY_MS } = await import(
  new URL('./perfect-moment.js', import.meta.url).href
);

/* The smallest document the module actually touches: createElement, body.appendChild, and
   document-level key listeners. innerHTML stays a plain string so assertions can read the markup
   the module wrote. */
function fakeNode(tag) {
  return {
    tag, kids: [], className: '', innerHTML: '', attrs: {}, classes: new Set(), removed: false,
    listeners: {},
    style: { vars: {}, setProperty(k, v) { this.vars[k] = v; } },
    classList: {
      add(...c) { c.forEach((x) => this._o.classes.add(x)); },
      remove(...c) { c.forEach((x) => this._o.classes.delete(x)); },
      contains(c) { return this._o.classes.has(c); },
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(n) { this.kids.push(n); return n; },
    addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); },
    remove() { this.removed = true; },
  };
}
function makeEl(tag) { const n = fakeNode(tag); n.classList._o = n; return n; }

function installDom({ reduce = false } = {}) {
  const timers = [];
  const prev = {
    document: globalThis.document, matchMedia: globalThis.matchMedia,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
  };
  const body = makeEl('body');
  globalThis.document = {
    body,
    created: [],
    docListeners: {},
    createElement(tag) { const n = makeEl(tag); this.created.push(n); return n; },
    addEventListener(k, fn) { (this.docListeners[k] ||= []).push(fn); },
    removeEventListener(k, fn) {
      const l = this.docListeners[k] || [];
      const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
    },
  };
  globalThis.matchMedia = () => ({ matches: reduce });
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; };
  globalThis.__buzzed = []; globalThis.__drawn = []; globalThis.__guardAsked = [];
  globalThis.__overlayUp = false;
  _resetPerfectMoment();
  return {
    body, timers,
    /** Fire every pending timer scheduled at exactly `ms`, in order. */
    fireAt(ms) { timers.filter((t) => t.ms === ms && !t.cancelled && !t.done).forEach((t) => { t.done = true; t.fn(); }); },
    restore() { Object.assign(globalThis, prev); _resetPerfectMoment(); },
  };
}

test('it mounts one full-screen overlay that draws the number the house way', () => {
  const dom = installDom();
  try {
    assert.equal(playPerfectMoment({ slotLabel: 'Lunch', dish: 'Chicken bowl', score: 100 }), true);
    const el = dom.body.kids[0];
    assert.ok(el, 'the overlay is on the body, not inside a screen');
    assert.equal(el.className, 'pmoment');
    // A self-dismissing announcement, not a dialog waiting for an answer.
    assert.equal(el.attrs.role, 'status');
    assert.equal(el.attrs['aria-live'], 'polite');
    // The arc rests wound back and carries its own target, so animateRing can transition it.
    assert.match(el.innerHTML, /class="ring-arc pm-arc"/);
    assert.match(el.innerHTML, /stroke-dashoffset="100"/);
    assert.match(el.innerHTML, /data-off="0\.0"/);
    assert.match(el.innerHTML, /data-count="100"/);
    assert.ok(!el.innerHTML.includes('/100'), 'the denominator was cut: the dial is visibly full');
    assert.match(el.innerHTML, /Lunch · every point on the plate/, 'the slot names the meal');
    // The sweep, never green: the arc wears the three ring stops.
    assert.match(el.innerHTML, /var\(--ring-a\)[\s\S]*var\(--ring-b\)[\s\S]*var\(--ring-c\)/);
    assert.deepEqual(globalThis.__drawn, [el], 'animateRing drew this overlay');
    assert.deepEqual(globalThis.__buzzed, ['celebrate']);
    assert.deepEqual(globalThis.__guardAsked, ['.pmoment'], 'it excludes its own marker from the guard');
  } finally { dom.restore(); }
});

test('the burst is PM_PARTICLES particles in the sweep colours, thrown at real angles', () => {
  const dom = installDom();
  try {
    playPerfectMoment({ slotLabel: 'Dinner' });
    const el = dom.body.kids[0];
    const burst = el.kids.find((k) => k.className === 'pm-burst');
    assert.ok(burst, 'the burst is appended as a node, never as an inline-styled string');
    assert.equal(burst.kids.length, PM_PARTICLES);
    assert.ok(burst.kids.every((p) => /^var\(--ring-[abc]\)$/.test(p.style.vars['--c'])), 'sweep colours only');
    assert.ok(burst.kids.every((p) => /deg$/.test(p.style.vars['--a']) && /px$/.test(p.style.vars['--d'])), 'angle and distance set');
    assert.ok(burst.kids.every((p) => /ms$/.test(p.style.vars['animation-delay'])), 'staggered');
  } finally { dom.restore(); }
});

test('reduced motion keeps the moment and drops the particles', () => {
  const dom = installDom({ reduce: true });
  try {
    assert.equal(playPerfectMoment({ slotLabel: 'Lunch' }), true);
    const el = dom.body.kids[0];
    assert.equal(el.kids.find((k) => k.className === 'pm-burst'), undefined, 'nothing flies');
    assert.deepEqual(globalThis.__drawn, [el], 'the number is still drawn (animateRing snaps it)');
    assert.deepEqual(globalThis.__buzzed, ['celebrate'], 'and it is still felt');
  } finally { dom.restore(); }
});

test('it leaves the screen on its own, and only once', () => {
  const dom = installDom();
  try {
    playPerfectMoment({ slotLabel: 'Lunch' });
    const el = dom.body.kids[0];
    assert.equal(el.removed, false);
    dom.fireAt(PM_LIFE_MS);
    assert.equal(el.removed, true, 'the moment ends without anyone tapping');
    assert.equal(document.docListeners.keydown.length, 0, 'and takes its key listener with it');
    // Having ended, the next perfect plate can play.
    assert.equal(playPerfectMoment({ slotLabel: 'Dinner' }), true);
  } finally { dom.restore(); }
});

test('a tap ends it early, and a second call while it is up is refused', () => {
  const dom = installDom();
  try {
    playPerfectMoment({ slotLabel: 'Lunch' });
    const el = dom.body.kids[0];
    assert.equal(playPerfectMoment({ slotLabel: 'Lunch' }), false, 'never two at once');
    el.listeners.click[0]();
    assert.ok(el.classes.has('out') && el.classes.has('fast'), 'it fades fast rather than cutting');
    dom.fireAt(200);
    assert.equal(el.removed, true);
  } finally { dom.restore(); }
});

test('Escape ends it, because the router stands down while it is up', () => {
  const dom = installDom();
  try {
    playPerfectMoment({ slotLabel: 'Lunch' });
    const el = dom.body.kids[0];
    let prevented = false;
    document.docListeners.keydown[0]({ key: 'Escape', preventDefault: () => { prevented = true; } });
    assert.ok(prevented && el.classes.has('out'));
  } finally { dom.restore(); }
});

test('it waits once for another overlay, then lets the moment go rather than stacking', () => {
  const dom = installDom();
  try {
    globalThis.__overlayUp = true;
    assert.equal(playPerfectMoment({ slotLabel: 'Lunch' }), true, 'scheduled, not shown');
    assert.equal(dom.body.kids.length, 0, 'nothing on screen yet');
    dom.fireAt(PM_RETRY_MS);
    assert.equal(dom.body.kids.length, 0, 'still blocked, so it gives up: the chip still reads 100');
    assert.equal(globalThis.__buzzed.length, 0, 'and nothing buzzed for a moment nobody saw');
    // The retry is genuinely a retry: with the screen free, it mounts.
    globalThis.__overlayUp = false;
    _resetPerfectMoment();
    assert.equal(playPerfectMoment({ slotLabel: 'Lunch', attempt: 1 }), true);
    assert.equal(dom.body.kids.length, 1);
  } finally { dom.restore(); }
});

test('a slot label carrying markup cannot inject it', () => {
  const dom = installDom();
  try {
    playPerfectMoment({ slotLabel: '<img src=x onerror=alert(1)>' });
    const el = dom.body.kids[0];
    assert.ok(!el.innerHTML.includes('<img'), 'escaped before it reaches innerHTML');
    assert.match(el.innerHTML, /&lt;img/);
  } finally { dom.restore(); }
});

test('with no document there is no moment and no throw', () => {
  const prev = globalThis.document;
  globalThis.document = undefined;
  try {
    _resetPerfectMoment();
    assert.equal(playPerfectMoment({ slotLabel: 'Lunch' }), false);
  } finally { globalThis.document = prev; _resetPerfectMoment(); }
});
