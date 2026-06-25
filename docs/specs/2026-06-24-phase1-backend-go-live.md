# Phase 1 — Real Backend Go-Live Plan (DRAFT, no execution)

The keystone from [the beta-blocker plan](2026-06-24-beta-blocker-build-plan.md). This
turns every "Sample"-labeled screen into real, per-user data: a coach signs up, invites
an athlete, the athlete joins and logs, and the coach sees that athlete's real numbers.

**This document is a plan only.** Nothing here runs until Bo signs off, because it stands
up real user accounts on a public repo and begins collecting health data (including on
minors). The decisions in section 2 are required before step 1.

---

## 1. What already exists (the good news)

The Phase-2 scaffold is mature and inert. No new architecture is needed — this is wiring.

- **Client** (`src/lib/supabase/client.ts`): typed `supabase` client, `isSupabaseConfigured`,
  `requireSupabase()`. Persists the session in AsyncStorage.
- **Auth wrappers** (`src/lib/supabase/auth.ts`): `signIn`, `signUp` (stores `full_name`),
  `signOut`, `currentUserId` — each returns a discriminated result, never throws.
- **Query layer** (`src/lib/supabase/queries.ts`): `fetchDay`, `upsertDay`, `fetchMeals`,
  `insertMeal`, `submitCheckin`, `fetchAthleteProfile`, `fetchLinkedDays` (the overseer
  roster read), `joinTeam(code)`, `joinPractice(code)`, `coachSetGoals`.
- **Sync bridge** (`src/store/sync.ts`): `mapStateToDayRow` / `dayRowToState` / `pushDay` /
  `hydrateDay`, with the two go-live hooks marked in a TODO. `src/core` stays the single
  scoring authority — `pushDay` writes the score `computeDerived` produced.
- **Migrations** (`supabase/migrations/`): `0001_schema.sql`, `0002_rls.sql` (RLS on every
  table, self-only writes, overseer-scoped reads, secure join-by-code RPCs), `0003_storage.sql`.
- **Project**: `ftwrvylzoyznhbzhgism` already exists (created for the AI function) and the
  anon URL/key are already in `.env`.

### The sharp edge to know up front
Because the AI Edge Function uses the **same** project, `isSupabaseConfigured` is **already
`true`** locally. If we naively wire the sync hooks to that flag, the app would start making
DB calls against a project whose **tables may not be migrated yet** → runtime errors. So
go-live needs its **own** gate, distinct from `isAiConfigured` / `isSupabaseConfigured`
(see decision 2.1). This is the single most important thing to get right.

---

## 2. Decisions required before any work (FOUNDER)

1. **Separate go-live flag.** Add `EXPO_PUBLIC_BACKEND_LIVE` (default off) that gates auth +
   sync + roster reads, independent of the AI flag. Recommended: **yes** — it lets AI stay
   live while the data backend is staged, and is the kill-switch if anything misbehaves.
2. **Auth method.** Email + password is fully scaffolded. Magic-link is also possible but
   needs deep-link config. Recommended: **email + password** for the beta.
3. **Who gets accounts in the beta.** Recommended: **coach + athlete only** (the review's
   beta audience). Parent/college/RD stay on labeled sample data until Phase 6 (consent).
4. **Minor consent dependency.** Collecting real body-weight/meal data on athletes 13-17
   should not ship without at least a basic consent gate. Recommended: **land a minimal
   consent checkbox + "what's shared" screen (a slice of Phase 6) before athletes log real
   data**, even if the full governance layer comes later.
5. **Offline/merge policy.** Recommended: **AsyncStorage = offline cache, Postgres = source
   of truth.** On sign-in, hydrate from remote; queue writes while offline; last-write-wins
   per day row (the day slice is small and single-user-owned, so conflicts are rare).
6. **Demo data fate.** The seeded roster/clients stay as a clearly-labeled "demo team" an
   account with no real roster sees; a real coach with invited athletes sees only real rows.

---

## 3. The plan (staged, each stage independently verifiable)

### Stage A — Database is real
1. Link the CLI to `ftwrvylzoyznhbzhgism` and `supabase db push` the three migrations.
2. Verify in the dashboard: tables exist, RLS is ON for every table, the join-by-code RPCs
   and `handle_new_user` trigger are present.
3. **No app change yet.** Confirm the AI function still works (same project, untouched).
   *Verification: tables + RLS visible; AI meal analysis still returns.*

### Stage B — Auth flow (behind `EXPO_PUBLIC_BACKEND_LIVE`)
1. Add the flag to `client.ts` (`isBackendLive = isSupabaseConfigured && EXPO_PUBLIC_BACKEND_LIVE`).
2. Wire the existing sign-in / sign-up screens to `auth.signIn` / `auth.signUp` when
   `isBackendLive`, else keep today's mock auth. Store `userId` + role in the store.
3. Coach signs up → creates a team + a real invite code (replaces static `EAGLES24`).
   Athlete signs up → `joinTeam(code)` binds them to the coach's roster.
   *Verification: two real accounts; athlete appears under the coach via the code; RLS
   blocks cross-team reads (test with a third account).*

### Stage C — Day sync (the two TODO hooks in `sync.ts`)
1. After auth, `hydrateDay(userId)` → `set(...)` so the athlete resumes their real day.
2. In `addMeal` / `addWater` / `toggleTask` / `submitCi`, fire a **debounced** `pushDay(get(), userId)`.
3. Keep AsyncStorage as the offline cache; reconcile on next sign-in.
   *Verification: log a meal on device A, see the score change persist after reload / on a
   second device; offline edits flush when back online.*

### Stage D — Roster + overseer reads are real
1. Swap the coach/trainer dashboards from the seeded `ROSTER`/`TRAINER_CLIENTS` to
   `fetchLinkedDays(date)` (+ `fetchAthleteProfile`) when `isBackendLive`.
2. The Phase-5 filters (position group, search, "not logged today") now run on real rows;
   `loggedToday` derives from whether a real `days` row exists for the athlete today.
3. Drop the "Sample" tags on a screen once it's backed by real data; keep them where it
   still isn't.
   *Verification: a coach sees only their invited athletes' real scores; "not logged today"
   reflects real logging; empty states show for a brand-new team.*

### Stage E — Storage (meal photos) [optional for first beta]
1. Wire `0003_storage.sql` buckets so the real Claude analysis can persist the photo.
2. Gate behind the same flag; falls back to no-upload when off.
   *Verification: a logged meal's photo round-trips; RLS scopes it to the owner + overseers.*

---

## 4. Rollback & safety
- The whole thing is behind `EXPO_PUBLIC_BACKEND_LIVE`. Flip it off → instant return to
  today's local-mock behavior, no redeploy.
- Each stage is its own commit, gates green (tsc / 550+ tests / iOS bundle), revertible.
- Migrations are additive; `0002_rls.sql` denies by default, so a wiring bug fails closed
  (no data leak) rather than open.
- No secret enters the bundle: anon key is public + RLS-gated (already audited); the
  Anthropic key stays a server-only Edge Function secret.

## 5. Risks
- **Minor data before consent** — do not let athletes log real data until decision 2.4 lands.
- **The shared-project flag trap** (section 1) — `EXPO_PUBLIC_BACKEND_LIVE` is the mitigation.
- **RLS correctness** — must test cross-team isolation with a third account before any real
  athlete data exists.
- **Offline reconciliation** edge cases — start last-write-wins; revisit if the beta surfaces conflicts.

## 6. What I will NOT do without explicit sign-off
Run `supabase db push` against the live project, stand up real auth, enable
`EXPO_PUBLIC_BACKEND_LIVE`, or collect any real athlete data. This document stops at the
plan; execution begins only on Bo's go-ahead, decision-by-decision from section 2.
