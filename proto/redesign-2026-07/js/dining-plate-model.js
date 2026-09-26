/* Dining-hall plates for Plan > Today (goals and eating plan, phase C, 2026-09-26).
 *
 * When staff have PUBLISHED today's menu at one of the team's halls, and that hall is serving the
 * period the athlete's up-next meal eats in, Today offers up to two plates built from it. Built
 * here, deterministically, on the athlete's device: no model call, no cost, the same answer every
 * time for the same menu.
 *
 * THE RULES THIS FILE HOLDS
 *  1. ALLERGIES FIRST (dining-menu.js itemAllowed, the filter Nia's menu context shares). An item
 *     whose allergen TAG covers an allergy or intolerance ("contains nuts" covers peanut and tree
 *     nut; "contains dairy" covers milk and lactose), or whose NAME names one (rule terms match
 *     inside words: "buttermilk") or a dislike, is dropped before anything is picked. A "free of"
 *     marker never matches.
 *  2. THE PLATE. A protein first, then a carb, then a vegetable (fruit at breakfast, or when there is
 *     no vegetable), sized so the plate lands near the slot's protein share: a second serving of the
 *     protein only when one leaves the plate well short.
 *  3. ONLY WHAT IS SERVED. Closed for that period (no hours that weekday, or already over), or a menu
 *     that is not today's: no plates.
 *  4. FIGURES ARE ESTIMATES and are only ever printed through ideaMeta, which honors the plan style:
 *     an Intuitive athlete sees none.
 *
 * Pure: no DOM, no storage, no network.
 */
import { namesAny } from './food-prefs.js';
import { cleanMenuItems, cleanMenuText, periodWindow, periodForSlot, HALL_NAME_MAX, isIsoDate, itemAllowed } from './dining-menu.js';

const P = (it) => (it.per_serving && Number(it.per_serving.protein)) || 0;
const K = (it) => (it.per_serving && Number(it.per_serving.kcal)) || 0;
const hasFigures = (it) => !!(it.per_serving && (it.per_serving.protein != null || it.per_serving.kcal != null));

/** Short words for a plate name: "Grilled chicken breast" stays, "(8 oz)" goes. */
const partName = (it) => cleanMenuText(String(it.name).replace(/\s*\([^)]*\)\s*/g, ' '), 32);

/** "Grilled chicken, brown rice and roasted broccoli"; a doubled protein reads "2 servings of
 *  turkey burger, ..." (never "Double turkey burger", which reads like another dish). A plan name is
 *  at most 60 characters, so a long plate first drops the sides' describing words ("roasted
 *  broccoli" becomes "broccoli"), and only then a side. */
export function plateName(parts, servings = 1) {
  const lower = (t) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  const names = parts.filter(Boolean).map(partName).filter(Boolean).map((t, i) => (i ? lower(t) : t));
  if (!names.length) return '';
  if (servings > 1) names[0] = `${servings} servings of ${lower(names[0])}`;
  const join = (ns) => (ns.length === 1 ? ns[0] : `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);
  const lastWord = (t) => t.split(/\s+/).pop();
  const tries = [
    names,
    names.map((t, i) => (i === names.length - 1 && i > 0 ? lastWord(t) : t)),
    names.map((t, i) => (i > 0 ? lastWord(t) : t)),
    names.slice(0, 2),
  ];
  for (const ns of tries) { const j = join(ns); if (j.length <= 60) return j; }
  return names[0].slice(0, 60);
}

/** The items at a hall that this athlete may eat. `allergens` is allergenKeysFrom(restrictions). */
export function safeItems(items, avoid, allergens = []) {
  return cleanMenuItems(items).filter((it) => itemAllowed(it, { avoid: avoid || [], allergens, namesAny }));
}

/** The Plan button for a hall plate: "Plan the turkey burger plate", or "Plan this plate" when the
 *  protein's name is long. */
export function planButtonLabel(idea) {
  const n = cleanMenuText(idea && idea.protein_name, 32).replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return n && n.length <= 18 ? `Plan the ${n.charAt(0).toLowerCase()}${n.slice(1)} plate` : 'Plan this plate';
}

/**
 * Plates for one hall's menu for one period. `target` is the slot's share { protein, kcal } (either
 * may be null: then the richest protein leads and nothing is doubled).
 */
export function platesFromItems(items, { target = {}, period = '', max = 2 } = {}) {
  const proteins = items.filter((i) => i.kind === 'protein');
  if (!proteins.length) return [];
  const carbs = items.filter((i) => i.kind === 'carb');
  const vegs = items.filter((i) => i.kind === 'veg');
  const fruits = items.filter((i) => i.kind === 'fruit');
  const tp = Number(target.protein) > 0 ? Number(target.protein) : null;
  const tk = Number(target.kcal) > 0 ? Number(target.kcal) : null;
  const side = period === 'breakfast' ? (fruits[0] || vegs[0] || null) : (vegs[0] || fruits[0] || null);

  const plates = proteins.map((pr) => {
    // The carb: the one at the protein's station when there is one (a bowl line, a pasta bar),
    // else the one that brings the plate's calories closest to the share, else the first listed.
    const sameStation = pr.station ? carbs.filter((c) => c.station && c.station === pr.station) : [];
    const pool = sameStation.length ? sameStation : carbs;
    let carb = pool[0] || null;
    if (tk && pool.length > 1) {
      const base = K(pr) + (side ? K(side) : 0);
      carb = pool.slice().sort((a, b) => Math.abs(base + K(a) - tk) - Math.abs(base + K(b) - tk))[0];
    }
    const rest = (carb ? P(carb) : 0) + (side ? P(side) : 0);
    const restK = (carb ? K(carb) : 0) + (side ? K(side) : 0);
    // A second serving only when one serving leaves the plate under 75% of the share and two land
    // closer to it. A protein with no figures is never doubled: the app would be guessing.
    let n = 1;
    if (tp && P(pr) > 0 && P(pr) + rest < tp * 0.75 && Math.abs(2 * P(pr) + rest - tp) < Math.abs(P(pr) + rest - tp)) n = 2;
    const parts = [pr, carb, side].filter(Boolean);
    const figured = hasFigures(pr);
    const protein = figured ? n * P(pr) + rest : 0;
    const kcal = figured ? n * K(pr) + restK : 0;
    const fit = tp ? Math.abs(protein - tp) : -protein;
    return { protein: pr, carb, side, servings: n, parts, name: plateName(parts, n), proteinG: protein, kcal, fit, figured };
  }).filter((p) => p.name);

  // Closest to the share first; with no figures, the order staff listed them in.
  plates.sort((a, b) => (a.figured && b.figured ? a.fit - b.fit : a.figured ? -1 : b.figured ? 1 : 0));
  const out = [];
  const seen = new Set();
  for (const p of plates) {
    const k = p.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Today's dining-hall ideas for one meal slot, across the team's halls, best first, at most `max`.
 *
 *   halls    [{ id, name, hours }]
 *   menus    [{ hall_id, menu_date, period, items }]  PUBLISHED rows (anything else is ignored)
 *   date     the athlete's today (ISO)
 *   slot     the up-next slot key
 *   dueMin   the slot's due minute (for a coach's extra slots)
 *   nowMin   minutes since midnight
 *   target   the slot's share { protein, kcal }
 *   avoid     avoidWords(prefs, restrictions)
 *   allergens allergenKeysFrom(restrictions), for the items' allergen tags
 *
 * Each idea: { id, name, protein, kcal, source: 'hall', tags: [], hall, station, protein_name, est: true, verified: false }.
 */
export function buildHallPlates({ halls = [], menus = [], date = '', slot = '', dueMin = null, nowMin = null, target = {}, avoid = [], allergens = [], max = 2 } = {}) {
  if (!isIsoDate(date) || !slot) return [];
  const all = [];
  for (const h of Array.isArray(halls) ? halls : []) {
    if (!h || !h.id) continue;
    const period = periodForSlot(slot, { hours: h.hours, date, dueMin });
    if (!period) continue;
    const w = periodWindow(h.hours, date, period);
    if (!w) continue;                                          // not served that weekday
    if (nowMin != null && Number(nowMin) >= w.to) continue;    // already over for today
    const row = (Array.isArray(menus) ? menus : []).find((m) => m && m.hall_id === h.id && m.period === period
      && (m.menu_date == null || m.menu_date === date) && (m.status == null || m.status === 'published'));
    if (!row) continue;
    const hall = cleanMenuText(h.name, HALL_NAME_MAX);
    for (const p of platesFromItems(safeItems(row.items, avoid, allergens), { target, period, max })) {
      all.push({
        id: `h:${h.id}:${period}:${p.name.toLowerCase()}`,
        name: p.name,
        protein: p.proteinG,
        kcal: p.kcal,
        source: 'hall',
        tags: [],
        hall,
        station: p.protein.station || null,
        protein_name: p.protein.name,
        est: true,
        verified: false,
        fit: p.figured ? p.fit : Infinity,
      });
    }
  }
  all.sort((a, b) => a.fit - b.fit);
  const seen = new Set();
  const out = [];
  for (const i of all) {
    const k = i.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const { fit, ...idea } = i;
    out.push(idea);
    if (out.length >= max) break;
  }
  return out;
}

/** The tag a hall plate wears: "Dining hall: Knights Plaza". */
export function hallTag(idea) {
  return idea && idea.hall ? `Dining hall: ${idea.hall}` : 'Dining hall';
}
