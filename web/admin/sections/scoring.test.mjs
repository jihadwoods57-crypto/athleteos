import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* scoring.js imports ../ui.js, which imports ./api.js, which reads `window.supabase` and calls
   document.createElement at MODULE LOAD TIME / render time (ui.js's h() is a real-DOM helper — see
   its own header comment). Static `import`s at the top of this file would be hoisted ahead of any
   stub we set, so a plain `node --test` (no `window`/`document`) throws before anything is ever
   read or rendered. Stand up a real (jsdom) DOM first, stub the one shape api.js touches, THEN
   import dynamically so both are in place before scoring.js's module body runs. This lets the test
   below do more than compare constants — it can call the page's own render() and read real text. */
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.window.supabase = { createClient: () => ({}) };

const scoringSection = await import('./scoring.js');
const { PROFILE_WEIGHTS: ADMIN_WEIGHTS, WEIGHT_CAPS: ADMIN_CAPS } = scoringSection;
const { PROFILE_WEIGHTS: ENGINE_WEIGHTS, WEIGHT_CAPS: ENGINE_CAPS } = await import('../../../proto/redesign-2026-07/js/plan-style.js');

/* The Command Center exists to make the formula INSPECTABLE. An admin reading stale weights (or a
   stale ceiling) is worse than no page at all, so this pins both imports to the shipped engine.
   NOTE: because scoring.js re-exports rather than recomputes, this half only proves "still wired
   via re-export" — it would catch a revert to a literal or a broken/missing export, but it cannot
   by itself prove the engine's math is correct (that's scoreParity/planStyleCaps's job upstream).
   The render test below is what actually proves the PAGE'S OWN COPY (captions, ceiling rows,
   contradiction-catalog prose) tracks these numbers instead of hardcoding its own — deep-equal on
   the constants alone would not have caught a hardcoded '78%' sitting next to an imported 0.78. */
test('the admin scoring page shows the engine\'s real weights', () => {
  assert.deepEqual(ADMIN_WEIGHTS, ENGINE_WEIGHTS);
});
test('the admin scoring page shows the engine\'s real evidence caps', () => {
  assert.deepEqual(ADMIN_CAPS, ENGINE_CAPS);
});

test('every printed percentage on the page is COMPUTED from the imported weights/caps, not typed', () => {
  const view = document.createElement('div');
  scoringSection.default.render(view);
  const text = view.textContent;

  // Independently computed here (not imported from scoring.js) so this can't pass by construction.
  const pct = (v) => Math.round(v * 100) + '%';
  const recoveryPillarPct = (w) => pct(w.checkin + w.recovery);

  for (const profile of ['athlete', 'general', 'gain']) {
    const w = ENGINE_WEIGHTS[profile];
    assert.ok(text.includes(`Nutrition${pct(w.nutrition)}`), `${profile} nutrition bar`);
    assert.ok(text.includes(`Checked in tonight${pct(w.checkin)}`), `${profile} checkin bar`);
    assert.ok(text.includes(`Answers${pct(w.recovery)}`), `${profile} recovery bar`);
    assert.ok(text.includes(`ONE Recovery pillar (${recoveryPillarPct(w)})`), `${profile} pillar caption`);
  }

  // General is nutrition-capped; athlete/gain sit at the shared floor with recovery at its cap.
  assert.ok(text.includes(`pushing nutrition to its ${pct(ENGINE_CAPS.nutrition)} cap`));
  assert.ok(text.includes(`${pct(ENGINE_WEIGHTS.athlete.nutrition)} nutrition floor / ${pct(ENGINE_WEIGHTS.athlete.recovery)} recovery cap`));

  // The evidence-ceiling card.
  assert.ok(text.includes(`Nutrition (max)${pct(ENGINE_CAPS.nutrition)}`));
  assert.ok(text.includes(`Real check-in (max)${recoveryPillarPct(ENGINE_CAPS)} — checkin (${pct(ENGINE_CAPS.checkin)}) + recovery (${pct(ENGINE_CAPS.recovery)}) combined`));

  // The contradiction-catalog entry repeats the same ceiling numbers in prose — same drift risk.
  assert.ok(text.includes(`nutrition ${pct(ENGINE_CAPS.nutrition)} / a real check-in ${recoveryPillarPct(ENGINE_CAPS)}`));
});
