// OnStandard — the Assistant Nutritionist's daily brief (pure TS, no RN imports).
//
// The premium coach/trainer experience is not a dashboard, it is a BRIEFING: the assistant
// already reviewed every athlete and opens with what matters — who needs you, who deserves a
// word, and why. This module is the deterministic half: it assembles the brief entirely from
// the engines that already computed the day (needsAttention, teamWeeklyReport, coachRosterKpis,
// nudgeMessageFor), composes an honest plain-English brief text, and hands back a bounded data
// payload + role directive for the optional AI narration layer (lib/ai/assist 'daily_brief').
// The AI may REPHRASE this brief in a warmer staff voice; it can never add a fact, because
// every fact ships from here.
//
// Role split (the tailoring ruling):
//   * coach   — accountability across a team: who needs attention before practice, who
//               deserves recognition, what is dragging the group.
//   * trainer — a book of PAYING clients: who is going quiet (retention risk), who is
//               progressing (proof of value), then the accountability read.
import { daysQuiet, needsAttention, type AtRisk, type AtRiskInput } from './attention';
import { nudgeMessageFor } from './nudge';
import type { ReportScope, TeamWeeklyReport } from './weeklyReport';

export type BriefRole = 'coach' | 'trainer';

/** One triage entry: a decision the coach/trainer can act on with one tap. */
export interface BriefAction {
  kind: 'message' | 'recognize';
  name: string;
  athleteId?: string;
  score: number;
  comp: number;
  /** The deterministic evidence line (why this made the list). */
  reason: string;
  /** The prefilled outreach: a supportive nudge, or the praise line. */
  suggestion: string;
  tone: 'alert' | 'warning' | 'praise';
}

export interface AssistantBrief {
  role: BriefRole;
  /** The deterministic brief text — always rendered; AI narration may replace the PHRASING only. */
  text: string;
  /** The "handle these today" queue (worst-first, max 3). */
  actions: BriefAction[];
  /** The praise lane (blue temperature), separate from the urgent queue. */
  praise: BriefAction[];
  /** The demoted KPI strip. */
  kpis: { avgScore: number; compliance: number; alerts: number; total: number };
  /** Every athlete name the brief mentions (narration grounding/transparency). */
  grounding: string[];
  /** Bounded payload for the 'daily_brief' narration task. */
  narrationData: Record<string, unknown>;
  /** The role voice the model narrates in. */
  directive: string;
}

/** Cap on the triage queue: a briefing is three decisions, not a backlog. */
export const BRIEF_MAX_ACTIONS = 3;

const first = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** The praise prefill: recognition a coach can send in one tap. Supportive, specific,
 *  no hype, no em dash. */
export function praiseMessageFor(name: string, score: number): string {
  return `${first(name)}, saw your week. ${score} and climbing is what the standard looks like. Keep stacking days.`;
}

/**
 * The trainer's proof-of-value message: a client-facing progress note built ONLY from the
 * row the dashboard shows (score, compliance, direction), scope-labeled so one day is never
 * dressed as a week. This is the retention lever a trainer sends to justify the fee —
 * factual, warm, no hype, no em dash.
 */
export function clientResultText(
  c: { name: string; score: number; comp: number; dir: 'up' | 'down' | 'flat' },
  scope: ReportScope,
): string {
  const span = scope === 'week' ? 'this week' : 'today';
  const trend = c.dir === 'up' ? 'and trending up' : c.dir === 'down' ? 'with room to climb' : 'holding steady';
  return `${first(c.name)}, your OnStandard update: execution score ${c.score} ${span}, ${c.comp}% on plan, ${trend}. This is the work adding up. Proud of it.`;
}

const COACH_DIRECTIVE =
  'You are the team\'s Assistant Nutritionist giving the head coach his morning brief before ' +
  'practice. Speak directly to the coach in first person, like a trusted staff member: what you ' +
  'reviewed, who needs him and why, who deserves a word. Plain, specific, zero hype.';

const TRAINER_DIRECTIVE =
  'You are the Assistant Nutritionist for an independent trainer whose clients each PAY for ' +
  'coaching. Brief them like a practice manager: lead with any client going quiet (that is how ' +
  'paying clients drift away), then who is progressing and worth a proud message, then the ' +
  'compliance read. Warm, professional, zero hype.';

/** Quiet-client read for the trainer's retention lead: 2+ days without a log. */
function quietClients(roster: AtRiskInput[]): { name: string; days: number; athleteId?: string }[] {
  return roster
    .map((r) => ({ name: r.name, days: daysQuiet(r.last) ?? -1, athleteId: r.athleteId }))
    .filter((q) => q.days >= 2)
    .sort((a, b) => b.days - a.days);
}

/** Human list join: "Kam", "Kam and Lewis", "Kam, Lewis and TJ". */
function joinNames(names: string[]): string {
  const f = names.map(first);
  if (f.length <= 1) return f[0] ?? '';
  return `${f.slice(0, -1).join(', ')} and ${f[f.length - 1]}`;
}

function actionFromRisk(a: AtRisk): BriefAction {
  return {
    kind: 'message',
    name: a.name,
    athleteId: a.athleteId,
    score: a.score,
    comp: a.comp,
    reason: a.reason,
    suggestion: nudgeMessageFor(a),
    tone: a.tone,
  };
}

/**
 * Build the daily brief. Deterministic and total: an empty roster, an all-clear day, and a
 * crisis day each produce an honest brief. RosterRow satisfies AtRiskInput, so the caller
 * passes the same rows the dashboard already computed — no new fetches.
 */
export function buildAssistantBrief(opts: {
  role: BriefRole;
  roster: AtRiskInput[];
  report: TeamWeeklyReport;
  scope: ReportScope;
}): AssistantBrief {
  const { role, roster, report, scope } = opts;
  const total = roster.length;
  const risks = needsAttention(roster);
  const actions = risks.slice(0, BRIEF_MAX_ACTIONS).map(actionFromRisk);

  // Praise: the best mover, only when they genuinely cleared the bar — recognition is
  // earned here, never manufactured to fill the lane.
  const praise: BriefAction[] = [];
  const mi = report.mostImproved;
  if (mi && mi.score >= 80) {
    const row = roster.find((r) => r.name === mi.name);
    praise.push({
      kind: 'recognize',
      name: mi.name,
      athleteId: row?.athleteId,
      score: mi.score,
      comp: row?.comp ?? mi.score,
      reason: scope === 'week' ? `Best mover this week at ${mi.score}` : `Best mover today at ${mi.score}`,
      suggestion: praiseMessageFor(mi.name, mi.score),
      tone: 'praise',
    });
  }

  const kpis = { avgScore: report.avgScore, compliance: report.compliance, alerts: risks.length, total };
  const quiet = role === 'trainer' ? quietClients(roster) : [];

  // ---------------------------------------------------------------- deterministic text
  const span = scope === 'week' ? 'this week' : 'today';
  const noun = role === 'trainer' ? 'client' : 'athlete';
  let text: string;
  if (total === 0) {
    text =
      role === 'trainer'
        ? 'No clients on your book yet. Share your practice code and your first brief starts building.'
        : 'No athletes on your roster yet. Share your team code and your first brief starts building.';
  } else {
    const reviewed = total === 1 ? `Reviewed your ${noun}` : `Reviewed all ${total} ${noun}s`;
    const opener = `${reviewed}. Team average ${report.avgScore}, ${report.compliance}% on plan ${span}.`;
    const parts: string[] = [opener];
    if (role === 'trainer' && quiet.length > 0) {
      parts.push(
        `${joinNames(quiet.map((q) => q.name))} ${quiet.length === 1 ? 'has' : 'have'} gone quiet (${quiet[0].days}+ days without a log). Quiet is how paying clients drift; a check-in now usually restarts them.`,
      );
    }
    if (actions.length > 0) {
      parts.push(
        `${joinNames(actions.map((a) => a.name))} ${actions.length === 1 ? 'needs' : 'need'} you ${span === 'this week' ? 'this week' : 'before practice'}. Messages are ready below.`,
      );
    } else if (quiet.length === 0) {
      parts.push('Nobody is below the line. Rare day, enjoy it.');
    }
    if (praise.length > 0) {
      parts.push(`${first(praise[0].name)} is your best mover at ${praise[0].score}. Worth a word.`);
    }
    text = parts.join(' ');
  }

  const grounding = [
    ...actions.map((a) => a.name),
    ...praise.map((p) => p.name),
    ...quiet.map((q) => q.name),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  // Bounded payload the model narrates over — nothing beyond what the text already carries.
  const narrationData = {
    role,
    scope,
    total,
    kpis,
    headline: report.headline,
    moved: report.movedLine,
    needs_attention: actions.map((a) => ({ name: a.name, score: a.score, reason: a.reason })),
    praise: praise.map((p) => ({ name: p.name, score: p.score })),
    ...(role === 'trainer' ? { quiet_clients: quiet.map((q) => ({ name: q.name, days: q.days })) } : {}),
  };

  return {
    role,
    text,
    actions,
    praise,
    kpis,
    grounding,
    narrationData,
    directive: role === 'trainer' ? TRAINER_DIRECTIVE : COACH_DIRECTIVE,
  };
}
