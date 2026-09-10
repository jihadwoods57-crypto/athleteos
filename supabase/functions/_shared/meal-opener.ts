// The AI nutritionist's opening message — what it says when it has read a plate.
//
// WHAT CHANGED. The athlete used to get a report card: a "WHAT WENT WELL" box, a "NEXT TIME" box,
// and a "View full analysis" expander hiding the actual thinking. It was derived on the client
// from the stored meal and never written down, so there was nothing to reply to, nothing to
// reference tomorrow, and nothing a coach could scroll back through. The founder's brief: it
// should read like a person on the athlete's staff talking to them.
//
// So this composes ONE conversational paragraph and it is persisted as a real message in the
// thread. What it covers, in the order a nutritionist would actually say it: what I can see on
// the plate, roughly what it comes to, how that fits your day and your goal, what I am not sure
// about, and one practical thing. No headers, no bullets, no labels.
//
// It costs nothing extra: every sentence is assembled from the read the model already returned.
// The uncertainty line is not politeness — a photo estimate that presents as a measurement is the
// thing that makes an athlete stop trusting the number when it is wrong.
//
// THE MEAL BREAKDOWN IS THE SINGLE SOURCE OF TRUTH (founder call 2026-08-02). This composer must
// be handed the GROUNDED read — the same object that renders the breakdown card, after the client
// has re-derived every macro against the food DB and recomputed the score deterministically. It was
// originally called from analyze-meal with the model's RAW tool output, which the client then threw
// away and recomputed, so the bubble and the card disagreed on every figure they shared: the thread
// said 23g of protein while the card said 29g, and the paragraph praised protein the card had just
// called low. The AI nutritionist EXPLAINS the analysis; it never produces a second one. Anything
// that calls this with numbers the card will not show is reintroducing that bug.
//
// HARD LIMIT: meal_comments.text is checked at 1..1000 chars (0046). Truncation is on a sentence
// boundary; a message that ends mid-word reads like a bug, not a voice.

import { violatesStyleLanguage, type PlanStyle } from './plan-style.ts';

const MAX = 1000;

type MealInput = {
  name?: unknown; quality?: unknown;
  protein?: unknown; kcal?: unknown; carbs?: unknown; fat?: unknown; fiber?: unknown;
  detected?: unknown; note?: unknown; analysis?: unknown; highlights?: unknown;
  substitution?: unknown;
};

const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/[<>]/g, '').trim() : '');
const int = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Does anything in the read look like a guess we should say out loud? */
function lowConfidence(detected: unknown): boolean {
  if (!Array.isArray(detected)) return false;
  return detected.some((d) => {
    const c = text((d as { confidence?: unknown })?.confidence);
    return c === 'low' || c === 'medium';
  });
}

/** What the read is unsure about on one item. 'portion' = the food is known and only the amount
 *  is a guess; 'product' = a packaged item whose exact product could not be resolved;
 *  'identity' = the food itself is a guess. */
export type UncertainAspect = 'portion' | 'product' | 'identity';
export interface UncertainItem { name: string; aspect: UncertainAspect }

/**
 * THE item the read is least sure about, named, and what about it (2026-09-10). The old hedge
 * ("If anything was cooked or portioned differently than it looks...") knew which item was the
 * guess and said nothing about it, so the athlete had to work out for themselves which of five
 * foods the AI meant, while the correction loop could already act on a named item. Lowest
 * confidence wins; among equals, the item that carries the most calories, because that is the
 * guess that moves the number. Null when nothing is uncertain or the uncertain item has no name.
 *
 * The read does not label WHY it was unsure, so the aspect is inferred from what it did resolve:
 * a packaged item with no exact product named is a product question; an item the model gave a
 * quantity for is a portion question; anything else is an identity question.
 */
export function uncertainItem(detected: unknown): UncertainItem | null {
  if (!Array.isArray(detected)) return null;
  const rank = (c: string) => (c === 'low' ? 2 : c === 'medium' ? 1 : 0);
  let best: { name: string; aspect: UncertainAspect; r: number; kcal: number } | null = null;
  for (const raw of detected) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    const r = rank(text(d.confidence));
    if (r === 0) continue;
    const name = text(d.name).slice(0, 60);
    if (!name) continue;
    const per = d.per && typeof d.per === 'object' ? (d.per as Record<string, unknown>) : d;
    const kcal = Number(per.kcal) || 0;
    if (best && (r < best.r || (r === best.r && kcal <= best.kcal))) continue;
    const packaged = d.kind === 'packaged' || d.kind === 'beverage';
    const hasProduct = text(d.product).length > 0 || d.basis === 'label' || d.basis === 'database';
    const aspect: UncertainAspect = packaged && !hasProduct ? 'product'
      : text(d.quantity) ? 'portion' : 'identity';
    best = { name, aspect, r, kcal };
  }
  return best ? { name: best.name, aspect: best.aspect } : null;
}

/** "Grilled chicken" reads as "the grilled chicken" mid-sentence; a brand keeps its capitals. */
function spoken(name: string): string {
  const words = name.split(/\s+/);
  const capitalised = words.filter((w) => /^[A-Z]/.test(w)).length;
  if (capitalised > 1) return name;        // "Core Power", "Greek Yogurt Bar": a name, keep it
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * The uncertainty sentence: one plain question naming the item, or, when the clarify budget is
 * already spent for the day, an honest note that this one is an estimate and which item it is.
 * The generic line survives ONLY as the fallback when no item can be named.
 */
export function uncertaintyLine(detected: unknown, clarifyBudgetSpent: boolean | null | undefined): string {
  const item = uncertainItem(detected);
  if (!item) {
    return lowConfidence(detected)
      ? "If anything was cooked or portioned differently than it looks, tell me and I'll tighten the numbers."
      : '';
  }
  const n = spoken(item.name);
  if (clarifyBudgetSpent === true) {
    if (item.aspect === 'portion') return `I'm estimating the ${n} portion on this one, so tell me the amount if it's off.`;
    if (item.aspect === 'product') return `I'm estimating the ${n} on this one, so tell me the exact product if you have it.`;
    return `I'm estimating the ${n} on this one, so tell me what it actually was if I've misread it.`;
  }
  if (item.aspect === 'portion') return `I'm least sure on the ${n} portion, so tell me how much and I'll tighten the numbers.`;
  if (item.aspect === 'product') return `I'm least sure which product the ${n} is, so tell me the exact one and I'll tighten the numbers.`;
  return `I'm least sure what the ${n} actually is, so tell me and I'll tighten the numbers.`;
}

/**
 * The model's read, kept WHOLE up to three sentences. The model is asked for two to three:
 * the takeaway, then the one adjustment, then (sometimes) the why. Every real read in
 * eval/responses runs 313 to 391 characters, and this used to clip at 260 on a sentence
 * boundary, so sentence one survived and the "what do I do next" sentence, the entire point of
 * the message, was dropped on every plate (2026-09-02). Sentence-aware: a boundary is a
 * terminator followed by whitespace, so "3.5 oz" never splits. The lazy scan matters: the
 * previous pattern excluded terminators from the sentence body, so a decimal made the whole
 * prefix unmatchable and "Aim for 3.5 oz" reached the athlete as "5 oz" (caught 2026-09-02
 * 1 PM audit). An abbreviation like "e.g." counts as its own sentence, but no text is ever
 * dropped mid-read.
 */
const READ_SENTENCES = 3;
const READ_MAX = 520;

/**
 * LENGTH IS DELIBERATE. DO NOT TRIM THIS MESSAGE (founder, 2026-09-07).
 *
 * The comments in this file used to say "a coach texts FOUR sentences, not ten", and on 2026-09-07
 * that stale note talked me into capping the whole message at five sentences. It was wrong, and the
 * founder's correction is the standing direction now: **the point of the length is to make it feel
 * real — a real nutritionist giving a breakdown and feedback on the meal.** A terse three-line
 * reply does not read like someone on your staff who looked at your food; it reads like an app.
 *
 * So the bar is NOT word count. The bar is that every sentence says something the athlete does not
 * already know from the screen in front of them. "Zero on the board for protein until now" was not
 * bad because the message was long, it was bad because it was EMPTY — it narrated a fact the
 * athlete created ten seconds earlier. Cut hollow sentences; never cut substance to hit a number.
 */
function readCore(s: string): string {
  if (!s) return '';
  const sentences = s.match(/[\s\S]*?[.!?]+(?=\s|$)|[\s\S]+$/g) || [s];
  const kept = sentences.map((x) => x.trim()).filter(Boolean).slice(0, READ_SENTENCES).join(' ');
  return clip(kept, READ_MAX);
}

/** Trim to `max` on a sentence boundary, falling back to a word boundary. */
function clip(s: string, max = MAX): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(' ');
  return `${cut.slice(0, word > 0 ? word : max).trimEnd()}…`;
}

export type OpenerContext = {
  planStyle?: PlanStyle | null;
  /** null when the deadline is unknown; true = logged past it. */
  late?: boolean | null;
  mealName?: string | null;
  /** Real history lines the CLIENT computed from the athlete's own recent meals (mealPatterns in
   *  proto meal-intel.js) — "You've hit your protein bar in 3 of your last 4 dinners." At most
   *  two are woven in, sanitized here; the server never invents history. */
  patterns?: unknown;
  /**
   * The athlete's day, as it stands AFTER this plate has landed.
   *
   * `proteinIncludingThisMeal` is named the long way on purpose. The field it replaced was called
   * `proteinSoFar`, which is also the name of the engine's PRE-meal total — the number the analysis
   * request carries, because the plate is still being read when that request is built. Wiring the
   * pre-meal number into this sentence is exactly what made a logged 29g breakfast tell the athlete
   * they were "near 0 of 155g". A name that cannot be confused with the other one is the fix.
   *
   * `mealsRemaining` counts the athlete's REQUIRED meal slots, which is a different denominator
   * from the day-requirements counter on the log card ("1 of 4 in today" counts weigh-ins and
   * check-ins too). The sentence says "required meals" so the two can never read as contradicting
   * each other.
   */
  day?: { proteinIncludingThisMeal?: unknown; proteinTarget?: unknown; mealsRemaining?: unknown } | null;
  goal?: string | null;
  /** True when the athlete's daily clarify budget was spent when this plate was read, so the model
   *  could not ask its question. The uncertainty line then says it is estimating and names the
   *  item, instead of the silence the forced report used to leave. null/undefined = unknown. */
  clarifyBudgetSpent?: boolean | null;
};

/**
 * Compose the opener. Returns '' when there is nothing honest to say, in which case the caller
 * simply does not post — an empty bubble is worse than no bubble.
 */
export function composeOpenerText(input: MealInput, ctx: OpenerContext = {}): string {
  const style = ctx.planStyle ?? null;
  // INTUITIVE (0142): not one macro or calorie figure may reach this athlete. The plate, the
  // timing and how it fits their goal still do — the composition IS the feedback. The model's own
  // prose is already style-railed upstream; this gate governs the sentences composed HERE.
  const numbers = style !== 'intuitive';
  const parts: string[] = [];

  const meal = text(ctx.mealName) || text(input.name);
  const opening = meal ? meal.toLowerCase() : 'this one';

  // THE RULE THIS COMPOSER LIVES BY (founder 2026-08-04, tightened 2026-08-05): never repeat
  // what is already on the screen, and never run long. A coach texts FOUR sentences, not ten —
  // the athlete's next decision, not a report. The client clamps anything past the core with a
  // "Read more", but the core itself must stand alone: takeaway → one move → the day, forward.

  // 1. The read itself: takeaway, then the one adjustment, then at most one more sentence. The
  // adjustment IS the message; see readCore for the clip that used to eat it.
  const analysis = readCore(text(input.analysis));
  const note = text(input.note);
  if (analysis) parts.push(analysis);
  else if (note) parts.push(note);

  // 2. A plan-slot substitution, when the model offered one, is a second concrete move and
  // belongs right after the read. NOT a highlight: those are micronutrient notes ("Collard
  // greens add iron and vitamin K"), and standing one here dressed the message as narration,
  // then trivia, then the day, with no move in it. Highlights ride in step 4b now.
  const sub = text((input.substitution as { suggestion?: unknown } | undefined)?.suggestion);
  if (sub) parts.push(sub);

  // 3. The day, framed FORWARD as the athlete's next decision — per-meal math, never a
  // restatement of the bars above. Real engine numbers or nothing; the total already includes
  // this plate (see OpenerContext.day).
  const dayTotal = int(ctx.day?.proteinIncludingThisMeal), target = int(ctx.day?.proteinTarget);
  const remaining = int(ctx.day?.mealsRemaining);
  if (numbers && dayTotal !== null && target !== null && target > 0) {
    const gap = target - dayTotal;
    if (gap <= 0) {
      parts.push(`That closes out your protein for the day, nothing left to chase there.`);
    } else if (remaining !== null && remaining > 1) {
      // "~60g at each of your next two meals" — the decision, pre-computed. Rounded to 5g:
      // a coach says "around 60", never "58.5".
      const per = Math.max(5, Math.round(gap / remaining / 5) * 5);
      parts.push(`Land around ${per}g of protein at each of your last ${remaining} meals and you'll hit today's target without forcing the last one.`);
    } else if (remaining === 1) {
      parts.push(`One meal left. Bring it in around ${gap}g of protein and the day closes out.`);
    } else if (remaining === 0) {
      parts.push(`Your required meals are in, about ${gap}g short on protein; a protein-forward snack tonight closes most of that.`);
    }
  }

  // ---- The rest of the breakdown. Each of these earns its place by saying something the screen
  // does not: what the athlete's own history shows, what the photo could not resolve, whether they
  // held the standard. None of it is filler, and none of it gets cut to hit a length. ----

  // 4. History — ONE real pattern line the client computed from this athlete's own meals,
  // individually style-railed so a numeric line can't cost an Intuitive athlete the message.
  const rawPatterns = Array.isArray(ctx.patterns) ? ctx.patterns : [];
  for (const p of rawPatterns) {
    const line = text(p).slice(0, 160);
    if (!line || violatesStyleLanguage(line, style)) continue;
    parts.push(/[.!?]$/.test(line) ? line : `${line}.`);
    break;
  }

  // 4b. ONE micronutrient highlight, terminated like a sentence (it arrives as a fragment, and
  // an unterminated one ran straight into the next line: "...micronutrients Land around 50g").
  // Style-railed like the pattern line: a numeric highlight must not cost an Intuitive athlete
  // the message.
  const highlight = Array.isArray(input.highlights) ? text(input.highlights[0]).slice(0, 160) : '';
  if (highlight && !violatesStyleLanguage(highlight, style)) {
    parts.push(/[.!?]$/.test(highlight) ? highlight : `${highlight}.`);
  }

  // 5. Timing — only when it needs saying. On-time praise lives in the score checklist now.
  if (ctx.late === true) parts.push(`And logging ${opening} late still counts. Hiding it wouldn't.`);

  // 6. What the photo can't show, said the way a confident pro says it (founder 2026-08-11:
  // "some of my read is a guess... correct anything I've misread" read as an AI apologizing,
  // not a nutritionist offering precision). The honesty stays — this only renders on a read
  // with real uncertainty in it — but the voice is an expert inviting a detail, never a hedge.
  // TARGETED (2026-09-10): it names the item it is least sure about and what about it, so the
  // athlete can answer in one line and the correction loop can act on that named item. When the
  // clarify budget is spent it says so, naming the item, instead of going quiet.
  const unsure = uncertaintyLine(input.detected, ctx.clarifyBudgetSpent);
  if (unsure) parts.push(unsure);

  // NO EM DASHES, and not by hand-discipline alone. Every model-written path in this product
  // strips them (meal-chat does it on replies, acks, notes and drafts); this composed path carried
  // four hardcoded ones, in the single most-read AI message the app produces. The rail lives here
  // so a sentence added later cannot quietly reintroduce one.
  const out = clip(parts.filter(Boolean).join(' ').replace(/—/g, ',').replace(/\s+/g, ' ').trim());
  if (out.length < 2) return '';
  // Final rail, matching meal-chat: nothing that breaches the athlete's plan-style language is
  // ever persisted, even assembled from the model's own already-railed prose.
  return violatesStyleLanguage(out, style) ? '' : out;
}
