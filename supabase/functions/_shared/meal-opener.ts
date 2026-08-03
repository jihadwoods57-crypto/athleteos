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

/** "steak, sweet potato fries and green beans" — how a person lists what they can see. */
function foodList(detected: unknown): string {
  if (!Array.isArray(detected)) return '';
  const names = detected
    .map((d) => text((d as { name?: unknown })?.name).toLowerCase())
    .filter(Boolean)
    .slice(0, 5);
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Does anything in the read look like a guess we should say out loud? */
function lowConfidence(detected: unknown): boolean {
  if (!Array.isArray(detected)) return false;
  return detected.some((d) => {
    const c = text((d as { confidence?: unknown })?.confidence);
    return c === 'low' || c === 'medium';
  });
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

  const foods = foodList(input.detected);
  const meal = text(ctx.mealName) || text(input.name);
  const opening = meal ? meal.toLowerCase() : 'this one';

  // 1. Timing — the standard, stated first, because it is the part the athlete controls.
  if (ctx.late === true) parts.push(`Late on ${opening}, and logging it late still counts — hiding it wouldn't.`);
  else if (ctx.late === false) parts.push(`Good timing on ${opening}.`);

  // 2. What I can see.
  if (foods) parts.push(`I can see ${foods}${parts.length ? '' : ' on this one'}.`);

  // 3. Roughly what it comes to.
  const p = int(input.protein), k = int(input.kcal);
  if (numbers && p !== null && k !== null && (p > 0 || k > 0)) {
    parts.push(`I'd put it around ${p}g of protein and ${k} calories.`);
  }

  // 4. How it fits the day — real numbers from the engine or nothing at all. The total is the day
  // INCLUDING this plate (see OpenerContext.day); "required meals" names the denominator so this
  // never reads as contradicting the day-requirements counter on the log card.
  const dayTotal = int(ctx.day?.proteinIncludingThisMeal), target = int(ctx.day?.proteinTarget);
  const remaining = int(ctx.day?.mealsRemaining);
  if (numbers && dayTotal !== null && target !== null && target > 0) {
    const rem = remaining === null ? ''
      : remaining === 0 ? ' with your required meals in'
      : remaining === 1 ? ' with one required meal left'
      : ` with ${remaining} required meals left`;
    parts.push(`That puts you near ${dayTotal} of ${target}g for the day${rem}.`);
  }

  // 5. The model's own read of how this supports the athlete — the substance of the message.
  // Clipped on a sentence boundary, not at a character count: a paragraph that stops mid-clause
  // reads as broken software, and the message is supposed to sound like a person wrote it.
  const analysis = clip(text(input.analysis), 500);
  const note = text(input.note);
  if (analysis) parts.push(analysis);
  else if (note) parts.push(note);

  // 6. What I'm not sure about. Only for real uncertainty — a hedge on every meal is noise.
  if (lowConfidence(input.detected)) {
    parts.push("Some of that is a guess from the photo — portions, oil or sauce could move it, so correct anything I've misread.");
  }

  // 7. One practical thing, in the model's own words when it offered one.
  const sub = text((input.substitution as { suggestion?: unknown } | undefined)?.suggestion);
  const highlight = Array.isArray(input.highlights) ? text(input.highlights[0]) : '';
  if (sub) parts.push(sub);
  else if (highlight) parts.push(highlight);

  const out = clip(parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
  if (out.length < 2) return '';
  // Final rail, matching meal-chat: nothing that breaches the athlete's plan-style language is
  // ever persisted, even assembled from the model's own already-railed prose.
  return violatesStyleLanguage(out, style) ? '' : out;
}
