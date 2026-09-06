// run: node --test supabase/functions/weekly-digest/logic.test.mjs
//
// Pins the two parked 2026-09-05 defects: the Monday digest reaching a coach east of UTC+7 on
// Monday (not Tuesday), and the hourly cron never doubling anyone in one week.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { localHour, digestWindowOpen, sentRecently, digestDecision, DEDUPE_MS } from './logic.mjs';

const HOUR = 7;
const FB = 'America/New_York';
const at = (iso) => Date.parse(iso);
const decide = (nowIso, prof, extra = {}) =>
  digestDecision({ nowMs: at(nowIso), prof, hour: HOUR, fallbackTz: FB, ...extra });

// 2026-09-06 is a Sunday, 2026-09-07 a Monday.
const SG = { timezone: 'Asia/Singapore' };     // UTC+8
const PHX = { timezone: 'America/Phoenix' };   // UTC-7, no DST

test('a UTC+8 coach is sent at Sunday 23:00 UTC, which is their Monday 7 AM', () => {
  assert.equal(localHour(at('2026-09-06T23:00:00Z'), SG.timezone, FB), 7);
  assert.equal(decide('2026-09-06T23:00:00Z', SG), 'send');
  // The run one hour earlier is still Sunday evening for them; nothing sends.
  assert.equal(decide('2026-09-06T22:00:00Z', SG), 'waiting');
  // Under the old UTC-Monday-only cron the first run they could see was Monday 00:00 UTC,
  // their Monday 8 AM, which the hour gate rejected, and so on to Tuesday. Now no Monday run
  // sends them either: their one send is the Sunday 23:00 UTC run above.
  for (let h = 0; h < 24; h++) {
    assert.equal(decide(`2026-09-07T${String(h).padStart(2, '0')}:00:00Z`, SG), 'waiting', `Monday ${h}:00 UTC`);
  }
});

test('a UTC-7 coach is sent at Monday 14:00 UTC and at no other hour of the week', () => {
  assert.equal(localHour(at('2026-09-07T14:00:00Z'), PHX.timezone, FB), 7);
  assert.equal(decide('2026-09-07T14:00:00Z', PHX), 'send');
  assert.equal(decide('2026-09-06T23:00:00Z', PHX), 'waiting', 'Singapore\'s hour is Sunday afternoon in Phoenix');
  assert.equal(decide('2026-09-08T14:00:00Z', PHX), 'waiting', 'Tuesday 7 AM is not Monday');
  let sends = 0;
  for (let ms = at('2026-09-06T00:00:00Z'); ms < at('2026-09-13T00:00:00Z'); ms += 3_600_000) {
    if (digestDecision({ nowMs: ms, prof: PHX, hour: HOUR, fallbackTz: FB }) === 'send') sends++;
  }
  assert.equal(sends, 1, 'exactly one hourly run in the week is their Monday 7 AM');
});

test('the marker column stops a second digest even after the coach cleared the bell row', () => {
  const sentAt = '2026-09-06T23:00:00Z';
  const prof = { ...SG, digest_last_sent_at: sentAt };
  // Same hour, retried run (cron jitter, a manual ?all=1, a redeploy): deduped by the marker
  // alone, with the notifications row gone.
  assert.equal(decide(sentAt, prof, { hasRecentRow: false }), 'deduped');
  assert.equal(decide(sentAt, prof, { sendAll: true, hasRecentRow: false }), 'deduped', '?all=1 does not bypass the marker');
  // The notifications row alone still guards a profile whose marker never landed.
  assert.equal(decide(sentAt, SG, { hasRecentRow: true }), 'deduped');
  // A week later the marker has aged out and they are sent again.
  assert.equal(decide('2026-09-13T23:00:00Z', prof), 'send');
  assert.equal(sentRecently(sentAt, at(sentAt) + DEDUPE_MS - 1), true);
  assert.equal(sentRecently(sentAt, at(sentAt) + DEDUPE_MS), false);
  assert.equal(sentRecently(null, at(sentAt)), false, 'never sent is not recent');
  assert.equal(sentRecently('garbage', at(sentAt)), false, 'an unparsable stamp is never a reason to skip');
});

test('opt-out wins over everything; a profile with no timezone uses the fallback', () => {
  assert.equal(decide('2026-09-06T23:00:00Z', { ...SG, notifications_opt_out: true }), 'opted_out');
  assert.equal(decide('2026-09-06T23:00:00Z', { ...SG, notifications_opt_out: true }, { sendAll: true }), 'opted_out');
  // New York Monday 7 AM is Monday 11:00 UTC in September.
  assert.equal(decide('2026-09-07T11:00:00Z', {}), 'send');
  assert.equal(decide('2026-09-07T11:00:00Z', { timezone: 'Not/AZone' }), 'send');
});

test('the early exit opens Sunday 17:00 UTC and closes after Monday 19:00 UTC, nothing else', () => {
  assert.equal(digestWindowOpen(at('2026-09-06T16:59:00Z'), HOUR), false);
  assert.equal(digestWindowOpen(at('2026-09-06T17:00:00Z'), HOUR), true, 'UTC+14 Monday 7 AM');
  assert.equal(digestWindowOpen(at('2026-09-06T23:00:00Z'), HOUR), true, 'Singapore');
  assert.equal(digestWindowOpen(at('2026-09-07T19:00:00Z'), HOUR), true, 'UTC-12 Monday 7 AM');
  assert.equal(digestWindowOpen(at('2026-09-07T20:00:00Z'), HOUR), false);
  assert.equal(digestWindowOpen(at('2026-09-09T11:00:00Z'), HOUR), false, 'a Wednesday run does no reads');
  // Every coach who can be sent is inside the window: Nepal (+5:45) and Chatham (+12:45) included.
  for (const tz of ['Asia/Kathmandu', 'Pacific/Chatham', 'Pacific/Kiritimati', 'Etc/GMT+12', 'Pacific/Honolulu']) {
    for (let ms = at('2026-09-06T00:00:00Z'); ms < at('2026-09-13T00:00:00Z'); ms += 3_600_000) {
      if (digestDecision({ nowMs: ms, prof: { timezone: tz }, hour: HOUR, fallbackTz: FB }) === 'send') {
        assert.equal(digestWindowOpen(ms, HOUR), true, `${tz} at ${new Date(ms).toISOString()}`);
      }
    }
  }
});

// Structural pins against index.ts: the decision module is what the function runs, the marker is
// written on send, and a failed profiles read still skips the roster (the 1c02b610 rule).
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

test('index.ts runs the decision module, writes the marker, and keeps the failed-read rule', () => {
  assert.match(SRC, /from '\.\/logic\.mjs'/, 'the function imports the tested module');
  assert.match(SRC, /digestWindowOpen\(nowMs, LOCAL_HOUR\)/, 'early exit outside the world-wide Monday window');
  assert.match(SRC, /digestDecision\(\{/, 'per-coach gate is the tested one');
  assert.match(SRC, /digest_last_sent_at/, 'the marker column is read and written');
  assert.match(SRC, /update\(\{ digest_last_sent_at: /, 'the marker is stamped on send');
  assert.match(SRC, /if \(profErr\) \{[^}]*continue; \}/, 'a failed profiles read skips the roster, never sends');
});
