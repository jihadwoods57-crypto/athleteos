// meal-chat's suggest_meal tool (2026-09-10), the pure half. Node-importable (suggest.test.mjs)
// and imported by index.ts, the same split every other function keeps in logic.mjs.
//
// WHY THIS EXISTS. "What should I eat to hit my protein" had exactly one answer in the app: the
// model-less engine on Plan > Ask (plan-ask.js answerWhatToEat), which ranks the athlete's OWN
// saved meals against what is left of the day. The meal chat, where the question is actually
// asked, had no such move: the model wrote a paragraph naming foods the athlete may never eat.
//
// THE CONTRACT. The model contributes framing and a fallback sentence. It never picks the meals:
// the CLIENT fills the bubble deterministically from Food Memory (chat-view.js fillMealSuggestion,
// the same rankForRemaining Plan > Ask uses), so a suggestion is always something this athlete has
// actually eaten, at numbers the app already holds. The persisted row text is framing + fallback,
// so a renderer that does not know this bubble kind (coach.js, trust.js) shows a complete plain
// sentence instead of a headless framing line.

export const SUGGEST_MEAL_TOOL = {
  name: 'suggest_meal',
  description: 'The athlete asked WHAT TO EAT or HOW TO CLOSE a gap ("what should I eat", "how do I hit my protein", "what closes the day"). Call this INSTEAD of reply: the app fills in up to three of the athlete\'s own saved usual meals that fit what is left of their day, each one tap from being logged. You write only the framing line and a fallback sentence. Never call it unprompted, and never for a question that is not about what to eat next.',
  input_schema: {
    type: 'object',
    properties: {
      protein_gap_g: { type: 'integer', description: 'Grams of protein still to eat today, taken EXACTLY from the context (proteinTarget minus proteinSoFar). 0 when the context has no target.' },
      kcal_gap: { type: 'integer', description: 'Calories still to eat today, only when both a calorie target and today\'s total are in the context. Omit otherwise.' },
      framing: { type: 'string', description: 'ONE short sentence the athlete reads above the suggestions, in your coach voice, e.g. "You are 40g short with dinner still open, so here is what usually gets you there." Numbers only from the context. No em dashes.' },
      fallback: { type: 'string', description: 'ONE sentence shown INSTEAD of suggestions when none of their saved meals fit: a concrete, doable move using only what the context supports (a protein-forward plate at the open meal, a size to aim for). Never name a specific food they have not logged. No em dashes.' },
    },
    required: ['protein_gap_g', 'framing', 'fallback'],
  },
};

const noDash = (s) => String(s ?? '').replace(/—/g, ',').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
const gnum = (v, cap) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= cap ? n : null;
};

/**
 * Sanitize a suggest_meal tool_use input. Returns null when the model gave nothing usable (no
 * framing and no fallback), in which case the caller should treat the turn as unavailable.
 */
export function parseSuggestMeal(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const framing = noDash(raw.framing).slice(0, 240);
  const fallback = noDash(raw.fallback).slice(0, 300);
  if (!framing && !fallback) return null;
  return {
    proteinGap: gnum(raw.protein_gap_g, 500) ?? 0,
    kcalGap: gnum(raw.kcal_gap, 5000),
    framing: framing || fallback,
    fallback: fallback || framing,
  };
}

/** The persisted row text: a complete plain message for any renderer that cannot draw picks. */
export function suggestRowText(s) {
  return s.framing === s.fallback ? s.framing : `${s.framing} ${s.fallback}`;
}

/** The meta the two athlete-facing renderers key on (chat-view.js mealSuggestOf). */
export function suggestRowMeta(s) {
  return { t: 'meal_suggest', proteinGap: s.proteinGap, ...(s.kcalGap != null ? { kcalGap: s.kcalGap } : {}), framing: s.framing, fallback: s.fallback };
}
