import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldLoad, isApplicationEditable, marketplaceGate, tierPriceError, directoryOrder,
} from './marketplace-rules.js';

describe('shouldLoad — the guard that stops the directory crashing the tab', () => {
  test('loads when there is no cache at all', () => {
    assert.equal(shouldLoad(null, 'a|0'), true);
  });
  test('loads when the filter key changed', () => {
    assert.equal(shouldLoad({ key: 'a|0', list: [] }, 'cpt|0'), true);
  });
  test('does NOT load again once the data is in hand', () => {
    assert.equal(shouldLoad({ key: 'a|0', list: [] }, 'a|0'), false);
  });

  /* THE REGRESSION (3277745). window.__render() re-runs mount() synchronously, and mount() calls
     load() unconditionally. At that instant `list` is still null — so a guard that keys off `list`
     alone lets the re-entrant call through, which renders again, which mounts again… unbounded
     synchronous recursion, dead tab, before any response arrives. `loading` is set synchronously
     at the same moment the render fires, which is the only reason the re-entrant call is caught. */
  test('does NOT load while a request is already in flight — the anti-recursion property', () => {
    assert.equal(shouldLoad({ key: 'a|0', list: null, loading: true }, 'a|0'), false);
  });
  test('a guard keyed only on `list` would have recursed — proving `loading` is load-bearing', () => {
    const inFlight = { key: 'a|0', list: null, loading: true };
    assert.equal(!(inFlight.list), true, 'list alone still looks "not loaded" mid-flight');
    assert.equal(shouldLoad(inFlight, 'a|0'), false, 'but shouldLoad must still refuse');
  });
  test('force always reloads, even mid-flight (explicit user retry)', () => {
    assert.equal(shouldLoad({ key: 'a|0', list: [], loading: true }, 'a|0', true), true);
  });
});

describe('isApplicationEditable — never claim someone submitted when they did not', () => {
  test('no application yet is editable', () => {
    assert.equal(isApplicationEditable(null), true);
  });
  test('draft and info_needed are editable', () => {
    assert.equal(isApplicationEditable({ status: 'draft' }), true);
    assert.equal(isApplicationEditable({ status: 'info_needed' }), true);
  });
  test('submitted / under_review / approved / rejected are not', () => {
    for (const s of ['submitted', 'under_review', 'approved', 'rejected']) {
      assert.equal(isApplicationEditable({ status: s }), false, s);
    }
  });

  /* THE REGRESSION (3277745): toggling a credential category rebuilds the object client-side from
     collect(), which carries no `status`. That status-less object read as not-editable and flipped
     a never-submitted application to "Application received". */
  test('an object we just built client-side (no status) is still editable', () => {
    const locallyMerged = { legal_name: 'X', display_name: 'Y', categories: ['accountability', 'cpt'] };
    assert.equal(isApplicationEditable(locallyMerged), true);
  });
});

describe('marketplaceGate — four states, four different honest messages', () => {
  test('loading until the flags land', () => {
    assert.equal(marketplaceGate(null, false), 'loading');
    assert.equal(marketplaceGate({ enabled: true, can_hire: true }, false), 'loading');
  });
  test('off when the switch is off', () => {
    assert.equal(marketplaceGate({ enabled: false, can_hire: true }, true), 'off');
  });
  test('minor when enabled but not allowed to hire', () => {
    assert.equal(marketplaceGate({ enabled: true, can_hire: false }, true), 'minor');
  });
  test('open only when both are true', () => {
    assert.equal(marketplaceGate({ enabled: true, can_hire: true }, true), 'open');
  });
  test('fails closed on a malformed/empty flags payload', () => {
    assert.equal(marketplaceGate({}, true), 'off');
  });
});

describe('tierPriceError — tell the coach now, not at a client’s checkout', () => {
  const bounds = {
    essential: { min_cents: 4900, max_cents: 14900 },
    daily: { min_cents: 9900, max_cents: 29900 },
  };
  test('accepts a price inside the band', () => {
    assert.equal(tierPriceError('essential', 89, bounds), null);
  });
  test('accepts the exact boundaries', () => {
    assert.equal(tierPriceError('essential', 49, bounds), null);
    assert.equal(tierPriceError('essential', 149, bounds), null);
  });
  test('rejects below min and above max', () => {
    assert.match(tierPriceError('essential', 10, bounds), /below/);
    assert.match(tierPriceError('essential', 500, bounds), /above/);
  });
  test('rejects empty / zero / non-numeric', () => {
    for (const v of ['', 0, -5, 'abc', null, undefined]) {
      assert.ok(tierPriceError('essential', v, bounds), String(v));
    }
  });
  test('stays silent on an unknown tier — the server rules on it', () => {
    assert.equal(tierPriceError('platinum', 999, bounds), null);
  });
});

describe('directoryOrder — the no-ranking guarantee', () => {
  /* This test exists to FAIL when someone makes the directory sort by rating or popularity.
     0185 states it plainly: earliest partners first, "stable, fair, and boring on purpose."
     Phase 3 adds reviews for display only — if reviews ever reach the sort, this breaks. */
  test('orders by join date, oldest first', () => {
    const out = directoryOrder([
      { slug: 'c', created_at: '2026-03-01' },
      { slug: 'a', created_at: '2026-01-01' },
      { slug: 'b', created_at: '2026-02-01' },
    ]);
    assert.deepEqual(out.map((l) => l.slug), ['a', 'b', 'c']);
  });
  test('a five-star newcomer does NOT outrank an older unrated coach', () => {
    const out = directoryOrder([
      { slug: 'old-unrated', created_at: '2026-01-01', rating: null, hires: 0 },
      { slug: 'new-5-star', created_at: '2026-06-01', rating: 5, hires: 99 },
    ]);
    assert.equal(out[0].slug, 'old-unrated');
  });
  test('does not mutate the caller’s array', () => {
    const input = [{ slug: 'b', created_at: '2026-02-01' }, { slug: 'a', created_at: '2026-01-01' }];
    directoryOrder(input);
    assert.equal(input[0].slug, 'b');
  });
  test('survives empty/missing input', () => {
    assert.deepEqual(directoryOrder(null), []);
    assert.deepEqual(directoryOrder([]), []);
  });
});
