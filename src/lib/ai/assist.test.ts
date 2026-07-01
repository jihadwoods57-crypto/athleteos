import { isAssistConfigured, runCopilot } from './assist';
import type { CopilotContext } from '@/core';

const ctx: CopilotContext = {
  roster: [
    { name: 'Alice A', score: 50, comp: 40, dir: 'down', proteinMissed: 5 },
    { name: 'Bob B', score: 90, comp: 95, dir: 'up' },
  ],
};

describe('runCopilot (client wiring)', () => {
  it('is unconfigured in the test env (no backend)', () => {
    expect(isAssistConfigured).toBe(false);
  });

  it('returns deterministic data with null narration when unconfigured, and never throws', async () => {
    const r = await runCopilot({ tool: 'who_needs_attention' }, ctx);
    expect(r.tool).toBe('who_needs_attention');
    expect(r.narration).toBeNull();          // no model available -> deterministic only
    expect(Array.isArray(r.data)).toBe(true); // the at-risk list is the source of truth
    expect((r.data as { name: string }[])[0].name).toBe('Alice A');
  });

  it('surfaces a draft with local status, still no send', async () => {
    const r = await runCopilot({ tool: 'draft_message', athleteName: 'Alice A', intent: 'nudge' }, ctx);
    expect(r.isDraft).toBe(true);
    expect((r.data as { status: string }).status).toBe('local');
  });
});
