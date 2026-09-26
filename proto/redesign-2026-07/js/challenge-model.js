/* Team focus challenges, the rules (goals and eating plan, phase D, 2026-09-26).
 *
 * A coach picks ONE habit from the weekly-focus candidates, a date range (this Monday to Sunday by
 * default, 14 days at most) and a goal (5 of 7 days by default). Progress is computed on the SERVER
 * from the stored day rows (0256 team_challenge_board / my_learning), so a phone cannot fake it;
 * this file only names things and reads what the server returned.
 *
 * THE RULES THIS FILE HOLDS
 *  1. ONE DEFINITION OF A HIT. challengeDayHit is weekly-focus-model's own dayHit on dayFacts, and
 *     0256 focus_day_hit is its SQL port. challenge-parity.test.mjs runs both on the fixtures
 *     embedded in supabase/tests/lessons_challenges_test.sql, which asserts the same answers in SQL.
 *  2. A HABIT A DAY DOES NOT HAVE IS NOT A MISS. Protein at lunch on a two-meal standard, or the
 *     snack where it is not required, is "not part of it" (null), never a missed day.
 *  3. NUMBERS ARE PER STYLE. An Intuitive athlete reads the plate words, never grams.
 *  4. NO NAMES ON THE ATHLETE SIDE. The team is a count ("14 of 22 on track"), always.
 */
import { candidates, dayFacts, dayHit, weekDates, addDays, weekdayIndex } from './weekly-focus-model.js';

export const MAX_DAYS = 14;
export const DEFAULT_GOAL = 5;

/** The habits a challenge can be about, in the weekly focus's own keys. 0256 challenge_habit_title()
 *  holds the same titles (the start push quotes it); challenge-parity.test.mjs pins the two. */
export const HABITS = [
  { key: 'protein:breakfast', title: 'Protein at breakfast', plate: 'A palm of protein at breakfast', slot: 'breakfast' },
  { key: 'protein:lunch', title: 'Protein at lunch', plate: 'A palm of protein at lunch', slot: 'lunch' },
  { key: 'protein:dinner', title: 'Protein at dinner', plate: 'A palm of protein at dinner', slot: 'dinner' },
  { key: 'missed', title: 'Every meal in', plate: 'Every meal in' },
  { key: 'late', title: 'Meals logged on time', plate: 'Meals logged on time' },
  { key: 'snack', title: 'The snack, every day', plate: 'The snack, every day' },
];
export const HABIT_KEYS = HABITS.map((h) => h.key);
export const habitInfo = (k) => HABITS.find((h) => h.key === k) || null;

/** The habit's name for this reader (plate words for an Intuitive athlete). */
export function habitTitle(key, numbers = true) {
  const h = habitInfo(key);
  if (!h) return '';
  return numbers ? h.title : h.plate;
}

/** What makes a day count, in one plain line. `staff` words it about the athletes, for a coach. */
export function habitRule(key, numbers = true, staff = false) {
  const h = habitInfo(key);
  if (!h) return '';
  const your = staff ? 'their' : 'your';
  const you = staff ? 'they' : 'you';
  if (h.slot) {
    return numbers
      ? `A day counts when ${your} ${h.slot} carries its share of ${your} protein.`
      : `A day counts when ${your} ${h.slot} has a palm of protein.`;
  }
  if (key === 'missed') return 'A day counts when every required meal is logged.';
  if (key === 'late') return `A day counts when every meal ${you} log comes in on time.`;
  return `A day counts when ${your} snack is logged.`;
}

/** Does this habit exist on a day shaped like `order` (plan-today-model slotOrder)? */
export const habitApplies = (key, order) => candidates(order).includes(key);

/**
 * One day, judged exactly as the weekly focus judges it: true | false | null. null is either no
 * evidence yet (a protein read that has not landed) or a habit this day does not have.
 * `row` is a days row ({ date, meals, checkin }) or null when the athlete has no row that day.
 */
export function challengeDayHit(habit, row, ctx) {
  if (!habitApplies(habit, ctx.order)) return null;
  const d = row ? dayFacts(row, ctx) : null;
  return dayHit(habit, d, ctx);
}

/* ---------------- the range and the goal ---------------- */

/** This Monday to Sunday. */
export function defaultRange(todayISO) {
  const w = weekDates(todayISO);
  return { starts: w[0], ends: w[6] };
}
const span = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000) + 1;
export const rangeDays = (starts, ends) => (starts && ends ? span(starts, ends) : 0);

/** What is wrong with a range, in words ('' when nothing is). The server checks the same bounds. */
export function rangeError(starts, ends, todayISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(starts || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(ends || ''))) return 'Pick a start and an end.';
  if (ends < starts) return 'The end comes before the start.';
  if (rangeDays(starts, ends) > MAX_DAYS) return 'A challenge runs 14 days at most.';
  if (starts < addDays(todayISO, -7)) return 'Start it this week or later.';
  if (starts > addDays(todayISO, 14)) return 'Start it within the next two weeks.';
  if (ends < todayISO) return 'That range is already over.';
  return '';
}
/** The goal's bounds for a range: 1..days, 5 by default (or every day of a shorter one). */
export function goalBounds(starts, ends) {
  const n = Math.max(1, rangeDays(starts, ends));
  return { min: 1, max: n, def: Math.min(DEFAULT_GOAL, n) };
}

/**
 * ON TRACK (0256 challenge_athlete_days holds the same rule). Reached the goal, or, while the
 * challenge runs, keeping pace: at least goal x (finished days / all days), rounded down. Once the
 * range is over only the goal counts.
 */
export function onTrack({ hits, goal, elapsed, total, over }) {
  if (hits >= goal) return true;
  if (over) return false;
  return hits >= Math.floor((goal * elapsed) / Math.max(1, total));
}

/* ---------------- what the server returned, drawn ---------------- */

const LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** The athlete's own tracker from the server's days ([{ date, hit, na }]): 'hit' | 'miss' |
 *  'unknown' (no evidence either way) | 'open' (today, not yet) | 'future' | 'na' (not part of it). */
export function trackerStates(days, todayISO) {
  return (Array.isArray(days) ? days : []).map((d) => {
    const label = LETTER[weekdayIndex(d.date)];
    if (d.date > todayISO) return { date: d.date, label, state: 'future' };
    if (d.na) return { date: d.date, label, state: 'na' };
    if (d.date === todayISO) return { date: d.date, label, state: d.hit === true ? 'hit' : 'open' };
    return { date: d.date, label, state: d.hit === true ? 'hit' : d.hit === null ? 'unknown' : 'miss' };
  });
}

/** "14 of 22 on track" (running) or "9 of 22 made it" (over). Never a name. */
export function teamLine({ onTrack: n, total, over }) {
  const a = Math.max(0, Number(n) || 0);
  const b = Math.max(0, Number(total) || 0);
  if (!b) return '';
  return over ? `${a} of ${b} made it` : `${a} of ${b} on track`;
}

/** "3 of 5 days so far" / "Goal reached: 5 of 5 days". */
export function myLine({ hits, goal }) {
  const h = Math.max(0, Number(hits) || 0);
  const g = Math.max(1, Number(goal) || 1);
  return h >= g ? `Goal reached: ${h} of ${g} days` : `${h} of ${g} days so far`;
}

/** "Mon Sep 21 to Sun Sep 27". */
export function rangeLabel(starts, ends) {
  const f = (iso) => {
    const d = new Date(`${iso}T12:00:00Z`);
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCDate()}`;
  };
  return starts && ends ? `${f(starts)} to ${f(ends)}` : '';
}

/** Is a challenge row running on `todayISO`? (started, not ended, not past its last day) */
export const isRunning = (c, todayISO) => !!c && !c.ended_at && c.starts_on <= todayISO && todayISO <= c.ends_on;
