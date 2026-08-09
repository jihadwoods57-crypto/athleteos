import test from 'node:test';
import assert from 'node:assert/strict';

/* scoring.js imports ../ui.js, which imports ./api.js, which reads `window.supabase` at MODULE
   LOAD TIME (the vendored supabase-js global the browser sets via a classic <script> before this
   module runs — see api.js's own comment). A static `import` at the top of this file would be
   hoisted ahead of any stub we set, so node --test (no `window`) throws before either export is
   ever read. Stub the one shape api.js touches, then import dynamically so the stub runs first —
   this test only needs the PROFILE_WEIGHTS export, never a live client. */
globalThis.window = { supabase: { createClient: () => ({}) } };

const { PROFILE_WEIGHTS: ADMIN_WEIGHTS } = await import('./scoring.js');
const { PROFILE_WEIGHTS: ENGINE_WEIGHTS } = await import('../../../proto/redesign-2026-07/js/plan-style.js');

/* The Command Center exists to make the formula INSPECTABLE. An admin reading stale weights is
   worse than no page at all, so this pins it to the shipped engine. */
test('the admin scoring page shows the engine\'s real weights', () => {
  assert.deepEqual(ADMIN_WEIGHTS, ENGINE_WEIGHTS);
});
