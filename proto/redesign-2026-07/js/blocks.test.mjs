/* Block (0244, G-R3): stored on the server, cached on the phone, offered where people are.
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

function fakeSb(serverRows = []) {
  const rows = new Set(serverRows);
  const ops = [];
  const table = {
    upsert: async (v) => { ops.push(['upsert', v]); (Array.isArray(v) ? v : [v]).forEach((r) => rows.add(r.blocked_id)); return { error: null }; },
    delete: () => ({ eq: () => ({ eq: async (_c, id) => { ops.push(['delete', id]); rows.delete(id); return { error: null }; } }) }),
    select: () => ({ eq: async () => ({ data: [...rows].map((id) => ({ blocked_id: id })), error: null }) }),
  };
  return { ops, rows, from: (t) => { assert.equal(t, 'user_blocks'); return table; }, rpc: async (fn, args) => { ops.push([fn, args]); return { data: true, error: null }; } };
}

test.beforeEach(() => { RT.userId = 'me'; RT.mutedUsers = []; });

test('Block hides at once (cache) and is stored on the server; Unblock undoes both', async () => {
  const sb = fakeSb(); window.sb = sb;
  await B.blockUser('coach');
  assert.equal(act.isMuted('coach'), true);
  assert.deepEqual(sb.ops[0], ['upsert', { blocker_id: 'me', blocked_id: 'coach' }]);
  await B.unblockUser('coach');
  assert.equal(act.isMuted('coach'), false);
  assert.deepEqual(sb.ops[1], ['delete', 'coach']);
  assert.equal((await B.blockUser('me')).ok, false, 'never yourself');
});

test('syncBlocks brings server blocks to this phone and old phone-only mutes to the server', async () => {
  const sb = fakeSb(['a']); window.sb = sb;
  RT.mutedUsers = ['legacy'];
  await B.syncBlocks();
  assert.equal(act.isMuted('a'), true);
  assert.ok(sb.rows.has('legacy'));
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
