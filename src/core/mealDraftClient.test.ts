// Proto is plain ESM JS (allowJs). roles.js reads window.sb via an internal sb() helper,
// so we stub globalThis.window = { sb } BEFORE a lazy require of roles.js (same window seam
// mealIntel.test uses for day.js). The supabase client's functions.invoke is a jest.fn so we
// drive the three FunctionsHttpError shapes the wrapper must survive.

const invoke = jest.fn();
const fakeSb = { functions: { invoke } };

// Stub the client the WebView provides before roles.js is loaded.
(globalThis as any).window = { sb: fakeSb };
// @ts-ignore — plain ESM JS, no types
const { draftMealReplies } = require('../../proto/redesign-2026-07/js/roles.js');

beforeEach(() => invoke.mockReset());

describe('roles.draftMealReplies', () => {
  test('returns ok + the four drafts on success', async () => {
    invoke.mockResolvedValue({ data: { drafts: [
      { stance: 'supportive', text: 'Great consistency logging lunch.' },
      { stance: 'direct', text: 'Protein was light, hit 40g at dinner.' },
      { stance: 'context', text: 'What did the rest of your day look like?' },
      { stance: 'followup', text: 'Send me a photo of tomorrow breakfast.' },
    ] }, error: null });
    const r = await draftMealReplies('m1', { meal: {} });
    expect(r.ok).toBe(true);
    expect(r.drafts).toHaveLength(4);
    expect(r.drafts[0].stance).toBe('supportive');
  });

  test('surfaces a limit error parsed off FunctionsHttpError.context.json()', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'limit' }) } } });
    const r = await draftMealReplies('m1', { meal: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('limit');
  });

  test('falls back to unavailable when the error body cannot be parsed', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => { throw new Error('boom'); } } } });
    const r = await draftMealReplies('m1', { meal: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('unavailable');
  });

  test('returns a generic error when the call throws (unreachable)', async () => {
    invoke.mockRejectedValue(new Error('network'));
    const r = await draftMealReplies('m1', { meal: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  test('offline (no mealId) never touches the network', async () => {
    const r = await draftMealReplies('', { meal: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('offline');
    expect(invoke).not.toHaveBeenCalled();
  });
});
