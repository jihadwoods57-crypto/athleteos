# Design: Athlete ↔ Coach & Client ↔ Trainer linking ("One link, two doors")

**Date:** 2026-07-01
**Status:** Approved (brainstorming) — ready for implementation plan
**Author:** Bo Woods + Claude

## Context

Onboarding collects who a user is but never connects an athlete to their coach — team
linking is deferred entirely to in-app today. Bo wants an athlete to be able to pick
their **school** and then connect to their **coach** during onboarding, with the mirror
for **clients ↔ trainers**. Both directions must work: a coach can invite athletes, and
an athlete can go find their coach. The overriding requirement Bo stated: *"make sure
everything flows and is wired correctly."*

The good news from exploration: the roster, membership, and security plumbing already
exists and is sound. This design **reuses** it and adds a second, discovery-based way to
reach the same roster row — not a parallel system.

## Goals

- An athlete can connect to a coach two ways: **(1)** enter the coach's join code
  (instant), or **(2)** search their school, find the coach, and request to join (coach
  approves).
- The mirror for trainers: a client connects via the trainer's shareable **handle/link**,
  or by entering a code; trainer approves discovery-initiated requests.
- Schools are **real, shared entities** so an athlete and a coach land on the same school.
- Both connection paths converge on **one** membership row (no duplicates, no parallel state).
- Minors stay protected: discovery is one-directional, a pending request leaks nothing,
  and the existing guardian-consent gate still governs actual data flow.

## Non-goals

- No browsable directory of athletes or of trainers (privacy; trainers use handle/link).
- No coach-browses-athletes capability, ever.
- No rich public coach/trainer marketing profiles (that is a later "directory-first" phase).
- No change to how scores/meals/days sync — only who is *linked*, gated by existing RLS.

## Current system (what we reuse)

Tables (`supabase/migrations/0001_schema.sql`):
- `teams (id, name, sport, join_code)` — code minted by `create_team` RPC via `gen_join_code()`.
- `team_members (team_id, athlete_id, position, status, joined_at)` — **`status` already exists.**
- `team_staff (team_id, staff_id, role, status)` — role ∈ {head_coach, assistant}.
- `practice_clients (practice_id, client_id, org_label, status, last_active_at)` — trainer's clients.
- `guardianships (athlete_id, guardian_id, relationship, status)` — parent↔child.
- `orgs (…, org_type ∈ {school, club, independent})` — **exists but unpopulated. This becomes the schools directory.**

Security (`0002_rls.sql`): `can_view(athlete)` = `is_self` OR `is_team_coach_of` OR
`is_trainer_of` OR `is_guardian_of`. Rosters are a **projection** of the `days` table
filtered by `can_view` (`queries.ts fetchLinkedDays` → `core/rosterSync.ts mapLinkedDaysToRoster`
→ `useLiveRoster`), not a stored roster.

RPCs: `create_team(team_name, team_sport)→code`, `join_team(code, athlete_position)→uuid`
(`0002_rls.sql`, `0004_create_team.sql`), `join_practice` for trainers.

Store actions (`src/store/useStore.ts`): `createTeamLive`, `joinTeam`, `connectCoach(code)`,
`requestGuardianConsent`. All gated by `isBackendLive`, inert in demo.

## Design

### A. Schools directory (populate `orgs`)

- **Seed** `orgs` with a public dataset of US high schools + colleges (`name, city, state,
  org_type`). New migration (e.g. `0017_schools_seed.sql` or a seeded import step).
- **Search:** a read RPC / query `search_orgs(q)` returning name + city + state for a
  type-ahead. Publicly readable (org names are not sensitive); RLS allows select on `orgs`.
- **Add your school/club:** `create_org(name, city, state, type)` inserts a new org for
  anything missing (private schools, clubs, gyms), with a light dedup guard (case-insensitive
  match on name + state prompts "Did you mean …?" before creating).
- **Attach team to school:** add `org_id uuid references orgs(id)` to `teams`. Set when a
  coach picks/creates their school in onboarding (replaces today's freetext `obMeta.school`).

### B. Two doors to one membership row

**Door 1 — coach code (exists, unchanged mechanism):** athlete enters `join_code` →
`join_team` upserts `team_members` with `status='active'` immediately. Possessing the code
is the coach's consent. Add a **confirmation screen** first: resolve the code to
"Coach Davis · Eastside HS" and confirm before joining.

**Door 2 — athlete-initiated request (new):**
- Athlete searches `orgs` → sees **discoverable** teams at that school (see C) with the
  coach/staff name → taps "Request to join".
- New RPC `request_join_team(team_id, position)` upserts `team_members` with
  `status='pending'` (SECURITY DEFINER; athlete may insert only their own pending row).
- Coach sees pending requests (new query `fetchPendingMembers(team_id)`), and
  `approve_member(team_id, athlete_id)` flips `status→'active'`; `decline_member` deletes.
- **Convergence rule:** both paths key on `(team_id, athlete_id)` and **upsert**. If a
  pending request exists and the athlete then enters the code, the same row flips to active —
  never a duplicate. If active already, a later request is a no-op.

### C. Discoverability opt-in

- Add `discoverable boolean not null default false` to `teams`.
- Coach sets it in onboarding ("Let athletes at {school} find and request to join") and in
  team settings. Only `discoverable=true` teams appear in athlete school search. `false`
  teams are code-only (unchanged from today's behavior).

### D. Trainer ↔ client mirror

- Trainers have no school. Add a unique `handle` to the trainer/practice identity
  (`practices`/profile), plus the existing shareable code/link.
- Client-first: client searches the trainer's `handle` (or opens the shared link) →
  `request_join_practice(practice_id)` inserts `practice_clients` with `status='pending'` →
  trainer `approve_client` / `decline_client`. Same pending→active convergence as teams.
- Trainer-first: existing code/link path, `status='active'` on redeem.

### E. Onboarding flow changes (`src/screens/onboarding/`)

- **Athlete flow (`flows.ts athleteFlowKeys`):** add an optional `connect` step (after
  `consent`, before `challenge`). Screen offers *I have a code* (→ confirm → active) or
  *Find my coach* (→ school search → team pick → request pending). Skippable; also reachable
  in-app via the existing `supportTeam` / `connectCoach` surface.
- **Coach flow (`ROLE_FLOWS`):** the `school` freetext step becomes a **directory picker**
  (`search_orgs` + add). `createTeamLive` (called in `GenericStep` before the invite step)
  now also sets `teams.org_id` and the `discoverable` toggle. Invite/code step unchanged.
- **Trainer flow:** add handle selection; keep the code/invite step.

### F. Minors & privacy (hard rules — the wiring that must hold)

1. **Discovery is one-directional.** Athletes/clients search for coaches/trainers only.
   No endpoint lets a coach/trainer search or browse athletes. They see only people who
   redeemed their code or sent them a request.
2. **Pending reveals nothing.** `is_team_coach_of` / `is_trainer_of` (and thus `can_view`)
   **must require `status='active'`**. A `pending` row grants no visibility of the athlete's
   days/meals/score. This is the single most important change to verify in `0002_rls.sql`'s
   helper functions — audit and, if needed, tighten them to filter on active status.
3. **Linking ≠ data-sharing for minors.** The guardian-consent gate (`core/consent.ts
   realDataConsent`, `0008_guardian_consent.sql`) is unchanged: a minor can be an active
   member but their real data stays on-device until `guardianStatus='verified'`.

## Correctness / wiring guarantees (Bo's requirement)

- Approve flips `pending→active`; roster (`fetchLinkedDays` via `can_view`) surfaces the
  athlete **only after** active — enforced in SQL, not the client.
- Both doors upsert the same `(team_id, athlete_id)` / `(practice_id, client_id)` row — no
  duplicate memberships regardless of order.
- All new RPCs are SECURITY DEFINER with tight checks: an athlete may only create/withdraw
  **their own** pending row; only a team's staff may approve/decline its requests.
- Everything new is gated by `isBackendLive`, inert in the demo build (matches existing pattern).

## Testing

- **SQL/RLS:** a `pending` member is invisible to the coach's `can_view`; becomes visible on
  approve; a declined request removes the row; an athlete cannot approve themselves; a coach
  cannot approve for another team. Convergence: request-then-code and code-then-request both
  yield exactly one active row.
- **Store (jest):** `requestJoinTeam`, `approveMember`, `declineMember`, `searchOrgs`,
  `createOrg`, and their trainer mirrors — action + state transitions, inert when flag off.
- **Onboarding (web/Playwright):** athlete "Find my coach" path (search → request → pending
  state shown); coach approves; athlete sees "active". Coach directory picker seeds `org_id`.
  Code path still shows the confirm screen. Minor: linked but data-gated until guardian verify.
- Full `npx tsc --noEmit` + `npx jest` green; existing suites unaffected.

## New vs. changed files (implementation surface)

- **Migrations:** `orgs` seed + `search_orgs`/`create_org`; `teams.org_id` + `teams.discoverable`;
  `request_join_team`/`approve_member`/`decline_member`; trainer `handle` +
  `request_join_practice`/`approve_client`/`decline_client`; **RLS audit** so `can_view`
  helpers require active status.
- **`src/lib/supabase/queries.ts`:** searchOrgs, createOrg, requestJoinTeam, fetchPendingMembers,
  approveMember, declineMember + trainer mirrors.
- **`src/store/useStore.ts`:** matching actions; extend `createTeamLive` to set org_id + discoverable.
- **`src/screens/onboarding/`:** athlete `connect` step; coach school-picker step; trainer handle step.
- **`src/screens/roles/CoachView.tsx` / `TrainerView.tsx`:** pending-requests inbox + approve/decline.
- **Core:** school-search view model; any pure helpers (dedup match) with tests.
