/* Food preferences (goals and eating plan, phase A1, 2026-09-25).
 *
 * ONE FILE, TWO MODULE GRAPHS. proto/redesign-2026-07/js/food-prefs.js is the source and
 * supabase/functions/_shared/food-prefs.mjs is a byte-identical copy (`npm run lint:mirror` fails
 * the build if they drift). The Plan screen saves and filters with this file; meal-chat's plan
 * ideas read the stored value through the SAME sanitizer, so what the athlete saved and what Nia
 * is told can never be two different things.
 *
 * WHAT IT HOLDS. Three switches (budget-friendly, no-cook, grab-and-go) and two short free-text
 * lists (likes, dislikes). A preference shapes ideas; it never outranks an allergy or a coach's
 * food rule, which is why avoidWords() puts the restrictions first and the dislikes after them.
 *
 * Pure: no DOM, no storage, no network, no imports.
 */

/** The switches, in the order the Plan screen shows them. `tag` is the label an idea wears when
 *  the model says it fits that switch. */
export const PREF_FLAGS = [
  { key: 'budget', label: 'Budget-friendly', hint: 'About $5 or less', tag: 'Under $5' },
  { key: 'noCook', label: 'No-cook or dorm', hint: 'Nothing that needs a stove', tag: 'No cooking' },
  { key: 'grabGo', label: 'Grab-and-go', hint: 'Easy to eat on the move', tag: 'Grab and go' },
];

export const PREF_LIST_MAX = 8;
export const PREF_ITEM_MAX = 30;

/** One athlete-typed food word, made safe to store, show and put in a prompt as data. */
export function cleanPrefItem(v) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[^\p{L}\p{N} &'\-.,]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREF_ITEM_MAX)
    .trim();
}

function cleanList(raw) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(raw) ? raw : []) {
    const v = cleanPrefItem(x);
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= PREF_LIST_MAX) break;
  }
  return out;
}

/** Any stored or typed value, as the one shape every reader expects. Never throws. */
export function cleanFoodPrefs(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { budget: r.budget === true, noCook: r.noCook === true, grabGo: r.grabGo === true, likes: cleanList(r.likes), dislikes: cleanList(r.dislikes) };
  // A food on both lists is a typo, not a preference: the dislike wins, because suggesting a food
  // someone said they avoid is the worse mistake.
  const bad = new Set(out.dislikes.map((d) => d.toLowerCase()));
  out.likes = out.likes.filter((l) => !bad.has(l.toLowerCase()));
  return out;
}

/** True when the athlete has said anything at all. */
export function hasFoodPrefs(p) {
  const c = cleanFoodPrefs(p);
  return c.budget || c.noCook || c.grabGo || c.likes.length > 0 || c.dislikes.length > 0;
}

/** A short stable fingerprint of the prefs, so a cache built for one set of prefs is never
 *  served after the athlete changes them. */
export function prefsKey(p) {
  const c = cleanFoodPrefs(p);
  const s = [c.budget ? 'b' : '', c.noCook ? 'n' : '', c.grabGo ? 'g' : '', '|',
    c.likes.map((x) => x.toLowerCase()).sort().join(','), '|',
    c.dislikes.map((x) => x.toLowerCase()).sort().join(',')].join('');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Does `text` name `word`? Whole words, case-insensitive, a trailing plural allowed, so
 *  "egg" catches "Egg scramble" and "eggs" but never "eggplant". */
export function mentions(text, word) {
  const w = String(word || '').trim().toLowerCase();
  if (w.length < 2) return false;
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/, '');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(e?s)?($|[^\\p{L}\\p{N}])`, 'iu');
  return re.test(String(text || ''));
}

/** The words an idea must not name: allergies and intolerances first (they are rules), then the
 *  athlete's own dislikes (they are preferences). `restrictions` is the 0134 declaration shape. */
export function avoidWords(prefs, restrictions) {
  const d = restrictions && typeof restrictions === 'object' ? restrictions : {};
  const nameOf = (a) => cleanPrefItem(typeof a === 'string' ? a.split('·')[0] : a && a.name);
  const out = [];
  for (const a of Array.isArray(d.allergies) ? d.allergies : []) out.push(nameOf(a));
  for (const a of Array.isArray(d.intolerances) ? d.intolerances : []) out.push(nameOf(a));
  for (const x of cleanFoodPrefs(prefs).dislikes) out.push(x);
  return [...new Set(out.filter(Boolean).map((x) => x.toLowerCase()))];
}

/** True when any of `texts` names any of `words`. */
export function namesAny(texts, words) {
  const list = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
  return (words || []).some((w) => list.some((t) => mentions(t, w)));
}

/** Tag keys an idea may carry, filtered to the known switches. */
export function cleanTags(raw) {
  const keys = new Set(PREF_FLAGS.map((f) => f.key));
  const out = [];
  for (const t of Array.isArray(raw) ? raw : []) if (keys.has(t) && !out.includes(t)) out.push(t);
  return out;
}

/** The label for one tag key, or '' when unknown. */
export function tagLabel(key) {
  const f = PREF_FLAGS.find((x) => x.key === key);
  return f ? f.tag : '';
}

/** The prefs as plain sentences for a prompt. '' when there is nothing to say. Data, never
 *  instructions: every word has been through cleanPrefItem. */
export function prefsPromptText(p) {
  const c = cleanFoodPrefs(p);
  const wants = PREF_FLAGS.filter((f) => c[f.key]).map((f) => `${f.label.toLowerCase()} (${f.hint.toLowerCase()})`);
  const lines = [];
  if (wants.length) lines.push(`They asked for ideas that are ${wants.join(', ')}.`);
  if (c.likes.length) lines.push(`Foods they like: ${c.likes.join(', ')}.`);
  if (c.dislikes.length) lines.push(`Foods they do not eat, never suggest: ${c.dislikes.join(', ')}.`);
  return lines.join(' ');
}
