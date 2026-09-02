/* OnStandard — Meal Intelligence helpers (pure; no DOM, no state).
   Owns: detected-food normalization + the new analysis extras, the DERIVED AI
   opening message (never stored — both athlete and coach threads render it from
   the same meal data, so it can't be forged and costs nothing), reaction/message
   splitting, and the meal-chat context builder with its 8KB clamp.

   ONE import, and it is deliberate: nutrition.js is a pure leaf too (no imports of
   its own, so no cycle). applyMealCorrection prices athlete-added ingredients from
   the curated reference rather than taking a number out of the AI's prose, and it
   imports the pricer instead of accepting one, so a call site cannot silently lose
   pricing by forgetting to inject it. */
import { priceAddedFood, servingsFor } from './nutrition.js';

const clean = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, 200);

/** Legacy string arrays and rich {name, confidence, quantity?} arrays both normalize to rich.
 *  quantity (0062: "2 eggs", "1 cup rice") rides through cleaned + capped; absent stays absent.
 *  Per-food macros (Tier 1 per-food attribution) ride through as a bounded `per` object —
 *  accepted either flat off the wire (d.protein…) or already nested (d.per.protein…) so a
 *  result survives sessionStorage round-trips; absent stays absent (older edge deploys). */
export function normalizeDetected(detected) {
  if (!Array.isArray(detected)) return [];
  const num = (v) => { const n = Math.round(Number(v)); return isFinite(n) && n > 0 ? Math.min(2000, n) : 0; };
  return detected.slice(0, 8).map((d) => {
    if (typeof d === 'string') return { name: clean(d), confidence: 'high' };
    const c = d && d.confidence;
    const out = { name: clean(d && d.name), confidence: c === 'low' || c === 'medium' ? c : 'high' };
    const q = d && d.quantity;
    if (typeof q === 'string' && q.trim()) out.quantity = clean(q).slice(0, 40);
    const src = d && (d.per && typeof d.per === 'object' ? d.per : d);
    if (src && ['protein', 'kcal', 'carbs', 'fat'].some((k) => num(src[k]) > 0)) {
      out.per = { protein: num(src.protein), kcal: num(src.kcal), carbs: num(src.carbs), fat: num(src.fat) };
    }
    if (d && d.edited) out.edited = true;
    // portionEdited is NOT edited, and the difference is the whole point. `edited` means the
    // curated reference for this food's NAME no longer describes it (the athlete renamed it, or
    // told us it also had egg and cheese), so grounding must stop clamping against that
    // reference. Correcting the PORTION says nothing of the kind: it is the same food, there is
    // just more or less of it, and the reference still describes it perfectly at the new
    // amount. Conflating the two is what let a portion correction bypass grounding entirely.
    if (d && d.portionEdited) out.portionEdited = true;
    if (d && d.userAdded) out.userAdded = true;
    // Provenance (Core Power fix 2026-08-06): where this ITEM's numbers came from, and which
    // exact product it is. 'label' = read off its packaging in the photo; 'database' = resolved
    // from the product cache. These survive normalization because everything downstream —
    // grounding (label items skip the DB clamp), confidence (an unresolved package caps the
    // read), enrichment (label reads warm the product cache), the breakdown UI, and the chat
    // context — keys off them.
    if (d && (d.basis === 'label' || d.basis === 'database')) out.basis = d.basis;
    if (d && (d.kind === 'packaged' || d.kind === 'beverage' || d.kind === 'condiment' || d.kind === 'prepared')) out.kind = d.kind;
    if (d && typeof d.brand === 'string' && d.brand.trim()) out.brand = clean(d.brand).slice(0, 40);
    if (d && typeof d.product === 'string' && d.product.trim()) out.product = clean(d.product).slice(0, 80);
    return out;
  }).filter((d) => d.name);
}

/** Ground the new analysis extras (fiber / highlights / detected / detailed analysis) to
 *  honest bounds. `analysis` is the AI's athlete-facing paragraph (0062) — clamped to 1200
 *  chars, markup stripped; '' when the (old) edge fn didn't send one so every renderer can
 *  fall back to `note`. */
export function groundExtras(raw) {
  const r = raw || {};
  const fiber = Math.max(0, Math.min(60, Math.round(Number(r.fiber) || 0)));
  const highlights = (Array.isArray(r.highlights) ? r.highlights : [])
    .slice(0, 3).map((h) => clean(h).slice(0, 120)).filter(Boolean);
  const detectedRich = normalizeDetected(r.detected);
  const analysis = String(r.analysis == null ? '' : r.analysis).replace(/[<>]/g, '').slice(0, 1200);
  return { fiber, highlights, detectedRich, detectedNames: detectedRich.map((d) => d.name), analysis };
}

/**
 * Pre-log food edit (WS4 — "user can edit for accuracy"): one reducer for every mutation of the
 * staged MEAL.result, keeping detectedRich (rich renderers) and detected (legacy flat names,
 * what logMeal persists as `foods`) in lockstep. Mutates `result` in place (it IS the staged
 * capture); returns true when something changed. This reducer touches only the food ARRAYS —
 * totals/quality/text recompute deterministically in state.recomputeStagedMeal, which every
 * edit surface calls right after a successful edit (session isolation: a deleted food must
 * leave the totals, the score inputs, and the prose, not just the list).
 * op: { kind:'remove'|'rename'|'quantity'|'add', name, newName?, quantity? }
 */
export function applyFoodEdit(result, op) {
  if (!result || !op || !op.kind) return false;
  const rich = Array.isArray(result.detectedRich) ? result.detectedRich : (result.detectedRich = []);
  const flat = Array.isArray(result.detected) ? result.detected : (result.detected = []);
  const name = clean(op.name);
  const idx = rich.findIndex((d) => d && d.name === name);
  const flatIdx = flat.indexOf(name);
  switch (op.kind) {
    case 'remove': {
      if (idx === -1) return false;
      rich.splice(idx, 1);
      if (flatIdx !== -1) flat.splice(flatIdx, 1);
      result.userRemoved = true; // no row left to mark — flag the result so the edit hint shows
      return true;
    }
    case 'rename': {
      const nn = clean(op.newName).slice(0, 60);
      if (idx === -1 || !nn || nn === name) return false;
      rich[idx].name = nn;
      rich[idx].edited = true;
      if (flatIdx !== -1) flat[flatIdx] = nn; else flat.push(nn);
      return true;
    }
    /* THE ATHLETE IS THE BEST PORTION SENSOR IN THE LOOP, and until now this branch ignored
       them. It wrote the new string, set `edited`, and stopped. `edited` makes groundFood skip
       the plausibility band entirely, and nothing ever touched the item's macros, so typing
       "2 cups" over the AI's "1 cup" moved a label and not one number. Worse, hasUserEdits
       then went true and the breakdown printed "Macros and score recalculated from the foods
       listed" over a recalculation that had not happened. The product's own rule, written into
       the meal-chat prompt, is that the athlete holding the food outranks the log reading it.

       So a portion correction now RESCALES the item. The ratio comes from comparing the new
       quantity to the old one with servingsFor, which is unit-aware, so "8 oz" over "4 oz" is
       two and not eight. When the two strings cannot be compared honestly ("a bit more" over
       "1 cup") nothing is invented: the string updates, `edited` is set exactly as before, and
       the old behaviour stands. */
    case 'quantity': {
      if (idx === -1) return false;
      const q = clean(op.quantity).slice(0, 40);
      const prev = rich[idx].quantity;
      const per = rich[idx].per;
      const ratio = q && prev ? servingsFor(q, prev) : { servings: 1, resolved: false };
      if (q) rich[idx].quantity = q; else delete rich[idx].quantity;
      if (ratio.resolved && per && ratio.servings !== 1) {
        const s = ratio.servings;
        rich[idx].per = {
          protein: Math.max(0, Math.round((per.protein || 0) * s)),
          kcal: Math.max(0, Math.round((per.kcal || 0) * s)),
          carbs: Math.max(0, Math.round((per.carbs || 0) * s)),
          fat: Math.max(0, Math.round((per.fat || 0) * s)),
        };
        // portionEdited, NOT edited: the athlete told us how MUCH, not WHAT, so the curated
        // reference still describes this food and grounding should keep sanity-checking it
        // against the corrected portion. The edit still shows in the UI (hasUserEdits).
        rich[idx].portionEdited = true;
      } else {
        rich[idx].edited = true;
      }
      return true;
    }
    case 'add': {
      const nn = clean(op.name).slice(0, 60);
      if (!nn || rich.length >= 8 || rich.some((d) => d && d.name === nn)) return false;
      const item = { name: nn, confidence: 'high', userAdded: true };
      const q = clean(op.quantity).slice(0, 40);
      if (q) item.quantity = q;
      rich.push(item);
      flat.push(nn);
      return true;
    }
    default: return false;
  }
}

/** Remove one detected line and take its numbers with it — the professional-lane removal
 *  (ob2-nutrition's "tap × to remove a wrong line"), shared by the operator meal screen and
 *  the athlete-side reconciliation so the math exists exactly ONCE. Deterministic: when the
 *  item carries per-food numbers they are subtracted (clamped at zero) and the meal re-scores
 *  through mealQualityScore, same as an item correction; an unpriced item leaves the totals
 *  standing and the summary says so out loud (never a silent fake recompute). Follows
 *  applyMealCorrection's contract: orig frozen once, corrections log capped at 8, src never
 *  mutated. Returns null when the name matches nothing. */
export function applyFoodRemoval(src, name, { by, minutesLate } = {}) {
  if (!src || !name) return null;
  const orig = src.orig || {
    protein: src.protein || 0, carbs: src.carbs || 0, fat: src.fat || 0, kcal: src.kcal || 0,
    fiber: src.fiber || 0, quality: src.quality != null ? src.quality : null,
  };
  const next = {
    ...src, orig,
    detectedRich: Array.isArray(src.detectedRich) ? src.detectedRich.map((d) => ({ ...d })) : [],
    detected: Array.isArray(src.detected) ? src.detected.slice() : [],
  };
  const clean = String(name).trim();
  const item = next.detectedRich.find((d) => d && d.name === clean);
  if (!item) return null;
  if (!applyFoodEdit(next, { kind: 'remove', name: clean })) return null;
  const per = item.per && typeof item.per === 'object' ? item.per : null;
  if (per) {
    next.protein = Math.max(0, Math.round((next.protein || 0) - (Number(per.protein) || 0)));
    next.carbs = Math.max(0, Math.round((next.carbs || 0) - (Number(per.carbs) || 0)));
    next.fat = Math.max(0, Math.round((next.fat || 0) - (Number(per.fat) || 0)));
    next.kcal = Math.max(0, Math.round((next.kcal || 0) - (Number(per.kcal) || 0)));
    const q = mealQualityScore({
      macros: next, fiber: next.fiber || 0, detected: next.detectedRich,
      minutesLate: minutesLate != null ? minutesLate : (next.minutesLate || 0),
    });
    if (q != null) { next.quality = q; delete next.qualityAdj; }
  }
  next.corrections = [
    ...(Array.isArray(src.corrections) ? src.corrections : []),
    { kind: 'item', item: item.name, removed: true, ...(by ? { by } : {}) },
  ].slice(-8);
  const summary = per
    ? `Removed ${item.name}`
    : `Removed ${item.name} (it had no itemized numbers, so the totals stand)`;
  return { meta: next, summary };
}

/** True when the staged plate was touched by the athlete (row edited/added, or any food
 *  removed) — drives the honest edit hint next to the breakdown ("recalculated" when the
 *  per-food recompute ran; "macros stay the AI's estimate" when it couldn't). */
export function hasUserEdits(result) {
  return !!(result && (result.userRemoved || (Array.isArray(result.detectedRich)
    && result.detectedRich.some((d) => d && (d.edited || d.portionEdited || d.userAdded)))));
}

/** Slot timing for the analyze-meal request (0062): pure clamped minutes, computed on the
 *  athlete's clock at capture time — the server only formats these, never derives timing.
 *  Null when the inputs aren't honest numbers (the request simply omits timing). */
export function analysisTiming(nowMin, deadlineMin) {
  const n = Number(nowMin), d = Number(deadlineMin);
  if (!isFinite(n) || !isFinite(d) || n < 0 || d < 0 || n > 1600 || d > 1600) return null;
  const minutesLate = Math.max(0, Math.round(n - d));
  const minutesLeft = Math.max(0, Math.round(d - n));
  return { deadlineMin: Math.round(d), minutesLate, minutesLeft };
}

/* ================================================================================
   ESTIMATE HONESTY (meal-conversation upgrade 2026-07-16)
   Photo reads are estimates and must present as estimates: ranges sized by the
   AI's own confidence, "approximately" language, and never a false-precision "0g".
   ================================================================================ */

/** A ranged presentation of one estimated value. Width follows confidence:
 *  high ±10%, medium ±18%, low ±28% (floor ±3 so small values still show a band).
 *  Exact sources (nutrition label, athlete-entered) should NOT route through this. */
export function estRange(value, confidence = 'medium') {
  const v = Math.max(0, Math.round(Number(value) || 0));
  const pct = confidence === 'high' ? 0.10 : confidence === 'low' ? 0.28 : 0.18;
  const spread = Math.max(3, Math.round(v * pct));
  const lo = Math.max(0, v - spread), hi = v + spread;
  return { lo, hi, mid: v, text: `${lo}–${hi}`, approx: `~${v}` };
}

/** Overall confidence of a photo estimate, from the detected foods' own confidences.
 *  'exact' for label/manual sources (no range needed). */
export function estimateConfidence(source, detected) {
  if (source === 'label' || source === 'manual') return 'exact';
  const rich = Array.isArray(detected) ? detected : [];
  if (!rich.length) return 'medium';
  if (rich.some((d) => d && d.confidence === 'low')) return 'low';
  if (rich.some((d) => d && d.confidence === 'medium')) return 'medium';
  // A read is only as confident as its biggest guess: a PACKAGED product whose macros are still
  // a visual estimate (no label read, no product-cache resolution, no exact product named) can
  // be a whole different variant — never present that plate as "high confidence".
  if (rich.some((d) => d && (d.kind === 'packaged' || d.kind === 'beverage')
    && d.basis !== 'label' && d.basis !== 'database' && !d.product)) return 'medium';
  return 'high';
}

/** Calorie-share-weighted overall confidence, for the accuracy verify trigger (spec item 6 §5).
 *  Each food contributes a weight (high=1, medium=0.5, low=0) scaled by its kcal share; the
 *  weighted mean maps back to a band, so a small low-confidence item can't drag a well-read
 *  plate down. Foods without kcal are weighted equally as a fallback. Distinct from
 *  estimateConfidence (which drives display and stays "any low -> low"). */
export function weightedConfidence(detected) {
  const rich = Array.isArray(detected) ? detected.filter(Boolean) : [];
  if (!rich.length) return 'medium';
  const score = (c) => (c === 'high' ? 1 : c === 'medium' ? 0.5 : 0);
  const kcalOf = (d) => Math.max(0, Number(d.kcal) || 0);
  const totalKcal = rich.reduce((s, d) => s + kcalOf(d), 0);
  const weight = (d) => (totalKcal > 0 ? kcalOf(d) / totalKcal : 1 / rich.length);
  const mean = rich.reduce((s, d) => s + score(d.confidence) * weight(d), 0);
  if (mean >= 0.75) return 'high';
  if (mean >= 0.35) return 'medium';
  return 'low';
}

/** Pure gate for the second-pass verifier (spec item 6 §3). Fires on exactly two cases:
 *  (a) allergen: severe restriction AND any food is low-confidence (per-food, so a single
 *      uncertain item that could hide an allergen still fires);
 *  (b) accuracy: calorie-weighted confidence is low AND the read looks off (quality<50).
 *  allergen wins ties; no fire for non-photo sources or spent budget. */
export function shouldVerify({ detected, quality, source, severeRestrictions, budgetLeft } = {}) {
  const none = { fire: false, trigger: null };
  if (source !== 'photo') return none;
  if (!(Number(budgetLeft) > 0)) return none;
  const foods = Array.isArray(detected) ? detected.filter(Boolean) : [];
  const anyLow = foods.some((d) => d.confidence === 'low');
  const hasSevere = Array.isArray(severeRestrictions) && severeRestrictions.length > 0;
  if (hasSevere && anyLow) return { fire: true, trigger: 'allergen' };
  const q = Number(quality);
  if (weightedConfidence(foods) === 'low' && isFinite(q) && q < 50) {
    return { fire: true, trigger: 'accuracy' };
  }
  return none;
}

/** What the second pass actually did, for effectiveness telemetry (ai_calls.outcome).
 *  allergen_caught if the re-scan flagged an allergen the first read didn't; else
 *  macros_moved if kcal or protein shifted >15%; else no_change. */
export function classifyVerifyOutcome(first, second) {
  const firstAllergens = (first && Array.isArray(first.allergensFound)) ? first.allergensFound : [];
  const secondAllergens = (second && Array.isArray(second.allergensFound)) ? second.allergensFound : [];
  if (secondAllergens.some((a) => !firstAllergens.includes(a))) return 'allergen_caught';
  const moved = (a, b) => {
    const x = Number(a) || 0, y = Number(b) || 0;
    return Math.abs(y - x) / Math.max(1, x) > 0.15;
  };
  if (moved(first && first.kcal, second && second.kcal)) return 'macros_moved';
  if (moved(first && first.protein, second && second.protein)) return 'macros_moved';
  return 'no_change';
}

/* Produce vocabulary for the fiber-consistency guard: if any of these is visible on the
   plate, feedback must never claim "no fiber" — the estimate may be wrong, not the plate. */
const PRODUCE_TERMS = ['asparagus', 'broccoli', 'spinach', 'salad', 'greens', 'kale', 'beans',
  'lentil', 'pea', 'carrot', 'pepper', 'tomato', 'onion', 'zucchini', 'squash', 'cauliflower',
  'brussels', 'cabbage', 'corn', 'avocado', 'berr', 'apple', 'banana', 'orange', 'fruit',
  'grape', 'melon', 'mango', 'pear', 'oat', 'quinoa', 'brown rice', 'whole', 'vegetable', 'veg'];
export function hasVisibleProduce(detected) {
  const names = (Array.isArray(detected) ? detected : [])
    .map((d) => String(d && d.name != null ? d.name : d).toLowerCase());
  return names.some((n) => PRODUCE_TERMS.some((t) => n.includes(t)));
}

/* Goal ties — why this meal matters for THEIR objective, athlete and client goals both. */
const GOAL_TIE = {
  gain: 'keeps the calorie floor and the protein climbing',
  lose: 'keeps you inside the window without starving the work',
  maintain: 'holds the line, and consistency is the whole game',
  perform: 'fuels performance and speeds recovery',
  build: 'keeps the build fueled, never under',
  health: 'buys steady energy and habits that hold',
};

/**
 * The AI Nutritionist's opening message — DERIVED from stored meal data, never persisted.
 * WS5 (founder direction 2026-07-15): this is now the SINGLE AI-insight surface on the logged
 * screen — timing accountability first ("Late on lunch, this isn't the standard" / "Good job
 * getting it in on time"), then the detailed `analysis` paragraph (or the legacy one-line
 * `note` + goal tie when analysis is absent), highlights folded in as one sentence, then the
 * coach-target deference line. Returns a plain string (render through esc()).
 *
 * `late` is a tri-state: `true`/`false` render the timing sentence; `null` means the caller
 * couldn't honestly determine timing (e.g. a coach device reading a pre-0062 row with no
 * minutes_late) — the timing sentence is omitted entirely rather than guessed. `undefined`
 * behaves like `false` (existing callers). `minutesLate` (0062, persisted on the meals row)
 * sharpens the late sentence with the real number when present.
 */
export function openingMessage({
  name, quality, note, analysis, highlights, goal, coachTargets, late, minutesLate,
  // Upgrade 2026-07-16 — real context, all optional (absent = sentence omitted, never invented):
  detected,       // rich detected foods (drives estimate confidence + consistency)
  source,         // 'live' | 'gallery' | 'manual' | 'label'
  day,            // { proteinSoFar, proteinTarget, mealsRemaining } — REAL day math from the engine
  patterns,       // array of pattern strings from mealPatterns() — real history only
  impact,         // integer: how many Daily Score points this log actually earned (engine-computed)
} = {}) {
  // NEVER REPEAT THE SCREEN, NEVER RUN LONG (founder 2026-08-04, tightened 2026-08-05): a coach
  // texts FOUR sentences — takeaway, one move, the day framed forward as the next decision. The
  // client clamps anything past the core with "Read more". Same contract as the server composer
  // (meal-opener.ts) so the fallback and the persisted opener speak with one voice.
  const parts = [];
  const who = clean(name) || 'this one';
  // 1. The read itself: takeaway, then the one adjustment, then at most one more sentence, kept
  // WHOLE. The hard 400-char slice that stood here could cut the adjustment mid-word, and the
  // adjustment is the whole point of the message (2026-09-02; same rule as meal-opener.ts's
  // readCore). A boundary is a terminator followed by whitespace, so "3.5 oz" never splits.
  const raw = String(analysis == null ? '' : analysis).replace(/[<>]/g, '');
  const deep = (raw.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [raw])
    .map((x) => x.trim()).filter(Boolean).slice(0, 3).join(' ').slice(0, 520);
  if (deep) {
    parts.push(deep);
  } else {
    // Legacy path (pre-0062 rows / old edge fn): the one-line note + goal tie carry the read.
    if (note) parts.push(clean(note));
    const tie = GOAL_TIE[goal];
    if (tie && quality != null) {
      parts.push(quality >= 75 ? `A plate like this ${tie}.` : `Tightening this plate up ${tie}.`);
    }
  }
  // 2. ONE specific move, when the read itself carries none. A highlight is NOT a move: the
  // schema defines highlights as micronutrient notes ("Collard greens add iron and vitamin K"),
  // and standing one here read as narration, then trivia, then the day. It rides in step 4b now.
  const hl = (Array.isArray(highlights) ? highlights : []).map((h) => clean(h)).filter(Boolean).slice(0, 1);
  if (!deep && quality != null && quality < 75) {
    parts.push('One upgrade next time: add a protein or a vegetable and this score jumps.');
  }
  // 3. The day, framed forward as the next decision — per-meal math, never a restatement.
  if (day && day.proteinTarget > 0 && day.proteinSoFar != null) {
    const gap = Math.round(day.proteinTarget) - Math.round(day.proteinSoFar);
    const rem = day.mealsRemaining;
    if (gap <= 0) {
      parts.push('That closes out your protein for the day. Nothing left to chase there.');
    } else if (rem != null && rem > 1) {
      const per = Math.max(5, Math.round(gap / rem / 5) * 5);
      parts.push(`Land around ${per}g of protein at each of your last ${rem} meals and you'll hit today's target without forcing the last one.`);
    } else if (rem === 1) {
      parts.push(`One meal left. Bring it in around ${gap}g of protein and the day closes out.`);
    }
  } else if (coachTargets && coachTargets.protein) {
    parts.push(`Coach's bar is ${coachTargets.protein}g protein on the day, and every meal moves it.`);
  }
  // 4. ONE real history line, when it exists — mealPatterns() returns [] until there's data.
  for (const p of (Array.isArray(patterns) ? patterns : []).slice(0, 1)) parts.push(clean(p));
  // 4b. ONE micronutrient highlight, read-more territory, terminated like a sentence.
  for (const h of hl) parts.push(/[.!?]$/.test(h) ? h : `${h}.`);
  // 5. Timing — only when it needs saying; on-time praise lives in the score chips now.
  if (late === true) {
    const mins = (typeof minutesLate === 'number' && isFinite(minutesLate) && minutesLate > 0)
      ? `, ${Math.round(minutesLate)} min past the window` : '';
    parts.push(`And ${who} went in late${mins}. Logging it late still counts; hiding it doesn't.`);
  }
  // 6. Score impact — engine-computed accountability credit, stated plainly.
  if (typeof impact === 'number' && isFinite(impact) && impact > 0) {
    parts.push(`This log moved your Daily Score by +${Math.round(impact)}.`);
  }
  // 7. What the photo can't show — only when the read carries real uncertainty, and voiced as a
  // confident pro inviting the one detail that sharpens the numbers, never an apology (founder
  // 2026-08-11). Same line the server opener uses, so the two composers speak with one voice.
  const conf = estimateConfidence(source, detected);
  if (conf !== 'exact' && conf !== 'high' && source !== 'manual') {
    parts.push(`If anything was cooked or portioned differently than it looks, tell me and I'll tighten the numbers.`);
  }
  return parts.filter(Boolean).join(' ').slice(0, 1500);
}

/* ---------- Meal quality vs compliance (founder feedback 2026-07-16) ----------
   Two different concepts that used to share one green: GREEN means "you did the work"
   (logged, on time). Quality gets its own band and color so a 58 never wears success
   green. Banded once here so every surface (chip, quality line, coach view) agrees. */

/** Quality band for a 0-100 meal score. Null when there's no honest score. */
export function qualityBand(score) {
  if (score == null) return null; // Number(null) is 0 — don't band a missing score as "low"
  const s = Number(score);
  if (!isFinite(s)) return null;
  if (s >= 75) return { cls: 'good', label: 'Strong' };
  if (s >= 50) return { cls: 'mid', label: 'Needs work' };
  return { cls: 'low', label: 'Weak plate' };
}

/** One plain-English line explaining WHY the quality score is what it is, from the
 *  macro split alone (calorie shares: protein/carbs 4 kcal per g, fat 9). Without this
 *  line the number reads as arbitrary. '' when there are no macros to reason from.
 *
 *  CONSISTENCY GUARD (upgrade 2026-07-16): feedback must never contradict the plate.
 *  When visible produce is on the detected list, a low fiber NUMBER is treated as an
 *  estimate gap, not a fact — the copy softens to "fiber looks lighter than the plate
 *  suggests" and a 0 reading with produce visible is skipped entirely. */
export function qualityReason(macros, fiber, detected) {
  const m = macros || {};
  const p = Math.max(0, Number(m.protein) || 0);
  const c = Math.max(0, Number(m.carbs) || 0);
  const f = Math.max(0, Number(m.fat) || 0);
  const total = p * 4 + c * 4 + f * 9;
  if (!total) return '';
  const issues = [];
  if ((p * 4) / total < 0.2) issues.push('protein came in low next to the carbs and fat');
  if ((f * 9) / total > 0.45) issues.push('fat ran above the range');
  const fib = Math.max(0, Number(fiber) || 0);
  const produce = hasVisibleProduce(detected);
  if (fib < 4 && c >= 30) {
    if (!produce) issues.push('almost no fiber');
    else if (fib > 0) issues.push('fiber reads lighter than the plate suggests');
    // produce visible + fiber estimate of 0: the estimate is the suspect — say nothing false
  }
  if (!issues.length) return 'Protein, carbs, and fat are in balance on this plate.';
  const s = issues.slice(0, 2).join(' and ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

/**
 * The 5-second read (founder feedback 2026-07-16): the AI Nutritionist's opening bubble
 * is now three labeled lines — what went well, the biggest opportunity, the concrete fix —
 * with the full openingMessage() paragraph behind a "View full analysis" expander.
 * Derived from the same stored meal data as openingMessage, so it can't drift from it.
 */
/* The Intuitive read: what was on the plate and what to notice about it — never a calorie or
   macro figure, never a food graded good or bad, never a fix to apply. An athlete on this plan is
   building the skill of reading their own signals, and a number handed to them short-circuits
   exactly the thing the plan is trying to teach. Same inputs, different vocabulary. */
function intuitiveSummary({ detected, fiber, late, deadlineClock, highlights } = {}) {
  const names = (Array.isArray(detected) ? detected : [])
    .map((d) => clean(String(d && d.name != null ? d.name : d))).filter(Boolean);
  const hasProtein = names.some((n) => /salmon|chicken|beef|steak|turkey|egg|fish|tuna|pork|shrimp|tofu|yogurt|cottage|bean|lentil/i.test(n));
  const hasProduce = hasVisibleProduce(detected) || Math.max(0, Number(fiber) || 0) >= 5;

  const good = [];
  if (late === false) good.push(deadlineClock ? `You logged before your ${deadlineClock} deadline` : 'Logged on time');
  else if (late === true) good.push('You got it logged, and late still beats hidden');
  if (hasProtein && hasProduce) good.push('this plate has a protein anchor and something fresh on it');
  else if (hasProtein) good.push('there is a real protein anchor here');
  else if (hasProduce) good.push('there is something fresh on the plate');
  else {
    const hl = (Array.isArray(highlights) ? highlights : []).map((h) => clean(h)).filter(Boolean);
    if (hl.length) good.push(hl[0].charAt(0).toLowerCase() + hl[0].slice(1));
  }

  return {
    wentWell: good.length ? `${good.join(', and ')}.` : '',
    // An observation to sit with, not a deficiency to correct.
    opportunity: hasProtein && hasProduce
      ? 'Worth noticing how full and how steady you feel a couple of hours from now.'
      : hasProtein
        ? 'Worth noticing whether this one holds you, or whether hunger comes back early.'
        : 'Worth noticing how long this one carries you before you are hungry again.',
    // No instruction to log a feeling: the meal-time prompt that used to ask for one is gone.
    next: 'No fix needed. Notice how it leaves you over the next couple of hours; that is the pattern worth having.',
  };
}

/** @param {{quality?: number, macros?: any, fiber?: number, highlights?: string[],
 *  late?: boolean | null, goal?: string, detected?: any[], source?: string,
 *  deadlineClock?: string, day?: any, numbers?: boolean, tone?: string}} [o]
 *  (explicit because two bindings carry defaults, which narrows TS's inference of the rest) */
export function openingSummary({
  quality, macros, fiber, highlights, late, goal,
  // Upgrade 2026-07-16 — all optional; absent context is omitted, never invented:
  detected, source, deadlineClock, day,
  // Plan style (0142): 'numbers' false suppresses every macro FIGURE for the athlete, and
  // 'signals' tone drops good/bad plate language for pattern language. The read itself is
  // unchanged — the same plate, described the way this athlete's plan talks about food.
  numbers = true, tone = 'guidance',
} = {}) {
  if (!numbers || tone === 'signals') return intuitiveSummary({ detected, fiber, late, deadlineClock, highlights });
  const m = macros || {};
  const p = Math.max(0, Number(m.protein) || 0);
  const hl = (Array.isArray(highlights) ? highlights : []).map((h) => clean(h)).filter(Boolean);
  const conf = estimateConfidence(source, detected);
  const est = conf !== 'exact';
  // The visible protein source, for "the visible salmon likely provides…" phrasing.
  const mainProtein = (Array.isArray(detected) ? detected : [])
    .map((d) => String(d && d.name != null ? d.name : d))
    .find((n) => /salmon|chicken|beef|steak|turkey|egg|fish|tuna|pork|shrimp|tofu|yogurt|cottage/i.test(n));

  // What went well: the accountability act first (with the real deadline when known),
  // then the plate's best fact — ranged when it's a photo estimate.
  const good = [];
  if (late === false) good.push(deadlineClock ? `You logged before your ${deadlineClock} deadline` : 'Logged on time');
  else if (late === true) good.push('You got it logged, and late still beats hidden');
  if (p >= 25) {
    const pTxt = est ? `about ${estRange(p, conf).text}g of protein` : `${Math.round(p)}g of protein`;
    const src = mainProtein ? `the visible ${clean(mainProtein).toLowerCase()} likely provides ${pTxt}` : `protein showed up at ${est ? '~' : ''}${Math.round(p)}g`;
    const meets = day && day.proteinTarget > 0 && p >= Math.round(day.proteinTarget / 4);
    good.push(src + (meets ? ', which meets your meal target' : ''));
  } else if (Math.max(0, Number(fiber) || 0) >= 5) good.push('real fiber on the plate');
  else if (hl.length) good.push(hl[0].charAt(0).toLowerCase() + hl[0].slice(1));
  const wentWell = good.length ? `${good.join(', and ')}.` : '';

  // Biggest opportunity: ONE thing, produce-consistency-guarded, uncertainty-aware.
  const reason = qualityReason(m, fiber, detected);
  const balanced = reason.indexOf('in balance') !== -1;
  let opportunity = balanced && quality != null && quality >= 75
    ? 'Not much. This plate works.'
    : reason;
  if (est && opportunity && !balanced && /fiber|fat ran/i.test(opportunity)) {
    opportunity = opportunity.replace(/\.$/, '') + ". If the plate looked different in person, tell me and I'll adjust it.";
  }

  // Next time: a concrete fix mapped to that opportunity, never generic advice.
  let next = '';
  if (/protein came in low/i.test(reason)) next = 'Add a lean protein next time: a bigger egg portion, Greek yogurt, or chicken.';
  else if (/fat ran above/i.test(reason)) next = 'Trim the heaviest item and keep the rest as is.';
  else if (/fiber/i.test(reason)) next = hasVisibleProduce(detected)
    ? 'Double the vegetables or add one piece of fruit.'
    : 'Add a fruit or a vegetable and this same meal scores higher.';
  else {
    const tie = GOAL_TIE[goal];
    next = tie ? `Keep this in rotation. It ${tie}.` : 'Keep this one in rotation.';
  }
  return { wentWell, opportunity, next };
}

/** Reaction rows (kind='reaction') grouped as [{emoji, count}], insertion-ordered. */
/** The one-tap acknowledgements a coach can leave. ONE set, ONE order — the coach screen used to
 *  render two different bars ('🔥💪👏👍' above the thread, '💪🔥👏✅' below it), so which emoji a
 *  thumb landed on depended on which bar you happened to hit. Legacy 👍 rows still render through
 *  reactionGroups; this only governs what is OFFERED. */
export const REACTION_EMOJI = ['🔥', '💪', '👏', '✅'];

export function reactionGroups(comments) {
  const counts = new Map();
  for (const c of comments || []) {
    if (c && c.kind === 'reaction' && c.text) counts.set(c.text, (counts.get(c.text) || 0) + 1);
  }
  return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }));
}

/** Message rows only (reactions and private coach notes excluded; rows without kind are
 *  messages). Private notes never reach the athlete anyway (RLS) — this keeps the coach's
 *  own thread view clean too; the coach screen renders notes in their own margin section. */
export function threadMessages(comments) {
  return (comments || []).filter((c) => c && c.kind !== 'reaction' && c.kind !== 'note');
}

/** Private coach notes only (kind='note') — the coach-side margin section. */
export function privateNotes(comments) {
  return (comments || []).filter((c) => c && c.kind === 'note');
}

const CONTEXT_MAX = 8192;

/** Client-composed deterministic context for meal-chat. Clamped to 8KB by dropping
    oldest recentMeals first, then oldest thread messages — newest context survives.
    Contract: `recentMeals` MUST be passed oldest→newest (ascending). This function drops
    from the front (index 0) of the array when clamping, so a caller that hands it
    newest-first data (e.g. raw DB order) will have its newest meals dropped instead. */
/**
 * THE CLARIFYING MOMENT (Honest Vision): pair the model's clarifying questions with the
 * athlete's typed answers into the exact `clarifications` shape the analyze-meal edge function
 * wants on phase 'finalize'. An UNANSWERED question is dropped (the model then estimates that
 * part instead of being handed a blank), so "Skip" and "answer only some" both stay honest.
 * Same caps as the edge function (question <=300, answer <=500), newlines collapsed, so a
 * pasted answer can't inflate the finalize call. Pure — unit-tested in protoMealClarify.test.
 */
export function buildClarifications(questions, answers) {
  const qs = Array.isArray(questions) ? questions : [];
  const as = Array.isArray(answers) ? answers : [];
  const out = [];
  for (let i = 0; i < qs.length && i < 5; i++) {
    const q = String(qs[i] == null ? '' : qs[i]).replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
    const a = String(as[i] == null ? '' : as[i]).replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    if (q && a) out.push({ question: q, answer: a });
  }
  return out;
}

export function contextForChat({ meal, plan, exec, day, recentMeals, thread } = {}) {
  const ctx = {
    meal: meal || {},
    plan: plan || {},
    exec: exec || {},
    // Where TODAY stands in macros (proteinSoFar / proteinTarget / mealsRemaining) — `exec`
    // carries requirement counts, which told the AI how many boxes were ticked but not where
    // the day's fuel actually sat, so its "coaching" couldn't reference the day (founder
    // 2026-08-10: reference the athlete's daily progress). Same engine source as the meal
    // screen's day bars, so the two can never disagree.
    day: day || {},
    recentMeals: Array.isArray(recentMeals) ? recentMeals.slice() : [],
    thread: Array.isArray(thread) ? thread.slice(-20) : [],
  };
  const size = () => JSON.stringify(ctx).length;
  while (size() > CONTEXT_MAX && ctx.recentMeals.length) ctx.recentMeals.shift();
  while (size() > CONTEXT_MAX && ctx.thread.length > 1) ctx.thread.shift();
  return ctx;
}

/* ---------------- Restriction comparison (spec §18.3/§18.4) ----------------
   Compares detected food names with the athlete's saved restrictions. HONEST BY DESIGN:
   a hit is a "possible conflict" (name-level match only), and NO hit never claims safety —
   detection can miss ingredients, preparation methods, and cross-contact. Pure. */
export function restrictionConflicts(detectedNames, restrictions) {
  const r = restrictions && typeof restrictions === 'object' ? restrictions : {};
  const foods = (Array.isArray(detectedNames) ? detectedNames : [])
    .map((f) => String(f && f.name != null ? f.name : f).toLowerCase());
  // Common-ingredient synonyms so category restrictions catch their obvious members
  // ("Dairy" hits milk/cheese; "Tree nuts" hits almonds). Deliberately modest — this is
  // name-level matching, and the UI copy never claims it's complete.
  const SYNONYMS = {
    dairy: ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'whey'],
    gluten: ['bread', 'pasta', 'wheat', 'flour', 'toast', 'bun', 'tortilla', 'cracker'],
    'tree nuts': ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut'],
    shellfish: ['shrimp', 'crab', 'lobster', 'scallop', 'clam', 'oyster', 'mussel'],
    fish: ['salmon', 'tuna', 'tilapia', 'cod', 'trout'],
    eggs: ['egg', 'omelet', 'omelette', 'frittata'],
    soy: ['tofu', 'edamame', 'soy'],
    wheat: ['bread', 'pasta', 'flour', 'toast'],
  };
  // A restriction matches when any detected food contains its stem or a known synonym
  // ("peanuts" → "peanut butter"; "Dairy" → "milk").
  const hit = (name) => {
    const key = String(name || '').toLowerCase().trim();
    const stem = key.replace(/s$/, '');
    const terms = [stem, ...(SYNONYMS[key] || [])].filter((t) => t.length >= 3);
    return terms.some((t) => foods.some((f) => f.includes(t)));
  };
  const severe = [], moderate = [], noted = [];
  for (const a of Array.isArray(r.allergies) ? r.allergies : []) {
    if (hit(a.name)) (a.severity === 'severe' ? severe : moderate).push(a.name);
  }
  for (const n of Array.isArray(r.intolerances) ? r.intolerances : []) if (hit(n)) noted.push(n);
  return { severe, moderate, noted, any: !!(severe.length || moderate.length || noted.length) };
}

/* ================================================================================
   HISTORICAL PATTERNS (upgrade 2026-07-16) — real history only, never invented.
   Input: recentMeals ASCENDING (oldest→newest), the same rows fetchRecentMeals
   returns: { type, protein, quality, minutes_late, day_date }. Patterns require a
   minimum sample before they may speak (2 for a streak, 3+ for a rate).
   ================================================================================ */
export function mealPatterns(recentMeals, { slot, mealProteinBar } = {}) {
  const rows = (Array.isArray(recentMeals) ? recentMeals : [])
    .filter((r) => r && r.type === slot && r.day_date);
  const out = [];
  if (rows.length < 2) return out; // not enough real history for ANY claim
  const slotName = String(slot || 'meal');
  const plural = /(ch|sh|s|x|z)$/.test(slotName) ? `${slotName}es` : `${slotName}s`;

  // On-time streak: the last N same-slot logs all on time (needs >= 2, incl. today's).
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const late = typeof rows[i].minutes_late === 'number' ? rows[i].minutes_late > 0 : null;
    if (late === false) streak++; else break;
  }
  if (streak >= 2) {
    out.push(streak === 2
      ? `That's your second ${slotName} in a row logged on time.`
      : `That's ${streak} ${plural} in a row logged on time.`);
  }

  // Protein bar hit-rate over the last 4 same-slot meals (needs all 4 to exist).
  if (mealProteinBar > 0 && rows.length >= 4) {
    const last4 = rows.slice(-4);
    const hits = last4.filter((r) => (Number(r.protein) || 0) >= mealProteinBar).length;
    if (hits >= 3) out.push(`You've hit your protein bar in ${hits} of your last 4 ${plural}.`);
  }

  // Quality trend: this meal vs the average of the prior 3+ same-slot meals (needs 4 total).
  if (rows.length >= 4) {
    const prior = rows.slice(0, -1).slice(-3).map((r) => Number(r.quality)).filter((q) => isFinite(q) && q > 0);
    const nowQ = Number(rows[rows.length - 1].quality);
    if (prior.length >= 3 && isFinite(nowQ) && nowQ > 0) {
      const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
      if (nowQ - avg >= 8) out.push(`This ${slotName} scored ${Math.round(nowQ - avg)} points above your recent average.`);
    }
  }

  // Produce below target lately: needs 3+ same-slot meals with REAL fiber history
  // (meals.fiber, 0070 — null rows from before the column are excluded, never guessed).
  const fibered = rows.filter((r) => typeof r.fiber === 'number' && isFinite(r.fiber));
  if (fibered.length >= 3) {
    const recent3 = fibered.slice(-3);
    if (recent3.every((r) => r.fiber < 4)) {
      out.push(`Produce has been light in your last ${recent3.length} ${plural}. A fruit or vegetable each time changes that fast.`);
    }
  }
  return out.slice(0, 2);
}

/* ================================================================================
   MEAL SCORE RUBRIC + DETERMINISTIC QUALITY (Tier 1 invariant 2026-07-21).
   The 0-100 meal quality is now computed HERE, in application code, from the same
   component judgments the rubric displays — the AI explains the number, it never
   sets it. componentStates() is the single evaluation both read from, so the score,
   the rubric rows, and qualityReason can never contradict each other.
   ================================================================================ */

/** The one shared evaluation: every observable component judged met/partial/miss.
 *  Same thresholds qualityReason speaks to (protein share ≥25% of energy, fat ≤40%,
 *  the produce-guarded fiber rule) — null components when there's nothing to judge. */
function componentStates({ minutesLate, macros, fiber, detected } = {}) {
  const m = macros || {};
  const p = Math.max(0, Number(m.protein) || 0);
  const c = Math.max(0, Number(m.carbs) || 0);
  const f = Math.max(0, Number(m.fat) || 0);
  const total = p * 4 + c * 4 + f * 9;
  const late = typeof minutesLate === 'number' && minutesLate > 0;
  const fib = Math.max(0, Number(fiber) || 0);
  const produce = hasVisibleProduce(detected);
  return {
    p, c, f, total, late, fib, produce,
    timing: late ? (minutesLate > 60 ? 'miss' : 'partial') : 'met',
    protein: total > 0 ? ((p * 4) / total >= 0.25 ? 'met' : (p * 4) / total >= 0.2 ? 'partial' : 'miss') : null,
    carbs: total > 0 ? ((c * 4) / total <= 0.6 ? 'met' : 'partial') : null,
    fat: total > 0 ? ((f * 9) / total <= 0.4 ? 'met' : (f * 9) / total <= 0.45 ? 'partial' : 'miss') : null,
    fiberState: fib >= 6 || (produce && fib >= 3) ? 'met' : produce ? 'partial' : fib >= 3 ? 'partial' : 'miss',
  };
}

/** Points per component state — sums to 100 when everything is met. Kept simple and
 *  inspectable on purpose: the rubric rows ARE the score. Band labels/thresholds
 *  (qualityBand) are unchanged pending the founder's open scoring decision. */
const QUALITY_POINTS = {
  protein: { met: 35, partial: 22, miss: 8 },
  carbs: { met: 15, partial: 9 },
  fat: { met: 20, partial: 12, miss: 6 },
  fiber: { met: 20, partial: 12, miss: 5 },
  timing: { met: 10, partial: 6, miss: 2 },
};

/**
 * Deterministic per-meal quality (0-100) from grounded macros + timing. Application
 * code owns this number; the AI's own quality estimate is only a logged cross-check.
 * Null when there are no macros to judge (no honest score — qualityBand handles null).
 */
export function mealQualityScore({ macros, fiber, detected, minutesLate } = {}) {
  const s = componentStates({ minutesLate, macros, fiber, detected });
  if (!(s.total > 0)) return null;
  const pts = QUALITY_POINTS;
  const score = pts.protein[s.protein] + pts.carbs[s.carbs] + pts.fat[s.fat]
    + pts.fiber[s.fiberState] + pts.timing[s.timing];
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** The score, immediately explainable (founder 2026-08-04): the top 2–3 reasons the meal
 *  reads what it reads, as short chips under the number — "Protein low · Good timing · Fat
 *  high". Ranked by POINTS LOST per component (the same componentStates + QUALITY_POINTS
 *  arithmetic that sets the score, so chips and number can never disagree); when little was
 *  lost, the strongest 'met' components lead instead. Returns [{ label, state }] — state is
 *  met/partial/miss for the chip's tint. [] when there's nothing to judge. */
export function scoreReasons({ macros, fiber, detected, minutesLate } = {}) {
  const s = componentStates({ minutesLate, macros, fiber, detected });
  if (!(s.total > 0)) return [];
  const LABEL = {
    // "for this plate", because the judgment is the plate's own split, not the athlete's day
    // total — 41g can meet the day's per-meal bar and still be the smallest slice of a 950-kcal
    // plate. The unqualified "Protein low" sat directly under a day bar reading "41g of 160g"
    // and directly above an AI message about day pace, and read as the app disagreeing with
    // itself (founder, 2026-08-11).
    protein: { met: 'Protein solid', partial: 'Protein a bit light', miss: 'Protein low for this plate' },
    carbs: { met: 'Carbs balanced', partial: 'Carb-heavy' },
    fat: { met: 'Fat in range', partial: 'Fat a bit high', miss: 'Fat high' },
    fiber: { met: 'Good fiber', partial: 'Fiber light', miss: 'No fiber showing' },
    timing: { met: 'Good timing', partial: 'Logged late', miss: 'Logged very late' },
  };
  const comps = [
    { k: 'protein', state: s.protein },
    { k: 'carbs', state: s.carbs },
    { k: 'fat', state: s.fat },
    { k: 'fiber', state: s.fiberState },
    { k: 'timing', state: s.timing },
  ].filter((c) => c.state != null);
  // Fiber consistency guard (same rule as qualityReason): produce visible + a 0 fiber estimate
  // means the ESTIMATE is the suspect — never chip "No fiber showing" against a visible salad.
  const scored = comps
    .filter((c) => !(c.k === 'fiber' && c.state === 'miss' && s.produce))
    .map((c) => {
      const table = QUALITY_POINTS[c.k];
      const max = table.met;
      const lost = max - (table[c.state] != null ? table[c.state] : max);
      return { ...c, lost, label: (LABEL[c.k] && LABEL[c.k][c.state]) || '' };
    })
    .filter((c) => c.label);
  const problems = scored.filter((c) => c.lost > 0).sort((a, b) => b.lost - a.lost);
  const wins = scored.filter((c) => c.lost === 0).sort((a, b) => QUALITY_POINTS[b.k].met - QUALITY_POINTS[a.k].met);
  // Up to 3 chips: the biggest costs first, then one win for balance (an all-problems row on a
  // decent plate reads harsher than the number). A clean plate leads with its top two wins.
  const out = [];
  for (const c of problems.slice(0, problems.length >= 3 ? 3 : 2)) out.push(c);
  for (const c of wins) { if (out.length >= 3) break; out.push(c); }
  return out.slice(0, 3).map((c) => ({ label: c.label, state: c.state }));
}

/** Coach's Focus (founder 2026-08-05): the ONE line an athlete remembers after logging — the
 *  single next decision, derived from the same component judgments that set the score plus the
 *  day's real forward math. Deterministic and free (no model call), and honest: no coach's name
 *  is ever attached, so it can never fabricate human speech. Returns a short imperative line,
 *  praise when the plate is clean, '' when there's nothing to judge. `numbers:false` (Intuitive)
 *  keeps every directive figure-free. */
export function coachFocus({ macros, fiber, detected, minutesLate, nextMealName, dayGap, mealsRemaining, numbers = true } = {}) {
  const s = componentStates({ minutesLate, macros, fiber, detected });
  if (!(s.total > 0)) return '';
  const next = nextMealName ? String(nextMealName).toLowerCase() : 'your next meal';
  // The costliest miss owns the focus — ranked by the same points the score itself loses,
  // with the produce-guarded fiber rule (never scold "no fiber" against a visible salad).
  const costs = [
    ['protein', s.protein], ['fat', s.fat], ['fiber', s.fiberState], ['carbs', s.carbs], ['timing', s.timing],
  ].map(([k, st]) => ({
    k, st,
    lost: QUALITY_POINTS[k].met - (QUALITY_POINTS[k][st] != null ? QUALITY_POINTS[k][st] : QUALITY_POINTS[k].met),
  }))
    .filter((c) => !(c.k === 'fiber' && c.st === 'miss' && s.produce))
    .sort((a, b) => b.lost - a.lost);
  const worst = costs[0];
  if (!worst || worst.lost === 0) return 'Great plate. Repeat this structure tomorrow.';
  switch (worst.k) {
    case 'protein': {
      const gap = Math.max(0, Number(dayGap) || 0);
      const rem = Math.max(0, Number(mealsRemaining) || 0);
      if (numbers && gap > 0 && rem > 1) {
        const per = Math.max(5, Math.round(gap / rem / 5) * 5);
        return `Prioritize lean protein at ${next}; around ${per}g gets you back on pace.`;
      }
      return `Prioritize lean protein at ${next}.`;
    }
    case 'fat':
      return numbers ? `Keep ${next} leaner; aim under 20g of fat.` : `Keep ${next} leaner.`;
    case 'fiber':
      return 'Get something green on the next plate.';
    case 'carbs':
      return `Balance ${next}: protein and a vegetable before the extra carbs.`;
    case 'timing':
      return `Log ${next} inside its window.`;
    default:
      return '';
  }
}

export function scoreRubric({ quality, minutesLate, macros, fiber, detected, source, userNote, photoQ } = {}) {
  const s = componentStates({ minutesLate, macros, fiber, detected });
  const { p, c, f, total, late, fib, produce } = s;
  const conf = estimateConfidence(source, detected);
  const est = conf !== 'exact';
  const rows = [];

  // Timing — a fact, never estimated.
  rows.push({
    k: 'On-time logging', exact: true,
    state: s.timing,
    note: late ? `${Math.round(minutesLate)} min past the window` : 'Inside the window',
  });

  // Protein alignment — estimated for photo reads.
  if (total > 0) {
    rows.push({
      k: 'Protein alignment', exact: !est,
      state: s.protein,
      note: `${est ? `~${estRange(p, conf).text}` : p}g${est ? ' (estimated)' : ''}`,
    });
    rows.push({
      k: 'Carbohydrate balance', exact: !est,
      state: s.carbs,
      note: `${est ? `~${c}` : c}g${est ? ' (estimated)' : ''}`,
    });
    rows.push({
      k: 'Fat within range', exact: !est,
      state: s.fat,
      note: `${est ? `~${f}` : f}g${est ? ' (estimated)' : ''}`,
    });
  }

  // Produce & fiber — guarded by what's visible, same rule as qualityReason.
  rows.push({
    k: 'Produce & fiber', exact: false,
    state: s.fiberState,
    note: produce ? `Visible produce on the plate · ~${fib}g fiber (estimated)` : `~${fib}g fiber (estimated)`,
  });

  // Completeness — photo present + note coverage.
  const noPhoto = source === 'manual' || source === 'label';
  rows.push({
    k: 'Meal completeness', exact: true,
    state: noPhoto ? 'partial' : 'met',
    note: noPhoto ? 'No photo, entered by hand' : (userNote ? 'Photo plus your added details' : 'Photo submitted'),
  });

  // Photo quality — MEASURED at capture (brightness + edge energy), only when a real
  // measurement exists; never guessed for old rows or hand-entered meals.
  const pq = photoQuality(photoQ);
  if (pq && !noPhoto) {
    rows.push({
      k: 'Photo quality', exact: true,
      state: pq.state,
      note: pq.label === 'Clear' ? 'Clear (measured)' : `${pq.label} (measured); a clearer photo sharpens the read`,
    });
  }

  return {
    rows,
    estimated: est,
    headline: quality != null
      ? `Why this meal reads ${Math.round(Number(quality))}${est ? ' (photo estimate)' : ''}`
      : 'How this meal is judged',
  };
}

/* ================================================================================
   SCORE ↔ LANGUAGE AGREEMENT (Tier 1 invariant 2026-07-21) — the AI's prose must
   match the deterministic band, and text may never mention a food the athlete
   removed. Pure validators; the caller (state.groundResult / recomputeStagedMeal)
   decides the fallback copy.
   ================================================================================ */

/** Drop every sentence that names the removed food (case-insensitive, plural-tolerant).
 *  Session isolation for prose: a deleted food is gone from the final text too. */
export function stripFoodMentions(text, foodName) {
  const t = String(text == null ? '' : text);
  const name = String(foodName == null ? '' : foodName).trim();
  if (!t || !name) return t;
  // Match on the food's significant words so "Grilled chicken" also catches "the chicken".
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (!words.length) return t;
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(${words.map(esc).join('|')})s?\\b`, 'i');
  const sentences = t.match(/[^.!?]+[.!?]*/g) || [t];
  const kept = sentences.filter((sent) => !re.test(sent));
  return kept.join('').trim();
}

/** True when the AI's prose can honestly sit next to the deterministic band. A weak
 *  score with rotation-worthy praise (the founder's "keep in rotation on a 62" bug)
 *  or a strong score talked about as a weak plate both fail. Conservative: only
 *  unambiguous conflicts fail, so honest nuance ("solid protein, light on fiber")
 *  always passes. */
export function analysisAgreesWithBand(text, band) {
  const t = String(text == null ? '' : text);
  if (!t || !band || !band.cls) return true;
  const praise = /\b(keep (this|it) in( the)? rotation|great (meal|plate|work)|excellent|perfect|dialed in|nailed (it|this)|crushing|exactly what you need)\b/i;
  const damning = /\b(weak plate|well below (the )?(plan|standard)|poor (meal|plate)|way off|not (good|great) enough)\b/i;
  if (band.cls === 'low' && praise.test(t)) return false;
  if (band.cls === 'good' && damning.test(t)) return false;
  return true;
}

/* THE NUMERIC RAIL — the sibling of analysisAgreesWithBand, and the reason the AI nutritionist
   can no longer contradict the Meal Breakdown (founder call 2026-08-02).

   The model writes its paragraph while looking at its OWN estimate. Grounding then re-derives every
   macro against the food DB, so a paragraph that said "around 23g of protein" can end up sitting on
   a card that reads 29g. analysisAgreesWithBand caught the TONE version of that conflict; nothing
   caught the NUMBERS. This does: prose whose figures the card contradicts is dropped, and the
   deterministic qualityReason line speaks in its place (see state.js groundResult).

   Deliberately narrow, because a rail that fires on honest prose is worse than no rail:
     * only figures the text ATTACHES to a macro count ("29g of protein", "660 calories"). A bare
       number is a description of the plate, not a claim about the totals — "6 to 8 strips" of bacon
       and "2 eggs" must never silence a correct paragraph.
     * ranges pass when the grounded value falls inside them. The system prompt actively ASKS for
       hedged ranges on a photo estimate, so "roughly 40 to 50g of protein" over a grounded 44 is
       the model doing exactly what it was told.
     * a figure is allowed to round: it passes within 10%, or 3g / 30kcal, whichever is larger.
   What the prose may not do is state a number the athlete can see is different.

   The meal SCORE is not checked here. The model is never told the final score (it is computed
   after the fact from the grounded macros), so it does not quote one; the band check above is what
   governs whether its language can sit next to that score. */
// "29", or a hedged "25 to 34" / "25-34".
const RANGE = '(\\d{1,5})(?:\\s*(?:to|-|–|—|or)\\s*(\\d{1,5}))?';
// The window between a macro word and its figure, for the "protein lands near 30g" word order. It
// is TEMPERED so it can never cross into a neighbouring macro's clause: in "48g of carbs and 42g of
// fat" the 42 belongs to fat, and a plain [^.!?]{0,20} window would happily read it as carbs and
// then fail honest prose. The window stops dead at any other macro word or the conjunction that
// introduces one.
const MACRO_WORDS = 'protein|carbs?|carbohydrates?|fat|fib(?:er|re)|calories|kcal|cals?';
const GAP = `(?:(?!\\b(?:${MACRO_WORDS})\\b|\\band\\b)[^.!?]){0,20}?`;
const unitFirst = (macro) => new RegExp(`${RANGE}\\s*g(?:rams?)?\\s+(?:of\\s+)?(?:${macro})`, 'gi');
const macroFirst = (macro) => new RegExp(`\\b(?:${macro})\\b${GAP}${RANGE}\\s*g\\b`, 'gi');

const MACRO_PATTERNS = [
  // "29g of protein" / "29 grams protein", then "protein is about 29g".
  ['protein', unitFirst('protein')],
  ['protein', macroFirst('protein')],
  ['carbs', unitFirst('carb|carbohydrate')],
  ['carbs', macroFirst('carbs?|carbohydrates?')],
  ['fat', unitFirst('fat\\b')],
  ['fat', macroFirst('fat')],
  ['fiber', unitFirst('fib(?:er|re)\\b')],
  ['fiber', macroFirst('fib(?:er|re)')],
  // "660 calories" / "660 kcal" / "660 cals".
  ['kcal', new RegExp(`${RANGE}\\s*(?:kcal|cals?|calories)\\b`, 'gi')],
];

export function analysisAgreesWithNumbers(text, macros) {
  const t = String(text == null ? '' : text);
  if (!t) return true;
  const m = macros && typeof macros === 'object' ? macros : null;
  if (!m) return true;
  const truth = {
    protein: Number(m.protein), carbs: Number(m.carbs), fat: Number(m.fat),
    kcal: Number(m.kcal), fiber: Number(m.fiber),
  };
  for (const [key, re] of MACRO_PATTERNS) {
    const actual = truth[key];
    // Nothing to contradict: a macro the grounded read does not carry (fiber is often absent) can
    // never fail the prose. Silence is not disagreement.
    if (!Number.isFinite(actual)) continue;
    re.lastIndex = 0;
    let hit;
    while ((hit = re.exec(t)) !== null) {
      const lo = Number(hit[1]);
      const hi = hit[2] != null ? Number(hit[2]) : lo;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      const tol = Math.max(key === 'kcal' ? 30 : 3, actual * 0.1);
      if (actual < Math.min(lo, hi) - tol || actual > Math.max(lo, hi) + tol) return false;
    }
  }
  return true;
}

/* THE COMPONENT RAIL — the third sibling (founder escalation 2026-08-11: the breakdown chips said
   "Protein low" while the AI's opener said "Good start on protein for the day" ON THE SAME SCREEN).

   The band rail catches overall tone; the numeric rail catches figures. Neither catches a VERDICT
   conflict: the model praising a macro the deterministic componentStates just marked a miss. The
   model judges protein by the athlete's day (41g toward 160g reads great); the score judges it by
   the plate's own split (41g in a 950-kcal plate is the smallest slice) — both defensible, but two
   verdicts wearing the same word on one screen is a contradiction, and the Meal Breakdown is the
   single source of truth. Prose that praises a 'miss' component or condemns a 'met' one is dropped,
   and the deterministic qualityReason line (which agrees with the chips by construction) speaks
   instead.

   Conservative on purpose, like its siblings: praise only fails on a hard 'miss', criticism only
   on a clean 'met' — honest nuance ("solid protein, light on fiber") and 'partial' components never
   silence a paragraph. Windows are short and stop at clause punctuation so "protein, carbs, and
   fat are in balance" can never smear one macro's adjective onto another. */
const V_GAP = '[^.!?,;:]{0,26}';
const PRAISE_W = '(?:good|great|strong|solid|nice|excellent|plenty of|well[- ]covered)';
const VERDICT_PATTERNS = {
  protein: {
    praise: new RegExp(`\\b${PRAISE_W}\\b${V_GAP}\\bprotein\\b|\\bprotein\\b${V_GAP}\\b(?:solid|strong|dialed in|on point|in (?:a )?good shape|looks? good|covered|handled|where you want)\\b`, 'i'),
    condemn: new RegExp(`\\bprotein\\b${V_GAP}\\b(?:low|light|short|thin|lacking|under)\\b|\\b(?:low|light|short)\\b[^.!?,;:]{0,14}\\bon protein\\b|\\bneeds? more protein\\b`, 'i'),
  },
  fat: {
    praise: new RegExp(`\\bfat\\b${V_GAP}\\b(?:in (?:a good |the )?range|in check|dialed in|fine|lean|reasonable|where you want)\\b|\\b(?:lean|light)\\b[^.!?,;:]{0,14}\\bon (?:the )?fat\\b`, 'i'),
    condemn: new RegExp(`\\bfat\\b${V_GAP}\\b(?:high|heavy|ran (?:above|over)|over the range|too much)\\b|\\btoo much fat\\b|\\bheavy on (?:the )?fat\\b`, 'i'),
  },
  fiber: {
    praise: new RegExp(`\\b${PRAISE_W}\\b[^.!?,;:]{0,16}\\bfib(?:er|re)\\b|\\bfib(?:er|re)\\b${V_GAP}\\b(?:solid|strong|covered|plenty)\\b`, 'i'),
    condemn: new RegExp(`\\bfib(?:er|re)\\b${V_GAP}\\b(?:low|light|missing|lacking|thin)\\b|\\bno fib(?:er|re)\\b|\\b(?:low|light)\\b[^.!?,;:]{0,14}\\bon fib(?:er|re)\\b`, 'i'),
  },
};

export function analysisAgreesWithComponents(text, { macros, fiber, detected, minutesLate } = {}) {
  const t = String(text == null ? '' : text);
  if (!t) return true;
  const s = componentStates({ minutesLate, macros, fiber, detected });
  if (!(s.total > 0)) return true; // nothing judged, nothing to contradict
  const verdicts = { protein: s.protein, fat: s.fat, fiber: s.fiberState };
  for (const key of Object.keys(VERDICT_PATTERNS)) {
    const state = verdicts[key];
    if (state == null) continue;
    const p = VERDICT_PATTERNS[key];
    if (state === 'miss' && p.praise.test(t)) return false;
    if (state === 'met' && p.condemn.test(t)) return false;
  }
  return true;
}

/* ================================================================================
   MEAL EVENT CLASSIFIER (upgrade 2026-07-16) — coach-notification urgency.
     'logged'  — complete, no question, no major issue: feed + unread only.
     'review'  — low-confidence read, missing photo, meaningful nutrition miss, or
                 a correction that moved the numbers: worth a look today.
     'action'  — athlete asked the coach something, a possible allergen conflict,
                 or a serious rule violation: respond now.
   Pure and deliberately conservative: unknown inputs never escalate.
   ================================================================================ */
export function classifyMealEvent({
  quality, detected, source, restrictionHits, athleteAskedCoach, correctionDelta, minutesLate,
} = {}) {
  const reasons = [];
  const severe = restrictionHits && Array.isArray(restrictionHits.severe) && restrictionHits.severe.length;
  if (severe) reasons.push(`possible allergen: ${restrictionHits.severe.join(', ')}`);
  if (athleteAskedCoach) reasons.push('athlete asked the coach a question');
  if (reasons.length) return { cls: 'action', reasons };

  const conf = estimateConfidence(source, detected);
  if (conf === 'low') reasons.push('low-confidence photo read');
  if (source === 'manual') reasons.push('no photo submitted');
  const q = Number(quality);
  if (isFinite(q) && q > 0 && q < 50) reasons.push('meal well below the plan');
  if (typeof correctionDelta === 'number' && Math.abs(correctionDelta) >= 15) reasons.push('athlete correction changed the numbers meaningfully');
  if (typeof minutesLate === 'number' && minutesLate > 120) reasons.push('logged very late');
  if (reasons.length) return { cls: 'review', reasons };

  return { cls: 'logged', reasons: [] };
}

/* ================================================================================
   ATHLETE CORRECTIONS (upgrade 2026-07-16) — fix what the photo can't show,
   recalculate honestly, keep the audit trail.
   applyMealCorrection takes the persisted slot meta and ONE correction, returns a
   NEW meta carrying: the original AI estimate (frozen once, under `orig`), a
   corrections log, adjusted macros (deterministic kitchen math, all flagged
   estimated), and a deterministic, bounded quality adjustment (never a fake AI
   re-score — a rule-based nudge, clamped to ±8, explained in the summary).
   ================================================================================ */
const CORRECTION_RULES = {
  cooking: {
    oil: { fat: 12, kcal: 108, note: 'cooked in oil' },
    butter: { fat: 12, kcal: 108, note: 'cooked in butter' },
    neither: { note: 'no added cooking fat', certainty: true },
  },
  sauce: {
    creamy: { fat: 8, kcal: 80, note: 'creamy sauce added' },
    sweet: { carbs: 15, kcal: 60, note: 'sweet sauce or glaze added' },
    none: { note: 'no sauce', certainty: true },
  },
  drink: {
    water: { note: 'water to drink', certainty: true },
    milk: { protein: 8, carbs: 12, fat: 8, kcal: 150, note: 'milk added' },
    juice: { carbs: 30, kcal: 120, note: 'juice added' },
    soda: { carbs: 40, kcal: 160, note: 'soda added' },
    'sports drink': { carbs: 21, kcal: 80, note: 'sports drink added' },
  },
  side: {
    fruit: { carbs: 20, kcal: 80, fiber: 3, note: 'fruit added' },
    vegetables: { carbs: 8, kcal: 40, fiber: 3, note: 'vegetables added' },
    bread: { carbs: 25, kcal: 130, fiber: 1, note: 'bread or roll added' },
  },
  portion: {
    half: { scale: 0.5, note: 'portion was about half the estimate' },
    'three-quarters': { scale: 0.75, note: 'portion was smaller than the estimate' },
    larger: { scale: 1.35, note: 'portion was larger than the estimate' },
    double: { scale: 1.9, note: 'portion was about double the estimate' },
  },
};

export function applyMealCorrection(meta, { kind, value, detail, item, newName, quantity, per, add, minutesLate } = {}) {
  const src = meta || {};
  const rule = (CORRECTION_RULES[kind] || {})[String(value || '').toLowerCase()];
  if (!rule && kind !== 'other' && kind !== 'item') return null;
  // Freeze the ORIGINAL estimate exactly once — the audit trail's anchor.
  const orig = src.orig || {
    protein: src.protein || 0, carbs: src.carbs || 0, fat: src.fat || 0,
    kcal: src.kcal || 0, fiber: src.fiber || 0, quality: src.quality != null ? src.quality : null,
  };
  const next = { ...src, orig };
  const log = Array.isArray(src.corrections) ? src.corrections.slice() : [];
  let summary;

  /* ── kind 'item' (Core Power fix 2026-08-06): a STRUCTURED per-item correction — the athlete
     told us a specific detected food is a different product variant or carries different macros
     than we logged ("the shake is the 42g bottle"). Applied deterministically: the item's own
     macros update, its kcal re-derives from food science when not stated, meal totals re-derive
     from the items, and the SCORE fully recomputes through the same mealQualityScore that set it
     — never a fabricated re-score, never a nudge. The item is marked basis 'label' (the athlete
     read their own package: that is READ evidence) so grounding never clamps it back. */
  if (kind === 'item') {
    const want = clean(item).toLowerCase();
    const rich = Array.isArray(src.detectedRich) ? src.detectedRich.map((d) => ({ ...d })) : [];
    if (!want || !rich.length) return null;
    let idx = rich.findIndex((d) => clean(d.name).toLowerCase() === want);
    if (idx === -1) idx = rich.findIndex((d) => clean(d.name).toLowerCase().includes(want) || want.includes(clean(d.name).toLowerCase()));
    // Token overlap, last (2026-08-09): the AI echoes a shortened item name back to us and a
    // substring test misses on word order or a plural — "sausage breakfast sandwich" against a
    // logged "breakfast sandwiches, foil-wrapped". A miss here used to return null and the caller
    // dropped it on the floor, so the athlete watched their correction evaporate. Match on shared
    // identifying words instead, and require a real majority so it can't grab the wrong plate.
    if (idx === -1) {
      const words = (s) => new Set(clean(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map((w) => w.replace(/(ies|es|s)$/, '')));
      const wantW = words(want);
      if (wantW.size) {
        let best = -1, bestScore = 0;
        rich.forEach((d, i) => {
          const dw = words(d.name);
          if (!dw.size) return;
          let hit = 0;
          wantW.forEach((w) => { if (dw.has(w)) hit += 1; });
          const score = hit / Math.min(wantW.size, dw.size);
          if (score > bestScore) { bestScore = score; best = i; }
        });
        if (bestScore >= 0.5) idx = best;
      }
    }
    if (idx === -1) return null;
    const row = rich[idx];

    /* ── INGREDIENTS THE ATHLETE ADDS (founder escalation 2026-08-09) ──────────────────────────
       "It had egg and cheese on both as well." The athlete is describing COMPOSITION, not reading
       a label, so they state no numbers — and the old tool had no field for this at all. The AI
       said "updating this sandwich's numbers now" and nothing moved, because a correction with no
       stated macro looked like a correction with nothing in it.

       Numbers come from our own curated reference (priceAddedFood), never from the AI's prose:
       the Breakdown stays the single source of truth and the model only names what was there.
       A food the reference doesn't carry falls back to the model's stated estimate and is marked
       'estimate'; one that can be neither priced nor estimated is REPORTED back to the caller so
       the thread can ask for the number instead of quietly under-counting the plate. */
    const adds = (Array.isArray(add) ? add : []).filter((a) => a && clean(a.name).trim());
    const unpriced = [];
    const applied = [];
    let anyEstimated = false;
    const addTot = { protein: 0, carbs: 0, fat: 0, kcal: 0 };
    for (const a of adds.slice(0, 6)) {
      const nm = clean(a.name).trim().slice(0, 60);
      const qty = a.quantity == null ? '' : clean(a.quantity).slice(0, 24);
      let priced = priceAddedFood(nm, qty);
      if (!priced && a.per && typeof a.per === 'object') {
        const g = (v) => { const n = Math.round(Number(v)); return isFinite(n) && n >= 0 ? Math.min(n, 2000) : 0; };
        const e = a.per;
        if (['protein', 'carbs', 'fat', 'kcal'].some((k) => e[k] != null)) {
          priced = { protein: g(e.protein), carbs: g(e.carbs), fat: g(e.fat), kcal: g(e.kcal) };
          anyEstimated = true;
        }
      }
      if (!priced) { unpriced.push(nm); continue; }
      if (!priced.kcal) {
        const atw = 4 * priced.protein + 4 * priced.carbs + 9 * priced.fat;
        if (atw > 0) priced.kcal = Math.round(atw);
      }
      for (const k of ['protein', 'carbs', 'fat', 'kcal']) addTot[k] += Number(priced[k]) || 0;
      applied.push({ name: nm, quantity: qty || undefined, per: priced });
    }

    // A correction has to CHANGE something. One that states no macro, adds no priceable food and
    // supplies no new name is a no-op, and returning a cheerful "recalculated" summary for it is
    // how the thread ends up promising an update that never happened. Null says so plainly.
    const statedAny = per && typeof per === 'object' && ['protein', 'kcal', 'carbs', 'fat'].some((k) => per[k] != null);

    /* ── THE PORTION WAS WRONG, NOT THE FOOD (2026-08-28) ──────────────────────────────────
       "That was two cups, not one." Until apply_correction carried a quantity field, the model
       had no way to comply except to restate macros it had to invent, which is the exact thing
       this whole path exists to prevent: numbers never come from prose. Now the amount arrives
       as a string and the item is rescaled from ITS OWN logged numbers.

       servingsFor compares the new amount to the one already on the item, unit-aware, so "8 oz"
       over a logged "4 oz" doubles it instead of octupling it. It is the SAME function the
       breakdown's own quantity field uses, deliberately: an athlete typing "2 cups" into the
       row and an athlete saying "2 cups" to the AI must land on identical numbers.

       When the two amounts cannot be compared honestly ("a bit more" against "1 cup"), nothing
       is scaled and nothing is invented. The correction then only counts if it carried
       something else, and a bare uncomparable amount returns null so the thread admits it. */
    const qty = clean(quantity).trim().slice(0, 40);
    const oldQty = row.quantity == null ? '' : clean(row.quantity).trim();
    const portion = qty && oldQty ? servingsFor(qty, oldQty) : { servings: 1, resolved: false };
    const scaled = portion.resolved && portion.servings !== 1;

    if (!statedAny && !applied.length && !clean(newName).trim() && !scaled) return null;
    const basePer = row.per && typeof row.per === 'object' ? row.per : { protein: 0, kcal: 0, carbs: 0, fat: 0 };
    // The rescaled item is what every later step merges onto, so a portion correction that also
    // states a macro ("two cups, and it was brown rice at 5g") applies the stated macro to the
    // corrected amount rather than to the old one.
    const oldPer = scaled
      ? {
        protein: Math.max(0, Math.round((Number(basePer.protein) || 0) * portion.servings)),
        kcal: Math.max(0, Math.round((Number(basePer.kcal) || 0) * portion.servings)),
        carbs: Math.max(0, Math.round((Number(basePer.carbs) || 0) * portion.servings)),
        fat: Math.max(0, Math.round((Number(basePer.fat) || 0) * portion.servings)),
      }
      : basePer;
    const numOr = (v, fallback) => { const n = Math.round(Number(v)); return isFinite(n) && n >= 0 ? n : fallback; };
    const stated = per && typeof per === 'object' ? per : {};
    const merged = {
      protein: stated.protein != null ? numOr(stated.protein, oldPer.protein || 0) : (oldPer.protein || 0),
      kcal: stated.kcal != null ? numOr(stated.kcal, oldPer.kcal || 0) : (oldPer.kcal || 0),
      carbs: stated.carbs != null ? numOr(stated.carbs, oldPer.carbs || 0) : (oldPer.carbs || 0),
      fat: stated.fat != null ? numOr(stated.fat, oldPer.fat || 0) : (oldPer.fat || 0),
    };
    // The athlete stated macros but not calories: calories are arithmetic, not opinion.
    if (stated.kcal == null && (stated.protein != null || stated.carbs != null || stated.fat != null)) {
      const atw = 4 * merged.protein + 4 * merged.carbs + 9 * merged.fat;
      if (atw > 0) merged.kcal = Math.round(atw);
    }
    // What the athlete added rides ON TOP of the item's own numbers — the sandwich still has its
    // sausage, it just also has the egg and cheese they told us about.
    for (const k of ['protein', 'carbs', 'fat', 'kcal']) merged[k] = Math.round(merged[k] + addTot[k]);
    const nn2 = clean(newName).slice(0, 80);
    const oldName = row.name;
    row.per = merged;
    if (nn2) row.name = nn2;
    // Provenance, honestly: a stated macro is a LABEL read (they looked at the package); an added
    // ingredient priced from our curated reference is 'database'; one that fell back to the
    // model's own number is an 'estimate' and has to say so. `edited` is what actually protects
    // the row from being clamped back into a generic reference band — see groundFood.
    row.basis = statedAny ? 'label' : anyEstimated ? 'estimate' : applied.length ? 'database' : row.basis;
    if (statedAny) row.confidence = 'high';
    // The corrected amount rides on the row, so the breakdown shows what the athlete said and
    // grounding bounds the item against that portion rather than the one the photo guessed.
    if (qty) row.quantity = qty;
    // edited vs portionEdited, the same distinction applyFoodEdit draws. `edited` means the
    // curated reference for this food's NAME no longer describes it, which is true when they
    // renamed it, stated a label macro, or added an ingredient, and grounding must stop clamping
    // against that reference. A pure PORTION correction says none of that: it is the same food
    // at a different amount, and the reference still describes it perfectly once scaled. Marking
    // it `edited` would switch grounding off for no reason and throw away the sanity check the
    // athlete's own correction has just made more accurate.
    if (statedAny || applied.length || clean(newName).trim()) row.edited = true;
    else row.portionEdited = true;
    next.detectedRich = rich;
    // Keep the flat names (persisted `foods`) in lockstep with the rename.
    if (nn2 && Array.isArray(src.foods)) {
      next.foods = src.foods.map((f) => (clean(f).toLowerCase() === clean(oldName).toLowerCase() ? nn2 : f));
    }
    // Totals re-derive from the items when every item is priced; otherwise apply this item's
    // delta to the stated totals (the honest partial recompute).
    const priced = rich.every((d) => d && d.per && typeof d.per === 'object');
    if (priced) {
      let p = 0, c = 0, f2 = 0, k2 = 0;
      for (const d of rich) { p += Number(d.per.protein) || 0; c += Number(d.per.carbs) || 0; f2 += Number(d.per.fat) || 0; k2 += Number(d.per.kcal) || 0; }
      next.protein = Math.round(p); next.carbs = Math.round(c); next.fat = Math.round(f2); next.kcal = Math.round(k2);
    } else {
      for (const k of ['protein', 'carbs', 'fat', 'kcal']) {
        next[k] = Math.max(0, Math.round((Number(src[k]) || 0) + (merged[k] - (Number(oldPer[k]) || 0))));
      }
    }
    // The FULL deterministic re-score — same engine, same inputs, every surface agrees.
    const q = mealQualityScore({
      macros: next, fiber: next.fiber, detected: next.detectedRich,
      minutesLate: typeof minutesLate === 'number' ? minutesLate : undefined,
    });
    if (q != null) { next.quality = q; delete next.qualityAdj; }
    const label = nn2 && nn2 !== oldName ? `${clean(oldName)} → ${nn2}` : clean(oldName);
    const kcalDelta = Math.abs((next.kcal || 0) - (Number(src.kcal) || 0));
    // The summary is what the athlete READS, so it may only claim what actually happened. A pure
    // rename moved no macros and must not say the score recalculated; an ingredient we could not
    // price has to be named out loud rather than quietly rounded away.
    const addedNames = applied.map((a) => a.name);
    if (statedAny || applied.length) {
      summary = `Corrected: ${label}${addedNames.length ? `; added ${addedNames.join(' and ')}` : ' updated from your correction'} · macros and score recalculated`;
    } else {
      summary = `Corrected: ${label} renamed; macros unchanged`;
    }
    if (unpriced.length) summary += ` · I don't have numbers for ${unpriced.join(' or ')}, so that isn't counted yet`;
    log.push({
      kind: 'item', item: clean(oldName), newName: nn2 || undefined, per: merged,
      add: applied.length ? applied : undefined, unpriced: unpriced.length ? unpriced : undefined,
    });
    next.corrections = log.slice(0, 8);
    return { meta: next, summary, kcalDelta, added: addedNames, unpriced, moved: statedAny || applied.length > 0 };
  }

  if (kind === 'other') {
    const d = clean(detail).slice(0, 160);
    if (!d) return null;
    summary = `Detail added: ${d}`;
    log.push({ kind, detail: d });
  } else if (rule.scale) {
    for (const k of ['protein', 'carbs', 'fat', 'kcal', 'fiber']) {
      next[k] = Math.max(0, Math.round((Number(src[k]) || 0) * rule.scale));
    }
    summary = `Corrected: ${rule.note}; macros rescaled (estimated)`;
    log.push({ kind, value, scale: rule.scale });
  } else {
    const deltas = [];
    for (const k of ['protein', 'carbs', 'fat', 'fiber', 'kcal']) {
      if (rule[k]) {
        next[k] = Math.max(0, Math.round((Number(src[k]) || 0) + rule[k]));
        deltas.push(`${k === 'kcal' ? 'calories' : k} ${rule[k] > 0 ? '+' : ''}${rule[k]}${k === 'kcal' ? '' : 'g'}`);
      }
    }
    summary = `Corrected: ${rule.note}${deltas.length ? `; ${deltas.join(', ')} (estimated)` : rule.certainty ? '; estimate confirmed' : ''}`;
    log.push({ kind, value });
  }
  next.corrections = log.slice(0, 8);

  // Deterministic quality nudge, bounded and explained — never a fabricated AI re-score.
  if (orig.quality != null) {
    let dq = 0;
    if (kind === 'side' && (value === 'fruit' || value === 'vegetables')) dq = 4;
    if (kind === 'drink' && value === 'soda') dq = -4;
    if (kind === 'cooking' && (value === 'oil' || value === 'butter')) {
      const total = next.protein * 4 + next.carbs * 4 + next.fat * 9;
      if (total > 0 && (next.fat * 9) / total > 0.45) dq = -4;
    }
    if (rule && rule.scale && rule.scale < 1 && orig.protein >= 30) dq = -3; // smaller portion, less fuel
    if (dq !== 0) {
      next.qualityAdj = Math.max(-8, Math.min(8, (Number(src.qualityAdj) || 0) + dq));
      next.quality = Math.max(0, Math.min(100, Math.round(orig.quality + next.qualityAdj)));
      summary += ` · score ${dq > 0 ? '+' : ''}${dq} (rule-based)`;
    }
  }

  const kcalDelta = Math.abs((next.kcal || 0) - (orig.kcal || 0));
  return { meta: next, summary, kcalDelta };
}

/* ================================================================================
   CORRECTION AXES (2026-08-14) — which dimension of a read is still genuinely
   open, and in what order to ask about it.

   The panel used to render all five dimensions expanded at once: five rows,
   nineteen chips, and a free-text field. An athlete arrives here with ONE thing
   to fix ("it was cooked in oil"), at 10pm, after practice. Nineteen options is
   a wall, not a tool.

   This does NOT rank on model confidence. There is no per-axis confidence to
   rank on: estimateConfidence returns one band for the whole plate, so treating
   it as "which axis is shakiest" would be inventing a signal. It ranks on facts
   we actually hold — what was detected, what the athlete already said in the
   note, and what they have already corrected. An axis they have answered is
   closed. An axis the photo could not have seen (a drink that was never in
   frame) outranks one it could.
   ================================================================================ */
const AXIS_DEFS = [
  { kind: 'cooking', label: 'Cooking', opts: [['Oil', 'oil'], ['Butter', 'butter'], ['Neither', 'neither']] },
  { kind: 'portion', label: 'Portion', opts: [['About half', 'half'], ['A bit less', 'three-quarters'], ['Larger', 'larger'], ['Double', 'double']] },
  { kind: 'sauce', label: 'Sauce', opts: [['Creamy', 'creamy'], ['Sweet / glaze', 'sweet'], ['None', 'none']] },
  { kind: 'drink', label: 'Drink', opts: [['Water', 'water'], ['Milk', 'milk'], ['Juice', 'juice'], ['Soda', 'soda'], ['Sports drink', 'sports drink']] },
  { kind: 'side', label: 'I also had', opts: [['Fruit', 'fruit'], ['Vegetables', 'vegetables'], ['Bread / roll', 'bread']] },
];

/** Correction dimensions, most-likely-open first. Each carries its own chips and
 *  whether the athlete has already answered it. Order is stable for equal ranks. */
export function correctionAxes(meta) {
  const m = meta || {};
  const done = new Set((Array.isArray(m.corrections) ? m.corrections : [])
    .map((c) => c && c.kind).filter(Boolean));
  const noteTxt = `${m.userNote || ''} ${m.note || ''}`.toLowerCase();
  const foods = Array.isArray(m.detectedRich) ? m.detectedRich : [];
  const names = foods.map((d) => String((d && d.name) || '')).join(' ').toLowerCase();
  // Same protein vocabulary followUpQuestion uses: a plate with a cooked protein is the
  // one where added fat actually moves the number.
  const hasProtein = /salmon|chicken|beef|steak|fish|pork|shrimp|egg|turkey/.test(names);
  const hasBeverage = foods.some((d) => d && d.kind === 'beverage')
    || /water|milk|juice|soda|shake|smoothie|coffee|tea/.test(names);
  const saidCooking = /oil|butter|grill|bake|fried|air.?fry|steam|boil|raw|dry/.test(noteTxt);
  const saidSauce = /sauce|dressing|glaze|gravy|mayo|ketchup|syrup/.test(noteTxt);
  const lowConf = estimateConfidence(m.source, foods) === 'low';

  const rank = (kind) => {
    if (done.has(kind)) return -1;                        // answered: sinks, never leads
    if (kind === 'cooking') return saidCooking ? 0 : hasProtein ? 3 : 1;
    if (kind === 'portion') return lowConf ? 3 : 2;       // depth is what a photo cannot measure
    if (kind === 'sauce') return saidSauce ? 0 : hasProtein ? 2 : 1;
    if (kind === 'drink') return hasBeverage ? 0 : 2;     // never in frame is a real blind spot
    if (kind === 'side') return 1;                        // a photo can never rule this out
    return 0;
  };
  return AXIS_DEFS
    .map((a, i) => ({ ...a, answered: done.has(a.kind), rank: rank(a.kind), order: i }))
    .sort((a, b) => (b.rank - a.rank) || (a.order - b.order));
}

/* ================================================================================
   FOLLOW-UP QUESTION (upgrade 2026-07-16) — ask ONE useful thing when uncertainty
   materially affects the analysis; quick-answer chips map onto correction rules so
   the answer UPDATES the same estimate instead of spawning a second result.
   Null when the source is exact, the note/corrections already cover it, or
   nothing material is uncertain.
   ================================================================================ */
export function followUpQuestion(meta) {
  const m = meta || {};
  if (m.source === 'label' || m.source === 'manual') return null;
  const answered = (Array.isArray(m.corrections) ? m.corrections : []).some((c) => c && c.kind === 'cooking');
  if (answered) return null;
  const noteTxt = `${m.userNote || ''} ${m.note || ''}`.toLowerCase();
  if (/oil|butter|grill|bake|fried|air.?fry|steam|boil|raw|dry/i.test(noteTxt)) return null;
  const foods = Array.isArray(m.detectedRich) ? m.detectedRich : [];
  const protein = foods.map((d) => String(d && d.name || '')).find((n) => /salmon|chicken|beef|steak|fish|pork|shrimp|egg|turkey/i.test(n));
  if (!protein) return null;
  return {
    kind: 'cooking',
    q: `Was the ${clean(protein).toLowerCase()} cooked with oil, butter, or neither?`,
    chips: [
      { label: 'Oil', value: 'oil' },
      { label: 'Butter', value: 'butter' },
      { label: 'Neither', value: 'neither' },
      { label: 'Something else', value: 'other' },
    ],
  };
}

/* ================================================================================
   COACH THREAD STATUS (upgrade 2026-07-16) — what the athlete sees about coach
   attention on this meal. Real signals only:
     replied  — a coach message or reaction row exists on this meal
     reviewed — the coach opened the athlete's day (a real 0043 coach_views receipt)
     sent     — the meal row persisted and a coach is connected
   Simple states, no technical delivery language.
   ================================================================================ */
/**
 * @param {{ mealId?: any, hasCoach?: any, comments?: any, dayReviewed?: any, noun?: string }} [opts]
 */
export function coachThreadStatus({ mealId, hasCoach, comments, dayReviewed, noun = 'coach' } = {}) {
  if (!hasCoach) return { state: 'none', label: '' };
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const rows = Array.isArray(comments) ? comments : [];
  if (rows.some((c) => c && c.role === 'coach')) return { state: 'replied', label: `${Noun} replied` };
  // "Reviewed by Coach" OVERCLAIMED (founder, 2026-08-06). The only fact behind it is a
  // `coach_views` row, which is written when the coach OPENS the athlete's day — not when they
  // read this meal, and not when they form any judgment about it. An athlete who is told their
  // coach "reviewed" a meal and then gets no reply has been lied to by the interface. Say the
  // thing that is true: they opened it.
  if (dayReviewed) return { state: 'seen', label: `${Noun} opened your day` };
  if (mealId) return { state: 'sent', label: `Sent to ${noun}` };
  return { state: 'none', label: '' };
}

/* ================================================================================
   PHOTO QUALITY (follow-through 2026-07-16) — a MEASURED signal, not a guess.
   photoStats reads an RGBA pixel array (the capture pipeline's own downscaled
   canvas) and returns two numbers: mean luma (brightness, 0-255) and mean local
   gradient (edge energy — sharp photos have high edge energy, soft/blurry ones
   low). photoQuality classifies them conservatively: only clearly dark or clearly
   soft images get flagged, and a flag never blocks logging.
   ================================================================================ */
export function photoStats(rgba, width, height) {
  if (!rgba || !width || !height || rgba.length < width * height * 4) return null;
  let lumaSum = 0, gradSum = 0, gradN = 0;
  const luma = (i) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const l = luma(i);
      lumaSum += l;
      if (x + 1 < width) { gradSum += Math.abs(l - luma(i + 4)); gradN++; }
      if (y + 1 < height) { gradSum += Math.abs(l - luma(i + width * 4)); gradN++; }
    }
  }
  const n = width * height;
  return { luma: Math.round(lumaSum / n), sharpness: gradN ? Math.round((gradSum / gradN) * 10) / 10 : 0 };
}

/** Conservative classification of measured stats. Null stats → null (no claim). */
export function photoQuality(stats) {
  if (!stats || typeof stats.luma !== 'number' || typeof stats.sharpness !== 'number') return null;
  if (stats.luma < 50) return { label: 'Dim', state: 'partial', hint: 'Photo looks dark; brighter light gets a sharper read. Logging still counts.' };
  if (stats.sharpness < 3) return { label: 'Soft', state: 'partial', hint: 'Photo looks blurry; hold steady for a sharper read. Logging still counts.' };
  return { label: 'Clear', state: 'met', hint: '' };
}
