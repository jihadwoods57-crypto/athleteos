/* This week's focus and the Sunday recap, the pure half (goals and eating plan, A2, 2026-09-25).
 *
 * Home gets ONE thing to work on this week, picked on the device from the athlete's own last 14
 * days: the weakest of protein at each meal, missed meals, logging late, and (when the standard
 * requires it) the snack. It stays put for the ISO week. Under it, on Sunday and Monday morning,
 * one quiet line recaps the week. Everything here is deterministic text the app writes; nothing
 * is signed as Nia, and nothing costs a model call.
 *
 * THE RULES THIS FILE HOLDS
 *  1. ONE SLOT MODEL, ONE DIVISION. The meals are plan-today-model's slotOrder (the standard's own
 *     slots, else the classic day) and a meal's protein share is perMealShare(target, required),
 *     the same split Plan and Nia's opener quote.
 *  2. EVIDENCE ONLY. A meal counts when it scored (a duplicate photo does not, day.js mealScored);
 *     its protein counts only once the read landed (not pending, not failed).
 *  3. ENOUGH DATA OR NOTHING. A candidate needs 5 days of its own data; with fewer than 5 logged
 *     days overall there is no focus at all.
 *  4. NUMBERS ARE PER STYLE. An Intuitive athlete gets the same focus in plate words and a
 *     tracker with no grams in it.
 */
import { perMealShare } from './plan-today-model.js';

export const WINDOW_DAYS = 14;
export const MIN_DAYS = 5;
/** A meal "hit" its protein when it carried at least this share of its even split. The split is
 *  an estimate rounded to 5g, so one meal at 90% of it is on pace. */
export const SLOT_HIT = 0.9;

/* ---------------- dates (ISO strings, parsed at UTC noon, no clock of their own) ---------------- */
const noon = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
const isoOf = (d) => d.toISOString().slice(0, 10);
export function addDays(iso, n) { const d = noon(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); }
/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(iso) { return (noon(iso).getUTCDay() + 6) % 7; }
/** The ISO week key ('2026-W30') a date belongs to. */
export function isoWeekKey(iso) {
  const d = noon(iso);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));   // the Thursday of this week
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4, 12));
  const w = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
/** Monday..Sunday of the week `iso` sits in. */
export function weekDates(iso) {
  const mon = addDays(iso, -weekdayIndex(iso));
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/* ---------------- one day, as facts ---------------- */
const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
/** Check-in fields a day can carry, the engine's keys. */
export const CI_FIELDS = ['energy', 'recovery', 'sleep', 'confidence', 'soreness', 'motivation', 'digestion', 'cravings'];

/**
 * A day's facts from a history row ({ date, meals, checkin, score }) or the live day in the same
 * shape. `ctx.order` is slotOrder(std); `ctx.deadline(k)` the minute a slot is due, grace included.
 * null for a row that carries no meals (the light far-history rows).
 */
export function dayFacts(row, ctx) {
  if (!row || !row.meals) return null;
  const ck = row.checkin && typeof row.checkin === 'object' ? row.checkin : {};
  const sm = ck.slotMacros && typeof ck.slotMacros === 'object' ? ck.slotMacros : {};
  const at = ck.mealLoggedAt && typeof ck.mealLoggedAt === 'object' ? ck.mealLoggedAt : {};
  const due = ctx && typeof ctx.deadline === 'function' ? ctx.deadline : () => 1440;
  const logged = {}, protein = {}, onTime = {};
  let dayProtein = 0;
  for (const k of ctx.order.all) {
    const m = sm[k] || {};
    const scored = !!row.meals[k] && m.flagged !== 'dup';
    logged[k] = scored;
    const p = scored && !m.pending && !m.analysisFailed ? num(m.protein) : null;
    protein[k] = p;
    if (p != null) dayProtein += p;
    const t = scored ? num(at[k]) : null;
    onTime[k] = t == null ? null : t <= due(k);
  }
  // A check-in counts only once it was SUBMITTED: an unsubmitted row still carries the defaults.
  let ci = null;
  if (ck.submitted) {
    ci = {};
    for (const f of CI_FIELDS) { const v = num(ck[f]); if (v != null) ci[f] = Math.max(0, Math.min(10, v)); }
  }
  return {
    date: String(row.date || '').slice(0, 10),
    logged, protein, onTime, dayProtein,
    anyMeal: Object.values(logged).some(Boolean),
    score: num(row.score),
    ci,
  };
}

/* ---------------- the candidates ---------------- */
const snackKey = (order) => order.required.find((k) => k === 'snack') || null;
const proteinSlots = (order) => order.required.filter((k) => k !== 'snack');

/** Every candidate this athlete's day has, in tie-break order. */
export function candidates(order) {
  const out = proteinSlots(order).map((k) => `protein:${k}`);
  out.push('missed', 'late');
  if (snackKey(order)) out.push('snack');
  return out;
}

/** The protein a required meal should carry: the day's target split evenly over them. */
export function slotShare(target, order) {
  return target > 0 ? perMealShare(target, order.required.length) : 0;
}

/**
 * One candidate's record over `days` (dayFacts). `n` is how many days carry its data, `rate` the
 * share that went right (0..1), plus what the copy quotes.
 */
export function candidateStats(key, days, { order, target }) {
  const list = (days || []).filter(Boolean);
  if (key.startsWith('protein:')) {
    const k = key.slice(8);
    const share = slotShare(target, order);
    const vals = list.map((d) => d.protein[k]).filter((p) => p != null);
    const hits = share > 0 ? vals.filter((p) => p >= share * SLOT_HIT).length : 0;
    return { key, slot: k, n: vals.length, rate: vals.length && share > 0 ? hits / vals.length : null, avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, share };
  }
  const active = list.filter((d) => d.anyMeal);
  if (key === 'missed') {
    const missedBy = {};
    let missed = 0;
    for (const d of active) for (const k of order.required) if (!d.logged[k]) { missed++; missedBy[k] = (missedBy[k] || 0) + 1; }
    const total = active.length * order.required.length;
    return { key, n: active.length, rate: total ? 1 - missed / total : null, missed, missedBy };
  }
  if (key === 'late') {
    let timed = 0, late = 0, days = 0;
    for (const d of active) {
      const t = order.required.filter((k) => d.onTime[k] != null);
      if (t.length) days++;
      timed += t.length;
      late += t.filter((k) => d.onTime[k] === false).length;
    }
    return { key, n: days, rate: timed ? 1 - late / timed : null, late, timed };
  }
  if (key === 'snack') {
    const s = snackKey(order);
    const had = active.filter((d) => d.logged[s]).length;
    return { key, slot: s, n: active.length, rate: active.length ? had / active.length : null, had };
  }
  return { key, n: 0, rate: null };
}

/** The weakest candidate with at least MIN_DAYS of its own data; ties keep the candidate order.
 *  null when nothing qualifies. */
export function pickFocus(days, ctx) {
  let best = null;
  for (const key of candidates(ctx.order)) {
    const s = candidateStats(key, days, ctx);
    if (s.n < MIN_DAYS || s.rate == null) continue;
    if (!best || s.rate < best.rate) best = s;
  }
  return best ? best.key : null;
}

/** How many of `days` carry any logged meal (the "enough to pick" gate). */
export const loggedDays = (days) => (days || []).filter((d) => d && d.anyMeal).length;

/**
 * The focus for this ISO week, stable once chosen. `stored` is what this phone kept
 * ({ week, key, tips }); it stands for the whole week unless its candidate has no data at all,
 * which is the only case that picks again. Returns { key, stored } (the record to keep) or
 * { key: null } when there is too little data.
 */
export function resolveFocus({ stored, days, ctx, todayISO }) {
  const week = isoWeekKey(todayISO);
  const same = stored && stored.week === week && typeof stored.key === 'string';
  if (same && candidates(ctx.order).includes(stored.key) && candidateStats(stored.key, days, ctx).n > 0) {
    return { key: stored.key, stored };
  }
  if (loggedDays(days) < MIN_DAYS) return { key: null, stored: same ? stored : null };
  const key = pickFocus(days, ctx);
  if (!key) return { key: null, stored: same ? stored : null };
  return { key, stored: { week, key, tips: same && stored.key === key && Array.isArray(stored.tips) ? stored.tips : [] } };
}

/* ---------------- the words ---------------- */
const lower = (s) => String(s || '').toLowerCase();

/**
 * The card's title and its one line of why, with a real number for a numbers style.
 * `titleOf(slot)` names a slot ("Breakfast"); `numbers` is showMacros.
 */
export function focusCopy(stats, { numbers, titleOf = (k) => k }) {
  const steady = stats.rate != null && stats.rate >= 0.85;
  if (stats.key.startsWith('protein:')) {
    const t = titleOf(stats.slot);
    const meal = lower(t);
    if (!numbers) {
      return {
        title: `A palm of protein at ${meal}`,
        why: steady ? `You have it at most ${meal}s. Keep it there this week.` : `${t} is the meal that most often comes up light on protein. Fixing it makes the rest of the day easier.`,
      };
    }
    return {
      title: `Protein at ${meal}`,
      why: steady
        ? `${t}s average ${stats.avg}g, right where they should be. Keep it there this week.`
        : `${t}s average ${stats.avg}g. About ${stats.share}g there makes the rest of the day easier to land.`,
    };
  }
  if (stats.key === 'missed') {
    const most = Object.entries(stats.missedBy || {}).sort((a, b) => b[1] - a[1])[0];
    const where = most ? `, most often ${lower(titleOf(most[0]))}` : '';
    return {
      title: 'Every meal in',
      why: stats.missed
        ? `You missed ${stats.missed} required meal${stats.missed === 1 ? '' : 's'} in two weeks${where}. Every meal you log is fuel and a full score.`
        : 'Every required meal made it in. Keep the streak going this week.',
    };
  }
  if (stats.key === 'late') {
    return {
      title: 'Log meals on time',
      why: stats.late
        ? `${stats.late} of your last ${stats.timed} meals came in after the window closed. On time keeps your score whole and your day on a rhythm.`
        : 'Your meals have been coming in on time. Keep that rhythm this week.',
    };
  }
  if (stats.key === 'snack') {
    return {
      title: 'Your snack, every day',
      why: `Your snack made it in on ${stats.had} of the last ${stats.n} days. It is part of your standard, and it carries you to the next meal.`,
    };
  }
  return { title: '', why: '' };
}

/** Three tips per focus, checkable. No figures, so every style reads them. */
export function focusTips(key) {
  if (key === 'protein:breakfast') return ['Add eggs or Greek yogurt to what you already eat.', 'Keep a shake ready for mornings you are rushed.', 'Plan breakfast the night before on Plan.'];
  if (key === 'protein:lunch') return ['Build lunch around a real protein: chicken, tuna, turkey or beans.', 'Double the meat when you order a bowl or a sandwich.', 'Pack lunch the night before when the day is tight.'];
  if (key === 'protein:dinner') return ['Put the protein on the plate first, then fill the rest.', 'Cook a little extra so tomorrow is covered too.', 'A glass of milk or a yogurt after dinner tops it up.'];
  if (key.startsWith('protein:')) return ['Put the protein on the plate first.', 'Keep an easy option on hand: a shake, jerky or yogurt.', 'Plan this meal ahead on Plan.'];
  if (key === 'missed') return ['Plan tomorrow on Plan before bed.', 'Pick one go-to meal for the one you miss most.', 'Short on time? Snap whatever you eat. It still counts.'];
  if (key === 'late') return ['Snap the photo before the first bite.', 'Know when each window closes: it is on Plan.', 'Running late? Log it anyway. Late still counts.'];
  if (key === 'snack') return ['Keep a snack in your bag: a bar, fruit or jerky.', 'Tie it to something you already do, like the walk home from practice.', 'Pick one with protein in it so it carries you further.'];
  return [];
}

/** What "Ask Nia why this matters" types into the chat (not sent). */
export function askQuestion(stats, { numbers, titleOf = (k) => k }) {
  if (stats.key.startsWith('protein:')) {
    const meal = lower(titleOf(stats.slot));
    return numbers ? `Why does protein at ${meal} matter so much for my goal?` : `Why does a palm of protein at ${meal} matter for my goal?`;
  }
  if (stats.key === 'missed') return 'Why does getting every meal in matter so much for my goal?';
  if (stats.key === 'late') return 'Why does eating on time matter for my goal?';
  return 'Why does my snack matter for my goal?';
}

/**
 * Did one day go right for this focus? true / false, or null when the day holds no evidence
 * either way (the protein read has not landed). `final` is false for today while it is open:
 * a miss is not a miss until the day is over, so today reads 'open' until it is a hit.
 */
export function dayHit(key, d, { order, target }) {
  if (!d) return false;
  if (key.startsWith('protein:')) {
    const k = key.slice(8);
    if (!d.logged[k]) return false;
    const p = d.protein[k];
    if (p == null) return null;
    return p >= slotShare(target, order) * SLOT_HIT;
  }
  if (key === 'missed') return order.required.every((k) => d.logged[k]);
  if (key === 'late') {
    const t = order.required.filter((k) => d.logged[k]);
    if (!t.length) return false;
    return t.every((k) => d.onTime[k] !== false);
  }
  if (key === 'snack') { const s = snackKey(order); return !!(s && d.logged[s]); }
  return false;
}

/** Monday..Sunday for the week `todayISO` is in: 'hit' | 'miss' | 'open' (today, not yet) |
 *  'future'. `byDate` maps an ISO date to its dayFacts (today's included). */
export function tracker(key, byDate, { order, target, todayISO }) {
  return weekDates(todayISO).map((date, i) => {
    const label = ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i];
    if (date > todayISO) return { date, label, state: 'future' };
    const h = dayHit(key, byDate[date] || null, { order, target });
    if (date === todayISO) return { date, label, state: h === true ? 'hit' : 'open' };
    return { date, label, state: h === true ? 'hit' : 'miss' };
  });
}

/* ---------------- the Sunday recap ---------------- */

/** Sunday all day, and Monday until noon. `dow` 0=Mon..6=Sun, `minute` since midnight. */
export function recapDue(todayISO, minute) {
  const d = weekdayIndex(todayISO);
  return d === 6 || (d === 0 && minute < 720);
}

/** The week a recap covers: this one on Sunday, the one before on Monday. */
export function recapWeek(todayISO) {
  return weekdayIndex(todayISO) === 6 ? weekDates(todayISO) : weekDates(addDays(todayISO, -1));
}

/**
 * One quiet line. `byDate` as tracker(); `numbers` (showMacros); `weightPace` S.weight.pace when
 * the athlete is an adult with weight data (else null). Days with no row count as not hit.
 * '' when the week holds no logged day at all.
 */
export function recapLine(byDate, { order, target, todayISO, numbers, weightPace = null, titleOf = (k) => k }) {
  const dates = recapWeek(todayISO).filter((d) => d <= todayISO);
  const days = dates.map((d) => byDate[d] || null);
  if (!days.some((d) => d && d.anyMeal)) return '';
  const bits = [];
  if (numbers && target > 0) bits.push(`protein hit on ${days.filter((d) => d && d.dayProtein >= target).length} of 7 days`);
  else bits.push(`every meal in on ${days.filter((d) => d && d.anyMeal && order.required.every((k) => d.logged[k])).length} of 7 days`);
  const missedBy = {};
  for (const d of days) {
    // Today (Sunday's recap) is still open: a meal not logged YET is not a missed one.
    if (!d || !d.anyMeal || d.date === todayISO) continue;
    for (const k of order.required) if (!d.logged[k]) missedBy[k] = (missedBy[k] || 0) + 1;
  }
  const most = Object.entries(missedBy).sort((a, b) => b[1] - a[1])[0];
  if (most) bits.push(`${lower(titleOf(most[0]))} missed most`);
  if (weightPace) bits.push(`weight ${lower(weightPace)}`);
  const scores = days.filter((d) => d && d.score != null && d.anyMeal).map((d) => d.score);
  if (scores.length) bits.push(`average score ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}`);
  const head = weekdayIndex(todayISO) === 6 ? 'This week' : 'Last week';
  const line = bits.join(' · ');
  return `${head}: ${line}.`;
}
