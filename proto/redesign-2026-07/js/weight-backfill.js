/* The athlete's own weight reaches athlete_profiles.base_weight (goals and eating plan, D review).
 *
 * WHY. Measured on prod 2026-09-26: 30 of 30 athletes with a goal had no base_weight. The current
 * onboarding (ob2) never asks for a weight; only the retired one did (persistOnboarding still saves
 * ob.currentWeight when an old scratch carries it). With no stored weight, everything that reads
 * athlete_profiles (the coach's reconstruction, 0256's challenge targets) fell to the 171 lb
 * stand-in while the phone graded with the athlete's weigh-in.
 *
 * WHAT. Once per account, after the day loads: when the server CONFIRMS no base weight is stored
 * (athlete_plan_meta answers, base_weight null) and this phone holds a weight (the onboarding
 * answer, today's weigh-in, or the latest of the last 90 days), save it through the 0181
 * set_my_base_weight door, which writes the caller's own row only (auth.uid()). A failed or
 * missing read writes nothing, so a stored weight is never overwritten. A minor still waiting on
 * guardian consent is skipped: the same rule that holds their day sync (0050). The 0103 weight wall
 * is unchanged: base_weight is still read by staff only through the redacting plan-meta door.
 * Lazy: state.js imports it from _afterDayLoad.
 */
import { RT, S } from './state.js';
import { DAY } from './day.js';

const KEY = (uid) => `os.bwBackfill.${uid}`;
const store = () => { try { return window.localStorage; } catch { return null; } };

/** The weight this phone holds for the athlete, in goalBodyweight's order, or null. */
export function deviceWeight() {
  const ob = RT.ob && Number(RT.ob.currentWeight);
  if (ob > 0) return ob;
  const today = DAY.currentWeight != null ? Number(DAY.currentWeight) : 0;
  if (today > 0) return today;
  const last = DAY.lastWeight && Number(DAY.lastWeight.weight);
  return last > 0 ? last : null;
}

/** Save the device's weight as base_weight when none is stored. true when it wrote. */
export async function backfillBaseWeight(sb = typeof window !== 'undefined' ? window.sb : null) {
  const uid = RT.userId;
  if (!sb || !uid || (RT.authRole && RT.authRole !== 'athlete')) return false;
  const st = store();
  try { if (st && st.getItem(KEY(uid))) return false; } catch { /* no memory: the server read decides */ }
  if (RT.profile && Number(RT.profile.baseWeight) > 0) return false;
  let minorWaiting = false;
  try { minorWaiting = !!(S.consent && S.consent.needed); } catch { minorWaiting = true; }
  if (minorWaiting) return false;
  const w = deviceWeight();
  if (!(w >= 40 && w <= 1000)) return false;
  try {
    const { data, error } = await sb.rpc('athlete_plan_meta', { athlete: uid });
    if (error || !Array.isArray(data) || !data.length) return false;
    if (data[0].base_weight != null) {
      try { if (st) st.setItem(KEY(uid), '1'); } catch { /* fine */ }
      return false;
    }
    const lb = Math.round(w);
    const res = await sb.rpc('set_my_base_weight', { w: lb });
    if (res.error || RT.userId !== uid) return false;
    try { if (st) st.setItem(KEY(uid), '1'); } catch { /* fine */ }
    RT.profile = { ...(RT.profile || {}), baseWeight: lb };
    return true;
  } catch { return false; }
}
