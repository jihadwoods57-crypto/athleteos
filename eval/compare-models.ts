// Directional model comparison: GPT-5.6 Luna / Terra (OpenAI) vs. the Claude Sonnet 5 baseline
// this product actually ships on. NOT a replacement for eval/run-eval.ts (the real regression
// gate) — this is a one-off spend-the-money-once comparison to inform a provider/model decision.
// Runs across every meal in eval/manifest.json (6 real photos as of 2026-07-30).
//
// Scope, stated loudly because it caps how much this run can prove:
//   * Claude arm reuses the committed eval/responses/<id>.json — the real live Sonnet-5 responses
//     from the `npm run eval` pass done right before this (2026-07-30 23:32-33 UTC). No fresh
//     Claude call is made here, and there is no Haiku 4.5 arm.
//   * Sonnet cost per meal is NOT computed from a price table in this script — it's hardcoded from
//     the real ai_calls rows for that exact run (input/output tokens x today's $2/$10-per-Mtok
//     intro price from ai_model_prices; rises to $3/$15 on 2026-09-01).
//   * GPT arm makes real paid calls (Luna, Terra) per meal via the OpenAI Responses API, same
//     photos, an equivalent system prompt + tool schema to analyze-meal's MEAL_TOOL, scored
//     through the exact same scoreMeal() the real eval gate uses.
//   * Several manifest entries have FOOD_DB coverage gaps (no bacon/sausage/grits/onion/mashed-
//     potato/collard-greens/sour-cream entries) — see each entry's "notes" in manifest.json. Those
//     gaps make ground truth run low independent of which model is being scored; they hit every
//     model in this comparison equally, but inflate every model's apparent kcal/protein error.
//
// Run: OPENAI_API_KEY=... npx tsx eval/compare-models.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreMeal, type ManifestEntry, type MealResponse } from '../src/core/evalScore';

const DIR = dirname(fileURLToPath(import.meta.url));
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

const manifest: ManifestEntry[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));

// Real per-meal cost, read from ai_calls for the live `npm run eval` pass that produced the
// committed eval/responses/*.json (2026-07-30 23:32:43-23:33:41 UTC), at today's intro price
// ($2/$10 per Mtok input/output, ai_model_prices effective_from 1970-01-01 row).
const SONNET_COST_USD: Record<string, number> = {
  'clear-01': 0.0106,
  'meatball-tray': 0.0143,
  'steak-potatoes': 0.013,
  'chicken-beef-collards': 0.0142,
  'breakfast-plate': 0.0143,
  tacos: 0.0162,
};

// Same system prompt analyze-meal uses, trimmed to the parts that shape a first-pass photo read
// (coach-voice threading like Day-context callbacks and slotTarget substitution do not apply to a
// bare eval call with no athlete/session state, so those clauses are dropped rather than fed
// instructions they can never act on).
const SYSTEM = `You are the OnStandard nutrition coach: a sharp, encouraging sports nutritionist for
serious high-school and college athletes (ages 13-22). Read the meal photo, identify the foods,
estimate macros, and score the meal quality 0-100 for a general athletic-development goal.

Voice: direct, motivating, precise, never hype, never cutesy. Safety: never give extreme or
restrictive advice, never frame food as good/bad in a way that could fuel disordered eating; coach
toward fueling performance. Numbers are estimates; be reasonable. No em dashes in any text.

Confidence honesty: mark a detected food "low" whenever the photo alone cannot confirm it. Fiber
and highlights are estimates from what is visible; when nothing is clearly notable, return
highlights as an empty array.

The analysis field is the athlete's main read: one paragraph, 3 to 6 sentences, coach voice —
what the meal is and roughly how much, why the macros read the way they do, and the single most
valuable adjustment. Never a list of generic tips.

Estimate language: your numbers are photo estimates and the analysis must sound like it. Prefer
ranges and hedged phrasing ("roughly 42 to 50g of protein", "around 620 calories").

Consistency rules, hard requirements: your written analysis, detected list, macro numbers, and
quality score must agree with each other. Attribute the macros food by food: every detected food
carries its own protein/kcal/carbs/fat estimate, and those per-food numbers must add up to the
meal-level totals you report. Never claim "no fiber" or "no vegetables" when the detected list
contains a vegetable, fruit, legume, or whole grain. Never praise protein in the text while
reporting a low protein number, or the reverse.`;

// Mirrors analyze-meal's MEAL_TOOL (supabase/functions/analyze-meal/index.ts), trimmed to the
// fields scoreMeal() actually reads (detected/protein/kcal/carbs/fat/quality/fiber/analysis) plus
// the fields required to keep the model honest (name, note, descriptionSignal).
const MEAL_FUNCTION = {
  type: 'function' as const,
  name: 'report_meal_analysis',
  description: 'Report the structured analysis of the athlete meal photo.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short dish name, e.g. "Chicken, Rice & Broccoli".' },
      quality: { type: 'integer', minimum: 0, maximum: 100, description: 'Meal quality 0-100 for an athlete with a general athletic-development goal.' },
      protein: { type: 'integer', description: 'Estimated grams of protein.' },
      kcal: { type: 'integer', description: 'Estimated calories.' },
      carbs: { type: 'integer', description: 'Estimated grams of carbohydrate.' },
      fat: { type: 'integer', description: 'Estimated grams of fat.' },
      detected: {
        type: 'array',
        description: 'Foods identified in the photo, each with confidence and its own macro estimate. Per-food protein/kcal/carbs/fat MUST sum to the meal-level totals.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            quantity: { type: 'string' },
            protein: { type: 'integer' },
            kcal: { type: 'integer' },
            carbs: { type: 'integer' },
            fat: { type: 'integer' },
          },
          required: ['name', 'confidence', 'protein', 'kcal', 'carbs', 'fat'],
        },
      },
      fiber: { type: 'integer', description: 'Estimated grams of dietary fiber. 0 when negligible.' },
      highlights: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short micronutrient highlights. Empty when nothing stands out.' },
      note: { type: 'string', description: 'One coach-voiced sentence tying this meal to the athlete goal. No hype, no em dashes.' },
      analysis: { type: 'string', description: '3-6 sentence athlete-facing read in the coach voice. No em dashes.' },
      descriptionSignal: { type: 'string', enum: ['match', 'photo_heavier', 'photo_lighter', 'no_photo'], description: 'No athlete note was given for this eval call, so this is always "no_photo".' },
    },
    required: ['name', 'quality', 'protein', 'kcal', 'carbs', 'fat', 'detected', 'fiber', 'note', 'analysis', 'descriptionSignal'],
  },
};

// $ / 1M tokens. GPT-5.6 from OpenAI's 2026 pricing page (developers.openai.com/api/docs/pricing).
const GPT_PRICES: Record<string, { in: number; out: number }> = {
  'gpt-5.6-luna': { in: 0.20, out: 1.20 },
  'gpt-5.6-terra': { in: 2.00, out: 12.00 },
};
const GPT_MODELS = Object.keys(GPT_PRICES);

async function callGpt(model: string, photoB64: string) {
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model,
      input: [
        { type: 'message', role: 'system', content: [{ type: 'input_text', text: SYSTEM }] },
        {
          type: 'message', role: 'user',
          content: [
            { type: 'input_text', text: 'Analyze this athlete meal photo and call report_meal_analysis.' },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${photoB64}` },
          ],
        },
      ],
      tools: [MEAL_FUNCTION],
      tool_choice: { type: 'function', name: 'report_meal_analysis' },
    }),
  });
  const ms = Date.now() - t0;
  const data = await res.json().catch(() => null) as any;
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status} ${JSON.stringify(data)}`);
  const call = (data.output || []).find((o: any) => o.type === 'function_call');
  if (!call) throw new Error(`${model}: no function_call in output — ${JSON.stringify(data.output)}`);
  const resp: MealResponse = JSON.parse(call.arguments);
  const usage = data.usage || {};
  const price = GPT_PRICES[model];
  const cost = price ? (usage.input_tokens || 0) / 1e6 * price.in + (usage.output_tokens || 0) / 1e6 * price.out : null;
  return { resp, ms, inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null, cost };
}

type Row = { model: string; id: string; ms: number | null; cost: number | null; source: string; score: ReturnType<typeof scoreMeal> | null };

function aggregate(rows: Row[]) {
  const s = rows.map((r) => r.score).filter(Boolean) as ReturnType<typeof scoreMeal>[];
  const n = s.length || 1;
  const mean = (f: (x: ReturnType<typeof scoreMeal>) => number) => s.reduce((a, x) => a + f(x), 0) / n;
  const costs = rows.map((r) => r.cost).filter((c): c is number => c != null);
  const lat = rows.map((r) => r.ms).filter((m): m is number => m != null);
  return {
    meals: s.length,
    avg_cost_usd: costs.length ? +(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4) : null,
    avg_latency_ms: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    detection_recall: +mean((x) => x.detection.recall).toFixed(3),
    detection_precision: +mean((x) => x.detection.precision).toFixed(3),
    kcal_err_pct: +mean((x) => x.macroError.kcal.pct).toFixed(3),
    protein_err_pct: +mean((x) => x.macroError.protein.pct).toFixed(3),
    contradiction_rate: +mean((x) => (x.contradiction ? 1 : 0)).toFixed(3),
  };
}

(async () => {
  if (!OPENAI_KEY) { console.error('Set OPENAI_API_KEY.'); process.exit(1); }

  const allRows: Row[] = [];

  for (const entry of manifest) {
    console.log(`\n=== ${entry.id} (${entry.caseType}) ===`);
    const photoB64 = readFileSync(join(DIR, 'meals', entry.photo)).toString('base64');

    const claudeResp: MealResponse = JSON.parse(readFileSync(join(DIR, 'responses', `${entry.id}.json`), 'utf8'));
    allRows.push({
      model: 'claude-sonnet-5', id: entry.id, ms: null, cost: SONNET_COST_USD[entry.id] ?? null,
      source: 'live 2026-07-30 run (eval/responses)', score: scoreMeal(claudeResp, entry),
    });

    for (const model of GPT_MODELS) {
      console.log(`  calling ${model}...`);
      try {
        const { resp, ms, inputTokens, outputTokens, cost } = await callGpt(model, photoB64);
        writeFileSync(join(DIR, 'responses', `compare-${model}-${entry.id}.json`), JSON.stringify(resp, null, 2));
        allRows.push({
          model, id: entry.id, ms, cost, source: `live, ${inputTokens}in/${outputTokens}out`,
          score: scoreMeal(resp, entry),
        });
      } catch (e) {
        console.error(`    ${model} failed: ${(e as Error).message}`);
        allRows.push({ model, id: entry.id, ms: null, cost: null, source: `FAILED: ${(e as Error).message}`, score: null });
      }
    }
  }

  console.log('\n\n=== PER-MEAL (kcal_err_pct / protein_err_pct / detection recall,precision) ===');
  const perMeal: Record<string, any> = {};
  for (const entry of manifest) {
    for (const model of ['claude-sonnet-5', ...GPT_MODELS]) {
      const r = allRows.find((x) => x.id === entry.id && x.model === model);
      const key = `${entry.id} / ${model}`;
      perMeal[key] = r?.score ? {
        cost: r.cost != null ? `$${r.cost.toFixed(4)}` : 'n/a',
        kcal_err: +r.score.macroError.kcal.pct.toFixed(3),
        protein_err: +r.score.macroError.protein.pct.toFixed(3),
        recall: r.score.detection.recall,
        precision: r.score.detection.precision,
      } : { cost: 'n/a', kcal_err: 'n/a', protein_err: 'n/a', recall: 'n/a', precision: 'n/a' };
    }
  }
  console.table(perMeal);

  console.log('\n=== AGGREGATE ACROSS ALL 6 MEALS ===');
  const agg: Record<string, any> = {};
  for (const model of ['claude-sonnet-5', ...GPT_MODELS]) {
    agg[model] = aggregate(allRows.filter((r) => r.model === model));
  }
  console.table(agg);
})();
