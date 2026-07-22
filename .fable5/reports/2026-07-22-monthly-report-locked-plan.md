# Plan — Monthly Report locked state: honest, actionable upsell

Branch: `fable5/2026-07-22-onstandard-launch-ready-audit` (never merged; founder integrates).
Scope: presentation + routing only in the proto WebView (the shipped UI). No schema / billing / RLS / edge-fn / test changes.
Design source: `.fable5/reports/2026-07-22-monthly-report-locked-design.md`, prototype artifact db75a3cb.

## Feasibility: YES
Every input the design asks for already exists client-side and every reused block/route is already registered:
- `buildMonthPayload(days, period)` (monthly.js:4) computes the exact stats `reportBody` shows — avgScore, bestDay, worstDay, weightStart/End, streakBest, loggedDays. Today `load()` (monthly-report.js:33) builds this `payload`, passes it to the fetch, then DISCARDS it. The fix keeps it in CACHE so the locked branch can render real stats.
- `.bigstat` (screens.css:268) + `.base-stats` (screens.css:787) are the exact blocks `reportBody()` uses (monthly-report.js:123) — reuse verbatim.
- Locked detection already exists: `isUpgrade = report.error && /requires a plan/i.test(...)` (monthly-report.js:180). We rebuild the branch it renders (`upgradeCard()`), nothing else about detection changes.
- Analytics vocabulary already has `PAYWALL_VIEWED` and `TRIAL_STARTED` (analytics.js:34,36); `track`/`EVENTS` import pattern proven in ob2-athlete.js:27,443,501.
- redeem-code screen is registered (`'redeem-code'` index.js:145) and unlocks premium today — route via `data-go="redeem-code"`.
- Display-only price `$10.50` is `PLANS.individual[0].annualPer` (ob2.js:255). Use as a static string; do NOT import PLANS just for one literal unless the builder prefers — a hardcoded "$10.50/mo" with a code comment citing ob2.js is acceptable and avoids a new import cycle. Builder's call; keep it labeled "display only".
- No client-side premium getter exists (grep of state.js/roles.js found none), so the Progress teaser Premium badge renders unconditionally — honest, since the feature is premium regardless of the viewer's entitlement.

## Files to modify (2)
1. `proto/redesign-2026-07/js/screens/monthly-report.js` — the whole change lives here.
   - Add import: `import { track, EVENTS } from '../analytics.js';`
   - `CACHE`: add `payload: null` and `paywallFired: false`.
   - `load()`: after `const payload = buildMonthPayload(...)`, store `CACHE.payload = payload;` (keep existing fetch/assignment).
   - Rewrite `upgradeCard()` → `lockedCard(payload, period)`: renders the REAL `.bigstat` (avgScore + "Average score") + month/loggedDays subline + the 4-cell `.base-stats` (Best day / Worst day / Weight change / Best streak) using the SAME derivations as `reportBody` (factor the weightChange + statBlock helpers so both call sites share them — no divergence). Then an eyebrow "Coach's take" over a frosted veil block (locked AI narrative teaser) + a green primary "Start free trial" button (`id="mr-trial"`, sublabel "$10.50/mo · display only, no card yet") + a blue "Have a sponsor code?" row (`data-go="redeem-code"`, mirrors profile.js:124 styling) that routes to the one path that unlocks today.
   - `render()`: locked branch calls `lockedCard(CACHE.payload, period)` instead of `upgradeCard()`.
   - `mount()`: after `load()`, when the resolved state is locked and `!CACHE.paywallFired`, fire `track(EVENTS.PAYWALL_VIEWED, { variant: 'monthly_report' })` once and set the flag. Wire `#mr-trial` click → `track(EVENTS.TRIAL_STARTED, { plan: 'individual', cadence: 'month' })` (intent-only; no navigation/billing). `#mr-share` wiring stays for the unlocked branch. Note: `mount` runs synchronously before the async `load()` resolves; fire PAYWALL_VIEWED from inside `load()`'s post-fetch path (or a tiny re-check after `window.__render`) so it fires on the actual locked render, guarded by `paywallFired`.
2. `proto/redesign-2026-07/js/screens/progress.js` (line 138-141) — add a blue `<span class="status-pill b">Premium</span>` into the `data-go="monthly-report"` sidebox teaser row so it reads as premium before the tap. Layout-only; row still routes the same.

## Frosted veil (signature element)
Add a small scoped CSS block (in `css/screens.css`, near `.base-stats`) for the locked "Coach's take": a card containing 2–3 blurred placeholder text lines (`filter: blur(6px)` — precedent app.css:203 / screens.css:170) with a centered lock glyph + "Unlock your coach's take" caption over it, theme-aware (reuse existing tokens/`status-pill.muted`). No real narrative text is ever rendered in the locked state (it isn't fetched when gated), so the veil is honest — it hides a genuinely absent-to-this-user section, not fake content.

## Data / APIs / migrations
- Data changes: none. Stats are the already-computed client `payload`; no new fields, no fetch changes.
- APIs: none added. Reuses `roles.fetchMonthlyReport` (unchanged), `track()` (existing), redeem-code route (existing).
- Migrations: none. (No schema/RLS/billing touched — nothing to propose.)

## Risks
- PAYWALL_VIEWED double-fire on re-render → guard with `CACHE.paywallFired`; fire only on the locked branch after fetch resolves.
- TRIAL_STARTED must stay intent-only — no route change, no billing call — or it over-promises (billing is go-live gated). Button copy must say the price is display-only / no card yet (honesty gate).
- weightChange + statBlock logic must be shared between locked and unlocked bodies, or the two drift.
- Empty/error months: locked card must degrade like `reportBody` (— placeholders) when `payload` aggregates are null; loading and non-plan `error` states unchanged.
- Analytics sink is inert unless `window.__ANALYTICS_SINK` is set (analytics.js:153) — events buffer locally, no PII; safe by construction.
- Proto is the shipped UI: after editing, the build must rebuild proto.zip + protoVersion.ts (verify + expo export in the gate).

## Ordered steps
1. Refactor `weightChange`/`statBlock` in monthly-report.js into shared helpers used by both bodies.
2. Add `payload`/`paywallFired` to CACHE; persist `CACHE.payload` in `load()`.
3. Build `lockedCard(payload, period)`: real `.bigstat` + `.base-stats` + frosted "Coach's take" veil + green trial CTA + blue sponsor-code row.
4. Add the frosted-veil CSS to screens.css (theme-aware, existing tokens).
5. Import `track`/`EVENTS`; fire PAYWALL_VIEWED once on locked render (guarded); wire `#mr-trial` → TRIAL_STARTED (intent-only).
6. Point `render()`'s locked branch at `lockedCard`; keep loading/unlocked/error branches intact.
7. Add the blue "Premium" `status-pill b` to the Progress monthly-report teaser row (progress.js).
8. Run `npm run verify` (expect green — no logic/test touched) and rebuild proto artifacts.
9. Headless-render the locked state at 390×844 (localStorage seed + mock fetch returning `{error:'requires a plan'}`) to verify: real stats show, only the narrative is frosted, both CTAs present, redeem row routes, PAYWALL_VIEWED fires once, TRIAL_STARTED fires on tap. Screenshot to `.fable5/shots/`.
