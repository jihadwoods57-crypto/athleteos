# Feature Flags & Kill-Switch Infrastructure (v1) — Design

**Date:** 2026-07-21
**Status:** Approved (design) — building
**Scope:** Handoff Section 26 ("Feature Flags and Release Control"), plus the runtime kill-switch the handoff mandates across every new module. This is the foundational slice: the safe-rollout substrate the rest of the handoff phases depend on.
**Decision:** Lean + allowlists (not the full env/role/org/cohort/%/experiment matrix). Approach A (server-authoritative table + one pure evaluator). Founder authorized minimal human-validation gates.

---

## 1. Goal & posture

Give OnStandard a **runtime** feature-flag + kill-switch system so new handoff work can be dogfooded to the founder/beta, rolled out deliberately, and killed instantly if it misbehaves — without an app rebuild. Today's "flags" are build-time env booleans (`src/lib/features.ts`); flipping one means a rebuild + resubmit. That is not a kill-switch.

v1 is **lean + allowlists**: a global default per flag, a kill-switch, and explicit allowlists (specific users, roles, or orgs). It deliberately **excludes** percentage rollout, cohort definitions, and A/B experiment buckets — statistically meaningless at current user counts (YAGNI). The evaluator is written so those can be added later without reshaping consumers.

Hard rules honored:
- **Evaluation authority is server-side.** The client never evaluates and never receives the raw config/allowlists (so "who is in beta" cannot leak). Clients receive only a `{name: bool}` projection for their own context.
- **Enforcement ≠ UX gating.** Client cache is eventually-consistent (flips next launch/resume). Anything security- or cost-critical is re-checked server-side at the point of action, where a kill-switch is immediate.
- **Fail safe.** A flag-fetch failure or an unknown flag never crashes the app and never silently enables a gated feature — it falls back to the last cache, then to a compile-time safe default.
- **Every flag mutation is audited.**

---

## 2. Data layer — two migrations' worth of tables (one migration file)

**Migration `0109_feature_flags.sql`** (next free number after 0107; 0108 is reserved by the admin-center design). Both tables are **service-role / platform-admin only** — RLS denies all `authenticated`/`anon` read and write. Clients never touch them directly; all access is via `SECURITY DEFINER` RPCs and the service-role edge functions.

**`public.feature_flags`** — one row per flag:
| column | type | notes |
|---|---|---|
| `name` | `text` primary key | stable slug, e.g. `coach_voice_v2` |
| `description` | `text not null default ''` | human-readable purpose |
| `default_on` | `boolean not null default false` | value when no allowlist matches |
| `kill_switch` | `boolean not null default false` | when true, always OFF (overrides everything) |
| `enabled_user_ids` | `uuid[] not null default '{}'` | allowlist: exact users |
| `enabled_roles` | `text[] not null default '{}'` | allowlist: roles (`athlete`,`coach`,`trainer`,`parent`,`nutritionist`,`platform_admin`, …) |
| `enabled_org_ids` | `uuid[] not null default '{}'` | allowlist: orgs |
| `updated_by` | `uuid` | last editor (fk `auth.users`, `on delete set null`) |
| `updated_at` | `timestamptz not null default now()` | |
| `created_at` | `timestamptz not null default now()` | |

**`public.admin_audit_log`** — general founder-action audit (flag edits are its first writer; the Admin Center design and the future automations layer reuse it):
| column | type | notes |
|---|---|---|
| `id` | `bigint generated always as identity` primary key | |
| `actor_id` | `uuid` | who did it (fk `auth.users`, `on delete set null`) |
| `action` | `text not null` | e.g. `feature_flag.set` |
| `target` | `text` | e.g. the flag name |
| `before` | `jsonb` | prior state (null on create) |
| `after` | `jsonb` | new state |
| `created_at` | `timestamptz not null default now()` | |

Index: `admin_audit_log (created_at desc)` for the admin center's recent-actions view.

**Grants:** no `grant` to `authenticated` on either table (0013 revoked the default; we deliberately do NOT re-grant — access is RPC-only). This is the inverse of the [supabase-table-grants gotcha]: here we *want* the tables ungranted.

---

## 3. Evaluation — one pure, dependency-free module

**`supabase/functions/_shared/feature-flags.ts`** exports:

```ts
export type FlagRow = {
  name: string; default_on: boolean; kill_switch: boolean;
  enabled_user_ids: string[]; enabled_roles: string[]; enabled_org_ids: string[];
};
export type FlagContext = { userId?: string | null; role?: string | null; orgId?: string | null };

// Pure. No imports. Deno AND jest (via tsx) both consume this exact file.
export function evaluateFlag(flag: FlagRow, ctx: FlagContext): boolean {
  if (flag.kill_switch) return false;
  if (ctx.userId && flag.enabled_user_ids.includes(ctx.userId)) return true;
  if (ctx.role && flag.enabled_roles.includes(ctx.role)) return true;
  if (ctx.orgId && flag.enabled_org_ids.includes(ctx.orgId)) return true;
  return flag.default_on;
}

export function evaluateAll(flags: FlagRow[], ctx: FlagContext): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const f of flags) out[f.name] = evaluateFlag(f, ctx);
  return out;
}
```

Dependency-free is the whole trick: no Deno URL imports, no Node built-ins, so `jest` can import the same physical file the edge functions run — one implementation, unit-tested per branch. (Same "pure module shared by browser + jest" pattern already proven with `web/admin/attention.js`.)

**Precedence is fixed and total:** kill-switch → user allowlist → role allowlist → org allowlist → default. Documented in the module header so it's unambiguous.

---

## 4. Server surfaces

**`flags` edge function** (`supabase/functions/flags/index.ts`) — the client projection:
- Authenticated `GET`. Resolves the caller's context (`userId` from JWT; `role` + `orgId` from `profiles`/membership using the service-role client, the same way other functions resolve identity).
- Loads all `feature_flags` rows (service role), runs `evaluateAll`, returns `{ flags: {name: boolean}, fetched_at: iso }`.
- CORS + `ALLOWED_ORIGINS` handling consistent with existing functions. No secrets to the client. Never returns allowlist contents.

**`admin_set_flag(...)` RPC** (`SECURITY DEFINER`, `is_platform_admin()`-gated) — the only write path:
- Signature: `admin_set_flag(p_name text, p_description text, p_default_on boolean, p_kill_switch boolean, p_enabled_user_ids uuid[], p_enabled_roles text[], p_enabled_org_ids uuid[])`.
- Upserts the row, sets `updated_by = auth.uid()`, and writes an `admin_audit_log` row (`action='feature_flag.set'`, `target=p_name`, `before`=prior row as jsonb or null, `after`=new row as jsonb) in the same statement. Non-admin → raises `not authorized`.
- Companion read RPC `admin_list_flags()` (`is_platform_admin()`-gated) returns all flag rows incl. allowlists, for the admin panel only.

**Enforcement in gating edge functions:** a function that must gate a risky/paid feature imports `_shared/feature-flags.ts`, loads the one flag row (service role, short-lived cache acceptable), and calls `evaluateFlag` for the acting user. Kill-switch is immediate there. (No consumer is wired in v1 beyond the migrated flags — see §6 — but the pattern is established and documented.)

---

## 5. Client (RN)

- **Store:** a small zustand slice `flagsStore` holding `{ map: Record<string,bool>, fetchedAt, source: 'network'|'cache'|'default' }`, hydrated from AsyncStorage on boot.
- **Fetch:** call the `flags` function on app launch and on foreground-resume. On success, replace the map + persist. On failure/offline, keep the last cache; if no cache, use `DEFAULT_FLAGS` (compile-time constants). Fetch is **fire-and-forget** — it never blocks render or navigation.
- **Read API:** `useFlag(name: string): boolean` and a non-hook `getFlag(name)` for imperative paths. Unknown name → the compile-time default for that name, else `false`.
- **`src/lib/features.ts` bridge:** the existing `isEnginesEnabled` etc. become thin readers that prefer the runtime flag and fall back to the current env boolean as the compile-time default. No call-site churn beyond `features.ts` itself.

---

## 6. Migrate the existing env flags (proves it end-to-end, zero behavior change)

Seed rows for the 5 current flags — `engines`, `meal_plans`, `trust_pass`, `streak_grace`, `assistant_gate` — each with `default_on` = the value that env currently resolves to in production, `kill_switch=false`, empty allowlists. Because `features.ts` falls back to env as the default, **no user experiences any change**; we've simply moved the source of truth to something we can flip at runtime. This is the acceptance proof that the whole loop (table → `flags` fn → client cache → `useFlag`) works on real flags.

---

## 7. States

Loading (no cache yet) → defaults. Success → network map. Stale (fetch failed) → last cache. Offline → last cache/defaults. Unknown flag → its default. Kill-switched → OFF everywhere (immediate server-side, next-launch client-side). Admin write by non-admin → rejected + not audited.

## 8. Permissions

- Read own flags: any authenticated user, own context only, via `flags` fn.
- List all flags incl. allowlists / write flags: `platform_admin` only, via RPCs.
- Tables: no direct client access (RLS deny-all for non-service-role).

## 9. Analytics / notifications

- Emit an `analytics_events` row `flag_evaluated`? No — too chatty and low value. Instead the `flags` fn optionally logs a single `flags_fetched` count. Founder visibility into flag *state* comes from the admin panel, not an event stream.
- No user-facing notifications.

## 10. Founder controls

The `web/admin` flags panel (login-gated, `admin_list_flags`/`admin_set_flag`): list flags, toggle `default_on`/`kill_switch`, edit allowlists, see `updated_by`/`updated_at`. This is the Admin Center's first write-action and first audit-log surface.

## 11. Tests

- **jest (pure):** `evaluateFlag` truth table — kill-switch overrides every allowlist and default; each allowlist path (user/role/org) independently flips on; empty context falls to default; precedence order. `evaluateAll` maps names.
- **jest (client):** `flagsStore` fetch-success replaces+persists; fetch-failure keeps cache; cold-start-no-cache uses defaults; `useFlag` unknown-name → default.
- **RLS suite (Docker):** non-admin cannot select/insert/update `feature_flags` or `admin_audit_log`; `admin_set_flag` rejects non-admin, succeeds for admin, and writes exactly one audit row with correct before/after; `flags` fn returns only booleans (no allowlist leak).
- Ship gate: `npm run verify` green + RLS suite green before the migration is applied (tier-1 hard trigger).

## 12. Acceptance criteria

1. A flag can be created/edited at runtime by the founder and takes effect without an app rebuild (server immediately; client next launch/resume).
2. `kill_switch=true` forces the feature OFF for everyone, overriding all allowlists — enforced immediately server-side.
3. A flag can be enabled for a single user (dogfood) without enabling it for anyone else.
4. Clients never receive allowlist contents; a non-admin cannot read who is on a list.
5. Flag fetch failure or an unknown flag never crashes the app and never enables a gated feature by accident.
6. Every flag mutation writes an `admin_audit_log` row with actor, before, and after.
7. The 5 migrated env flags produce identical behavior to today.

## 13. Rollout

Ship behind nothing (it *is* the rollout substrate). Migration `0109` applied after green verify + RLS. Deploy `flags` fn. The `flags` fn + client fetch degrade safely if the migration isn't yet applied (empty flag set → all defaults). Order: migration → deploy `flags` fn → ship client build reading it → migrate `features.ts` call sites. No user-visible change at any step.

## 14. Files

- Create: `supabase/migrations/0109_feature_flags.sql` (tables, RLS, `admin_set_flag`, `admin_list_flags`, seed 5 flags).
- Create: `supabase/functions/_shared/feature-flags.ts` (pure evaluator).
- Create: `supabase/functions/flags/index.ts` (client projection fn).
- Create: `src/state/flagsStore.ts` (zustand + AsyncStorage), `src/lib/useFlag.ts` (`useFlag`/`getFlag`, `DEFAULT_FLAGS`).
- Modify: `src/lib/features.ts` (prefer runtime flag, env as default).
- Create: `web/admin/flags.js` + panel markup in `web/admin/index.html` (or the admin shell if it lands first).
- Test: `src/core/featureFlags.test.ts` (evaluator), `src/state/flagsStore.test.ts` (client), RLS test in `supabase/tests/`.

## 15. Explicitly NOT v1

Percentage/gradual rollout, cohort definitions, A/B experiment buckets, environment targeting (single prod today), scheduled flag changes, per-flag analytics streams, and a client SDK beyond `useFlag`. The evaluator's shape leaves room for `rollout_pct`/`cohorts` later without breaking callers.
