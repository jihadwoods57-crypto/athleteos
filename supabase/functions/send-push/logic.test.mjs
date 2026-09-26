// run: node --test supabase/functions/send-push/logic.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { sanitizeBulkPayload, aggregateBulkResults, BULK_CAP } from './logic.mjs';

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BOOK = U(999);

test('rejects a payload with no array', () => {
  assert.equal(sanitizeBulkPayload({}).ok, false);
  assert.equal(sanitizeBulkPayload({ athlete_ids: 'abc' }).ok, false);
});

test('filters junk, dedupes case-insensitively, keeps order', () => {
  const r = sanitizeBulkPayload({
    athlete_ids: [U(1), 'not-a-uuid', U(2), U(1).toUpperCase(), 42, null, U(3)],
    book_id: BOOK,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ids, [U(1), U(2), U(3)]);
  assert.equal(r.dropped, 0);
});

test('caps at BULK_CAP and reports what was dropped', () => {
  const ids = Array.from({ length: BULK_CAP + 25 }, (_, i) => U(i + 1));
  const r = sanitizeBulkPayload({ athlete_ids: ids, book_id: BOOK });
  assert.equal(r.ok, true);
  assert.equal(r.ids.length, BULK_CAP);
  assert.equal(r.dropped, 25);
});

test('requires a valid book_id and defaults book to team', () => {
  assert.equal(sanitizeBulkPayload({ athlete_ids: [U(1)] }).ok, false);
  assert.equal(sanitizeBulkPayload({ athlete_ids: [U(1)], book_id: 'nope' }).ok, false);
  const r = sanitizeBulkPayload({ athlete_ids: [U(1)], book_id: BOOK, book: 'weird' });
  assert.equal(r.book, 'team');
  assert.equal(sanitizeBulkPayload({ athlete_ids: [U(1)], book_id: BOOK, book: 'practice' }).book, 'practice');
});

test('clamps title/body and empty ids fail closed', () => {
  const r = sanitizeBulkPayload({ athlete_ids: [U(1)], book_id: BOOK, title: 'x'.repeat(400), body: 'y'.repeat(900) });
  assert.equal(r.title.length, 120);
  assert.equal(r.body.length, 300);
  assert.equal(sanitizeBulkPayload({ athlete_ids: ['junk'], book_id: BOOK }).ok, false);
});

test('reasons: keeps valid tiers, clamps keys, drops junk athletes', () => {
  const r = sanitizeBulkPayload({
    athlete_ids: [U(1), U(2)], book_id: BOOK,
    reasons: {
      [U(1)]: { reason_key: 'k'.repeat(200), tier: 'critical' },
      [U(2)]: { tier: 'not-a-tier' },
      [U(3)]: { reason_key: 'never-targeted' },
    },
  });
  assert.equal(r.reasons[U(1)].reason_key.length, 80);
  assert.equal(r.reasons[U(1)].tier, 'critical');
  assert.equal(r.reasons[U(2)], undefined); // junk tier and no key = nothing worth writing
  assert.equal(r.reasons[U(3)], undefined); // not in the target list
});

test('aggregate mirrors the roster summary vocabulary', () => {
  const agg = aggregateBulkResults([
    { athlete_id: U(1), pushed: 2, devices: 2 },
    { athlete_id: U(2), pushed: 0, devices: 0 },          // in-app only
    { athlete_id: U(3), deduped: true },
    { athlete_id: U(4), suppressed: 'notifications_off' },
    null,
  ]);
  assert.deepEqual(agg, { sent: 2, inboxOnly: 1, deduped: 1, suppressed: 1 });
});

// ---- roll call switched off (2026-09-24)
import { rollcallReportSilenced } from './logic.mjs';

test('a roll call answer is not pushed to coaches while the roll call is switched off', () => {
  assert.equal(rollcallReportSilenced('rollcall_answered', { kill_switch: true }), true);
});

test('a roll call answer is pushed as before when the switch is released or the row is absent', () => {
  assert.equal(rollcallReportSilenced('rollcall_answered', { kill_switch: false }), false);
  assert.equal(rollcallReportSilenced('rollcall_answered', null), false);
});

test('the switch never silences any other report', () => {
  for (const k of ['meal_logged', 'athlete_message', 'checkin_logged', 'meal_review', '', null]) {
    assert.equal(rollcallReportSilenced(k, { kill_switch: true }), false, String(k));
  }
});

/* ---------------- lessons and team challenges (0256): announced once, to the right people ---------------- */
import { sanitizeTeachPush, claimAudience, teachBellKind, planTeachPush } from './logic.mjs';
import { readFileSync } from 'node:fs';

test('teach push: only a lesson or a challenge, by uuid', () => {
  assert.deepEqual(sanitizeTeachPush({ kind: 'lesson', id: U(7).toUpperCase() }), { kind: 'lesson', id: U(7) });
  assert.deepEqual(sanitizeTeachPush({ kind: 'challenge', id: U(8) }), { kind: 'challenge', id: U(8) });
  assert.equal(sanitizeTeachPush({ kind: 'nudge', id: U(8) }), null);
  assert.equal(sanitizeTeachPush({ kind: 'lesson', id: 'lesson/carbs' }), null);
  assert.equal(sanitizeTeachPush(null), null);
});

test('teach push: the audience is the claim\'s, cleaned and deduped', () => {
  assert.deepEqual(claimAudience({ athlete_ids: [U(1), U(1), 'x', 5, U(2)] }), [U(1), U(2)]);
  assert.deepEqual(claimAudience(null), []);
  assert.equal(teachBellKind({ kind: 'lesson', ref: 'carbs-are-fuel' }), 'lesson:carbs-are-fuel');
  assert.equal(teachBellKind({ kind: 'lesson', ref: '<b>' }), 'lesson');
  assert.equal(teachBellKind({ kind: 'challenge' }), 'challenge');
});

test('teach push: a blocker gets nothing; opt-outs and quiet hours get the bell row but no push', () => {
  const noon = Date.parse('2026-09-26T16:00:00Z');   // 12:00 in New York
  const profiles = [
    { id: U(1) },
    { id: U(2), notifications_opt_out: true },
    { id: U(3), team_standard_pushes_opt_out: true },
    { id: U(4), quiet_from_min: 600, quiet_to_min: 780, timezone: 'America/New_York' },   // 10:00 to 13:00
    { id: U(5) },
  ];
  const plan = planTeachPush({ athleteIds: [U(1), U(2), U(3), U(4), U(5)], profiles, blocked: new Set([U(5)]), nowMs: noon });
  assert.deepEqual(plan.bell, [U(1), U(2), U(3), U(4)]);
  assert.deepEqual(plan.push, [U(1)]);
});

test('teach push: the function claims before it sends, and sends only a claimed audience', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const branch = src.split('// ---------- lessons and team challenges (teach_push mode)')[1].split('// ----------')[0];
  assert.match(branch, /caller\w*\.rpc\('claim_teach_push'/, 'the claim runs with the CALLER\'s session');
  assert.ok(branch.indexOf("rpc('claim_teach_push'") < branch.indexOf('sendExpoPushAndPrune'), 'claim first, then send');
  assert.match(branch, /claimed !== true/, 'an unclaimed (already pushed) row sends nothing');
});
