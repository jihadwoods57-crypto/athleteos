/**
 * Escalation: the questions the AI must NOT answer.
 *
 * An AI nutritionist that answers "should I cut 8lb before Friday" or "my knee gives out after
 * squats" is not being helpful — it is guessing at something with real consequences, in a voice
 * the athlete trusts and will act on. Those go to the human.
 *
 * These tests read the deployed prompt and tool contract directly. They are deliberately about the
 * CONTRACT rather than the model's output: we cannot assert what a model will say, but we can
 * assert that the escape hatch exists, is offered, is capped, and tells the athlete the truth
 * about what happened. If someone later removes the tool or re-forces the reply tool, the AI goes
 * back to confidently answering medical questions and nothing else would catch it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', 'meal-chat', 'index.ts'), 'utf8');

describe('the system prompt forbids advising', () => {
  it('names the four dangerous territories explicitly', () => {
    for (const topic of ['medical', 'injury', 'weight cutting', 'relationship with food']) {
      expect(SRC.toLowerCase()).toContain(topic.toLowerCase());
    }
  });

  it('tells the model to decline rather than reassure', () => {
    // "Reassure" is the subtle failure: a warm non-answer still reads as an answer.
    expect(SRC).toMatch(/do NOT advise and do NOT reassure/);
    expect(SRC).toMatch(/call flag_for_coach/);
  });
});

describe('the tool contract', () => {
  it('the flag tool exists with a bounded reason set', () => {
    expect(SRC).toContain("name: 'flag_for_coach'");
    for (const r of ['medical', 'injury', 'weight_cutting', 'disordered_eating', 'other']) {
      expect(SRC).toContain(`'${r}'`);
    }
  });

  it('the athlete path OFFERS the flag tool — a forced reply tool cannot decline', () => {
    // 2026-08-06: the athlete path also gained apply_correction (capability-gated), so the tool
    // set is conditional now — but FLAG_TOOL must be present in EVERY branch, or the AI goes
    // back to confidently answering medical questions for exactly the clients that can correct.
    // 2026-09-02: a third gated tool (remember) joined, so the set is built by spreading each
    // optional tool in; FLAG_TOOL is the unconditional last entry whatever the client can do.
    expect(SRC).toMatch(/const athleteTools = \[\s*REPLY_TOOL,\s*\.\.\.\(canApplyCorrection \? \[CORRECTION_TOOL\] : \[\]\),\s*\.\.\.\(canRemember \? \[REMEMBER_TOOL\] : \[\]\),\s*FLAG_TOOL,\s*\]/);
    // The escape hatch is offered on the athlete's QUESTION path and nowhere else. The condition
    // gained correctionUpdate (2026-07-28) and coachAsk (2026-08-06) for the same reason
    // coachSupport was there: those turns have nothing in them to escalate.
    expect(SRC).toMatch(/tool_choice:\s*coachSupport \|\| coachAsk \|\| correctionUpdate\s*\?\s*\{ type: 'tool', name: 'reply' \}\s*:\s*\{ type: 'any' \}/);
  });

  it('only the athlete question path can escalate to a human', () => {
    // Backing a coach's own message, answering a coach's direct question, or confirming a
    // correction the athlete just made, has nothing to escalate; offering the hatch there would
    // let the AI decline to reinforce its own coach, or decline to restate numbers the app has
    // already computed.
    expect(SRC).toMatch(/coachSupport \|\| coachAsk \|\| correctionUpdate \? replyTools : athleteTools/);
  });

  it('the correction tool exists and the model is told to use it instead of arguing', () => {
    // The Core Power failure (2026-08-06): the athlete said the bottle prints 42g and the AI
    // argued with them and told them to update the log themselves. The contract now: the athlete
    // holding the food is better evidence than the log, and corrections apply automatically.
    expect(SRC).toContain("name: 'apply_correction'");
    expect(SRC).toMatch(/NEVER argue with it/);
    expect(SRC).toMatch(/never tell them to update the log or to notify their coach/i);
  });
});

describe('what happens on a flag', () => {
  it('the athlete is TOLD, in the thread, that it was handed over', () => {
    // A silent hand-off reads as the AI ignoring them.
    expect(SRC).toContain("That one's for a person, not me");
    expect(SRC).toMatch(/role: 'ai', kind: 'message', text: declineText/);
  });

  it('a jailbreak cannot spam the coach', () => {
    expect(SRC).toMatch(/meal_flag:\$\{mealRow\.athlete_id\}/);
    expect(SRC).toMatch(/p_limit: 3/);
  });

  it('notifies active staff on the athlete\'s active team only', () => {
    expect(SRC).toMatch(/from\('team_members'\)[\s\S]{0,120}eq\('status', 'active'\)/);
    expect(SRC).toMatch(/from\('team_staff'\)[\s\S]{0,120}eq\('status', 'active'\)/);
  });

  it('a solo athlete still gets the decline — notified simply reports false', () => {
    // The decline is about safety, not about whether anyone is listening.
    expect(SRC).toContain('let notified = false');
    expect(SRC).toMatch(/flagged: reason, notified/);
  });

  it('records the outcome so the flag rate is observable', () => {
    expect(SRC).toContain("phase: 'flagged_for_coach'");
  });
});

describe('model tiering', () => {
  it('meal-chat can move tiers without dragging every other AI surface', () => {
    expect(SRC).toContain("Deno.env.get('ANTHROPIC_MODEL_MEAL_CHAT') ?? Deno.env.get('ANTHROPIC_MODEL')");
  });
});
