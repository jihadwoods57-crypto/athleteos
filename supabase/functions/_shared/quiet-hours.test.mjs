// run: node --test supabase/functions/_shared/quiet-hours.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { localParts, inQuietWindow, quietWindowOf, pushSkipReason } from './quiet-hours.mjs';

const at = (iso) => Date.parse(iso);

test('localParts reads the clock in the profile timezone, not the process one', () => {
  // Sunday 23:30 UTC is Monday 07:30 in Singapore and Sunday 16:30 in Phoenix.
  const sg = localParts(at('2026-09-06T23:30:00Z'), 'Asia/Singapore');
  assert.deepEqual(sg, { hour: 7, minute: 7 * 60 + 30, weekday: 1 });
  const phx = localParts(at('2026-09-06T23:30:00Z'), 'America/Phoenix');
  assert.deepEqual(phx, { hour: 16, minute: 16 * 60 + 30, weekday: 0 });
});

test('localParts falls back for a missing or unknown zone and never prints hour 24', () => {
  const fb = localParts(at('2026-09-07T04:00:00Z'), null, 'America/New_York');
  assert.equal(fb.hour, 0, 'midnight in New York reads as 0');
  assert.equal(fb.minute, 0);
  assert.deepEqual(localParts(at('2026-09-07T04:00:00Z'), 'Not/AZone', 'America/New_York'), fb);
});

test('inQuietWindow matches the client inQuiet: wraps midnight, empty when from equals to', () => {
  const from = 22 * 60, to = 7 * 60;
  assert.equal(inQuietWindow(23 * 60, from, to), true);
  assert.equal(inQuietWindow(2 * 60, from, to), true);
  assert.equal(inQuietWindow(7 * 60, from, to), false, 'the end minute is outside');
  assert.equal(inQuietWindow(12 * 60, from, to), false);
  assert.equal(inQuietWindow(13 * 60, 12 * 60, 14 * 60), true, 'a same-day window');
  assert.equal(inQuietWindow(5 * 60, 300, 300), false, 'from === to is no window');
});

test('a profile that never synced a window has none; a partial sync is also none', () => {
  assert.equal(quietWindowOf(null), null);
  assert.equal(quietWindowOf({}), null);
  assert.equal(quietWindowOf({ quiet_from_min: 1320, quiet_to_min: null }), null);
  assert.equal(quietWindowOf({ quiet_from_min: 1500, quiet_to_min: 420 }), null, 'out of range is ignored');
  assert.deepEqual(quietWindowOf({ quiet_from_min: 1320, quiet_to_min: 420 }), { from: 1320, to: 420 });
});

test('pushSkipReason: quiet in the athlete zone, sends outside it, opt-outs win over quiet', () => {
  const prof = { timezone: 'America/Los_Angeles', quiet_from_min: 22 * 60, quiet_to_min: 7 * 60 };
  // 06:59 UTC on 7 Sept 2026 is 23:59 PDT on 6 Sept: inside the window.
  assert.equal(pushSkipReason(prof, at('2026-09-07T06:59:00Z')), 'quiet');
  // 14:05 UTC is 07:05 PDT: the window closed at 07:00.
  assert.equal(pushSkipReason(prof, at('2026-09-07T14:05:00Z')), null);
  // The same instant with no synced window sends.
  assert.equal(pushSkipReason({ timezone: 'America/Los_Angeles' }, at('2026-09-07T06:59:00Z')), null);
  assert.equal(pushSkipReason(null, at('2026-09-07T06:59:00Z')), null);
  assert.equal(pushSkipReason({ ...prof, team_standard_pushes_opt_out: true }, at('2026-09-07T14:05:00Z')), 'opted_out');
  assert.equal(pushSkipReason({ ...prof, notifications_opt_out: true }, at('2026-09-07T06:59:00Z')), 'opted_out');
});
