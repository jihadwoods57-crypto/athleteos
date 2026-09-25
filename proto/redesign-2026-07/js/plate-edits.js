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
 * client applies first and reports what happened). And this module makes the common ways people
 * actually say a portion changed land on the right food:
 *
 *   "double chicken", "2x chicken", "chicken x2"   -> that food's portion x2
 *   "triple rice"                                  -> x3
 *   "extra rice"                                   -> x1.5, an honest middle, not a second portion
 *   "half the rice", "half rice"                   -> x0.5
 *   "no sour cream", "without cheese",
 *   "didn't have the rice"                         -> the food comes off the plate
 *   "added guac", "also had a roll", "plus chips"  -> a food the read does not have is added
 *
 * THE ATHLETE'S WORDS OUTRANK THE MODEL'S FIELDS, the same rule statedMacros() applies to a figure
 * read off a bottle: these are matched in their literal message, so what the model chose to put in
 * `quantity` or `newName` cannot turn "double chicken" into a rename called "Double chicken".
 *
 * AMBIGUITY IS A QUESTION, NEVER A GUESS. An edit lands only when exactly one detected food is what
 * the athlete named, and that food is a portion of its own. Two foods that both say chicken ("Grilled
 * chicken" and "Chicken salad"), a chicken that only exists inside a composite dish ("Chicken burrito
 * bowl"), or a food the read never had, all come back as an `ask` that Nia puts to the athlete in
 * her own bubble. Doubling the wrong row is the same lie as doubling nothing, with better manners.
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
  'as', 'had', 'have', 'got', 'get', 'ate', 'when', 'what', 'how', 'there', 'here', 'bro', 'lol']);
/** Words between the verb and the food that say nothing about which food. */
const FILLER = new Set(['the', 'a', 'an', 'of', 'some', 'any', 'my', 'portion', 'portions', 'serving',
  'servings', 'order', 'orders', 'scoop', 'scoops', 'helping', 'helpings', 'side', 'on', 'more']);
/** Name words that carry no identity ("Grilled chicken, sliced" is chicken). */
const PREP = new Set(['with', 'and', 'the', 'of', 'sliced', 'diced', 'chopped', 'fresh', 'plain', 'cooked',
  'about', 'approx', 'style']);
/** A dish, as opposed to one food. "Double chicken" over a "Chicken burrito bowl" says nothing about
 *  the rice and beans in that bowl, so doubling the row would be a guess. */
const DISH = new Set(['salad', 'bowl', 'burrito', 'sandwich', 'wrap', 'taco', 'tacos', 'soup', 'pasta',
  'pizza', 'quesadilla', 'burger', 'sub', 'plate', 'platter', 'nachos', 'curry', 'casserole', 'combo',
  'meal', 'stir', 'omelet', 'omelette', 'scramble', 'hoagie', 'panini', 'melt', 'slider', 'sliders']);

const SCALE_WORDS = [
  // [pattern at the start of the remaining text, factor, verb]; longest first.
  [/^(?:a\s+)?double(?:d)?\s+(?:portion|serving|order|scoop|helping)s?\s+of\b/, 2, 'double'],
  [/^(?:two|2)\s+(?:portions|servings|orders|scoops|helpings)\s+of\b/, 2, 'double'],
  [/^twice\s+(?:as\s+much\s+)?(?:the\s+)?/, 2, 'double'],
  [/^(?:a\s+)?double(?:d)?\b/, 2, 'double'],
  [/^(?:2x|x2)\b/, 2, 'double'],
  [/^(?:triple(?:d)?|3x|x3)\b/, 3, 'triple'],
  [/^extra\b/, 1.5, 'extra'],
  [/^half(?:\s+(?:of|a|an|the))*\b/, 0.5, 'half'],
];
const REMOVE_WORDS = [
  /^(?:no|without|minus|hold\s+the)\b/,
  /^(?:didn't|did\s+not|didnt|never)\s+(?:have|get|eat|want)\b/,
  /^(?:skipped|took\s+off|took\s+out|removed)\b/,
];
const ADD_WORDS = [/^(?:added|add|also\s+had|also\s+got|plus)\b/];

const NEGATED = /\b(?:not|wasn't|wasnt|isn't|isnt|never)\s*$/;
/** Words that follow an edit word without naming a food: "extra protein", "double check". */
const NOT_FOOD = new Set(['protein', 'carb', 'carbs', 'fat', 'fats', 'calorie', 'calories', 'kcal', 'macro', 'macros',
  'score', 'points', 'meal', 'meals', 'plate', 'food', 'time', 'check', 'checked', 'problem', 'worries', 'way',
  'idea', 'clue', 'doubt', 'thanks', 'workout', 'practice', 'lift', 'session', 'day']);

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

/** The food named right after an edit word: up to three words, stopping at the end of the clause. */
function foodAfter(toks, i) {
  let j = i;
  while (j < toks.length && FILLER.has(toks[j])) j++;
  const out = [];
  while (j < toks.length && out.length < 3) {
    const t = toks[j];
    if (t === '.' || STOP.has(t) || FILLER.has(t) || !/^[a-z][a-z'-]*$/.test(t)) break;
    out.push(t);
    j++;
  }
  return out;
}
/** The food named right BEFORE a trailing edit ("chicken x2", "the rice was doubled"). */
function foodBefore(toks, i) {
  const out = [];
  let j = i - 1;
  while (j >= 0 && (toks[j] === 'was' || toks[j] === 'were' || toks[j] === 'is')) j--;
  while (j >= 0 && out.length < 3) {
    const t = toks[j];
    if (t === '.' || STOP.has(t) || FILLER.has(t) || !/^[a-z][a-z'-]*$/.test(t)) break;
    out.unshift(t);
    j--;
  }
  return out;
}

/**
 * Every portion edit in the athlete's own message.
 * Returns [{ op: 'scale'|'remove'|'add', factor?, verb, food, words }], in the order said.
 * A question ("should I get double chicken?") is not a statement about this plate and reads as none.
 */
export function readPlateEdits(said) {
  const t = fold(said);
  if (!t.trim()) return [];
  if (/\?/.test(t) && /\b(should|can|could|would|will|is it|do you)\b/.test(t)) return [];
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
    const before = toks.slice(Math.max(0, i - 2), i).join(' ');
    // Trailing forms: "chicken x2", "chicken 2x", "the rice was doubled".
    if (/^(?:x2|2x|x3|3x|doubled|tripled)$/.test(toks[i]) && i > 0) {
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
    // "it wasn't double chicken" is the opposite of the edit. Say nothing rather than invert it.
    if (hit.op !== 'remove' && NEGATED.test(before)) continue;
    let w = foodAfter(toks, i + hit.len);
    let span = hit.len + w.length;
    // "the rice was double": the food came first.
    if (!w.length && hit.op === 'scale') { w = foodBefore(toks, i); span = hit.len; }
    // "extra protein", "double check", "no problem": an edit word with no food after it is not an edit.
    if (!w.length || NOT_FOOD.has(w[0])) continue;
    const { len, ...edit } = hit;
    push({ ...edit, words: w });
    i += span - 1;
  }
  return out;
}

/**
 * Which detected food a set of words names.
 * Returns { idx } for exactly one own-portion food, { idx, composite } when the one match is a dish
 * the food only sits inside, { candidates: [idx, ...] } for a tie, or { none: true }.
 */
export function matchPlateFood(rich, foodWords) {
  const list = Array.isArray(rich) ? rich : [];
  const want = (Array.isArray(foodWords) ? foodWords : words(foodWords)).map((w) => fold(w)).filter((w) => w.length >= 3);
  if (!want.length || !list.length) return { none: true };
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

/** The amount a quantity WORD describes, relative to what is on the row: "double" 2, "half" 0.5.
 *  Null for a real amount ("8 oz") or for anything vague ("a bit more"). */
export function portionFactor(text) {
  const t = fold(text).trim();
  if (!t) return null;
  for (const [re, factor] of SCALE_WORDS) if (re.test(t)) return factor;
  if (/^(?:x2|2x|two times|2 times)\b/.test(t)) return 2;
  if (/^(?:x3|3x|three times|3 times)\b/.test(t)) return 3;
  return null;
}

const NO_PLURAL = new Set(['oz', 'g', 'gm', 'ml', 'l', 'lb', 'lbs', 'kg', 'tbsp', 'tsp', 'fl', 'large', 'medium', 'small', 'each', 'whole']);
const fmtN = (n) => String(Math.round(n * 100) / 100);

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
      const unit = parts[0];
      const countNoun = /^[a-z]+$/i.test(unit) && !NO_PLURAL.has(unit.toLowerCase());
      if (countNoun && v > 1 && !/s$/i.test(unit)) parts[0] = /(ch|sh|x)$/i.test(unit) ? `${unit}es` : `${unit}s`;
      else if (countNoun && v <= 1 && /s$/i.test(unit)) parts[0] = singular(unit);
      const next = `${fmtN(v)} ${parts.join(' ')}`.slice(0, 40);
      if (servingsFor(next, q).resolved) return next;
    }
  }
  return `${fmtN(f)} serving${f === 1 ? '' : 's'}`;
}

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
function renameIsAmount(newName, rowName) {
  const t = fold(newName);
  const f = portionFactor(t) || (/\b(double|2x|x2)\b/.test(t) ? 2 : /\b(triple|3x|x3)\b/.test(t) ? 3 : /\bhalf\b/.test(t) ? 0.5 : /\bextra\b/.test(t) ? 1.5 : null);
  if (!f) return null;
  const rest = words(t).filter((w) => !/^(double|doubled|triple|tripled|extra|half|portion|serving|order)$/.test(w));
  const own = words(rowName);
  return rest.length && rest.every((w) => own.some((x) => sameWord(w, x))) ? f : null;
}

const onlyAmount = (p) => !p.newName && !(p.add && p.add.length)
  && !(p.per && ['protein', 'kcal', 'carbs', 'fat'].some((k) => p.per[k] != null));

/**
 * The correctMeal parts for one chat correction, with the athlete's own words applied first.
 *
 * `correction` is meal-chat's apply_correction payload; `said` is the athlete's message, verbatim.
 * Returns { parts, asks }: `parts` are what can land unambiguously (possibly none), `asks` what Nia
 * has to ask about instead. Applying what is clear and asking about the rest is the whole rule.
 */
export function resolveChatCorrection(meta, correction, said, { minutesLate } = {}) {
  const rich = Array.isArray(meta && meta.detectedRich) ? meta.detectedRich : [];
  const c = correction || {};
  const parts = [];
  const asks = [];
  const names = (idxs) => idxs.map((i) => String(rich[i].name)).slice(0, 4);
  const claimed = new Set();
  const told = [];   // word lists the athlete's own edits covered, resolved or not
  const base = { minutesLate, said: said || undefined };

  for (const e of readPlateEdits(said)) {
    told.push(e.words);
    const m = matchPlateFood(rich, e.words);
    if (e.op === 'add') {
      if (m.none) parts.push({ kind: 'add-foods', foods: [{ name: e.food }], ...base });
      else asks.push({ reason: 'already', verb: 'add', food: e.food, candidates: names(m.candidates || [m.idx]) });
      continue;
    }
    if (m.none) { asks.push({ reason: 'missing', verb: e.verb, factor: e.factor, food: e.food }); continue; }
    if (m.candidates) { asks.push({ reason: 'ambiguous', verb: e.verb, factor: e.factor, food: e.food, candidates: names(m.candidates) }); continue; }
    if (m.composite) { asks.push({ reason: 'composite', verb: e.verb, factor: e.factor, food: e.food, dish: String(rich[m.idx].name) }); continue; }
    if (claimed.has(m.idx)) continue;
    claimed.add(m.idx);
    const row = rich[m.idx];
    if (e.op === 'remove') parts.push({ kind: 'remove', item: row.name, ...base });
    else parts.push({ kind: 'item', item: row.name, quantity: scaledQuantity(row.quantity, e.factor), per: {}, ...base });
  }

  const touchesTold = (name) => told.some((ws) => { const nw = words(name); return ws.some((w) => nw.some((x) => sameWord(w, x))); });
  const modelItems = [c, ...(Array.isArray(c.more) ? c.more : [])].filter((p) => p && p.item);
  for (const p0 of modelItems) {
    const idx = rowFor(rich, p0.item);
    const row = idx >= 0 ? rich[idx] : null;
    if (row && claimed.has(idx)) continue;                // the athlete's own words already cover it
    const p = {
      kind: 'item', item: p0.item, newName: p0.newName || undefined, quantity: p0.quantity || undefined,
      per: p0.per || {}, perBasis: p0.perBasis || undefined, add: p0.add || undefined, ...base,
    };
    // An amount the athlete described in words the parser above already judged (and maybe asked
    // about) is not the model's to settle by picking a row.
    if (onlyAmount(p) && touchesTold(row ? row.name : p0.item)) continue;
    if (!row) { asks.push({ reason: 'no_match', food: String(p0.item), candidates: names(rich.map((_, i) => i)) }); continue; }
    if (p.newName) {
      const f = renameIsAmount(p.newName, row.name);
      if (f) { p.newName = undefined; p.quantity = scaledQuantity(row.quantity, f); }
    }
    if (p.quantity && !(row.quantity && servingsFor(p.quantity, row.quantity).resolved)) {
      const f = portionFactor(p.quantity);
      if (f) p.quantity = scaledQuantity(row.quantity, f);
      else if (!servingsFor(p.quantity, row.quantity || '').resolved && onlyAmount({ ...p, quantity: undefined })) {
        asks.push({ reason: 'amount', food: String(row.name) });
        continue;
      }
    }
    parts.push(p);
  }

  if (Array.isArray(c.missed) && c.missed.length) {
    // A whole food the athlete's own words already put on the plate (or asked about) is not added twice.
    const foods = c.missed.filter((f) => f && f.name && !touchesTold(f.name));
    if (foods.length) parts.push({ kind: 'add-foods', foods, ...base });
  }
  return { parts, asks };
}

/**
 * What happened, in the shape meal-chat's correctionOutcome mode files: applied (and what is still
 * missing), or not applied and the one precise thing Nia needs to ask.
 * `applied` is correctMeal's return (null when nothing landed).
 */
export function correctionOutcome({ applied, asks = [], correction = {} } = {}) {
  const ask = asks[0] || null;
  if (applied && !applied.nothingPriced && applied.moved) {
    return { applied: true, unpriced: (applied.unpriced || []).slice(0, 3), ...(ask ? { ask } : {}) };
  }
  if (applied && applied.nothingPriced) return { applied: false, ask: { reason: 'unpriced', unpriced: (applied.unpriced || []).slice(0, 3) } };
  if (ask) return { applied: false, ask };
  if (applied && !applied.moved) {
    const nn = correction && correction.newName ? String(correction.newName) : '';
    return { applied: false, ask: { reason: 'unchanged', newName: nn } };
  }
  return { applied: false, ask: { reason: 'nothing' } };
}
