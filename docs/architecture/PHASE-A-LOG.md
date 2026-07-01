# Phase A — Integrity Seams: build log

**Status:** ✅ COMPLETE (2026-06-29) · flag-OFF · nothing user-visible · 1001 tests green
**Goal (from `11-strategy-risks-decisions.md` §8.2):** commit the keystone + the integrity
spine as pure `src/core` seams + authored (unpushed) migrations, without changing one byte of
user-visible behavior. The wedge stays byte-identical to before.

## What landed

| Unit | Artifact | Commit |
|---|---|---|
| A1 | `src/core/membership.ts` — the access-grant model + selectors (`canView`, `can`, `scopeContains`, `reachingMemberships`), the typed `PERMISSION_KEYS` catalog (no formula-edit key — D3). +16 tests. | `67f015f` |
| A2 | `supabase/migrations/0011_org_memberships.sql` — the `org_memberships` table + `scope_contains()` + `can_view_via_memberships()` (NEW fn, non-destructive) + RLS. **Validated on a throwaway Postgres** (0001–0011 apply clean; SQL predicate == `src/core` `canView`). `OrgMembershipRow` type. | `8e2586b` |
| A3 | `src/core/workspace.ts` — the inert active-workspace selector + `primaryAthleteOrg` (athlete chooses — D5). +8 tests. | `ab9e99f` |
| A4 | `src/core/subscription.ts` — generalized to a single `hasFeature(entitlement, key)` gate over a `FeatureKey` catalog (memo D4). +4 tests. | `ab9e99f` |

The four ratified keystone decisions are now expressed in code: athletes own data / orgs own
access (membership decides visibility, never writes athlete data); everything is an Organization
(no special-case role logic — trainer/parent/family are just orgs); unlimited orgs per athlete
(visibility computed over the full grant set); scoring integrity (no permission can edit the
formula); the athlete picks their primary plan.

## Verification

- **Pure core:** 1001 unit tests (`npm run verify` green: tsc + jest + iOS export) at every commit.
- **SQL:** migration `0011` applied to a throwaway local Postgres (initdb + an auth/storage
  shim) on top of `0001`–`0010`; `can_view_via_memberships()` returns identical results to
  `src/core` `canView()` on the linebacker / QB / trainer / transfer scenario. The SQL is a
  mirror of the pure core, not a second source of truth.

## Conventions adopted (the debt-prevention discipline, doc 11 §4–5)

These are now the standard for all subsequent work, even before the engines exist:
1. **Check permission KEYS, never role names** — new authorization decisions call `can(viewer,
   athlete, action, …)` (or the future `hasPermission`), so the eventual RBAC swap is a body
   change, not a call-site hunt (D3 debt).
2. **`hasFeature(entitlement, key)` for every gated feature** — no screen reads a tier string; the
   paywall becomes a catalog/data change (future-proofing #3).
3. **`src/core` is the single source of truth for any dual-home rule** — the SQL predicate mirrors
   the pure function and is validated against it (D1 debt: no formula drift).
4. **Append-only + immutability trigger as the standard for any new ledger/history table** (to be
   applied the first time a ledger ships in Phase B — #25.6).

## Deliberately NOT done in Phase A (deferred, with the seam left)

- **The `can_view` cutover** (swapping `can_view`'s body to call `can_view_via_memberships`) +
  the **backfill** from the four legacy link tables → documented in `0011`'s footer as a go-live
  step. It changes behavior and needs realistic seed data + the `orgs`→`organizations` rename
  validated first. **[Phase B]**
- **The deep `programs`/`groups`/`invitations`/`membership_events` tree** — authored later;
  `org_memberships` models it as scope today. **[Phase C / DON'T BUILD YET]**
- **Org-keying the `subscriptions` table** (today `owner_id`) — a documented EVOLVE; the pure
  `hasFeature` seam is tier-based and ready. **[Phase B when billing goes live]**
- **Wiring any of these seams into screens** — Phase A is seams only; adoption is incremental.

## What unblocks Phase B (founder-gated — the crew cannot do these)

Phase B = the live loop for one coach + one team. The code-side the crew *can* still author
(validated on throwaway PG): the `can_view` cutover migration + backfill, RLS deny-case tests,
and the consent-on-sync-drain enforcement seam. The **founder-gated** steps that actually make it
live: apply the migrations to the live project, flip `EXPO_PUBLIC_BACKEND_LIVE=true`, a real
device, and a meal-analysis model key. Until those, the wedge stays flag-OFF and byte-identical.
