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
