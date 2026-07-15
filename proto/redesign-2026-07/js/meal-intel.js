/* OnStandard — Meal Intelligence helpers (pure; no DOM, no state, no imports).
   Owns: detected-food normalization + the new analysis extras, the DERIVED AI
   opening message (never stored — both athlete and coach threads render it from
   the same meal data, so it can't be forged and costs nothing), reaction/message
   splitting, and the meal-chat context builder with its 8KB clamp. */

const clean = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, 200);

/** Legacy string arrays and rich {name, confidence, quantity?} arrays both normalize to rich.
 *  quantity (0062: "2 eggs", "1 cup rice") rides through cleaned + capped; absent stays absent. */
export function normalizeDetected(detected) {
  if (!Array.isArray(detected)) return [];
  return detected.slice(0, 8).map((d) => {
    if (typeof d === 'string') return { name: clean(d), confidence: 'high' };
    const c = d && d.confidence;
    const out = { name: clean(d && d.name), confidence: c === 'low' || c === 'medium' ? c : 'high' };
    const q = d && d.quantity;
    if (typeof q === 'string' && q.trim()) out.quantity = clean(q).slice(0, 40);
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
 * capture); returns true when something changed. Macros are DELIBERATELY untouched — no silent
 * re-estimation; the UI shows an "edited by you" hint instead.
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

/** True when any staged food row was touched by the athlete — drives the honest
 *  "edited by you (macros unchanged)" hint next to the breakdown. */
export function hasUserEdits(result) {
  return !!(result && Array.isArray(result.detectedRich)
    && result.detectedRich.some((d) => d && (d.edited || d.userAdded)));
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

/* Goal ties — why this meal matters for THEIR objective, athlete and client goals both. */
const GOAL_TIE = {
  gain: 'keeps the calorie floor and the protein climbing',
  lose: 'keeps you inside the window without starving the work',
  maintain: 'holds the line, and consistency is the whole game',
  perform: 'fuels the next session and speeds recovery',
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
export function openingMessage({ name, quality, note, analysis, highlights, goal, coachTargets, late, minutesLate } = {}) {
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
  if (coachTargets && coachTargets.protein) {
    parts.push(`Coach's bar is ${coachTargets.protein}g protein on the day, and every meal moves it.`);
  }
  if (!deep && quality != null) {
    parts.push(quality >= 75
      ? `Strong plate${name ? ` — keep ${clean(name)} in rotation` : ''}.`
      : 'One upgrade next time: add a protein or a vegetable and this score jumps.');
  }
  return parts.filter(Boolean).join(' ').slice(0, 1200);
}

/** Reaction rows (kind='reaction') grouped as [{emoji, count}], insertion-ordered. */
export function reactionGroups(comments) {
  const counts = new Map();
  for (const c of comments || []) {
    if (c && c.kind === 'reaction' && c.text) counts.set(c.text, (counts.get(c.text) || 0) + 1);
  }
  return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }));
}

/** Message rows only (reactions excluded; rows without kind are messages). */
export function threadMessages(comments) {
  return (comments || []).filter((c) => c && c.kind !== 'reaction');
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
