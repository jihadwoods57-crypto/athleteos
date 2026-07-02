import { isDraftTool, runCopilotTool, type CopilotContext } from './copilot';
import type { AtRiskInput } from './attention';

const roster: AtRiskInput[] = [
  { name: 'Alice A', score: 55, comp: 50, dir: 'down', proteinMissed: 4, hydrationLow: true },
  { name: 'Bob B', score: 88, comp: 92, dir: 'up' },
  { name: 'Cara C', score: 72, comp: 70, dir: 'flat', checkinDaysAgo: 5 },
];
const ctx: CopilotContext = { roster, scopeLabel: 'Varsity' };

describe('copilot — drafts vs read-only', () => {
  it('marks only draft tools as drafts', () => {
    expect(isDraftTool('draft_message')).toBe(true);
    expect(isDraftTool('draft_report')).toBe(true);
    expect(isDraftTool('who_needs_attention')).toBe(false);
  });

  it('a drafted message has local status and no send capability in the shape', () => {
    const r = runCopilotTool({ tool: 'draft_message', athleteName: 'Alice A', intent: 'nudge' }, ctx);
    expect(r.isDraft).toBe(true);
    expect((r.data as { status: string }).status).toBe('local');
    expect((r.data as { body: string }).body.toLowerCase()).toContain('alice');
  });
});

describe('copilot — never leaks an athlete outside the scoped roster', () => {
  it('grounding only ever lists athletes from ctx.roster', () => {
    for (const tool of ['who_needs_attention', 'summarize_nutrition', 'positive_trends', 'predict_falling_behind'] as const) {
      const r = runCopilotTool({ tool }, ctx);
      for (const n of r.grounding) expect(roster.map((a) => a.name)).toContain(n);
    }
  });

  it('draft_message refuses an athlete not in the roster', () => {
    const r = runCopilotTool({ tool: 'draft_message', athleteName: 'Nobody' }, ctx);
    expect((r.data as { error?: string }).error).toBeDefined();
    expect(r.grounding).toEqual([]);
  });
});

describe('copilot — deterministic tool outputs', () => {
  it('narration is always null in the pure layer (the model fills it downstream)', () => {
    expect(runCopilotTool({ tool: 'who_needs_attention' }, ctx).narration).toBeNull();
  });

  it('who_missed filters by the metric', () => {
    const protein = runCopilotTool({ tool: 'who_missed', metric: 'protein' }, ctx);
    expect(protein.grounding).toEqual(['Alice A']);
    const checkin = runCopilotTool({ tool: 'who_missed', metric: 'checkin' }, ctx);
    expect(checkin.grounding).toEqual(['Cara C']);
  });

  it('summarize_nutrition reports counts from the roster only', () => {
    const s = runCopilotTool({ tool: 'summarize_nutrition' }, ctx).data as { count: number; needIntervention: number };
    expect(s.count).toBe(3);
    expect(s.needIntervention).toBeGreaterThanOrEqual(1); // Alice below threshold
  });

  it('predict_falling_behind labels itself a trend, not a prediction', () => {
    const d = runCopilotTool({ tool: 'predict_falling_behind' }, ctx).data as { basis: string };
    expect(d.basis).toContain('trend');
  });
});
