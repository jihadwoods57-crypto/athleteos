/* Adaptive targets, the pure half (goals and eating plan, phase B, 2026-09-26).
 *
 * When a gaining or losing adult's weight is moving off the plan's pace, the device files ONE
 * "Suggested change" (0253 target_suggestions) and a coach approves it, or a solo athlete accepts
 * it themselves. Everything here is deterministic: no model, no clock of its own (the caller passes
 * today), no DOM. target-suggest.js does the reading, filing and drawing.
 *
 * THE PACE. S.weight.pace (state.js) is a direction check: is the latest weigh-in nearer the goal
 * weight than the first one. It reads the same data this does (DAY.scoreHistory's weigh-ins plus
 * today's), but it has no rate, so it cannot say "0.2 lb a week against a plan of 0.5". This reads
 * those same weigh-ins WITH their dates and fits a straight line through the last 21 days.
 *
 * THE RULES (pinned by target-suggest.test.mjs)
 *  - adults only (a provable minor gets nothing, and the database refuses it too);
 *  - a gain or lose goal only;
 *  - at least 3 weigh-ins spanning at least 10 days, inside the last 21;
 *  - at most one every 14 days, counted from the later of when the last one was made and decided;
 *  - off the plan by more than the tolerance: calories move 150, 200 or 250 by how far off, never
 *    below the 1500 floor; gaining slower is +, losing slower is -, too fast either way goes back
 *    toward the plan;
 *  - protein moves only when the bodyweight has moved the per-pound target by 10g or more.
 */

/** The plan's pace in lb a week, and how far off it may run before anything is suggested. */
export const PLAN = {
  gain: { rate: 0.5, tolerance: 0.15, perLb: 1.0 },
  lose: { rate: -1.0, tolerance: 0.25, perLb: 0.9 },
};
export const CAL_FLOOR = 1500;
export const PROTEIN_FLOOR = 80;
export const WINDOW_DAYS = 21;
export const MIN_WEIGH_INS = 3;
export const MIN_SPAN_DAYS = 10;
export const CADENCE_DAYS = 14;
export const PROTEIN_MOVE_G = 10;

const DAY_MS = 86400000;
const dayNum = (iso) => Math.round(Date.parse(`${String(iso).slice(0, 10)}T12:00:00Z`) / DAY_MS);
const round1 = (n) => Math.round(n * 10) / 10;
const fmt1 = (n) => { const r = round1(Math.abs(n)); return Number.isInteger(r) ? String(r) : r.toFixed(1); };

/** Goal family for this feature: 'gain' | 'lose' | null (every other goal gets no suggestion). */
export function suggestFamily(goal) {
  const k = String(goal || '').toLowerCase();
  if (k === 'gain' || k === 'build' || k === 'gain_muscle' || k === 'gain_weight') return 'gain';
  if (k === 'lose' || k === 'lose_fat') return 'lose';
  return null;
}

/** The dated weigh-ins inside the window: [{ day, lb }] oldest first, one per date (the last wins). */
export function weighIns(rows, todayISO) {
  const today = dayNum(todayISO);
  const byDay = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.date) continue;
    const lb = Number(r.weight);
    if (!Number.isFinite(lb) || lb < 70 || lb > 450) continue;
    const d = dayNum(r.date);
    if (!Number.isFinite(d) || d > today || today - d > WINDOW_DAYS) continue;
    byDay.set(d, lb);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, lb]) => ({ day, lb }));
}

/** Least-squares pace in lb a week, or null without enough data. */
export function paceOf(points) {
  const p = Array.isArray(points) ? points : [];
  if (p.length < MIN_WEIGH_INS) return null;
  const span = p[p.length - 1].day - p[0].day;
  if (span < MIN_SPAN_DAYS) return null;
  const n = p.length;
  const mx = p.reduce((a, x) => a + x.day, 0) / n;
  const my = p.reduce((a, x) => a + x.lb, 0) / n;
  let num = 0, den = 0;
  for (const x of p) { num += (x.day - mx) * (x.lb - my); den += (x.day - mx) ** 2; }
  if (!den) return null;
  return { perWeek: round1((num / den) * 7), span, latest: p[n - 1].lb };
}

/** Calories to move for how far off the plan the pace is, or 0 inside the tolerance. */
export function calorieStep(family, perWeek) {
  const plan = PLAN[family];
  if (!plan || perWeek == null) return 0;
  const gap = round1(Math.abs(perWeek - plan.rate));
  if (gap <= plan.tolerance) return 0;
  const size = gap <= plan.tolerance + 0.1 + 1e-9 ? 150 : gap <= plan.tolerance + 0.3 + 1e-9 ? 200 : 250;
  // Below the plan's rate (gaining slower, or losing faster than planned) means more food; above it
  // (gaining faster, or losing slower / gaining on a lose goal) means less.
  return perWeek < plan.rate ? size : -size;
}

/** The per-pound protein target at a bodyweight, rounded like state.js goalDerivedTargets. */
const proteinAt = (family, lb) => Math.max(PROTEIN_FLOOR, Math.round((lb * PLAN[family].perLb) / 5) * 5);

/** Days since an ISO timestamp or date, on the caller's today. */
const daysSince = (iso, todayISO) => dayNum(todayISO) - dayNum(iso);

function reasonText(family, perWeek, calDelta, proteinDelta) {
  const plan = PLAN[family];
  const moving = perWeek > 0 ? `Gaining ${fmt1(perWeek)} lb a week` : perWeek < 0 ? `Losing ${fmt1(perWeek)} lb a week` : 'Holding steady';
  const sameWay = (perWeek > 0 && plan.rate > 0) || (perWeek < 0 && plan.rate < 0);
  const planText = sameWay ? `a plan of ${fmt1(plan.rate)}` : `a plan of ${plan.rate > 0 ? 'gaining' : 'losing'} ${fmt1(plan.rate)}`;
  const asks = [];
  if (calDelta) asks.push(`${calDelta > 0 ? '+' : '-'}${Math.abs(calDelta)} calories`);
  if (proteinDelta) asks.push(`${proteinDelta > 0 ? '+' : '-'}${Math.abs(proteinDelta)}g protein for the new bodyweight`);
  return `${moving} against ${planText}. Suggest ${asks.join(' and ')}.`;
}

/**
 * The suggestion for today, or null. Every input is plain data:
 *   goal        the athlete's base goal (any stored spelling)
 *   minor       a PROVABLE minor (unknown age is an adult, 0050)
 *   rows        [{ date, weight }] the dated weigh-ins (DAY.scoreHistory + today)
 *   current     { protein, kcal } the targets graded today (DAY.proteinTarget / DAY.calTarget)
 *   basisLb     the bodyweight today's protein target reflects (state.js goalBodyweight)
 *   lastAt      ISO of the later of the last suggestion's created_at / decided_at, or null
 *   todayISO    'YYYY-MM-DD'
 * Returns { currentProtein, currentKcal, proposedProtein, proposedKcal, calDelta, proteinDelta,
 *           perWeek, planRate, reason } or null.
 */
export function suggestTargets({ goal, minor = false, rows = [], current = {}, basisLb = null, lastAt = null, todayISO } = {}) {
  if (minor) return null;
  const family = suggestFamily(goal);
  if (!family || !todayISO) return null;
  if (lastAt && daysSince(lastAt, todayISO) < CADENCE_DAYS) return null;
  const cp = Math.round(Number(current.protein)), ck = Math.round(Number(current.kcal));
  if (!(cp > 0) || !(ck > 0)) return null;
  const pace = paceOf(weighIns(rows, todayISO));
  if (!pace) return null;

  // A number already under the floor was a coach's deliberate call: the pace never moves it.
  const step = ck >= CAL_FLOOR ? calorieStep(family, pace.perWeek) : 0;
  const proposedKcal = step ? Math.max(CAL_FLOOR, ck + step) : ck;
  const calDelta = proposedKcal - ck;

  let proteinDelta = 0;
  const basis = Number(basisLb);
  if (basis > 0) {
    const d = proteinAt(family, pace.latest) - proteinAt(family, basis);
    if (Math.abs(d) >= PROTEIN_MOVE_G) proteinDelta = d;
  }
  const proposedProtein = Math.max(40, Math.min(500, cp + proteinDelta));
  proteinDelta = proposedProtein - cp;

  if (!calDelta && !proteinDelta) return null;
  return {
    currentProtein: cp, currentKcal: ck, proposedProtein, proposedKcal, calDelta, proteinDelta,
    perWeek: pace.perWeek, planRate: PLAN[family].rate,
    reason: reasonText(family, pace.perWeek, calDelta, proteinDelta),
  };
}

/** A suggestion row is live when it is pending and younger than 14 days (older ones expire). */
export function isLive(row, todayISO) {
  return !!(row && row.status === 'pending' && row.created_at && daysSince(row.created_at, todayISO) < CADENCE_DAYS);
}

/** The latest moment that counts for the cadence: the later of created and decided. */
export function lastMoment(row) {
  if (!row) return null;
  const c = row.created_at || null, d = row.decided_at || null;
  if (!c) return d;
  if (!d) return c;
  return Date.parse(d) > Date.parse(c) ? d : c;
}

/** The compact headline a coach reads: "+200 cal", "+200 cal · +10g protein". */
export function changeHeadline(row) {
  const bits = [];
  const dk = Number(row.proposed_kcal) - Number(row.current_kcal);
  const dp = Number(row.proposed_protein) - Number(row.current_protein);
  if (dk) bits.push(`${dk > 0 ? '+' : '-'}${Math.abs(dk)} cal`);
  if (dp) bits.push(`${dp > 0 ? '+' : '-'}${Math.abs(dp)}g protein`);
  return bits.join(' · ');
}

/** What approval writes through coach_set_goals: the athlete's CURRENT targets (plan style,
 *  overrides, weight all kept) with the two numbers replaced. coach_set_goals replaces the whole
 *  JSON, so starting from anything less would wipe what the coach set before. A self-accepted
 *  marker is dropped: once a coach approves, the numbers are theirs. */
export function approvedTargets(existing, row) {
  const next = { ...(existing && typeof existing === 'object' ? existing : {}) };
  delete next.source;
  next.protein = Number(row.proposed_protein);
  next.calories = Number(row.proposed_kcal);
  return next;
}
