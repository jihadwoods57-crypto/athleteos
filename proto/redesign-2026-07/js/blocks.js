/* Block, on this phone and on the server (0244, review pass 2026-09-23, G-R3, Guideline 1.2).
 *
 * "Mute" used to live only on this phone (RT.mutedUsers): lost on sign-out or reinstall, and the
 * muted person could still message and notify you. A block is now a user_blocks row, which the
 * server uses to hide their messages from your threads, stop their announcements, and drop their
 * pushes and nudges to you. RT.mutedUsers stays as the cache, so a message disappears the moment
 * Block is tapped, before any round trip.
 *
 * THE SERVER IS THE TRUTH (review I5). The cache is rebuilt from the server list on every sync;
 * the only thing this phone adds is its own PENDING operations (a block or unblock whose write has
 * not landed yet), kept in a small queue and replayed first. So an unblock made on another phone
 * sticks here too, and a sync that races an in-flight unblock waits for it instead of re-blocking.
 * Mutes from before blocks were stored are queued once, as adds.
 *
 * Loaded on demand (the members sheet, the bell), never at boot.
 */
import { RT, act } from './state.js';

const client = () => (typeof window !== 'undefined' ? window.sb : null);
const QKEY = (uid) => `os.blocks.pending.${uid}`;
const MKEY = (uid) => `os.blocks.migrated.${uid}`;
let INFLIGHT = Promise.resolve();

function readQueue(uid) {
  try { const q = JSON.parse(localStorage.getItem(QKEY(uid)) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeQueue(uid, q) {
  try { if (q.length) localStorage.setItem(QKEY(uid), JSON.stringify(q)); else localStorage.removeItem(QKEY(uid)); } catch { /* no storage */ }
}
/** Replace any queued op for `id` with this one. */
function enqueue(uid, op, id) {
  writeQueue(uid, [...readQueue(uid).filter((x) => x.id !== id), { op, id }]);
}

async function send(sb, uid, op, id) {
  try {
    if (op === 'add') {
      // insert, not upsert: the table grants insert/select/delete only, and a repeat is a 23505.
      const { error } = await sb.from('user_blocks').insert({ blocker_id: uid, blocked_id: id });
      // R2-M4: not a person id (22P02) or no such person (23503) will never land: drop it.
      if (error && (error.code === '22P02' || error.code === '23503')) return 'drop';
      return !error || error.code === '23505';
    }
    const { error } = await sb.from('user_blocks').delete().eq('blocker_id', uid).eq('blocked_id', id);
    return !error;
  } catch { return false; }
}

function run(uid, op, id) {
  const sb = client();
  const p = INFLIGHT.then(async () => {
    if (!sb) { enqueue(uid, op, id); return false; }
    const ok = await send(sb, uid, op, id);
    if (ok === true) writeQueue(uid, readQueue(uid).filter((x) => x.id !== id));
    else if (ok === 'drop') { writeQueue(uid, readQueue(uid).filter((x) => x.id !== id)); if (op === 'add') act.unmuteUser(id); }
    else enqueue(uid, op, id);
    return ok === true;
  });
  INFLIGHT = p.catch(() => false);
  return p;
}

/** Block `id`: hidden here at once, then stored on the server (queued if that fails). */
export async function blockUser(id) {
  const k = String(id || '');
  if (!k || !RT.userId || k === RT.userId) return { ok: false };
  act.muteUser(k);
  return { ok: await run(RT.userId, 'add', k) };
}

/** Unblock `id`: shown again at once, removed on the server (queued if that fails). */
export async function unblockUser(id) {
  const k = String(id || '');
  if (!k || !RT.userId) return { ok: false };
  act.unmuteUser(k);
  return { ok: await run(RT.userId, 'remove', k) };
}

/** Rebuild the cache from the server: replay this phone's pending ops, read the server list, and
 *  keep only what the server says plus whatever is STILL pending here. */
export async function syncBlocks() {
  const sb = client();
  const uid = RT.userId;
  if (!sb || !uid) return;
  await INFLIGHT;
  // One-time: mutes made before blocks were stored become pending adds.
  try {
    if (localStorage.getItem(MKEY(uid)) !== '1') {
      for (const id of RT.mutedUsers || []) if (id && id !== uid && !readQueue(uid).some((x) => x.id === id)) enqueue(uid, 'add', String(id));
      localStorage.setItem(MKEY(uid), '1');
    }
  } catch { /* no storage: nothing to migrate */ }
  for (const { op, id } of readQueue(uid)) await run(uid, op, id);
  await INFLIGHT;
  try {
    const { data, error } = await sb.from('user_blocks').select('blocked_id').eq('blocker_id', uid);
    if (error || !Array.isArray(data) || RT.userId !== uid) return;
    const list = new Set(data.map((r) => String(r.blocked_id)));
    for (const { op, id } of readQueue(uid)) { if (op === 'add') list.add(id); else list.delete(id); }
    for (const id of [...(RT.mutedUsers || [])]) if (!list.has(String(id))) act.unmuteUser(id);
    for (const id of list) if (!act.isMuted(id)) act.muteUser(id);
  } catch { /* the cache still hides; the next open tries again */ }
}

/** Block whoever posted the announcement behind a bell row. The server finds the author; this
 *  phone never learns who it was. */
export async function blockAnnouncementAuthor(notificationId) {
  const sb = client();
  if (!sb || !notificationId) return { ok: false };
  try {
    const { data, error } = await sb.rpc('block_announcement_author', { p_notification: notificationId });
    return { ok: !error && data === true };
  } catch { return { ok: false }; }
}
