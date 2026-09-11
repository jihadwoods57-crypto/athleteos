/* The morning receipt that lands on Home.
 *
 * The thing worth protecting: an athlete who did NOT answer must never see a receipt saying they
 * did, and a failed or foreign morning must produce an empty string rather than a throw, because
 * Home interpolates this unconditionally.
 * Run: node --test proto/redesign-2026-07/js/wakeup-handoff.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { wakeupReceipt, receiptHtml } from './wakeup-handoff.js';

const inst = (rows) => ({ type: 'morning_roll_call', rows });
const row = (id, name, verdict, at, lateMin = 0) => ({
  athlete_id: id, name, verdict, acknowledged_at: at, late_min: lateMin,
  status: verdict === 'missed' ? 'pending' : 'acknowledged',
});
const id = (x) => x;

test('it reports this athlete own answer and where they placed', () => {
  const r = wakeupReceipt(inst([
    row('a1', 'Devon', 'on_standard', '2026-09-11T09:44:00Z'),
    row('a2', 'Lewis', 'on_standard', '2026-09-11T09:46:00Z'),
  ]), 'a2');
  assert.equal(r.answered, true);
  assert.equal(r.late, false);
  assert.equal(r.placed, 2, 'second to answer');
});

test('a late answer is still an answer, but it is not placed', () => {
  const r = wakeupReceipt(inst([row('a1', 'Tyler', 'late', '2026-09-11T10:09:00Z', 24)]), 'a1');
  assert.equal(r.answered, true);
  assert.equal(r.late, true);
  assert.equal(r.placed, null, 'a late answer does not take a place on the squad list');
});

test('someone who never answered gets no receipt', () => {
  const r = wakeupReceipt(inst([row('a1', 'Marcus', 'missed', null)]), 'a1');
  assert.equal(r.answered, false);
  assert.equal(r.placed, null);
});

test('a stranger to the morning gets no receipt, and nothing throws', () => {
  const one = inst([row('a1', 'Devon', 'on_standard', '2026-09-11T09:44:00Z')]);
  assert.equal(wakeupReceipt(one, 'zz').answered, false);
  assert.equal(wakeupReceipt(null, 'a1').answered, false);
  assert.equal(wakeupReceipt(undefined, undefined).answered, false);
  assert.equal(wakeupReceipt({ type: 'practice', rows: [] }, 'a1').answered, false,
    'a commitment that is not a wake-up never produces a wake-up receipt');
});

test('the row is empty markup when there is nothing to say, so Home needs no branch', () => {
  assert.equal(receiptHtml({ answered: false }, id), '');
  assert.equal(receiptHtml(null, id), '');
  assert.equal(receiptHtml(undefined, id), '');
});

test('the row names the time, links to the squad, and carries no em dash', () => {
  const html = receiptHtml({ answered: true, atMin: 346, late: false, placed: 2 }, id);
  assert.match(html, /Up at 5:46/);
  assert.match(html, /2 of the squad up\./);
  assert.match(html, /data-go="wakeup-squad"/);
  assert.ok(!html.includes(String.fromCharCode(8212)), 'no em dashes in user-facing copy');
});

test('a late row is marked so it can be painted amber rather than green', () => {
  const html = receiptHtml({ answered: true, atMin: 369, late: true, placed: null }, id);
  assert.match(html, /class="wk-receipt late"/);
  assert.match(html, /Answered late\./);
});

test('everything the caller passes goes through their escaper', () => {
  const seen = [];
  receiptHtml({ answered: true, atMin: 346, late: false, placed: 1 }, (s) => { seen.push(s); return s; });
  assert.ok(seen.length >= 2, 'both the clock and the tail are escaped');
});
