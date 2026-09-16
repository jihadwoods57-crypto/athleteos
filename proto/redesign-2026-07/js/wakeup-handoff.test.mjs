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

/* THE ATHLETE'S OWN ROW (2026-09-16). Home passed `VC.board` into this, and the board is coach
 * data: `my_commitments` (the athlete's own RPC, asked directly) returns 55 keys and **no `rows`
 * key at all**, so morningSummary saw an empty squad, nobody matched, and the receipt was `none`
 * for every athlete, forever. The row simply never appeared. Same cause emptied #wakeup-squad.
 *
 * Placement genuinely cannot be known from the athlete's own row, and no RPC offers it. Everything
 * else can: whether they answered, when, and whether it was late. So the receipt is built from the
 * athlete's own instance and says "Answered." instead of "3 of the squad up."
 */
const mine = (over = {}) => ({
  type: 'morning_roll_call', instance_id: 'rc-1',
  acknowledged_at: null, verdict: 'pending', late_min: 0, ...over,
});

test('the athlete own instance produces a receipt even with no squad rows', () => {
  const at = new Date(); at.setHours(5, 47, 0, 0);
  const r = wakeupReceipt(mine({ acknowledged_at: at.toISOString(), verdict: 'on_standard' }), 'me');
  assert.equal(r.answered, true, 'the athlete answered and Home must say so');
  assert.equal(r.late, false);
  assert.equal(r.atMin, 5 * 60 + 47);
  assert.equal(r.placed, null, 'placement is squad data the athlete cannot see; never invent one');
});

test('a late answer on the athlete own row reads late', () => {
  const at = new Date(); at.setHours(6, 12, 0, 0);
  const r = wakeupReceipt(mine({ acknowledged_at: at.toISOString(), verdict: 'late', late_min: 7 }), 'me');
  assert.equal(r.answered, true);
  assert.equal(r.late, true);
});

test('an unanswered own row is still no receipt', () => {
  assert.deepEqual(wakeupReceipt(mine(), 'me'), { answered: false, atMin: null, late: false, placed: null });
});

test('the receipt is only a door when there is a squad to open', () => {
  // It linked to #wakeup-squad unconditionally, and that screen is empty for an athlete for the
  // same reason this receipt was: there is no squad RPC. A control that opens nothing is worse
  // than no control.
  const at = new Date(); at.setHours(5, 47, 0, 0);
  const own = receiptHtml(wakeupReceipt(mine({ acknowledged_at: at.toISOString(), verdict: 'on_standard' }), 'me'), id);
  assert.doesNotMatch(own, /data-go="wakeup-squad"/, 'no squad data, so no door to it');
  assert.match(own, /Up at 5:47/);
  const squad = receiptHtml(wakeupReceipt(inst([row('me', 'Me', 'on_standard', '2026-09-16T09:47:00Z')]), 'me'), id);
  assert.match(squad, /data-go="wakeup-squad"/, 'a coach-side instance still opens the board');
});
