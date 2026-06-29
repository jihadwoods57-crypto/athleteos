// AthleteOS — analyze-meal Edge Function (Supabase / Deno).
// Holds ANTHROPIC_API_KEY server-side and runs Claude vision. The app never sees the key.
// THREE modes, dispatched on the request `mode` field:
//   * 'meal'  (default) — read a plate photo, ESTIMATE macros, score for the goal (MealResult).
//   * 'label'          — transcribe a Nutrition Facts panel EXACTLY (LabelFacts). The numbers
//                        are read, not estimated, so this path does no grounding/guessing.
//   * 'memory'         — reword the app's COMPUTED memory insights in a warmer coach voice. The
//                        numbers are the app's ground truth: the model may only rephrase, never
//                        change a figure, and the client re-checks every number before showing it.
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy analyze-meal
// Then set EXPO_PUBLIC_SUPABASE_URL + ANON_KEY in the app (.env) and isAiConfigured flips on.
//
// Model is configurable via the ANTHROPIC_MODEL secret; defaults to claude-sonnet-4-6
// (the right cost/latency tier for high-volume per-meal vision; claude-opus-4-8 is the
// higher tier). MEAL macros from the model are ESTIMATES — ground them against a food
// database (see groundMacros) before you trust them for scoring. LABEL numbers are read off
// the panel verbatim, so they need no grounding.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.65.0';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface MemoryInsightIn {
  id: string;
  kind?: string;
  tone?: string;
  headline: string;
  detail: string;
  metric?: string;
}

interface AnalyzeReq {
  /** 'meal' (default) estimates a plate; 'label' transcribes a panel; 'memory' rewords insights. */
  mode?: 'meal' | 'label' | 'memory';
  mealType: 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner';
  goal: string | null;
  description?: string;
  photoBase64?: string;
  /** For mode 'memory': the deterministic insights to reword (prose only is returned). */
  insights?: MemoryInsightIn[];
}

// The exact shape the app renders (src/core MealResult). The model fills this via a
// forced tool call so the response is always valid structured data.
const MEAL_TOOL = {
  name: 'report_meal_analysis',
  description: 'Report the structured analysis of the athlete meal photo.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short dish name, e.g. "Chicken, Rice & Broccoli".' },
      quality: { type: 'integer', minimum: 0, maximum: 100, description: 'Meal quality 0-100 for an athlete with the stated goal.' },
      protein: { type: 'integer', description: 'Estimated grams of protein.' },
      kcal: { type: 'integer', description: 'Estimated calories.' },
      carbs: { type: 'integer', description: 'Estimated grams of carbohydrate.' },
      fat: { type: 'integer', description: 'Estimated grams of fat.' },
      detected: { type: 'array', items: { type: 'string' }, description: 'Foods identified in the photo.' },
      note: { type: 'string', description: 'One coach-voiced sentence tying this meal to the athlete goal. No hype, no em dashes.' },
    },
    required: ['name', 'quality', 'protein', 'kcal', 'carbs', 'fat', 'detected', 'note'],
  },
} as const;

const SYSTEM = `You are the AthleteOS nutrition coach: a sharp, encouraging sports nutritionist for
serious high-school and college athletes (ages 13-22). Read the meal photo, identify the foods,
estimate macros, score the meal for THIS athlete's goal, and give one honest coach-voiced sentence.
Voice: direct, motivating, precise, never hype, never cutesy. Safety: never give extreme or
restrictive advice, never frame food as good/bad in a way that could fuel disordered eating; coach
toward fueling performance. Numbers are estimates; be reasonable. No em dashes in any text.
Always answer by calling report_meal_analysis.`;

// The exact shape src/core LabelFacts expects. The model transcribes the printed panel PER
// SERVING; it does not estimate. Required fields are the four macros + ingredients; the rest
// are filled only when actually printed.
const LABEL_TOOL = {
  name: 'report_label_facts',
  description: 'Report the Nutrition Facts panel exactly as printed, per serving.',
  input_schema: {
    type: 'object',
    properties: {
      productName: { type: 'string', description: 'Product name from the packaging, if visible. Omit if unknown.' },
      servingSize: { type: 'string', description: 'Serving size exactly as printed, e.g. "1 bar (60g)". Omit if not shown.' },
      servingsPerContainer: { type: 'number', description: 'Servings per container, if printed.' },
      calories: { type: 'integer', description: 'Calories PER SERVING, as printed.' },
      protein: { type: 'integer', description: 'Grams of protein per serving, as printed.' },
      carbs: { type: 'integer', description: 'Grams of total carbohydrate per serving, as printed.' },
      fat: { type: 'integer', description: 'Grams of total fat per serving, as printed.' },
      sugar: { type: 'integer', description: 'Grams of total sugars per serving, if printed.' },
      fiber: { type: 'integer', description: 'Grams of dietary fiber per serving, if printed.' },
      sodium: { type: 'integer', description: 'Milligrams of sodium per serving, if printed.' },
      ingredients: { type: 'array', items: { type: 'string' }, description: 'The ingredient list in printed order, each ingredient a separate string. Empty array if no ingredient list is visible.' },
    },
    required: ['calories', 'protein', 'carbs', 'fat', 'ingredients'],
  },
} as const;

const LABEL_SYSTEM = `You read Nutrition Facts labels for AthleteOS. Transcribe the panel EXACTLY as
printed, PER SERVING. This is transcription, not estimation: report only what you can read. If a
value is not visible, omit that field rather than guessing (use 0 only if the label literally prints
0). Read the ingredient list verbatim, in order, splitting on commas into separate entries; drop
parenthetical sub-ingredients only if unreadable. Do not editorialize or add advice. Always answer
by calling report_label_facts.`;

// The shape the app expects back for mode 'memory': prose only, keyed by id. The model rewords
// headline + detail; it returns nothing else. The CLIENT (core/nutritionMemoryVoice.ts) verifies
// every number is preserved before showing any of it, so the numbers can never drift here.
const MEMORY_TOOL = {
  name: 'report_memory_voice',
  description: 'Return the rephrased insights, prose only, one entry per input id.',
  input_schema: {
    type: 'object',
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The exact id of the input insight being rephrased.' },
            headline: { type: 'string', description: 'Rephrased short headline. Keep every number identical to the input.' },
            detail: { type: 'string', description: 'Rephrased one-to-two sentence detail. Keep every number identical to the input.' },
          },
          required: ['id', 'headline', 'detail'],
        },
      },
    },
    required: ['insights'],
  },
} as const;

const MEMORY_SYSTEM = `You are the AthleteOS nutrition coach giving an athlete a warm, human read on their
own logged-eating trends. You are handed insights the app already COMPUTED from real data. Your only
job is to reword each one in a warmer, more personal coach voice. Hard rules: keep EVERY number
exactly as given (never change, add, or drop a figure or unit); never invent a fact, food, day count,
or claim that is not in the input; keep the same meaning and the same good/bad direction; one or two
short sentences per insight; direct and encouraging, never hype, never cutesy, no em dashes. Return
one entry per input id, with its id unchanged, by calling report_memory_voice.`;

function memoryContent(req: AnalyzeReq): unknown[] {
  const items = (req.insights ?? []).map((i) => ({ id: i.id, headline: i.headline, detail: i.detail, metric: i.metric }));
  return [{
    type: 'text',
    text: `Reword these insights in a warmer coach voice, keeping every number exactly. Return one entry per id.\n\n${JSON.stringify(items, null, 2)}`,
  }];
}

function userContent(req: AnalyzeReq): unknown[] {
  const blocks: unknown[] = [];
  if (req.photoBase64) {
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: req.photoBase64 },
    });
  }
  const goal = req.goal ? `Athlete goal: ${req.goal}.` : 'Athlete goal: general athletic development.';
  const desc = req.description ? ` Athlete note: ${req.description}.` : '';
  blocks.push({
    type: 'text',
    text: `${goal} Meal slot: ${req.mealType}.${desc} Analyze the meal${req.photoBase64 ? ' in the photo' : ' (no photo provided; infer a typical ' + req.mealType.toLowerCase() + ')'} and report it.`,
  });
  return blocks;
}

function labelContent(req: AnalyzeReq): unknown[] {
  const blocks: unknown[] = [];
  if (req.photoBase64) {
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: req.photoBase64 },
    });
  }
  blocks.push({
    type: 'text',
    text: 'Transcribe this Nutrition Facts panel exactly as printed, per serving, and report it. Read the ingredient list verbatim.',
  });
  return blocks;
}

/** Macro grounding now lives CLIENT-SIDE in src/core/macroGrounding.ts (groundMealResult),
 *  next to the scoring authority and the curated food DB, so it's unit-tested and can't drift
 *  from the DB. The function returns the model's raw estimate + detected foods; the app bounds
 *  the macros (food-DB plausibility + Atwater consistency) before they touch the score. This
 *  passthrough is kept as the seam in case server-side grounding is ever added. */
function groundMacros<T>(analysis: T): T {
  return analysis;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return new Response(JSON.stringify({ error: 'server not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let req: AnalyzeReq;
  try {
    req = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const isLabel = req?.mode === 'label';
  const isMemory = req?.mode === 'memory';

  // Input guards: reject an oversized/missing photo before spending an Anthropic call.
  // A base64 JPEG over ~8MB raw (~6MB image) is almost certainly abuse and would risk a
  // Deno timeout / token burn; cap it.
  if (typeof req.photoBase64 === 'string' && req.photoBase64.length > 8_000_000) {
    return new Response(JSON.stringify({ error: 'photo too large' }), { status: 413, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  if (isMemory) {
    // Rewording needs at least one insight, and no more than a sane cap (memory shows ~6).
    if (!Array.isArray(req.insights) || req.insights.length === 0) {
      return new Response(JSON.stringify({ error: 'insights required for memory rephrase' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (req.insights.length > 12 || !req.insights.every((i) => i && typeof i.id === 'string' && typeof i.headline === 'string' && typeof i.detail === 'string')) {
      return new Response(JSON.stringify({ error: 'bad insights' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  } else if (isLabel) {
    // A label scan is pure transcription — it MUST have the panel image; nothing to read otherwise.
    if (typeof req.photoBase64 !== 'string' || !req.photoBase64) {
      return new Response(JSON.stringify({ error: 'photo required for label scan' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  } else if (typeof req?.mealType !== 'string' || !req.mealType.trim()) {
    // The meal prompt needs the slot (and can infer a typical meal when no photo is sent).
    return new Response(JSON.stringify({ error: 'mealType required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const system = isMemory ? MEMORY_SYSTEM : isLabel ? LABEL_SYSTEM : SYSTEM;
  const tool = isMemory ? MEMORY_TOOL : isLabel ? LABEL_TOOL : MEAL_TOOL;
  const content = isMemory ? memoryContent(req) : isLabel ? labelContent(req) : userContent(req);

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content }],
    });
    const used = msg.content.find((b) => b.type === 'tool_use');
    if (!used || used.type !== 'tool_use') throw new Error('no structured output');
    // Label facts + memory prose are returned as-is (the CLIENT bounds memory numbers); meal
    // macros pass through groundMacros.
    const result = isLabel || isMemory ? used.input : groundMacros(used.input);
    return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
