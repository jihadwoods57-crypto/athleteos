/* The 60-second lessons, the rules (goals and eating plan, phase D, 2026-09-26).
 *
 * Pure: no DOM, no Supabase, no clock of its own. lessons-content.js holds the words; this file
 * decides which words a reader gets, which lesson a weekly focus points at, and which assigned
 * lesson Home shows. Tested in Node (lessons.test.mjs), which also lints every word of the content.
 *
 * THE RULES THIS FILE HOLDS
 *  1. ONE READER, ONE VERSION. A card's text is picked for the reader: an Intuitive athlete never
 *     gets a macro or calorie figure, an athlete under 18 never gets a weight word. A variant set
 *     to null skips the card for that reader.
 *  2. ONE LIST. LESSON_IDS is 0256 lesson_ids() and titles are 0256 lesson_title(); the test pins
 *     both against the migration, so the push, the database and the screen say the same thing.
 *  3. DETERMINISTIC. OnStandard content, never signed as Nia, never a model call.
 */
import { LESSONS } from './lessons-content.js';

export { LESSONS };
export const LESSON_IDS = LESSONS.map((l) => l.id);
export const LESSON_MINUTES = 1;
export const lessonById = (id) => LESSONS.find((l) => l.id === id) || null;
export const isLessonId = (id) => typeof id === 'string' && LESSON_IDS.includes(id);

/** A macro or calorie figure (what an Intuitive athlete must never see), or the counting words. */
export const FIGURE_RE = /\b\d+(?:\.\d+)?\s*(?:to\s*\d+\s*)?(?:g|grams?|kcal|cals?|calories)\b|\b(?:grams?|calories|calorie|kcal|macros?)\b/i;
/** Weight talk (what an athlete under 18 must never see). */
export const WEIGHT_RE = /\b(?:weight|weigh|weighs|weighing|lose|losing|lost|loss|cut|cutting|bulk|bulking|diet|dieting|pounds?|lbs?|slim|skinny|lean out|surplus|deficit|body fat|fat loss|burn(?:ing)? fat)\b/i;

/** The reader: { intuitive, minor }. */
export function audience({ showMacros = true, minor = false } = {}) {
  return { intuitive: !showMacros, minor: !!minor };
}

/** The version of `obj` (a card or a quick check) this reader gets: undefined falls through,
 *  null skips. Most specific first. */
export function pickVariant(obj, aud) {
  const a = aud || {};
  const order = [];
  if (a.minor && a.intuitive) order.push('minorIntuitive');
  if (a.minor) order.push('minor');
  if (a.intuitive) order.push('intuitive');
  order.push('text');
  for (const k of order) if (obj[k] !== undefined) return obj[k];
  return null;
}

/** A quick check's version: the same fall-through, with the base check as `text`. */
function pickCheck(check, aud) {
  const v = pickVariant({ ...check, text: { q: check.q, options: check.options, answer: check.answer, why: check.why } }, aud);
  return v && typeof v === 'object' ? v : null;
}

/** One lesson as this reader sees it, or null for an unknown id. */
export function lessonFor(id, aud) {
  const l = lessonById(id);
  if (!l) return null;
  const cards = l.cards.map((c) => pickVariant(c, aud)).filter((t) => typeof t === 'string' && t);
  return { id: l.id, title: l.title, summary: l.summary, focus: l.focus.slice(), cards, check: pickCheck(l.check, aud) };
}

/** Did the reader pick the right answer? */
export const isCorrect = (check, index) => !!check && Number(index) === check.answer;

/* ---------------- the weekly focus and the team challenge point at a lesson ---------------- */

/** The lesson that teaches a weekly-focus candidate (or a challenge habit), or null. A protein
 *  focus on a standard's own slot ("meal-5") reads the general protein lesson. */
export function lessonForFocus(key) {
  if (typeof key !== 'string' || !key) return null;
  const own = LESSONS.find((l) => l.focus.includes(key));
  if (own) return own.id;
  return key.startsWith('protein:') ? 'protein-every-meal' : null;
}

/* ---------------- assignments, as the athlete's Home reads them ---------------- */

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const noon = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
const daysBetween = (a, b) => Math.round((noon(b) - noon(a)) / 86400000);

/** "Due today" · "Due tomorrow" · "Due Fri" (this week) · "Due Oct 3" · "Was due Mon". '' for none. */
export function dueLabel(dueOn, todayISO) {
  if (!dueOn || !todayISO) return '';
  const d = daysBetween(todayISO, dueOn);
  const dt = noon(dueOn);
  const name = d >= -6 && d <= 6 ? DAY_SHORT[dt.getUTCDay()] : `${MONTH_SHORT[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d < 0) return `Was due ${name}`;
  return `Due ${name}`;
}

/**
 * The assigned lessons still to do, most pressing first: a due date before none, the earlier due
 * date first, then the oldest assignment. One lesson assigned twice (team and room) shows once.
 * `rows` are my_learning().assignments; `done` the completed lesson ids.
 */
export function openAssignments(rows, done) {
  const finished = new Set(Array.isArray(done) ? done : []);
  const seen = new Set();
  const list = (Array.isArray(rows) ? rows : [])
    // A lesson from a coach this athlete blocked (0244) never reaches Home or "From your coach".
    .filter((r) => r && !r.blocked && isLessonId(r.lesson_id) && !finished.has(r.lesson_id))
    .sort((a, b) => {
      if (!!a.due_on !== !!b.due_on) return a.due_on ? -1 : 1;
      if (a.due_on && b.due_on && a.due_on !== b.due_on) return a.due_on < b.due_on ? -1 : 1;
      return String(a.created_at || '') < String(b.created_at || '') ? -1 : 1;
    });
  return list.filter((r) => (seen.has(r.lesson_id) ? false : (seen.add(r.lesson_id), true)));
}

/**
 * THE HOME CARD PRIORITY (spec D, "Done means"). An assigned lesson card sits on top. Under it, a
 * running team challenge REPLACES the personal weekly focus, so there are never two focus cards.
 * Returns the cards in order: some of 'lesson', 'challenge', 'focus'.
 */
export function homeCards({ lesson = false, challenge = false, focus = false } = {}) {
  const out = [];
  if (lesson) out.push('lesson');
  if (challenge) out.push('challenge');
  else if (focus) out.push('focus');
  return out;
}

/** "From Coach Grinch: Carbs are fuel · 1 min" parts, for the Home card. */
export function assignedCardCopy(row, todayISO) {
  const l = lessonById(row && row.lesson_id);
  if (!l) return null;
  const from = String((row && row.from) || '').trim() || 'Your coach';
  return { from: `From ${from}`, title: l.title, meta: [`${LESSON_MINUTES} min`, dueLabel(row.due_on, todayISO)].filter(Boolean).join(' · ') };
}
