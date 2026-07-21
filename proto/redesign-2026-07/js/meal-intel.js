/* OnStandard — Meal Intelligence helpers (pure; no DOM, no state, no imports).
   Owns: detected-food normalization + the new analysis extras, the DERIVED AI
   opening message (never stored — both athlete and coach threads render it from
   the same meal data, so it can't be forged and costs nothing), reaction/message
   splitting, and the meal-chat context builder with its 8KB clamp. */

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
    if (d && d.userAdded) out.userAdded = true;
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
    case 'quantity': {
      if (idx === -1) return false;
      const q = clean(op.quantity).slice(0, 40);
      if (q) rich[idx].quantity = q; else delete rich[idx].quantity;
      rich[idx].edited = true;
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

/** True when the staged plate was touched by the athlete (row edited/added, or any food
 *  removed) — drives the honest edit hint next to the breakdown ("recalculated" when the
 *  per-food recompute ran; "macros stay the AI's estimate" when it couldn't). */
export function hasUserEdits(result) {
  return !!(result && (result.userRemoved || (Array.isArray(result.detectedRich)
    && result.detectedRich.some((d) => d && (d.edited || d.userAdded)))));
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
  const parts = [];
  const who = clean(name) || 'this one';
  if (late !== null) {
    if (late) {
      const mins = (typeof minutesLate === 'number' && isFinite(minutesLate) && minutesLate > 0)
        ? ` — ${Math.round(minutesLate)} min past the window` : '';
      parts.push(`Late on ${who}${mins}. That isn't the standard, but logging it late still counts — hiding it doesn't.`);
    } else {
      parts.push(`Good job getting ${who} in on time. That's the standard.`);
    }
  }
  const deep = String(analysis == null ? '' : analysis).replace(/[<>]/g, '').slice(0, 900);
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
  const hl = (Array.isArray(highlights) ? highlights : []).map((h) => clean(h)).filter(Boolean).slice(0, 3);
  if (hl.length) parts.push(`Worth knowing: ${hl.join('. ')}.`);
  // Day progress — the sentence that connects THIS meal to the day (real numbers only).
  if (day && day.proteinTarget > 0 && day.proteinSoFar != null) {
    const rem = day.mealsRemaining;
    const remTxt = rem == null ? '' : rem === 0 ? ' with the required meals in' : ` with ${rem === 1 ? 'one meal' : `${rem} meals`} still to come`;
    parts.push(`That puts you at approximately ${Math.round(day.proteinSoFar)} of ${Math.round(day.proteinTarget)}g protein for the day${remTxt}.`);
  } else if (coachTargets && coachTargets.protein) {
    parts.push(`Coach's bar is ${coachTargets.protein}g protein on the day, and every meal moves it.`);
  }
  // Real history, when it exists — mealPatterns() returns [] until there's enough data.
  for (const p of (Array.isArray(patterns) ? patterns : []).slice(0, 2)) parts.push(clean(p));
  // Score impact — engine-computed accountability credit, stated plainly.
  if (typeof impact === 'number' && isFinite(impact) && impact > 0) {
    parts.push(`This log moved your Daily Score by +${Math.round(impact)}.`);
  }
  // Uncertainty, stated honestly for photo estimates.
  const conf = estimateConfidence(source, detected);
  if (conf !== 'exact' && source !== 'manual') {
    parts.push(conf === 'high'
      ? 'These numbers are photo estimates — close, but cooking oil or sauce could shift them.'
      : `These numbers are photo estimates at ${conf} confidence — portions, oil, or sauce could move them, so correct anything I misread.`);
  }
  if (!deep && quality != null) {
    parts.push(quality >= 75
      ? `Strong plate${name ? ` — keep ${clean(name)} in rotation` : ''}.`
      : 'One upgrade next time: add a protein or a vegetable and this score jumps.');
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
export function openingSummary({
  quality, macros, fiber, highlights, late, goal,
  // Upgrade 2026-07-16 — all optional; absent context is omitted, never invented:
  detected, source, deadlineClock, day,
} = {}) {
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
    opportunity = opportunity.replace(/\.$/, '') + ' — a photo estimate, so correct me if the plate says otherwise.';
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

export function contextForChat({ meal, plan, exec, recentMeals, thread } = {}) {
  const ctx = {
    meal: meal || {},
    plan: plan || {},
    exec: exec || {},
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
      out.push(`Produce has been light in your last ${recent3.length} ${plural} — a fruit or vegetable each time changes that fast.`);
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
    note: noPhoto ? 'No photo — entered by hand' : (userNote ? 'Photo plus your added details' : 'Photo submitted'),
  });

  // Photo quality — MEASURED at capture (brightness + edge energy), only when a real
  // measurement exists; never guessed for old rows or hand-entered meals.
  const pq = photoQuality(photoQ);
  if (pq && !noPhoto) {
    rows.push({
      k: 'Photo quality', exact: true,
      state: pq.state,
      note: pq.label === 'Clear' ? 'Clear (measured)' : `${pq.label} (measured) — a clearer photo sharpens the read`,
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

export function applyMealCorrection(meta, { kind, value, detail } = {}) {
  const src = meta || {};
  const rule = (CORRECTION_RULES[kind] || {})[String(value || '').toLowerCase()];
  if (!rule && kind !== 'other') return null;
  // Freeze the ORIGINAL estimate exactly once — the audit trail's anchor.
  const orig = src.orig || {
    protein: src.protein || 0, carbs: src.carbs || 0, fat: src.fat || 0,
    kcal: src.kcal || 0, fiber: src.fiber || 0, quality: src.quality != null ? src.quality : null,
  };
  const next = { ...src, orig };
  const log = Array.isArray(src.corrections) ? src.corrections.slice() : [];
  let summary;

  if (kind === 'other') {
    const d = clean(detail).slice(0, 160);
    if (!d) return null;
    summary = `Detail added: ${d}`;
    log.push({ kind, detail: d });
  } else if (rule.scale) {
    for (const k of ['protein', 'carbs', 'fat', 'kcal', 'fiber']) {
      next[k] = Math.max(0, Math.round((Number(src[k]) || 0) * rule.scale));
    }
    summary = `Corrected: ${rule.note} — macros rescaled (estimated)`;
    log.push({ kind, value, scale: rule.scale });
  } else {
    const deltas = [];
    for (const k of ['protein', 'carbs', 'fat', 'fiber', 'kcal']) {
      if (rule[k]) {
        next[k] = Math.max(0, Math.round((Number(src[k]) || 0) + rule[k]));
        deltas.push(`${k === 'kcal' ? 'calories' : k} ${rule[k] > 0 ? '+' : ''}${rule[k]}${k === 'kcal' ? '' : 'g'}`);
      }
    }
    summary = `Corrected: ${rule.note}${deltas.length ? ` — ${deltas.join(', ')} (estimated)` : rule.certainty ? ' — estimate confirmed' : ''}`;
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
export function coachThreadStatus({ mealId, hasCoach, comments, dayReviewed } = {}) {
  if (!hasCoach) return { state: 'none', label: '' };
  const rows = Array.isArray(comments) ? comments : [];
  if (rows.some((c) => c && c.role === 'coach')) return { state: 'replied', label: 'Coach replied' };
  if (dayReviewed) return { state: 'reviewed', label: 'Reviewed by Coach' };
  if (mealId) return { state: 'sent', label: 'Sent to Coach' };
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
  if (stats.luma < 50) return { label: 'Dim', state: 'partial', hint: 'Photo looks dark — brighter light gets a sharper read. Logging still counts.' };
  if (stats.sharpness < 3) return { label: 'Soft', state: 'partial', hint: 'Photo looks blurry — hold steady for a sharper read. Logging still counts.' };
  return { label: 'Clear', state: 'met', hint: '' };
}
