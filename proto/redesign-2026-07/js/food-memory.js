/* Food Memory — the pure half of the Plan intelligence hub.
 *
 * WHY THIS EXISTS. The Plan page learns what THIS athlete actually eats: usual meals, saved
 * restaurant orders, the places behind them. Everything with a testable rule lives here —
 * repeat detection ("you've eaten this 3x"), saved-meal matching, remaining-day math, the
 * What-Should-I-Eat fit ranking, and the bounded context handed to analyze-meal.
 *
 * THE ACCURACY HIERARCHY (basis, most→least trusted): 'label' (printed claims) > 'database'
 * (exact resolved product) > 'confirmed' (a saved meal the athlete repeats/confirmed) >
 * 'estimate' (photo read). Memory is a SIGNAL, never a verdict: a match calibrates the read,
 * and anything uncertain still gets confirmed by the athlete.
 *
 * Pure and Node-importable: no DOM, no storage, no network (tested in food-memory.test.mjs).
 */

export const MIN_REPEATS = 3;      // logs of the same plate before we offer to save it
export const REPEAT_WINDOW_DAYS = 14; // matches the recent-meals cache window

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

/** Athlete-authored text that will reach a prompt or another surface: strip anything that
 *  could read as markup or an instruction boundary, collapse whitespace, hard-cap length.
 *  Same rule as _shared/memory.ts clean(). */
export function cleanText(v, max = 60) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/[<>{}[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Order-insensitive signature of a plate from its food names, so the same meal photographed
 *  on different days (foods listed in any order) groups as ONE repeated meal. */
export function mealSignature(names) {
  const set = [...new Set((names || [])
    .map((n) => norm(typeof n === 'string' ? n : n && n.name))
    .filter(Boolean))];
  return set.sort().join('|');
}

/** Most common value in a list (ties → first seen). */
function mode(values) {
  const counts = new Map();
  let best = null, bestN = 0;
  for (const v of values) {
    if (!v) continue;
    const n = (counts.get(v) || 0) + 1;
    counts.set(v, n);
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

/**
 * Passive learning: scan recent meal rows for plates eaten >= minRepeats times that are not
 * already saved and not dismissed. Rows are `meals` rows ({name, detected[], protein, kcal,
 * carbs, fat, fiber}). Returns save-suggestions with averaged macros — lightweight prompts
 * the athlete can accept or dismiss in one tap, never a database to maintain.
 */
export function findRepeats(rows, savedSignatures, dismissedSignatures, minRepeats = MIN_REPEATS) {
  const saved = savedSignatures instanceof Set ? savedSignatures : new Set(savedSignatures || []);
  const dismissed = dismissedSignatures instanceof Set ? dismissedSignatures : new Set(dismissedSignatures || []);
  const groups = new Map();
  for (const r of rows || []) {
    if (!r || r.flagged) continue;
    const sig = mealSignature(Array.isArray(r.detected) && r.detected.length ? r.detected : [r.name]);
    // A one-food signature from a generic slot name ("Dinner") groups everything — skip it.
    if (!sig || /^(breakfast|lunch|dinner|snack|meal(-\d)?)$/.test(sig)) continue;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(r);
  }
  const out = [];
  for (const [sig, g] of groups) {
    if (g.length < minRepeats || saved.has(sig) || dismissed.has(sig)) continue;
    const avg = (k) => Math.round(g.reduce((a, r) => a + (Number(r[k]) || 0), 0) / g.length);
    // Zero-macro groups are pending/broken reads, not a meal worth remembering.
    if (!avg('protein') && !avg('kcal')) continue;
    out.push({
      signature: sig,
      name: cleanText(mode(g.map((r) => r.name)) || 'Repeated meal', 80),
      count: g.length,
      foods: [...new Set(g.flatMap((r) => (Array.isArray(r.detected) ? r.detected : [])).map((n) => cleanText(n, 40)).filter(Boolean))].slice(0, 8),
      protein: avg('protein'), kcal: avg('kcal'), carbs: avg('carbs'), fat: avg('fat'),
      fiber: avg('fiber'),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Word-level overlap between a new meal and one saved item, 0..1. */
function overlapScore(item, foods, name) {
  const itemWords = new Set(
    [item.name, ...(Array.isArray(item.items) ? item.items.map((c) => c && c.name) : [])]
      .flatMap((s) => norm(s).split(/[^a-z0-9]+/)).filter((w) => w.length > 2)
  );
  if (!itemWords.size) return 0;
  const mealWords = new Set(
    [name, ...(foods || []).map((f) => (typeof f === 'string' ? f : f && f.name))]
      .flatMap((s) => norm(s).split(/[^a-z0-9]+/)).filter((w) => w.length > 2)
  );
  if (!mealWords.size) return 0;
  let hit = 0;
  for (const w of mealWords) if (itemWords.has(w)) hit++;
  return hit / Math.max(itemWords.size, mealWords.size);
}

/** Best saved-item match for a newly logged meal, or null. Memory is a signal: the threshold
 *  is deliberately high so a weak echo never claims "this is your usual". */
export function matchSaved(items, foods, name, threshold = 0.6) {
  let best = null, bestScore = 0;
  for (const it of items || []) {
    if (!it || it.status === 'archived') continue;
    const s = overlapScore(it, foods, name);
    if (s > bestScore) { best = it; bestScore = s; }
  }
  return best && bestScore >= threshold ? { item: best, score: bestScore } : null;
}

/** Remaining-day math. A missing target stays null — the UI shows numbers only for targets
 *  that are actually set, never an invented default. */
export function remainingToday({ proteinSoFar, kcalSoFar, proteinTarget, kcalTarget }) {
  const rem = (target, soFar) => {
    const t = Number(target);
    if (!Number.isFinite(t) || t <= 0) return null;
    return Math.max(0, Math.round(t - (Number(soFar) || 0)));
  };
  return { protein: rem(proteinTarget, proteinSoFar), kcal: rem(kcalTarget, kcalSoFar) };
}

/**
 * What Should I Eat: rank the athlete's OWN saved meals by fit against what's left of the day.
 * Never recommends random "healthy foods" they've never eaten — the candidate pool IS their
 * memory. Protein that closes the gap scores; kcal past remaining (+15% grace) costs; a
 * coach-verified item wins ties; frequency breaks the rest.
 */
export function rankForRemaining(items, remaining, max = 3) {
  const r = remaining || {};
  const scored = (items || [])
    .filter((it) => it && it.status !== 'archived' && ((Number(it.protein) || 0) > 0 || (Number(it.kcal) || 0) > 0))
    .map((it) => {
      const p = Number(it.protein) || 0, k = Number(it.kcal) || 0;
      let score = 0;
      if (r.protein != null) score += Math.min(p, r.protein) - 0.25 * Math.max(0, p - r.protein);
      else score += p * 0.5;
      if (r.kcal != null && k > r.kcal * 1.15) score -= (k - r.kcal * 1.15) / 20;
      if (it.verified_at) score += 5;
      score += Math.log2(1 + (Number(it.times_logged) || 1));
      return { item: it, score, over: r.kcal != null && k > r.kcal * 1.15 };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max);
}

/**
 * The bounded, sanitized saved-meal context for analyze-meal — the memory-first half of the
 * read. Caps mirror memory.ts: memory must never become an unbounded athlete-writable region
 * of the prompt. Most-logged and verified items first; numbers clamped to sane ranges.
 */
export function memoryContextForAnalysis(items, places, maxItems = 10) {
  const placeName = new Map((places || []).map((p) => [p.id, cleanText(p.name, 40)]));
  const clampN = (v, hi) => Math.max(0, Math.min(hi, Math.round(Number(v) || 0)));
  return (items || [])
    .filter((it) => it && it.status !== 'archived')
    .slice()
    .sort((a, b) => (b.verified_at ? 1 : 0) - (a.verified_at ? 1 : 0)
      || (Number(b.times_logged) || 0) - (Number(a.times_logged) || 0))
    .slice(0, maxItems)
    .map((it) => ({
      name: cleanText(it.name, 60),
      ...(it.place_id && placeName.get(it.place_id) ? { place: placeName.get(it.place_id) } : {}),
      protein: clampN(it.protein, 500), kcal: clampN(it.kcal, 5000),
      carbs: clampN(it.carbs, 1000), fat: clampN(it.fat, 500),
      ...(it.verified_at ? { verified: true } : {}),
    }))
    .filter((c) => c.name && (c.protein > 0 || c.kcal > 0));
}

/** A memory-item draft from a logged slot (meta = slotMacros[slot]) — the "save this as your
 *  usual" acceptance path. detectedRich carries per-item macros when the AI attributed them. */
export function itemFromMeal(meta, opts = {}) {
  if (!meta) return null;
  const rich = Array.isArray(meta.detectedRich) ? meta.detectedRich : [];
  const clampN = (v, hi) => Math.max(0, Math.min(hi, Math.round(Number(v) || 0)));
  return {
    name: cleanText(opts.name || meta.name || 'Saved meal', 120) || 'Saved meal',
    kind: opts.kind || 'meal',
    items: rich.slice(0, 8).map((f) => ({
      name: cleanText(f.name, 60),
      ...(f.quantity ? { quantity: cleanText(f.quantity, 30) } : {}),
      ...(f.brand ? { brand: cleanText(f.brand, 40) } : {}),
      ...(f.product ? { product: cleanText(f.product, 60) } : {}),
      protein: clampN(f.protein, 500), kcal: clampN(f.kcal, 5000),
      carbs: clampN(f.carbs, 1000), fat: clampN(f.fat, 500),
      ...(f.basis ? { basis: String(f.basis).slice(0, 12) } : {}),
    })),
    protein: clampN(meta.protein, 500), kcal: clampN(meta.kcal, 5000),
    carbs: clampN(meta.carbs, 1000), fat: clampN(meta.fat, 500),
    fiber: clampN(meta.fiber, 100),
    // A meal whose every number came off a label keeps that trust; an athlete-confirmed
    // repeated plate is 'confirmed'; anything else stays an estimate the athlete vouched for.
    basis: rich.length && rich.every((f) => f.basis === 'label' || f.basis === 'database')
      ? 'database' : 'confirmed',
  };
}

/** The dominant readable brand on a plate (prefill for "Places I Eat"), or null. */
export function dominantBrand(detectedRich) {
  return mode((detectedRich || []).map((f) => cleanText(f && f.brand, 40))) || null;
}
