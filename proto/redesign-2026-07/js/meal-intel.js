/* OnStandard — Meal Intelligence helpers (pure; no DOM, no state, no imports).
   Owns: detected-food normalization + the new analysis extras, the DERIVED AI
   opening message (never stored — both athlete and coach threads render it from
   the same meal data, so it can't be forged and costs nothing), reaction/message
   splitting, and the meal-chat context builder with its 8KB clamp. */

const clean = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, 200);

/** Legacy string arrays and rich {name, confidence} arrays both normalize to rich. */
export function normalizeDetected(detected) {
  if (!Array.isArray(detected)) return [];
  return detected.slice(0, 8).map((d) => {
    if (typeof d === 'string') return { name: clean(d), confidence: 'high' };
    const c = d && d.confidence;
    return { name: clean(d && d.name), confidence: c === 'low' || c === 'medium' ? c : 'high' };
  }).filter((d) => d.name);
}

/** Ground the new analysis extras (fiber / highlights / detected) to honest bounds. */
export function groundExtras(raw) {
  const r = raw || {};
  const fiber = Math.max(0, Math.min(60, Math.round(Number(r.fiber) || 0)));
  const highlights = (Array.isArray(r.highlights) ? r.highlights : [])
    .slice(0, 3).map((h) => clean(h).slice(0, 120)).filter(Boolean);
  const detectedRich = normalizeDetected(r.detected);
  return { fiber, highlights, detectedRich, detectedNames: detectedRich.map((d) => d.name) };
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
 * Execution is celebrated first regardless of food quality (binding tone rule); nutrition
 * coaching educates after. Returns a plain string (render through esc()).
 *
 * `late` is a tri-state: `true`/`false` render the on-time/late timing sentence as before;
 * `null` means the caller couldn't honestly determine timing (e.g. the coach side has no
 * reliable local-time comparison for another athlete's row) — the timing sentence is
 * omitted entirely rather than guessed. `undefined` behaves like `false` (existing callers).
 */
export function openingMessage({ name, quality, note, goal, coachTargets, late } = {}) {
  const parts = [];
  if (late !== null) parts.push(late ? 'Logged. Late still beats missing, and it counts.' : "Captured on time. That's the standard.");
  if (note) parts.push(clean(note));
  const tie = GOAL_TIE[goal];
  if (tie && quality != null) {
    parts.push(quality >= 75 ? `A plate like this ${tie}.` : `Tightening this plate up ${tie}.`);
  }
  if (coachTargets && coachTargets.protein) {
    parts.push(`Coach's bar is ${coachTargets.protein}g protein on the day, and every meal moves it.`);
  }
  if (quality != null) {
    parts.push(quality >= 75
      ? `Strong plate${name ? ` — keep ${clean(name)} in rotation` : ''}.`
      : 'One upgrade next time: add a protein or a vegetable and this score jumps.');
  }
  return parts.filter(Boolean).join(' ').slice(0, 600);
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
