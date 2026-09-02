// OnStandard — meal-chat Edge Function. The Team Discussion's AI half.
//
// Authority boundary (doc-05 discipline, same as assist): the model DISCUSSES the
// deterministic context the client hands it — it never fetches coaching data, never
// computes or alters a number, and may only repeat figures already present in the
// provided context. The function's only reads are AUTHORIZATION: an RLS-scoped select
// (caller's JWT) proving the meal belongs to the caller. On success the reply is
// persisted into meal_comments as role 'ai' via the service role — 0046 deliberately
// forbids clients from writing 'ai' rows, so AI messages can never be forged.
//
// Spend caps: a per-athlete daily budget (`meal_chat:<uid>`, MEAL_CHAT_DAILY_CAP, default 10),
// keyed against claim_ai_usage_key (0030), fails OPEN — deliberately NOT the shared analyze-meal
// claim_ai_usage counter, so chat questions and photo analyses are metered independently.
//
// There is no global fail-closed backstop here (capacity audit F2, docs/scale/CAPACITY-AUDIT.md):
// every caller reaching this function is already authenticated (see the 401 below), so a
// platform-wide fail-closed counter guards against traffic that structurally cannot occur, while
// being the single most likely thing to 429 every coach's roster at once. Authed usage is tracked
// against a monthly tier-budget SIGNAL (trackAuthedAiSpend) that never blocks.
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { recordAiCall, usageFrom } from '../_shared/ai-telemetry.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import {
  composeSystem, violatesStyleLanguage, styleCorrectionMessage, SAFE_INTUITIVE, type PlanStyle,
} from '../_shared/plan-style.ts';
import { loadPlanStyleForAthlete } from '../_shared/plan-style-load.ts';
import { clientIpFrom } from '../_shared/client-ip.ts';
import { trackAuthedAiSpend } from '../_shared/ai-tier-budget.ts';
import { checkSpend, EST_USD } from '../_shared/spend-gate.ts';
import { loadMemoryForAthlete } from '../_shared/memory-load.ts';
import { memoryBlock, chatFactCandidate, factKey, memoryOfferLine, CHAT_FACT_KINDS, type ChatFactKind } from '../_shared/memory.ts';
import { flagOn } from '../_shared/feature-flags.ts';
import { routeForCoachMeal } from '../_shared/followup.ts';
import { chatVoiceDirective } from '../_shared/coach-voice.ts';
import { loadVoiceForAthlete } from '../_shared/coach-voice-load.ts';

// Per-surface override first: one shared ANTHROPIC_MODEL meant chat could not move tiers
// without dragging vision with it. Unset -> unchanged.
const MODEL = Deno.env.get('ANTHROPIC_MODEL_MEAL_CHAT') ?? Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';
const DAILY_CAP = Math.max(1, Math.floor(Number(Deno.env.get('MEAL_CHAT_DAILY_CAP') ?? '10')) || 10);
const CONTEXT_MAX = 8192;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Keyed daily claim against ai_usage_key_daily (migration 0030: claim_ai_usage_key(p_key text,
// p_limit int) returns (allowed, used); security definer, execute granted to service_role only,
// so the call goes through the service-role client). Per-athlete: key `meal_chat:<uid>` /
// `meal_draft:<uid>`, limit DAILY_CAP, failOpen=true — an infra hiccup never blocks a legit
// question.
async function withinKeyCap(key: string, limit: number, failOpen = true): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return failOpen;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await sb.rpc('claim_ai_usage_key', { p_key: key, p_limit: limit });
    if (error) return failOpen;
    const row = Array.isArray(data) ? data[0] : data;
    return row?.allowed !== false;
  } catch {
    return failOpen;
  }
}

// [COPIED VERBATIM from assist/index.ts] CORS allowlist: reflect the request Origin ONLY
// if it's on the allowlist. A native app sends no Origin header, so it's allowed; a
// browser Origin that isn't on the list gets no Access-Control-Allow-Origin.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return BASE_HEADERS;
  if (ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}

// [COPIED VERBATIM from assist/index.ts] Best-effort per-IP rate limit (mirrors
// analyze-meal), so the paid endpoint can't be hammered.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '30');
const RL_WINDOW_MS = 60_000;
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = clientIpFrom(req);
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS }); return false; }
  e.count++;
  return e.count > RL_MAX;
}

const REPLY_TOOL = {
  name: 'reply',
  description: 'Reply to the athlete inside their meal thread.',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Coach-voiced reply, 90 words max, plain prose, no em dashes. Reference only numbers present in the provided context. Encourage consistency first; educate, never shame.' },
    },
    required: ['message'],
  },
} as const;

/**
 * THE CORRECTION TOOL (founder escalation 2026-08-06). An athlete told the AI their Core Power
 * bottle says 42g right on the label; the AI looked at the logged 14g, decided the log was the
 * truth, and told the athlete to double-check their own bottle and "let your coach know". That
 * conversation is the exact opposite of this product: the athlete is holding the bottle — they are
 * the best sensor in the loop, and the system exists to update itself, not to delegate its own
 * bookkeeping to a teenager.
 *
 * When the athlete states a factual correction about an item in THIS meal, the model calls this
 * instead of writing a defensive paragraph. The app then applies the correction DETERMINISTICALLY
 * (per-item macros, totals, score, rubric, coach focus, day targets all recompute client-side from
 * the one canonical record) and every surface that renders this meal updates together. The model
 * writes only the acknowledgment — numbers never come from prose.
 *
 * SECOND ESCALATION (2026-08-09). The same failure, one layer over: an athlete logged two sausage
 * breakfast sandwiches and said "it had egg and cheese on both as well". The AI answered "Updating
 * this sandwich's numbers now" and NOTHING moved — because this tool could only RESTATE an item's
 * macros, never ADD a component to one. The athlete was describing composition, not reading a
 * label, so every macro field came back empty and the server read the call as changing nothing.
 * `add` is that missing half. The athlete names what was in it; the app prices each ingredient
 * from its own curated food reference and only falls back to the model's estimate when the
 * reference has no entry. Numbers still never come from prose.
 */
const CORRECTION_TOOL = {
  name: 'apply_correction',
  description: 'The athlete stated a factual correction about a specific item in THIS logged meal: a wrong product variant, a macro that contradicts what their packaging prints, a wrong PORTION ("that was two cups, not one"), or an ingredient the photo could not see ("it had egg and cheese on both"). Call this INSTEAD of arguing, hedging, or telling them to update the log or tell their coach — the app applies the correction, recalculates every number and the meal score, and updates every surface automatically.',
  input_schema: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'The detected food being corrected — match its name in the context items as closely as possible.' },
      newName: { type: 'string', description: 'Corrected name / exact product variant, e.g. "Fairlife Core Power 42g chocolate". Omit when the name is unchanged.' },
      /* PORTION IS A CORRECTION IN ITS OWN RIGHT (2026-08-28). Until this field existed, an
         athlete saying "that was two cups, not one" left the model no way to comply except to
         restate macros it had to invent, which is the one thing this tool is built to avoid:
         numbers never come from prose. The app now rescales the item from ITS OWN logged
         numbers by comparing this string to the quantity already on the item, unit-aware, so
         "8 oz" over a logged "4 oz" doubles it rather than octupling it. */
      quantity: { type: 'string', description: 'The corrected amount in plain kitchen units, e.g. "2 cups", "8 oz", "3 eggs". Use this WHENEVER the athlete corrects how MUCH of an item there was rather than what it was. Phrase it in the SAME kind of unit the item already carries so the app can compare them (if the item reads "1 cup", answer in cups). Do NOT also restate protein/kcal/carbs/fat for a pure portion correction: the app rescales the item from its own numbers, and your estimate would replace a measurement with a guess. Omit when the amount is unchanged.' },
      protein: { type: 'integer', description: 'Corrected grams of protein for THIS item, exactly as the athlete stated or their packaging prints. Omit when unchanged.' },
      kcal: { type: 'integer', description: 'Corrected calories for THIS item, only when the athlete stated them. Omit when unchanged.' },
      carbs: { type: 'integer', description: 'Corrected grams of carbohydrate for THIS item. Omit when unchanged.' },
      fat: { type: 'integer', description: 'Corrected grams of fat for THIS item. Omit when unchanged.' },
      add: {
        type: 'array',
        description: 'Ingredients the athlete says were part of THIS item but were not in the read ("it had egg and cheese on both", "there was avocado on it"). Use this whenever they describe what was in the food rather than restating its macros — it is the ONLY way an addition reaches their numbers. One entry per ingredient. Do not use it to correct an existing item\'s macros (use the macro fields) or to log a separate food they ate alongside it.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The ingredient in plain words, e.g. "egg", "cheddar cheese", "avocado". No brand unless the athlete named one.' },
            quantity: { type: 'string', description: 'How much, in kitchen units, counting the WHOLE item as logged: two sandwiches that each had one egg is "2 eggs". Omit only when the athlete gave no amount and one serving is the honest read.' },
            protein: { type: 'integer', description: 'Your best estimate of protein in grams for this quantity. The app prefers its own food reference and uses your number only when it has no entry for this ingredient, so give it as a fallback, never as the intended source of truth.' },
            kcal: { type: 'integer', description: 'Fallback calories estimate for this quantity. Same rule as protein.' },
            carbs: { type: 'integer', description: 'Fallback carbohydrate estimate in grams for this quantity.' },
            fat: { type: 'integer', description: 'Fallback fat estimate in grams for this quantity.' },
          },
          required: ['name'],
        },
      },
      /* A DIFFERENT FOOD IS DIFFERENT NUMBERS (2026-09-02). "It's actually salmon" used to rename
         the row and leave chicken's macros under it. The app now re-prices a renamed food from
         its own reference; when the reference has no entry it needs SOME number, and the only
         honest way to take one from the model is to label it an estimate so it is never treated
         as a label the athlete read. */
      perBasis: { type: 'string', enum: ['stated', 'estimate'], description: '"stated" (default) when the protein/kcal/carbs/fat fields are what the athlete said or their packaging prints. "estimate" when newName changes WHAT the food is (chicken to salmon, rice to sweet potato) and the athlete gave no numbers: then fill protein, kcal, carbs and fat with your best estimate for the corrected food at the quantity already logged, and mark them "estimate". The app prefers its own food reference and uses your estimate only when it has no entry.' },
      more: {
        type: 'array',
        description: 'OTHER items corrected in the SAME message. "That isn\'t steak, it\'s chicken, sweet potatoes and broccoli" corrects up to three logged items at once: put the first in the top-level fields and each remaining one here, same fields. Never split one message into several tool calls.',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string', description: 'The detected food being corrected, matched to the context items.' },
            newName: { type: 'string' },
            quantity: { type: 'string' },
            protein: { type: 'integer' }, kcal: { type: 'integer' }, carbs: { type: 'integer' }, fat: { type: 'integer' },
            perBasis: { type: 'string', enum: ['stated', 'estimate'] },
          },
          required: ['item'],
        },
      },
      missed: {
        type: 'array',
        description: 'WHOLE FOODS eaten as part of THIS meal that the read does not contain at all: a side left out of the photo, a drink beside the plate, a second plate someone sent a picture of afterwards ("I also had a roll", "forgot the milk", a photo of the rice that was not in the first shot). One entry per food. The app prices each from its own reference and it counts toward the meal score. Use this, not `add`, for a separate food; use `add` only for an ingredient inside an existing item. Never for food from a different meal.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The food in plain words, e.g. "dinner roll", "whole milk", "white rice".' },
            quantity: { type: 'string', description: 'How much, in kitchen units ("1 cup", "2 rolls", "12 oz"). Omit when one serving is the honest read.' },
            protein: { type: 'integer', description: 'Fallback estimate for this quantity; the app prefers its own reference.' },
            kcal: { type: 'integer' }, carbs: { type: 'integer' }, fat: { type: 'integer' },
          },
          required: ['name'],
        },
      },
      ack: { type: 'string', description: 'One to two conversational sentences to the athlete: own the miss plainly and without defensiveness ("Good catch, that is the 42g bottle"; "Two cups, got it") and say their numbers and score are updating now. Never tell them to update anything themselves or to notify their coach. Do NOT state new meal totals or new per-item macros; they are recomputed after this. No em dashes.' },
    },
    required: ['ack'],
  },
} as const;

// Coach OS Slice D draft mode: FOUR candidate replies the coach could send, one per stance.
// Forced tool with a fixed 4-item array. These are DRAFTS — the function persists nothing.
const DRAFT_STANCES = ['supportive', 'direct', 'context', 'followup'] as const;
const DRAFT_TOOL = {
  name: 'draft_replies',
  description: 'Draft exactly four alternative replies the coach could send to the athlete about this meal, one per stance.',
  input_schema: {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        description: 'Exactly four drafts, one for each stance in order: supportive, direct, context, followup.',
        items: {
          type: 'object',
          properties: {
            stance: { type: 'string', enum: ['supportive', 'direct', 'context', 'followup'] },
            text: { type: 'string', description: 'Coach-voiced draft to the athlete, 60 words max, plain prose, no em dashes, no markdown. Reference only numbers present in the provided context.' },
          },
          required: ['stance', 'text'],
        },
      },
    },
    required: ['drafts'],
  },
} as const;

const DRAFT_SYSTEM = `You are the OnStandard AI Nutritionist helping a COACH draft replies inside an athlete's meal thread.
Rules that bind you:
1. Use ONLY the provided context (this meal, their plan and goal, today's summary, recent meals, the thread). Never invent, recompute, or adjust any number; you may repeat numbers exactly as given.
2. Coach voice: specific, encouraging, practical. Consistency is praised before choices are critiqued. Never shame food, weight, or a late log.
3. When coach guidance appears in the context, defer to it explicitly.
4. Speak AS the coach TO the athlete about THEIR goal and plan, not generic nutrition advice.
5. Draft FOUR alternative replies the COACH could send, one per stance: supportive (reinforce what went right), direct (name the gap and the fix), context (ask one clarifying question), followup (propose one concrete next step).
6. These are drafts the coach will edit before sending. Do not sign them, do not send them.
7. 60 words maximum per draft. No em dashes. No markdown.`;

// Coach-question mode (founder, 2026-08-06): the coach ASKS the AI Nutritionist directly and it
// ALWAYS answers — unlike the retired auto-support path, there is no topic regex and no
// once-per-meal cap, because an explicit question deserves an explicit answer. The reply addresses
// the coach; the athlete can read the thread, so the athlete is spoken about with respect, never
// clinically dissected.
const COACH_ASK_SYSTEM = `You are the OnStandard AI Nutritionist. A COACH or TRAINER reviewing one of their athlete's meals is asking YOU a question.
Rules that bind you:
1. Use ONLY the provided context (this meal, targets, the thread). Never invent, recompute, or adjust any number; you may repeat numbers exactly as given.
2. Answer the coach directly and practically, like a staff nutritionist they trust. The athlete can read this thread too — refer to the athlete in the third person and stay respectful about them.
3. When asked for a recommendation, give a clear one grounded in what is actually in the context. If the context cannot support a firm answer, say so plainly and name the one thing you would check.
4. 100 words maximum. No em dashes. No markdown headers.
5. Never give medical, injury, weight-cutting, or disordered-eating guidance — those belong with qualified humans.`;

const SYSTEM = `You are the OnStandard AI Nutritionist inside an athlete's meal thread.
Rules that bind you:
1. Use ONLY the provided context (this meal, their plan and goal, today's summary, recent meals, the thread). Never invent, recompute, or adjust any number; you may repeat numbers exactly as given.
2. You are a real nutrition coach texting an athlete you know, never a report. Open with the one
   thing that matters most for what they asked, then give one or two specific, doable
   recommendations. Consistency is praised before choices are critiqued. Never shame food,
   weight, or a late log.
3. Make it THEIRS. When today's totals or their recent meals are in the context and they sharpen
   the answer, use them — where the day stands, a pattern you can see across their week. Never
   recite macros or nutrients as a list: the screen already shows every number, so a number
   belongs in your text only when it IS the advice (a portion to aim for, a gap to close).
4. Vary your language. No signature idiom — never "doing the heavy lifting" or "doing the
   work" — and never reuse the same opener or phrase twice in one thread. Each reply reads like
   a fresh text, not a template.
5. When coach guidance appears in the context, defer to it explicitly.
6. Answer the athlete's question for THEIR goal and plan, not generic nutrition advice.
7. 90 words maximum — a capable staff nutritionist texts short. No em dashes. No markdown headers.
8. STAY IN YOUR LANE. If the question is medical, an injury, weight cutting or making weight, or
   shows a troubled relationship with food, do NOT advise and do NOT reassure: call flag_for_coach.
   A confident-sounding answer from you is worse than silence there, because the athlete will act
   on it. Their coach is a real person who can actually help.
9. THE ATHLETE IS HOLDING THE FOOD; YOU ARE READING A LOG. The logged numbers came from a photo
   estimate that can misread a product variant or a portion. When the athlete tells you what their
   packaging actually prints, what the product actually is, or what the portion actually was, that
   is better evidence than the log — NEVER argue with it, never ask them to double-check their own
   label, and never tell them to update the log or to notify their coach. If apply_correction is
   available, call it; if it is not, accept the correction plainly in your reply and answer their
   question using their stated value.
10. AN AMOUNT THEY CORRECT IS A CORRECTION TOO. "That was two cups, not one", "it was the big
   bowl", "closer to 8oz" are the athlete telling you the photo misjudged the PORTION, and that
   belongs in apply_correction's quantity field. Do not answer it by restating macros: you would
   be replacing their measurement with your guess, and the app can rescale the item exactly from
   the numbers it already has. Never say a portion is updating unless you actually called the
   tool.
11. AN INGREDIENT THEY NAME IS A CORRECTION, NOT SMALL TALK. "It had egg and cheese on both",
   "there was avocado on it", "that was cooked in butter" are the athlete telling you the photo
   missed something real, and it belongs in apply_correction's add list, not in a paragraph
   agreeing with them. They will almost never state grams for these and they do not have to: the
   app prices what they name from its own food reference. Never answer a named ingredient with
   prose alone, and NEVER say numbers or a score are updating unless you actually called the tool.
12. REMEMBER WHAT THEY TELL YOU ABOUT THEMSELVES. When the athlete states a LASTING fact about
   how they eat, and the remember tool is available, call it instead of reply: an allergy or
   intolerance ("I'm lactose intolerant", "peanuts send me to the ER"), a food they never eat
   ("I hate salmon", "I don't eat pork"), a go-to they lean on ("I have Greek yogurt every
   morning"), a place they eat at often, or a standing timing pattern ("I lift at 6am so I eat
   after"). Your message still answers their question in full; the fact rides alongside it and
   the app asks them to confirm before it is kept. One fact per message, the clearest one. Do
   NOT call it for a one-off ("skipped breakfast today"), for something already listed under
   what you know about them, or for anything medical (a diagnosis, a medication, a weight goal),
   which is a flag_for_coach case. Never claim you will remember something unless you called it.
13. WHEN THE FOOD ITSELF WAS MISREAD, THE NUMBERS CHANGE WITH IT. "That isn't steak, it's
   chicken", "it's actually salmon", "that's sweet potato, not rice" are identity corrections:
   call apply_correction with newName for EACH item they corrected (the first in the top-level
   fields, the rest in the "more" list), and because a different food has different macros, fill in your
   best estimate for the corrected food at its logged amount with perBasis "estimate". Never
   leave a renamed food carrying the old food's numbers, and never handle three corrected items
   by fixing one.
14. A FOOD THEY LEFT OUT OF THE PHOTO STILL COUNTS. "I also had a roll", "forgot the milk", or
   an attached picture showing food from THIS meal that the read does not list, goes in
   apply_correction's "missed" list so it enters their numbers and score. Do not answer it with
   an eyeballed estimate in prose and do not tell them to log it separately.`;

/**
 * The escape hatch. An AI nutritionist that answers "should I cut 8lb this week" or "my knee hurts
 * after squats" is not being helpful — it is guessing at something with real consequences, in a
 * voice the athlete trusts. This routes those to the human who can actually help, and tells the
 * athlete plainly that it did.
 */
const FLAG_TOOL = {
  name: 'flag_for_coach',
  description: "Decline to answer and route this question to the athlete's coach.",
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', enum: ['medical', 'injury', 'weight_cutting', 'disordered_eating', 'other'] },
      note: { type: 'string', description: 'One sentence for the coach: what the athlete is asking.' },
    },
    required: ['reason', 'note'],
  },
} as const;

/**
 * THE MEMORY TOOL (2026-09-02). `athlete_memory_facts` has been READ by every AI surface since the
 * 2026-08 memory carrier landed, but the only WRITER was the correction loop on the client. An
 * athlete who typed "I'm lactose intolerant" into the thread was heard for exactly one reply; the
 * next plate was read cold and the AI suggested a milk-based recovery shake again. That is the
 * opposite of a nutritionist who knows you.
 *
 * The model calls this INSTEAD of reply when a lasting fact rides on the athlete's message: the
 * reply still answers them, and the fact is written as `pending_confirmation` under the athlete's
 * own row. It binds only when they tap "Yes, remember" under the bubble, the same gate the
 * inferred-from-corrections facts already go through (memory.js SAFETY RULE; memory-load.ts reads
 * `status = 'active'` only). Nothing the model heard becomes a rule until the person it is about
 * says so.
 *
 * Capability-gated by `canRemember`, exactly like apply_correction: only a client that renders the
 * confirmation chips gets the tool offered, so an older build never gets a reply row whose offer
 * it cannot show.
 */
const REMEMBER_TOOL = {
  name: 'remember',
  description: 'The athlete stated a LASTING fact about how they eat: an allergy or intolerance, a food they never eat, a go-to food, a restaurant they eat at often, or a standing meal-timing pattern. Call this INSTEAD of reply: `message` still answers what they asked, and the app will ask them to confirm the fact before it is kept. Never for a one-off, never for anything medical.',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Your full reply to the athlete, exactly as the reply tool would carry it: 90 words max, plain prose, no em dashes, numbers only from the context. Do not restate the fact as a question; the app asks for confirmation itself.' },
      kind: { type: 'string', enum: [...CHAT_FACT_KINDS], description: 'allergy for an allergy or intolerance; dislike for a food they never eat; favorite_food for a go-to; favorite_restaurant for a place; meal_timing for a standing schedule pattern.' },
      value: { type: 'string', description: 'The fact in the fewest plain words, as the athlete would say it back: "lactose", "salmon", "Greek yogurt", "Chipotle", "eats after a 6am lift". No sentences, no explanation, 60 characters max.' },
    },
    required: ['message', 'kind', 'value'],
  },
} as const;

function bad(status: number, error: string, cors: Record<string, string>) {
  return new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return bad(405, 'bad_request', cors);
  // For the failure-telemetry row in the outer catch: who was calling, and when the request
  // started. Assigned once auth resolves; null on a pre-auth failure.
  const t0req = Date.now();
  let telemUserId: string | null = null;
  try {
    if (rateLimited(req)) return bad(429, 'limit', cors);

    const body = await req.json().catch(() => null);
    const mealId = body?.mealId;
    // Coach-support mode (WS4d, founder-ratified 2/3/1): after the coach comments, the AI may
    // add AT MOST ONE short supporting message per meal — and only when the coach's message is
    // substantive (a question or a nutrition point), never on every post.
    const coachSupport = body?.coachSupport === true;
    // Coach-ask mode (2026-08-06): the coach's own question TO the AI Nutritionist. Always
    // answered — see COACH_ASK_SYSTEM. Question rides body.question, same as the athlete path.
    const coachAsk = body?.coachAsk === true;
    // Coach OS Slice D — draft mode: the coach asks for FOUR candidate replies. No question is
    // sent (there is nothing to answer yet), and NOTHING is persisted — these are drafts.
    const draftMode = body?.draftReplies === true;
    // Correction-update mode (2026-07-28): the athlete told us we misread the plate, the app has
    // already applied the deterministic fix, and the AI now says so in the thread as a NEW
    // message. Never an edit — the original read stays visible, so the coach can see both what
    // the athlete was first told and what they corrected. There is no question to answer here,
    // which is why it bypasses the question requirement below.
    const correctionUpdate = body?.correctionUpdate === true;
    // Capability flag (2026-08-06): "I know how to apply a structured correction returned by
    // apply_correction". Only a client that can actually recompute + resync every surface gets
    // the tool offered — an older build keeps today's reply-only contract (with the never-argue
    // prompt rule as its floor).
    const canApplyCorrection = body?.canApplyCorrection === true;
    // Capability flag (2026-09-02): "I render the remember-this confirmation under an AI bubble".
    // Same contract as canApplyCorrection: the tool is offered only to a client that can close the
    // loop it opens.
    const canRemember = body?.canRemember === true;
    const question = String((coachSupport ? body?.coachText : body?.question) ?? '').trim().slice(0, 500);
    const context = body?.context;
    // A chat PHOTO ATTACHMENT, passed as a storage KEY and never as image bytes. The client cannot
    // hand this function pixels: the object is re-read server-side with the service role below,
    // and only after the key is proven to sit inside the meal owner's own folder. That means a
    // caller cannot point the model at an arbitrary image, and cannot inflate the request body.
    const photoPathRaw = typeof body?.photoPath === 'string' ? body.photoPath.trim() : '';
    if (!mealId || !context || (!draftMode && !correctionUpdate && !question)) return bad(400, 'bad_request', cors);
    if (JSON.stringify(context).length > CONTEXT_MAX) return bad(400, 'bad_request', cors);

    // ---- authorization (RLS does the work) ----
    // Athlete mode: the caller must OWN the meal. Coach mode: the RLS-scoped select succeeding
    // for a non-owner proves can_view (linked coach/staff); the athlete row id comes from the DB.
    const auth = req.headers.get('authorization') ?? '';
    const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData?.user?.id;
    if (!callerId) return bad(401, 'unauthorized', cors);
    telemUserId = callerId;
    const { data: mealRow } = await userClient.from('meals').select('id, athlete_id').eq('id', mealId).maybeSingle();
    if (!mealRow) return bad(403, 'unauthorized', cors);
    // Coach modes (coachSupport + coachAsk + draft): the RLS-scoped select above succeeding for a
    // NON-owner proves can_view (linked coach/staff), so a coach must NOT own the meal. Athlete
    // mode: owner.
    const coachMode = coachSupport || coachAsk || draftMode;
    if (coachMode ? mealRow.athlete_id === callerId : mealRow.athlete_id !== callerId) return bad(403, 'unauthorized', cors);

    const service = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Plan style (0142) resolves for the MEAL OWNER, never the caller. In draft and coach-support
    // mode the caller is the COACH — but the person who reads the words is the athlete, so it is
    // their style that decides what may be said. Getting this backwards would let a coach
    // unknowingly send macro figures to an athlete who is deliberately not tracking them.
    const planStyle: PlanStyle | null =
      (await loadPlanStyleForAthlete(service, mealRow.athlete_id))?.style ?? null;
    // ATHLETE MEMORY (0019), for the MEAL OWNER — same reasoning as plan style: the person the
    // words are about is the athlete, not whoever is asking. Confirmed facts only. Loaded
    // server-side rather than merged into the client `context` blob, which is clamped at 8KB and
    // would silently drop them.
    const memBlock = (await flagOn(service, 'ai_memory', { userId: mealRow.athlete_id }))
      ? memoryBlock(await loadMemoryForAthlete(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, mealRow.athlete_id))
      : '';
    // COACH VOICE (2026-08-06): the team's (or, 0187, the practice's) AI Nutritionist config now
    // shapes every chat surface — athlete replies, coach questions, drafts. Resolved for the MEAL
    // OWNER like plan style and memory. Gated only by the config's own enabled flag (the page's
    // On/Off is the control, not the analyze-meal pilot flag): loadVoiceForAthlete returns null
    // when voice is off or unset, and a null directive keeps the prompt byte-identical to before.
    const voice = await loadVoiceForAthlete(service, mealRow.athlete_id);
    const voiceDirective = voice ? chatVoiceDirective(voice.cfg) : '';
    const styleSafe = (text: string): string => {
      // Shared tail of both call sites below: one corrected retry is handled inline by the
      // caller; this is the final rail that guarantees nothing unsafe is ever persisted.
      const v = violatesStyleLanguage(text, planStyle);
      return v ? SAFE_INTUITIVE.reply : text;
    };

    // ---- draft mode: four candidate coach-voice replies, PERSIST NOTHING ----
    if (draftMode) {
      // New rate-limit keys so drafting never consumes the coachSupport / athlete-chat budget.
      // Per-user fails open (an infra hiccup never blocks a legit draft). Every meal-chat caller
      // is already authenticated (the 401 above) — there is no anonymous path here, so a
      // fail-CLOSED global counter has no anon-abuse to guard against and would only risk denying
      // a paying coach (capacity audit F2). Tracked against the monthly tier-budget signal instead.
      if (!(await withinKeyCap(`meal_draft:${callerId}`, DAILY_CAP))) return bad(429, 'limit', cors);
      // THE DOLLAR CEILING (0152): the caps above count CALLS, this counts MONEY. Fail-closed.
      const spendDraft = await checkSpend(EST_USD.text);
      if (!spendDraft.allowed) {
        console.log(JSON.stringify({ evt: 'ai_spend_block', fn: 'meal-chat:draft', reason: spendDraft.reason }));
        return bad(429, 'capacity', cors);
      }
      void trackAuthedAiSpend(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, callerId, 'meal-chat');

      const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
      const t0d = Date.now();
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 700, // 4 drafts x ~60 words + tool-call JSON; headroom so the 4th draft never truncates into a 502
        system: [{ type: 'text', text: composeSystem(DRAFT_SYSTEM, voiceDirective, planStyle), cache_control: { type: 'ephemeral' } }],
        // DRAFT_TOOL is `as const`, so input_schema.required is a readonly tuple the SDK's mutable
        // string[] rejects — the same cast the reply/meal tool arrays below already use. Without
        // it this file does not pass `deno check` at all.
        tools: [DRAFT_TOOL] as unknown as Anthropic.Tool[],
        tool_choice: { type: 'tool', name: 'draft_replies' },
        messages: [{
          role: 'user',
          content: `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nDraft four replies the COACH could send to the athlete about this meal, one per stance (supportive, direct, context, followup), using ONLY figures already in the context. Speak as the coach to the athlete. Each draft is 60 words or less.`,
        }],
      });
      await recordAiCall({ fn: 'meal-chat', mode: 'draft', userId: callerId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0d, ok: true });
      const tool = msg.content.find((b) => b.type === 'tool_use') as { input?: { drafts?: Array<{ stance?: string; text?: string }> } } | undefined;
      const raw = Array.isArray(tool?.input?.drafts) ? tool!.input!.drafts! : [];
      // Normalize to exactly the four canonical stances in order; strip em dashes; enforce ~60 words.
      const byStance = new Map<string, string>();
      for (const d of raw) {
        const stance = String(d?.stance ?? '').toLowerCase();
        const text = String(d?.text ?? '').replace(/—/g, ',').trim();
        if (DRAFT_STANCES.includes(stance as typeof DRAFT_STANCES[number]) && text && !byStance.has(stance)) {
          byStance.set(stance, text.split(/\s+/).slice(0, 60).join(' '));
        }
      }
      let drafts = DRAFT_STANCES.map((stance) => ({ stance, text: byStance.get(stance) ?? '' }));
      if (drafts.some((d) => !d.text)) return bad(502, 'unavailable', cors);
      // Plan-style rail on a COACH-facing surface: these drafts are sent verbatim to the athlete,
      // so an Intuitive breach here is the same harm as one in the athlete's own feed. A drafting
      // coach can see the safe replacement and edit it, so a single deterministic swap is the
      // right cost here — no paid retry for a draft the coach is about to rewrite anyway.
      if (planStyle === 'intuitive') {
        const swapped = drafts.map((d) => ({ ...d, text: styleSafe(d.text) }));
        if (swapped.some((d, i) => d.text !== drafts[i].text)) {
          await recordAiCall({ fn: 'meal-chat', mode: 'draft', userId: callerId, model: MODEL, latencyMs: 0, ok: true, outcome: 'style_safe_copy' });
        }
        drafts = swapped;
      }
      // PERSIST NOTHING — no meal_comments insert. The coach edits and sends these manually.
      return new Response(JSON.stringify({ drafts }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (coachSupport) {
      // Selective: only back a substantive coach message; and only once per meal, ever.
      const hot = /\?|protein|carb|kcal|calorie|macro|weight|hydrat|late|window|goal|target|shake|recover|portion/i.test(question);
      if (!hot) return new Response(JSON.stringify({ skipped: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      const { count } = await service.from('meal_comments')
        .select('id', { count: 'exact', head: true })
        .eq('meal_id', mealId).eq('role', 'ai').eq('author_id', callerId);
      if ((count ?? 0) >= 1) return new Response(JSON.stringify({ skipped: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // ---- caps: per-user daily fails open. Same reasoning as the draft path above — every caller
    // here is already authenticated, so the fail-CLOSED global counter this endpoint used to run
    // (meal_chat_global) protected against traffic that cannot reach this endpoint, while being
    // the thing most likely to 429 a paying coach's whole roster at once. Tracked instead. ----
    // Correction updates get their own budget so acknowledging a fix can never eat into the
    // athlete's ability to ASK something — and so a correction spree cannot become a spend event.
    // Over cap is not an error: the correction itself already applied deterministically, and the
    // screen already confirmed it. Only the AI's acknowledgment is skipped.
    if (correctionUpdate) {
      if (!(await withinKeyCap(`meal_correction:${callerId}`, 5))) {
        return new Response(JSON.stringify({ skipped: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    } else if (!(await withinKeyCap(coachAsk ? `meal_chat_ask:${callerId}` : coachSupport ? `meal_chat_support:${callerId}` : `meal_chat:${callerId}`, DAILY_CAP))) return bad(429, 'limit', cors);
    /* ---- resolve a chat photo attachment, if one was named ----
       Only the ATHLETE path may attach: a coach reinforcing their own point and an acknowledgment
       of a correction have no picture to look at, and letting them pass one would be a way to make
       the model read an image outside the flow that produced it.

       The key must sit inside the MEAL OWNER's own storage folder. Storage RLS (0003) keys on the
       first path segment being a uid, so this check mirrors the same boundary server-side rather
       than trusting the caller: a coach can read the athlete's folder through can_view(), but
       neither party can point this at somebody else's. */
    let photoB64: string | null = null;
    // The COACH may attach too (2026-09-02): "is this the portion you meant?" with a picture is
    // the mirror of the athlete's "here's what I ate", and the AI answering the coach without
    // seeing it was answering half the question. A coach's attachment lives under the COACH's
    // own folder (storage RLS keys the path on the uploader), so the boundary is the caller's
    // uid on that path, never the athlete's.
    if (photoPathRaw && !coachSupport && !correctionUpdate && !draftMode) {
      const okShape = /^[0-9a-f-]{36}\/chat\/[A-Za-z0-9._-]{1,64}$/i.test(photoPathRaw)
        && photoPathRaw.startsWith(`${coachAsk ? callerId : mealRow.athlete_id}/`);
      if (okShape) {
        try {
          const dl = await service.storage.from('meal-photos').download(photoPathRaw);
          if (dl.data) {
            const buf = new Uint8Array(await dl.data.arrayBuffer());
            // Guard the model call, not the bucket: the client encodes to ~1000px/q0.82 (a few
            // hundred KB), so anything past 6MB is not a chat attachment and is dropped rather
            // than turned into an enormous, expensive request.
            if (buf.length && buf.length <= 6_000_000) {
              let bin = '';
              for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
              photoB64 = btoa(bin);
            }
          }
        } catch { /* unreadable attachment: answer the words, never fail the whole turn */ }
      }
    }

    // THE DOLLAR CEILING (0152): the caps above count CALLS, this counts MONEY. Fail-closed.
    // A turn carrying an image is a VISION call and costs several times a text one, so it is
    // estimated as such — charging it at the text rate would let attachments walk the daily
    // ceiling past its actual limit.
    const spendChat = await checkSpend(photoB64 ? EST_USD.vision : EST_USD.text);
    if (!spendChat.allowed) {
      console.log(JSON.stringify({ evt: 'ai_spend_block', fn: 'meal-chat', reason: spendChat.reason }));
      return bad(429, 'capacity', cors);
    }
    void trackAuthedAiSpend(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, callerId, 'meal-chat');

    // ---- the model call: prose only, forced tool ----
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    // ONE typed tools array for the reply call and its style retry. REPLY_TOOL is `as const`, so
    // its input_schema.required is a readonly tuple the SDK's mutable string[] rejects — tolerated
    // at a single call site, not at two.
    const replyTools = [REPLY_TOOL] as unknown as Anthropic.Tool[];
    // The athlete path may also decline and escalate, and (capability-gated) apply a stated
    // factual correction. coachSupport is the coach's own message being reinforced — there is
    // nothing there to escalate or correct, so it keeps the single forced tool.
    const athleteTools = [
      REPLY_TOOL,
      ...(canApplyCorrection ? [CORRECTION_TOOL] : []),
      ...(canRemember ? [REMEMBER_TOOL] : []),
      FLAG_TOOL,
    ] as unknown as Anthropic.Tool[];
    // The user turn, named once because the style-correction retry below has to replay it exactly.
    const userTurn = coachAsk
      ? `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nThe COACH reviewing this athlete's meal just asked you directly: "${question}"\n\nAnswer THE COACH in 100 words or less, using ONLY figures and foods already present in the context. Give a clear practical answer or recommendation; refer to the athlete in the third person. If the context cannot support a firm answer, say so and name the one thing you would check.${photoB64 ? ' The coach ATTACHED THE IMAGE ABOVE to their question: read it and answer about it. It has not been analyzed and carries no macros, so any figure you give for it is an eyeballed estimate and must be said to be one. If it shows food from this meal that the logged read does not list, say so plainly so the athlete can confirm it in the thread and have it counted.' : ''}`
      : coachSupport
      ? `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nThe COACH just said this on the athlete's meal: "${question}"\n\nIn 60 words or less, speaking to the athlete, back the coach's point using ONLY figures already in the context. Do not add new requirements, do not soften the coach, do not contradict them. If the context has nothing relevant, one steady sentence reinforcing the coach is enough.`
      : correctionUpdate
        // The correction is already applied and the numbers in the context are the CORRECTED ones.
        // The job is to acknowledge the fix and re-read the plate with it, conversationally — not
        // to apologise, and not to re-litigate what the photo showed.
        ? `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nThe athlete just corrected your read of this meal. The numbers above are the CORRECTED ones. In 50 words or less, reply like a coach texting back — open by thanking them for the correction in a short natural clause ("Thanks for correcting the oil, that changes things a bit."), then give the ONE thing the update means for their next meal. Two or three sentences, conversational, no headings, no lists. Do not apologise, do not explain the mistake, do not re-list the numbers.`
        : `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nAthlete's question: ${question}${photoB64 ? `

The athlete ATTACHED THE IMAGE ABOVE to this message. It has not been analyzed and nothing in the
context above describes it. Read it yourself. FIRST decide what it is:
- Food from THIS meal that the read does not list (a side, a drink, a second plate they forgot):
  call apply_correction and put each such food in \`missed\` with a kitchen-units quantity, so it
  counts toward their numbers and score. Do not describe its macros in prose instead.
- Evidence that a LOGGED item is a different food or a different amount than the read says:
  call apply_correction with newName (perBasis "estimate") or quantity for that item.
- A nutrition label: call apply_correction with the printed macros for that item.
- Anything else (a menu, a question about a food they have not eaten, a portion they are asking
  about): answer what they asked. Say plainly that you are eyeballing the picture, keep any figure
  clearly an estimate, and leave every number about the LOGGED meal exactly as given.` : ''}`;

    // An image rides as its own content block ahead of the text. Only ever populated on the
    // athlete question path (see the resolve step above).
    const userContent = photoB64
      ? [
        { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: photoB64 } },
        { type: 'text' as const, text: userTurn },
      ]
      : userTurn;

    // The base identity depends on who is asking: a coach's direct question gets the
    // coach-facing system; everything else keeps the athlete-thread system.
    const baseSystem = coachAsk ? COACH_ASK_SYSTEM : SYSTEM;
    const composedSystem = composeSystem(baseSystem, voiceDirective, planStyle);
    const t0r = Date.now();
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: 'text', text: memBlock ? `${composedSystem}

${memBlock}` : composedSystem, cache_control: { type: 'ephemeral' } }],
      // Only the athlete's own QUESTION path can escalate to a human — a coach's point being
      // reinforced, a coach's direct question, and a correction being acknowledged have nothing
      // in them to escalate (the coach IS the human).
      tools: coachSupport || coachAsk || correctionUpdate ? replyTools : athleteTools,
      tool_choice: coachSupport || coachAsk || correctionUpdate ? { type: 'tool', name: 'reply' } : { type: 'any' },
      messages: [{ role: 'user', content: userContent }],
    });
    // phase marks the vision turns so the cost views can separate them: an attachment turn is
    // several times the price of a text one, and rolling both into one 'reply' bucket would hide
    // exactly the number that decides whether attachments stay free.
    await recordAiCall({ fn: 'meal-chat', mode: 'reply', phase: photoB64 ? 'photo' : coachAsk ? 'coach_ask' : null, userId: callerId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0r, ok: true });
    const tool = msg.content.find((b) => b.type === 'tool_use') as {
      name?: string;
      input?: {
        message?: string; reason?: string; note?: string;
        item?: string; newName?: string; ack?: string;
        protein?: unknown; kcal?: unknown; carbs?: unknown; fat?: unknown;
        add?: unknown; quantity?: unknown;
        kind?: unknown; value?: unknown;
      };
    } | undefined;

    // ── REMEMBER: the athlete told the AI something lasting about themselves. ──
    // The reply is persisted like any other AI row, with meta `memory_offer` naming the pending
    // fact, so the thread can draw the Yes / No chips under it. The fact itself lands under the
    // MEAL OWNER (never the caller, though on this path they are the same person) as
    // `pending_confirmation`: memory-load.ts only ever reads `active`, so until the athlete taps
    // yes this row changes nothing about how they are read. Said twice, the same fact accrues
    // evidence on its one row instead of producing a second offer.
    if (tool?.name === 'remember') {
      let message = String(tool.input?.message ?? '').replace(/—/g, ',').trim().slice(0, 1000);
      const fact = chatFactCandidate(tool.input?.kind, tool.input?.value);
      if (!message) return bad(502, 'unavailable', cors);
      message = styleSafe(message);
      let offer: { id: string; kind: string; value: string } | null = null;
      if (fact) {
        try {
          const { data: existing } = await service.from('athlete_memory_facts')
            .select('id,kind,value,status,evidence_n,confidence')
            .eq('athlete_id', mealRow.athlete_id).eq('kind', fact.kind)
            .in('status', ['active', 'pending_confirmation', 'rejected']).limit(60);
          const want = factKey(fact.kind, fact.value);
          const dup = ((existing ?? []) as Array<{ id: string; kind: string; value: unknown; status: string; evidence_n: number; confidence: number }>)
            .find((r) => factKey(r.kind, r.value) === want);
          if (dup && dup.status === 'rejected') {
            // They already said no to exactly this. Do not ask again; the reply stands alone.
          } else if (dup) {
            await service.from('athlete_memory_facts').update({
              evidence_n: (Number(dup.evidence_n) || 1) + 1,
              confidence: Math.min(1, (Number(dup.confidence) || 0.3) + 0.15),
              last_seen: new Date().toISOString(),
            }).eq('id', dup.id);
            // Still pending: offer it again, it is the same unanswered question. Active: nothing
            // to confirm, the AI already knows.
            if (dup.status === 'pending_confirmation') offer = { id: dup.id, kind: fact.kind, value: fact.value };
          } else {
            const { data: ins } = await service.from('athlete_memory_facts').insert({
              athlete_id: mealRow.athlete_id, kind: fact.kind, value: fact.value,
              confidence: 0.6, source: 'athlete_stated', evidence_n: 1, status: 'pending_confirmation',
            }).select('id').maybeSingle();
            if (ins?.id) offer = { id: String(ins.id), kind: fact.kind, value: fact.value };
          }
        } catch { /* memory is an enhancement: the reply still lands without the offer */ }
      }
      const row = { meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai', text: message };
      const withOffer = offer
        ? { ...row, kind: 'message', meta: { t: 'memory_offer', factId: offer.id, kind: offer.kind, value: offer.value, ask: memoryOfferLine({ kind: offer.kind as ChatFactKind, value: offer.value }) } }
        : { ...row, kind: 'message' };
      const { error: memErr } = await service.from('meal_comments').insert(withOffer);
      if (memErr) await service.from('meal_comments').insert({ ...row, kind: 'message' });
      await recordAiCall({ fn: 'meal-chat', mode: 'reply', phase: 'remember', userId: callerId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0r, ok: true, outcome: offer ? 'memory_offered' : fact ? 'memory_known' : 'memory_dropped' });
      return new Response(JSON.stringify(offer ? { reply: message, memory: offer } : { reply: message }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // ── APPLY CORRECTION: the athlete corrected the record, so the record corrects itself. ──
    // The model contributes only the ack sentence and the structured field values the athlete
    // stated; every downstream number (item macros, meal totals, score, rubric, coach focus, day
    // targets) recomputes DETERMINISTICALLY on the client from the canonical meal record, and the
    // client mirrors the corrected numbers to the meals row so coach view, daily score, and group
    // chat all read the same finalized data. The ack is persisted here as the unforgeable 'ai'
    // row (meta t 'analysis_update') so the thread shows the acknowledgment exactly once.
    if (tool?.name === 'apply_correction') {
      const gnum = (v: unknown, cap: number): number | null => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) && n >= 0 && n <= cap ? n : null;
      };
      const str = (v: unknown, cap: number) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, cap);
      // One item's worth of fields, sanitized the same way whether it is the top-level item or
      // one of `more`. The corrected AMOUNT is passed through as a string and never interpreted
      // here: the client owns the comparison, because the item's existing quantity lives in the
      // meal record the client holds and the rescale has to be the same deterministic one the
      // breakdown's own quantity field uses. A model-side conversion would be a second
      // implementation of the arithmetic, and the two would drift.
      const itemFields = (raw: Record<string, unknown>) => ({
        item: str(raw?.item, 80),
        newName: str(raw?.newName, 80) || null,
        quantity: str(raw?.quantity, 40) || null,
        per: {
          protein: gnum(raw?.protein, 300), kcal: gnum(raw?.kcal, 2000),
          carbs: gnum(raw?.carbs, 500), fat: gnum(raw?.fat, 300),
        },
        perBasis: raw?.perBasis === 'estimate' ? 'estimate' : 'stated',
      });
      const top = itemFields((tool.input ?? {}) as Record<string, unknown>);
      const item = top.item;
      const newName = top.newName ?? '';
      const quantity = top.quantity ?? '';
      const per = top.per;
      const changed = (f: ReturnType<typeof itemFields>) => !!f.item && (!!f.newName || !!f.quantity || Object.values(f.per).some((v) => v != null));
      const more = (Array.isArray(tool.input?.more) ? tool.input.more : [])
        .slice(0, 5)
        .map((raw) => itemFields((raw ?? {}) as Record<string, unknown>))
        .filter((f) => changed(f) && f.item.toLowerCase() !== item.toLowerCase());
      // Whole foods the read never had. Priced client-side from the curated reference; the
      // model's numbers ride along only as a fallback, exactly like `add`.
      const missed = (Array.isArray(tool.input?.missed) ? tool.input.missed : [])
        .slice(0, 6)
        .map((raw) => {
          const a = (raw ?? {}) as Record<string, unknown>;
          const name = str(a.name, 60);
          if (!name) return null;
          return {
            name,
            quantity: str(a.quantity, 40) || null,
            per: {
              protein: gnum(a.protein, 300), kcal: gnum(a.kcal, 2000),
              carbs: gnum(a.carbs, 500), fat: gnum(a.fat, 300),
            },
          };
        })
        .filter(Boolean);
      // Ingredients the athlete says were in the item. The model's macro numbers ride along ONLY
      // as a fallback for foods our reference does not carry — the client prefers priceAddedFood
      // every time, so a hallucinated 60g-protein egg loses to the curated entry.
      const add = (Array.isArray(tool.input?.add) ? tool.input.add : [])
        .slice(0, 6)
        .map((raw) => {
          const a = (raw ?? {}) as Record<string, unknown>;
          const name = String(a.name ?? '').replace(/[<>]/g, '').trim().slice(0, 60);
          if (!name) return null;
          return {
            name,
            quantity: String(a.quantity ?? '').replace(/[<>]/g, '').trim().slice(0, 24) || null,
            per: {
              protein: gnum(a.protein, 300), kcal: gnum(a.kcal, 2000),
              carbs: gnum(a.carbs, 500), fat: gnum(a.fat, 300),
            },
          };
        })
        .filter(Boolean);

      let ack = String(tool.input?.ack ?? '').replace(/—/g, ',').trim().slice(0, 500);
      if (!ack) ack = 'Good catch. Updating your numbers and score now.';
      ack = styleSafe(ack);
      const hasChange = (!!item && (!!newName || !!quantity || add.length > 0 || Object.values(per).some((v) => v != null)))
        || more.length > 0 || missed.length > 0;

      // NEVER PROMISE WHAT CANNOT HAPPEN (2026-08-09). This ack used to be written to the thread
      // unconditionally — including on the calls where the model conveyed nothing the app could
      // apply. The athlete then read "updating this sandwich's numbers now" under a meal whose
      // numbers had not moved and never would, which is worse than no answer: it teaches them the
      // correction loop works when it did not. When there is nothing to apply, the AI says what is
      // actually true and asks for the one thing that would let it act.
      const text = hasChange
        ? ack
        : "I want to get that into your numbers, but I didn't catch enough to change them. Tell me what to fix, like the protein on the label or what else was in it, and I'll put it straight in.";
      const ackRow = { meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai', text };
      const { error: ackErr } = await service.from('meal_comments')
        .insert({ ...ackRow, kind: 'message', meta: hasChange ? { t: 'analysis_update' } : undefined });
      if (ackErr) await service.from('meal_comments').insert({ ...ackRow, kind: 'message' });

      await recordAiCall({ fn: 'meal-chat', mode: 'reply', phase: 'correction_tool', userId: callerId, model: msg.model ?? MODEL, latencyMs: 0, ok: true, outcome: hasChange ? 'correction_returned' : 'ack_only' });
      return new Response(
        JSON.stringify(hasChange
          ? { reply: text, correction: { item, newName: newName || null, quantity: quantity || null, per, perBasis: top.perBasis, add, more, missed } }
          : { reply: text }),
        { headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    // ESCALATION. The model declined to answer, so say so plainly to the athlete and put it in
    // front of a human. The athlete is told what happened — a silent hand-off would read as the
    // AI ignoring them.
    if (tool?.name === 'flag_for_coach') {
      const reason = String(tool.input?.reason ?? 'other').slice(0, 32);
      const note = String(tool.input?.note ?? '').replace(/—/g, ',').trim().slice(0, 300);
      const declineText = "That one's for a person, not me. I've flagged it for your coach so they can pick it up.";

      // A jailbreak must not become a way to spam a coach: at most 3 flags per athlete per day.
      const { data: fclaim } = await service.rpc('claim_ai_usage_key', { p_key: `meal_flag:${mealRow.athlete_id}`, p_limit: 3 });
      const withinFlagCap = (Array.isArray(fclaim) ? fclaim[0] : fclaim)?.allowed !== false;

      await service.from('meal_comments').insert({
        meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: mealRow.athlete_id,
        role: 'ai', kind: 'message', text: declineText,
        meta: { t: 'escalated' },
      });

      let notified = false;
      const notifiedStaffIds: string[] = [];
      if (withinFlagCap) {
        // Whoever actively staffs this athlete's team. A solo athlete has no one to notify — the
        // decline still stands, we just record that there was no coach.
        const { data: tm } = await service.from('team_members')
          .select('team_id').eq('athlete_id', mealRow.athlete_id).eq('status', 'active').limit(1).maybeSingle();
        if (tm?.team_id) {
          const { data: staff } = await service.from('team_staff')
            .select('staff_id').eq('team_id', tm.team_id).eq('status', 'active').limit(5);
          for (const st of (staff ?? []) as Array<{ staff_id: string }>) {
            await service.from('notifications').insert({
              user_id: st.staff_id, kind: `meal_flag:${mealId}`,
              title: 'An athlete asked something for you',
              body: note || 'They asked a question the AI would not answer.',
            });
            notified = true;
            notifiedStaffIds.push(st.staff_id);
          }
        }
      }

      // PUSH — best-effort, same write-order guarantee as ai-followup: the notification row above
      // is already durable, so a failed push here must never affect the response already sent to
      // the athlete.
      if (notifiedStaffIds.length) {
        try {
          const { data: toks } = await service.from('device_tokens').select('token').in('user_id', notifiedStaffIds);
          const messages = ((toks ?? []) as Array<{ token: string }>).map((t) => ({
            to: t.token,
            title: 'An athlete asked something for you',
            body: note || 'They asked a question the AI would not answer.',
            data: { route: routeForCoachMeal(mealId) },
            sound: 'default',
          }));
          for (let i = 0; i < messages.length; i += 100) {
            await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(messages.slice(i, i + 100)),
            }).catch(() => undefined);
          }
        } catch { /* notification row already landed; a push failure must not affect the athlete's response */ }
      }

      await recordAiCall({ fn: 'meal-chat', mode: 'reply', phase: 'flagged_for_coach', userId: callerId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0r, ok: true });
      return new Response(JSON.stringify({ reply: declineText, flagged: reason, notified }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    let reply = String(tool?.input?.message ?? '').replace(/—/g, ',').trim().slice(0, 1000);
    if (!reply) return bad(502, 'unavailable', cors);

    // Plan-style rail (0142) — the INVERTED fallback (see _shared/plan-style.ts's header): correct
    // and retry WITH the style still applied, never a bare re-ask. This reply is persisted as an
    // unforgeable 'ai' row the athlete will read forever, so it gets the paid retry the throwaway
    // coach drafts above do not.
    {
      const v = violatesStyleLanguage(reply, planStyle);
      if (v) {
        const t0s = Date.now();
        const retry = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 400,
          system: [{ type: 'text', text: composedSystem, cache_control: { type: 'ephemeral' } }],
          tools: replyTools,
          tool_choice: { type: 'tool', name: 'reply' },
          // TEXT-ONLY on purpose, even when the first turn carried an image: this retry asks the
          // model to REPHRASE an answer it has already given (the discarded reply is right there),
          // not to look at the picture again. Re-sending the image would double the expensive part
          // of the turn to fix a wording problem.
          messages: [
            { role: 'user', content: userTurn },
            { role: 'assistant', content: `<discarded>${reply}</discarded>` },
            { role: 'user', content: styleCorrectionMessage(v) },
          ],
        });
        await recordAiCall({
          fn: 'meal-chat', mode: 'reply', userId: callerId, model: retry.model ?? MODEL,
          ...usageFrom(retry.usage), latencyMs: Date.now() - t0s, ok: true, outcome: `style_${v.kind}_retry`,
        });
        const rtool = retry.content.find((b) => b.type === 'tool_use') as { input?: { message?: string } } | undefined;
        const candidate = String(rtool?.input?.message ?? '').replace(/—/g, ',').trim().slice(0, 1000);
        // styleSafe is the final rail: a corrected retry that STILL breaches falls to safe copy
        // rather than persisting a violation into the athlete's permanent thread.
        reply = candidate ? styleSafe(candidate) : SAFE_INTUITIVE.reply;
      }
    }

    // ---- persist as the unforgeable 'ai' row (service role) ----
    // `kind` ships in a later migration (post-0048); insert WITH it first and on error retry
    // once WITHOUT it, so replies still persist against a pre-migration database.
    // athlete_id is always the meal OWNER (RLS thread scoping); author_id records who
    // triggered the AI (the athlete's ask, or the coach whose point is being supported).
    const row = { meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai', text: reply };
    // `meta` marks a correction acknowledgment so the thread can render it as an update to the
    // read above it rather than as an unrelated remark. Ships in 0157; the fallback chain below
    // already tolerates a database that predates a column.
    const withMeta = correctionUpdate ? { ...row, kind: 'message', meta: { t: 'analysis_update' } } : { ...row, kind: 'message' };
    const { error: insertErr } = await service.from('meal_comments').insert(withMeta);
    if (insertErr) {
      const { error: retryErr } = await service.from('meal_comments').insert({ ...row, kind: 'message' });
      if (retryErr) await service.from('meal_comments').insert(row);
    }

    return new Response(JSON.stringify({ reply }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch {
    // A failed upstream call (network/429/5xx) used to vanish here: 503 to the client, no
    // telemetry row, so billed-but-failed Anthropic calls were invisible spend (ai-cost-watchdog,
    // 2026-08-10). Mirror analyze-meal's outer catch: record one failed attempt, best-effort —
    // a success path that already recorded stays a separate ok:true row with its own mode.
    try {
      await recordAiCall({ fn: 'meal-chat', mode: 'error', userId: telemUserId, model: MODEL, latencyMs: Date.now() - t0req, ok: false, errorCode: 'upstream_error' });
    } catch { /* telemetry must never turn a 503 into a crash */ }
    return bad(503, 'unavailable', cors);
  }
});
