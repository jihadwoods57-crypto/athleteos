/* Block on the push side (0244, G-R3). Who blocked the sender, read once, dropped everywhere a
 * person's words or nudges would reach the blocker.
 *
 * Run: node --test supabase/functions/_shared/blocks.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockersOf, withoutBlockers, deviceCounts, sumDevices } from './blocks.mjs';

const svcReturning = (data, error = null) => {
  const calls = [];
  return { calls, rpc: async (fn, args) => { calls.push([fn, args]); return { data, error }; } };
};

test('blockersOf reads blocked_recipients once and understands both PostgREST shapes', async () => {
  const s1 = svcReturning(['a', 'b']);
  assert.deepEqual([...await blockersOf(s1, 'coach', ['a', 'b', 'c', 'a'])].sort(), ['a', 'b']);
  assert.deepEqual(s1.calls, [['blocked_recipients', { p_sender: 'coach', p_recipients: ['a', 'b', 'c'] }]]);
  const s2 = svcReturning([{ blocked_recipients: 'c' }]);
  assert.deepEqual([...await blockersOf(s2, 'coach', ['c'])], ['c']);
});

test('fails open: an error or no service client blocks nothing (the thread itself fails closed)', async () => {
  assert.equal((await blockersOf(svcReturning(null, { message: 'down' }), 'coach', ['a'])).size, 0);
  assert.equal((await blockersOf(null, 'coach', ['a'])).size, 0);
  assert.equal((await blockersOf({ rpc: () => { throw new Error('x'); } }, 'coach', ['a'])).size, 0);
  const none = svcReturning(['a']);
  assert.equal((await blockersOf(none, 'coach', [])).size, 0);
  assert.equal(none.calls.length, 0, 'no recipients, no read');
});

test('deviceCounts answers a blocked recipient with their real device count', async () => {
  const svc = { from: () => ({ select: () => ({ in: async () => ({ data: [{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' }] }) }) }) };
  const m = await deviceCounts(svc, ['a', 'b', 'c']);
  assert.equal(sumDevices(m, ['a', 'c']), 2);
  assert.equal((await deviceCounts({ from: () => { throw new Error('x'); } }, ['a'])).size, 0);
});

test('withoutBlockers keeps order and drops only blockers', () => {
  assert.deepEqual(withoutBlockers(['a', 'b', 'c'], new Set(['b'])), ['a', 'c']);
  assert.deepEqual(withoutBlockers(['a'], []), ['a']);
});

test('every sender that speaks for a person drops the people who blocked them', () => {
  const FN = join(process.cwd(), 'supabase', 'functions');
  const src = (f) => readFileSync(join(FN, f, 'index.ts'), 'utf8');
  const sp = src('send-push');
  assert.match(sp, /const blocked0 = await blockersOf\(svc0, callerId, athleteIds\)/, 'announcements');
  assert.match(sp, /const blocked3 = await blockersOf\(svc3, callerId3, targets3\)/, 'bulk nudge');
  // I1: nothing in any response says 'blocked'; a blocked recipient reads like a delivery.
  assert.doesNotMatch(sp, /suppressed: 'blocked'/);
  assert.doesNotMatch(src('roll-call-coach'), /'blocked'/);
  assert.match(sp, /results\.push\(\{ athlete_id: id, pushed: d, devices: d \}\)/);
  assert.match(sp, /return json\(\{ ok: true, pushed: d, devices: d \}, 200, cors\)/);
  assert.match(sp, /coaches: coachIds0\.length/);
  assert.match(sp, /const blocked2 = await blockersOf\(svc2, athleteId2, coachIds0\)/, 'athlete to coach');
  assert.match(sp, /await blockersOf\(svc, senderId, \[athleteId\]\)/, 'coach to one athlete');
  assert.doesNotMatch(src('meal-chat'), /flagBlocked/, 'a safety flag gets past a block (M4)');
  const rc = src('roll-call-coach');
  assert.equal((rc.match(/await blockersOf\(svc, coachId,/g) || []).length, 2, 'roll call notice and nudge');
});
