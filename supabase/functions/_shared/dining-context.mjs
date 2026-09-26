// Nia knows today's dining hall menu (goals and eating plan, phase C, 2026-09-26).
//
// When staff have PUBLISHED a menu for today at one of the athlete's team halls (0255), meal-chat's
// context gets a compact list of today's remaining periods (dining-menu.mjs menuContextBlock: capped,
// figure-free for an Intuitive athlete, "never invent items" in the block itself). No model call:
// a few more input tokens on a call that was happening anyway, and nothing at all when there is no
// menu. Read with the SERVICE client for the meal OWNER (never a client-supplied id), and only for
// the athlete's own turns: a coach's device is not the athlete's clock or calendar.
//
// "Today" is the athlete's calendar day, from their device (state.js athleteContextForAnalysis
// localDate), accepted only within a day of the server's: a stale or forged date renders nothing.
// WHAT THEY CANNOT EAT NEVER REACHES NIA (review round 2026-09-26). Before the block is built, every
// item is passed through dining-menu.mjs itemAllowed, the SAME filter the athlete's plates use: its
// allergen tags against their declared allergies and intolerances ("contains nuts" covers a peanut
// allergy), its name against those rules, their dislikes (food_prefs) and the allergy facts memory
// has confirmed. What is left carries its printed allergen tags, compactly.
//
// A plain .mjs so `npm run test:fn` runs it in Node.
import { menuContextBlock, isIsoDate, addDays, itemAllowed, allergenKeysFrom } from './dining-menu.mjs';
import { avoidWords, namesAny, cleanFoodPrefs } from './food-prefs.mjs';

/** "3:40 PM" -> 940, or null. */
export function minuteOf(localTime) {
  const m = /^(1[0-2]|[1-9]):([0-5]\d) (AM|PM)$/.exec(String(localTime || '').trim().toUpperCase());
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0);
  return h * 60 + Number(m[2]);
}

/** The athlete's today, when their device's date is plausible (within a day of `serverNow`). */
export function athleteToday(athlete, serverNow = new Date()) {
  const d = athlete && typeof athlete === 'object' ? athlete.localDate : null;
  if (!isIsoDate(d)) return null;
  const utc = serverNow.toISOString().slice(0, 10);
  return d === utc || d === addDays(utc, -1) || d === addDays(utc, 1) ? d : null;
}

/** Today's published menus and their halls, for the athlete's active teams. Never throws. */
export async function loadDiningToday(service, athleteId, date) {
  try {
    if (!service || typeof athleteId !== 'string' || !athleteId || !isIsoDate(date)) return null;
    const { data: mem, error: e1 } = await service.from('team_members').select('team_id')
      .eq('athlete_id', athleteId).eq('status', 'active').limit(3);
    const teams = !e1 && Array.isArray(mem) ? mem.map((m) => m.team_id).filter(Boolean) : [];
    if (!teams.length) return null;
    const { data: menus, error: e2 } = await service.from('dining_menus').select('hall_id, period, items')
      .in('team_id', teams).eq('menu_date', date).eq('status', 'published').limit(40);
    if (e2 || !Array.isArray(menus) || !menus.length) return null;
    const ids = [...new Set(menus.map((m) => m.hall_id))];
    const { data: halls, error: e3 } = await service.from('dining_halls').select('id, name, hours').in('id', ids).order('name');
    if (e3 || !Array.isArray(halls)) return null;
    return { halls, menus };
  } catch {
    return null;
  }
}

/** The athlete's declared restrictions and their food preferences. Never throws; absent is empty. */
export async function loadAvoidFacts(service, athleteId) {
  const settle = async (p) => { try { const r = await p; return r && !r.error ? r.data : null; } catch { return null; } };
  const [rx, pr] = await Promise.all([
    settle(service.from('dietary_restrictions').select('data').eq('athlete_id', athleteId).maybeSingle()),
    settle(service.from('profiles').select('food_prefs').eq('id', athleteId).maybeSingle()),
  ]);
  return {
    restrictions: rx && rx.data && typeof rx.data === 'object' ? rx.data : null,
    prefs: cleanFoodPrefs(pr && pr.food_prefs),
  };
}

/**
 * The block for one athlete turn, or ''. `athlete` is the request's body.athlete (localDate and
 * localTime from the device); `planStyle` is the OWNER's resolved style. `extraAvoid` is the allergy
 * and dislike facts memory has confirmed (memory.ts avoidFromFacts).
 * @param {any} service
 * @param {string} athleteId
 * @param {any} athlete
 * @param {string | null} planStyle
 * @param {{ serverNow?: Date, extraAvoid?: string[] }} [opts]
 */
export async function diningContextFor(service, athleteId, athlete, planStyle, { serverNow = new Date(), extraAvoid = [] } = {}) {
  const date = athleteToday(athlete, serverNow);
  if (!date) return '';
  const [got, facts] = await Promise.all([loadDiningToday(service, athleteId, date), loadAvoidFacts(service, athleteId)]);
  if (!got) return '';
  const avoid = avoidWords(facts.prefs, facts.restrictions, extraAvoid);
  const allergens = allergenKeysFrom(facts.restrictions, extraAvoid);
  return menuContextBlock({
    keep: (it) => itemAllowed(it, { avoid, allergens, namesAny }),
    halls: got.halls,
    menus: got.menus,
    date,
    nowMin: minuteOf(athlete && athlete.localTime),
    intuitive: planStyle === 'intuitive',
  });
}
