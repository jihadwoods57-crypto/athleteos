/* Block (0244, G-R3): stored on the server, cached on the phone, offered where people are. The
 * server list wins on every sync; only this phone's pending ops are layered on top (review I5).
 *
 * Run: node --test proto/redesign-2026-07/js/blocks.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = globalThis.window || {};
const JS = dirname(fileURLToPath(import.meta.url));
const { RT, act } = await import('./state.js');
const B = await import('./blocks.js');

function fakeSb(serverRows = [], { failWrites = false } = {}) {
  const rows = new Set(serverRows);
  const ops = [];
  const table = {
    insert: async (v) => { ops.push(['insert', v.blocked_id]); if (failWrites) return { error: { message: 'offline' } }; rows.add(v.blocked_id); return { error: null }; },
    delete: () => ({ eq: () => ({ eq: async (_c, id) => { ops.push(['delete', id]); if (failWrites) return { error: { message: 'offline' } }; rows.delete(id); return { error: null }; } }) }),
    select: () => ({ eq: async () => ({ data: [...rows].map((id) => ({ blocked_id: id })), error: null }) }),
  };
  return { ops, rows, from: (t) => { assert.equal(t, 'user_blocks'); return table; }, rpc: async (fn, args) => { ops.push([fn, args]); return { data: true, error: null }; } };
}

test.beforeEach(() => { store.clear(); RT.userId = 'me'; RT.mutedUsers = []; });

test('Block hides at once and is stored; Unblock shows at once and is removed', async () => {
  const sb = fakeSb(); window.sb = sb;
  await B.blockUser('coach');
  assert.equal(act.isMuted('coach'), true);
  assert.ok(sb.rows.has('coach'));
  await B.unblockUser('coach');
  assert.equal(act.isMuted('coach'), false);
  assert.ok(!sb.rows.has('coach'));
  assert.equal((await B.blockUser('me')).ok, false, 'never yourself');
});

test('I5: an unblock sticks: a sync never re-blocks, and an unblock on ANOTHER phone clears this one', async () => {
  const sb = fakeSb(['coach']); window.sb = sb;
  await B.syncBlocks();
  assert.equal(act.isMuted('coach'), true);
  await B.unblockUser('coach');
  await B.syncBlocks();
  assert.equal(act.isMuted('coach'), false, 'the sync did not bring it back');
  assert.ok(!sb.rows.has('coach'), 'and nothing wrote it back to the server');
  // Another phone unblocks: this phone's cache still has them.
  sb.rows.add('p2'); await B.syncBlocks(); assert.equal(act.isMuted('p2'), true);
  sb.rows.delete('p2');
  await B.syncBlocks();
  assert.equal(act.isMuted('p2'), false, 'server state wins');
});

test('a write that fails is queued and replayed; a pending unblock is not undone by the server list', async () => {
  const off = fakeSb(['coach'], { failWrites: true }); window.sb = off;
  await B.unblockUser('coach');
  await B.syncBlocks();
  assert.equal(act.isMuted('coach'), false, 'the pending unblock wins over the stale server row');
  const on = fakeSb(['coach']); window.sb = on;
  await B.syncBlocks();
  assert.ok(!on.rows.has('coach'), 'replayed');
  assert.equal(act.isMuted('coach'), false);
});

test('mutes from before blocks were stored go up once', async () => {
  const sb = fakeSb(); window.sb = sb;
  RT.mutedUsers = ['legacy'];
  await B.syncBlocks();
  assert.ok(sb.rows.has('legacy'));
  sb.rows.delete('legacy');
  await B.syncBlocks();
  assert.equal(act.isMuted('legacy'), false, 'once, not on every sync');
});

test('an announcement sender is blocked by the server, from the bell row id', async () => {
  const sb = fakeSb(); window.sb = sb;
  assert.equal((await B.blockAnnouncementAuthor('n1')).ok, true);
  assert.deepEqual(sb.ops.at(-1), ['block_announcement_author', { p_notification: 'n1' }]);
});

test('Block is offered where people are: the members sheet (threads, squad) and announcements', () => {
  const ms = readFileSync(join(JS, 'members-sheet.js'), 'utf8');
  assert.match(ms, />\$\{muted \? 'Blocked' : 'Block'\}<\/button>/);
  assert.doesNotMatch(ms, /'Mute'|Muted on this phone/);
  assert.match(ms, /blockUser\(id\)/);
  const squad = readFileSync(join(JS, 'screens', 'squad.js'), 'utf8');
  assert.match(squad, /openMembersSheet/, 'a teammate row opens the same sheet');
  const bell = readFileSync(join(JS, 'screens', 'notifications.js'), 'utf8');
  assert.match(bell, /data-block-announcement=/);
  assert.match(bell, /blockAnnouncementAuthor\(/);
});
