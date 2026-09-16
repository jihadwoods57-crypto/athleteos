/* The in-app alarm face: WHEN it shows, WHICH wake-up, and what it says.
 *
 * The property worth protecting: it must never cover the screen for a morning that is already
 * answered, excused, decided, dismissed or not open yet, and it must sleep until exactly the
 * next open. A face that pops for a closed roll call at 9 AM is the kind of bug that gets an
 * app deleted.
 * Run: node --test proto/redesign-2026-07/js/wake-face.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { wakeFaceTarget, nextWakeFaceAt, wakeFaceLine, armWakeFace, _resetWakeFace } from './wake-face.js';

const NOW = Date.parse('2026-09-16T10:00:00Z'); // 6:00 AM New York
const iso = (min) => new Date(NOW + min * 60000).toISOString();
const nowISO = new Date(NOW).toISOString();
const wake = (over = {}) => ({
  instance_id: 'w1', type: 'morning_roll_call', title: 'Wake-Up Roll Call', coach_name: 'Coach Reed',
  timezone: 'America/New_York', occurs_on: '2026-09-16',
  starts_at: iso(0), respond_by_at: iso(5), closes_at: iso(30),
  status: 'pending', acknowledged_at: null, verdict: 'pending', message: 'Up and at it.',
  ...over,
});

test('an open, unanswered wake-up is the target', () => {
  assert.equal(wakeFaceTarget([wake()], nowISO).instance_id, 'w1');
});

test('late but still inside the close is still a target', () => {
  const t = wakeFaceTarget([wake({ starts_at: iso(-10), respond_by_at: iso(-5), closes_at: iso(20) })], nowISO);
  assert.ok(t, 'late is answerable, so the face shows');
});

test('answered, excused, decided, closed, cancelled and not-yet-open mornings are never targets', () => {
  const cases = [
    wake({ acknowledged_at: iso(-1), status: 'acknowledged' }),
    wake({ status: 'excused' }),
    wake({ verdict: 'missed' }),
    wake({ starts_at: iso(-60), respond_by_at: iso(-55), closes_at: iso(-30) }),
    wake({ instance_status: 'cancelled' }),
    wake({ starts_at: iso(10), respond_by_at: iso(15), closes_at: iso(40) }),
    { ...wake(), type: 'practice' },
  ];
  for (const c of cases) assert.equal(wakeFaceTarget([c], nowISO), null, JSON.stringify(c));
});

test('a dismissed instance stays dismissed, but another morning can still show', () => {
  const rows = [wake(), wake({ instance_id: 'w2', starts_at: iso(-2), respond_by_at: iso(3), closes_at: iso(28) })];
  const t = wakeFaceTarget(rows, nowISO, new Set(['w2']));
  assert.equal(t.instance_id, 'w1');
});

test('the nearest open is the next wake, and nothing behind us counts', () => {
  const rows = [
    wake({ instance_id: 'a', starts_at: iso(120), respond_by_at: iso(125), closes_at: iso(150) }),
    wake({ instance_id: 'b', starts_at: iso(30), respond_by_at: iso(35), closes_at: iso(60) }),
    wake({ instance_id: 'c', starts_at: iso(-30), respond_by_at: iso(-25), closes_at: iso(-1) }),
    wake({ instance_id: 'd', starts_at: iso(15), acknowledged_at: iso(-1), status: 'acknowledged' }),
  ];
  assert.equal(nextWakeFaceAt(rows, NOW), NOW + 30 * 60000);
  assert.equal(nextWakeFaceAt([], NOW), null);
  assert.equal(nextWakeFaceAt(null, NOW), null);
});

test('the line names the deadline while open and the close once late, in the team zone', () => {
  const open = wakeFaceLine(wake(), nowISO);
  assert.equal(open.late, false);
  assert.equal(open.text, 'On Standard until 6:05 AM.');
  const late = wakeFaceLine(wake({ starts_at: iso(-10), respond_by_at: iso(-5), closes_at: iso(20) }), nowISO);
  assert.equal(late.late, true);
  assert.match(late.text, /late/i);
  assert.match(late.text, /6:20 AM/);
  assert.doesNotMatch(open.text + late.text, /—/, 'no em dash in copy');
});

test('arming with nothing due and nothing ahead is idle; with a morning ahead it sleeps', () => {
  _resetWakeFace();
  assert.equal(armWakeFace([], NOW), 'idle');
  const r = armWakeFace([wake({ starts_at: iso(40), respond_by_at: iso(45), closes_at: iso(70) })], NOW);
  assert.equal(r, 'armed');
  _resetWakeFace();
});
