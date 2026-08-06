// OnStandard — Coach Voice shared logic (pure). Turns a team's coach_voice_config (0094) into the
// system prompt that shapes an athlete nudge, and enforces the banned-word rail a second time on the
// generated text. No I/O, no Deno APIs — safe to unit-test in isolation.

export interface VoiceConfig {
  /** 'calm' | 'direct' | 'fired' (config default 'direct'). Unknown values fall back to direct. */
  tone: string;
  /** 'supportive' | 'balanced' | 'hard' (config default 'balanced'). */
  level: string;
  /** Phrases the coach approved the AI to echo, verbatim, when they fit. */
  approved: string[];
  /** Comma-separated words/phrases the AI must never use. */
  prohibited: string;
  /** 'brief' | 'standard' | 'detailed' — chat-reply length preference. Optional (pre-2026-08 rows). */
  length?: string;
  /** Free-text style instructions from the coach (≤500 chars). Style guidance only — the hard
   *  rails always win; buildVoiceDirective/chatVoiceDirective frame them that way explicitly. */
  instructions?: string;
}

/** Normalize the coach's free-text instructions for prompt inclusion: clamp, strip em dashes,
 *  collapse whitespace. Empty/absent -> '' (prompt stays byte-identical to before). */
export function cleanInstructions(instructions: string | undefined): string {
  return String(instructions ?? '').replace(/—/g, ',').replace(/\s+/g, ' ').trim().slice(0, 500);
}

const TONE_DIRECTIVE: Record<string, string> = {
  calm: 'Calm and steady. Even, reassuring, unhurried. No exclamation points.',
  direct: 'Direct and plain. Short sentences, no hedging, no fluff.',
  fired: 'Fired up and energetic. Urgent and motivating, but never mean or belittling.',
};

const LEVEL_DIRECTIVE: Record<string, string> = {
  supportive: 'Lead with encouragement; frame the miss as a small, fixable thing.',
  balanced: 'Even mix of encouragement and expectation; acknowledge effort, then point at the standard.',
  hard: 'Hold the line firmly; the standard is the standard. Firm, never demeaning or personal.',
};

/** Split the coach's comma-separated "never say" field into normalized lowercase terms. */
export function prohibitedTerms(prohibited: string): string[] {
  return (prohibited || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

/** True if `text` contains any banned term as a whole word (case-insensitive). Used as a
 *  server-side guard on the generated nudge — a hit nulls the nudge instead of shipping it. */
export function violatesProhibited(text: string, prohibited: string): boolean {
  const terms = prohibitedTerms(prohibited);
  if (terms.length === 0) return false;
  const hay = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
  return terms.some((term) => {
    // Word-boundary match on the term's own words so "fat" doesn't fire on "fatigue".
    const t = term.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    if (!t) return false;
    return hay.includes(` ${t} `);
  });
}

// The nudge-specific tail: a length constraint that fits a one-line nudge (but NOT a multi-sentence
// meal analysis) plus the forced-tool instruction. Kept out of buildVoiceDirective so other callers
// (analyze-meal) can apply the coach's voice without capping their own output length or tool choice.
const NUDGE_TAIL = [
  '- One or two short sentences. No hype, no em dashes, no emoji.',
  'Always answer by calling report_nudge.',
].join('\n');

/** Build the shared voice DIRECTIVE from the coach's config: tone, accountability, approved phrases,
 *  banned words, and the constant safety rails. This is the reusable core — it does NOT impose an
 *  output length or a tool call, so any AI surface (nudge, meal analysis) can prepend it and add its
 *  own output instruction. The hard rails are non-negotiable; the coach only tunes within them. */
export function buildVoiceDirective(cfg: VoiceConfig): string {
  const tone = TONE_DIRECTIVE[cfg.tone] ?? TONE_DIRECTIVE.direct;
  const level = LEVEL_DIRECTIVE[cfg.level] ?? LEVEL_DIRECTIVE.balanced;
  const approved = (cfg.approved || []).filter((p) => typeof p === 'string' && p.trim()).slice(0, 12);
  const banned = prohibitedTerms(cfg.prohibited);

  const lines = [
    'You are the OnStandard team AI, reinforcing a coach’s already-set standard to one athlete.',
    'You are given DATA the app already computed (the source of truth: what the athlete is on or off, what is due, why). Write ONE short nudge over it in the coach’s voice.',
    '',
    `TONE: ${tone}`,
    `ACCOUNTABILITY: ${level}`,
  ];
  if (approved.length) {
    lines.push('', 'You MAY echo any of these coach-approved phrases verbatim when one fits naturally (never force one):');
    for (const p of approved) lines.push(`  - "${p}"`);
  }
  if (banned.length) {
    lines.push('', `NEVER use these words or any form of them: ${banned.join(', ')}.`);
  }
  const extra = cleanInstructions(cfg.instructions);
  if (extra) {
    lines.push('', `The coach also asked for this style guidance (follow it only where it does not conflict with the hard rules below): ${extra}`);
  }
  lines.push(
    '',
    'HARD RULES (never break, whatever the tone):',
    '- You are AI. Never sign as the coach or imply the coach personally wrote this.',
    '- Never introduce a number, name, statistic, or fact not present in the data; never change or reinterpret a figure.',
    '- Never create a requirement, change a deadline, alter a score, or give medical, injury, weight-loss, or dietary-restriction advice.',
    '- Reinforce the standard the coach already set; do not invent new rules or consequences.',
  );
  return lines.join('\n');
}

/** Build the system prompt for one NUDGE: the shared voice directive plus the nudge-specific length
 *  cap and forced-tool instruction. Byte-identical to the prior single-function implementation. */
export function buildVoiceSystem(cfg: VoiceConfig): string {
  return buildVoiceDirective(cfg) + '\n' + NUDGE_TAIL;
}

const CHAT_LENGTH_DIRECTIVE: Record<string, string> = {
  brief: 'Keep replies to one or two short sentences — the coach chose brief responses.',
  detailed: 'Use the full word budget when it helps: concrete detail, specific foods, the reasoning behind the recommendation.',
};

/** The AI Nutritionist CHAT shaping block (meal-chat replies, coach questions, drafts). Unlike the
 *  nudge directive it does NOT redefine the assistant's identity or impose a tool call — meal-chat's
 *  own SYSTEM does that. This is a preferences block composed ABOVE the base system prompt via
 *  composeSystem's voiceDirective slot. Empty config pieces render nothing, so a coach who set
 *  nothing keeps today's prompt byte for byte. */
export function chatVoiceDirective(cfg: VoiceConfig): string {
  const lines: string[] = [
    "COACH VOICE PREFERENCES — set by this athlete's coach for how the AI Nutritionist should sound.",
    'These shape tone and style ONLY. They can never override the rules that bind you below: never invent or change a number, never create requirements, never give medical advice, and always stay labeled as AI.',
    '',
    `TONE: ${TONE_DIRECTIVE[cfg.tone] ?? TONE_DIRECTIVE.direct}`,
    `ACCOUNTABILITY: ${LEVEL_DIRECTIVE[cfg.level] ?? LEVEL_DIRECTIVE.balanced}`,
  ];
  const len = CHAT_LENGTH_DIRECTIVE[cfg.length ?? ''];
  if (len) lines.push(`LENGTH: ${len}`);
  const approved = (cfg.approved || []).filter((p) => typeof p === 'string' && p.trim()).slice(0, 12);
  if (approved.length) {
    lines.push('You MAY echo any of these coach-approved phrases verbatim when one fits naturally (never force one):');
    for (const p of approved) lines.push(`  - "${p}"`);
  }
  const banned = prohibitedTerms(cfg.prohibited);
  if (banned.length) lines.push(`NEVER use these words or any form of them: ${banned.join(', ')}.`);
  const extra = cleanInstructions(cfg.instructions);
  if (extra) lines.push(`COACH'S INSTRUCTIONS (style guidance only — the binding rules above still win): ${extra}`);
  return lines.join('\n');
}
