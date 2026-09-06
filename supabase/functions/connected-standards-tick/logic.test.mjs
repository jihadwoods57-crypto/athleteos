// run: node --test supabase/functions/connected-standards-tick/logic.test.mjs
//
// Pins the parked 2026-09-05 defect: team-standard pushes ignored quiet hours and opt-out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitPushRecipients } from './logic.mjs';

const FB = 'America/New_York';
const at = (iso) => Date.parse(iso);
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('an athlete inside their quiet window is not pushed; the same athlete is pushed once it closes', () => {
  const profOf = new Map([[U(1), { timezone: 'America/Los_Angeles', quiet_from_min: 22 * 60, quiet_to_min: 7 * 60 }]]);
  // 23:59 PDT: the midnight miss would wake them.
  const night = splitPushRecipients([U(1)], profOf, at('2026-09-07T06:59:00Z'), FB);
  assert.deepEqual(night, { allowed: [], quiet: 1, optedOut: 0, unreadable: 0 });
  // 07:05 PDT: window closed.
  const morning = splitPushRecipients([U(1)], profOf, at('2026-09-07T14:05:00Z'), FB);
  assert.deepEqual(morning, { allowed: [U(1)], quiet: 0, optedOut: 0, unreadable: 0 });
});

test('quiet is judged in each athlete\'s own zone, not one clock for the whole roster', () => {
  const win = { quiet_from_min: 22 * 60, quiet_to_min: 7 * 60 };
  const profOf = new Map([
    [U(1), { timezone: 'America/Los_Angeles', ...win }],  // 23:30 PDT: quiet
    [U(2), { timezone: 'America/New_York', ...win }],     // 02:30 EDT: quiet
    [U(3), { timezone: 'Asia/Singapore', ...win }],       // 14:30 SGT: awake
  ]);
  const r = splitPushRecipients([U(1), U(2), U(3)], profOf, at('2026-09-07T06:30:00Z'), FB);
  assert.deepEqual(r.allowed, [U(3)]);
  assert.equal(r.quiet, 2);
});

test('either opt-out drops the push; a profile that never synced a window is pushed', () => {
  const profOf = new Map([
    [U(1), { timezone: 'America/New_York', team_standard_pushes_opt_out: true }],
    [U(2), { timezone: 'America/New_York', notifications_opt_out: true }],
    [U(3), { timezone: 'America/New_York' }],
  ]);
  const r = splitPushRecipients([U(1), U(2), U(3), U(4)], profOf, at('2026-09-07T16:00:00Z'), FB);
  assert.deepEqual(r.allowed, [U(3), U(4)], 'no row at all is not an opt-out');
  assert.equal(r.optedOut, 2);
  assert.equal(r.quiet, 0);
});

test('a failed profiles read pushes nobody: unknown opt-outs are not "nobody opted out"', () => {
  const r = splitPushRecipients([U(1), U(2)], new Map(), at('2026-09-07T16:00:00Z'), FB, { profilesUnreadable: true });
  assert.deepEqual(r, { allowed: [], quiet: 0, optedOut: 0, unreadable: 2 });
});

// Structural pins against index.ts so the gate cannot be quietly bypassed.
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

test('index.ts reads the synced columns, gates device pushes through the module, and still writes bell rows', () => {
  assert.match(SRC, /from '\.\/logic\.mjs'/, 'the function imports the tested module');
  assert.match(SRC, /select\('id, timezone, notifications_opt_out, team_standard_pushes_opt_out, quiet_from_min, quiet_to_min'\)/,
    'one profiles read carries timezone, both opt-outs and the quiet window');
  assert.match(SRC, /splitPushRecipients\(/, 'the push list goes through the gate');
  assert.match(SRC, /profilesUnreadable: profErr/, 'a failed read means no pushes');
  assert.match(SRC, /\.in\('user_id', gate\.allowed\)/, 'device tokens are read only for allowed recipients');
  const rowsAt = SRC.indexOf(".from('notifications').insert(");
  const gateAt = SRC.indexOf('splitPushRecipients(');
  assert.ok(rowsAt > 0 && gateAt > rowsAt, 'bell rows are written before the push gate, so quiet never loses the record');
});
