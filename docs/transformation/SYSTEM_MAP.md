# System Map

## The architecture that actually ships

```
 iOS / Android binary  (Expo 57 · React Native 0.86 · expo-router)
        │
        ├── app/_layout.tsx ──► app/index.tsx ──► src/proto/ProtoApp.tsx
        │                                              │
        │                                              ▼
        │                                     react-native-webview
        │                                              │
        │        ┌─────────────────────────────────────┴───────────────────────────┐
        │        │  proto/redesign-2026-07/index.html   ← THE ACTUAL UI            │
        │        │  · 112 vanilla-JS ES modules, hash router, 107 routes           │
        │        │  · 8 CSS files (~2.7k LOC), token-driven, dark + light          │
        │        │  · talks to Supabase directly with the public anon key          │
        │        └────────────────────────────────────────────────────────────────┘
        │
        ├── src/proto/bridge.ts ── postMessage bridge: haptics, share, secure store,
        │                          camera, biometrics, geofence, roll-call ack
        │
        └── src/lib/*  native seams (auth, notifications, location, IAP, health)

 src/screens/**  ── 49 files, 17,896 LOC ── LEGACY React Native, UNREACHABLE
 src/core/**     ── 92 modules ── mostly reachable only via a barrel; ~47 are
                    exercised by nothing but their own unit tests
```

**The single most important fact for anyone working here:** editing `src/screens/*` changes
nothing a user sees. The shipped UI is `proto/redesign-2026-07/`.

## Backend

- **Supabase Postgres** — 151 migrations, 85 tables, **RLS enabled on all 85**.
- **38 Deno edge functions** (`supabase/functions/`) — AI analysis, billing, push, webhooks, cron.
- **2 private storage buckets** — `meal-photos`, `progress-photos`, both path-scoped per user.
- Authorization is **RLS in Postgres**, deliberately. The client ships the public anon key and
  runs unfiltered selects; the server's `can_view()` scopes rows. Client-side role checks are
  presentation only and documented as such (`js/staff-access.js:4-6`).

## Where logic is duplicated

| Concept | TS (`src/core`) | Proto JS | Edge fn | Guarded? |
|---|---|---|---|---|
| Daily score | `scoring.ts` | `day.js` | — | **Yes** — `scoreParity.test.ts`, 19 fixtures |
| Plan styles | `planStyle.ts` | `plan-style.js` | `_shared/plan-style.ts` | TS↔JS yes; **edge copy no** |
| Food DB | `foodDb.ts` | `nutrition.js` | — | Yes |
| Grade letters | `scoring.ts` | `day.js` | `0041` (plpgsql) | **No** — 3 copies |
| Tier bands | `tiers.ts` | `day.js` + `state.js` | — | **No** — 3 copies |
| Pricing | `pricing.ts` | `pricing.js` | `_shared/plans.ts`, `_shared/revenuecat.ts` | **No** — 4 copies, money |
| **Streaks** | `history.ts:341` | `day.js:469` | — | **No — already drifted** |

The parity tests are the only reason the score has not drifted. Everything else is kept in step
by comments, and each of those comments is a future incident.

## Route surface

**107 registered routes** (`js/screens/index.js`). Shells: `athlete`, `coach`, `trainer`,
`operator` (coach+trainer), `parent` (no tab bar).

Hard orphans — registered, render, but no navigation path: `safety`, `states`, `copilot`.
Dead: `legacy-role` (zero references, unreachable by construction), `meal-confirm` (alias with no
callers).

## Verification entry points

```
npm run typecheck            tsc --noEmit
npm test                     jest — 2,574 tests / 212 suites
npm run test:proto           node --test — 41 proto module tests
npm run lint:xss             innerHTML escaping lint
npm run verify               all of the above + an iOS bundle
supabase db reset            apply all 151 migrations locally
supabase/tests/run.sh        419-check adversarial RLS suite
node scripts/serve-proto.mjs 8799     serve the real UI at http://localhost:8799
node scripts/qc-capture.mjs           screenshot + machine-audit every screen
```
