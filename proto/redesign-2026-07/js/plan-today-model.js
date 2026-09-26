/* Plan > Today, the pure half (goals and eating plan, phase A1, 2026-09-25).
 *
 * Today stopped being a list of what already happened and became the next decision: which meal is
 * up next, about how much of it, three ideas for it, and one button that plans it. Everything with
 * a rule lives here so it can be tested in Node; js/plan-today.js only draws it.
 *
 * THE RULES THIS FILE HOLDS
 *  1. ONE SLOT MODEL. The slots are the coach standard's own (RT.stdMeals) or the classic day, with
 *     the snack LAST, and "required" is exactly the set S.mealDayProgress counts, so the Plan's
 *     "meals left" and Nia's "your last N meals" are the same number.
 *  2. ONE DIVISION. The per-meal target is meal-opener's own math (perMealProtein, "Land around
 *     Xg at each of your last N meals"), ported here and pinned to it by plan-today.test.mjs.
 *  3. A PLAN IS NOT FOOD. checkin.plans only ever PLANS a meal. Nothing here turns a plan into
 *     logged macros: the ring fills from what the camera read, and the plan draws a ghost.
 *  4. NUMBERS ARE PER FIGURE. An Intuitive athlete gets no macro or calorie figure anywhere this
 *     file writes words; each figure sits behind its own surface flag.
 */
import { rankForRemaining } from './food-memory.js';
import { namesAny, cleanTags, tagLabel } from './food-prefs.js';
import { hallTag } from './dining-plate-model.js';

/** The classic day's slots, snack last (the 4-meal model: Breakfast, Lunch, Dinner, Snack). */
export const CLASSIC_REQUIRED = ['breakfast', 'lunch', 'dinner'];
export const CLASSIC_ALL = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * The day's meal slots in the order Plan shows them.
 * `std` is RT.stdMeals (null on the classic day). With a standard every slot is required, exactly
 * as state.js reqMealSlots() counts them; the snack still goes last wherever it sits.
 */
export function slotOrder(std) {
  const own = std && Array.isArray(std.slots) && std.slots.length ? std.slots.map(String) : null;
  const all = own ? own.slice() : CLASSIC_ALL.slice();
  const snackLast = [...all.filter((k) => k !== 'snack'), ...all.filter((k) => k === 'snack')];
  return { all: snackLast, required: own ? own.slice() : CLASSIC_REQUIRED.slice() };
}

/**
 * What one meal should carry so the day lands. meal-opener.ts perMealProtein, ported: with more
 * than one required meal left, the gap split evenly and rounded to `step` (never under `step`);
 * with one left, the whole gap; with none left (only the optional snack), the whole gap too,
 * which is what the opener means by "a protein-forward snack tonight closes most of that".
 * 0 when nothing is left.
 */
export function perMealShare(gap, remaining, step = 5) {
  const g = Math.round(Number(gap));
  const r = Math.round(Number(remaining));
  if (!Number.isFinite(g) || g <= 0) return 0;
  if (!Number.isFinite(r) || r <= 1) return g;
  return Math.max(step, Math.round(g / r / step) * step);
}

const clampN = (v, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(hi, n)) : 0;
};
const cleanName = (v, max = 60) => String(v == null ? '' : v).replace(/[<>{}[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Where a plan came from: a usual, Nia, a dining-hall plate (C), or one of the three planning screens. */
export const PLAN_SOURCES = ['usual', 'nia', 'hall', 'search', 'label', 'barcode'];

/** One stored plan, re-sanitized on read (the day row is client-written jsonb). null = none. */
export function cleanPlan(p) {
  if (!p || typeof p !== 'object') return null;
  const name = cleanName(p.name);
  if (!name) return null;
  return {
    name,
    protein: clampN(p.protein, 500),
    kcal: clampN(p.kcal, 5000),
    source: PLAN_SOURCES.includes(p.source) ? p.source : 'usual',
    at: typeof p.at === 'string' ? p.at.slice(0, 32) : null,
  };
}

/** A plan from a chosen idea. `at` is an ISO timestamp. */
export function planFromIdea(idea, at) {
  return cleanPlan({ name: idea && idea.name, protein: idea && idea.protein, kcal: idea && idea.kcal, source: idea && idea.source, at });
}

/**
 * The whole Today picture from the live day. Every input is plain data, so a test can build any
 * state without the app.
 *
 *   order     slotOrder(std)
 *   meals     DAY.meals (slot -> logged)
 *   scored    (slot) => counts toward the score (state's mealScored; a duplicate photo does not)
 *   macros    DAY.slotMacros
 *   plans     DAY.plans
 *   deadline  (slot) => minute-of-day the slot is due (deadline + grace)
 *   nowMin    minutes since midnight
 *   target    { protein, kcal } the day is graded against (DAY.proteinTarget / DAY.calTarget)
 *   consumed  { protein, kcal } S.dayConsumed (scored slots only)
 *   focus     a slot the athlete tapped to plan instead, or null
 */
export function buildToday({ order, meals = {}, scored, macros = {}, plans = {}, deadline, nowMin = 0, target = {}, consumed = {}, focus = null }) {
  const isScored = typeof scored === 'function' ? scored : (k) => !!meals[k];
  const due = typeof deadline === 'function' ? deadline : () => 1440;
  const required = new Set(order.required);
  const slots = order.all.map((key) => {
    const m = macros[key] || null;
    const logged = !!meals[key];
    return {
      key,
      required: required.has(key),
      logged,
      late: !logged && nowMin > due(key),
      plan: logged ? null : cleanPlan(plans && plans[key]),
      read: logged && m ? {
        name: cleanName(m.name) || null,
        protein: clampN(m.protein, 500),
        kcal: clampN(m.kcal, 5000),
        quality: Number.isFinite(Number(m.quality)) && m.quality != null ? clampN(m.quality, 100) : null,
        pending: !!m.pending,
        failed: !!m.analysisFailed,
      } : null,
    };
  });
  const open = slots.filter((s) => !s.logged);
  const mealsRemaining = order.required.filter((k) => !isScored(k)).length;
  const focusSlot = focus ? open.find((s) => s.key === focus) : null;
  // Up next: the first required meal still on time; else, with every window passed, the LATEST
  // required meal still open (dinner at 11 PM, never breakfast; late still counts); else, with
  // every required meal in, the optional snack.
  const upNext = focusSlot
    || open.find((s) => s.required && !s.late)
    || [...open].reverse().find((s) => s.required)
    || open[0]
    || null;
  const left = {
    protein: target.protein > 0 ? Math.max(0, Math.round(target.protein - (Number(consumed.protein) || 0))) : null,
    kcal: target.kcal > 0 ? Math.max(0, Math.round(target.kcal - (Number(consumed.kcal) || 0))) : null,
  };
  // The next slot's share: split across the REQUIRED meals still open. The optional snack only
  // gets a share once every required meal is in (then it is the whole gap, as the opener says);
  // tapped open while required meals remain, it carries no number rather than the whole day's.
  const share = (gap, step) => (gap == null || !upNext ? null
    : upNext.required ? perMealShare(gap, mealsRemaining, step)
      : mealsRemaining === 0 ? perMealShare(gap, 0, step) : null);
  const planned = { protein: 0, kcal: 0 };
  for (const s of open) if (s.plan) { planned.protein += s.plan.protein; planned.kcal += s.plan.kcal; }
  return {
    slots,
    upNext: upNext ? upNext.key : null,
    later: open.filter((s) => !upNext || s.key !== upNext.key).map((s) => s.key),
    logged: slots.filter((s) => s.logged).map((s) => s.key),
    left,
    mealsRemaining,
    slotTarget: { protein: share(left.protein, 5), kcal: share(left.kcal, 50) },
    planned,
    allRequiredIn: mealsRemaining === 0,
    allIn: open.length === 0,
  };
}

/**
 * A LATER row's one line (fix round 2026-09-25): each slot says its own thing. Planned: the plan's
 * name. Numbers styles: "About Ng protein" (or calories when only those show), the same split the
 * card uses. Intuitive: "Ideas ready". An optional slot while required meals remain: "Optional".
 * Ideas themselves appear only when the slot is tapped into the card.
 */
export function laterLine(T, slot, { showMacros, showCalories }) {
  const s = (T.slots || []).find((x) => x.key === slot);
  if (!s) return '';
  if (s.plan) return s.plan.name;
  if (!s.required && !T.allRequiredIn) return 'Optional';
  if (!showMacros && !showCalories) return 'Ideas ready';
  const rem = s.required ? T.mealsRemaining : 0;
  if (showMacros && T.left.protein > 0) return `About ${perMealShare(T.left.protein, rem)}g protein`;
  if (showCalories && T.left.kcal > 0) return `About ${perMealShare(T.left.kcal, rem, 50).toLocaleString('en-US')} cal`;
  return 'Ideas ready';
}

/** How full the protein ring is, and where the ghost of the planned meals ends. 0..1 each. */
export function ringFractions({ target, consumed, planned }) {
  const t = Number(target) || 0;
  if (t <= 0) return { fill: 0, ghost: 0 };
  const fill = Math.max(0, Math.min(1, (Number(consumed) || 0) / t));
  const ghost = Math.max(fill, Math.min(1, ((Number(consumed) || 0) + (Number(planned) || 0)) / t));
  return { fill, ghost };
}

/**
 * Up to `max` ideas for a slot. Phase C: today's dining-hall plates lead (at most 2, built from the
 * published menu by dining-plate-model.js), because they are real food being served right now.
 * Then the athlete's own usuals, ranked for what the slot should carry (food-memory.js
 * rankForRemaining, the ranking Plan has always used), then Nia's ideas to fill. Anything that
 * names an allergy, an intolerance or a dislike is dropped, hall plates and usuals included.
 */
export function rankIdeas({ usuals = [], nia = [], hall = [], slotTarget = {}, avoid = [], max = 3 }) {
  const safe = (usuals || []).filter((it) => it && it.status !== 'archived'
    && !namesAny([it.name, ...(Array.isArray(it.items) ? it.items.map((x) => x && x.name) : [])], avoid));
  const rem = { protein: slotTarget.protein > 0 ? slotTarget.protein : null, kcal: slotTarget.kcal > 0 ? slotTarget.kcal : null };
  const plates = (Array.isArray(hall) ? hall : []).filter((h) => h && h.source === 'hall' && cleanName(h.name) && !namesAny([h.name], avoid))
    .slice(0, Math.min(2, max)).map((h) => ({
      id: String(h.id || `h:${cleanName(h.name).toLowerCase()}`).slice(0, 120),
      name: cleanName(h.name),
      protein: clampN(h.protein, 500),
      kcal: clampN(h.kcal, 5000),
      source: 'hall',
      tags: [],
      hall: cleanName(h.hall, 40) || null,
      station: cleanName(h.station, 30) || null,
      protein_name: cleanName(h.protein_name, 40) || null,
      est: true,
      verified: false,
    }));
  const out = plates.concat(rankForRemaining(safe, rem, max - plates.length).map(({ item }) => ({
    id: `u:${item.id}`,
    name: cleanName(item.name),
    protein: clampN(item.protein, 500),
    kcal: clampN(item.kcal, 5000),
    source: 'usual',
    tags: [],
    verified: !!item.verified_at,
  })).filter((x) => x.name));
  const seen = new Set(out.map((x) => x.name.toLowerCase()));
  for (const n of Array.isArray(nia) ? nia : []) {
    if (out.length >= max) break;
    const name = cleanName(n && n.name);
    if (!name || seen.has(name.toLowerCase()) || namesAny([name], avoid)) continue;
    seen.add(name.toLowerCase());
    out.push({ id: `n:${out.length}:${name.toLowerCase()}`, name, protein: clampN(n.protein, 500), kcal: clampN(n.kcal, 5000), source: 'nia', tags: cleanTags(n.tags), verified: false });
  }
  return out;
}

/** The line under an idea's name: its figures when the style shows them, else where it came from.
 *  A dining-hall plate's figures are estimates from the menu, so they read "About"; its station
 *  leads when the menu names one. */
export function ideaMeta(idea, { showMacros, showCalories }) {
  const bits = [];
  if (showMacros && idea.protein > 0) bits.push(`${idea.protein}g protein`);
  if (showCalories && idea.kcal > 0) bits.push(`${Number(idea.kcal).toLocaleString('en-US')} cal`);
  if (idea.source === 'hall') {
    const figs = bits.length ? `About ${bits.join(' · ')}` : "From today's menu";
    return idea.station ? `${idea.station} · ${figs}` : figs;
  }
  if (bits.length) return bits.join(' · ');
  return idea.source === 'usual' ? 'One of your usuals' : 'A new idea';
}

/** The line under a PLANNED meal: its figures when the style shows them, else "Your plan". */
export function planMeta(plan, { showMacros, showCalories }) {
  const bits = [];
  if (showMacros && plan.protein > 0) bits.push(`${plan.protein}g protein`);
  if (showCalories && plan.kcal > 0) bits.push(`${Number(plan.kcal).toLocaleString('en-US')} cal`);
  if (plan.source === 'hall') return bits.length ? `About ${bits.join(' · ')} · Dining hall` : 'From the dining hall';
  return bits.length ? bits.join(' · ') : 'Your plan';
}

/** The tag an idea wears: a dining-hall plate always says which hall; else the first preference it
 *  fits, else where it came from (numbers styles only; an Intuitive athlete's meta line already
 *  says it). '' for none. */
export function ideaTag(idea, numbers) {
  if (idea.source === 'hall') return hallTag(idea);
  const t = (idea.tags || []).map(tagLabel).find(Boolean);
  if (t) return t;
  if (!numbers) return idea.verified ? 'Coach verified' : '';
  return idea.source === 'usual' ? (idea.verified ? 'Coach verified' : 'Usual') : 'New';
}

/** The button's words: "Plan Chicken bowl". A name cut at a word, never mid-word. */
export function shortName(name, max = 22) {
  let n = cleanName(name).replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  // Too long: the dish is usually the words before a comma or a "with" ("Turkey, rice and black
  // bean bowl" is a turkey plate; "Chicken bowl with extra rice" is a chicken bowl).
  if (n.length > max) {
    const head = n.split(/,|\s+with\s+/i)[0].trim();
    if (head.length >= 3) n = head;
  }
  let out = '';
  for (const w of n.split(/\s+/).filter(Boolean)) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max && out) break;
    out = next;
  }
  return out.replace(/[,&\-]+$/, '').replace(/\s+(and|with|or|of|&)$/i, '').trim();
}

/** "Tonight's plan" for dinner, "Lunch plan" for the rest. */
export function planHeading(slot, title) {
  return slot === 'dinner' ? "Tonight's plan" : `${title} plan`;
}

/** "Land around 45g protein · 900 cal" / "Build it like the plate." / null when nothing to say. */
export function slotTargetLine(t, { showMacros, showCalories }) {
  if (!showMacros && !showCalories) return 'Build it like the plate.';
  const bits = [];
  if (showMacros && t.protein > 0) bits.push(`${t.protein}g protein`);
  if (showCalories && t.kcal > 0) bits.push(`${Number(t.kcal).toLocaleString('en-US')} cal`);
  return bits.length ? `Land around ${bits.join(' · ')}` : null;
}

/**
 * The goal as a word, plus the weight range for an ADULT with a goal weight. Unknown age reads as
 * adult (0050 and the 2026-09-22 guardian ruling); a provable minor never gets a weight figure,
 * and neither does an Intuitive athlete, whose plan keeps numbers off their screen.
 */
export function goalWords({ goalKey, current, target, minor, intuitive }) {
  const k = String(goalKey || '').toLowerCase();
  const label = k === 'gain' || k === 'build' || k === 'gain_muscle' || k === 'gain_weight' ? 'Gaining'
    : k === 'lose' || k === 'lose_fat' ? 'Losing fat'
      : k === 'maintain' || k === 'health' ? 'Maintaining'
        : k === 'perform' || k === 'performance' ? 'Fueling to perform' : null;
  if (!label) return null;
  const c = Number(current), t = Number(target);
  const range = !minor && !intuitive && Number.isFinite(c) && c > 0 && Number.isFinite(t) && t > 0 && current != null && target != null
    ? `${Math.round(c)} to ${Math.round(t)} lb` : null;
  return { label, range };
}

/* ---- the client's cache of Nia's ideas: one per athlete, day and slot ----
   The server keeps the authoritative copy (plan_ideas, 0250) and never re-bills a hit; this copy is
   what lets opening Plan skip even the round trip. `store` is localStorage (or a stand-in). */
const IDEAS_KEY = (uid) => `os.planIdeas.${uid}`;

export function readIdeasCache(store, uid, day, slot, key) {
  try {
    const j = JSON.parse(store.getItem(IDEAS_KEY(uid)) || 'null');
    const hit = j && j.day === day && j.slots && j.slots[slot];
    return hit && hit.key === key && Array.isArray(hit.ideas) && hit.ideas.length ? hit.ideas : null;
  } catch { return null; }
}

export function writeIdeasCache(store, uid, day, slot, key, ideas) {
  // An empty answer is never kept: a later open may ask again (within the server's daily cap).
  if (!Array.isArray(ideas) || !ideas.length) return false;
  try {
    const j = JSON.parse(store.getItem(IDEAS_KEY(uid)) || 'null');
    // Only today is kept: yesterday's ideas are never shown again, so they are never stored.
    const next = j && j.day === day ? j : { day, slots: {} };
    next.slots[slot] = { key, ideas: Array.isArray(ideas) ? ideas.slice(0, 3) : [] };
    store.setItem(IDEAS_KEY(uid), JSON.stringify(next));
    return true;
  } catch { return false; }
}
