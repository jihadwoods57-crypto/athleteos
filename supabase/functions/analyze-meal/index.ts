// AthleteOS — analyze-meal Edge Function (Supabase / Deno).
// Holds ANTHROPIC_API_KEY server-side and runs Claude vision on a meal photo, returning
// the MealResult the app already renders. The app never sees the key. Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy analyze-meal
// Then set EXPO_PUBLIC_SUPABASE_URL + ANON_KEY in the app (.env) and isAiConfigured flips on.
//
// Model is configurable via the ANTHROPIC_MODEL secret; defaults to claude-sonnet-4-6
// (the right cost/latency tier for high-volume per-meal vision; claude-opus-4-8 is the
// higher tier). Macros from the model are ESTIMATES — ground them against a food database
// (see groundMacros) before you trust the numbers for scoring (keeps the score honest).
import Anthropic from 'npm:@anthropic-ai/sdk@^0.65.0';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface AnalyzeReq {
  mealType: 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner';
  goal: string | null;
  description?: string;
  photoBase64?: string;
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

/** TODO (accuracy): ground the model's macro estimates against a food database keyed off
 *  `detected` so the protein/calorie numbers feeding the score are trustworthy, not guessed.
 *  Until wired, the model estimates pass through (fine for coaching prose, soft for scoring). */
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

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [MEAL_TOOL],
      tool_choice: { type: 'tool', name: 'report_meal_analysis' },
      messages: [{ role: 'user', content: userContent(req) }],
    });
    const tool = msg.content.find((b) => b.type === 'tool_use');
    if (!tool || tool.type !== 'tool_use') throw new Error('no structured output');
    const result = groundMacros(tool.input);
    return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
