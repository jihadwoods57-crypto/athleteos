/* The coach's roll call screen, its pure rules. Run: node --test proto/redesign-2026-07/js/rollcall-hub-model.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  athleteStep, stepRows, armingCounts, hubPhase, remindLabel, nudgeLabel, morningLabel, alarmsLabel, dayWord,
  STEP_LABEL, AFTER_HOURS,
} from './rollcall-hub-model.js';

test('each athlete\'s step, in the order that decides it', () => {
  assert.equal(athleteStep({ status: 'excused', alarm_armed_at: 'x' }), 'excused');
  assert.equal(athleteStep({ status: 'pending', alarm_armed_at: '2026-09-24T01:00:00Z', can_push: false }), 'armed');
  assert.equal(athleteStep({ status: 'pending', can_push: false, seen_at: 'x' }), 'no_push');
  assert.equal(athleteStep({ status: 'pending', can_push: true, seen_at: 'x' }), 'seen');
  assert.equal(athleteStep({ status: 'pending', can_push: true, notified_at: 'x' }), 'unseen');
  assert.equal(athleteStep({ status: 'pending', can_push: true }), 'untold', 'no push has gone out yet: never "hasn’t opened it"');
  assert.equal(athleteStep({ status: 'pending', notified_at: 'x' }), 'unseen', 'an older server without can_push is not "Notifications off"');
  assert.deepEqual(STEP_LABEL, {
    armed: 'Alarm set ✓', seen: 'Seen, alarm not set', unseen: 'Hasn’t opened it', untold: 'Hasn’t been told',
    no_push: 'Notifications off', excused: 'Excused',
  });
});

test('the not-set lead the list; the counts ignore the excused', () => {
  const rows = [
    { name: 'Ann', status: 'pending', alarm_armed_at: 'x' }, { name: 'Bo', status: 'excused' },
    { name: 'Cy', status: 'pending', seen_at: 'x', can_push: true }, { name: 'Di', status: 'pending', can_push: true, notified_at: 'x' },
    { name: 'Ed', status: 'pending', can_push: false }, { name: 'Flo', status: 'pending', can_push: true },
  ];
  assert.deepEqual(stepRows(rows).map((r) => r.name), ['Ed', 'Flo', 'Di', 'Cy', 'Ann', 'Bo']);
  assert.deepEqual(armingCounts(rows), { total: 5, armed: 1, notSet: 4, reachable: 3 });
  assert.deepEqual(armingCounts(null), { total: 0, armed: 0, notSet: 0, reachable: 0 });
});

test('the clock decides the body', () => {
  const H = 3600000;
  const now = Date.parse('2026-09-24T12:00:00Z');
  const inst = (id, opens, closes, starts, o = {}) => ({ instance_id: id, opens_at: new Date(now + opens * H).toISOString(),
    closes_at: new Date(now + closes * H).toISOString(), starts_at: new Date(now + starts * H).toISOString(), instance_status: 'scheduled', skipped: false, ...o });
  const past = inst('p', -7, -6, -6.9);
  const live = inst('l', -0.1, 0.4, 0.05);
  const next = inst('n', 16, 17, 16.1);
  assert.equal(hubPhase([past, live, next], now).phase, 'live');
  assert.deepEqual([hubPhase([past, next], now).phase, hubPhase([past, next], now).instance.instance_id], ['after', 'p']);
  assert.equal(hubPhase([inst('old', -10, -9, -9.9), next], now).phase, 'before', `after ${AFTER_HOURS} h the next morning takes over`);
  assert.equal(hubPhase([inst('x', 16, 17, 16.1, { skipped: true })], now).phase, 'none');
  assert.equal(hubPhase([past, next], now).next.instance_id, 'n');
  assert.equal(hubPhase([inst('c', -0.1, 0.4, 0.05, { instance_status: 'cancelled' }), next], now).phase, 'before', 'a cancelled morning is never live');
  assert.equal(hubPhase(null, now).phase, 'none');
  // No opens_at (an older row): the start stands in for it.
  assert.equal(hubPhase([{ ...next, opens_at: null }], now).phase, 'before');
});

test('labels', () => {
  assert.equal(remindLabel(1), 'Remind the 1 not set');
  assert.equal(remindLabel(1, 'Tommy Vargas'), 'Remind Tommy to set it');
  assert.equal(remindLabel(3, 'Tommy Vargas'), 'Remind the 3 not set');
  assert.equal(nudgeLabel(2), 'Nudge the 2 not up');
  assert.equal(morningLabel({ occurs_on: '2026-09-24', starts_min: 285 }), 'Thu 4:45 AM');
  assert.equal(morningLabel(null), '');
  assert.equal(alarmsLabel({ armed: 5, total: 6 }), '5 of 6 alarms set');
  assert.equal(alarmsLabel({ total: 6 }), '');
  assert.equal(dayWord({ occurs_on: '2026-09-24' }, '2026-09-24'), 'this morning');
  assert.equal(dayWord({ occurs_on: '2026-09-25' }, '2026-09-24'), 'tomorrow');
  assert.equal(dayWord({ occurs_on: '2026-09-28' }, '2026-09-24'), 'Monday');
});
