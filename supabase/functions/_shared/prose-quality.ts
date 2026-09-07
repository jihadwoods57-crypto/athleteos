// IS THE FEEDBACK ANY GOOD? — deterministic, free, and measured on every eval run.
//
// The harness measured detection, macro error, contradiction and (since 2026-09-07) day leaks.
// Nothing measured whether the WRITING was worth reading, so nothing caught what 13 real reads
// showed the moment anyone looked:
//
//   - 11 of 13 opened with the same template: "This plate sets you up well...", "This plate holds
//     its own...", "This bowl leans carb-heavy...", "This breakfast gives you...". The system
//     prompt has said "never reuse the same sentence shape or opener from one meal to the next"
//     the whole time. It bans PHRASES; the model keeps the SHAPE and swaps the words.
//   - 8 of 13 hedged the verdict instead of making one: "holds its own", "sets you up well",
//     "well-rounded". "solid" was banned by name, so it reached for synonyms.
//   - 4 of 13 parroted the athlete's own goal string back at them ("for general development").
//   - 12 of 13 pushed the action to a future meal ("next time", "later"), which the prompt was
//     literally asking for, so the athlete got homework instead of a read of the plate in front
//     of them.
//
// The lesson driving this file: a banned-phrase list without a measurement is whack-a-mole, and
// the model always has another synonym. Measure the SHAPE, then the ban has teeth.
//
// Every check is intentionally narrow and cheap. Prose scoring is advisory: these are pressure
// gauges on a writing style, not correctness assertions, so thresholds live with the eval gate.

export type ProseFlags = {
  /** Opens with a demonstrative + noun ("This plate...", "This is a..."). The template. */
  openerTemplate: boolean;
  /** Verdict sentence hedges rather than committing to a judgment. */
  hedgedVerdict: boolean;
  /** Echoes the athlete's goal string back at them. */
  goalParrot: boolean;
  /** Every action is deferred to a future meal; nothing about the plate in front of them. */
  futureOnly: boolean;
};

const sentences = (t: string): string[] => (t.match(/[^.!?]+[.!?]+/g) || (t.trim() ? [t] : [])).map((s) => s.trim());

/** "This plate", "This bowl", "This breakfast", "This is a", "That plate"... the one shape. */
const OPENER_TEMPLATE = /^\s*(this|that|these|those)\s+(is|are|plate|bowl|meal|breakfast|lunch|dinner|snack|spread|combo|one)\b/i;

/** Words that describe without deciding. A verdict that could be pasted onto any plate. */
const HEDGE = /\b(holds? its own|sets? you up well|solid|decent|pretty good|not bad|works? well|does the job|well[- ]rounded|balanced|reasonable|fine for)\b/i;

/** Actions that live in a future that may never come. */
const FUTURE = /\b(next time|next meal|next dinner|next breakfast|next lunch|later|tomorrow|going forward|down the line|in future)\b/i;

/** Something to do about the plate in front of them, now. */
const PRESENT_ACTION = /\b(right now|with this|alongside this|before you (train|lift|practice|go)|finish|add(?: in)? a|drink|pair (?:it|this)|on the side now|with it)\b/i;

/**
 * Score one athlete-facing read. `goal` is the athlete's goal string when the request carried one,
 * so the check can tell "echoing the goal we gave it" from "happening to use the word".
 */
export function scoreProse(analysis: unknown, opts: { goal?: string | null } = {}): ProseFlags {
  const text = typeof analysis === 'string' ? analysis.trim() : '';
  if (!text) return { openerTemplate: false, hedgedVerdict: false, goalParrot: false, futureOnly: false };
  const first = sentences(text)[0] || '';

  const goal = typeof opts.goal === 'string' ? opts.goal.trim().toLowerCase() : '';
  // A goal string is only "parroted" when it is echoed as a phrase. Generic single words like
  // "performance" are ordinary vocabulary and flagging them would make the metric useless.
  const goalParrot = goal.length >= 8 && text.toLowerCase().includes(goal);
  // The stock phrasings the model reaches for when it has been handed a goal and nothing to say.
  const genericGoal = /\bfor general (?:athletic )?(?:development|training|fitness|health)\b/i.test(text);

  return {
    openerTemplate: OPENER_TEMPLATE.test(first),
    hedgedVerdict: HEDGE.test(first),
    goalParrot: goalParrot || genericGoal,
    futureOnly: FUTURE.test(text) && !PRESENT_ACTION.test(text),
  };
}

/** How many distinct opening shapes across a set of reads, as a 0..1 ratio. 1.0 = all different. */
export function openerVariety(analyses: unknown[]): number {
  const keys = new Set<string>();
  let n = 0;
  for (const a of analyses) {
    const text = typeof a === 'string' ? a.trim() : '';
    if (!text) continue;
    n++;
    const first = sentences(text)[0] || '';
    keys.add(first.split(/\s+/).slice(0, 3).join(' ').toLowerCase().replace(/[^a-z ]/g, ''));
  }
  return n ? keys.size / n : 1;
}
