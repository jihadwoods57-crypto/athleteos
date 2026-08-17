/* The navigation transition's contract.
 *
 * One invariant matters more than every visual question this module raises, and it is the reason
 * this suite exists: `commit` runs exactly once, on every path. A view transition is decoration.
 * The DOM update it wraps is the athlete's tap. Any refactor that makes a browser quirk, an
 * unsupported API, a reduced-motion preference or a thrown startViewTransition swallow the update
 * turns a navigation into a dead control, and it does it silently — the hash changes, the screen
 * does not, and there is nothing in the console.
 *
 * The rest lock the decisions that are easy to undo by accident:
 *   - which directions get a whole-sheet transition (a strip move has a better animation already)
 *   - a duplicate `data-vt` must not be stamped, because two elements sharing a
 *     view-transition-name aborts the ENTIRE transition, which is a much worse failure than
 *     simply not morphing
 *   - reveals are dropped only when a morph actually paired on BOTH sides
 *   - canTransition and withTransition never disagree, or the router builds markup for the wrong
 *     entrance
 *
 * Like motion.test.mjs, this stubs the module graph rather than booting the app, and fakes the
 * handful of document APIs the module touches.
 * Run: node --test proto/redesign-2026-07/js/view-transition.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const LOADER = `
const STUBS = {
  './motion.js': 'export function pauseReveals(){ (globalThis.__mo ||= []).push("pause"); }\\nexport function resumeReveals(o){ (globalThis.__mo ||= []).push("resume:" + !!(o && o.drop)); }',
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

const { withTransition, canTransition, afterTransition, transitioning } = await import(
  new URL('./view-transition.js', import.meta.url).href
);

/* ---- the smallest document this module can run against ---------------------------------- */

function el(extra = {}) {
  return {
    style: {}, isConnected: true,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 402, bottom: 872, width: 402, height: 872 }),
    ...extra,
  };
}

/** Build a fake document. `marks` is how many `[data-vt="<key>"]` elements each side has. */
function fakeDoc({ supports = true, reduce = false, marks = [1, 1], throws = false } = {}) {
  const made = { screen: el(), status: el(), tabs: el(), shared: [] };
  let side = 0;
  const scope = {
    querySelector(sel) {
      if (sel === '.screen') return made.screen;
      if (sel === '.statusbar') return made.status;
      if (sel === '.tabbar') return made.tabs;
      return null;
    },
    querySelectorAll(sel) {
      if (!sel.startsWith('[data-vt=')) return [];
      const n = marks[Math.min(side, marks.length - 1)] || 0;
      const hits = Array.from({ length: n }, () => el());
      made.shared.push(...hits);
      return hits;
    },
  };
  const root = {
    style: { setProperty() {}, removeProperty() {} },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
  };
  let settle;
  const doc = {
    documentElement: root,
    querySelector: (s) => scope.querySelector(s),
    getElementById: (id) => (id === 'device' ? scope : null),
    startViewTransition: supports ? (cb) => {
      if (throws) throw new Error('nested');
      side = 1;                       // the second stamp() call is the incoming DOM
      cb();
      return { finished: new Promise((res) => { settle = res; }) };
    } : undefined,
  };
  if (!supports) delete doc.startViewTransition;
  return { doc, root, made, settle: () => settle && settle(), nextSide: () => { side = 1; } };
}

function install({ reduce = false, ...opts } = {}) {
  const f = fakeDoc(opts);
  globalThis.document = f.doc;
  globalThis.matchMedia = () => ({ matches: reduce });
  globalThis.getComputedStyle = () => ({ borderTopLeftRadius: '0px' });
  globalThis.innerWidth = 402;
  globalThis.innerHeight = 872;
  globalThis.__mo = [];
  return f;
}

/* ---- commit runs exactly once, always -------------------------------------------------- */

const NEVER_TRANSITIONS = [
  ['no direction (a same-route repaint)', { dir: null }, {}],
  ['a strip move forward', { dir: 'lat-next' }, {}],
  ['a strip move back', { dir: 'lat-prev' }, {}],
  ['an unknown direction', { dir: 'sideways' }, {}],
  ['reduced motion', { dir: 'push' }, { reduce: true }],
  ['no API', { dir: 'push' }, { supports: false }],
];

for (const [label, args, env] of NEVER_TRANSITIONS) {
  test(`commit runs once and synchronously, and no transition starts: ${label}`, () => {
    install(env);
    let n = 0;
    const ran = withTransition(args, () => { n++; });
    assert.equal(n, 1, 'the DOM update is the navigation; it may never be skipped or deferred');
    assert.equal(ran, false);
    assert.equal(canTransition(args.dir), false, 'canTransition must agree, or the router picks the wrong entrance');
  });
}

test('commit runs exactly once when startViewTransition itself throws', () => {
  install({ throws: true });
  let n = 0;
  const ran = withTransition({ dir: 'push' }, () => { n++; });
  assert.equal(n, 1);
  assert.equal(ran, false);
});

test('commit runs exactly once on the happy path, and reveals are paused across it', async () => {
  const f = install();
  let n = 0;
  const ran = withTransition({ dir: 'push', key: 'score' }, () => { n++; });
  assert.equal(n, 1);
  assert.equal(ran, true);
  assert.equal(globalThis.__mo[0], 'pause');
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(f.root.attrs['data-vt-dir'], undefined, 'the direction attribute must not outlive the transition');
});

/* ---- which directions travel ------------------------------------------------------------ */

test('push, pop and tab transition; the two strip moves deliberately do not', () => {
  install();
  for (const d of ['push', 'pop', 'tab']) assert.equal(canTransition(d), true, d);
  for (const d of ['lat-next', 'lat-prev']) assert.equal(canTransition(d), false, d);
});

/* ---- the shared element ----------------------------------------------------------------- */

test('a key matching exactly one element on each side pairs, and the reveal is dropped', async () => {
  const f = install({ marks: [1, 1] });
  withTransition({ dir: 'push', key: 'score' }, () => {});
  assert.ok(f.made.shared.every((e) => e.style.viewTransitionName === 'vt-shared'));
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(globalThis.__mo.at(-1), 'resume:true', 'a ring that morphed has already had its moment');
});

test('two elements sharing a key are NOT stamped, on either side, and the reveal is kept', async () => {
  const f = install({ marks: [2, 1] });
  withTransition({ dir: 'push', key: 'score' }, () => {});
  assert.ok(f.made.shared.every((e) => e.style.viewTransitionName === undefined),
    'a duplicate view-transition-name aborts the whole transition; refusing to pair is the cheap failure');
  assert.equal(f.made.shared.length, 2,
    'the incoming side is not even looked at once the outgoing side failed, so a lone name never animates by itself');
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(globalThis.__mo.at(-1), 'resume:false');
});

/* ---- the tapped node beats the key search on the outgoing side ---------------------------- */

test('the TAPPED node is named even when its key matches several on the same screen', async () => {
  /* This is the case the whole asymmetry exists for. Home shows today's lunch beside yesterday's
     lunch and the day before's dinner: three meal photographs, all wanting `plate` on the far side.
     Searching by key here finds three and refuses (correctly — it cannot know which), which drops
     the morph on the most obvious surface in the app. The tap already resolved the ambiguity. */
  const f = install({ marks: [3, 1] });
  const tapped = el();
  withTransition({ dir: 'push', key: 'plate', node: tapped }, () => {});
  assert.equal(tapped.style.viewTransitionName, 'vt-shared', 'the tapped element is the one that travels');
  /* Only the INCOMING side searched: it found its 1. Had the outgoing side searched too it would
     have produced 3 more, so 1 is the proof that being handed a node skips the search entirely. */
  assert.equal(f.made.shared.length, 1, 'the outgoing side must not search when it was handed a node');
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(globalThis.__mo.at(-1), 'resume:true');
});

test('the incoming side still refuses duplicates, node or not', async () => {
  const f = install({ marks: [1, 2] });
  const tapped = el();
  withTransition({ dir: 'push', key: 'plate', node: tapped }, () => {});
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
  // Two on the ARRIVING screen would abort the whole transition, and there is no tap to disambiguate.
  assert.equal(globalThis.__mo.at(-1), 'resume:false', 'no morph happened, so the reveal is still owed');
});

test('a node that is no longer in the document falls back to the key search', async () => {
  const f = install({ marks: [1, 1] });
  const stale = el({ isConnected: false });
  withTransition({ dir: 'push', key: 'score', node: stale }, () => {});
  assert.equal(stale.style.viewTransitionName, undefined, 'a detached node cannot be captured');
  assert.ok(f.made.shared.length > 0 && f.made.shared[0].style.viewTransitionName === 'vt-shared',
    'the key search should have taken over');
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
});

test('a key with no counterpart on the incoming screen still transitions, without a morph', async () => {
  const f = install({ marks: [1, 0] });
  let n = 0;
  const ran = withTransition({ dir: 'push', key: 'score' }, () => { n++; });
  assert.equal(ran, true);
  assert.equal(n, 1);
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(globalThis.__mo.at(-1), 'resume:false', 'nothing morphed, so the number still owes its reveal');
});

test('a key that could break out of the attribute selector is refused, not escaped', async () => {
  const f = install({ marks: [1, 1] });
  withTransition({ dir: 'push', key: 'sco"re] , *' }, () => {});
  assert.equal(f.made.shared.length, 0, 'the selector is never built from an unsafe key');
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
});

/* ---- the sheet and the chrome ------------------------------------------------------------ */

test('the sheet is .screen, with the status bar and tab bar promoted out of it', async () => {
  const f = install();
  withTransition({ dir: 'push' }, () => {});
  assert.equal(f.made.screen.style.viewTransitionName, 'vt-view',
    'naming the transparent viewport instead is what made two screens double-expose');
  assert.equal(f.made.status.style.viewTransitionName, 'vt-status');
  assert.equal(f.made.tabs.style.viewTransitionName, 'vt-tabs');
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(f.made.screen.style.viewTransitionName, '', 'names come off, or they cost every later frame');
  assert.equal(f.made.status.style.viewTransitionName, '');
  assert.equal(f.made.tabs.style.viewTransitionName, '');
});

/* ---- deferred work ----------------------------------------------------------------------- */

test('afterTransition runs immediately when nothing is in flight', () => {
  install();
  let ran = false;
  afterTransition(() => { ran = true; });
  assert.equal(ran, true);
});

test('afterTransition holds a repaint until the screen has stopped moving', async () => {
  const f = install();
  withTransition({ dir: 'push' }, () => {});
  assert.equal(transitioning(), true);
  let ran = false;
  afterTransition(() => { ran = true; });
  assert.equal(ran, false, 'a repaint mid-flight replaces the element being animated and cuts the transition');
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ran, true);
  assert.equal(transitioning(), false);
});

test('a deferred callback that throws does not strand the transition state', async () => {
  const f = install();
  withTransition({ dir: 'push' }, () => {});
  afterTransition(() => { throw new Error('a screen blew up while repainting'); });
  f.settle();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(transitioning(), false);
  assert.equal(f.root.attrs['data-vt-dir'], undefined);
});
