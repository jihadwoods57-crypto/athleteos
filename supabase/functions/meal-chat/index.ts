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
import { scrubToolLeak } from '../_shared/tool-leak.ts';
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
import { athleteContextLine, positionWords } from '../_shared/athlete-context.ts';
import { clockLine } from '../_shared/day-context.ts';
import { NIA_IDENTITY, NIA_HONESTY, NIA_VOICE } from '../_shared/nia-voice.ts';
// WHO THIS ATHLETE IS, read server-side for the meal OWNER (2026-09-23): goal, goal weight, the
// coach's standard, allergies, age band, weight trend. Visibility per caller; see the module header.
import { loadAthleteDossier, renderDossier } from '../_shared/athlete-dossier.mjs';
// WHO IS THIS MESSAGE FOR. Byte-identical to proto/redesign-2026-07/js/ai-addressing.js
// (`npm run lint:mirror` fails the build if they drift), so the client's decision not to spend
// a turn and this function's refusal to spend one are the SAME decision, not two that agree.
import { gateVerdict } from './addressing-gate.mjs';
import { loadVoiceForAthlete } from '../_shared/coach-voice-load.ts';
import {
  SUGGEST_MEAL_TOOL, parseSuggestMeal, suggestRowText, suggestRowMeta,
  PLAN_IDEAS_TOOL, PLAN_IDEAS_SYSTEM, planIdeasRequest, planIdeasUserText, parsePlanIdeas,
} from './suggest.mjs';
// Food preferences (0250): the SAME sanitizer the Plan screen saves through (a byte-identical copy
// of proto js/food-prefs.js; `npm run lint:mirror`).
import { cleanFoodPrefs, prefsKey, avoidWords } from '../_shared/food-prefs.mjs';
import { avoidFromFacts } from '../_shared/memory.ts';
// WHAT THE AI CAN SEE IN THE THREAD (2026-09-22): recent photos read out of meal_comments by this
// function, the label-basis food shape, and the grounding rule for a coach-requested addition.
import {
  pickThreadPhotos, additionGrounds, validateCoachAddition, sanitizeFoods, additionReceiptText,
  photoPreamble, threadTranscript, firstName, requesterLabel, additionNote, receiptRowsForStyle,
} from './thread-photos.mjs';
// Expo answers a refused batch with HTTP 200 + per-message error tickets, so `r.ok` counted
// refusals as deliveries. sendExpoPush reads the tickets; see _shared/expo-push.mjs.
import { sendExpoPush } from '../_shared/expo-push.mjs';
import { missingConsent, consentSkipBody, loadConsentRows, consentedIds } from '../_shared/ai-consent.mjs';
import { authorIds, scrubContext, scrubRows } from './consent-scrub.mjs';
// THE PROMISE WAITS FOR THE PLATE (2026-09-24, "double chicken"): the ack is signed and handed to
// the client, and filed only once the client reports the correction actually landed.
import { signPending, readPending, correctionHash, allowedNames, sanitizeOutcome, outcomeRows } from './correction-outcome.mjs';

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
/* ONE FOOD ADDED TO THIS MEAL, as the model reports it. Shared by the athlete's `missed` list and
   the coach-requested addition below so the two can never read a label differently.

   LABEL READING (2026-09-22). A Nutrition Facts panel is not an estimate. The shake in the 12:44
   incident printed 42g protein and 230 kcal, and the curated reference would have priced "a
   protein shake" at whatever a generic one is. With basis "label" the figures are the PRINTED
   per-serving numbers and servings is how many were consumed; the app multiplies and marks the
   food as read evidence, which its own reference never overrides. A figure the model cannot read
   goes in unreadable, never in the number fields. */
const MISSED_FOOD_ITEM = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The food in plain words, e.g. "dinner roll", "whole milk", "white rice". For a packaged product whose label you can see, its product name, e.g. "Fairlife Core Power chocolate shake".' },
    quantity: { type: 'string', description: 'How much, in kitchen units ("1 cup", "2 rolls", "12 oz", "1 bottle"). Omit when one serving is the honest read.' },
    basis: { type: 'string', enum: ['label', 'estimate'], description: '"label" ONLY when you are reading the figures off a Nutrition Facts panel or packaging you can actually see in an image. Otherwise "estimate" (or omit).' },
    servings: { type: 'number', description: 'With basis "label": how many label servings were consumed (a whole single-serve bottle is 1; half a 2-serving bag is 1). Omit otherwise.' },
    protein: { type: 'integer', description: 'With basis "label": grams of protein PER SERVING exactly as printed. Otherwise a fallback estimate for this quantity; the app prefers its own reference.' },
    kcal: { type: 'integer', description: 'With basis "label": calories per serving exactly as printed. Otherwise a fallback estimate.' },
    carbs: { type: 'integer', description: 'With basis "label": total carbohydrate grams per serving as printed. Otherwise a fallback estimate.' },
    fat: { type: 'integer', description: 'With basis "label": total fat grams per serving as printed. Otherwise a fallback estimate.' },
    unreadable: {
      type: 'array', items: { type: 'string', enum: ['protein', 'kcal', 'carbs', 'fat'] },
      description: 'With basis "label": every figure you could NOT read clearly (glare, blur, cut off). Leave those number fields empty; never guess a label figure. Your message must name exactly these and ask only for them.',
    },
  },
  required: ['name'],
} as const;

/* THE COACH-REQUESTED ADDITION (lead decision 2026-09-22). "Make sure that gets added in" about a
   shake the ATHLETE posted is a request the AI can now carry out, but only one kind: the evidence
   must be the athlete's own message or photo in this thread, named by id from a list this function
   built out of meal_comments itself. The enum is the whole safety rule: the model cannot cite a
   message that is not there, and a coach cannot have food put on an athlete's plate on their own
   word. Offered only when that list is non-empty. */
function coachAddTool(groundIds: string[]) {
  return {
    name: 'add_from_athlete',
    description: "The coach asked you to add to THIS meal a food or drink the ATHLETE showed or described in this thread (their photo, or their own words like \"I also had a roll\"). Call this to add it: the app counts it toward the athlete's numbers and meal score and posts a receipt saying it came from the athlete's message at the coach's request. Only for something the athlete posted; never for food the coach describes on their own.",
    input_schema: {
      type: 'object',
      properties: {
        sourceMessageId: { type: 'string', enum: groundIds, description: "The id of the athlete's own message (from the list you were given) that shows or names the food." },
        foods: { type: 'array', items: MISSED_FOOD_ITEM, description: 'Each food or drink to add, one entry per food.' },
        ack: { type: 'string', description: "One short sentence TO THE COACH saying what you added and from what, e.g. \"Done, added the Core Power from Jihad's photo, read off the label.\" Use the athlete's first name, never he or she. If a label figure was unreadable, say which one and that you will ask the athlete for it. No em dashes." },
      },
      required: ['sourceMessageId', 'foods', 'ack'],
    },
  };
}

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
        items: MISSED_FOOD_ITEM,
      },
      ack: { type: 'string', description: 'One to two conversational sentences to the athlete: own the miss plainly and without defensiveness ("Good catch, that is the 42g bottle"; "Two cups, got it") and say their numbers and score are updating now. Never tell them to update anything themselves or to notify their coach. Do NOT state new meal totals or new per-item macros; they are recomputed after this. No em dashes.' },
    },
    required: ['ack'],
  },
} as const;

/* THE SAME TOOL, FOR A CLIENT THAT APPLIES FIRST (canConfirmCorrection, 2026-09-24). Two words
   differ, and only here: an older client cannot turn "double" into an amount and files the ack
   the moment the model answers, so telling IT that "double" is fine would bring back the exact bug
   this fixes (Nia saying "updating" over numbers that never moved). A confirming client resolves
   the word against the row's own amount (plate-edits.js), and its ack is filed only after the
   plate has changed, so the ack speaks in the past tense. */
const CORRECTION_TOOL_CONFIRM = {
  ...CORRECTION_TOOL,
  input_schema: {
    ...CORRECTION_TOOL.input_schema,
    properties: {
      ...CORRECTION_TOOL.input_schema.properties,
      quantity: {
        ...CORRECTION_TOOL.input_schema.properties.quantity,
        description: CORRECTION_TOOL.input_schema.properties.quantity.description.replace('(if the item reads "1 cup", answer in cups).', '(if the item reads "1 cup", answer in cups); "double", "half" or "2x" is fine when that is exactly what the athlete said.'),
      },
      ack: {
        ...CORRECTION_TOOL.input_schema.properties.ack,
        description: 'One to two conversational sentences to the athlete: own the miss plainly and without defensiveness ("Good catch, that is the 42g bottle"; "Two cups, got it"). This is shown only AFTER the app has applied the change, and only if it applied exactly as you described, so say their numbers and score are updated (past tense, never "updating now"). Never tell them to update anything themselves or to notify their coach. Do NOT state new meal totals or new per-item macros; they are recomputed. No em dashes.',
      },
    },
  },
};

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

const DRAFT_SYSTEM = `${NIA_IDENTITY} You are helping a COACH draft replies inside an athlete's meal thread.
Rules that bind you:
1. Use ONLY the provided context (this meal, their plan and goal, today's summary, recent meals, the thread). Never invent, recompute, or adjust any number; you may repeat numbers exactly as given.
2. Coach voice: specific, encouraging, practical. Consistency is praised before choices are critiqued. Never shame food, weight, or a late log.
3. When coach guidance appears in the context, defer to it explicitly.
4. Speak AS the coach TO the athlete about THEIR goal and plan, not generic nutrition advice.
5. Draft FOUR alternative replies the COACH could send, one per stance: supportive (reinforce what went right), direct (name the gap and the fix), context (ask one clarifying question), followup (propose one concrete next step).
6. These are drafts the coach will edit before sending. Do not sign them, do not send them, and never mention Nia or AI in them: they go out in the coach's own name.
7. 60 words maximum per draft. No em dashes. No markdown.`;

// Coach-question mode (founder, 2026-08-06): the coach ASKS the AI Nutritionist directly and it
// ALWAYS answers — unlike the retired auto-support path, there is no topic regex and no
// once-per-meal cap, because an explicit question deserves an explicit answer. The reply addresses
// the coach; the athlete can read the thread, so the athlete is spoken about with respect, never
// clinically dissected.
const COACH_ASK_SYSTEM = `${NIA_IDENTITY} A COACH or TRAINER reviewing one of their athlete's meals is asking YOU a question.
Rules that bind you:
1. Use ONLY the provided context (this meal, targets, the thread). Never invent, recompute, or adjust any number; you may repeat numbers exactly as given.
2. Answer the coach directly and practically, the way a trusted colleague would, and talk TO the coach. Lead with the answer itself: "Done, it's in" or "Yes, that covers it", never a memo about the athlete. The athlete can read this thread too, so stay respectful about them. Call the athlete by their first name when you are given it, otherwise "the athlete" or "they". Never guess a pronoun: no he, him, she or her.
2b. You can see every image you are sent: they are photos from this meal's thread. Never say you cannot see an image, that you only have the logged data, or that you lack details you can read in a picture. Never tell the coach to have the athlete log something manually or check the log: when the add_from_athlete tool is available and the coach wants something the athlete posted counted, you add it yourself. A Nutrition Facts panel is read exactly as printed, never replaced with a typical value.
3. When the context names the athlete's sport, position, level, bodyweight or day type, coach for it, and name their position with the EXACT word you were given. A neighbouring position is a wrong position; never infer one from bodyweight or from the plate.
4. When asked for a recommendation, give a clear one grounded in what is actually in the context. If the context cannot support a firm answer, say so plainly and name the one thing you would check.
5. 70 words maximum, and shorter when the answer is short. No em dashes. No markdown headers.
6. Never give medical, injury, weight-cutting, or disordered-eating guidance — those belong with qualified humans.
7. ${NIA_HONESTY} Never open with "Based on my analysis" or any preamble.`;

const SYSTEM = `${NIA_IDENTITY} You are inside an athlete's meal thread.
Rules that bind you:
1. Use ONLY the provided context (this meal, their plan and goal, today's summary, recent meals, the thread). Never invent, recompute, or adjust any number; you may repeat numbers exactly as given.
2. You text like a sharp nutritionist who knows this athlete, never a report. Open with the one
   thing that matters most for what they asked, then give one or two specific, doable
   recommendations. ${NIA_VOICE} Consistency is praised before choices are critiqued. Never shame food,
   weight, or a late log.
3. Make it THEIRS. When today's totals or their recent meals are in the context and they sharpen
   the answer, use them — where the day stands, a pattern you can see across their week. Never
   recite macros or nutrients as a list: the screen already shows every number, so a number
   belongs in your text only when it IS the advice (a portion to aim for, a gap to close).
4. Vary your language. No signature idiom — never "doing the heavy lifting" or "doing the
   work" — and never reuse the same opener or phrase twice in one thread. Each reply reads like
   a fresh text, not a template.
5. When coach guidance appears in the context, defer to it explicitly.
5b. YOU ARE IN A GROUP CHAT, NOT A HELPDESK. The context thread names every speaker
   (senderName, senderRole) and this app has more than one human in the room: the athlete,
   their coach or trainer, sometimes a parent. Read who said what to whom. You have already
   been judged to be the person being addressed, so answer THAT, and nothing else in the
   transcript. Never answer a question one human asked another, never respond to an
   acknowledgement, a joke or a thank-you, and never explain to the room that you were not
   being spoken to. Address the person who spoke to you by name when the thread gives it.
6. Answer the athlete's question for THEIR goal and plan, not generic nutrition advice.
6b. COACH THE ATHLETE IN FRONT OF YOU. When the context names their sport, position, level,
   bodyweight or whether today is a training or rest day, let it shape the answer: a linebacker
   on a training day and a distance runner on a rest day do not get the same portion or the same
   timing. If you name their position, use the EXACT word you were given and no other. A
   neighbouring position is a wrong position, so a linebacker is never a lineman, a safety is
   never a corner, a tight end is never a receiver. Never infer a position, a weight, or a
   session from anything else, and when none was given, do not name one.
7. 90 words maximum: Nia texts short. No em dashes. No markdown headers
   or lists. You MAY wrap the single figure or instruction that matters most in **double
   asterisks** so it stands out, at most twice per reply, and nothing else. That mark is for the
   reply message only: every other tool field (a framing line, a fallback, an ack) is plain text
   with no asterisks.
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
   an eyeballed estimate in prose and do not tell them to log it separately.
15. WHAT SHOULD I EAT IS A SUGGESTION, NOT A PARAGRAPH. When the athlete asks what to eat next,
   what to eat for a slot, or how to hit or close a protein or calorie target, and the
   suggest_meal tool is available, call it INSTEAD of reply. The app fills the bubble with up to
   three of their OWN saved usual meals (the "usualMeals" list in the context is what it draws
   from) that fit what is left of the day, each one tap from being planned (a photo logs it). You write the framing
   line and a fallback sentence only; you never pick the meals yourself and never invent a food.
   Use it ONLY when they ask what to eat or how to hit a target, never unprompted, never as an
   aside to a different question, and never when the question is really a correction, a medical
   matter, or a food fact.
16. YOU CAN SEE THE PHOTOS IN THIS THREAD. Any image you are sent is a photo from this meal's
   thread, and you read it. Never say you cannot see an image, that you only have the logged
   data, or that they should log something manually: when a food or drink in a photo belongs to
   this meal, you add it with apply_correction yourself.
17. A LABEL IS READ, NOT ESTIMATED. When a photo shows a Nutrition Facts panel, the printed
   figures are the truth: report them exactly as printed, per serving, with basis "label" and the
   servings they had. Never swap in a typical value for that kind of product. If one figure is
   blurred or cut off, add what you can read, mark that figure unreadable, and ask for exactly
   that one number, nothing else. The figures go in the tool; your message only repeats one when
   the plan style allows numbers at all.
18. TALK TO THE PERSON IN FRONT OF YOU. You are answering the athlete, so speak to them as
   "you", by first name when it helps. When you mention someone else in the thread, use their
   name or role; never guess a pronoun for anyone.
19. YOU ARE AN AI, AND YOU SAY SO. ${NIA_HONESTY}`;

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

type ReceiptRow = { label: string; unit: string; from: number; to: number; score: boolean; band: string };

/* The correction receipt's figures, off the wire and therefore untrusted. The client computed
   them (the pricing and scoring engines are deterministic and live in the proto), but this
   function is the thing that signs them as an 'ai' row, so every field is bounded here rather
   than taken on faith. Returns null — not an empty list — when there is no usable receipt, which
   is what keeps this mode from swallowing an ordinary chat request. */
function correctionReceiptRows(raw: unknown): ReceiptRow[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  /* null, undefined and '' all coerce to 0 through Number(), which would sign a row missing one
     end of its move as a confident "0 to 93". Reject the non-numbers before coercing. */
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = Math.round(Number(v));
    return isFinite(n) && Math.abs(n) <= 100000 ? n : null;
  };
  const out: ReceiptRow[] = [];
  for (const item of raw.slice(0, 6)) {
    const r = (item ?? {}) as Record<string, unknown>;
    const label = String(r.label ?? '').replace(/[<>]/g, '').trim().slice(0, 24);
    const from = num(r.from);
    const to = num(r.to);
    if (!label || from === null || to === null || from === to) continue;
    out.push({
      label,
      unit: String(r.unit ?? '').replace(/[^a-zA-Z%]/g, '').slice(0, 4),
      from, to,
      score: r.score === true,
      band: String(r.band ?? '').replace(/[^a-z]/g, '').slice(0, 8),
    });
  }
  return out.length ? out : null;
}

/* The sentence the receipt carries as its text. Every renderer that has never heard of this
   meta — an older build, the season-long thread, a push preview — shows this instead of an empty
   bubble, so the record is readable everywhere. Mirrors proto chat-view.correctionReceiptText. */
function correctionReceiptText(rows: ReceiptRow[]): string {
  return `Updated: ${rows.map((r) => `${r.label} ${r.from}${r.unit} to ${r.to}${r.unit}`).join(', ')}.`;
}

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
    // Plan > Today's ideas: no meal, no thread. Its own door, before anything below asks for one.
    if (body?.planIdeas && typeof body.planIdeas === 'object') return await planIdeasTurn(req, body.planIdeas, cors);
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
    /* Correction-RECEIPT mode (founder 2026-09-17). The athlete's correction has already been
       applied on device — all of the pricing and scoring math is deterministic and lives in the
       proto, so the server is told the answer rather than computing it. This mode does ONE thing:
       write what moved into the thread as an unforgeable 'ai' row. No model call, no tokens, no
       spend; it exists purely because 0046's insert policy (rightly) forbids a client from
       writing an 'ai' row, and a receipt authored by the athlete would read as the athlete
       claiming their own numbers changed. */
    /* THE COACH-REQUESTED ADDITION'S RECEIPT (2026-09-22). Either device may file the numeric
       receipt for an ai_addition row: the COACH's, the moment it wrote the meals row (so the coach
       sees the numbers move at once), or the ATHLETE's, when its day catches up. `additionId`
       names the ai_addition row; the server reads the attribution line off that row and files
       at most ONE receipt per addition, whichever device gets there first. */
    const uuidish = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
    const coachReceiptIn = body?.additionReceipt && typeof body.additionReceipt === 'object' ? body.additionReceipt : null;
    const additionId = uuidish(coachReceiptIn ? coachReceiptIn.additionId : body?.additionId);
    const receiptRows = correctionReceiptRows(coachReceiptIn ? (additionId ? coachReceiptIn.rows : null) : body?.correctionReceipt);
    const coachReceipt = !!(coachReceiptIn && additionId && receiptRows);
    // The ct a device's FALLBACK receipt files under (correction-turn.js): the turn's nonce + ':f'.
    const receiptCt = !coachReceiptIn && typeof body?.receiptCt === 'string' && /^[A-Za-z0-9_-]{8,40}:f$/.test(body.receiptCt) ? body.receiptCt : null;
    // What happened to a correction this function handed out with a pending token: applied (file
    // Nia's ack, then the receipt) or not (file her one precise question). See correction-outcome.mjs.
    const outcomeIn = body?.correctionOutcome && typeof body.correctionOutcome === 'object' ? body.correctionOutcome : null;
    // "I apply first and report back": the ack is not filed until the plate has changed.
    const canConfirmCorrection = body?.canConfirmCorrection === true;
    // Capability flag (2026-08-06): "I know how to apply a structured correction returned by
    // apply_correction". Only a client that can actually recompute + resync every surface gets
    // the tool offered — an older build keeps today's reply-only contract (with the never-argue
    // prompt rule as its floor).
    const canApplyCorrection = body?.canApplyCorrection === true;
    // Capability flag (2026-09-02): "I render the remember-this confirmation under an AI bubble".
    // Same contract as canApplyCorrection: the tool is offered only to a client that can close the
    // loop it opens.
    const canRemember = body?.canRemember === true;
    // Capability flag (2026-09-10): "I fill a suggest_meal bubble from Food Memory and stage a
    // tapped meal". Same contract again: offered only to a client that renders the picks.
    const canSuggestMeal = body?.canSuggestMeal === true;
    const question = String((coachSupport ? body?.coachText : body?.question) ?? '').trim().slice(0, 500);
    const context = body?.context;
    // A chat PHOTO ATTACHMENT, passed as a storage KEY and never as image bytes. The client cannot
    // hand this function pixels: the object is re-read server-side with the service role below,
    // and only after the key is proven to sit inside the meal owner's own folder. That means a
    // caller cannot point the model at an arbitrary image, and cannot inflate the request body.
    const photoPathRaw = typeof body?.photoPath === 'string' ? body.photoPath.trim() : '';
    if (!mealId || (!receiptRows && !outcomeIn && !context) || (!draftMode && !correctionUpdate && !receiptRows && !outcomeIn && !question)) return bad(400, 'bad_request', cors);
    // `?? null`: a receipt request carries no context, and JSON.stringify(undefined) is undefined,
    // whose .length THREW into the outer catch. Every correction receipt came back 503 and was
    // never written (found 2026-09-22; the receipt path swallows its own failure by design).
    if (JSON.stringify(context ?? null).length > CONTEXT_MAX) return bad(400, 'bad_request', cors);

    // WHO IS EATING (founder 2026-09-13). The meal READ has known the athlete's sport, position,
    // level, bodyweight and day type since 2026-09-02; the thread that follows it knew none of
    // that, so every follow-up answer was coached for a generic athlete. Same shape, same shared
    // renderer, same sanitization as analyze-meal — and '' when the client sends nothing, which
    // is what makes this safe to deploy ahead of the client that fills it in.
    const whoLine = athleteContextLine(body?.athlete);
    // ctxBlock is assembled below, once the server-side dossier has loaded: the dossier replaces
    // this client-sent line whenever it has anything to say.

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
    const { data: mealRow, error: mealErr } = await userClient.from('meals').select('id, athlete_id, day_date').eq('id', mealId).maybeSingle();
    // A read that FAILED is not a meal that is not yours (review round 4): 503, so a device retries
    // instead of treating its correction's report as refused. 403 only when the read found nothing.
    if (mealErr) return bad(503, 'unavailable', cors);
    if (!mealRow) return bad(403, 'unauthorized', cors);
    // Coach modes (coachSupport + coachAsk + draft): the RLS-scoped select above succeeding for a
    // NON-owner proves can_view (linked coach/staff), so a coach must NOT own the meal. Athlete
    // mode: owner.
    // A coach filing an addition's receipt is a coach mode too: the caller must NOT own the meal.
    const coachMode = coachSupport || coachAsk || draftMode || coachReceipt;
    if (coachMode ? mealRow.athlete_id === callerId : mealRow.athlete_id !== callerId) return bad(403, 'unauthorized', cors);

    const service = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    /* Write the receipt and return. Before the daily AI cap, before the model, before every
       prompt block below: this path spends nothing, so metering it against an AI budget would
       let a day of honest corrections lock the athlete out of their own nutritionist. The
       ownership check above (mealRow.athlete_id === callerId for the athlete path) has already
       run, so only the meal's own athlete can file one. */
    if (coachReceiptIn && !coachReceipt) return bad(400, 'bad_request', cors);
    /* THE OUTCOME OF A CORRECTION (2026-09-24). Same shape as the receipt below: no model, no
       tokens, before the cap and the consent read (the words were produced by a turn that already
       passed both). The token is the authority: it names this meal and this caller, carries the
       model's own ack, and is good once. */
    if (outcomeIn) {
      const pending = await readPending(outcomeIn.token, { mealId, userId: callerId }, SUPABASE_SERVICE_ROLE_KEY);
      if (!pending || !pending.nonce) return bad(403, 'unauthorized', cors);
      // The report must carry the correction the token was issued for, byte for byte: a token is
      // good for ONE turn's correction, and that correction is where Nia's food names come from.
      if ((await correctionHash(outcomeIn.correction ?? null)) !== pending.hash) return bad(403, 'unauthorized', cors);
      const ok = (extra: Record<string, unknown> = {}) =>
        new Response(JSON.stringify({ ok: true, ...extra }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      // Names Nia may say: the signed correction's, and the meal row's own detected list.
      const { data: detRow } = await service.from('meals').select('detected').eq('id', mealId).maybeSingle();
      const outcome = sanitizeOutcome(outcomeIn, allowedNames(outcomeIn.correction, detRow?.detected));
      const { lead, follow } = outcomeRows(outcome, pending.ack, { nonce: pending.nonce, photos: pending.photos });
      const base = { meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai', kind: 'message' };
      // In thread order, one insert each so created_at keeps that order: Nia's words, the receipt
      // (only after words that say the numbers moved, only with figures that did), what is owed.
      // Always WITH meta: the ct is what makes each row file once (0249's unique index), so a row
      // without it would be the one that could be filed twice.
      const file = async (row: { text: string; meta: Record<string, unknown> }) =>
        (await service.from('meal_comments').insert({ ...base, text: row.text, meta: row.meta })).error;
      const put = async (row: { text: string; meta: Record<string, unknown> }) => { const e = await file(row); return !e || e.code === '23505'; };
      /* A RETRY FILLS THE GAPS (review round 3). Each row is looked up by its own ct, so a report
         whose response was lost, or whose receipt or follow-up failed to insert, files only what is
         missing and says what it still could not: `receipt: false` has the device file its plain one
         (nonce:f), `question: false` keeps the job in the device's outbox to try again. */
      const has = async (ct: string) => {
        const { data } = await service.from('meal_comments').select('id').eq('meal_id', mealId).eq('role', 'ai').eq('meta->>ct', ct).limit(1);
        return Array.isArray(data) && data.length > 0;
      };
      const duplicate = await has(pending.nonce);
      if (!duplicate) {
        const leadErr = await file(lead);
        // 23505: a concurrent report filed this turn first (the read above raced it). Already done.
        if (leadErr && leadErr.code !== '23505') return bad(503, 'unavailable', cors);
      }
      let receipt = true;
      if (outcome.applied && receiptRows) {
        receipt = (await has(`${pending.nonce}:r`)) || (await has(`${pending.nonce}:f`))
          || await put({ text: correctionReceiptText(receiptRows), meta: { t: 'correction_receipt', rows: receiptRows, ct: `${pending.nonce}:r` } });
      }
      let question = true;
      if (follow) question = (await has(`${pending.nonce}:q`)) || await put(follow);
      // No ai_calls row: this mode makes no model call, and ai_calls is one row per paid call
      // (ai-telemetry.ts). The turn that produced the ack already recorded its own.
      return ok({ reply: lead.text, receipt, question, ...(duplicate ? { duplicate } : {}) });
    }
    if (receiptRows) {
      let rows = receiptRows;
      let note: string | null = null;
      if (additionId) {
        // The addition must be a real ai_addition row on THIS meal, and a coach may only file the
        // receipt for one they asked for themselves.
        const { data: add } = await service.from('meal_comments').select('id, role, meta')
          .eq('id', additionId).eq('meal_id', mealId).maybeSingle();
        const am = (add?.meta ?? {}) as Record<string, unknown>;
        const asker = (am.requestedBy ?? {}) as Record<string, unknown>;
        if (!add || add.role !== 'ai' || am.t !== 'ai_addition' || (coachReceipt && asker.id !== callerId)) {
          return bad(403, 'unauthorized', cors);
        }
        // One receipt per addition. The second device to arrive is a no-op, not a second card.
        const { data: dup } = await service.from('meal_comments').select('id')
          .eq('meal_id', mealId).eq('role', 'ai').eq('meta->>t', 'correction_receipt')
          .eq('meta->>additionId', additionId).limit(1);
        if (Array.isArray(dup) && dup.length) {
          return new Response(JSON.stringify({ ok: true, duplicate: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }
        note = additionNote(am);
        // The COACH's device does not know the athlete's plan style; this function does. An
        // Intuitive athlete's receipt carries the meal score and nothing else.
        const style = (await loadPlanStyleForAthlete(service, mealRow.athlete_id))?.style ?? null;
        rows = receiptRowsForStyle(rows, style) as ReceiptRow[];
        if (!rows.length) return new Response(JSON.stringify({ ok: true, empty: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      const text = correctionReceiptText(rows);
      const row = {
        meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai',
        text, kind: 'message',
        meta: { t: 'correction_receipt', rows, ...(note ? { note, additionId } : {}) } as Record<string, unknown>,
      };
      if (receiptCt) row.meta.ct = receiptCt;
      const { error: recErr } = await service.from('meal_comments').insert(row);
      // The device's fallback receipt carries its own ct (nonce:f): a retry after a lost response is
      // the same row, and 0249's unique index says so.
      if (recErr && recErr.code === '23505' && receiptCt) {
        return new Response(JSON.stringify({ ok: true, duplicate: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (recErr) {
        // A database without `meta` still gets the sentence: the figures are in the text, so the
        // thread keeps a true record of the change rather than losing it to a missing column.
        await service.from('meal_comments').insert({ meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai', text });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // AI CONSENT (0243, Guideline 5.1.2(i)). Everything below sends the thread to Anthropic: the
    // meal owner's photos, numbers and dossier, and the caller's own words. It runs only when BOTH
    // have said yes: the athlete first (their data is the subject), then the caller (a coach's
    // question is the coach's data). Fail-closed. A 200 with a plain code, never an error: the
    // client shows "AI replies are off" and the message the person wrote is already saved.
    {
      const missing = await missingConsent(service, [mealRow.athlete_id, callerId]);
      if (missing !== null) {
        return new Response(JSON.stringify(consentSkipBody(missing === mealRow.athlete_id && missing !== callerId ? 'athlete' : 'you')),
          { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    }
    // I3: only the words of people who said yes reach the model. Everyone else in the thread is a
    // placeholder with a role word, no text and no name; anyone the meal owner blocked is dropped.
    // The addressing gate below still reads the raw `context` (it never goes to the model).
    const consentFor = async (ids: string[]) => new Set<string>(consentedIds(ids, await loadConsentRows(service, ids)));
    let ownerBlocked = new Set<string>();
    try {
      const { data: ob } = await service.from('user_blocks').select('blocked_id').eq('blocker_id', mealRow.athlete_id);
      ownerBlocked = new Set(((ob ?? []) as Array<{ blocked_id: string }>).map((b) => String(b.blocked_id)));
    } catch { /* unread blocks: the placeholders still hold for non-consented authors */ }
    const promptContext = scrubContext(context, {
      consented: await consentFor([mealRow.athlete_id, callerId, ...authorIds(context, [])]),
      ownerId: mealRow.athlete_id, blocked: ownerBlocked,
    });

    // Plan style (0142) resolves for the MEAL OWNER, never the caller. In draft and coach-support
    // mode the caller is the COACH — but the person who reads the words is the athlete, so it is
    // their style that decides what may be said. Getting this backwards would let a coach
    // unknowingly send macro figures to an athlete who is deliberately not tracking them.
    // THE DOSSIER (founder 2026-09-23: "the AI Nutritionist should know the athlete's
    // requirements, goal weight, position"). Started FIRST so its reads run alongside the plan
    // style, memory and voice loads below: one parallel batch, no model call. Keyed on the meal
    // row's athlete_id (never a client id). A coach or trainer sees only what the database lets
    // them see: weight facts are gated by can_view_weight, asked with the CALLER's JWT.
    const dossierP = loadAthleteDossier(service, mealRow.athlete_id, {
      isSelf: mealRow.athlete_id === callerId,
      weightClient: userClient,
      dayDate: typeof mealRow.day_date === 'string' ? mealRow.day_date : null,
    });
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
    // Guardians never reach this line (0081 took them out of can_view, so the meal select above
    // refuses them); 'guardian' is the fail-closed answer should one ever arrive in a coach mode.
    const dossier = renderDossier(await dossierP, {
      viewer: !coachMode ? 'self' : body?.askerNoun === 'parent' ? 'guardian' : 'staff',
      planStyle,
      dayType: body?.athlete?.dayType,
      positionWords,
    });
    // The athlete's clock rides only on the athlete's own turns: a coach's device is not their clock.
    const clock = coachMode ? '' : clockLine(body?.athlete);
    const ctxBlock = `Context (deterministic, computed by the app):\n${JSON.stringify(promptContext)}${
      dossier ? `\n\n${dossier}` : whoLine ? `\n\nThe athlete this thread belongs to:${whoLine}` : ''}${clock ? `\n\n${clock.trim()}` : ''}`;
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
          content: `${ctxBlock}\n\nDraft four replies the COACH could send to the athlete about this meal, one per stance (supportive, direct, context, followup), using ONLY figures already in the context. Speak as the coach to the athlete. Each draft is 60 words or less.`,
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
    /* ================= IS ANYONE TALKING TO THE AI? =================
       The founder watched this happen in the app:

           Coach Alex:      Good job
           Athlete:         Thank you Coach
           AI Nutritionist: <answers, about protein>

       Every athlete composer used to end in an unconditional askAI(), so the model was handed a
       turn whether or not it had been spoken to. The composers now decide first — but a decision
       that only lives on the client is a request away from being bypassed, by a stale OTA, a
       replayed call, or anything else holding a session. So the SAME function runs here, over the
       SAME identity-preserving transcript the client sent, and a message addressed to a person is
       refused before it can cost a token.

       Enforced only when the caller sent the structured transcript (`speaker` + rich `thread`
       entries): a client that predates this contract has nothing to judge, and silently muting it
       would be worse than the behaviour being fixed. The OTA that adds the gate adds both halves.

       Never applied to the coach's own modes (coachAsk is a button press, drafts and correction
       receipts are not conversation) — those are addressed to the AI by construction. */
    const verdict = gateVerdict(body, context, { coachMode, correctionUpdate, receiptRows }) as
      { shouldRespond: boolean; intendedRecipient?: unknown; confidence?: number; reason?: string } | null;
    if (verdict && !verdict.shouldRespond) {
      // 200, not an error: the athlete's message DID land in the thread. The only thing that did
      // not happen is the AI speaking, which is the point.
      return new Response(JSON.stringify({
        silent: true,
        intendedRecipient: verdict.intendedRecipient ?? null,
        confidence: verdict.confidence ?? null,
        reason: verdict.reason ?? 'not addressed to the AI',
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

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
    // The COACH may attach too (2026-09-02): "is this the portion you meant?" with a picture is
    // the mirror of the athlete's "here's what I ate", and the AI answering the coach without
    // seeing it was answering half the question. A coach's attachment lives under the COACH's
    // own folder (storage RLS keys the path on the uploader), so the boundary is the caller's
    // uid on that path, never the athlete's.
    //
    // THE THREAD'S PHOTOS, NOT JUST THIS MESSAGE'S (2026-09-22). The coach's "make sure that gets
    // added in" carried no image, so the model never saw the shake the athlete had posted 45
    // minutes earlier, and said so, twice. Every conversational turn now reads THIS meal's recent
    // photos out of meal_comments itself: at most two, newest first, only ones no earlier turn has
    // already turned into numbers, only from the athlete's folder or the caller's own, 6MB each.
    // The rows come from the database, so the client can post a picture but never name one.
    const seesThread = !coachSupport && !correctionUpdate && !draftMode;
    let threadRows: Array<Record<string, unknown>> = [];
    let threadConsented = new Set<string>([String(mealRow.athlete_id), String(callerId)]);
    if (seesThread) {
      try {
        const { data: tr } = await service.from('meal_comments')
          .select('id, role, author_id, text, kind, meta, created_at')
          .eq('meal_id', mealId).order('created_at', { ascending: false }).limit(40);
        const raw = (tr ?? []) as Array<Record<string, unknown>>;
        // I3: non-consented authors become placeholders (no text, no photo), blocked ones vanish.
        threadConsented = await consentFor([mealRow.athlete_id, callerId, ...authorIds(null, raw)]);
        threadRows = scrubRows(raw, { consented: threadConsented, blocked: ownerBlocked }).rows;
      } catch { /* no thread: the turn still answers, it just sees only what it was sent */ }
    }
    const photoPicks = seesThread
      ? pickThreadPhotos(threadRows, { athleteId: mealRow.athlete_id, callerId, current: photoPathRaw })
      : [];
    const photos: Array<{ key: string; b64: string; pick: (typeof photoPicks)[number] }> = [];
    for (const pick of photoPicks) {
      try {
        const dl = await service.storage.from('meal-photos').download(pick.key);
        if (!dl.data) continue;
        const buf = new Uint8Array(await dl.data.arrayBuffer());
        // Guard the model call, not the bucket: the client encodes to ~1000px/q0.82 (a few
        // hundred KB), so anything past 6MB is not a chat attachment and is dropped rather
        // than turned into an enormous, expensive request.
        if (!buf.length || buf.length > 6_000_000) continue;
        let bin = '';
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        photos.push({ key: pick.key, b64: btoa(bin), pick });
      } catch { /* unreadable attachment: answer the words, never fail the whole turn */ }
    }
    const photoB64 = photos.length ? photos[0].b64 : null;
    const photoKeys = photos.map((p) => p.key);

    // WHO IS IN THE ROOM, BY NAME (2026-09-22). The coach turn answered "I don't have details on
    // what HE is drinking": a pronoun guessed from nothing, about an athlete it could have named.
    // First names come from profiles, read with the service role for exactly the people in this
    // thread; the model is told to use them and never to guess a pronoun.
    const byId: Record<string, string> = {};
    try {
      // I3: names only for people who agreed; anyone else is their role word in the transcript.
      const ids = [...new Set([mealRow.athlete_id, callerId, ...threadRows.map((r) => r.author_id)]
        .filter((v): v is string => typeof v === 'string' && !!v && threadConsented.has(v)))].slice(0, 12);
      const { data: ppl } = await service.from('profiles').select('id, full_name').in('id', ids);
      for (const p of (ppl ?? []) as Array<{ id: string; full_name: string | null }>) byId[p.id] = String(p.full_name ?? '');
    } catch { /* names are an enhancement: the prompt falls back to "the athlete" */ }
    const athleteFirst = firstName(byId[mealRow.athlete_id]);
    const askerNoun = typeof body?.askerNoun === 'string' ? body.askerNoun : 'coach';
    const requester = coachAsk ? requesterLabel(byId[callerId], askerNoun) : '';
    const nameLine = athleteFirst
      ? `\n\nThe athlete's first name is ${athleteFirst}. Call them ${athleteFirst} (or "they"); never he or she.`
      : '\n\nYou do not know the athlete\'s name: say "the athlete" or "they", never he or she.';
    const imagesLine = photos.length
      ? `\n\n${photoPreamble(photos.map((p) => p.pick), { athleteId: mealRow.athlete_id, athleteFirst, callerId, callerLabel: coachAsk ? requester : athleteFirst })}`
      : '';

    // What could ground a COACH-requested addition: the athlete's own photo or words in this
    // thread, never the coach's. Offered only to a coach client that can say it asked (the
    // capability contract every other tool here already follows).
    const grounds = coachAsk && body?.canDirectAdd === true ? additionGrounds(threadRows, mealRow.athlete_id) : [];

    // THE DOLLAR CEILING (0152): the caps above count CALLS, this counts MONEY. Fail-closed.
    // A turn carrying an image is a VISION call and costs several times a text one, so it is
    // estimated as such — charging it at the text rate would let attachments walk the daily
    // ceiling past its actual limit. Two images are two vision estimates.
    const spendChat = await checkSpend(photos.length ? EST_USD.vision * photos.length : EST_USD.text);
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
      ...(canApplyCorrection ? [canConfirmCorrection ? CORRECTION_TOOL_CONFIRM : CORRECTION_TOOL] : []),
      ...(canRemember ? [REMEMBER_TOOL] : []),
      ...(canSuggestMeal ? [SUGGEST_MEAL_TOOL] : []),
      FLAG_TOOL,
    ] as unknown as Anthropic.Tool[];
    // The user turn, named once because the style-correction retry below has to replay it exactly.
    // The thread as the database holds it, with names, ids and which line carries which image.
    // The coach's client sends six anonymous {role, text} lines; this is what a person scrolling
    // the thread actually sees.
    const coachThread = coachAsk && threadRows.length
      ? `\n\nThe thread so far, oldest first:\n${threadTranscript(threadRows, { byId, athleteId: mealRow.athlete_id }, photos.map((p) => p.pick))}`
      : '';
    const groundsLine = grounds.length
      ? `\n\nMessages from ${athleteFirst || 'the athlete'} that you may add food from with add_from_athlete (id, then what they sent):\n${grounds.map((g) => `- ${g.id}: ${g.photoKey ? '[photo] ' : ''}${g.text ? `"${g.text.replace(/["<>]/g, '').slice(0, 160)}"` : '(no words)'}`).join('\n')}`
      : '';
    const userTurn = coachAsk
      ? `${ctxBlock}${nameLine}${coachThread}${imagesLine}${groundsLine}\n\n${requester || 'The coach'} just asked you directly: "${question}"\n\nAnswer ${requester || 'the coach'} directly, in their terms, in 70 words or less: you are talking TO the coach, not writing a report about the athlete. Use ONLY figures and foods present in the context, the thread, or an image you can see.${photos.length ? ' You CAN see the image(s) above: they are photos from this thread. Read them; never say you cannot see an image.' : ''}${grounds.length ? ` If the coach is asking you to add, count or log something ${athleteFirst || 'the athlete'} showed or described in one of the listed messages, call add_from_athlete: do not tell anyone to log it themselves. If it is a Nutrition Facts panel, read the printed figures exactly (basis "label"); if a figure is unreadable, list it as unreadable and say you will ask ${athleteFirst || 'the athlete'} for just that one.` : ' If the coach asks you to add something, you can only add food the athlete showed or described in this thread themselves, and there is nothing like that here: say so in one sentence and suggest the athlete send a photo or tell you what it was.'} If the context cannot support a firm answer, say so and name the one thing you would check.`
      : coachSupport
      ? `${ctxBlock}\n\nThe COACH just said this on the athlete's meal: "${question}"\n\nIn 60 words or less, speaking to the athlete, back the coach's point using ONLY figures already in the context. Do not add new requirements, do not soften the coach, do not contradict them. If the context has nothing relevant, one steady sentence reinforcing the coach is enough.`
      : correctionUpdate
        // The correction is already applied and the numbers in the context are the CORRECTED ones.
        // The job is to acknowledge the fix and re-read the plate with it, conversationally — not
        // to apologise, and not to re-litigate what the photo showed.
        ? `${ctxBlock}\n\nThe athlete just corrected your read of this meal. The numbers above are the CORRECTED ones. In 50 words or less, reply like a coach texting back — open by thanking them for the correction in a short natural clause ("Thanks for correcting the oil, that changes things a bit."), then give the ONE thing the update means for their next meal. Two or three sentences, conversational, no headings, no lists. Do not apologise, do not explain the mistake, do not re-list the numbers.`
        : `${ctxBlock}${nameLine}${imagesLine}\n\nWhat ${athleteFirst || 'the athlete'} just said to you: ${question}${photos.length ? `

The image(s) above are photos from this meal's thread. They have not been analyzed and nothing in
the context describes them. You CAN see them: read them yourself and never say you cannot see an
image. FIRST decide what each one is:
- Food or drink from THIS meal that the read does not list (a side, a drink, a second plate they
  forgot): call apply_correction and put each such food in the missed list, so it counts toward
  their numbers and score. Do not describe its macros in prose instead, and never tell them to log
  it themselves.
- A Nutrition Facts panel or printed packaging: read it EXACTLY. Put the food in the missed list (or
  correct the logged item it belongs to) with basis "label", the PRINTED per-serving protein,
  calories, carbs and fat, and servings set to how much they consumed. The printed figures are the
  truth; never swap in a typical value for that kind of product. If a figure is blurred, cut off or
  in glare, list it under unreadable, leave it empty, and in your message name that one figure and
  ask them for just that.
- Evidence that a LOGGED item is a different food or a different amount than the read says:
  call apply_correction with newName (perBasis "estimate") or quantity for that item.
- Anything else (a menu, a question about a food they have not eaten, a portion they are asking
  about): answer what they asked. Say plainly that you are eyeballing the picture, keep any figure
  clearly an estimate, and leave every number about the LOGGED meal exactly as given.` : ''}`;

    // Images ride as their own content blocks ahead of the text, in the order the preamble names
    // them. Text-only turns (and the style retry below) never carry one.
    const userContent = photos.length
      ? [
        ...photos.map((p) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: p.b64 } })),
        { type: 'text' as const, text: userTurn },
      ]
      : userTurn;
    // The coach may carry out an addition only when the thread grounds it (see coachAddTool).
    const coachTools = (grounds.length
      ? [REPLY_TOOL, coachAddTool(grounds.map((g) => g.id))]
      : [REPLY_TOOL]) as unknown as Anthropic.Tool[];

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
      tools: coachAsk ? coachTools : coachSupport || correctionUpdate ? replyTools : athleteTools,
      tool_choice: coachAsk && grounds.length ? { type: 'any' }
        : coachSupport || coachAsk || correctionUpdate ? { type: 'tool', name: 'reply' } : { type: 'any' },
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
        more?: unknown; missed?: unknown;
        protein_gap_g?: unknown; kcal_gap?: unknown; framing?: unknown; fallback?: unknown;
        sourceMessageId?: unknown; foods?: unknown;
      };
    } | undefined;

    // ── ADD FROM THE ATHLETE, AT THE COACH'S REQUEST (lead decision 2026-09-22) ──
    // The coach asked; the athlete's own message is the evidence; the athlete's device does the
    // arithmetic. This row is the unforgeable record of all three: it names whose photo or words
    // and at whose request, and carries the add-foods payload (meta.c) that the athlete's app
    // applies through the same deterministic engine as every other correction, exactly once per
    // row id (state.js applyProCorrection). The photo it came from is marked applied so no later
    // turn adds it twice.
    if (tool?.name === 'add_from_athlete') {
      const ok = validateCoachAddition(tool.input, grounds);
      if (!ok) {
        // Refused: the model cited nothing the athlete posted. Say what is true, to the coach.
        const refusal = styleSafe(`I can only add food ${athleteFirst || 'the athlete'} showed or described in this thread, and I could not match this to one of their messages. If ${athleteFirst || 'they'} sends a photo or tells me what it was, I will count it.`);
        await service.from('meal_comments').insert({ meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai', kind: 'message', text: refusal });
        await recordAiCall({ fn: 'meal-chat', mode: 'reply', phase: 'coach_add', userId: callerId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0r, ok: true, outcome: 'coach_add_refused' });
        return new Response(JSON.stringify({ reply: refusal, refused: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      const fromPhoto = !!ok.source.photoKey;
      const receipt = additionReceiptText({ athleteFirst, requester, foods: ok.foods, fromPhoto });
      const ack = styleSafe(scrubToolLeak(String(tool.input?.ack ?? '')).replace(/—/g, ',').trim().slice(0, 300));
      // The label figure the model could not read is asked for in the same breath, of the athlete.
      const missing = [...new Set(ok.foods.flatMap((f: unknown) => (f as { unreadable?: string[] }).unreadable ?? []))];
      const ask = missing.length
        ? ` ${athleteFirst || 'Athlete'}, I couldn't read the ${missing.map((m) => (m === 'kcal' ? 'calories' : m)).join(' or ')} on that label. What does it say?`
        : '';
      const text = `${ack ? `${ack} ` : ''}${receipt}${ask}`.slice(0, 1000);
      const meta = {
        t: 'ai_addition',
        c: { kind: 'add-foods', foods: ok.foods, said: ok.source.text || undefined },
        source: { messageId: ok.source.id, photo: fromPhoto, athleteFirst: athleteFirst || null },
        requestedBy: { id: callerId, name: requester || null },
        photos: ok.source.photoKey ? [ok.source.photoKey] : [],
      };
      const row = { meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai', text };
      const { data: addRow, error: addErr } = await service.from('meal_comments')
        .insert({ ...row, kind: 'message', meta }).select('id').maybeSingle();
      // Without meta there is no payload to apply, so there is no addition id to hand back either:
      // the sentence still lands, and nothing claims the numbers moved.
      if (addErr) await service.from('meal_comments').insert({ ...row, kind: 'message' });
      await recordAiCall({ fn: 'meal-chat', mode: 'reply', phase: 'coach_add', userId: callerId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0r, ok: true, outcome: 'coach_add_returned' });
      // The coach's device applies this AT ONCE (coach.js): it prices the same foods through the
      // same engine, writes the meals row through pro_correct_meal, and files the receipt.
      const addition = !addErr && addRow?.id
        ? { id: String(addRow.id), foods: ok.foods, said: ok.source.text || null, sourceMessageId: ok.source.id }
        : null;
      return new Response(JSON.stringify({ reply: text, addition }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // ── SUGGEST MEAL: the athlete asked what to eat. The model frames; the client picks. ──
    // The row carries framing + fallback as plain text (complete for any renderer) and the meta
    // the athlete-facing threads key on to draw the picks from Food Memory instead. Nothing here
    // names a food: the suggestions are the athlete's own saved meals, ranked client-side by the
    // same rule Plan > Ask uses, so the numbers are ones the app already holds.
    if (tool?.name === 'suggest_meal') {
      const parsed = parseSuggestMeal(tool.input);
      if (!parsed) return bad(502, 'unavailable', cors);
      const sug = { ...parsed, framing: styleSafe(parsed.framing), fallback: styleSafe(parsed.fallback) };
      const text = suggestRowText(sug);
      const row = { meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai', text };
      const { error: sugErr } = await service.from('meal_comments').insert({ ...row, kind: 'message', meta: suggestRowMeta(sug) });
      if (sugErr) await service.from('meal_comments').insert({ ...row, kind: 'message' });
      await recordAiCall({ fn: 'meal-chat', mode: 'reply', phase: 'suggest_meal', userId: callerId, model: msg.model ?? MODEL, latencyMs: 0, ok: true, outcome: 'suggest_returned' });
      return new Response(JSON.stringify({ reply: text, suggest: sug }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // ── REMEMBER: the athlete told the AI something lasting about themselves. ──
    // The reply is persisted like any other AI row, with meta `memory_offer` naming the pending
    // fact, so the thread can draw the Yes / No chips under it. The fact itself lands under the
    // MEAL OWNER (never the caller, though on this path they are the same person) as
    // `pending_confirmation`: memory-load.ts only ever reads `active`, so until the athlete taps
    // yes this row changes nothing about how they are read. Said twice, the same fact accrues
    // evidence on its one row instead of producing a second offer.
    if (tool?.name === 'remember') {
      let message = scrubToolLeak(String(tool.input?.message ?? '')).replace(/—/g, ',').trim().slice(0, 1000);
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
      // A label read rides as basis 'label' + servings + per-serving figures, and an unreadable
      // figure as a name, never a number (sanitizeFood, shared with the coach path).
      const missed = sanitizeFoods(tool.input?.missed);
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

      let ack = scrubToolLeak(String(tool.input?.ack ?? '')).replace(/—/g, ',').trim().slice(0, 500);
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
      // A label figure the model could not read is asked for by name, and only that one. The
      // rest of the label still counts now; the model was told to say this too, and this line is
      // the floor for when it did not.
      const unreadable = [...new Set(missed.flatMap((f: unknown) => (f as { unreadable?: string[] }).unreadable ?? []))]
        .map((m) => (m === 'kcal' ? 'calories' : m));
      const askLine = unreadable.length && !unreadable.every((u) => ack.toLowerCase().includes(u))
        ? ` I couldn't read the ${unreadable.join(' or ')} on the label. What does it say?`
        : '';
      const text = hasChange
        ? `${ack}${askLine}`
        : "I want to get that into your numbers, but I didn't catch enough to change them. Tell me what to fix, like the protein on the label or what else was in it, and I'll put it straight in.";
      const ackRow = { meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai', text };
      /* A CLIENT THAT APPLIES FIRST GETS THE PROMISE TO HOLD, NOT TO FILE (2026-09-24). hasChange
         proves the model SAID something applicable; only the client, which holds the plate, can
         prove the plate took it. So nothing is written here: the ack travels back signed, and the
         client files it (or Nia's follow-up question instead) through correctionOutcome. */
      if (hasChange && canConfirmCorrection) {
        const correction = { item, newName: newName || null, quantity: quantity || null, per, perBasis: top.perBasis, add, more, missed };
        // Bound to THIS correction: the report must echo it, and it is the only source of the food
        // names Nia may use when she speaks about it (besides the meal's own detected list). Hashed
        // as the client will see it, after a JSON round trip.
        const pending = await signPending({ mealId, userId: callerId, ack: text, photos: photoKeys, correction: JSON.parse(JSON.stringify(correction)) }, SUPABASE_SERVICE_ROLE_KEY);
        await recordAiCall({ fn: 'meal-chat', mode: 'reply', phase: 'correction_tool', userId: callerId, model: msg.model ?? MODEL, latencyMs: 0, ok: true, outcome: 'correction_pending' });
        return new Response(
          JSON.stringify({ reply: text, pending, correction }),
          { headers: { ...cors, 'Content-Type': 'application/json' } },
        );
      }
      // `photos`: the images this turn looked at are now in the numbers, so no later turn is shown
      // them again as something still to add (thread-photos.mjs appliedPhotoKeys).
      const { error: ackErr } = await service.from('meal_comments')
        .insert({ ...ackRow, kind: 'message', meta: hasChange ? { t: 'analysis_update', ...(photoKeys.length ? { photos: photoKeys } : {}) } : undefined });
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
      // Only a team coach is notified below, so only a team athlete is told a coach has it. A solo
      // athlete (or a trainer's client) is pointed at the right kind of person instead of at a
      // hand-off that never happens (review 2026-09-24).
      const { data: tm0 } = await service.from('team_members')
        .select('team_id').eq('athlete_id', mealRow.athlete_id).eq('status', 'active').limit(1).maybeSingle();
      const hasCoach = !!tm0?.team_id;
      const declineText = hasCoach
        ? "That one's for a person, not me. I've flagged it for your coach so they can pick it up."
        : "That one's for a person, not me: a doctor or a registered dietitian.";

      // A jailbreak must not become a way to spam a coach: at most 3 flags per athlete per day.
      const { data: fclaim } = await service.rpc('claim_ai_usage_key', { p_key: `meal_flag:${mealRow.athlete_id}`, p_limit: 3 });
      const withinFlagCap = (Array.isArray(fclaim) ? fclaim[0] : fclaim)?.allowed !== false;

      await service.from('meal_comments').insert({
        meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: mealRow.athlete_id,
        role: 'ai', kind: 'message', text: declineText,
        meta: { t: 'escalated', coach: hasCoach },
      });

      // The coach reads a name, not "an athlete": on a roster of 40 the anonymous version was
      // a push that had to be opened to find out who it was about.
      const { data: who } = await service.from('profiles').select('full_name').eq('id', mealRow.athlete_id).maybeSingle();
      const askerFirst = String(who?.full_name ?? '').trim().split(/\s+/)[0] || 'An athlete';
      const flagTitle = `${askerFirst} asked something for you`;
      let notified = false;
      const notifiedStaffIds: string[] = [];
      if (withinFlagCap) {
        // Whoever actively staffs this athlete's team. A solo athlete has no one to notify — the
        // decline still stands, we just record that there was no coach.
        const { data: tm } = await service.from('team_members')
          .select('team_id').eq('athlete_id', mealRow.athlete_id).eq('status', 'active').limit(1).maybeSingle();
        if (tm?.team_id) {
          const { data: staff0 } = await service.from('team_staff')
            .select('staff_id').eq('team_id', tm.team_id).eq('status', 'active').limit(5);
          // A SAFETY flag reaches the coach even if they blocked this athlete (review M4): a block
          // silences chatter, never a question the AI declined for the athlete's safety.
          const staff = (staff0 ?? []) as Array<{ staff_id: string }>;
          for (const st of staff) {
            await service.from('notifications').insert({
              user_id: st.staff_id, kind: `meal_flag:${mealId}`,
              title: flagTitle,
              body: note || 'Nia passed this one to you.',
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
            title: flagTitle,
            body: note || 'Nia passed this one to you.',
            data: { route: routeForCoachMeal(mealId) },
            sound: 'default',
          }));
          const flagOut = await sendExpoPush(messages);
          if (flagOut.failed) console.error('meal-chat: coach flag push refused', flagOut.failed, flagOut.errors.join('; '));
        } catch { /* notification row already landed; a push failure must not affect the athlete's response */ }
      }

      await recordAiCall({ fn: 'meal-chat', mode: 'reply', phase: 'flagged_for_coach', userId: callerId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0r, ok: true });
      return new Response(JSON.stringify({ reply: declineText, flagged: reason, notified }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    let reply = scrubToolLeak(String(tool?.input?.message ?? '')).replace(/—/g, ',').trim().slice(0, 1000);
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
        const candidate = scrubToolLeak(String(rtool?.input?.message ?? '')).replace(/—/g, ',').trim().slice(0, 1000);
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

/* PLAN IDEAS (goals and eating plan, phase A1, 2026-09-25). Plan > Today asks for up to three
   ideas for the athlete's next meal slot when their own usuals do not fill the list. No meal,
   no thread and nothing persisted to one: the caller asks for THEMSELVES and nobody else.

   Order matters and is the cost story: the cache is read FIRST (a hit is free and never touches
   the model, the cap or the consent read), then consent, then the per-athlete daily cap, then the
   dollar ceiling, then exactly one forced-tool call that is recorded in ai_calls. The allergy,
   intolerance and dislike filter runs AFTER the model, deterministically. */
const PLAN_IDEAS_CAP = Math.max(1, Math.floor(Number(Deno.env.get('PLAN_IDEAS_DAILY_CAP') ?? '8')) || 8);

async function planIdeasTurn(req: Request, raw: unknown, cors: Record<string, string>): Promise<Response> {
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' } });
  const ask = planIdeasRequest(raw, new Date().toISOString().slice(0, 10));
  if (!ask) return bad(400, 'bad_request', cors);
  const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: req.headers.get('authorization') ?? '' } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return bad(401, 'unauthorized', cors);
  const service = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // The athlete's stored preferences. Read here, never taken from the request, so the cache key
  // and the prompt always describe what is actually saved. Before 0250 the column does not exist
  // and the read errors: that is "no preferences", not a failure.
  let prefs = cleanFoodPrefs(null);
  try {
    const { data, error } = await service.from('profiles').select('food_prefs').eq('id', uid).maybeSingle();
    if (!error && data) prefs = cleanFoodPrefs((data as { food_prefs?: unknown }).food_prefs);
  } catch { /* no preferences */ }
  const key = prefsKey(prefs);

  // 1. The cache. One row per athlete, day and slot; a row built for other preferences is stale.
  try {
    const { data: hit } = await service.from('plan_ideas').select('ideas, prefs_key')
      .eq('athlete_id', uid).eq('day_date', ask.dayDate).eq('slot', ask.slot).maybeSingle();
    if (hit && hit.prefs_key === key && Array.isArray(hit.ideas)) return json({ ideas: hit.ideas, cached: true, key });
  } catch { /* no cache table yet: fall through to one paid call */ }

  // 2. AI consent (0243). The request carries the athlete's profile facts to the model.
  const missing = await missingConsent(service, [uid]);
  if (missing !== null) return json(consentSkipBody('you'));

  // 3. Caps: calls per athlete per day, then money. Both before the model.
  if (!(await withinKeyCap(`plan_ideas:${uid}`, PLAN_IDEAS_CAP))) return bad(429, 'limit', cors);
  const spend = await checkSpend(EST_USD.text);
  if (!spend.allowed) {
    console.log(JSON.stringify({ evt: 'ai_spend_block', fn: 'meal-chat:plan_ideas', reason: spend.reason }));
    return bad(429, 'capacity', cors);
  }
  void trackAuthedAiSpend(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, uid, 'meal-chat');

  // Who they are (goal, standard, allergies as hard constraints, the minor rule) and what the
  // app has learned, both for the caller's OWN record.
  const [facts, style, mem] = await Promise.all([
    loadAthleteDossier(service, uid, { isSelf: true, weightClient: userClient, dayDate: ask.dayDate }),
    loadPlanStyleForAthlete(service, uid),
    (async () => ((await flagOn(service, 'ai_memory', { userId: uid }))
      ? await loadMemoryForAthlete(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, uid) : []))().catch(() => []),
  ]);
  const planStyle: PlanStyle | null = style?.style ?? null;
  const dossier = renderDossier(facts, { viewer: 'self', planStyle, positionWords });
  const avoid = [...avoidWords(prefs, facts?.restrictions ?? null), ...avoidFromFacts(mem)];

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
  const t0 = Date.now();
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: [{ type: 'text', text: composeSystem(`${NIA_IDENTITY} ${NIA_HONESTY}\n\n${PLAN_IDEAS_SYSTEM}`, '', planStyle), cache_control: { type: 'ephemeral' } }],
    tools: [PLAN_IDEAS_TOOL] as unknown as Anthropic.Tool[],
    tool_choice: { type: 'tool', name: 'plan_ideas' },
    messages: [{ role: 'user', content: planIdeasUserText(ask, { prefs, dossier, memory: memoryBlock(mem) }) }],
  });
  const tool = msg.content.find((b) => b.type === 'tool_use') as { input?: unknown } | undefined;
  const ideas = parsePlanIdeas(tool?.input, { avoid });
  await recordAiCall({
    fn: 'meal-chat', mode: 'plan_ideas', userId: uid, model: msg.model ?? MODEL, ...usageFrom(msg.usage),
    latencyMs: Date.now() - t0, ok: true, outcome: ideas.length ? 'ideas_returned' : 'ideas_empty',
  });

  // Keep it, so the next open of Plan is free, and drop this athlete's rows older than a week.
  try {
    await service.from('plan_ideas').upsert(
      { athlete_id: uid, day_date: ask.dayDate, slot: ask.slot, prefs_key: key, ideas, created_at: new Date().toISOString() },
      { onConflict: 'athlete_id,day_date,slot' },
    );
    const weekAgo = new Date(Date.parse(`${ask.dayDate}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    await service.from('plan_ideas').delete().eq('athlete_id', uid).lt('day_date', weekAgo);
  } catch { /* the ideas still go back; the next open pays once more */ }
  return json({ ideas, cached: false, key });
}
