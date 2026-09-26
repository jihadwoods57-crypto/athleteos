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
//
// PLAN IDEAS (2026-09-25, bottom of this file) are the one place the model names new food, for
// Plan > Today's idea list. Different contract, same file: see the block header down there.
import { scrubToolLeak } from '../_shared/tool-leak.ts';
import { namesAny, cleanPrefItem, prefsPromptText } from '../_shared/food-prefs.mjs';

export const SUGGEST_MEAL_TOOL = {
  name: 'suggest_meal',
  description: 'The athlete asked WHAT TO EAT or HOW TO CLOSE a gap ("what should I eat", "how do I hit my protein", "what closes the day"). Call this INSTEAD of reply: the app fills in up to three of the athlete\'s own saved usual meals that fit what is left of their day, each one tap from being planned (they log it with a photo). You write only the framing line and a fallback sentence. Never call it unprompted, and never for a question that is not about what to eat next.',
  input_schema: {
    type: 'object',
    properties: {
      protein_gap_g: { type: 'integer', description: 'Grams of protein still to eat today, taken EXACTLY from the context (proteinTarget minus proteinSoFar). 0 when the context has no target.' },
      kcal_gap: { type: 'integer', description: 'Calories still to eat today, only when both a calorie target and today\'s total are in the context. Omit otherwise.' },
      framing: { type: 'string', description: 'ONE short sentence the athlete reads above the suggestions, in your coach voice, e.g. "You are 40g short with dinner still open, so here is what usually gets you there." Numbers only from the context. Plain text: no asterisks or other markdown. No em dashes.' },
      fallback: { type: 'string', description: 'ONE sentence shown INSTEAD of suggestions when none of their saved meals fit: a concrete, doable move using only what the context supports (a protein-forward plate at the open meal, a size to aim for). Never name a specific food they have not logged. Plain text: no asterisks or other markdown. No em dashes.' },
    },
    required: ['protein_gap_g', 'framing', 'fallback'],
  },
};

/* Plain text by contract: the row text is what coach.js and trust.js print. The reply prompt lets
   Nia bold one figure and she carried the habit into these fields, so the founder's what-to-eat
   bubble read "**180g**" (2026-09-24). The marks are dropped here and the words kept. */
const noDash = (s) => String(s ?? '').replace(/—/g, ',').replace(/[<>]/g, '').replace(/\*\*|__|==/g, '').replace(/\s+/g, ' ').trim();
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

/* ------------------------------------------------------------------------------------------------
 * PLAN IDEAS (goals and eating plan, phase A1, 2026-09-25).
 *
 * Plan > Today offers up to three ideas for the next meal slot: the athlete's own usuals first
 * (ranked on the device), then Nia's to fill. This is the model half of that, and it is the only
 * place the model NAMES food for the athlete to plan, so it is fenced:
 *   - the model returns names, figures and fit tags through one forced tool; nothing it returns
 *     can log a meal (a plan only plans; the camera is the only way to log);
 *   - every name passes the tool-leak scrubber, a plain character set and a length cap, and a
 *     name that carries a figure is dropped (the figures live in their own fields, which an
 *     Intuitive athlete's screen never shows);
 *   - anything that names an allergy, an intolerance or a dislike is dropped deterministically,
 *     after the model, whatever the model did;
 *   - the result is cached per athlete, day and slot (plan_ideas, 0250), so opening Plan never
 *     bills twice.
 * ---------------------------------------------------------------------------------------------- */

export const PLAN_IDEAS_TOOL = {
  name: 'plan_ideas',
  description: 'Return up to three meal ideas the athlete could plan for their next meal slot. Real, ordinary meals they can get or make today, sized for the slot target when one is given. Tag each idea only with the preferences it truly fits.',
  input_schema: {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The meal in two to five plain words, e.g. "Turkey and rice bowl". No numbers, no brand claims, no emoji.' },
            protein_g: { type: 'integer', description: 'Typical grams of protein for one serving as you would size it.' },
            kcal: { type: 'integer', description: 'Typical calories for that serving.' },
            tags: { type: 'array', items: { type: 'string', enum: ['budget', 'no_cook', 'grab_and_go'] }, description: 'budget = about $5 or less; no_cook = needs no stove or oven (a dorm can make it); grab_and_go = easy to eat on the move. Only tags that are true.' },
          },
          required: ['name', 'protein_g', 'kcal'],
        },
      },
    },
    required: ['ideas'],
  },
};

export const PLAN_IDEAS_SYSTEM = [
  'Right now you are choosing meal ideas an athlete can plan for one meal slot.',
  'Suggest ordinary, realistic meals: things a college or high school athlete can buy, get at a dining hall, or make simply.',
  'Size each idea for the slot target when one is given, and spread the three: not three versions of the same plate.',
  'Never suggest a food the athlete is allergic or intolerant to or said they do not eat, and never one of the usual meals already listed.',
  'Never suggest supplements, diet products or eating less. Fuel them for training.',
  'Answer only through the plan_ideas tool.',
].join(' ');

const SLOT_RE = /^(breakfast|lunch|dinner|snack|meal-[1-9])$/;
const TAG_MAP = { budget: 'budget', no_cook: 'noCook', grab_and_go: 'grabGo' };

/**
 * The request body's planIdeas block, bounded. null when it is unusable. `today` is the server's
 * own ISO date; the day may be one either side of it (the athlete's clock is not UTC), never more,
 * so the cache cannot be walked across arbitrary dates.
 */
export function planIdeasRequest(raw, today) {
  const r = raw && typeof raw === 'object' ? raw : null;
  if (!r) return null;
  const slot = typeof r.slot === 'string' ? r.slot.trim().toLowerCase() : '';
  const dayDate = typeof r.dayDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dayDate) ? r.dayDate : '';
  if (!SLOT_RE.test(slot) || !dayDate) return null;
  if (today) {
    const d = Math.round((Date.parse(`${dayDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
    if (!Number.isFinite(d) || Math.abs(d) > 1) return null;
  }
  const n = (v, hi) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) && x > 0 && x <= hi ? x : null;
  };
  const usuals = [];
  for (const u of Array.isArray(r.usuals) ? r.usuals.slice(0, 5) : []) {
    const v = cleanPrefItem(typeof u === 'string' ? u.slice(0, 60) : '');
    if (v) usuals.push(v);
  }
  return {
    slot,
    slotTitle: cleanPrefItem(typeof r.slotTitle === 'string' ? r.slotTitle : '') || slot.replace('-', ' '),
    dayDate,
    proteinTarget: n(r.proteinTarget, 300),
    kcalTarget: n(r.kcalTarget, 4000),
    usuals,
  };
}

/** The user turn. `dossier` and `memory` are the server's own blocks (athlete-dossier.mjs,
 *  memory.ts); `prefs` is the stored food_prefs. Figures appear only as a sizing target.
 *  @param {{ slotTitle: string, proteinTarget: number|null, kcalTarget: number|null, usuals: string[] }} req
 *  @param {{ prefs?: unknown, dossier?: string, memory?: string }} [opts] */
export function planIdeasUserText(req, { prefs = null, dossier = '', memory = '' } = {}) {
  const lines = [`Meal slot: ${req.slotTitle}.`];
  const t = [];
  if (req.proteinTarget) t.push(`about ${req.proteinTarget}g protein`);
  if (req.kcalTarget) t.push(`about ${req.kcalTarget} calories`);
  if (t.length) lines.push(`Slot target: ${t.join(' and ')}.`);
  if (req.usuals.length) lines.push(`Their usual meals, already shown to them, so do not repeat these: ${req.usuals.join('; ')}.`);
  const p = prefsPromptText(prefs);
  if (p) lines.push(p);
  if (dossier) lines.push(dossier);
  if (memory) lines.push(memory);
  lines.push('Give up to three ideas through the plan_ideas tool.');
  return lines.join('\n\n');
}

/** A name that carries a figure ("40g protein bowl") is not a name. */
const FIGURE = /\d\s*(g|grams?|cal|kcal|calories|oz|lb|%)(?![\p{L}])/iu;

/**
 * The model's tool input, as ideas the client can show. Every name is scrubbed, plain, capped
 * and figure-free; anything that names a word in `avoid` is dropped; figures are clamped; tags
 * are mapped to the client's preference keys. [] when nothing survives.
 */
/** @param {unknown} input @param {{ avoid?: string[], max?: number }} [opts] */
export function parsePlanIdeas(input, { avoid = [], max = 3 } = {}) {
  const raw = input && typeof input === 'object' && Array.isArray(input.ideas) ? input.ideas : [];
  const out = [];
  const seen = new Set();
  const n = (v, hi) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.max(0, Math.min(hi, x)) : 0;
  };
  for (const it of raw) {
    if (out.length >= max) break;
    if (!it || typeof it !== 'object') continue;
    const name = scrubToolLeak(String(it.name ?? ''))
      .replace(/[^\p{L}\p{N} &'\-,.()]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 48).trim();
    if (name.length < 3 || FIGURE.test(name) || seen.has(name.toLowerCase())) continue;
    if (namesAny([name], avoid)) continue;
    seen.add(name.toLowerCase());
    const tags = [];
    for (const t of Array.isArray(it.tags) ? it.tags : []) {
      const k = TAG_MAP[t];
      if (k && !tags.includes(k)) tags.push(k);
    }
    out.push({ name, protein: n(it.protein_g, 300), kcal: n(it.kcal, 4000), tags });
  }
  return out;
}
