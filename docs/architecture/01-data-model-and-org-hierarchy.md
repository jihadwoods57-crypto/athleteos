# 01 — Data Model & Organization Hierarchy (the foundation)

**Slice owner:** Data Model & Org Hierarchy. **Covers:** Deliverables #2 (Data Model), #3 (Org
Hierarchy), #16 (Transfer Workflows), plus Athlete Ownership / Multiple Organizations /
Graduation. **Status:** target 10-year architecture + a non-destructive migration path from
today. DESIGN ONLY — no app code, no SQL migrations shipped here.

---

## 1. Summary

OnStandard today is **link-centric**: an athlete is connected to a `team` (via `team_members`)
or a `practice` (via `practice_clients`) or a `guardian` (via `guardianships`), and RLS is the
disjunction `can_view() = is_self OR is_team_coach_of OR is_trainer_of OR is_guardian_of`. That
model already encodes the correct invariant — **the athlete owns the data (`days`/`meals`/
`checkins`/`athlete_profiles` are keyed on `athlete_id` and written only by self), overseers
only read** — but it has three structural caps: (a) every new relationship type is a new link
table + a new branch in `can_view`, which does not scale to N org types or sub-groups; (b)
there is no first-class **organization** above teams/practices, so "one athlete, many orgs with
different reports/permissions" has no home; and (c) there is no **scope or role granularity** on
a link — a coach is all-or-nothing on a team, a trainer all-or-nothing on a practice. This doc
introduces **one unifying access-grant object — `org_memberships` (membership + role + scope)** —
that subsumes `team_members`/`team_staff`/`practice_clients`/`guardianships` without a
destructive rewrite, and a clean `organizations → programs → groups` hierarchy. The athlete
profile and all athlete-owned history stay exactly where they are, keyed to the permanent
profile, and **never move** across transfer/graduation/leaving. The cross-cutting contract every
other architecture doc must honor: **every athlete-data read resolves through one membership +
scope predicate (`can_view(athlete)`), and every grant lives in `org_memberships`.**

---

## 2. Reconciliation with today

| Tag | Element | Detail |
|---|---|---|
| **[ALREADY BUILT]** | `profiles` (1:1 `auth.users`, `primary_role`) | `0001_schema.sql`. The permanent identity. KEEP as-is; it is the "one permanent OnStandard profile." |
| **[ALREADY BUILT]** | Athlete-owned data keyed on `athlete_id`, self-write only | `days`/`meals`/`checkins`/`athlete_profiles` + RLS `*_write = is_self`, `*_read = can_view` (`0002_rls.sql`). This **is** "athlete owns data; org owns access only." DO NOT change the ownership shape. |
| **[ALREADY BUILT]** | `orgs` table + `org_type` enum (`school|club|independent`) | `0001`. Exists but underused — teams reference `org_id` (nullable) and `created_by`. The seed of the org hierarchy. |
| **[ALREADY BUILT]** | The link spine: `team_members`, `team_staff`, `practice_clients`, `guardianships` | `0001`. These ARE org membership in disguise — each is "(subject, container, role-ish, status)." |
| **[ALREADY BUILT]** | `can_view()` disjunction + `connected()` + `SECURITY DEFINER` helpers | `0002_rls.sql`. The predicate every read keys off today. We EVOLVE its *implementation* (one table lookup) but PRESERVE its *signature* — no call site changes. |
| **[ALREADY BUILT]** | Join-by-code RPCs (`create_team`, `join_team`, `join_practice`) | `0004`, `0002`. The graph-building primitive. EVOLVE into `create_org`/`accept_invitation`. |
| **[ALREADY BUILT]** | `coach_set_goals()` — overseer writes targets/season_goal, not logs | `0002`. The single sanctioned overseer-write. Becomes scope-checked. |
| **[ALREADY BUILT]** | Guardian-consent fail-closed gate | `0008`, `src/core/consent.ts`. PRESERVED untouched — orgs never bypass it. |
| **[EVOLVE]** | `orgs` → `organizations` (richer: type taxonomy, settings, owner) | Rename + columns; keep `id` stable so `teams.org_id` FKs survive. |
| **[EVOLVE]** | `teams` → a `programs`+`groups` pair (or `teams` becomes `programs`, add `groups`) | `teams.settings` jsonb (tracked metrics + checkin questions) carries forward to `groups`. |
| **[EVOLVE]** | `team_members` / `team_staff` / `practice_clients` / `guardianships` → unified `org_memberships` | The big one. Done as a VIEW-compat shim first (see §7) so no call site breaks. |
| **[EVOLVE]** | `subscriptions` (per-owner) → keyed on `organization_id` not `owner_id` | `0010`. Licensing belongs to the org, not a person. |
| **[NEW]** | `org_memberships` (the canonical membership + role + **scope**) | The cross-cutting contract. Carries `role`, `scope` (org/program/group/individual), `status`, `permissions`. |
| **[NEW]** | `invitations` (durable, typed, expirable; supersedes bare join codes) | Codes are an invitation *type*, not the only path. |
| **[NEW]** | `membership_events` (append-only transfer/graduation/leave ledger) | Immutable lifecycle history — never deletes a membership, transitions its status. |
| **[NEW]** | `programs`, `groups`, `group_memberships` | The hierarchy below an org. |
| **[DON'T BUILD YET]** | Full `programs`/`groups` tree, multi-org workspaces, transfer ledger | Correct 10-year target. The wedge ships **one flat org = one team** (today's `teams` row). Build `org_memberships` as the seam NOW; populate the deep tree only when a real multi-program customer (a school district, a club with age groups) exists. |
| **[DON'T BUILD YET]** | `organization_id` denormalized onto `days`/`meals` for org analytics | Tempting for fast roster queries, but it **breaks the ownership invariant** (data would carry an org stamp). Keep athlete-data org-free; join through memberships. Revisit only if roster-scale reads become a proven bottleneck. |

---

## 3. The design

### 3.1 Two halves that must never blur

The single most important architectural rule for this slice (it is the data-model expression of
the Constitution's "amplify the coach, never replace"):

> **The PROFILE half** (athlete-owned, permanent, org-free): `profiles`, `athlete_profiles`,
> `days`, `meals`, `checkins`, performance, score history. Keyed on `athlete_id`. Written only
> by the athlete. **Survives every org change with zero data movement.**
>
> **The ACCESS half** (org-owned, grant-based, revocable): `organizations`, `programs`,
> `groups`, `org_memberships`, `invitations`, `subscriptions`. Carries who-may-see-what and
> who-pays. **Granting, transferring, or revoking access never touches the profile half.**

A transfer is therefore a **mutation of the access half only**: flip one membership to
`transferred`, insert another. The athlete's 3-year score history is identical the millisecond
before and after. This is the literal mechanism by which "an organization never owns athlete
history."

### 3.2 The hierarchy (target)

```
organizations            (Lincoln HS Athletics · Apex Performance · the Carter family unit)
  └─ programs            (Football · Track · "Weight-loss book" · "7-on-7 travel squad")
       └─ groups         (Varsity · JV · Position: WR · "Tuesday 6am class")
            └─ group_memberships  (athlete ⇄ group, the roster-display layer)

org_memberships          (the ACCESS GRANT — subject ⇄ org, carrying role + SCOPE + permissions)
profiles                 (the permanent person; an athlete, coach, trainer, parent, or admin)
athlete_profiles + days + meals + checkins  (the athlete-OWNED data, keyed to the profile)
```

Key idea: **`groups` are for display/rostering; `org_memberships` are for access.** A coach's
*right to see* an athlete comes from a membership with a `scope` that contains the athlete —
NOT from sharing a group. This decoupling is what lets "the same athlete appear differently to
different viewers" (§3.6) and is the Salesforce/Notion move (permissions are a grant graph, not
a folder tree).

### 3.3 The canonical object: `org_memberships` (the cross-cutting contract)

This is the one table every other doc's RLS and permission logic keys off. It generalizes the
four link tables into one.

```sql
-- ENUMS (target)
membership_role   := 'athlete' | 'client' | 'guardian'        -- the "subject" side
                   | 'admin' | 'head_coach' | 'assistant_coach'-- the "staff" side
                   | 'trainer' | 'nutritionist'                -- professional roles
membership_scope_kind := 'organization' | 'program' | 'group' | 'individual'
membership_status := 'invited' | 'active' | 'suspended'
                   | 'left' | 'transferred' | 'graduated' | 'removed'

create table org_memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  member_id       uuid not null references profiles(id) on delete cascade, -- the person
  role            membership_role not null,
  -- SCOPE: what this grant reaches inside the org. Staff get a container scope;
  -- a guardian/trainer gets an individual scope (one named athlete).
  scope_kind      membership_scope_kind not null,
  scope_id        uuid,        -- program_id | group_id | the target athlete's profile id | null(=whole org)
  -- PERMISSIONS: capability bits beyond the role default (jsonb so adding a capability
  -- is data, not a migration). e.g. {"view_meals":true,"set_targets":true,"message":false}
  permissions     jsonb not null default '{}'::jsonb,
  status          membership_status not null default 'active',
  invited_by      uuid references profiles(id) on delete set null,
  joined_at       timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  -- one live grant per (org, member, role, scope); re-joining reactivates in place
  unique (organization_id, member_id, role, scope_kind, scope_id)
);
create index om_member  on org_memberships(member_id)       where status = 'active';
create index om_org      on org_memberships(organization_id) where status = 'active';
create index om_scope    on org_memberships(scope_kind, scope_id) where status = 'active';
```

**How the four link tables map onto it** (this is what makes the migration non-destructive):

| Today | `org_memberships` row |
|---|---|
| `team_members(team_id, athlete_id, position)` | `role=athlete`, `scope_kind=group`, `scope_id=group(team)`; `position` → `group_memberships` |
| `team_staff(team_id, staff_id, head_coach/assistant)` | `role=head_coach\|assistant_coach`, `scope_kind=program\|organization` (head coach = whole program) |
| `practice_clients(practice_id, client_id)` | `role=client`, `scope_kind=individual`, `scope_id=client` — a trainer's grant is **per-athlete** |
| `guardianships(athlete_id, guardian_id)` | `role=guardian`, `scope_kind=individual`, `scope_id=athlete`, `permissions={view:true,message:true}` |

> **INFERRED — founder confirm:** a **trainer/parent grant is `scope_kind=individual`** (they
> see exactly one named athlete), while a **coach grant is a container scope** (program/group =
> the whole roster). This matches the spec's "Trainer = cross-org client book / Parent =
> single-athlete." The alternative — give a trainer their own org and put clients in it — is
> heavier but more uniform. Recommend individual-scope for trainers/parents; container-scope for
> school/club staff.

### 3.4 The scope-resolution predicate (rewrites `can_view` WITHOUT changing its signature)

`can_view(athlete)` stays the exact function name every existing policy already references
(`0002_rls.sql`). We swap its body from a 4-way disjunction to a single membership lookup that
respects scope. **No policy or call site changes** — this is the whole non-destructive trick.

```sql
-- target body — same signature, same SECURITY DEFINER + locked search_path
create or replace function can_view(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_self(athlete) or exists (
    select 1
    from org_memberships viewer
    where viewer.member_id = auth.uid()
      and viewer.status = 'active'
      and viewer.role in ('admin','head_coach','assistant_coach','trainer',
                          'nutritionist','guardian')
      and (
        -- individual grant: viewer is directly scoped to THIS athlete (trainer/parent)
        (viewer.scope_kind = 'individual' and viewer.scope_id = athlete)
        -- container grant: the athlete has an ACTIVE athlete-membership inside the
        -- same org whose scope the viewer's grant contains (coach over program/group)
        or exists (
          select 1 from org_memberships a
          where a.member_id = athlete and a.role = 'athlete' and a.status = 'active'
            and a.organization_id = viewer.organization_id
            and scope_contains(viewer.scope_kind, viewer.scope_id, a.scope_kind, a.scope_id)
        )
      )
  );
$$;
```

`scope_contains(outer_kind, outer_id, inner_kind, inner_id)` is a small SECURITY DEFINER helper
encoding org ⊇ program ⊇ group (an org-scoped head coach contains every program/group; a
group-scoped assistant contains only that group). This is the single place hierarchy
containment lives.

**Invariant preserved:** `*_write = is_self(athlete_id)` is **unchanged** on every athlete-data
table. Orgs gain reach via `can_view` only; they never gain write. The one sanctioned overseer
write (`coach_set_goals`) gains a scope check (`has_permission(athlete,'set_targets')`).

### 3.5 Organizations, programs, groups (target shapes)

```sql
create table organizations (              -- EVOLVE of orgs (id preserved)
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'school'   -- school|club|private_practice|family|college|national
                check (kind in ('school','club','private_practice','family','college','national')),
  settings    jsonb not null default '{}',     -- branding, default scoring profile, default tracked metrics
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table programs (                   -- EVOLVE: a team's "sport" container
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,           -- "Football", "Weight-loss book"
  sport           text,
  settings        jsonb not null default '{}'  -- competition_mode, scoring_profile default, tracked
);

create table groups (                     -- EVOLVE of teams (the rostered unit)
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references programs(id) on delete cascade,
  name            text not null,           -- "Varsity", "WR", "Tuesday 6am"
  join_code       text unique,             -- carries forward from teams.join_code
  -- {tracked:{...}, checkin_questions:{...}} — moves verbatim from teams.settings
  settings        jsonb not null default '{}'
);

create table group_memberships (          -- roster-display layer (position, jersey, etc.)
  group_id    uuid not null references groups(id) on delete cascade,
  athlete_id  uuid not null references profiles(id) on delete cascade,
  position    text,
  status      text not null default 'active',
  primary key (group_id, athlete_id)
);
```

`group_memberships` is intentionally thin (display/roster). The **access** truth is in
`org_memberships`. A coach can be in a group's roster view without org access, or have org
access without appearing on a roster — they are orthogonal.

> **INFERRED — founder confirm:** the **family is an organization** (`kind='family'`) so a
> parent is just a `guardian` membership and the model has ONE shape for everyone. Alternative:
> keep guardianships special-cased. Recommend family-as-org for uniformity; it also gives a
> clean home for sibling/multi-child parents.

### 3.6 "The same athlete appears differently depending on the viewer"

The athlete's data is one row set. **What a viewer sees is the intersection of (their
membership's `permissions`) × (the org's `program/group.settings`) × (the athlete's own
sharing controls).** No data is duplicated; the *projection* differs:

- **School head coach** (`role=head_coach`, org scope, `permissions:{view_score,view_compliance,
  set_targets}`): sees the athlete's daily score, compliance %, weight trend, scoped to the
  football program's tracked metrics + check-in questions (`program.settings`). Sees the
  athlete *as a roster row* in the Varsity group.
- **Private trainer** (`role=trainer`, individual scope, `permissions:{view_meals,set_targets,
  message}`): sees the SAME athlete's meals + score but framed by *their* program's scoring
  profile (e.g. `general`) and *their* targets — a different plan, same execution number.
- **Parent** (`role=guardian`, individual scope, `permissions:{view_score,view_weight}`):
  read-only weekly digest + "last synced" (D9 Part A), never sees raw meal photos unless the
  athlete grants it.
- **The athlete**: sees everything, owns the toggle (`sharingPaused`, per-org consent) that can
  narrow ANY of the above to nothing — the fail-closed gate (`src/core/consent.ts`) wins over
  every grant.

This is enforced by a single read-model selector (`projectAthleteFor(viewerMembership,
athlete, orgSettings)`) in `src/core` — **pure, no Supabase import** — that the Permissions doc
and the Dashboard docs consume. It is the data-layer counterpart to the Constitution's Context
model (§11b): *shared data, projected per viewer.*

### 3.7 Multiple organizations (one profile, many workspaces)

One athlete = one `profiles` row + one `athlete_profiles` + one stream of `days`/`meals`. They
hold **N `org_memberships` rows** (university team + private trainer + nutritionist + 7-on-7
club), each in a different organization, each with its own scope/permissions/targets. Because
all org-scoped configuration (scoring profile, targets, tracked metrics) hangs off the
*membership/program*, **each org gets its own plan and report over the same underlying
execution**. The athlete's headline Development Score is computed once from their data; each org
*views* it through its own profile/targets lens (the per-membership projection of §3.6). There
is exactly one set of meals; there are N reports.

> **INFERRED — founder confirm (a real product question):** when two orgs set *conflicting
> targets* (university wants 200g protein bulk; nutritionist wants a cut), whose targets drive
> the athlete's own daily Game Plan? Recommendation: the athlete designates **one "primary"
> membership** that drives their personal plan; other orgs see compliance against *their* targets
> as a read-side projection. This keeps "one number, one focus" (Founder Rule #9) while honoring
> each org's plan. Flagged for the Scoring/Plan doc to co-design.

### 3.8 Invitations (supersedes bare join codes)

```sql
create table invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  scope_kind      membership_scope_kind not null,
  scope_id        uuid,
  intended_role   membership_role not null,         -- what the accepter becomes
  code            text unique,                       -- short shareable code (today's join_code)
  email           text,                              -- optional targeted invite
  permissions     jsonb not null default '{}',       -- pre-granted capability bits
  expires_at      timestamptz,
  max_uses        int,    uses int not null default 0,
  created_by      uuid references profiles(id) on delete set null,
  status          text not null default 'open' check (status in ('open','revoked','exhausted')),
  created_at      timestamptz not null default now()
);
```

`accept_invitation(code)` is the evolved `join_team`/`join_practice` (SECURITY DEFINER):
validates the code, inserts/reactivates the `org_memberships` row with the invitation's
role+scope+permissions, increments `uses`. **Today's `join_code` on `groups` stays valid** — a
group join code is just a standing `open` invitation. Codes remain rotatable; old memberships
survive a rotation (an invitation governs *creation*, not *continued access*).

### 3.9 Transfer / graduation / leaving — the lifecycle ledger (Deliverable #16)

Memberships are **never deleted**; their `status` transitions, and every transition appends an
immutable event. This is the audit spine for "never lose history."

```sql
create table membership_events (              -- append-only, never updated/deleted
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid not null references org_memberships(id) on delete cascade,
  kind          text not null check (kind in
                  ('invited','joined','transferred_out','transferred_in',
                   'graduated','left','suspended','removed','reactivated')),
  from_org      uuid references organizations(id),
  to_org        uuid references organizations(id),
  actor_id      uuid references profiles(id),   -- who performed it
  reason        text,
  occurred_at   timestamptz not null default now()
);
```

**Lifecycle flows (all are access-half-only operations; the profile half is untouched):**

- **Transfer (school → school):** `transfer_athlete(membership_id, to_org_id)` RPC, callable by
  the destination org's admin **with the athlete's (or guardian's, for a minor) acceptance** —
  flips the old membership to `transferred`, creates a new `active` membership in `to_org`,
  appends `transferred_out` + `transferred_in`. The athlete's `days`/`meals`/score history
  **carry over automatically** because they were never attached to the org. The new coach sees
  history from day one (subject to the athlete re-confirming consent for the new org).
- **Graduation (senior leaves HS):** `graduate_membership(membership_id)` — status →
  `graduated`. The org loses live access (read grant ends) but the **athlete keeps their entire
  profile + history** and can carry it to a college org or use it solo. This is the literal
  "graduation never resets progress."
- **Leaving an org / season end / dropping a trainer:** status → `left` or `removed`; access
  ends; data stays with the athlete. A returning athlete reactivates the same membership row
  (`reactivated` event) — no duplicate athlete, ever.
- **Travel/club + school simultaneously:** simply two concurrent `active` memberships in two
  orgs (§3.7). No special case.

> **Consent on transfer (must honor the fail-closed gate):** a transfer grants *potential*
> access; the athlete's/guardian's consent for the NEW org is required before any real data
> renders to the new coach. `src/core/consent.ts` already fails closed per (role, guardian
> status); the org dimension is added as "consent is per-org-membership, not global." **INFERRED
> — founder/legal confirm:** does consent re-prompt on every transfer, or does a verified
> guardian's consent travel with the athlete? Recommend re-prompt (data-minimization-safe);
> flag for the Consent/Trust doc.

### 3.10 Text ER sketch (target)

```
auth.users 1──1 profiles ──1──1 athlete_profiles
                   │                    │ (athlete-OWNED, org-free)
                   │            ┌───────┴────────┬──────────┐
                   │         days(N)         meals(N)   checkins(N)   [keyed athlete_id, self-write]
                   │
                   │  (a profile holds MANY memberships — athlete in N orgs, or staff)
                   ▼
            org_memberships(N) ──many──> organizations(1)
              │ role, scope_kind,            │
              │ scope_id, permissions,       ├── programs(N) ── groups(N) ── group_memberships(N)─→ profiles
              │ status                       └── subscriptions(1)   (licensing keyed to ORG)
              │
              └──1──many── membership_events   (immutable transfer/graduation/leave ledger)

invitations(N) ──> organizations(1)   (accept_invitation → inserts an org_memberships row)
```

---

## 4. RPC / Edge-Function surface (target signatures)

All `SECURITY DEFINER`, `search_path=public`, scope-checked; evolve the existing definer
pattern. None bypass the consent gate.

- `create_organization(name, kind) → organization_id` — also inserts caller as `admin`
  membership atomically (the `create_team` chicken-and-egg fix, generalized).
- `accept_invitation(code) → membership_id` — evolves `join_team`/`join_practice`.
- `transfer_athlete(membership_id, to_org_id, reason) → membership_id` — access-half move +
  ledger; requires destination-admin call **and** athlete/guardian acceptance.
- `graduate_membership(membership_id)` / `leave_membership(membership_id)` — status transitions
  + ledger.
- `set_membership_permissions(membership_id, permissions jsonb)` — admin/head-coach only,
  scope-checked.
- `coach_set_goals(athlete, targets, season_goal)` — **EVOLVE** `0002`'s version: replace the
  `is_team_coach_of OR is_trainer_of` check with `has_permission(athlete,'set_targets')` resolved
  through `org_memberships`.

---

## 5. Migration path (non-destructive, staged)

The whole point: **ship the seam now, populate the tree later, break nothing.**

1. **Phase 0 (now / pre-backend):** the app is link-centric and flag-OFF. Do nothing destructive.
   Author `org_memberships` + `scope_contains` + the rewritten `can_view` body as authored
   migrations (per the D1 guardrail — authored, not pushed to live). Add a backfill that writes
   one `org_memberships` row per existing `team_members`/`team_staff`/`practice_clients`/
   `guardianships` row (pure projection, idempotent).
2. **Phase 1 (compat shims):** keep `team_members` etc. as **updatable VIEWS over
   `org_memberships`** (or keep the tables and dual-write via trigger) so every existing query,
   RPC, and the `connected()` helper keep working unchanged while `can_view` reads the new table.
   ~970 tests should pass because `src/core` never imported these tables and the RLS *signatures*
   are unchanged.
3. **Phase 2 (hierarchy):** introduce `organizations`/`programs`/`groups`. `orgs`→`organizations`
   (id-preserving rename), `teams`→`groups` under a synthesized one-per-team `programs` row.
   Today's flat "one team = one org" world becomes "one org → one program → one group" with no
   user-visible change.
4. **Phase 3 (lifecycle):** add `invitations`, `membership_events`, the transfer/graduation RPCs.
   Only needed when the first multi-org / transferring customer appears — **[DON'T BUILD YET]**
   until then.
5. **Phase 4 (retire shims):** once all call sites read `org_memberships` directly, drop the
   compat views. The four link tables are gone; one membership table remains.

`src/core` is untouched throughout (it never imported Supabase). The new pure helper
`projectAthleteFor(...)` and a `Membership`/`Scope` TS type live in `src/core` (no RN/Supabase
imports) so scope logic is unit-testable offline — consistent with the existing
`subscription.ts`/`consent.ts` inert-seam pattern.

```ts
// src/core/membership.ts  (NEW, pure — no React/RN/Supabase)
export type MembershipRole =
  | 'athlete' | 'client' | 'guardian'
  | 'admin' | 'head_coach' | 'assistant_coach' | 'trainer' | 'nutritionist';
export type ScopeKind = 'organization' | 'program' | 'group' | 'individual';
export interface Membership {
  organizationId: string; memberId: string; role: MembershipRole;
  scopeKind: ScopeKind; scopeId: string | null;
  permissions: Record<string, boolean>; status: 'active' | 'invited' | 'left'
    | 'transferred' | 'graduated' | 'suspended' | 'removed';
}
export function hasPermission(m: Membership, cap: string): boolean; // role default ∪ overrides
export function canViewAthlete(viewer: Membership, athleteMemberships: Membership[]): boolean;
```

---

## 6. Open decisions for the founder

1. **Trainer/parent scope = `individual` vs. own-org** (§3.3). Recommend individual scope.
2. **Family = an `organization` (`kind='family'`)** vs. keeping `guardianships` special (§3.5).
   Recommend family-as-org for one uniform shape.
3. **Conflicting targets across orgs** — does the athlete pick ONE "primary" membership that
   drives their personal Game Plan, with other orgs as read-side projections? (§3.7) This is a
   real product call that the Scoring/Plan doc depends on.
4. **Consent on transfer** — re-prompt per org, or does a verified guardian's consent travel
   with the athlete? (§3.9) Legal-sensitive (COPPA/FERPA); recommend re-prompt.
5. **How deep to build now.** Confirm the staged plan: ship `org_memberships` + the `can_view`
   rewrite as the seam (Phase 0–1) but DEFER `programs`/`groups`/`invitations`/transfer-ledger
   (Phase 3) until a real multi-program/transferring customer exists. The wedge stays "one org =
   one team."
6. **`organization_id` on `days`/`meals`?** I recommend **NO** (it would stamp athlete-owned data
   with an org and break the ownership invariant). Confirm we accept join-through-membership for
   roster reads and only revisit if roster-scale reads prove to be a bottleneck.

---

## 7. Cross-cutting contract (what every other doc MUST honor)

1. **Every athlete-data read resolves through `can_view(athlete)`**, whose body is a single
   `org_memberships` scope lookup. No doc invents a parallel access path. The function
   *signature* never changes — only its body evolves.
2. **Every access grant is an `org_memberships` row** carrying `(role, scope_kind, scope_id,
   permissions, status)`. Permissions docs key off `permissions`; dashboard docs key off
   `scope`; billing keys off `organization_id`.
3. **The profile half is org-free and self-write-only.** No doc may attach athlete data to an
   org or grant an org write access to logs. The only sanctioned overseer write is
   `coach_set_goals` (scope-checked).
4. **The fail-closed consent gate (`src/core/consent.ts`) sits ABOVE every grant** — a valid
   membership never overrides a withheld/paused consent or an unverified minor.
5. **Lifecycle is status-transition + append-only `membership_events`, never delete.** "Never
   duplicate an athlete, never lose history, never reset progress" is enforced here.
6. **Scope logic lives once** — in SQL `scope_contains()` and pure `src/core/membership.ts`.
   No doc reimplements containment.
