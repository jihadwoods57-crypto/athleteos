# AthleteOS — Autonomous Build Priorities

The overnight crew ranks the work queue toward these. Higher = more valuable.
Each job must end with the app still compiling (`tsc --noEmit`), tests passing
(`jest`), and bundling (`expo export -p ios`). One job = one clean commit.

## Doctrine
- This is a real Expo + React Native + TypeScript app at this repo root.
- `src/core` is **pure TS** (no RN imports) — the scoring engine + domain. Keep it pure.
- `src/store` Zustand + AsyncStorage. `src/ui` tokens/primitives. `src/screens` per role.
- Match existing conventions. Read neighboring files before writing. No new heavy deps
  without a clear need. Never break the two-layer discipline (pure core vs UI).
- AI features are deterministic simulations for now (no API keys). Keep them offline.

## ⭐ THIS SESSION'S FOCUS: UX / UI DESIGN
This session is a **design polish pass**, not a feature/logic session. The scoring/logic
is solid (140 tests). Rank UX/UI jobs above everything else below. The bar is high — the
founder has zero tolerance for generic "AI-slop" design. Make it feel hand-crafted and
faithful to the handoff.

**Ground every change in the source of truth.** The original high-fidelity design lives at
`../athleteos-design-ref/design_handoff_athleteos/` — `README.md` (full design tokens:
colors, the type scale, radii, the standard/elevated/CTA shadows, the animation list) and
the per-screen `.dc.html` files (`AthleteOS.dc.html`, the dashboards). READ the relevant
handoff file before touching a screen. Refine **toward** the handoff — do NOT invent a new
visual language or restyle wholesale.

**Drive EVERY design job through the `impeccable` skill — this is mandatory this session.**
The repo now has `PRODUCT.md` + `DESIGN.md` at root, so impeccable runs grounded (not
generic). For each screen/area, follow impeccable's own method:
1. **Evaluate first** — run `impeccable critique <target>` (UX/heuristic review) and
   `impeccable audit <target>` (a11y / responsive / technical). Capture the findings.
2. **Act through the matching impeccable command**, not freehand:
   `typeset` (type hierarchy) · `layout` (spacing/rhythm) · `animate` (motion) ·
   `colorize` (strategic color) · `delight` (personality) · `polish` (final pass) ·
   `harden` (errors/edge cases/i18n) · `onboard` (first-run/empty states) ·
   `clarify` (copy/labels/errors) · `adapt` (device/size) · `distill` (remove cruft).
3. Over the session, exercise the FULL suite across the app — every screen should get a
   critique+audit, and the high-value fixes from each should ship.
Honor impeccable's laws AND DESIGN.md: refine within the established system. Do NOT migrate
color to OKLCH, restyle wholesale, or trip impeccable's absolute bans (side-stripe borders,
gradient text, glassmorphism-by-default, hero-metric template, identical card grids, em dashes).

**High-value UX/UI jobs (pick the sharpest each cycle):**
1. **Fidelity pass, screen by screen** vs the handoff: spacing rhythm, type scale/weights,
   color/token usage, corner radii, shadow tiers, copy. Fix drift. One screen per job.
2. **Motion the README specifies but the app is missing:** score-ring draw (`aos-ring`),
   bar grow, overlay slide-up (`aos-up`), meal scan-line (`aos-scan`), spinner, subtle
   pulse. Use `Animated`; respect reduce-motion. (ProgressBar + Ring already animate — extend
   the pattern to overlays, the meal-capture scan, etc.)
3. **Micro-interactions:** press/active states on every tappable, `expo-haptics` on key
   taps (log meal, complete task, submit), smooth tab/overlay transitions.
4. **Empty & edge states:** zero meals logged, all tasks done, score at 100 / at the floor,
   a brand-new athlete (no history). Make each intentional, not blank.
5. **Accessibility:** hit targets ≥44px, text contrast vs tokens, `accessibilityLabel` on
   icon-only buttons, tolerate larger system font sizes without clipping.
6. **Tokenize & unify:** replace any stray inline hex/spacing with `src/ui/tokens`; improve
   shared primitives in `src/ui` so polish propagates to every screen (prefer this over
   per-screen one-offs).
7. **Polish the role views + overlays too** (Coach/Parent/Trainer, Meal Detail, Messages,
   Notifications, Person Detail), not just the athlete tabs.

**⚑ TOP OF QUEUE — QC finding (do this first):**
1. **Web dev warning `collapsable={false}`** leaks to the DOM via react-native-web (an
   intrusive red dev toast on web preview that intercepts taps during QC; harmless on
   native). Track down the source (Animated/SVG wrapper) and stop passing it on web only.
   Must not change native behavior.

**Already shipped & human-QC'd (do NOT redo):** persist session (flow+role+identity survives
reload), reactive heroStatus line + standing badge, aiInsight "Day complete" fix, overlay
slide-up (`aos-up`), drift-proof Log-dinner task, meal-quality badge label tracks score,
ciConfig rollover persistence, **require-cycle fix** (`clock.ts` leaf breaks
dayRollover↔defaultState), **Phase 2 Supabase scaffold** (`src/lib/supabase` + `src/store/sync.ts`,
inert until keys — do NOT wire it up or add keys; that's a human-in-the-loop milestone).

**After the two findings, continue the queue:** finish the UX/UI fidelity pass on the
screens/overlays NOT yet touched (role views — Coach/Parent/Trainer — Meal Detail, Messages,
Notifications, Person Detail), each via `impeccable critique`+`audit` then the matching
command. Then start phase-2 backlog #1 (the test-coverage safety net) since it protects every
later job. Same guardrails: one screen/primitive per commit, `tsc`+`jest`+`expo export` green.

**Design-session guardrails (because the crew can't SEE the render):**
- Keep changes **small, tokenized, and reversible** — one screen/primitive per commit.
- Never break routing (`app/_layout.tsx` + `app/index.tsx`, no `src/app/`), keep `tsc`,
  `jest`, and `expo export` green every commit.
- In the `NIGHTSHIFT-LOG.md` entry, describe **what changed visually and on which screen**
  so the human can QC it quickly with a browser pass.

## Phase 2 backlog (highest value first)

### 1. Test coverage + safety net (do early — protects every later job)
- Unit-test `recommendation.ts`, `leaderboard.ts`, `content.ts` (paceProjection, mealResultFor, aiInsight).
- Add a store-level test: simulate addMeal / toggleTask / addWater / submitCi and assert the
  derived score moves the way the prototype intends.
- Add a tiny CI-style script `npm run verify` = typecheck + test + bundle.

### 2. Desktop dashboards (the deferred phase-2 surfaces)
- Stand up a sibling web target that **reuses `src/core`** (extract to `packages/core` or a
  shared path alias). Recreate the 3 desktop dashboards from the design handoff
  (`../athleteos-design-ref/design_handoff_athleteos/Coach Dashboard.dc.html`,
  `Parent Portal.dc.html`, `Trainer Portal.dc.html`): 1320×880, left sidebar (248px),
  top bar (72px), KPI rows, roster table, trend + bar charts, empty states.
- Use the SAME design tokens and scoring engine. Coach = roster table + breakdown;
  Parent = score ring + KPIs + weight/nutrition charts + coach notes; Trainer = multi-org
  client table (org tag colors) + book-compliance trend + needs-follow-up.

### 3. Polish + parity pass on the mobile app
- Audit each screen against the handoff (`AthleteOS.dc.html`) for spacing, color, copy,
  and interaction fidelity. Fix drift. Add the animations called out in the README
  (ring draw, bar grow, overlay slide-up, scan-line, pulse) where missing.
- Empty/edge states: zero meals logged, all tasks done, score at 100 / at floor.
- Accessibility: hit targets ≥44px, color contrast, screen-reader labels on icon buttons.

### 4. Real persistence depth
- Day-rollover logic (a new calendar day resets the day slice but preserves streak/history).
- A simple local history store (last N days of scores) feeding the Home "Score Trend" and
  the Parent/Coach trends from real data instead of static SVG paths.

### 5. Settings & account depth
- Make the Profile/Account toggles actually persist (units, notifications).
- Editable targets (protein/calories/weight) that flow into the scoring + nutrition screens.

### 6. Onboarding completeness
- Validate inputs (name/email), disable Continue until required fields are set per step.
- Persist onboarding selections so a returning user lands in the right role.

## Free-pick
Beyond this list, pick the highest-leverage improvement to correctness, fidelity, or
robustness. Prefer small, verifiable, revertible jobs over big risky ones.

## Never
- Never send anything external. Never add paid services/signups. Never run `expo start`
  or any long-running/interactive command (only `tsc`, `jest`, `expo export`).
- Never delete `node_modules`, `.git`, or another job's committed work.
