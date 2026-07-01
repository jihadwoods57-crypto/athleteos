# Auth, Data-Scoping & Local-Caching Plan (2026-06-29)

**Type:** AUDIT + PLAN. No code or config was changed producing this doc. The single
write is this file.
**Companion:** `docs/SECURITY-AUDIT-2026-06-29.md` (the H1–H4 / M1–M4 / G1–G4 / L1
findings cited throughout).
**Founder ask (verbatim):** "in addition to Supabase, also local caching so the user
has a very immediate and snappy experience… we need user authentication so you know
which user is accessing which data; common security features; OAuth."

**Standing guardrails this plan respects:** never set `EXPO_PUBLIC_BACKEND_LIVE=true`;
never apply migrations to live infra; the consent gate is supreme and fails closed;
RLS is the server-side authorization boundary; `src/core` stays pure TS; no secrets in
the repo.

Status vocabulary: **BUILT** (code read, it works) · **DESIGNED** (typed seam, inert
until go-live) · **MISSING** (nothing exists) · **FOUNDER-GATED** (needs a Supabase
dashboard action / Apple portal / go-live flip) · **NEEDS-THROWAWAY-PG** (only
validatable against a disposable Postgres, never live).

---

## A. Current state

### A1. Authentication

| Capability | Status | Evidence |
|---|---|---|
| Email/password sign-in | **DESIGNED** (inert) | `src/lib/supabase/auth.ts` `signIn` → `signInWithPassword`; store `signInLive` (`useStore.ts:967`) gated on `isBackendLive` |
| Email/password sign-up | **DESIGNED** | `auth.ts` `signUp` (writes `full_name` to user metadata; DB trigger `handle_new_user` copies to `profiles`); store `signUpLive` (`useStore.ts:919`) |
| Password reset (enumeration-safe) | **BUILT (logic) / DESIGNED (delivery)** | `auth.ts` `resetPassword`; store `requestPasswordReset` (`useStore.ts:930`) surfaces the same "we sent a link" copy whether or not the email exists — email-enumeration avoided (audit L3 notes this path is already correct) |
| Sign in with Apple | **DESIGNED + FOUNDER-GATED** | `src/lib/auth/apple.ts` is a typed seam: `isAppleAuthAvailable=false` until `expo-apple-authentication` is installed; `requestAppleIdentityToken()` returns `null`. `auth.ts` `signInWithAppleToken` → `signInWithIdToken({provider:'apple'})`. Needs the native dep + Apple Sign-In capability + Services ID on the founder's machine/portal. Button renders only on iOS + `isBackendLive`. |
| Google / social OAuth | **MISSING** | Grep of `src/lib` + `src/store` finds no `signInWithOAuth`, no Google provider, no redirect handling. Only `provider:'apple'` exists. |
| Session create / persist / refresh | **BUILT (config)** | `src/lib/supabase/client.ts`: `persistSession:true`, `autoRefreshToken:true`, `detectSessionInUrl:false` (RN has no URL bar). Token storage = `secureStorage` adapter. |
| Secure token storage (audit L1) | **BUILT** | `src/lib/supabase/secureStorage.ts`: chunked `expo-secure-store` (iOS Keychain / Android Keystore), ≤2KB chunks with a count key; web/SSR falls back to AsyncStorage. Wired as `auth.storage` in `client.ts`. Unit-tested (`secureStorage.test.ts`). |
| Complete sign-out (audit H2) | **BUILT** | `useStore.ts:572` `signOut` now composes `signOutLive` (calls `auth.signOut()` + clears `userId`/`realDataConsent`/`entitlement`) **then** resets nav. Local state resets even if the network sign-out fails. |
| Delete account (audit M4 + Apple 5.1.1(v)) | **BUILT (local) / DESIGNED (server)** | `useStore.ts:582`: server `delete_account` RPC when live, **then** `auth.signOut()` to drop the deleted account's refresh token, then local wipe — always completes locally. |

**Net:** auth is a disciplined, fully inert seam. Email/password + Apple are wired but
asleep behind `isBackendLive`. Google/social OAuth does not exist yet. The session
config and secure storage are real, present code.

### A2. Data scoping ("which user accesses which data")

- **`userId` provenance:** set only from a successful Supabase auth result
  (`signInLive`/`signUpLive`/`signInWithApple`, `useStore.ts:927/953/974`); cleared by
  `signOutLive` (`:992`) and `deleteAccount`. Persisted in the `aos_day` blob
  (`partialize`, `:1091`) so a reload resumes the session — inert unless `isBackendLive`.
- **Client is a mirror, server is the boundary (CONFIRMED):**
  - Every query in `src/lib/supabase/queries.ts` is parameterized on `athlete_id`/`owner_id`
    and relies on **RLS** for authorization, never on client filtering for security
    ("RLS does the authorization; these never widen access beyond the signed-in user").
  - The overseer roster read (`fetchLinkedDays`, `queries.ts:160`) is a bare
    `select * from days where date = ...` — **RLS `can_view` is what scopes it** to the
    coach's linked athletes. The client adds no `where coach=...`. This is the correct
    posture: take away RLS and the client would over-read, which is exactly why RLS, not
    the client, is the boundary.
  - `src/core/membership.ts` `can()/canView()` is a **mirror** for UX gating only; the
    audit confirms "no path where a non-member resolves true," but it is not relied on
    for server authz.
- **RLS spine (BUILT, NEEDS-THROWAWAY-PG to validate; not applied live):**
  - `is_self(athlete)` (`0002_rls.sql:6`), `can_view(athlete)` (`0002:37`, body swapped to
    the memberships predicate in `0012`, then redefined in `0013` as the **union** of
    memberships + legacy `is_trainer_of`/`is_guardian_of` so the teams-only backfill
    doesn't silently revoke trainers/guardians — audit M2).
  - Athlete data: read = `can_view`, write = `is_self` (days/meals/checkins, `0002:88+`).
  - `org_memberships` (0011) + `in_org()`/`is_org_admin()` `SECURITY DEFINER` helpers
    (0013) avoid the self-recursion that aborted admin reads (audit H4).
  - Service-role-only tables (`subscriptions`, `org_memberships`) had `authenticated`
    DML revoked in 0013, and the dangerous "all future tables inherit DML" default
    privilege was reversed (audit M1).
  - Apply order ends `… → 0011 → 0012 → 0013`; **0013 validated 18/18 on a throwaway
    Postgres, never applied to the live project** (guardrail D1).
- **Consent gate (BUILT, fails closed):** `src/core/consent.ts` `realDataConsent` is the
  deterministic gate. Order: backend-off → blocked; non-athlete → ok (generates no health
  data); paused → blocked; no consent → blocked; minor + guardian≠`verified` → blocked.
  Unknown age ⇒ minor; unknown role ⇒ coerced to athlete (gated, not waved). Applied at
  **every** real-data egress: `pushDay` (`sync.ts:101`), `recordMeal` (`mealSync.ts`), and
  — after audit H1 — `capture()`/`captureLabel()` photo egress (`useStore.ts:611/645`),
  keyed on `isAiConfigured` because the AI endpoint can be live while the DB backend is
  staged ("shared-project flag trap").
- **Guardian verification (`verified`) is server-owned:** `guardian_consent_requests` lets
  the athlete only `select` status; only the service-role endpoint writes `verified`. The
  client sets `pending` (`requestGuardianConsent`, `useStore.ts:1006`) and **never** reads
  `verified` back yet (audit G2 — fails closed: a verified guardian can't unblock the minor
  from the client). A `hydrateGuardianConsent` action exists and is called on sign-in
  (`:964/987`) but is governed by G2's "read-only, never client-writable" rule.

### A3. Local caching / snappy UX

- **Today's own-day cache (BUILT):** `zustand/persist` under key `aos_day`
  (`useStore.ts:1040`), `createJSONStorage(() => AsyncStorage)`. `partialize` (`:1046`) is
  an **allowlist** of the day-slice + cross-day identity/session fields (incl. `userId`,
  `realDataConsent`, `sharingPaused`, `entitlement`, `msgThread`).
- **NEVER cached (CONFIRMED, by omission from the allowlist):** `mealPhoto` (base64),
  `mealAnalysis`, `labelFacts`, `authError` — ephemeral PII / secrets. The audit confirms
  "ephemeral secrets/PII (meal photo base64, analysis) are excluded from `partialize`."
- **Rehydrate / day-rollover merge (BUILT):** `merge` (`:1134`) records the prior day's
  score/weight/nutrition into history, then `rollDayIfStale` resets the day slice on a new
  calendar day; cross-day fields survive; a blob with no `flow` is treated as a fresh
  install and lands at onboarding step 0. This is the local snappy path: the UI paints from
  the persisted blob before any network.
- **Offline / backend-off (BUILT):** with `isBackendLive` off the app is **pure local
  mock** — every `queries.ts` fn early-returns `null`/`[]`, every sync seam early-returns,
  and `useLiveRoster` never fetches. Even with the backend live, `signInLive` hydrate
  failures fall back to the AsyncStorage-cached day (`useStore.ts:977`).
- **Read-through cache for backend data: MISSING.** Every **live read hits Supabase fresh**:
  - own day: `hydrateDay` on sign-in (`sync.ts:112`) — once per sign-in, not persisted as a
    distinct cache (it merges into the same `aos_day` blob, so it does survive reload).
  - meal history / nutrition memory: `fetchRecentMeals` on overlay open (`useStore.ts:719`).
  - **roster: `useLiveRoster` (`screens/roles/useLiveRoster.ts`)** re-fetches
    `fetchLinkedDays(today)` on **every mount**, holds the result in `useState` only
    (not persisted), shows the seeded showcase while loading. No dedup, no TTL, no
    persisted roster cache, no realtime subscription.
  - profile / entitlement / guardian status: `hydrateProfile`/`refreshEntitlement`/
    `hydrateGuardianConsent` each fire a fresh read on sign-in.

  So the **athlete's own day** is effectively cache-then-revalidate already (persisted blob
  paints first, `hydrateDay` revalidates). The **overseer roster + meal-history reads** are
  network-only: a coach reopening the dashboard sees the seeded sample flash, then the live
  rows — no warm cache.

### A4. Common security features

| Feature | Status | Note |
|---|---|---|
| Auto session refresh | **BUILT** | `autoRefreshToken:true` (`client.ts:41`). Supabase refreshes on its own timer when the app is foregrounded. |
| Refresh-on-resume (`AppState` → `startAutoRefresh`) | **MISSING** | The Supabase RN guide recommends wiring `AppState` `active/background` to `supabase.auth.startAutoRefresh()/stopAutoRefresh()`. Not present — refresh may stall after long backgrounding. |
| Complete sign-out | **BUILT** | audit H2 (see A1). |
| Secure token storage | **BUILT** | audit L1 (see A1). |
| Email-enumeration-safe reset | **BUILT** | `requestPasswordReset` (see A1). |
| Rate limiting on AI endpoint | **MISSING / FOUNDER-GATED** | audit G4: `analyze-meal` Edge Function has open CORS `*` and no per-user rate limit. Fine for staging; restrict before go-live. |
| Biometric / app-lock | **MISSING** | No `expo-local-authentication` usage anywhere. |
| Deep-link / OAuth-redirect handling | **PARTIAL** | `scheme:"onstandard"` exists in `app.json`; `detectSessionInUrl:false`. No `expo-linking` redirect handler — needed only if web/Google OAuth (redirect flow) is added. Apple native flow needs no redirect. Audit confirms "no untrusted deep-link handling" today (a safe default, but also means no OAuth-redirect plumbing). |
| Secrets hygiene | **BUILT** | audit "CORRECT": no service-role key / DB password / Stripe secret in repo; only `.env.example` placeholders tracked; Anthropic key server-side only. |

---

## B. Gaps worth building (prioritized)

Each gap is tagged: **[now]** client-only-safe behind the inert seam ·
**[gated]** founder-gated (Supabase dashboard / Apple portal / go-live flip) ·
**[pg]** needs a throwaway Postgres to validate.

### B1. Google (and any) social OAuth — **[now] seam + [gated] enablement**
- **What:** add a Google sign-in path mirroring the Apple seam. On native, use
  `@react-native-google-signin` (or Expo `AuthSession`) to obtain a Google **ID token**,
  then `supabase.auth.signInWithIdToken({ provider:'google', token })` — the same primitive
  Apple already uses, so `auth.ts` gains a `signInWithGoogleToken` twin and the store gains
  `signInWithGoogle` (gated on `isBackendLive`, identical hydrate fan-out to `signInLive`).
- **Client-only-safe now:** the typed seam (`src/lib/auth/google.ts` modeled exactly on
  `apple.ts`: `isGoogleAuthAvailable=false` until the dep is installed; token fn returns
  `null`), the `auth.ts` wrapper, the store action, and a hidden button — all inert. No
  behavior change with the flag off. **Mirror the Apple seam precisely** so the review
  surface is familiar.
- **Founder-gated:** (1) enable the **Google provider in the Supabase dashboard** (client
  IDs/secret); (2) create OAuth client IDs in Google Cloud Console (iOS/Android/web);
  (3) install the native dep on the founder's machine; (4) add the reversed-client-ID
  URL scheme to `app.json`. None of these are runtime-verifiable here.
- **Redirect handling:** the **ID-token** flow (native Google/Apple) needs **no** redirect
  plumbing. Only a **web/PKCE redirect** flow would need `expo-linking` +
  `detectSessionInUrl` handling — defer that; native ID-token is the App-Store-friendly path.

### B2. Token-refresh robustness — **[now]**
- **What:** wire React Native `AppState` to `supabase.auth.startAutoRefresh()` on `active`
  and `stopAutoRefresh()` on `background`, per the Supabase Expo guide. Prevents a stale
  access token after long backgrounding.
- **Safe now:** guard the listener on `isBackendLive` (or simply `supabase != null`) so it's
  a no-op with the flag off. Pure client code, no infra.
- **Also [now]:** add an `onAuthStateChange` handler that clears local session state on a
  `SIGNED_OUT` / token-revoked event (defense-in-depth against a server-side revocation).

### B3. Local read-cache layer ("hydrate-from-cache-then-revalidate") — **[now]**
The own-day path already does this; the **gap is the overseer reads** (roster, meal
history) which flash the seeded sample on every mount.
- **What:** a small persisted, namespaced, TTL'd read cache keyed by `userId` + query, e.g.
  `aos_cache:<userId>:roster:<date>`. On mount: paint from cache (if fresh and same
  `userId`), then revalidate via the existing `fetchLinkedDays`/`fetchRecentMeals` and
  update both UI and cache. Pattern = stale-while-revalidate. `useLiveRoster` is the natural
  first adopter (it already has the seeded-fallback shape; swap the fallback to
  "cache ?? seeded").
- **Hard rules for this layer (NEVER cache):**
  - meal-photo base64 (`mealPhoto`), AI analysis (`mealAnalysis`, `labelFacts`) — already
    excluded from `partialize`; the new cache must exclude them too.
  - signed meal-photo URLs (`signedMealPhotoUrl`, TTL'd by design) — re-sign, never persist.
  - any guardian `verified` flag as **writable** — read-only mirror only (audit G2).
  - **Namespace by `userId` and purge on sign-out / account switch** so user A's roster
    never paints for user B. Clear the cache in `signOutLive` and `deleteAccount`.
  - the cache is a **UX mirror, never an authz source** — RLS still gates the revalidate.
- **Safe now:** entirely client-side, exercised only when `isBackendLive` (the seeded path
  is unchanged with the flag off). Add unit tests in the `src/store` style.
- **Optional later [gated]:** Supabase **Realtime** on `days` for live roster updates —
  needs the backend live; defer until after the cache lands.

### B4. Biometric / app-lock — **[now]**
- **What:** optional `expo-local-authentication` gate on cold start / resume (Face ID /
  fingerprint / device passcode) before revealing data. Setting lives in Profile; default
  off. Purely local; protects an unlocked-device scenario for a minor's health data.
- **Safe now:** client-only, no infra, no flag dependency. Install the dep at the founder's
  convenience; until then ship the toggle disabled behind an `isAvailable` seam (same shape
  as `apple.ts`).

### B5. Go-live security closeouts (carried from the audit) — **[gated] / [pg]**
- **G1 revoke-viewer RPC** — [pg]+[gated]: `removeViewer` is UI-only; add a `revoke_viewer`
  RPC that flips the link `status <> 'active'` (which `can_view` already excludes) and wire
  it when `isBackendLive`. Validate on throwaway Postgres.
- **G2 guardian `verified` hydrate** — [gated]: read-only `fetchGuardianConsent` (server-set
  `verified` only). The `hydrateGuardianConsent` call site already exists.
- **G3 privacy-policy blanks** — [gated]: fill retention windows / Anthropic terms / entity
  before publishing (it's the in-app URL).
- **G4 AI-endpoint CORS + rate limit** — [gated]: restrict CORS off `*`, add per-user rate
  limiting on `analyze-meal` before go-live.

---

## C. Recommended build order (respects the guardrails)

**Phase 0 — now, behind the inert seams (no infra, flag stays OFF):**
1. **B2 token-refresh robustness** (`AppState` ↔ `startAutoRefresh`, `onAuthStateChange`
   sign-out cleanup). Smallest, pure client, hardens what's already wired.
2. **B1a Google OAuth seam** (`src/lib/auth/google.ts` + `auth.ts` wrapper + store
   `signInWithGoogle` + hidden button) — mirror `apple.ts` exactly. Inert until the dep +
   dashboard land.
3. **B3 local read-cache layer**, first adopter `useLiveRoster`, then meal-history overlays.
   Namespaced by `userId`, TTL'd, purged on sign-out/delete, honoring the never-cache list.
4. **B4 biometric/app-lock toggle** behind an availability seam (disabled until dep added).
   Lowest priority of the "now" set.

   Each ends green on `npm run verify`; commit working states.

**Phase 1 — founder-gated, at/just-before go-live (founder performs):**
5. Supabase dashboard: enable **Google** (and confirm Apple) provider; Google Cloud OAuth
   client IDs; add native deps (`expo-apple-authentication`, Google sign-in,
   `expo-local-authentication`); add URL schemes to `app.json`.
6. **G4** CORS + rate limit on `analyze-meal`; **G3** privacy-policy fill.
7. Apply migrations `… → 0011 → 0012 → 0013` to the live project (founder only).

**Phase 2 — needs throwaway Postgres, before flipping `can_view`-dependent features:**
8. **G1 `revoke_viewer` RPC** + **G2 guardian `verified` hydrate**, each validated on a
   disposable Postgres (the 0013 precedent), then wired client-side under `isBackendLive`.

**Phase 3 — optional, after the cache lands and the backend is live:**
9. Supabase **Realtime** on `days` to push live roster updates (supersedes the TTL poll).

Only **Phase 0** is done in this environment. Phases 1–3 are explicitly out of scope here.

---

## D. Do NOT do (the traps)

1. **Do NOT cache PII / secrets in the new read-cache.** Never persist meal-photo base64,
   `mealAnalysis`/`labelFacts`, signed photo URLs, or any access/refresh token outside
   `secureStorage`. They are already excluded from `partialize`; keep them out of the new
   layer too. **Namespace every cache entry by `userId`** and purge on sign-out / delete /
   account-switch — a cross-user paint is a privacy breach.
2. **Do NOT weaken or bypass the consent gate.** `realDataConsent` must remain the
   fail-closed gate on every real-data egress (`pushDay`, `recordMeal`, `capture`/
   `captureLabel`). A cache revalidate is a **read** of the user's own data and never a
   reason to push their data without consent. Never make guardian `verified` client-writable.
3. **Do NOT move authorization to the client.** RLS stays the boundary. `membership.ts` /
   any cache is a UX mirror only. Never add a client-side `where` and call it security, and
   never `select` with the service-role key from the app.
4. **Do NOT commit secrets or flip the kill-switch.** No service-role key, DB password,
   Stripe secret, or Google OAuth **client secret** in the repo or in any `EXPO_PUBLIC_*`
   var (those ship in the bundle). The Google secret lives in the Supabase dashboard. Do
   **not** set `EXPO_PUBLIC_BACKEND_LIVE=true` and do **not** apply migrations to live infra
   — both are founder-only go-live actions.
5. **Do NOT add a web/PKCE OAuth redirect flow on native** when the ID-token flow suffices —
   it pulls in `detectSessionInUrl` + untrusted deep-link handling the audit currently
   confirms absent. Prefer native ID-token (`signInWithIdToken`) for Apple and Google.

---

## References
- `docs/SECURITY-AUDIT-2026-06-29.md` — H1–H4, M1–M4, G1–G4, L1–L4, CORRECT highlights.
- Auth: `src/lib/supabase/{client,auth,secureStorage,queries}.ts`, `src/lib/auth/apple.ts`.
- Store: `src/store/useStore.ts` (signIn/Out Live, deleteAccount, capture, persist/partialize/merge),
  `src/store/sync.ts`, `src/store/mealSync.ts`.
- Scoping/consent: `src/core/consent.ts`, `src/core/guardianConsent.ts`, `src/core/membership.ts`.
- RLS: `supabase/migrations/0002_rls.sql`, `0011_org_memberships.sql`,
  `0012_can_view_cutover.sql`, `0013_security_hardening.sql`.
- Reads: `src/screens/roles/useLiveRoster.ts`, `src/screens/overlays/PersonDetail.tsx`.
