import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgePreset, tierForStatus, presetForStatus, nudgeResultCopy, nudgedTodayFromInterventions } from './nudge-presets.js';
import { feedRowFromServer } from './notif-feed.js';

/* ---------------- presets ---------------- */

test('every tier gets its matched body; unknown/absent tiers get the neutral one', () => {
  assert.equal(nudgePreset('below'), "You're below standard today. Close the gap.");
  assert.equal(nudgePreset('due_soon'), 'Your next log is due soon. Stay ahead of it.');
  assert.equal(nudgePreset('critical'), 'Your log is overdue. Get it in.');
  assert.equal(nudgePreset('overdue'), 'Your log is overdue. Get it in.');
  assert.equal(nudgePreset(null), 'Time to get your log in.');
  assert.equal(nudgePreset('weird_future_tier'), 'Time to get your log in.');
});

test('status.js keys map to preset tiers; on_standard maps to none', () => {
  assert.equal(tierForStatus('below_standard'), 'below');
  assert.equal(tierForStatus('needs_review'), 'below');
  assert.equal(tierForStatus('due_soon'), 'due_soon');
  assert.equal(tierForStatus('overdue'), 'critical');
  assert.equal(tierForStatus('no_activity'), 'critical');
  assert.equal(tierForStatus('on_standard'), null);
  assert.equal(tierForStatus(undefined), null);
});

test('presetForStatus never produces an accusation for an unknown status', () => {
  assert.equal(presetForStatus('on_standard'), 'Time to get your log in.');
  assert.equal(presetForStatus(null), 'Time to get your log in.');
  assert.equal(presetForStatus('below_standard'), "You're below standard today. Close the gap.");
});

/* ---------------- delivery-truth copy ---------------- */

test('a real device push reads as phone delivery', () => {
  const c = nudgeResultCopy({ ok: true, pushed: 2, devices: 2 });
  assert.equal(c.ok, true);
  assert.equal(c.tone, 'ok');
  assert.match(c.msg, /lands on their phone/);
});

test('no device token is success, but never claims phone delivery', () => {
  const c = nudgeResultCopy({ ok: true, pushed: 0, devices: 0 });
  assert.equal(c.ok, true);
  assert.equal(c.tone, 'warn');
  assert.match(c.msg, /in-app inbox/);
  assert.doesNotMatch(c.msg, /lands on their phone/);
});

test('opt-out suppression says pushes are off', () => {
  const c = nudgeResultCopy({ ok: true, pushed: 0, suppressed: 'notifications_off' });
  assert.equal(c.tone, 'warn');
  assert.match(c.msg, /pushes turned off/);
});

test('dedupe says they were just pinged', () => {
  const c = nudgeResultCopy({ ok: true, pushed: 0, deduped: true });
  assert.equal(c.tone, 'warn');
  assert.match(c.msg, /just pinged/);
});

test('a failed call fails honestly, and a rate limit is not "check your connection"', () => {
  const f = nudgeResultCopy({ ok: false });
  assert.equal(f.ok, false);
  assert.match(f.msg, /connection/);
  const rl = nudgeResultCopy({ ok: false, rateLimited: true });
  assert.equal(rl.ok, false);
  assert.match(rl.msg, /send limit/);
  assert.doesNotMatch(rl.msg, /connection/);
  assert.equal(nudgeResultCopy(null).ok, false);
});

/* ---------------- server-informed daily guard ---------------- */

test('a nudge intervention from today (local) marks the athlete nudged', () => {
  const now = new Date(2026, 7, 15, 9, 30); // Aug 15 2026, local
  const rows = [{ kind: 'nudge', created_at: now.toISOString() }];
  assert.equal(nudgedTodayFromInterventions(rows, '2026-08-15'), true);
});

test('yesterday, other kinds, junk rows and junk dates never count', () => {
  const yesterday = new Date(2026, 7, 14, 23, 50).toISOString();
  assert.equal(nudgedTodayFromInterventions([{ kind: 'nudge', created_at: yesterday }], '2026-08-15'), false);
  const today = new Date(2026, 7, 15, 9, 0).toISOString();
  assert.equal(nudgedTodayFromInterventions([{ kind: 'message', created_at: today }], '2026-08-15'), false);
  assert.equal(nudgedTodayFromInterventions([{ kind: 'nudge', created_at: 'garbage' }], '2026-08-15'), false);
  assert.equal(nudgedTodayFromInterventions([null, {}, { kind: 'nudge' }], '2026-08-15'), false);
  assert.equal(nudgedTodayFromInterventions(null, '2026-08-15'), false);
  assert.equal(nudgedTodayFromInterventions([{ kind: 'nudge', created_at: today }], null), false);
});

/* ---------------- bell mapping for the new kinds ---------------- */

const NOW = Date.parse('2026-08-15T12:00:00Z');
const row = (kind) => ({ id: 'n1', kind, title: 'T', body: 'B', created_at: '2026-08-15T11:58:00Z', read_at: null });
const MEAL = '123e4567-e89b-12d3-a456-426614174000';

test('a nudge row routes home; comments and reacts route to the meal thread', () => {
  assert.equal(feedRowFromServer(row('nudge'), NOW).route, 'home');
  assert.equal(feedRowFromServer(row(`coach_comment:${MEAL}`), NOW).route, `meal-view/${MEAL}`);
  assert.equal(feedRowFromServer(row(`coach_react:${MEAL}`), NOW).route, `meal-view/${MEAL}`);
});

test('coach-bound meal kinds route to the coach meal screen and carry honest tags', () => {
  const rev = feedRowFromServer(row(`meal_review:${MEAL}`), NOW);
  assert.equal(rev.route, `coach-meal/${MEAL}`);
  assert.equal(rev.tag, 'review');
  const act = feedRowFromServer(row(`meal_action:${MEAL}`), NOW);
  assert.equal(act.route, `coach-meal/${MEAL}`);
  assert.equal(act.level, 'high');
  const log = feedRowFromServer(row(`meal_logged:${MEAL}`), NOW);
  assert.equal(log.route, `coach-meal/${MEAL}`);
  assert.equal(log.tag, 'logged');
});

test('a coach reaction is not "urgent": conversation kinds stay off the high level', () => {
  const r = feedRowFromServer(row(`coach_react:${MEAL}`), NOW);
  assert.notEqual(r.level, 'high');
  assert.equal(r.tag, 'coach');
});

test('junk suffixes render as plain records, never a link into nowhere', () => {
  assert.equal(feedRowFromServer(row('coach_comment:<bad>'), NOW).route, null);
  assert.equal(feedRowFromServer(row('meal_review'), NOW).route, null);
});
