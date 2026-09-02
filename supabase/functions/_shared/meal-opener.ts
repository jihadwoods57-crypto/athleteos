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

  // ---- Everything below is "Read more" territory on the client — still worth having, never
  // allowed to crowd the core. ----

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
  if (lowConfidence(input.detected)) {
    parts.push("If anything was cooked or portioned differently than it looks, tell me and I'll tighten the numbers.");
  }

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
