// OnStandard — nutrition PLAN STYLE prompt shaping (pure). Turns an athlete's resolved plan style
// (0142: Structured / Guided / Intuitive) into the directive that shapes every athlete-facing AI
// surface, and enforces the Intuitive language rail a second time on the generated text.
// No I/O, no Deno APIs — safe to unit-test in isolation. Loader lives in plan-style-load.ts.
//
// ---------------------------------------------------------------------------------------------
// HOW THIS COMPOSES WITH COACH VOICE
// ---------------------------------------------------------------------------------------------
// Coach voice (coach-voice.ts) sets PERSONALITY — how the words sound. Plan style sets what is
// SAYABLE — which facts may appear at all. They are orthogonal and both apply, in that order:
//
//     [coach voice directive]  →  [plan style directive]  →  [base task prompt]
//
// Style goes SECOND on purpose: it is the harder constraint. A coach whose configured voice is
// "fired up" still may not quote a macro figure to an Intuitive athlete, and putting the style
// directive nearer the task keeps that rail in the model's most recent context.
//
// ---------------------------------------------------------------------------------------------
// THE INVERTED FALLBACK (the thing to understand before changing any retry code)
// ---------------------------------------------------------------------------------------------
// Coach voice's banned-word fallback re-runs the call WITHOUT the voice directive, because the
// BASE prompt is the safe one and the voice is what introduced the risk.
//
// Plan style is the exact opposite. For Intuitive, the DIRECTIVE is what makes the output safe —
// the base prompt is a macro-quoting nutrition prompt. Re-running without it would produce a
// WORSE violation, confidently. So the escalation here is:
//
//     1. base + style directive
//     2. on violation → base + style directive + an explicit correction naming the exact hit
//     3. still violating → deterministic, style-safe copy. NEVER a bare base-prompt re-run.
//
// Anyone adding a new style-aware surface: copy that ladder, not coach-voice's.

export type PlanStyle = 'structured' | 'guided' | 'intuitive';

export const PLAN_STYLES: PlanStyle[] = ['structured', 'guided', 'intuitive'];

/** Coerce anything to a known style, or null. Null means "no directive" — see the loader's note
 *  on why that is always safe (Intuitive can never arise from a default). */
export function asPlanStyle(x: unknown): PlanStyle | null {
  const k = String(x ?? '').trim().toLowerCase();
  return (PLAN_STYLES as string[]).includes(k) ? (k as PlanStyle) : null;
}

/** Does this style show the athlete calorie/macro figures at all? Mirrors the client's
 *  knobs.surface.showMacros (plan-style.js PRESETS) — the ONE place that fact is decided. */
export function styleShowsNumbers(style: PlanStyle | null): boolean {
  return style !== 'intuitive';
}

/* ---------------------------------------------------------------- the directives */

const STRUCTURED_DIRECTIVE = [
  'PLAN STYLE — STRUCTURED. This athlete is held to exact targets and wants the numbers.',
  '- Quote the real figures plainly. Precision is the point for them.',
  '- Tie the plate to their target: what it delivered, what is left in the day.',
  '- Hold the standard directly. Late is late; say so without shaming, then move on.',
].join('\n');

const GUIDED_DIRECTIVE = [
  'PLAN STYLE — GUIDED. This athlete is on flexible ranges, not exact targets.',
  '- You MAY use numbers, but frame them as a RANGE they are inside or outside, never a single',
  '  number they hit or missed. "Comfortably in your range" beats "you were 12g under".',
  '- Lead with meal QUALITY and consistency; treat the exact figure as supporting detail.',
  '- Flexibility is the plan, not a concession. Never imply a range is the lenient option.',
].join('\n');

const INTUITIVE_DIRECTIVE = [
  'PLAN STYLE — INTUITIVE. This is the strictest constraint in this prompt. Follow it exactly.',
  '',
  'This athlete is deliberately NOT tracking calories or macros. Their plan measures awareness of',
  'their own hunger, fullness, satisfaction, energy, digestion and recovery — plus fueling enough,',
  'hydration and consistency. Some are recovering a healthy relationship with food. A number handed',
  'to them undoes the exact thing the plan is building.',
  '',
  'ABSOLUTE RULES — a single breach makes the whole response unusable:',
  '- NEVER state a calorie or macro figure. No grams, no kcal, no calories. Not approximate, not',
  '  a range, not "roughly", not spelled out in words. The app computes and stores them; their',
  '  professional can see them; this athlete does not.',
  '- NEVER moralize food. No good/bad foods, no clean, cheat, junk, guilty, earned, burned off,',
  '  made up for, damage, or being "on/off track". Food is not debt and not a moral category.',
  '- NEVER prescribe restriction, a deficit, skipping, or compensating for a meal.',
  '',
  'WHAT TO DO INSTEAD:',
  '- Describe what was on the plate in ordinary food language ("chicken, rice and something green").',
  '- Surface a PATTERN worth noticing, phrased as an observation they can check against their own',
  '  experience: how full it left them, whether energy held, how it sat.',
  '- Ask them to notice, never to correct. There is no fix to apply here.',
  '- Kitchen quantities ("a cup of rice", "two eggs") are FINE and useful — those are food, not',
  '  macros. Hydration in oz or litres is fine. Counts of meals, days and hours are fine.',
].join('\n');

const STYLE_DIRECTIVE: Record<PlanStyle, string> = {
  structured: STRUCTURED_DIRECTIVE,
  guided: GUIDED_DIRECTIVE,
  intuitive: INTUITIVE_DIRECTIVE,
};

/**
 * The directive for one style, or '' when no style is resolved (which reproduces today's prompt
 * byte for byte). Prepend to the base task prompt; see the composition note in this file's header.
 */
export function buildStyleDirective(style: PlanStyle | null): string {
  return style ? STYLE_DIRECTIVE[style] : '';
}

/** Compose voice + style + base in the one correct order. Either shaping layer may be absent. */
export function composeSystem(base: string, voiceDirective: string, style: PlanStyle | null): string {
  const styleDirective = buildStyleDirective(style);
  return [voiceDirective, styleDirective, base].filter((s) => s && s.trim()).join('\n\n');
}

/* ---------------------------------------------------------------- the Intuitive guard */

/* Multi-word moralizing phrases. These are checked as PHRASES, not words, on purpose: "good" and
   "bad" are far too common in ordinary encouraging prose ("a good pattern", "good sleep") to ban
   outright — doing so would fire on almost every response and burn a retry every time. What is
   actually harmful is the food-moralizing construction, so that is what is matched. */
const MORALIZING_PHRASES = [
  'good food', 'bad food', 'good foods', 'bad foods',
  'good choice', 'bad choice', 'good choices', 'bad choices',
  'clean eating', 'clean food', 'eat clean', 'ate clean', 'eating clean',
  'cheat meal', 'cheat day', 'cheat meals', 'cheat days',
  'junk food', 'guilty pleasure', 'guilt free', 'guilt-free',
  'burn it off', 'burn that off', 'work it off', 'work that off',
  'earn it', 'earned it', 'earn that', 'make up for it', 'make up for that',
  'off the wagon', 'back on track', 'damage control',
  'treat yourself', 'naughty',
  // Deliberately NOT here: bare "on track"/"off track" ("your hydration is on track" is ordinary
  // neutral prose), and "be good"/"been good" (fires on plain praise like "consistency has been
  // good"). Both are mild next to the rest, and a false positive costs a paid retry and can end
  // in canned copy — losing real feedback to catch a phrase that was never harmful.
];

/* Single words that are unambiguously moralizing in a nutrition context — no common innocent
   reading, so a bare-word match is safe here where it would not be for "good"/"bad".
   Note "shame" is excluded while "shameful" is kept: "no shame in that" is a supportive line. */
const MORALIZING_WORDS = [
  'cheat', 'junk', 'guilty', 'guilt', 'sinful', 'indulgent', 'indulgence',
  'detox', 'shameful', 'splurge', 'blowout',
];

/* A calorie or macro FIGURE. Deliberately unit-anchored so ordinary quantities survive:
   "1 cup rice", "6 oz", "3 meals", "8 hours", "100 oz of water" must all pass, while "45g",
   "2,400 calories", "30 grams of protein" must not. */
const MACRO_FIGURE_PATTERNS: RegExp[] = [
  // 45g / 45 g / 2,400 kcal / 300 cal / 2400 calories
  /\b\d[\d,]*\s*(?:g|gs|kcal|cals?|calories|calorie|grams?)\b/i,
  // "thirty grams", "two hundred calories" — the spelled-out escape hatch
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)[\s-]+(?:grams?|calories|kcal)\b/i,
  // "protein: 45" style
  /\b(?:protein|carbs?|carbohydrates?|fat|fibre|fiber)\b\s*[:=]\s*\d/i,
  // "45 of protein" — the "of" is required so "2 protein sources" (legitimate Intuitive food
  // language) does not trip. Unit-carrying forms like "45g of protein" are already caught above.
  /\b\d[\d,]*\s+of\s+(?:protein|carbs?|carbohydrates?|fat|fibre|fiber)\b/i,
];

export interface StyleViolation {
  /** 'figure' = a calorie/macro number reached the athlete. 'moralizing' = food framed morally. */
  kind: 'figure' | 'moralizing';
  /** The exact offending text, for the correction message and for telemetry. */
  hit: string;
}

/**
 * Check athlete-facing PROSE against the Intuitive rails. Returns null when clean, or the first
 * violation found. Only ever fires for Intuitive — the other styles have no language rail.
 *
 * Pass ONLY the free-text the athlete will actually read. Never pass structured numeric fields
 * (protein/kcal/…): those are always computed and always stored, and are exactly what a
 * professional needs. Suppression is presentation, never data.
 */
export function violatesStyleLanguage(text: string, style: PlanStyle | null): StyleViolation | null {
  if (style !== 'intuitive') return null;
  const raw = String(text ?? '');
  if (!raw.trim()) return null;

  for (const re of MACRO_FIGURE_PATTERNS) {
    const m = raw.match(re);
    if (m) return { kind: 'figure', hit: m[0].trim() };
  }

  // Normalize punctuation to spaces so "cheat-day" and "cheat day." both match, then pad so a
  // term at either end still has a boundary on both sides.
  const hay = ` ${raw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;
  for (const phrase of MORALIZING_PHRASES) {
    if (hay.includes(` ${phrase.replace(/[^\p{L}\p{N}\s]/gu, ' ')} `)) return { kind: 'moralizing', hit: phrase };
  }
  for (const word of MORALIZING_WORDS) {
    if (hay.includes(` ${word} `)) return { kind: 'moralizing', hit: word };
  }
  return null;
}

/**
 * The correction turn for escalation step 2. Names the exact hit so the retry has something
 * concrete to avoid, rather than a vague "try again" that tends to reproduce the same slip.
 */
export function styleCorrectionMessage(v: StyleViolation): string {
  const why = v.kind === 'figure'
    ? `It contained "${v.hit}", which is a calorie or macro figure. This athlete must never be shown one.`
    : `It used "${v.hit}", which frames food in moral terms. This athlete must never be given that framing.`;
  return [
    'Your previous response broke the Intuitive plan-style rule and was discarded.',
    why,
    'Rewrite it completely. Same plate, same honest read, but describe the food in ordinary',
    'language and point at a pattern worth noticing. Do not mention the rule or the correction.',
  ].join('\n');
}

/* ---------------------------------------------------------------- deterministic safe copy */

/* Escalation step 3. Used only when the corrected retry ALSO breaches — rare, but a required
   prose field cannot be nulled, so there has to be something honest to put there. These claim
   nothing about the specific plate, which is what makes them safe to say about any plate. */
export const SAFE_INTUITIVE = {
  note: 'Logged. Worth noticing how this one leaves you feeling over the next couple of hours.',
  analysis: 'This one is logged and on your record. Your plan is not about grading the plate, so the useful thing now is what you notice next: how full it left you, whether your energy held, and how it sat. That is the pattern worth having.',
  headline: 'Your month, in your own signals',
  narrative: 'Your record this month is built from what you actually logged and noticed. The most useful read is your own: which stretches felt steady, when energy held, and what was going on around the days that felt harder. Those patterns are the point, and they are yours to name.',
  focus: 'Keep noticing how meals leave you feeling, and keep the logging consistent.',
  reply: 'Good question. Your plan focuses on how food leaves you feeling rather than the numbers, so the most useful thing here is what you notice: your hunger before, how full and satisfied you were after, and how your energy held. Worth bringing to your coach if a pattern keeps repeating.',
} as const;
