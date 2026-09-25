/* OnStandard: what the athlete SAID about the amount on their plate, and which food it is about.
 *
 * THE DOUBLE CHICKEN INCIDENT (founder, 2026-09-24, 9:09 PM). A Chipotle chicken salad bowl, six
 * detected foods. "Nia in my meal i had double chicken. This from chipotle." Nia answered "Good
 * catch, Jihad. Double chicken it is, your numbers and score are updating now" and nothing moved:
 * the model's apply_correction said the chicken's amount was "double", and the deterministic engine
 * only understands amounts it can compare to the one on the row ("8 oz" over "4 oz"). A word is not
 * an amount, so applyMealCorrection returned null, and an amber line under the box contradicted the
 * reply the server had already written into the thread.
 *
 * Two halves to the fix. meal-chat no longer files Nia's promise before the plate has changed (the
 * client applies first and reports what happened). And this module turns the common ways people
 * say a portion changed into amounts the engine can apply:
 *
 *   "double chicken", "2x chicken", "chicken x2"   -> that food's portion x2
 *   "triple rice"                                  -> x3
 *   "extra chicken" / "extra rice"                 -> x2 for a protein, x1.5 otherwise (founder)
 *   "half the rice", "half rice"                   -> x0.5
 *   "a half cup of rice"                           -> 1/2 cup (an amount, not a ratio)
 *   "no sour cream", "hold the sour cream"         -> the food comes off the plate
 *   "added guac", "also had a roll", "plus chips"  -> a food the read does not have is added
 *
 * THE MODEL'S PARTS ARE THE CORRECTION; THE ATHLETE'S WORDS REFINE THEM (review 2026-09-24). The
 * first version let the parser outrank the model outright, and it removed the grilled chicken on
 * "I had no chicken salad, it was grilled chicken", removed the chicken on "i did not have double
 * chicken", and dropped the model's rename on "no sour cream, it was guac". So now:
 *   - the parser may turn a word the model sent ("double") into an amount ("6 oz");
 *   - a real amount from the model ("6 oz") beats the parser's word;
 *   - a removal needs the plate item's whole name (or every word of it). One shared word never
 *     takes a food off; it becomes a question;
 *   - "did not have double chicken" is not a removal, and "no X, it was Y" is the model's rename;
 *   - a model rename or add is never dropped because it shares a word with something said.
 *
 * RELATIVE WORDS ARE RELATIVE TO A BASELINE, NEVER TO THE LAST EDIT. "Double chicken" said twice
 * used to double it twice (3 oz, 6, 12, 24), and on a row with no amount ("2 servings" is read
 * against nothing, so it multiplied whatever was there) it still did after the first fix. Every
 * row now gets a baseline on its first correction: its amount (if any) and its MACROS (`base`,
 * written by applyMealCorrection, carried by normalizeDetected). A relative word is a factor on
 * that baseline (`baseFactor`), so "double" twice is still 2x and "actually triple" after a double
 * is 3x the baseline. Anything absolute ("it was 8 oz", a label figure) becomes the new baseline,
 * so "double" after "8 oz" is 16 oz. A row already at the target comes back as `counted`: Nia says
 * it is already counted and nothing moves.
 *
 * AMBIGUITY IS A QUESTION, NEVER A GUESS. Two foods that both say chicken ("Grilled chicken" and
 * "Chicken salad"), a chicken that only exists inside a composite dish ("Chicken burrito bowl"),
 * or a food the read never had, all come back as an `ask` that Nia puts to the athlete.
 *
 * Pure and lazy: nothing here is imported at boot (lint:boot), only by correction-turn.js the
 * moment a correction arrives. */
import { servingsFor } from './nutrition.js';

const fold = (s) => String(s == null ? '' : s).toLowerCase()
  .replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u2013\u2014]/g, ' ');

/** Words that end the food a phrase is about. "double chicken from chipotle" is about chicken. */
const STOP = new Set(['and', 'but', 'or', 'from', 'at', 'in', 'on', 'with', 'this', 'that', 'it', 'its',
  'was', 'were', 'is', 'i', 'im', "i'm", 'my', 'me', 'to', 'for', 'too', 'also', 'please', 'today',
  'tonight', 'nia', 'instead', 'not', 'so', 'because', 'cause', 'since', 'then', 'just', 'only', 'like',
  'as', 'had', 'have', 'got', 'get', 'ate', 'when', 'what', 'how', 'there', 'here', 'bro', 'lol', 'off', 'out']);
/** Words between the verb and the food that say nothing about which food. */
const FILLER = new Set(['the', 'a', 'an', 'of', 'some', 'any', 'my', 'portion', 'portions', 'serving',
  'servings', 'order', 'orders', 'scoop', 'scoops', 'helping', 'helpings', 'side', 'on', 'more']);
/** Kitchen units. "a half cup of rice" is about rice, never about a food called "cup". */
const UNITS = new Set(['cup', 'cups', 'oz', 'ounce', 'ounces', 'g', 'gram', 'grams', 'tbsp', 'tsp',
  'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons', 'lb', 'lbs', 'pound', 'pounds', 'slice', 'slices',
  'piece', 'pieces', 'handful', 'handfuls', 'ml', 'glass', 'glasses', 'bowl', 'bowls', 'plate', 'plates']);
/** Name words that carry no identity ("Grilled chicken, sliced" is chicken). */
const PREP = new Set(['with', 'and', 'the', 'of', 'sliced', 'diced', 'chopped', 'fresh', 'plain', 'cooked',
  'about', 'approx', 'style']);
/** A dish, as opposed to one food. "Double chicken" over a "Chicken burrito bowl" says nothing about
 *  the rice and beans in that bowl, so doubling the row would be a guess. */
const DISH = new Set(['salad', 'bowl', 'burrito', 'sandwich', 'wrap', 'taco', 'tacos', 'soup', 'pasta',
  'pizza', 'quesadilla', 'burger', 'sub', 'plate', 'platter', 'nachos', 'curry', 'casserole', 'combo',
  'meal', 'stir', 'omelet', 'omelette', 'scramble', 'hoagie', 'panini', 'melt', 'slider', 'sliders']);

const SCALE_WORDS = [
  // [pattern at the start of the remaining text, factor, verb]; longest first. "extra" carries
  // 1.5 here and becomes 2 once the food it is about turns out to be a protein (extraFactor).
  [/^(?:a\s+)?double(?:d)?\s+(?:portion|serving|order|scoop|helping)s?\s+of\b/, 2, 'double'],
  [/^twice\s+(?:as\s+much\s+)?(?:the\s+)?/, 2, 'double'],
  [/^(?:a\s+)?double(?:d)?\b/, 2, 'double'],
  [/^(?:2x|x2)\b/, 2, 'double'],
  [/^(?:triple(?:d)?|3x|x3)\b/, 3, 'triple'],
  [/^extra\b/, 1.5, 'extra'],
  [/^half(?:\s+(?:of|a|an|the))*\b/, 0.5, 'half'],
];
const REMOVE_WORDS = [
  /^(?:no|without|minus|hold\s+the)\b/,
  /^(?:didn't|did\s+not|didnt|never)\s+(?:have|had|get|got|eat|ate|want)\b/,
  /^(?:skipped|took\s+off|took\s+out|removed)\b/,
];
const ADD_WORDS = [/^(?:added|add|also\s+had|also\s+got|plus)\b/];
/** A quantity word right after "no" / "didn't have": "i did not have double chicken" denies the
 *  AMOUNT, not the food. That is not a removal, and not a scale either. */
const QTY_WORD = /^(?:double|doubled|triple|tripled|twice|extra|half|2x|x2|3x|x3|more|much|that|as|a\s+lot|so)\b/;
/** "no X, it was Y", "Y instead", "swap", "not X but Y": the athlete is renaming or replacing, and
 *  that is the model's part to apply. The parser stands down on removals for the whole message. */
const RENAME_CUE = /\b(?:it was|it's|its|they were|that was|was actually|actually|instead|swap(?:ped)?|switch(?:ed)?|replace(?:d)?|not\s+[a-z]+(?:\s+[a-z]+)?,?\s+but)\b/;

const NEGATED = /\b(?:not|wasn't|wasnt|isn't|isnt|never|didn't|didnt|don't|dont)(?:\s+(?:have|had|get|got|eat|ate|want|order))?\s*$/;
/** Words that follow an edit word without naming a food: "extra protein", "double check". */
const NOT_FOOD = new Set(['protein', 'carb', 'carbs', 'fat', 'fats', 'calorie', 'calories', 'kcal', 'macro', 'macros',
  'score', 'points', 'meal', 'meals', 'plate', 'food', 'time', 'check', 'checked', 'problem', 'worries', 'way',
  'idea', 'clue', 'doubt', 'thanks', 'workout', 'practice', 'lift', 'session', 'day', 'cap']);

/** The words of a name or phrase, lowercased, identity only. */
function words(s) {
  return fold(s).replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9']+/)
    .map((w) => w.replace(/'/g, '')).filter((w) => w.length >= 3 && !PREP.has(w));
}
const singular = (w) => w.replace(/ies$/, 'y').replace(/(ch|sh|x|ss)es$/, '$1').replace(/s$/, '');
/** "rolls" is "roll"; "guac" is "guacamole"; "chicken" is not "chickpea". */
function sameWord(a, b) {
  if (a === b) return true;
  const x = singular(a), y = singular(b);
  if (x === y) return true;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  return short.length >= 4 && long.startsWith(short) && long.length - short.length >= 3;
}

/** The food named right after an edit word: up to three words, stopping at the end of the clause.
 *  Units are skipped ("half a cup of rice" is rice); `unit` reports the one that was. */
function foodAfter(toks, i) {
  let j = i;
  let unit = '';
  while (j < toks.length && (FILLER.has(toks[j]) || (UNITS.has(toks[j]) && !unit))) { if (UNITS.has(toks[j])) unit = toks[j]; j++; }
  const out = [];
  while (j < toks.length && out.length < 3) {
    const t = toks[j];
    if (t === '.' || STOP.has(t) || FILLER.has(t) || !/^[a-z][a-z'-]*$/.test(t)) break;
    out.push(t);
    j++;
  }
  return { w: out, unit, end: j };
}
/** The food named right BEFORE a trailing edit ("chicken x2", "the rice was doubled"). */
function foodBefore(toks, i) {
  const out = [];
  let j = i - 1;
  while (j >= 0 && (toks[j] === 'was' || toks[j] === 'were' || toks[j] === 'is')) j--;
  while (j >= 0 && out.length < 3) {
    const t = toks[j];
    if (t === '.' || STOP.has(t) || FILLER.has(t) || UNITS.has(t) || !/^[a-z][a-z'-]*$/.test(t)) break;
    out.unshift(t);
    j--;
  }
  return out;
}
const skipFiller = (toks, i) => { let j = i; while (j < toks.length && FILLER.has(toks[j]) && toks[j] !== 'more') j++; return j; };

/**
 * Every portion edit in the athlete's own message.
 * Returns [{ op: 'scale'|'set'|'remove'|'add', factor?, quantity?, verb, food, words }], in order.
 * A question ("should I get double chicken?") is not a statement about this plate and reads as none.
 */
export function readPlateEdits(said) {
  const t = fold(said);
  if (!t.trim()) return [];
  // A question about later ("should I get double chicken?") is not an edit; a request put as a
  // question ("can you take the rice off?") is one.
  if (/\?/.test(t) && /\b(should|can|could|would|will|is it|do you)\b/.test(t) && !/\b(?:can|could|would|will) you\b/.test(t)) return [];
  const toks = t.replace(/@?nia\b[,:]?/g, ' nia ').replace(/[.!?;:,]+/g, ' . ').split(/\s+/).filter(Boolean);
  const out = [];
  const seen = new Set();
  const push = (e) => {
    const w = e.words.filter((x) => x.length >= 3);
    if (!w.length) return;
    const key = `${e.op}:${w.join(' ')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...e, words: w, food: e.words.join(' ') });
  };
  for (let i = 0; i < toks.length; i++) {
    const rest = toks.slice(i, i + 6).join(' ');
    const before = toks.slice(Math.max(0, i - 3), i).join(' ');
    // "take the rice off", "remove the rice", "drop the sour cream": an explicit instruction to take
    // one named food off. Surer than "no rice" (which can open "no rice, it was cauliflower rice"),
    // so one food on the plate that it names is enough (resolveChatCorrection).
    if (/^(?:take|took|remove|drop)$/.test(toks[i]) && !NEGATED.test(before)) {
      // "take off the cheese": the particle can come first. "remove rice and cheese": every food
      // named goes (one that matches nothing is asked about, never dropped).
      const first = /^(?:take|took)$/.test(toks[i]) && /^(?:off|out)$/.test(toks[i + 1] || '');
      const foods = [];
      let f = foodAfter(toks, i + (first ? 2 : 1));
      while (f.w.length && !NOT_FOOD.has(f.w[0])) {
        foods.push(f.w);
        if (toks[f.end] !== 'and') break;
        f = foodAfter(toks, f.end + 1);
      }
      if (foods.length && (first || /^(?:remove|drop)$/.test(toks[i]) || /^(?:off|out)$/.test(toks[f.end] || ''))) {
        for (const w of foods) push({ op: 'remove', verb: 'remove', take: true, words: w });
        i = f.end;
        continue;
      }
    }
    // Trailing forms: "chicken x2", "chicken 2x", "the rice was doubled".
    if (/^(?:x2|2x|x3|3x|doubled|tripled)$/.test(toks[i]) && i > 0 && !NEGATED.test(before)) {
      const f = /3|tripled/.test(toks[i]) ? 3 : 2;
      const w = foodBefore(toks, i);
      if (w.length) { push({ op: 'scale', factor: f, verb: f === 3 ? 'triple' : 'double', words: w }); continue; }
    }
    let hit = null;
    for (const [re, factor, verb] of SCALE_WORDS) {
      const m = re.exec(rest);
      if (m) { hit = { op: 'scale', factor, verb, len: m[0].trim().split(/\s+/).length }; break; }
    }
    if (!hit) for (const re of REMOVE_WORDS) { const m = re.exec(rest); if (m) { hit = { op: 'remove', verb: 'remove', len: m[0].trim().split(/\s+/).length }; break; } }
    if (!hit) for (const re of ADD_WORDS) { const m = re.exec(rest); if (m) { hit = { op: 'add', verb: 'add', len: m[0].trim().split(/\s+/).length }; break; } }
    if (!hit) continue;
    if (hit.op !== 'scale') {
      const k = skipFiller(toks, i + hit.len);
      if (k < toks.length && QTY_WORD.test(toks.slice(k, k + 2).join(' '))) {
        // "add double chicken" is a double: let the scale word read it on the next pass.
        if (hit.op === 'add') continue;
        // "i did not have double chicken" / "no extra cheese": the amount is denied, not the food.
        // Nothing here; the model's part (if any) says what it means.
        const f = foodAfter(toks, k + 1);
        i = f.end - 1;
        continue;
      }
    }
    // "it wasn't double chicken" is the opposite of the edit. Say nothing rather than invert it.
    if (hit.op !== 'remove' && NEGATED.test(before)) continue;
    const f = foodAfter(toks, i + hit.len);
    let w = f.w;
    let span = f.end - i;
    // "the rice was double": the food came first.
    if (!w.length && hit.op === 'scale') { w = foodBefore(toks, i); span = hit.len; }
    // "extra protein", "double check", "no problem": an edit word with no food after it is not an edit.
    if (!w.length || NOT_FOOD.has(w[0])) continue;
    const { len, ...edit } = hit;
    // "a half cup of rice" is an amount (1/2 cup), not half of whatever the row says.
    if (hit.op === 'scale' && hit.verb === 'half' && f.unit) {
      push({ op: 'set', verb: 'set', quantity: `1/2 ${singular(f.unit)}`, words: w });
    } else push({ ...edit, words: w });
    i += span - 1;
  }
  return out;
}

/**
 * Which detected food a set of words names.
 * Returns { idx, strict: true } when every identity word of exactly one row was said (or its whole
 * name), { idx } for one looser own-portion match, { idx, composite } when the one match is a dish
 * the food only sits inside, { candidates: [idx, ...] } for a tie, or { none: true }.
 */
export function matchPlateFood(rich, foodWords) {
  const list = Array.isArray(rich) ? rich : [];
  const want = (Array.isArray(foodWords) ? foodWords : words(foodWords)).map((w) => fold(w)).filter((w) => w.length >= 3);
  if (!want.length || !list.length) return { none: true };
  // Near-exact first: all of the row's own words were said. The longest such name wins, so
  // "grilled chicken" names "Grilled chicken" over a plain "Chicken".
  let strictBest = 0;
  const strict = list.map((d) => {
    const nw = words(d && d.name);
    const ok = nw.length && nw.every((x) => want.some((w) => sameWord(w, x)));
    if (ok && nw.length > strictBest) strictBest = nw.length;
    return ok ? nw.length : 0;
  });
  if (strictBest) {
    const top = strict.map((s, i) => (s === strictBest ? i : -1)).filter((i) => i >= 0);
    if (top.length === 1) return { idx: top[0], strict: true };
    return { candidates: top };
  }
  let best = 0;
  const scores = list.map((d) => {
    const nw = words(d && d.name);
    let s = 0;
    for (const w of want) if (nw.some((x) => sameWord(w, x))) s += 1;
    if (s > best) best = s;
    return s;
  });
  if (!best) return { none: true };
  const top = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
  if (top.length > 1) return { candidates: top };
  const idx = top[0];
  const nw = words(list[idx].name);
  const dish = nw.find((x) => DISH.has(singular(x)) || DISH.has(x));
  if (dish && !want.some((w) => sameWord(w, dish))) return { idx, composite: true };
  return { idx };
}

/* "EXTRA" (founder ruling 2026-09-24): a second portion of a protein, half again of anything else.
   The repo has no protein classifier of its own, so this is the item's macros first (protein at
   least 40% of its calories) and a short word list only when the row carries no numbers. */
const PROTEIN_WORDS = /\b(chicken|beef|steak|turkey|pork|salmon|tuna|fish|shrimp|tilapia|cod|egg|eggs|tofu|brisket|carnitas|barbacoa|sirloin|ribeye|ham|lamb|bison|venison|jerky)\b/;
/** Is this detected row a protein portion? */
export function isProteinItem(row) {
  const p = row && row.per;
  const protein = Number(p && p.protein), kcal = Number(p && p.kcal);
  if (kcal > 0 && protein >= 0) return protein * 4 >= 0.4 * kcal;
  return PROTEIN_WORDS.test(fold(row && row.name));
}
const extraFactor = (row) => (isProteinItem(row) ? 2 : 1.5);

/** The amount a quantity WORD describes, relative to the read: "double" 2, "half" 0.5. Null for
 *  a real amount ("8 oz") or for anything vague ("a bit more"). `row` settles "extra". */
export function portionFactor(text, row) {
  const t = fold(text).trim();
  if (!t) return null;
  for (const [re, factor, verb] of SCALE_WORDS) if (re.test(t)) return verb === 'extra' && row ? extraFactor(row) : factor;
  if (/^(?:x2|2x|two times|2 times)\b/.test(t)) return 2;
  if (/^(?:x3|3x|three times|3 times)\b/.test(t)) return 3;
  return null;
}
const verbOf = (text) => { const t = fold(text).trim(); for (const [re, , verb] of SCALE_WORDS) if (re.test(t)) return verb; return /^(x3|3x)/.test(t) ? 'triple' : 'double'; };

const NO_PLURAL = new Set(['oz', 'g', 'gm', 'ml', 'l', 'lb', 'lbs', 'kg', 'tbsp', 'tsp', 'fl', 'each', 'whole']);
const SIZES = new Set(['large', 'medium', 'small', 'jumbo', 'big', 'mini']);
const FRACS = [[0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4']];
/** A number as a cook says it: a clean fraction as a fraction ("1 1/2"), anything else a decimal. */
function fmtN(n, asFraction) {
  if (asFraction) {
    const whole = Math.floor(n + 1e-9);
    const fr = FRACS.find(([v]) => Math.abs(n - whole - v) < 0.01);
    if (Math.abs(n - whole) < 0.01) return String(whole);
    if (fr) return whole ? `${whole} ${fr[1]}` : fr[1];
  }
  return String(Math.round(n * 100) / 100);
}
const plural = (w) => (/(ch|sh|x|s)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);

/** The row's own amount times a factor, in the row's own unit, so the breakdown reads "8 oz" rather
 *  than "double" and servingsFor compares it to the old amount exactly. Falls back to servings. */
export function scaledQuantity(oldQty, factor) {
  const q = String(oldQty == null ? '' : oldQty).trim();
  const f = Number(factor);
  if (!(f > 0)) return '';
  const m = q.match(/^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*(.*)$/);
  if (m) {
    const raw = m[1];
    const mixed = raw.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    const frac = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
    const n = mixed ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : frac ? Number(frac[1]) / Number(frac[2]) : Number(raw);
    if (n > 0 && m[2]) {
      const v = n * f;
      const parts = m[2].split(/\s+/);
      // "1 medium banana": the size word stays, the food it describes takes the plural.
      const at = SIZES.has(parts[0].toLowerCase()) && parts.length > 1 ? 1 : 0;
      const unit = parts[at];
      const countNoun = /^[a-z]+$/i.test(unit) && !NO_PLURAL.has(unit.toLowerCase());
      if (countNoun && v > 1 && !/s$/i.test(unit)) parts[at] = plural(unit);
      else if (countNoun && v <= 1 && /s$/i.test(unit)) parts[at] = singular(unit);
      // "1/2 cup", never "0.5 cup" (review round 2); grams and millilitres stay decimal.
      const next = `${fmtN(v, !/^(?:g|gm|grams?|ml|kg|l)$/i.test(unit))} ${parts.join(' ')}`.slice(0, 40);
      if (servingsFor(next, q).resolved) return next;
    }
  }
  return `${fmtN(f)} serving${f === 1 ? '' : 's'}`;
}

/** The row's baseline: what relative words scale from. Before any correction, the row itself. */
const baseOf = (row) => (row && row.base && row.base.per && typeof row.base.per === 'object'
  ? { q: String(row.base.q || ''), per: row.base.per } : { q: String((row && row.quantity) || ''), per: row && row.per });
/** A relative word's amount, in the baseline's own unit ("2 servings" when it has none). */
const relQ = (row, f) => scaledQuantity(baseOf(row).q, f);
/** Is the row already at f x its baseline? Judged on the numbers when the baseline has them (a
 *  serving row has no amount to compare), on the amount otherwise. */
function atFactor(row, f) {
  const bp = baseOf(row).per, cp = row && row.per;
  if (bp && cp && (Number(bp.kcal) > 0 || Number(bp.protein) > 0)) {
    return ['protein', 'kcal'].every((k) => Math.abs(Math.round((Number(bp[k]) || 0) * f) - (Number(cp[k]) || 0)) <= 1);
  }
  return atAmount(relQ(row, f), row);
}
/* A COUNT IS AN ABSOLUTE AMOUNT (review round 3). "it was 2 servings" on a row read as 2 servings
   is the same plate, not twice it. A count scales from the baseline by N over the baseline's OWN
   count (1 when the baseline is a measure, like "3 oz", or has no amount), and it becomes the new
   baseline. Only the relative words (double, 2x, triple, half, extra) are factors. */
const servingsWord = (q) => { const m = fold(q).trim().match(/^(\d+(?:\.\d+)?)\s*(?:servings?|portions?|scoops?|pieces?)$/); return m ? Number(m[1]) : null; };
const MEASURE = /^(?:oz|ounces?|g|gm|grams?|kg|ml|l|cups?|tbsp|tsp|tablespoons?|teaspoons?|lbs?|pounds?|fl)$/;
function baseCount(q) {
  const m = fold(q).trim().match(/^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s+([a-z]+)/);
  if (!m || MEASURE.test(m[2])) return 1;
  const fr = m[1].match(/^(\d+)\s*\/\s*(\d+)$/);
  const n = fr ? Number(fr[1]) / Number(fr[2]) : Number(m[1]);
  return n > 0 ? n : 1;
}
/** The factor on the baseline a count means, or null when `q` is not a count. */
const countFactor = (q, row) => { const n = servingsWord(q); return n == null ? null : n / baseCount(baseOf(row).q); };
/** Where the model's amount would take the row, as a multiple of what it holds now. */
function moveOf(q, row) {
  const cf = countFactor(q, row);
  if (cf != null) {
    const bp = baseOf(row).per, cp = row && row.per;
    return bp && cp && Number(cp.kcal) > 0 ? (Number(bp.kcal) * cf) / Number(cp.kcal) : 1;
  }
  const s = servingsFor(q, (row && row.quantity) || '');
  return s.resolved ? s.servings : 1;
}
/** Is `q` exactly what the row already says? Then applying it would move nothing. */
function atAmount(q, row) {
  const cur = String((row && row.quantity) || '').trim();
  if (!q || !cur) return false;
  if (fold(q).trim() === fold(cur)) return true;
  if (/serving|portion/.test(fold(q))) return false;   // "2 servings" is read without the row
  const s = servingsFor(q, cur);
  return s.resolved && Math.abs(s.servings - 1) < 0.01;
}
/** A real amount the engine can compare to the row ("6 oz" over "3 oz"), not a word. */
const absoluteAmount = (q, row) => !!q && !portionFactor(q) && !isZero(q) && (servingsWord(q) != null || servingsFor(q, (row && row.quantity) || '').resolved);
const isZero = (q) => /^\s*(?:0+(?:\.0+)?(?:\s*[a-z]+)?|zero|none|nothing|no(?:\s+[a-z]+)*|removed?|drop(?:ped)?|took (?:it )?off|taken off|did(?:n't| not) (?:have|eat)(?:\s+[a-z]+)*)\s*$/i.test(String(q || ''));

/* The same three-step match applyMealCorrection makes for a model-named item (exact, contains,
   shared words), so a model part is judged against the row it will actually land on. */
function rowFor(rich, item) {
  const want = fold(item).trim();
  if (!want) return -1;
  let idx = rich.findIndex((d) => fold(d && d.name).trim() === want);
  if (idx === -1) idx = rich.findIndex((d) => { const n = fold(d && d.name).trim(); return n && (n.includes(want) || want.includes(n)); });
  if (idx === -1) {
    const m = matchPlateFood(rich, words(item));
    if (m.idx != null && !m.composite) idx = m.idx;
  }
  return idx;
}

/** A model newName that is really an amount: "Double chicken" over "Grilled chicken". */
function renameIsAmount(newName, row) {
  const t = fold(newName);
  const verb = /\bextra\b/.test(t) ? 'extra' : /\b(triple|3x|x3)\b/.test(t) ? 'triple' : /\b(double|2x|x2)\b/.test(t) ? 'double' : /\bhalf\b/.test(t) ? 'half' : '';
  if (!verb) return null;
  const rest = words(t).filter((w) => !/^(double|doubled|triple|tripled|extra|half|portion|serving|order)$/.test(w));
  const own = words(row.name);
  if (!(rest.length && rest.every((w) => own.some((x) => sameWord(w, x))))) return null;
  return { verb, factor: verb === 'extra' ? extraFactor(row) : { double: 2, triple: 3, half: 0.5 }[verb] };
}

const perOf = (p) => !!(p && p.per && ['protein', 'kcal', 'carbs', 'fat'].some((k) => p.per[k] != null));
const onlyAmount = (p) => !p.newName && !(p.add && p.add.length) && !perOf(p);

/**
 * The correctMeal parts for one chat correction, the model's parts refined by the athlete's words.
 *
 * `correction` is meal-chat's apply_correction payload; `said` is the athlete's message, verbatim.
 * Returns { parts, asks, exact }: `parts` are what can land unambiguously (possibly none), `asks`
 * what Nia has to ask about (or tell them is already counted) instead, and `exact` whether the
 * parts are the model's own, as the model described them, so its ack can be filed word for word.
 * Each part carries `from` ('model' | 'athlete') and, for a relative amount, the `verb` said.
 */
export function resolveChatCorrection(meta, correction, said, { minutesLate } = {}) {
  const rich = Array.isArray(meta && meta.detectedRich) ? meta.detectedRich : [];
  const c = correction || {};
  const parts = [];
  const asks = [];
  let exact = true;
  const names = (idxs) => idxs.map((i) => String(rich[i].name)).slice(0, 4);
  const base = { minutesLate, said: said || undefined };
  const renaming = RENAME_CUE.test(fold(said));

  // The model's parts, each against the row it would land on.
  const model = [c, ...(Array.isArray(c.more) ? c.more : [])].filter((p) => p && p.item).map((p0) => {
    const idx = rowFor(rich, p0.item);
    return { p0, idx, exactName: idx >= 0 && fold(rich[idx].name).trim() === fold(p0.item).trim(), done: false, verb: '' };
  });
  const onRow = (idx) => model.find((m) => m.idx === idx && !m.done);
  // Every food the model is adding or naming, so the athlete's word for it is never counted twice.
  const modelFoods = [
    ...(Array.isArray(c.missed) ? c.missed : []).map((f) => f && f.name),
    ...model.flatMap((m) => [m.p0.newName, ...((m.p0.add || []).map((a) => a && a.name))]),
  ].filter(Boolean).map(words);
  const modelHas = (ws) => modelFoods.some((mw) => ws.some((w) => mw.some((x) => sameWord(w, x))));
  const claimed = new Set();

  for (const e of readPlateEdits(said)) {
    if (e.op === 'add') {
      if (modelHas(e.words)) continue;                       // the model is adding it, with its amount
      const m = matchPlateFood(rich, e.words);
      if (m.none) { parts.push({ kind: 'add-foods', foods: [{ name: e.food }], from: 'athlete', ...base }); exact = false; }
      else { asks.push({ reason: 'already', verb: 'add', food: e.food, candidates: names(m.candidates || [m.idx]) }); exact = false; }
      continue;
    }
    // "no X, it was Y": the rename or the add is the model's, and it is applied as sent.
    if (e.op === 'remove' && renaming) continue;
    const m = matchPlateFood(rich, e.words);
    let idx = m.idx;
    if (m.candidates) {
      // The model named one of them exactly: that is its pick, and the athlete's word only refines it.
      const pick = model.find((x) => x.exactName && m.candidates.includes(x.idx) && !x.done);
      if (pick && e.op !== 'remove') idx = pick.idx;
      else {
        asks.push({ reason: 'ambiguous', verb: e.verb, food: e.food, candidates: names(m.candidates) });
        for (const x of model) if (m.candidates.includes(x.idx) && onlyAmount(x.p0)) x.done = true;
        exact = false;
        continue;
      }
    }
    if (m.none) {
      if (!modelHas(e.words)) { asks.push({ reason: 'missing', verb: e.verb, food: e.food }); exact = false; }
      continue;
    }
    if (m.composite) {
      asks.push({ reason: 'composite', verb: e.verb, food: e.food, dish: String(rich[idx].name) });
      for (const x of model) if (x.idx === idx && onlyAmount(x.p0)) x.done = true;
      exact = false;
      continue;
    }
    if (claimed.has(idx)) continue;
    const row = rich[idx];
    const mdl = onRow(idx);
    if (e.op === 'remove') {
      const zeroed = mdl && onlyAmount(mdl.p0) && isZero(mdl.p0.quantity);
      // The model says something else about this food (a rename, an amount, a label): its part stands.
      if (mdl && !zeroed && !(onlyAmount(mdl.p0) && !mdl.p0.quantity)) continue;
      if (m.strict || zeroed || (e.take && !m.composite)) {
        claimed.add(idx);
        if (mdl) mdl.done = true; else exact = false;
        parts.push({ kind: 'remove', item: row.name, from: mdl ? 'model' : 'athlete', ...base });
      } else {
        // One shared word ("no chicken" over "Grilled chicken") is never enough to take food off.
        asks.push({ reason: 'confirm', verb: 'remove', food: e.food, candidates: [String(row.name)] });
        exact = false;
      }
      continue;
    }
    // A scale or an amount. A real amount the model sent for this row wins; the athlete's word
    // only names what it was ("double"), so Nia can say it is already counted.
    const f = e.op === 'set' ? 0 : e.verb === 'extra' ? extraFactor(row) : e.factor;
    const q = f ? relQ(row, f) : e.quantity;
    // A model amount that moves the row the OPPOSITE way to the athlete's word ("double" and a stale
    // 6 oz over 8 oz) is out of date: the word, from the baseline, wins (review round 3).
    const mv = mdl && f && absoluteAmount(mdl.p0.quantity, row) ? moveOf(mdl.p0.quantity, row) : 1;
    const stale = (f > 1 && mv < 0.99) || (f < 1 && mv > 1.01);
    if (mdl && absoluteAmount(mdl.p0.quantity, row) && !stale) {
      // The word names the model's amount only when they agree ("double" and 6 oz over a 3 oz read).
      const same = servingsFor(mdl.p0.quantity, q);
      mdl.verb = e.op !== 'set' && same.resolved && Math.abs(same.servings - 1) < 0.01 ? e.verb : '';
      claimed.add(idx);
      continue;
    }
    claimed.add(idx);
    if (f ? atFactor(row, f) : atAmount(q, row)) {
      asks.push({ reason: 'counted', verb: f ? e.verb : '', food: String(row.name), amount: String(row.quantity || '') });
      if (mdl) mdl.done = true;
      exact = false;
      continue;
    }
    if (mdl) {
      // Refine the model's own part: its rename, ingredients or label figures ride along.
      mdl.q = q; mdl.bf = f; mdl.verb = f ? e.verb : '';
      if (stale || (mdl.p0.quantity && !portionFactor(mdl.p0.quantity) && !isZero(mdl.p0.quantity))) exact = false;
    } else {
      parts.push({ kind: 'item', item: row.name, quantity: q, per: {}, ...(f ? { verb: e.verb, baseFactor: f } : {}), from: 'athlete', ...base });
      exact = false;
    }
  }

  for (const x of model) {
    if (x.done) { continue; }
    const { p0, idx } = x;
    const row = idx >= 0 ? rich[idx] : null;
    if (row && claimed.has(idx) && parts.some((p) => p.kind === 'remove' && p.item === row.name)) continue;
    const p = {
      kind: 'item', item: row ? row.name : p0.item, newName: p0.newName || undefined, quantity: x.q || p0.quantity || undefined,
      per: p0.per || {}, perBasis: p0.perBasis || undefined, add: p0.add || undefined, from: 'model', ...base,
    };
    if (x.verb) p.verb = x.verb;
    if (x.bf) p.baseFactor = x.bf;
    // A part with nothing in it (no amount, name, ingredient or figure) has nothing to apply.
    if (onlyAmount(p) && !p.quantity) { exact = false; continue; }
    if (!row) { asks.push({ reason: 'no_match', food: String(p0.item), candidates: names(rich.map((_, i) => i)) }); exact = false; continue; }
    // "0" for a food with nothing else said is the model taking it off the plate.
    if (onlyAmount(p) && isZero(p.quantity)) { parts.push({ kind: 'remove', item: row.name, from: 'model', ...base }); continue; }
    if (p.newName) {
      const r = renameIsAmount(p.newName, row);
      if (r) { p.newName = undefined; if (!x.q) { p.quantity = relQ(row, r.factor); p.verb = r.verb; p.baseFactor = r.factor; } }
      else if (fold(p.newName).trim() === fold(row.name).trim()) {
        // "It was grilled chicken" over a read that already says Grilled chicken: nothing to change.
        p.newName = undefined;
        if (onlyAmount(p) && !p.quantity) { asks.push({ reason: 'counted', verb: '', food: String(row.name), amount: '' }); exact = false; continue; }
      }
    }
    if (p.quantity && !x.q && (!p.verb || servingsWord(p.quantity) != null)) {
      const pf = portionFactor(p.quantity, row);
      const cf = pf ? null : countFactor(p.quantity, row);
      const f = pf || cf;
      if (f) {
        p.verb = pf ? verbOf(p.quantity) : p.verb || '';
        p.quantity = relQ(row, f); p.baseFactor = f;
        if (cf != null) p.rebase = true;   // a count is absolute: it is the new baseline
      }
      else if (!servingsFor(p.quantity, row.quantity || '').resolved && onlyAmount(p)) {
        asks.push({ reason: 'amount', food: String(row.name) });
        exact = false;
        continue;
      }
    }
    if (onlyAmount(p) && (!p.quantity || (p.baseFactor ? atFactor(row, p.baseFactor) : atAmount(p.quantity, row)))) {
      // Nothing to change: the plate already says this. Say so rather than file a receipt of nothing.
      if (p.quantity) asks.push({ reason: 'counted', verb: p.verb || '', food: String(row.name), amount: String(row.quantity) });
      exact = false;
      continue;
    }
    parts.push(p);
  }

  if (Array.isArray(c.missed) && c.missed.length) {
    const foods = c.missed.filter((f) => f && f.name);
    if (foods.length) parts.push({ kind: 'add-foods', foods, from: 'model', ...base });
  }
  return { parts, asks, exact };
}

/** What landed, part by part, in the bounded shape meal-chat composes Nia's words from. */
function doneOf(landed, unpriced) {
  const out = [];
  const skip = new Set((unpriced || []).map((n) => fold(n)));
  for (const p of Array.isArray(landed) ? landed : []) {
    if (!p) continue;
    if (p.kind === 'remove') out.push({ op: 'remove', food: String(p.item) });
    else if (p.kind === 'add-foods') {
      for (const f of p.foods || []) if (f && f.name && !skip.has(fold(f.name))) out.push({ op: 'add', food: String(f.name) });
    } else if (p.kind === 'item') {
      if (p.quantity) out.push(p.verb ? { op: 'scale', verb: p.verb, food: String(p.item), to: String(p.quantity) } : { op: 'amount', food: String(p.item), to: String(p.quantity) });
      if (p.newName) out.push({ op: 'rename', food: String(p.item), newName: String(p.newName) });
      if (p.add && p.add.length) out.push({ op: 'ingredients', food: String(p.item) });
      if (perOf(p) && !p.newName) out.push({ op: 'macros', food: String(p.item) });
    }
  }
  return out.slice(0, 6);
}

/**
 * What happened, in the shape meal-chat's correctionOutcome mode files: applied (and what is still
 * missing), or not applied and the precise things Nia needs to say or ask.
 * `applied` is correctMeal's return (null when nothing landed; `landed` lists the parts that did).
 * `exact` is resolveChatCorrection's: the model's own parts, as described. It only survives when
 * every one of them landed and nothing is left to ask.
 */
export function correctionOutcome({ applied, asks = [], correction = {}, exact = false, parts } = {}) {
  const list = asks.slice(0, 3);
  const ask = list[0] || null;
  const landed = applied && Array.isArray(applied.landed) ? applied.landed : [];
  if (applied && !applied.nothingPriced && applied.moved) {
    const unpriced = (applied.unpriced || []).slice(0, 3);
    const all = !Array.isArray(parts) || landed.length === parts.length;
    return {
      applied: true, exact: !!exact && all && !list.length && !unpriced.length, done: doneOf(landed, unpriced), unpriced,
      ...(ask ? { ask, asks: list } : {}),
    };
  }
  if (applied && applied.nothingPriced) return { applied: false, ask: { reason: 'unpriced', unpriced: (applied.unpriced || []).slice(0, 3) } };
  if (ask) return { applied: false, ask, asks: list };
  if (applied && !applied.moved) {
    const nn = correction && correction.newName ? String(correction.newName) : '';
    return { applied: false, ask: { reason: 'unchanged', newName: nn } };
  }
  return { applied: false, ask: { reason: 'nothing' } };
}
