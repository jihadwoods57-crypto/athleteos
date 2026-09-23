/* Block, on this phone and on the server (0244, review pass 2026-09-23, G-R3, Guideline 1.2).
 *
 * "Mute" used to live only on this phone (RT.mutedUsers): lost on sign-out or reinstall, and the
 * muted person could still message and notify you. A block is now a user_blocks row, which the
 * server uses to hide their messages from your threads, stop their announcements, and drop their
 * pushes and nudges to you. RT.mutedUsers stays as the cache, so a message disappears the moment
 * Block is tapped, before any round trip.
 *
 * Loaded on demand (the members sheet, the bell), never at boot.
 */
import { RT, act } from './state.js';

const client = () => (typeof window !== 'undefined' ? window.sb : null);

/** Block `id`: hidden here at once, then stored on the server. Resolves { ok } (the cache holds
 *  either way; a failed write is retried by the next syncBlocks). */
export async function blockUser(id) {
  const k = String(id || '');
  if (!k || k === RT.userId) return { ok: false };
  act.muteUser(k);
  const sb = client();
  if (!sb || !RT.userId) return { ok: false };
  try {
    const { error } = await sb.from('user_blocks').upsert({ blocker_id: RT.userId, blocked_id: k }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
    return { ok: !error };
  } catch { return { ok: false }; }
}

/** Unblock `id`, here and on the server. */
export async function unblockUser(id) {
  const k = String(id || '');
  if (!k) return { ok: false };
  act.unmuteUser(k);
  const sb = client();
  if (!sb || !RT.userId) return { ok: false };
  try {
    const { error } = await sb.from('user_blocks').delete().eq('blocker_id', RT.userId).eq('blocked_id', k);
    return { ok: !error };
  } catch { return { ok: false }; }
}

/** Bring the cache and the server into one list: server blocks land on this phone, and a mute
 *  made on this phone before blocks were stored (or while offline) is written to the server. */
export async function syncBlocks() {
  const sb = client();
  if (!sb || !RT.userId) return;
  try {
    const { data, error } = await sb.from('user_blocks').select('blocked_id').eq('blocker_id', RT.userId);
    if (error || !Array.isArray(data)) return;
    const server = new Set(data.map((r) => String(r.blocked_id)));
    for (const id of server) if (!act.isMuted(id)) act.muteUser(id);
    const localOnly = (RT.mutedUsers || []).filter((id) => id && !server.has(String(id)) && id !== RT.userId);
    if (localOnly.length) {
      await sb.from('user_blocks').upsert(localOnly.map((id) => ({ blocker_id: RT.userId, blocked_id: id })),
        { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
    }
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
