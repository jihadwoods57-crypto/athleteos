# Feature Flags & Kill-Switch Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give OnStandard a runtime feature-flag + kill-switch system (global default + kill-switch + user/role/org allowlists) that gates new work safely without an app rebuild.

**Architecture:** Server-authoritative. One dependency-free pure evaluator (`_shared/feature-flags.ts`) is consumed by both Deno edge functions and jest. Two admin/service-role-only tables (`feature_flags`, `admin_audit_log`) are written only via a platform-admin `SECURITY DEFINER` RPC that audits every change. A `flags` edge function projects each caller's evaluated `{name: bool}` map; the RN client fetches it at launch, caches it, and reads it via `useFlag`. Clients never see raw config or allowlists.

**Tech Stack:** Deno (Supabase Edge Functions), Postgres/plpgsql (migrations + RLS), React Native + Expo + zustand (client), jest (unit tests), plain-SQL RLS harness.

## Global Constraints

- Supabase migrations: next free number is **`0109`** (0108 is reserved by the admin-center design). One migration file for this slice.
- Both new tables get **no `grant` to `authenticated`/`anon`** — access is service-role (functions) + `SECURITY DEFINER` RPC only. Do NOT re-grant (inverse of the usual table-grants gotcha — here ungranted is correct).
- Admin gate is the existing `is_platform_admin()` (defined in 0037; reads `platform_admins`). Reuse it verbatim; never reinvent.
- Edge functions: `import { createClient } from "npm:@supabase/supabase-js@2";`, `Deno.serve`, service role from `Deno.env.get("SUPABASE_URL")` / `SUPABASE_SERVICE_ROLE_KEY`. Match `analytics-ingest` for CORS + JSON helper shape.
- The pure evaluator MUST have **zero imports** (so Deno and jest both load the exact same file).
- Fail-safe: a flag fetch failure or unknown flag never crashes the app and never enables a gated feature — fall back to last cache, then compile-time default.
- Ship gate: `npm run verify` green + RLS suite green (`npm run test:rls`, needs Docker) BEFORE the migration is treated as done.
- Commit per task. Only `git add` the exact files listed — the working tree has many unrelated untracked files and a possible concurrent committer; never `git add -A`.

---

### Task 1: Pure flag evaluator

**Files:**
- Create: `supabase/functions/_shared/feature-flags.ts`
- Test: `src/core/featureFlags.test.ts`

**Interfaces:**
- Produces: `evaluateFlag(flag: FlagRow, ctx: FlagContext): boolean`, `evaluateAll(flags: FlagRow[], ctx: FlagContext): Record<string, boolean>`, types `FlagRow`, `FlagContext`.
- `FlagRow = { name: string; default_on: boolean; kill_switch: boolean; enabled_user_ids: string[]; enabled_roles: string[]; enabled_org_ids: string[] }`
- `FlagContext = { userId?: string | null; role?: string | null; orgId?: string | null }`
- Precedence (total, fixed): kill_switch → user allowlist → role allowlist → org allowlist → default_on.

- [ ] **Step 1: Write the failing test**

Create `src/core/featureFlags.test.ts`:
```ts
import { evaluateFlag, evaluateAll, type FlagRow } from '../../supabase/functions/_shared/feature-flags';

const base: FlagRow = {
  name: 'f', default_on: false, kill_switch: false,
  enabled_user_ids: [], enabled_roles: [], enabled_org_ids: [],
};

describe('evaluateFlag', () => {
  test('default_on governs when nothing matches', () => {
    expect(evaluateFlag({ ...base, default_on: true }, {})).toBe(true);
    expect(evaluateFlag({ ...base, default_on: false }, {})).toBe(false);
  });
  test('user allowlist flips on', () => {
    expect(evaluateFlag({ ...base, enabled_user_ids: ['u1'] }, { userId: 'u1' })).toBe(true);
    expect(evaluateFlag({ ...base, enabled_user_ids: ['u1'] }, { userId: 'u2' })).toBe(false);
  });
  test('role allowlist flips on', () => {
    expect(evaluateFlag({ ...base, enabled_roles: ['coach'] }, { role: 'coach' })).toBe(true);
  });
  test('org allowlist flips on', () => {
    expect(evaluateFlag({ ...base, enabled_org_ids: ['o1'] }, { orgId: 'o1' })).toBe(true);
  });
  test('kill_switch overrides every allowlist and default', () => {
    const f = { ...base, default_on: true, kill_switch: true, enabled_user_ids: ['u1'], enabled_roles: ['coach'], enabled_org_ids: ['o1'] };
    expect(evaluateFlag(f, { userId: 'u1', role: 'coach', orgId: 'o1' })).toBe(false);
  });
  test('empty context never throws and yields default', () => {
    expect(evaluateFlag({ ...base, enabled_user_ids: ['u1'], default_on: true }, {})).toBe(true);
  });
});

describe('evaluateAll', () => {
  test('maps every flag by name', () => {
    const flags: FlagRow[] = [
      { ...base, name: 'a', default_on: true },
      { ...base, name: 'b', enabled_user_ids: ['u1'] },
    ];
    expect(evaluateAll(flags, { userId: 'u1' })).toEqual({ a: true, b: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/featureFlags.test.ts`
Expected: FAIL — cannot find module `../../supabase/functions/_shared/feature-flags`.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/_shared/feature-flags.ts`:
```ts
// OnStandard — pure feature-flag evaluator. ZERO imports on purpose: this exact file is
// loaded by both Deno edge functions (import '../_shared/feature-flags.ts') and jest (babel
// resolves the .ts), so there is ONE implementation of the rule, unit-tested per branch.
//
// Precedence is total and fixed: kill_switch → user → role → org → default_on.

export type FlagRow = {
  name: string;
  default_on: boolean;
  kill_switch: boolean;
  enabled_user_ids: string[];
  enabled_roles: string[];
  enabled_org_ids: string[];
};

export type FlagContext = { userId?: string | null; role?: string | null; orgId?: string | null };

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/featureFlags.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/feature-flags.ts src/core/featureFlags.test.ts
git commit -m "feat(flags): pure feature-flag evaluator + truth-table tests"
```

---

### Task 2: Migration — tables, RLS, audited write RPC, admin read RPC, seed

**Files:**
- Create: `supabase/migrations/0109_feature_flags.sql`
- Modify: `supabase/tests/rls_authz_test.sql` (append a feature-flags authz section)

**Interfaces:**
- Produces (SQL): tables `public.feature_flags`, `public.admin_audit_log`; functions `admin_set_flag(text,text,boolean,boolean,uuid[],text[],uuid[])`, `admin_list_flags()`.
- `admin_set_flag` upserts by `name`, sets `updated_by = auth.uid()`, writes one `admin_audit_log` row (`action='feature_flag.set'`, before/after jsonb). Raises `not authorized` for non-admins.
- `admin_list_flags()` returns all flag rows incl. allowlists (admin only).
- Consumes: `is_platform_admin()` (0037).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0109_feature_flags.sql`:
```sql
-- OnStandard — runtime feature flags + kill-switch + allowlists (handoff Section 26).
--
-- Server-authoritative: evaluation happens in edge functions via _shared/feature-flags.ts.
-- These tables are RPC/service-role ONLY. Normal roles get NOTHING (no grant to authenticated),
-- so allowlist membership ("who is in beta") can never leak to a client. Every write is audited.

create table if not exists public.feature_flags (
  name             text primary key,
  description      text not null default '',
  default_on       boolean not null default false,
  kill_switch      boolean not null default false,
  enabled_user_ids uuid[]  not null default '{}',
  enabled_roles    text[]  not null default '{}',
  enabled_org_ids  uuid[]  not null default '{}',
  updated_by       uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  target     text,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created on public.admin_audit_log (created_at desc);

-- RPC/service-role only. No anon/authenticated read or write (intentionally ungranted).
alter table public.feature_flags  enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on table public.feature_flags  from anon, authenticated;
revoke all on table public.admin_audit_log from anon, authenticated;

-- ---------------------------------------------------------------- admin read
create or replace function public.admin_list_flags()
returns setof public.feature_flags
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query select * from public.feature_flags order by name;
end $$;
grant execute on function public.admin_list_flags() to authenticated;

-- ---------------------------------------------------------------- audited write
create or replace function public.admin_set_flag(
  p_name text,
  p_description text,
  p_default_on boolean,
  p_kill_switch boolean,
  p_enabled_user_ids uuid[],
  p_enabled_roles text[],
  p_enabled_org_ids uuid[]
) returns public.feature_flags
language plpgsql volatile security definer set search_path = public as $$
declare
  v_before jsonb;
  v_row public.feature_flags;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;

  select to_jsonb(f) into v_before from public.feature_flags f where f.name = p_name;

  insert into public.feature_flags as f
    (name, description, default_on, kill_switch, enabled_user_ids, enabled_roles, enabled_org_ids, updated_by, updated_at)
  values
    (p_name, coalesce(p_description,''), coalesce(p_default_on,false), coalesce(p_kill_switch,false),
     coalesce(p_enabled_user_ids,'{}'), coalesce(p_enabled_roles,'{}'), coalesce(p_enabled_org_ids,'{}'),
     auth.uid(), now())
  on conflict (name) do update set
    description      = excluded.description,
    default_on       = excluded.default_on,
    kill_switch      = excluded.kill_switch,
    enabled_user_ids = excluded.enabled_user_ids,
    enabled_roles    = excluded.enabled_roles,
    enabled_org_ids  = excluded.enabled_org_ids,
    updated_by       = excluded.updated_by,
    updated_at       = now()
  returning * into v_row;

  insert into public.admin_audit_log (actor_id, action, target, before, after)
  values (auth.uid(), 'feature_flag.set', p_name, v_before, to_jsonb(v_row));

  return v_row;
end $$;
grant execute on function public.admin_set_flag(text,text,boolean,boolean,uuid[],text[],uuid[]) to authenticated;

-- ---------------------------------------------------------------- seed: the 5 existing env flags
-- default_on = each flag's current production-effective value (all OFF today). Env stays the
-- compile-time fallback in features.ts; moving the source of truth here changes NO user behavior.
insert into public.feature_flags (name, description, default_on) values
  ('engines',        'Nutrition Intelligence + Accountability engine UI entry points', false),
  ('meal_plans',     'Structured prescribed meals + plan compliance', false),
  ('trust_pass',     'Coach-granted camera-free daily credit', false),
  ('streak_grace',   'One forgiven sub-threshold day per trailing 7', false),
  ('assistant_gate', 'Assistant Nutritionist paywall gate', false)
on conflict (name) do nothing;
```

- [ ] **Step 2: Append RLS/authz checks**

In `supabase/tests/rls_authz_test.sql`, before the final scoreboard/rollback, append (uses the file's existing `_ok`, `_as`, `_try`, `_superuser` harness; `rando` is an existing authenticated actor with no links — reuse it as the non-admin):
```sql
-- ---------------------------------------------------------------- feature flags (0109)
-- A non-admin cannot read or write the flag tables directly...
perform _as(rando);
perform _ok(_try($f$ select * from public.feature_flags $f$) <> 'ok', 'ff: rando cannot select feature_flags');
perform _ok(_try($f$ insert into public.feature_flags(name) values ('x') $f$) <> 'ok', 'ff: rando cannot insert feature_flags');
perform _ok(_try($f$ select * from public.admin_audit_log $f$) <> 'ok', 'ff: rando cannot select admin_audit_log');

-- ...and cannot call the admin RPCs (they raise not-authorized for non-admins).
perform _ok(_try($f$ select public.admin_list_flags() $f$) <> 'ok', 'ff: rando denied admin_list_flags');
perform _ok(_try($f$ select public.admin_set_flag('x','',true,false,'{}','{}','{}') $f$) <> 'ok', 'ff: rando denied admin_set_flag');
perform _superuser();
```

Note: if the suite's fixtures do not already register `rando` in `platform_admins`, these pass by the not-authorized path. A positive admin-write test (admin succeeds + audit row written) requires inserting the actor into `platform_admins`; if the harness lacks a platform-admin actor, add one alongside the existing actor seed at the top of the file:
```sql
-- (only if no platform-admin actor exists yet in the fixture block)
insert into platform_admins(user_id) values ('00000000-0000-0000-0000-0000000000ad') on conflict do nothing;
```
Then, in the appended section:
```sql
perform _as('00000000-0000-0000-0000-0000000000ad');
perform _ok(_try($f$ select public.admin_set_flag('probe','p',true,false,'{}','{}','{}') $f$) = 'ok', 'ff: admin can set flag');
perform _superuser();
perform _ok((select count(*) from public.admin_audit_log where target='probe' and action='feature_flag.set') = 1, 'ff: admin_set_flag wrote exactly one audit row');
```

- [ ] **Step 3: Run the RLS suite (requires Docker + local Supabase)**

Run: `npm run test:rls`
Expected: scoreboard prints; all `ff:` checks PASS; suite exits 0. (If Docker/local DB is unavailable in this environment, note it and defer this step to the founder's local run — do NOT mark the migration done without it.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0109_feature_flags.sql supabase/tests/rls_authz_test.sql
git commit -m "feat(flags): 0109 feature_flags + admin_audit_log, audited admin_set_flag, RLS tests"
```

---

### Task 3: `flags` edge function (client projection)

**Files:**
- Create: `supabase/functions/flags/index.ts`

**Interfaces:**
- Consumes: `_shared/feature-flags.ts` (`evaluateAll`, `FlagRow`); service role client.
- Produces: `GET` → `{ flags: Record<string,bool>, fetched_at: string }`. Never returns allowlist contents.
- Auth: requires a caller JWT; resolves `userId` from it, `role`/`orgId` best-effort from `profiles`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/flags/index.ts`:
```ts
// OnStandard — per-caller feature-flag projection. Evaluates ALL flags for the authenticated
// caller server-side and returns ONLY a { name: boolean } map. Raw config/allowlists never
// leave the server, so "who is in beta" cannot leak. See _shared/feature-flags.ts for the rule.
//
// Deploy (founder): supabase functions deploy flags   (URL + SERVICE_ROLE auto-injected).
import { createClient } from "npm:@supabase/supabase-js@2";
import { evaluateAll, type FlagRow } from "../_shared/feature-flags.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "unavailable" }, 503);

  // Resolve the caller from their JWT (service client + getUser(jwt) — no elevated trust from body).
  const authz = req.headers.get("Authorization") || "";
  const jwt = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  const sb = createClient(url, key);

  let userId: string | null = null;
  if (jwt) {
    const { data } = await sb.auth.getUser(jwt);
    userId = data.user?.id ?? null;
  }

  // Best-effort role/org enrichment (select('*') so a missing column can't error the request).
  let role: string | null = null;
  let orgId: string | null = null;
  if (userId) {
    const { data: prof } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
    role = (prof?.role as string) ?? (prof?.signup_role as string) ?? null;
    orgId = (prof?.org_id as string) ?? null;
  }

  const { data: flags, error } = await sb.from("feature_flags").select(
    "name, default_on, kill_switch, enabled_user_ids, enabled_roles, enabled_org_ids",
  );
  if (error) return json({ error: "unavailable" }, 503);

  const map = evaluateAll((flags ?? []) as FlagRow[], { userId, role, orgId });
  return json({ flags: map, fetched_at: new Date().toISOString() });
});
```

- [ ] **Step 2: Type-check the shared import path resolves for Deno**

Run: `npx tsc --noEmit` (repo typecheck; confirms `_shared/feature-flags.ts` exports are consumed with correct types).
Expected: PASS (no new errors introduced by the import).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/flags/index.ts
git commit -m "feat(flags): flags edge function — per-caller evaluated projection"
```

---

### Task 4: RN client — store, `useFlag`, defaults, launch fetch, features bridge

**Files:**
- Create: `src/store/flagsStore.ts`
- Create: `src/lib/useFlag.ts`
- Test: `src/store/flagsStore.test.ts`
- Modify: `src/lib/features.ts` (prefer runtime flag; env stays the compile-time default)
- Modify: the app root that hydrates the session (likely `app/_layout.tsx`) — trigger a flags refresh at launch/resume.

**Interfaces:**
- Produces: `useFlagsStore` (zustand) with `{ map: Record<string,boolean>; source: 'network'|'cache'|'default'; refresh(): Promise<void>; }`; `DEFAULT_FLAGS: Record<string, boolean>`; `useFlag(name: string): boolean`; `getFlag(name: string): boolean`.
- Consumes: the `flags` edge function URL from `process.env.EXPO_PUBLIC_FLAGS_URL`; the session access token from `useStore`.

- [ ] **Step 1: Write the failing store test**

Create `src/store/flagsStore.test.ts`:
```ts
import { useFlagsStore, DEFAULT_FLAGS, getFlag } from './flagsStore';

// minimal fetch mock helper
function mockFetchOnce(payload: unknown, ok = true) {
  (global as any).fetch = jest.fn().mockResolvedValueOnce({
    ok, json: async () => payload,
  });
}

beforeEach(() => {
  useFlagsStore.setState({ map: { ...DEFAULT_FLAGS }, source: 'default' });
});

describe('flagsStore', () => {
  test('refresh success replaces the map and marks source=network', async () => {
    mockFetchOnce({ flags: { engines: true }, fetched_at: 'now' });
    await useFlagsStore.getState().refresh();
    expect(useFlagsStore.getState().map.engines).toBe(true);
    expect(useFlagsStore.getState().source).toBe('network');
  });

  test('refresh failure keeps existing map and does not throw', async () => {
    useFlagsStore.setState({ map: { engines: true }, source: 'cache' });
    (global as any).fetch = jest.fn().mockRejectedValueOnce(new Error('offline'));
    await expect(useFlagsStore.getState().refresh()).resolves.toBeUndefined();
    expect(useFlagsStore.getState().map.engines).toBe(true); // unchanged
  });

  test('getFlag returns compile-time default for an unknown flag', () => {
    useFlagsStore.setState({ map: {}, source: 'default' });
    expect(getFlag('does_not_exist')).toBe(false);
  });

  test('getFlag reads a known default when map is empty', () => {
    useFlagsStore.setState({ map: {}, source: 'default' });
    // DEFAULT_FLAGS provides the safe fallback
    expect(getFlag('engines')).toBe(DEFAULT_FLAGS.engines ?? false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/store/flagsStore.test.ts`
Expected: FAIL — cannot find module `./flagsStore`.

- [ ] **Step 3: Implement the store + hooks**

Create `src/store/flagsStore.ts`:
```ts
// OnStandard — runtime feature-flag client cache. Fetches the per-caller { name: bool } map from
// the `flags` edge function at launch/resume, persists it, and serves reads. NEVER blocks render:
// on failure it keeps the last cache, and unknown flags fall back to DEFAULT_FLAGS (compile-time
// safe defaults). This is UX gating (eventually-consistent); security-critical gates are re-checked
// server-side in the relevant edge function.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { useStore } from './useStore';

// Compile-time safe defaults — mirror the seeded flags' default_on (all OFF today). If the network
// map is missing a key, this governs. Keep in sync with the 0109 seed.
export const DEFAULT_FLAGS: Record<string, boolean> = {
  engines: false,
  meal_plans: false,
  trust_pass: false,
  streak_grace: false,
  assistant_gate: false,
};

const CACHE_KEY = 'os.flags.v1';

type FlagsState = {
  map: Record<string, boolean>;
  source: 'network' | 'cache' | 'default';
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const useFlagsStore = create<FlagsState>((set, get) => ({
  map: { ...DEFAULT_FLAGS },
  source: 'default',

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) set({ map: { ...DEFAULT_FLAGS, ...JSON.parse(raw) }, source: 'cache' });
    } catch { /* keep defaults */ }
  },

  refresh: async () => {
    const base = (process.env.EXPO_PUBLIC_FLAGS_URL || '').trim();
    if (!base) return; // seam inert until the founder sets the URL
    try {
      const token = useStore.getState().session?.access_token;
      const res = await fetch(base, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return; // keep last map
      const body = await res.json();
      const flags = body && typeof body.flags === 'object' ? body.flags : null;
      if (!flags) return;
      const map = { ...DEFAULT_FLAGS, ...flags };
      set({ map, source: 'network' });
      try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(flags)); } catch { /* non-fatal */ }
    } catch {
      // offline / network error — keep whatever we have. Never throw.
    }
  },
}));

export function getFlag(name: string): boolean {
  const map = useFlagsStore.getState().map;
  if (name in map) return map[name];
  return DEFAULT_FLAGS[name] ?? false;
}
```

Create `src/lib/useFlag.ts`:
```ts
// Hook + imperative reader for runtime feature flags. Prefer useFlag in components (re-renders on
// change); use getFlag in non-React code paths.
import { useFlagsStore, DEFAULT_FLAGS } from '../store/flagsStore';
export { getFlag } from '../store/flagsStore';
export { DEFAULT_FLAGS };

export function useFlag(name: string): boolean {
  return useFlagsStore((s) => (name in s.map ? s.map[name] : (DEFAULT_FLAGS[name] ?? false)));
}
```

- [ ] **Step 4: Run to verify the store tests pass**

Run: `npx jest src/store/flagsStore.test.ts`
Expected: PASS.

Note on the `useStore` import in tests: if `flagsStore.test.ts` fails to load due to `useStore`'s native deps, the store test mocks `fetch` only and never calls `refresh`'s token path in a way that needs a real session (the offline test rejects fetch first). If jest still chokes on the `useStore` import chain, add `jest.mock('./useStore', () => ({ useStore: { getState: () => ({ session: null }) } }))` at the top of the test file.

- [ ] **Step 5: Bridge `features.ts` to prefer the runtime flag**

Modify `src/lib/features.ts` — replace each `export const isXEnabled = process.env... === 'true';` with a runtime-preferring getter. Add at top:
```ts
import { getFlag } from '../store/flagsStore';

// Runtime flag wins; the env boolean is the compile-time fallback default (unchanged behavior when
// no runtime flag row exists, because the 0109 seed sets default_on to the same effective value).
const envOn = (v: string | undefined) => v?.trim() === 'true';
```
Then convert the five exports to functions that prefer runtime, e.g.:
```ts
export const isEnginesEnabled = () => getFlag('engines') || envOn(process.env.EXPO_PUBLIC_ENGINES_ENABLED);
export const isMealPlansEnabled = () => getFlag('meal_plans') || envOn(process.env.EXPO_PUBLIC_MEAL_PLANS_ENABLED);
export const isTrustPassEnabled = () => getFlag('trust_pass') || envOn(process.env.EXPO_PUBLIC_TRUST_PASS_ENABLED);
export const isStreakGraceEnabled = () => getFlag('streak_grace') || envOn(process.env.EXPO_PUBLIC_STREAK_GRACE_ENABLED);
export const isAssistantGateEnabled = () => getFlag('assistant_gate') || envOn(process.env.EXPO_PUBLIC_ASSISTANT_GATE);
```
IMPORTANT: these change from constants to functions. Grep every consumer and update call sites to invoke them:

Run: `npx jest -t nothing 2>/dev/null; grep -rn "isEnginesEnabled\|isMealPlansEnabled\|isTrustPassEnabled\|isStreakGraceEnabled\|isAssistantGateEnabled" src app | grep -v "features.ts"`
For each hit, append `()` (e.g. `if (isEnginesEnabled)` → `if (isEnginesEnabled())`). If there are many consumers and the risk of churn is high, INSTEAD keep them as constants computed once at module load from `getFlag(...) || envOn(...)` — but note constants won't reflect a mid-session flag change (acceptable for v1 since the client only refreshes flags at launch anyway). Choose the constant form if call sites are numerous; it matches the launch-refresh model and avoids a wide diff.

- [ ] **Step 6: Trigger a flags refresh at launch**

Find where the session hydrates (search): `grep -rn "hydrate\|getSession\|onAuthStateChange" app src/store | head`. In the app root (`app/_layout.tsx` or the store's init), after session hydration add:
```ts
import { useFlagsStore } from '../src/store/flagsStore'; // adjust relative path
// during app init / effect:
useFlagsStore.getState().hydrate().then(() => useFlagsStore.getState().refresh());
```
Place it so it runs once on mount and again on foreground resume if an AppState listener exists. It is fire-and-forget and must not be awaited in a way that blocks render.

- [ ] **Step 7: Full verify**

Run: `npm run test`
Expected: PASS (existing suite unbroken + new flag tests green). Fix any consumer call sites the `features.ts` change touched until green.

- [ ] **Step 8: Commit**

```bash
git add src/store/flagsStore.ts src/store/flagsStore.test.ts src/lib/useFlag.ts src/lib/features.ts app
git commit -m "feat(flags): RN client cache, useFlag/getFlag, launch fetch, features.ts bridge"
```

---

### Task 5: Founder flags panel (standalone, no dependency on the unbuilt admin shell)

**Files:**
- Create: `web/admin/flags.html`
- Create: `web/admin/flags.js`

**Interfaces:**
- Consumes: `admin_list_flags()` + `admin_set_flag(...)` RPCs via supabase-js (anon key + founder login JWT). No service-role key on the page.

- [ ] **Step 1: Write the page**

Create `web/admin/flags.html` (login gate + table shell; supabase-js from a pinned CDN, consistent with `web/landing`/`web/admin` static approach):
```html
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OnStandard — Feature Flags</title>
<style>
  body { font: 15px system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #111; }
  .hidden { display: none; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  input[type=text] { width: 100%; box-sizing: border-box; }
  button { padding: 8px 14px; cursor: pointer; }
  .kill { color: #b00; font-weight: 600; }
</style></head>
<body>
  <h1>Feature Flags</h1>
  <div id="login">
    <p>Founder sign-in required.</p>
    <input id="email" type="text" placeholder="email"> <input id="pw" type="password" placeholder="password">
    <button id="signin">Sign in</button>
    <p id="loginerr" style="color:#b00"></p>
  </div>
  <div id="app" class="hidden">
    <p><button id="signout">Sign out</button></p>
    <div id="rows">Loading…</div>
  </div>
  <script type="module" src="./flags.js"></script>
</body></html>
```

Create `web/admin/flags.js`:
```js
// OnStandard — founder feature-flags panel. Uses ONLY the anon key + the founder's login JWT.
// Every read/write goes through platform-admin-gated RPCs (admin_list_flags / admin_set_flag);
// a non-admin (or signed-out visitor) gets nothing. Fill SUPABASE_URL + SUPABASE_ANON_KEY below.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = ''; // TODO(founder): project URL
const SUPABASE_ANON_KEY = ''; // TODO(founder): anon (publishable) key — NOT the service role key
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hidden', !on);

async function refresh() {
  const { data, error } = await sb.rpc('admin_list_flags');
  if (error) { $('rows').textContent = 'Not authorized or unavailable: ' + error.message; return; }
  $('rows').innerHTML = '';
  for (const f of data) $('rows').appendChild(renderRow(f));
}

function renderRow(f) {
  const wrap = document.createElement('div');
  wrap.style.borderBottom = '1px solid #eee';
  wrap.style.padding = '10px 0';
  wrap.innerHTML = `
    <b>${f.name}</b> <span class="${f.kill_switch ? 'kill' : ''}">${f.kill_switch ? '· KILLED' : ''}</span>
    <div style="color:#666">${f.description || ''}</div>
    <label><input type="checkbox" ${f.default_on ? 'checked' : ''} data-k="default_on"> default on</label>
    <label><input type="checkbox" ${f.kill_switch ? 'checked' : ''} data-k="kill_switch"> kill-switch</label>
    <div>users: <input type="text" data-k="enabled_user_ids" value="${(f.enabled_user_ids||[]).join(',')}"></div>
    <div>roles: <input type="text" data-k="enabled_roles" value="${(f.enabled_roles||[]).join(',')}"></div>
    <div>orgs:  <input type="text" data-k="enabled_org_ids" value="${(f.enabled_org_ids||[]).join(',')}"></div>
    <button>Save</button>`;
  wrap.querySelector('button').onclick = async () => {
    const get = (k) => wrap.querySelector(`[data-k="${k}"]`);
    const csv = (k) => get(k).value.split(',').map((s) => s.trim()).filter(Boolean);
    const { error } = await sb.rpc('admin_set_flag', {
      p_name: f.name,
      p_description: f.description || '',
      p_default_on: get('default_on').checked,
      p_kill_switch: get('kill_switch').checked,
      p_enabled_user_ids: csv('enabled_user_ids'),
      p_enabled_roles: csv('enabled_roles'),
      p_enabled_org_ids: csv('enabled_org_ids'),
    });
    if (error) alert('Save failed: ' + error.message); else refresh();
  };
  return wrap;
}

$('signin').onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value, password: $('pw').value });
  if (error) { $('loginerr').textContent = error.message; return; }
  gate();
};
$('signout').onclick = async () => { await sb.auth.signOut(); gate(); };

async function gate() {
  const { data } = await sb.auth.getSession();
  const signedIn = !!data.session;
  show($('login'), !signedIn);
  show($('app'), signedIn);
  if (signedIn) refresh();
}
gate();
```

- [ ] **Step 2: Manual smoke (founder, local)**

Serve `web/admin` statically, open `flags.html`, sign in as the platform admin, confirm the 5 seeded flags list, toggle `engines` default-on, Save, and confirm it persists on refresh. (Requires the founder to fill the URL/anon key + have `admin_list_flags`/`admin_set_flag` live.) If not runnable in this environment, note it for the founder.

- [ ] **Step 3: Commit**

```bash
git add web/admin/flags.html web/admin/flags.js
git commit -m "feat(flags): founder flags panel (admin_list_flags/admin_set_flag, anon+JWT only)"
```

---

## Post-implementation

- Run `npm run verify` (lint:xss + typecheck + test + bundle) — must be green.
- Run `npm run test:rls` (Docker) — flag authz checks green.
- Founder deploy checklist (out of code scope): `supabase db push` (apply 0109), `supabase functions deploy flags`, set `EXPO_PUBLIC_FLAGS_URL` to the deployed function URL, fill `web/admin/flags.js` URL/anon key, ship an app build. Until `EXPO_PUBLIC_FLAGS_URL` is set the client seam is inert and all flags resolve to their compile-time defaults (zero behavior change).

## Self-review notes

- **Spec coverage:** §2 tables → Task 2; §3 evaluator → Task 1; §4 `flags` fn + RPCs → Tasks 2–3; §5 client → Task 4; §6 seed migration → Task 2 seed; §10 founder panel → Task 5; §11 tests → Tasks 1/2/4; §12 acceptance criteria all map (AC1 runtime edit=Task5+2, AC2 kill-switch=Task1 test + server enforce, AC3 single-user=Task1, AC4 no leak=Task3 projection, AC5 fail-safe=Task4, AC6 audit=Task2, AC7 migrated flags=Task2 seed + Task4 bridge). §13 rollout → Post-implementation.
- **Type consistency:** `FlagRow`/`FlagContext` identical across Tasks 1/3; `getFlag`/`useFlag`/`DEFAULT_FLAGS` identical across Task 4 files; RPC signature identical in Tasks 2/5.
- **Known judgment call (Task 4 Step 5):** constants-vs-functions for `features.ts`. Default to constants computed at load if consumers are numerous (matches launch-refresh model, avoids wide diff); functions only if mid-session reactivity is wanted. Executor decides from the grep count.
