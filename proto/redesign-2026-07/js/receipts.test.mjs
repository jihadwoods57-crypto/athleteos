/* Clearing receipts off Home.
 *
 * The rule worth protecting is the one in canClear: an athlete may tidy away proof of something
 * that WENT WELL, and may never tidy away a miss. Everything else here is about a clear staying
 * cleared without ever growing unbounded or leaking between athletes on a shared device.
 *
 * Run: node --test proto/redesign-2026-07/js/receipts.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// A minimal localStorage, because the module must work with one and survive without one.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { canClear, isCleared, clearReceipts, clearedFor, bucketOf, _resetReceipts } =
  await import('./receipts.js');

const UID = 'a-1';
const DAY = '2026-09-11';

test.beforeEach(() => { mem.clear(); _resetReceipts(); });

/* ------------------------------------------------------------------ what may be cleared */

test('a settled, positive receipt can be cleared', () => {
  assert.equal(canClear({ stage: 'seen' }), true, 'a coach opened your day');
  assert.equal(canClear({ stage: 'acknowledged', verdict: 'on_standard' }), true);
  assert.equal(canClear({ stage: 'completed' }), true);
});

test('a LATE answer is still an answer, so it clears', () => {
  // It is settled, and the verdict survives on the roll-call screen, the coach's board and the
  // score. Nothing is hidden by taking the row off Home.
  assert.equal(canClear({ stage: 'acknowledged', verdict: 'late' }), true);
});

test('a MISS can never be cleared', () => {
  // The line this module exists to draw: hiding your own miss from your own screen would quietly
  // undo the thing the product is for.
  assert.equal(canClear({ stage: 'acknowledged', verdict: 'missed' }), false);
  assert.equal(canClear({ stage: 'missed' }), false);
});

test('anything still open stays on screen', () => {
  for (const stage of ['pending', 'review', 'awaiting_arrival', 'upcoming', '']) {
    assert.equal(canClear({ stage }), false, `${stage} is not settled`);
  }
  assert.equal(canClear(null), false);
  assert.equal(canClear(undefined), false);
});

/* ------------------------------------------------------------------ clearing and remembering */

test('a cleared receipt stays cleared', () => {
  assert.equal(isCleared(UID, DAY, 'i1'), false);
  assert.equal(clearReceipts(UID, DAY, 'i1'), 1);
  assert.equal(isCleared(UID, DAY, 'i1'), true);
});

test('clearing twice is not an error and does not duplicate', () => {
  clearReceipts(UID, DAY, 'i1');
  assert.equal(clearReceipts(UID, DAY, 'i1'), 0, 'nothing newly cleared');
  assert.deepEqual(clearedFor(UID, DAY), ['i1']);
});

test('several receipts clear in one go, which is what the Clear button does', () => {
  assert.equal(clearReceipts(UID, DAY, ['seen', 'i1', 'i2']), 3);
  assert.deepEqual(clearedFor(UID, DAY).sort(), ['i1', 'i2', 'seen']);
});

test('clearing nothing is a no-op rather than a corrupt entry', () => {
  assert.equal(clearReceipts(UID, DAY, []), 0);
  assert.equal(clearReceipts(UID, DAY, ['', null, undefined]), 0);
  assert.deepEqual(clearedFor(UID, DAY), []);
});

/* ------------------------------------------------------------------ scoping */

test('tomorrow starts clean without anyone tapping anything', () => {
  clearReceipts(UID, DAY, 'i1');
  assert.equal(isCleared(UID, '2026-09-12', 'i1'), false);
});

test('one athlete cannot hide another athlete receipts on a shared device', () => {
  clearReceipts(UID, DAY, 'i1');
  assert.equal(isCleared('someone-else', DAY, 'i1'), false);
  assert.notEqual(bucketOf(UID, DAY), bucketOf('someone-else', DAY));
});

test('the store prunes itself, so it cannot grow forever', () => {
  clearReceipts(UID, '2026-09-01', 'old');
  clearReceipts(UID, '2026-09-10', 'yesterday');
  clearReceipts(UID, '2026-09-11', 'today');
  assert.equal(isCleared(UID, '2026-09-01', 'old'), false, 'a week ago is gone');
  assert.equal(isCleared(UID, '2026-09-10', 'yesterday'), true, 'yesterday survives the rollover');
  assert.equal(isCleared(UID, '2026-09-11', 'today'), true);
});

test('it survives storage it cannot read', () => {
  mem.set('onstd.receipts.v1', 'not json at all');
  _resetReceipts();
  mem.set('onstd.receipts.v1', 'not json at all');
  assert.doesNotThrow(() => isCleared(UID, DAY, 'i1'));
  assert.equal(isCleared(UID, DAY, 'i1'), false, 'unreadable storage reads as nothing cleared');
  assert.equal(clearReceipts(UID, DAY, 'i1'), 1, 'and a clear still works afterwards');
});

test('it survives having no storage at all', () => {
  const real = globalThis.localStorage;
  // eslint-disable-next-line no-undef
  delete globalThis.localStorage;
  try {
    _resetReceipts();
    assert.doesNotThrow(() => clearReceipts(UID, DAY, 'i1'));
    assert.equal(isCleared(UID, DAY, 'i1'), true, 'it still holds for this session');
  } finally {
    globalThis.localStorage = real;
  }
});
