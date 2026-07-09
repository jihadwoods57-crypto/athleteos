// OnStandard — roster read determinism. Proves the roster/weekly-report day reads apply an
// ORDER BY before their .limit backstop, so a roster at the cap can never truncate to an
// arbitrary (per-read-varying) set of athletes. The supabase client is mocked with a chainable
// query builder that records every method call.
import { fetchLinkedDays, fetchLinkedDaysSince } from './queries';

// A thenable query-builder spy: every PostgREST method returns `this` and records its name,
// and awaiting the builder resolves to { data, error } like the real client.
function makeBuilder() {
  const calls: string[] = [];
  const builder: any = {
    calls,
    from: (..._a: unknown[]) => (calls.push('from'), builder),
    select: (..._a: unknown[]) => (calls.push('select'), builder),
    eq: (..._a: unknown[]) => (calls.push('eq'), builder),
    gte: (..._a: unknown[]) => (calls.push('gte'), builder),
    order: (..._a: unknown[]) => (calls.push('order'), builder),
    limit: (..._a: unknown[]) => (calls.push('limit'), builder),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
  };
  return builder;
}

// `mock`-prefixed so the hoisted jest.mock factory may reference it (read lazily at call time).
let mockBuilder: ReturnType<typeof makeBuilder>;
jest.mock('./client', () => ({
  isSupabaseConfigured: true,
  requireSupabase: () => mockBuilder,
}));

beforeEach(() => {
  mockBuilder = makeBuilder();
});

describe('roster day reads are deterministic under the .limit backstop', () => {
  it('fetchLinkedDays orders before limiting', async () => {
    await fetchLinkedDays('2026-07-10');
    expect(mockBuilder.calls).toContain('order');
    // the order must be applied BEFORE the limit, or the cap truncates an unordered set
    expect(mockBuilder.calls.indexOf('order')).toBeLessThan(mockBuilder.calls.indexOf('limit'));
  });

  it('fetchLinkedDaysSince orders (most-recent first) before limiting', async () => {
    await fetchLinkedDaysSince('2026-07-01');
    expect(mockBuilder.calls).toContain('order');
    expect(mockBuilder.calls.indexOf('order')).toBeLessThan(mockBuilder.calls.indexOf('limit'));
  });
});
