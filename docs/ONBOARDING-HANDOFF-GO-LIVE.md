# Onboarding Handoff — Go-Live Runbook

Deployment guide for the onboarding/first-day/coach-OS work shipped on `compliance-fixes`
(11 commits, `1d02faa` → `1352b16`). The **client is already built** into `assets/proto.zip`
and rides the normal app ship. What remains is **applying seven authored migrations** to the
database and verifying RLS.

---

## 1. Status at a glance

| Layer | State |
|---|---|
| Client (proto WebView, all 11 slices + standards-editor redesign) | ✅ Built into `proto.zip`; `npm run verify` green (lint, tsc 0, 2160 tests, `expo export`) |
| Browser QA | ✅ Athlete first-day (midday **and** late-night/all-windows-closed), coach empty dashboard, standards editor (redesign + functional), coach create/join fork |
| Migrations `0080`–`0086` | ⏳ **Authored, NOT applied.** Apply per §3 before or with the app ship |
| `test:rls` | ⚠️ **Not run here** — this workstation has the supabase CLI but no Docker/psql, so the local stack can't start. Run it during deploy (§3) |

The client is **backward-compatible with the un-migrated DB**: every new feature degrades safely
if its migration isn't applied yet (e.g. new staff-role chips just fail to mint until `0083`;
the org "Verified" badge simply never shows; standard versioning falls back to the single-row
behavior; grace/late default to the shipped half-credit rule). So there is no hard ordering
requirement between the app ship and the migrations — but applying the migrations first is
cleanest.

---

## 2. What each migration does

Apply in numeric order. `0080`/`0081` were authored earlier in this handoff; `0082`–`0086` are new.

| # | File | Purpose | Notes / risk |
|---|---|---|---|
| 0080 | `join_code_expiry` | Opt-in expiry on team/practice join codes (`NULL` = never) | Additive; grandfathers existing codes |
| 0081 | `guardian_scoped_access` | Parent/guardian invite table + score/grade-only read RPCs; **removes `is_guardian_of` from `can_view` (fail-closed)** | Unblocks the shipped parent screens. Verify guardian probes in `test:rls` |
| 0082 | `staff_roles_v2` | `ALTER TYPE staff_role ADD VALUE` s_and_c / athletic_trainer / team_admin | Split-file rule: values added here, **used** in 0083 (separate tx). Idempotent (`if not exists`) |
| 0083 | `staff_roles_v2_logic` | Widen `create_staff_invite` + `set_staff_role` allow-lists to the new roles | `create or replace`, same signatures. head_coach stays un-mintable |
| 0084 | `org_verification` | `orgs.verification_status`; marks the ~525 seeded official orgs `verified` | Additive column + one `UPDATE ... where created_by is null`. Badge-only, no gate |
| 0085 | `standard_versioning` | `requirement_sets.effective_date`; index → `(team,scope,effective_date)`; `set_team_requirements` gains `p_effective_date` | **Drops** the 4-arg `set_team_requirements` and creates the 5-arg. Existing rows have `effective_date NULL` → the always-in-effect base; the new unique index builds without conflict |
| 0086 | `standard_item_depth` | Extends `validate_requirement_items` with optional `grace`/`latePolicy`/`coachReview`/`snack`/`dayType` rails | `create or replace`, IMMUTABLE, same signature → safe under the `requirement_sets_items_valid` check constraint. All rails optional → every existing set still validates |

### Dependency review (verified statically)
- `0083` uses the enum values added in `0082` → correct order, separate transactions. ✅
- `0085` drops exactly `set_team_requirements(uuid,text,text,jsonb)` (defined in 0055, redefined in 0078) and creates the 5-arg version. Both client callers pass ≤5 args and resolve to it (team-creation seed → `NULL` base; editor → dated version). ✅
- `0085`'s `on conflict` target matches the new unique-index expression exactly. ✅
- `0086` recreates `validate_requirement_items` with the same signature/volatility used by the check constraint. ✅
- No views/triggers depend on the dropped/recreated functions (they are SECURITY DEFINER RPCs). ✅

---

## 3. Deploy procedure

**Do NOT `db push` straight to prod.** Verify against a throwaway/local DB first (repo convention
for `0080`/`0081`).

```bash
# 1. Verify on a disposable DB (local stack needs Docker; or a throwaway linked project)
supabase start                      # or link a fresh throwaway project
supabase db reset                   # applies ALL migrations 0001..0086 from scratch — this is
                                    # the real proof that 0082–0086 apply cleanly in order
npm run test:rls                    # runs supabase/tests/rls_authz_test.sql (needs psql on PATH)
#   -> expect: every assertion PASS, including the new sections:
#      "roles v2: head coach mints ... Strength & Conditioning / Athletic Trainer / Team Admin"
#      "versioning: a future-dated edit adds a version alongside the base"
#      "versioning: re-saving the same effective date replaces it — no duplicate row"
#      "versioning: the base version is untouched — today is unchanged"

# 2. Apply to prod (founder-gated)
supabase db push                    # applies the pending migrations to the linked prod DB
```

If `supabase db reset` fails on any migration, fix that migration before touching prod. If
`test:rls` reports a FAIL, do not push.

---

## 4. Post-deploy verification checklist

- [ ] `supabase db reset` applied 0001→0086 with no errors
- [ ] `npm run test:rls` — all PASS (esp. the roles-v2 + versioning + guardian sections)
- [ ] App ships with the current `proto.zip` (`scripts/preflight.mjs` rebuilds it; `protoVersion.ts` hash is committed)
- [ ] Coach can mint a **Strength & Conditioning / Athletic Trainer / Team Admin** staff invite (0083)
- [ ] Editing a team standard with **"Effective from · Tomorrow"** does **not** change today's scores (0085)
- [ ] A **grace window** meal logged late still scores full; **Late = none** zeroes it (0086 + client)
- [ ] Athletes see the **"✓ Verified"** badge on official schools in directory search (0084)
- [ ] Parent invite/redeem works and a guardian sees **score/grade only** (0081)

---

## 5. Rollback

All seven are forward-only and additive/replacing; there is no destructive data change.
- `0084` (a column + one UPDATE) and `0086`/`0083` (function bodies) are trivially safe to leave.
- `0085` changes the `requirement_sets` unique index and the `set_team_requirements` arity. To
  revert, restore the 4-arg function from `0078` and the `(team,scope)` unique index — but note
  any versioned rows written after go-live would then collide, so prefer fixing forward.

---

## 6. What is verified vs. what needs the DB

**Verified here:** the full client (2160 unit tests incl. first-day activation, versioned
resolver, grace/late scoring, staff-role caps, coach empty-state, onboarding branches), the app
build, and a browser walk of the key first-day/onboarding surfaces. Migrations were reviewed
statically for ordering, dependencies, idempotency, and constraint safety.

**Needs the DB (run during deploy):** `test:rls` — proves the migrations apply and RLS holds.
This could not run on the build workstation (no Docker/psql).
