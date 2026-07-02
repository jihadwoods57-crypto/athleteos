import { CONFIDENCE_FLOOR, assistFallback, defaultGuardrails, type ContextPack } from './assist';
import { DEFAULT_PERSONALITY } from './personality';

const pack = (): ContextPack => ({
  scoring: {},
  profile: {},
  memory: [],
  signals: {},
  personality: DEFAULT_PERSONALITY,
  guardrails: defaultGuardrails(false),
});

describe('assistFallback — deterministic, never invents', () => {
  it('returns the deterministic input as the output and marks usedFallback', () => {
    const input = { name: 'Chicken & Rice', protein: 42 };
    const r = assistFallback('meal_analysis', pack(), input);
    expect(r.usedFallback).toBe(true);
    expect(r.output).toBe(input); // passthrough — the value the app already computed
    expect(r.task).toBe('meal_analysis');
  });

  it('handles a null/absent input without throwing', () => {
    expect(assistFallback('copilot_query', pack(), undefined).output).toBeNull();
    expect(assistFallback('copilot_query', pack(), null).output).toBeNull();
  });
});

describe('defaultGuardrails', () => {
  it('carries the minor flag, the confidence floor, and any disclaimers', () => {
    const g = defaultGuardrails(true, ['not medical advice']);
    expect(g.isMinor).toBe(true);
    expect(g.confidenceFloor).toBe(CONFIDENCE_FLOOR);
    expect(g.disclaimers).toContain('not medical advice');
  });

  it('defaults disclaimers to empty', () => {
    expect(defaultGuardrails(false).disclaimers).toEqual([]);
  });
});
