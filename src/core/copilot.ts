// OnStandard core — Coach Copilot tool catalog (doc-05 §6). PURE, framework-agnostic, no network.
//
// The Copilot is a natural-language FRONT DOOR to the deterministic engines, plus a drafting layer.
// The model's only job is to pick a tool, fill its parameters, and NARRATE the result — it never
// fetches data and never re-ranks or rewrites the deterministic output. Every tool here runs an
// existing src/core engine over the RLS-scoped roster the edge function already authorized
// (membership.canView upstream), and returns a CopilotResult whose `data` is the SOURCE OF TRUTH.
// `narration` is filled by the model later (in the edge function), never here.
//
// Drafts never send (§6.2): draft_message / draft_report produce an artifact a coach must act on;
// isDraft marks them. Sending is a separate, human, permissioned action — the Copilot has no send.

import { needsAttention, rankByRisk, type AtRisk, type AtRiskInput } from './attention';
import { composeMessage } from './messaging';
import { COACH_ALERT_THRESHOLD } from './leaderboard';

export type CopilotTool =
  | 'who_needs_attention'
  | 'who_missed'
  | 'summarize_nutrition'
  | 'positive_trends'
  | 'predict_falling_behind'
  | 'draft_message'
  | 'draft_report';

export interface CopilotResult {
  tool: CopilotTool;
  /** The deterministic engine output — the source of truth. The UI shows this even if narration is null. */
  data: unknown;
  /** LLM phrasing over `data`; null until the model fills it (and null when unconfigured). */
  narration: string | null;
  /** True for any artifact a coach must act on to send. */
  isDraft: boolean;
  /** Which athletes/metrics the answer is computed from (transparency). */
  grounding: string[];
}

/** Tools that produce a draft a human must send. Everything else is a read-only answer. */
export const DRAFT_TOOLS: readonly CopilotTool[] = ['draft_message', 'draft_report'];
export function isDraftTool(tool: CopilotTool): boolean {
  return DRAFT_TOOLS.includes(tool);
}

export type MissedMetric = 'protein' | 'hydration' | 'weight' | 'checkin' | 'logging';

export interface CopilotQuery {
  tool: CopilotTool;
  /** For who_missed. */
  metric?: MissedMetric;
  /** For draft_message: the target athlete (must be within the scoped roster). */
  athleteName?: string;
  /** For draft_message: what the coach wants to say (recognition / nudge / check-in). */
  intent?: 'recognition' | 'nudge' | 'checkin';
}

/** The roster the coach is authorized to see — built upstream from allowed()/canView rows. */
export interface CopilotContext {
  roster: AtRiskInput[];
  scopeLabel?: string;
}

const names = (list: { name: string }[]): string[] => list.map((a) => a.name);

function missedBy(roster: AtRiskInput[], metric: MissedMetric): AtRiskInput[] {
  switch (metric) {
    case 'protein': return roster.filter((a) => typeof a.proteinMissed === 'number' && a.proteinMissed >= 2);
    case 'hydration': return roster.filter((a) => a.hydrationLow === true);
    case 'weight': return roster.filter((a) => a.weightStalled === true);
    case 'checkin': return roster.filter((a) => typeof a.checkinDaysAgo === 'number' && a.checkinDaysAgo >= 3);
    case 'logging': return roster.filter((a) => a.comp < 60);
  }
}

export interface NutritionSummary {
  count: number;
  avgScore: number;
  avgCompliance: number;
  onStandard: number;   // score >= alert threshold
  onTheBubble: number;  // within 10 of the threshold, at or above it
  needIntervention: number; // below the threshold
}

function summarize(roster: AtRiskInput[]): NutritionSummary {
  const count = roster.length;
  const avg = (sel: (a: AtRiskInput) => number) => (count ? Math.round(roster.reduce((s, a) => s + sel(a), 0) / count) : 0);
  const t = COACH_ALERT_THRESHOLD;
  return {
    count,
    avgScore: avg((a) => a.score),
    avgCompliance: avg((a) => a.comp),
    onStandard: roster.filter((a) => a.score >= t).length,
    onTheBubble: roster.filter((a) => a.score >= t && a.score < t + 10).length,
    needIntervention: roster.filter((a) => a.score < t).length,
  };
}

/** Build the deterministic draft-message text for an athlete + intent. Prose only; no numbers invented. */
function draftMessageText(name: string, intent: CopilotQuery['intent']): string {
  const first = name.split(' ')[0] || name;
  switch (intent) {
    case 'nudge': return `${first}, let's lock in today's meals — a couple of on-time logs gets you right back on standard.`;
    case 'checkin': return `${first}, checking in — how are things going with the plan this week? Reply and let me know where you're at.`;
    case 'recognition':
    default: return `${first}, strong work staying on standard — keep stacking days like this.`;
  }
}

/**
 * Run a Copilot tool deterministically over the scoped roster. Returns the CopilotResult frame with
 * `data` = the engine output and `narration` = null (the model adds narration downstream). Every
 * result is computed only from `ctx.roster` (the authorized set), so an unauthorized athlete can
 * never appear in `data` or `grounding`.
 */
export function runCopilotTool(query: CopilotQuery, ctx: CopilotContext): CopilotResult {
  const frame = (data: unknown, grounding: string[]): CopilotResult => ({
    tool: query.tool, data, narration: null, isDraft: isDraftTool(query.tool), grounding,
  });

  switch (query.tool) {
    case 'who_needs_attention': {
      const list: AtRisk[] = needsAttention(ctx.roster);
      return frame(list, names(list));
    }
    case 'who_missed': {
      const metric = query.metric ?? 'protein';
      const list = missedBy(ctx.roster, metric);
      return frame({ metric, athletes: list }, names(list));
    }
    case 'summarize_nutrition':
      return frame(summarize(ctx.roster), names(ctx.roster));
    case 'positive_trends': {
      const list = [...ctx.roster].filter((a) => a.dir === 'up').sort((a, b) => b.score - a.score);
      return frame(list, names(list));
    }
    case 'predict_falling_behind': {
      // v1 is a DETERMINISTIC trend slope, labeled as such — not a learned prediction (doc-05 §6.1).
      const list = rankByRisk(ctx.roster).filter((a) => a.dir === 'down');
      return frame({ basis: 'recent trend, not a prediction', athletes: list }, names(list));
    }
    case 'draft_message': {
      const target = ctx.roster.find((a) => a.name === query.athleteName);
      if (!target) return frame({ error: 'athlete not in your roster' }, []);
      const text = composeMessage(draftMessageText(target.name, query.intent)) ?? '';
      return frame({ athlete: target.name, intent: query.intent ?? 'recognition', status: 'local', body: text }, [target.name]);
    }
    case 'draft_report': {
      const s = summarize(ctx.roster);
      const scope = ctx.scopeLabel ?? 'your group';
      const body = `${scope}: ${s.count} athletes, avg score ${s.avgScore}, ${s.avgCompliance}% compliance. ` +
        `${s.onStandard} on standard, ${s.needIntervention} need intervention.`;
      return frame({ scope, status: 'draft', summary: s, body }, names(ctx.roster));
    }
  }
}
