/* Today's published dining-hall menus, on the athlete's device (goals and eating plan, phase C).
 *
 * Plan > Today asks for them once per open of the day (a short TTL after that), for an athlete on a
 * team only: a solo athlete or a trainer's client has no halls, so they never pay the round trip.
 * The database decides what is readable (0255: the team's athletes read PUBLISHED rows only); the
 * query also names the date and the status, so a stale cache can never show a draft or yesterday.
 * Lazy: plan-today.js imports this, and plan-today.js is itself a dynamic import.
 */
import { RT } from './state.js';
import { buildHallPlates } from './dining-plate-model.js';

const TTL = 10 * 60 * 1000;
let MENU = { key: null, at: 0, state: 'idle', halls: [], menus: [] };

/** The athlete's local calendar date (the hall's "today"). */
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const teamId = () => (RT.myCoach && RT.myCoach.teamId) || null;
const keyFor = (date) => `${RT.userId}|${teamId()}|${date}`;

let INFLIGHT = null;

/** True when Plan should wait for a read before deciding anything that depends on the hall (an
 *  athlete on a team whose today's read is missing, stale, or in flight). */
export function hallMenusDue(sb = (typeof window !== 'undefined' ? window.sb : null)) {
  if (!RT.userId || !teamId() || !sb) return false;
  const key = keyFor(localToday());
  return !(MENU.key === key && MENU.state !== 'loading' && Date.now() - MENU.at < TTL);
}

/** Read today's published menus and their halls. Resolves true when what Plan can show changed. A
 *  second caller while a read is in flight waits for that read (and resolves false). */
export async function loadHallMenus(sb = window.sb) {
  const date = localToday();
  const key = keyFor(date);
  if (!RT.userId || !teamId() || !sb) return false;
  if (MENU.key === key && MENU.state === 'loading' && INFLIGHT) { await INFLIGHT.catch(() => {}); return false; }
  if (MENU.key === key && Date.now() - MENU.at < TTL) return false;
  INFLIGHT = readMenus(sb, date, key);
  try { return await INFLIGHT; } finally { INFLIGHT = null; }
}

async function readMenus(sb, date, key) {
  const before = JSON.stringify([MENU.halls, MENU.menus]);
  MENU = { ...MENU, key, state: 'loading' };
  try {
    const { data: menus, error } = await sb.from('dining_menus').select('hall_id, menu_date, period, status, items')
      .eq('team_id', teamId()).eq('menu_date', date).eq('status', 'published');
    if (error) throw error;
    const rows = Array.isArray(menus) ? menus : [];
    let halls = [];
    const ids = [...new Set(rows.map((r) => r.hall_id).filter(Boolean))];
    if (ids.length) {
      const { data, error: e2 } = await sb.from('dining_halls').select('id, name, hours').in('id', ids);
      if (e2) throw e2;
      halls = Array.isArray(data) ? data : [];
    }
    if (MENU.key !== key) return false;
    MENU = { key, at: Date.now(), state: 'done', halls, menus: rows };
  } catch {
    // Offline or a pre-0255 database: no dining-hall ideas, and a later open may ask again.
    if (MENU.key === key) MENU = { key, at: Date.now() - TTL + 60_000, state: 'error', halls: [], menus: [] };
  }
  return JSON.stringify([MENU.halls, MENU.menus]) !== before;
}

/** Up to two dining-hall plates for `slot`, or [] (not today, no menu, closed, nothing safe). */
export function hallIdeas({ slot, dayDate, dueMin = null, nowMin = null, target = {}, avoid = [], allergens = [] }) {
  const date = localToday();
  if (!slot || String(dayDate) !== date || MENU.key !== keyFor(date)) return [];
  return buildHallPlates({ halls: MENU.halls, menus: MENU.menus, date, slot, dueMin, nowMin, target, avoid, allergens, max: 2 });
}

/* Tests and the screenshot harness only. */
export function _seedHallMenus({ halls = [], menus = [] } = {}) {
  MENU = { key: keyFor(localToday()), at: Date.now(), state: 'done', halls, menus };
}
export function _resetHallMenus() { MENU = { key: null, at: 0, state: 'idle', halls: [], menus: [] }; }
