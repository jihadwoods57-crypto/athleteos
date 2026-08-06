/* Coach Marketplace — the pure decisions, lifted out of the screens so they can be TESTED.
 *
 * Every rule in here was a shipped bug first. The screens are render-string + mount() closures over
 * module-level mutable state, which means nothing in them was importable in Node and nothing was
 * covered. Three of the four functions below encode a regression that reached production:
 *
 *   shouldLoad      — coach-directory recursed infinitely and CRASHED THE TAB (fixed 3277745)
 *   isApplicationEditable — coach-apply flipped to "Application received" before you ever submitted
 *   tierPriceError  — the listing editor published with no prices at all
 *
 * They are deliberately dependency-free (no DOM, no supabase, no imports) so `node --test` can run
 * them, matching the sync-queue.js / status.js / priority.js convention.
 */

/* ---------------------------------------------------------------- directory load guard
 * THE CRASH: load() calls window.__render() BEFORE its first await, and window.__render() re-runs
 * mount() SYNCHRONOUSLY, and mount() calls load() unconditionally. With a guard that keys off
 * `list` (only truthy once data ARRIVES) the re-entrant call passed straight through — render →
 * mount → load → render → … with no await between them to yield. Unbounded synchronous recursion:
 * the tab died before a single network response landed.
 *
 * The fix is that `loading` is set synchronously at the same moment the render is triggered, so the
 * re-entrant call sees it. Keep that property: any guard that can only become true ASYNCHRONOUSLY
 * reintroduces the crash. */
export function shouldLoad(cache, key, force) {
  if (force) return true;
  if (!cache) return true;
  if (cache.key !== key) return true;         // a different filter — always refetch
  return !(cache.list || cache.loading);      // already have it, or already asking
}

/* ---------------------------------------------------------------- application editability
 * THE BUG: the category toggle rebuilds G.app locally from collect(), which has no `status` field.
 * A brand-new application therefore went from null (editable) to a status-LESS object, and a plain
 * `a.status === 'draft'` check read that as not-editable — silently showing "Application received"
 * to someone who had never submitted. Treat a missing status as a draft: an object we built
 * ourselves client-side has not been anywhere near the server. */
export function isApplicationEditable(app) {
  if (!app) return true;                      // nothing saved yet — the form is the only state
  const status = app.status || 'draft';
  return status === 'draft' || status === 'info_needed';
}

/* ---------------------------------------------------------------- the marketplace gate
 * Four distinct states, because "don't show it" has four different honest explanations and the
 * screen says something different for each. Never collapse these into a boolean. */
export function marketplaceGate(flags, loaded) {
  if (!loaded) return 'loading';
  const f = flags || {};
  if (!f.enabled) return 'off';               // switch off / not allowlisted
  if (!f.can_hire) return 'minor';            // adults only, and unknown age fails CLOSED
  return 'open';
}

/* ---------------------------------------------------------------- tier price bounds
 * Mirrors marketplace-checkout's server check so a coach is told NOW, not 409'd at a client's
 * checkout weeks later. The server is still the authority — this only buys a better error.
 * Returns null when fine, else a human sentence. */
export function tierPriceError(tier, dollars, bounds) {
  const b = (bounds || {})[tier];
  if (!b) return null;                        // unknown tier: let the server rule on it
  const n = Number(dollars);
  if (!Number.isFinite(n) || n <= 0) return 'Set a price for every plan.';
  const cents = Math.round(n * 100);
  const min = b.min_cents, max = b.max_cents;
  if (min != null && cents < min) return `That's below the $${min / 100} minimum for this plan.`;
  if (max != null && cents > max) return `That's above the $${max / 100} maximum for this plan.`;
  return null;
}

/* ---------------------------------------------------------------- directory ordering
 * A FOUNDER DECISION WITH A TEST BEHIND IT (0185): the directory is ordered by when a coach joined,
 * never by rating, popularity, or price. With a tiny partner pool, ratings are statistically
 * meaningless and trivially de-anonymised, and popularity ranking is a rich-get-richer ratchet that
 * would quietly decide who gets hired. Phase 3 adds reviews for DISPLAY only — if a future change
 * makes this function sort by anything else, the test that covers it should fail loudly. */
export function directoryOrder(listings) {
  return [...(listings || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}
