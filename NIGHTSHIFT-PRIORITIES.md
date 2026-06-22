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

**Use the design skills.** Invoke `frontend-design` and/or `impeccable` for principled
decisions (hierarchy, spacing rhythm, motion, contrast) — don't eyeball it.

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

**Specific open items to fold in:**
- **Refresh logs you out.** `flow`/`role` aren't persisted, so a reload returns to Welcome.
  Persist enough session state (flow + role + onboarding identity) so a reload keeps the
  user where they were. (Good UX win.)
- **Web dev warning `collapsable={false}`** leaks to the DOM via react-native-web (red dev
  toast on web preview only; harmless on native). Track down the source (Animated/SVG
  wrapper) and stop passing it on web. Must not change native behavior.

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
