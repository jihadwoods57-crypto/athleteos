/* What works for you, the pure half (goals and eating plan, A2, 2026-09-25).
 *
 * The athlete's own days, set side by side: on days a meal behaviour happened (a meal's protein
 * landed, every required meal came in, every meal came in on time), how did the check-in read,
 * against the days it did not? Shown on Progress, and in the Sunday recap when it is strong.
 * Honest and NON-CAUSAL: "On days X, your energy averaged 8 out of 10. On days you didn't, 5."
 * Deterministic text the app writes, never signed as Nia; never shown to a guardian.
 *
 * CHECK-IN POLARITY IS LOAD-BEARING (memory note, day.js CI_INVERSE). Soreness and cravings store
 * the honest raw answer, so a HIGH value is the bad pole there. This file never flips what is
 * stored: it reads `good = inverse ? 10 - raw : raw` to decide which side is better, exactly as
 * recovery-intel.js does, and prints the raw average the athlete answered.
 *
 * THRESHOLDS (spec A2 part 4): 10+ days carrying both a logged meal and a SUBMITTED check-in; each
 * side 3+ days; a gap of 1.5+ points on the stored 0-10 scale, in the better direction only (this
 * is "what works", so a behaviour that lines up with worse days is not offered as one). At most 2,
 * no behaviour and no check-in field twice.
 */
import { slotShare, SLOT_HIT } from './weekly-focus-model.js';

export const MIN_DAYS = 10;
export const MIN_SIDE = 3;
export const MIN_GAP = 1.5;
/** Strong enough to also ride the Sunday recap. */
export const STRONG_GAP = 2;
export const STRONG_SIDE = 4;

/** The fields read, with their polarity and how a sentence names them. `inverse` must equal
 *  day.js CI_INVERSE (pinned by what-works.test.mjs). */
export const FIELDS = {
  energy: { label: 'energy', inverse: false },
  recovery: { label: 'recovery', inverse: false },
  sleep: { label: 'sleep', inverse: false },
  confidence: { label: 'confidence', inverse: false },
  motivation: { label: 'motivation', inverse: false },
  soreness: { label: 'soreness', inverse: true },
};

/** The behaviours a day can show, for this athlete's slots. */
export function behaviours(order) {
  return [
    ...order.required.filter((k) => k !== 'snack').map((k) => ({ key: `protein:${k}`, slot: k })),
    { key: 'all' },
    { key: 'ontime' },
  ];
}

function did(b, d, { order, target }) {
  if (b.key.startsWith('protein:')) {
    const p = d.protein[b.slot];
    const share = slotShare(target, order);
    return !!d.logged[b.slot] && p != null && share > 0 && p >= share * SLOT_HIT;
  }
  if (b.key === 'all') return order.required.every((k) => d.logged[k]);
  if (b.key === 'ontime') {
    // Unknown timing (no logged-at stamp) is neither side: "one ran late" must be true.
    const t = order.required.filter((k) => d.logged[k]);
    if (!t.length || t.some((k) => d.onTime[k] == null)) return null;
    return t.every((k) => d.onTime[k] === true);
  }
  return false;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Every qualifying pair, strongest first. `days` are weekly-focus-model dayFacts; `fields` the
 * check-in keys this athlete is actually asked (DAY.ciConfig), since a field they are never asked
 * still stores its default and would compare a constant with itself.
 */
export function findPatterns(days, { order, target, fields = Object.keys(FIELDS) }) {
  const both = (days || []).filter((d) => d && d.anyMeal && d.ci);
  if (both.length < MIN_DAYS) return { eligible: both.length, patterns: [] };
  const out = [];
  for (const b of behaviours(order)) {
    for (const f of fields) {
      const F = FIELDS[f];
      if (!F) continue;
      const yes = [], no = [];
      for (const d of both) {
        const raw = d.ci[f];
        const r = raw == null ? null : did(b, d, { order, target });
        if (r == null) continue;
        (r ? yes : no).push(raw);
      }
      if (yes.length < MIN_SIDE || no.length < MIN_SIDE) continue;
      const good = (xs) => mean(xs.map((v) => (F.inverse ? 10 - v : v)));
      const gap = good(yes) - good(no);
      if (gap < MIN_GAP) continue;
      out.push({ behaviour: b.key, slot: b.slot || null, field: f, yes: mean(yes), no: mean(no), gap, nYes: yes.length, nNo: no.length });
    }
  }
  out.sort((a, b) => b.gap - a.gap || a.behaviour.localeCompare(b.behaviour) || a.field.localeCompare(b.field));
  return { eligible: both.length, patterns: out };
}

/** At most `max`, no behaviour and no field twice. */
export function topInsights(patterns, max = 2) {
  const used = new Set();
  const pick = [];
  for (const p of patterns) {
    if (pick.length >= max) break;
    if (used.has(`b:${p.behaviour}`) || used.has(`f:${p.field}`)) continue;
    used.add(`b:${p.behaviour}`); used.add(`f:${p.field}`);
    pick.push(p);
  }
  return pick;
}

export const isStrong = (p) => !!p && p.gap >= STRONG_GAP && p.nYes >= STRONG_SIDE && p.nNo >= STRONG_SIDE;

/**
 * The sentence. Numbers styles name the grams ("hit about 45g of protein"); an Intuitive athlete
 * gets plate words ("a palm of protein at breakfast"). The averages are the raw answers on the
 * stored 0-10 scale, so soreness reads the way it was answered (lower is less sore).
 */
export function insightText(p, { numbers, share = 0, titleOf = (k) => k }) {
  const f = FIELDS[p.field].label;
  // WHOLE NUMBERS ONLY WHEN THEY TELL THE TRUTH (review 2026-09-26): 6.4 vs 4.8 rounds to 6 vs 5, a
  // 1 point gap for a real 1.6. Whole numbers print only when their gap is 2 or more AND equals
  // the real gap rounded; otherwise both means print with one decimal ("6.4 ... 4.8").
  const real = Math.abs(p.yes - p.no);
  const whole = Math.abs(Math.round(p.yes) - Math.round(p.no));
  const fmt1 = (v) => (whole >= 2 && whole === Math.round(real) ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1));
  const y = fmt1(p.yes), n = fmt1(p.no);
  const tail = `your ${f} averaged ${y} out of 10`;
  if (p.behaviour.startsWith('protein:')) {
    const meal = String(titleOf(p.slot)).toLowerCase();
    const lead = numbers && share > 0 ? `On days your ${meal} hit about ${share}g of protein` : `On days you had a palm of protein at ${meal}`;
    return `${lead}, ${tail}. On days ${numbers && share > 0 ? 'it' : 'you'} didn't, ${n}.`;
  }
  if (p.behaviour === 'all') return `On days you logged every meal, ${tail}. On days you didn't, ${n}.`;
  return `On days every meal came in on time, ${tail}. On days one ran late, ${n}.`;
}
