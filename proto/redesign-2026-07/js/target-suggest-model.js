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
 *           perWeek, planRate } or null. Numbers only: the server (0253) re-derives the pace itself and
 *           the sentence is composed on the reader's device from the stored numbers (composeReason).
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

const fmtInt = (n) => Number(n).toLocaleString('en-US');
const isNum = (v) => typeof v === 'number' ? Number.isFinite(v) : (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v));
const PLANS = [PLAN.gain.rate, PLAN.lose.rate];

/** The headline a coach reads, both numbers: "3,000 to 3,200 cal", plus protein when it changes. */
export function changeHeadline(row) {
  const bits = [];
  const ck = Number(row.current_kcal), pk = Number(row.proposed_kcal);
  const cp = Number(row.current_protein), pp = Number(row.proposed_protein);
  if (pk !== ck) bits.push(`${fmtInt(ck)} to ${fmtInt(pk)} cal`);
  if (pp !== cp) bits.push(`${cp}g to ${pp}g protein`);
  return bits.join(' · ');
}

/** Every sentence composeReason can produce. Nothing else is ever shown for a suggestion. */
export const REASON_RE = /^((Gaining|Losing) \d+(\.\d)? lb a week|Holding steady) against a plan of (gaining |losing )?\d+(\.\d)?\. Suggest ([+-]\d+ calories|[+-]\d+g protein for the new bodyweight)( and [+-]\d+g protein for the new bodyweight)?\.$/;

/** The sentence, composed from the ROW's numbers (0253 stores numbers, never text). '' when any
 *  field is not a plain number or the plan is not one of ours: a tampered or stale row says nothing. */
export function composeReason(row) {
  const f = ['current_protein', 'proposed_protein', 'current_kcal', 'proposed_kcal', 'pace_lb_wk', 'plan_lb_wk'];
  if (!row || f.some((k) => !isNum(row[k]))) return '';
  const pace = Number(row.pace_lb_wk), plan = Number(row.plan_lb_wk);
  if (!PLANS.includes(plan)) return '';
  const dk = Math.round(Number(row.proposed_kcal) - Number(row.current_kcal));
  const dp = Math.round(Number(row.proposed_protein) - Number(row.current_protein));
  if (!dk && !dp) return '';
  const moving = pace > 0 ? `Gaining ${fmt1(pace)} lb a week` : pace < 0 ? `Losing ${fmt1(pace)} lb a week` : 'Holding steady';
  const sameWay = (pace > 0 && plan > 0) || (pace < 0 && plan < 0);
  const planText = sameWay ? `a plan of ${fmt1(plan)}` : `a plan of ${plan > 0 ? 'gaining' : 'losing'} ${fmt1(plan)}`;
  const asks = [];
  if (dk) asks.push(`${dk > 0 ? '+' : '-'}${Math.abs(dk)} calories`);
  if (dp) asks.push(`${dp > 0 ? '+' : '-'}${Math.abs(dp)}g protein for the new bodyweight`);
  const out = `${moving} against ${planText}. Suggest ${asks.join(' and ')}.`;
  return REASON_RE.test(out) ? out : '';
}

/** The same change for an Intuitive athlete: no figures, and worded by what actually changes. A
 *  protein-only change is about protein, never "more food" or "less food". */
export function composeIntuitive(row) {
  if (!row) return '';
  const dk = Number(row.proposed_kcal) - Number(row.current_kcal);
  const dp = Number(row.proposed_protein) - Number(row.current_protein);
  const pace = Number(row.pace_lb_wk), plan = Number(row.plan_lb_wk);
  const parts = [];
  if (dk) {
    const slower = pace < plan ? plan > 0 : pace > plan && plan < 0;
    parts.push(`Your weight is moving ${slower ? 'slower' : 'faster'} than your plan.`);
    parts.push(dk > 0 ? 'A little more food each day would help.' : 'A little less food each day would help.');
  }
  if (dp) parts.push(dp > 0 ? 'Your body has changed, so a bit more protein at each meal would help.' : 'Your body has changed, so a little less protein at each meal is enough.');
  return parts.join(' ');
}

/** True when the row's current numbers are still the athlete's live targets, for every live figure
 *  the reader knows ({ protein?, kcal? }). A figure the reader cannot know is left to the server. */
export function liveMatches(row, live) {
  const L = live || {};
  if (L.protein != null && Math.round(Number(L.protein)) !== Number(row.current_protein)) return false;
  if (L.kcal != null && Math.round(Number(L.kcal)) !== Number(row.current_kcal)) return false;
  return true;
}
