# 02 — Roles, Permissions, Groups, Security & Audit

> Target 10-year architecture for the access-control spine of AthleteOS, plus a pragmatic
> migration path from today's role/flow-centric, link-table RLS (migration 0002) to a
> configurable org-scoped RBAC + group-scoped visibility + append-only audit model.
> **Design only** — no app/TS code, no SQL migrations are created here.
> Authored 2026-06-29. Depends on doc `01` (org hierarchy) for the `orgs → units → teams`
> tree; this doc owns *who may do what to whom*.

## 1. Summary

AthleteOS's access model must evolve from "four hardcoded role flows + a `can_view()` OR of
link tables" into a **configurable RBAC engine** where (a) every user holds one or more
**org-scoped role grants**, (b) every action maps to a **permission key** that an org can
**override** without a code change, (c) athlete visibility is **group-scoped** (a position
coach sees only Linebackers; a nutritionist only the Weight-Gain cohort), and (d) every
mutation that touches an athlete's plan, goals, macros, access, or lifecycle is written to an
**append-only `activity_log`**. The whole model stays **fail-closed**, preserves the existing
**consent gate** (`src/core/consent.ts`) as an orthogonal layer that RBAC can never override,
and keeps the invariant **athletes own their data; organizations own access only**. The single
cross-cutting contract every other doc must call is one predicate:
`allowed(viewer, athlete, scope, action) → boolean`.

## 2. Reconciliation with today

| Tag | Element | Reality |
|---|---|---|
| **[ALREADY BUILT]** | Link-table RLS spine: `is_self / is_team_coach_of / is_trainer_of / is_guardian_of / can_view / connected` | `0002_rls.sql`. This is the foundation — we wrap it, we don't throw it away. |
| **[ALREADY BUILT]** | `orgs / teams / practices / team_members / team_staff / practice_clients / guardianships` | `0001_schema.sql`. The graph exists; org-centricity is *partial* (orgs table exists, but staff roles are only `head_coach|assistant`). |
| **[ALREADY BUILT]** | Atomic privileged mutations via SECURITY DEFINER RPC: `create_team`, `join_team`, `coach_set_goals`, `delete_account`, `request_guardian_consent` | `0004/0007/0008` + `0002`. The RPC-gateway pattern is exactly how we'll funnel permission-checked writes. |
| **[ALREADY BUILT]** | Fail-closed consent gate, minor protection (COPPA) | `src/core/consent.ts`. Orthogonal to RBAC; must remain a hard pre-filter. |
| **[ALREADY BUILT]** | Account deletion that cascades server data | `0007_delete_account.sql`. Becomes the *permanent-deletion* leg of the safety lifecycle. |
| **[ALREADY BUILT]** | Inert per-owner billing seam | `0010_subscriptions.sql`. "Owns billing" is a permission key that resolves to this row. |
| **[EVOLVE]** | `staff_role` enum (`head_coach|assistant`) → full org-scoped role catalog (12 roles) | Today's two-value enum cannot express Position Coach / Strength Coach / Nutritionist / AT scoping. Becomes a `roles` table + `role_grants`. |
| **[EVOLVE]** | `can_view(athlete)` (boolean OR of all links) → `can_view(athlete)` that *also* enforces **group scope** | A nutritionist linked to a team currently sees the WHOLE team. Must be narrowed to their assigned groups. |
| **[EVOLVE]** | `coach_set_goals` RPC gated by `is_team_coach_of OR is_trainer_of` → gated by a **permission check** (`goals.edit`) | Hardcoded role check → configurable permission lookup. |
| **[EVOLVE]** | `team_members.status` (`active|invited|removed`) → athlete **lifecycle** (`active|invited|archived|removed`) + retention | `removed` already exists but there is no archive/restore/retention/soft-delete discipline. |
| **[NEW]** | `roles`, `permissions`, `role_permissions`, `role_grants`, `org_permission_overrides` | The configurable RBAC core. |
| **[NEW]** | `groups`, `group_members`, `group_scopes` (which role-grant is scoped to which groups) | Unlimited-group membership + group-scoped read predicate. |
| **[NEW]** | `activity_log` (append-only audit) + `archive` lifecycle columns + retention policy | Audit (#20) + Safety. |
| **[NEW]** | `permission_check(viewer, athlete, action, scope)` SECURITY DEFINER helper | The single predicate everything routes through. |
| **[DON'T BUILD YET]** | Fully custom per-org role *creation* UI, ABAC/policy-as-data engine, SoD workflow approvals, time-boxed grants, SCIM/SSO provisioning | Correct 10-year target; massive over-build for a wedge with athlete+general profiles and no enterprise customer yet. Ship a **fixed role catalog with per-org permission overrides** first; custom-role authoring is a flag-gated v3 surface. |
| **[DON'T BUILD YET]** | Cross-org federated identity (one nutritionist serving 40 schools with one SSO) | Trainer cross-org book already covers the real near-term case via `practices`. Defer the federation layer. |

## 3. The design

### 3.1 Roles, permissions, grants (the RBAC core)

**Principle: roles are data, not enums.** A role grant says *"this user holds role R in org O,
optionally narrowed to groups G"*. Permissions are checked against the **effective permission
set** = (role's default permissions) ⊕ (org overrides). Nothing is hardcoded in `src/core` or
in RLS beyond the *resolution mechanism*.

> **`src/core` purity** is preserved: the **permission catalog** (the list of action keys and
> the *default* role→permission matrix) lives as a pure, importable constant in
> `src/core/rbac.ts` — no React/RN/Supabase. The **runtime resolution** (does *this* user hold
> it, given org overrides + group scope) is a SECURITY DEFINER Postgres function, because RLS
> must enforce it server-side. `src/core/rbac.ts` is the *single source of the default matrix*;
> a migration seeds the `role_permissions` table FROM that matrix so client and server never
> drift (same discipline already used for `days.score` recompute, `0002` note).

**ER sketch (new tables):**

```
profiles ──< role_grants >── roles ──< role_permissions >── permissions
   │             │  (org_id, optional unit_id)                   │
   │             └──< grant_group_scopes >── groups              │
   │                                           │                 │
   │                                     group_members           │
   │                                       (athlete)             │
orgs ──< org_permission_overrides >─────────────────────────────┘
                 (org_id, role_id, permission_key, granted bool)
```

**`roles`** — the catalog. Seeded with the 12 roles; `is_system=true` for these.
```
id uuid pk, org_id uuid null (null = platform/system role), key text,
label text, is_system bool default false, created_by uuid, created_at
```
System roles (org_id null): `org_owner, athletic_director, head_coach, position_coach,
strength_coach, nutritionist, athletic_trainer, assistant_coach, personal_trainer, parent,
athlete, client`. Custom roles (org_id set) are **[DON'T BUILD YET]** but the column exists so
the schema doesn't need a migration later.

**`permissions`** — the action catalog (one row per permission key, see §3.2).
```
key text pk, label text, category text, athlete_scoped bool
```
`athlete_scoped=true` ⇒ the permission only makes sense relative to a specific athlete and is
additionally narrowed by group scope (e.g. `nutrition.edit`). `false` ⇒ org-level
(e.g. `member.invite`, `billing.own`).

**`role_permissions`** — the **default matrix**, seeded from `src/core/rbac.ts`.
```
role_id uuid, permission_key text, granted bool, pk(role_id, permission_key)
```

**`role_grants`** — *who holds what, where*. This is the new RBAC spine and a generalization of
`team_staff` / `practice_clients` / `guardianships`.
```
id uuid pk, subject_id uuid → profiles, org_id uuid → orgs,
unit_id uuid null → org_units (doc 01; null = whole org),
role_id uuid → roles, status link_status default 'active',
granted_by uuid → profiles, created_at, revoked_at null
```

**`org_permission_overrides`** — the **configurability layer**. An org row that flips a default.
```
org_id uuid, role_id uuid, permission_key text, granted bool,
set_by uuid, set_at, pk(org_id, role_id, permission_key)
```
> **Founder confirm (INFERRED):** overrides are **per (org, role, permission)** — coarse and
> auditable — *not* per-(user, permission). Per-user exceptions are an attack surface and a
> support nightmare; if a user needs different access, grant them a different role. Confirm
> this granularity.

**Effective permission resolution (the function every gate calls):**
```
has_permission(subject, org, permission_key) :=
  EXISTS active role_grant rg for (subject, org)
  WHERE  COALESCE(
           (SELECT granted FROM org_permission_overrides
              WHERE org_id=org AND role_id=rg.role_id AND permission_key=key),
           (SELECT granted FROM role_permissions
              WHERE role_id=rg.role_id AND permission_key=key),
           false)              -- absent default ⇒ DENY (fail-closed)
       = true
```
Multiple grants are **OR-ed** (most permissive wins), which is the standard RBAC union and
matches today's `can_view` OR-semantics.

### 3.2 The Permissions Matrix (defaults; every cell is overridable per-org)

Permission keys (the `permissions` catalog). `(A)` = athlete-scoped (also group-narrowed).

| Permission key | Meaning |
|---|---|
| `member.invite` | invite users into the org/unit |
| `member.remove` | revoke a user's grant |
| `athlete.archive` (A) | soft-archive an athlete (lifecycle) |
| `athlete.restore` (A) | restore an archived athlete |
| `nutrition.edit` (A) | edit nutrition plan / macros / protein target |
| `goals.edit` (A) | edit targets & season goal (today's `coach_set_goals`) |
| `score.config` (A) | set scoring **profile** + relevant components on/off (NOT formula weights) |
| `report.view` (A) | view athlete/team reports & history |
| `alert.receive` (A) | receive needs-attention alerts/nud-targets |
| `message.send` (A) | communicate with athlete (gated also by minor messaging rules `0006`) |
| `group.manage` | create groups, assign athletes, scope staff to groups |
| `role.manage` | grant/revoke roles, set org permission overrides |
| `billing.own` | own/manage the subscription (`0010`) |
| `audit.view` | read the activity log |

**Default matrix** (✓ = granted by default; blank = denied; **all configurable**):

| Role \ Perm | invite | remove | archive | nutri.edit | goals.edit | score.config | report.view | alert.recv | msg.send | group.mgmt | role.mgmt | billing | audit.view |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Org Owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Athletic Director | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Head Coach | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| Position Coach | | | | | ✓ | | ✓ | ✓ | ✓ | | | | |
| Strength Coach | | | | | ✓ | | ✓ | ✓ | ✓ | | | | |
| Nutritionist | | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | | |
| Athletic Trainer | | | ✓ | | | | ✓ | ✓ | ✓ | | | | |
| Assistant Coach | | | | | | | ✓ | ✓ | ✓ | | | | |
| Personal Trainer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ |
| Parent | | | | | | | ✓ | ✓ | ✓ | | | (✓)* | |
| Athlete | | | | (✓self) | (✓self) | | (✓self) | | ✓ | | | | (✓self) |
| Client | | | | (✓self) | (✓self) | | (✓self) | | ✓ | | | | (✓self) |

\* Parent `billing.own` ✓ only in the **Parent Plan** consumer context (doc on subscriptions),
denied in school/org context. **INFERRED — founder confirm.**

**Key design calls embedded in this matrix:**
- **`score.config` ≠ formula control.** Per Constitution §11a / Rule #13, *no role can ever
  re-weight the Development Score*. `score.config` only toggles the platform-owned **profile**
  (`athlete|general`) and which components are *relevant* (the existing check-in toggles).
  There is **no permission key for editing weights** — it is structurally impossible, not merely
  denied. This protects the Proof pillar.
- **Athletes always retain `*self*` edit of their own targets** unless an org policy explicitly
  removes it — but coach edits *win* per the scoring contract (coach owns the plan). Self-edit =
  athlete sets their *aspiration*; a coach grant overrides on the same athlete.
- **`alert.receive` is a permission, not a preference.** Preferences (`overseerAlerts` state)
  filter *which* alerts; the permission decides *eligibility at all* — a position coach can't be
  alerted about an athlete outside their group.

### 3.3 Groups & group-scoped visibility

**Athletes belong to UNLIMITED groups.** Groups are org-scoped, free-form, and orthogonal to
the team roster (an athlete is on one team but in N groups: Linebackers ∩ Freshmen ∩ Weight-Gain
∩ Return-to-Play).

```
groups(id, org_id, unit_id null, name, kind text, created_by, archived_at null)
  kind ∈ {position, class_year, program, clinical, nutrition, custom}  -- label only
group_members(group_id, athlete_id, added_by, added_at, pk(group_id, athlete_id))
grant_group_scopes(grant_id → role_grants, group_id, pk(grant_id, group_id))
```

**The group-scoped read predicate** (this is the heart of the slice):

```
sees_athlete(viewer, athlete) :=
  is_self(athlete)
  OR EXISTS active role_grant rg WHERE rg.subject_id = viewer
       AND athlete ∈ org/unit of rg               -- structural reach
       AND ( NOT EXISTS (grant_group_scopes for rg)         -- unscoped grant = whole org/unit
             OR EXISTS (group_members gm
                          JOIN grant_group_scopes gs ON gs.group_id = gm.group_id
                          WHERE gs.grant_id = rg.id AND gm.athlete_id = athlete) )
```

Semantics: **a grant with NO group scope sees the entire org/unit** (Head Coach, AD, Org Owner);
**a grant WITH group scopes sees only athletes in those groups** (Position Coach → Linebackers;
Strength Coach → Freshmen; Nutritionist → Weight-Gain). This makes the visibility model
**default-broad for leadership, default-narrow for specialists** — controlled by whether anyone
attached a group scope to the grant, which is itself a `group.manage` action and audited.

> **Founder confirm (INFERRED):** an *unscoped* specialist grant (nutritionist with no group
> attached) sees the whole org. Alternative: specialists are *deny-by-default* until scoped. I
> recommend **deny-until-scoped for specialist roles** (`nutritionist, position_coach,
> strength_coach, athletic_trainer, assistant_coach`) and **broad-by-default for leadership**
> (`org_owner, athletic_director, head_coach`). This is a one-row-per-role flag
> (`roles.scope_default ∈ {broad, deny_until_scoped}`). Confirm.

### 3.4 The unified security model (RLS every table inherits)

We **keep `0002`'s SECURITY DEFINER helper pattern** and **evolve `can_view`** so that the rest
of the schema needs *no policy rewrites* — the policies already say `using (can_view(athlete_id))`.

**`can_view(athlete)` is redefined** as:
```
can_view(athlete) := sees_athlete(auth.uid(), athlete)
                     AND has_permission(auth.uid(), org_of(athlete), 'report.view')
```
i.e. structural reach **AND** group scope **AND** an explicit read permission. (Guardianships
remain a first-class path: `is_guardian_of` short-circuits to ✓ for `report.view` of that
athlete, preserving the parent relationship without an org grant.)

**Write paths stay athlete-only on raw logs** (unchanged invariant): `days/meals/checkins`
`INSERT/UPDATE/DELETE` remain `is_self(athlete_id)`. Overseers never write logs. The only
overseer writes are **plan/goal/profile** writes, which go through **permission-checked RPCs**,
not direct UPDATE.

**The policy shape EVERY athlete-scoped table inherits:**
```
SELECT  using ( can_view(athlete_id) )                         -- read = reach+scope+perm
INSERT  with check ( is_self(athlete_id) )                     -- only the athlete writes logs
UPDATE  using ( is_self(athlete_id) ) with check ( is_self(...) )
DELETE  using ( is_self(athlete_id) AND not is_archived(athlete_id) )  -- soft-delete instead
```
Overseer-mutable fields (targets, season_goal, scoring profile, nutrition plan) are written by
RPCs that begin with `assert has_permission(auth.uid(), org_of(athlete), <key>)` and
**write an `activity_log` row in the same transaction** (§3.5). `coach_set_goals` is rewritten
to call `has_permission(..., 'goals.edit')` instead of `is_team_coach_of OR is_trainer_of`.

**Consent gate stays orthogonal and supreme.** RBAC governs *who may read/write*;
`realDataConsent()` governs *whether a minor's real data may leave the device at all*. A coach
with full `report.view` still sees **nothing** for a minor whose guardian isn't `verified` —
because the data never syncs. **No permission can override consent.** This is enforced by keeping
the consent check on the *write/sync* path (client) AND a server mirror: a `days` row for a minor
without a verified guardianship is never produced, so there is nothing for RLS to expose. The
consent gate is a **pre-filter above RBAC**, never reachable by an override.

**Fail-closed guarantees preserved:** every resolution function returns `false` on absent rows
(no default-allow), helpers are SECURITY DEFINER with `search_path=public` locked, and the
permission default for an uncatalogued key is DENY.

### 3.5 Audit logging (#20) — append-only `activity_log`

```
activity_log(
  id           uuid pk default gen_random_uuid(),
  org_id       uuid null,          -- denormalized for fast org-scoped audit reads
  actor_id     uuid → profiles,    -- WHO (auth.uid() at write time)
  subject_athlete uuid null → profiles,  -- WHOM (the affected athlete, if any)
  action       text not null,      -- WHAT: 'goals.edit' | 'nutrition.edit' | 'macro.change'
                                    --       | 'meal.edit' | 'access.grant' | 'access.revoke'
                                    --       | 'athlete.archive' | 'athlete.restore'
                                    --       | 'group.assign' | 'permission.override' | ...
  target_table text, target_id text,
  before       jsonb,              -- prior state (null on create)
  after        jsonb,              -- new state (null on delete)
  reason       text null,          -- optional actor-supplied note (dispute resolution)
  at           timestamptz not null default now()
)
create index activity_subject on activity_log(subject_athlete, at desc);
create index activity_org on activity_log(org_id, at desc);
```

**Append-only enforcement:** RLS grants `INSERT` (via the RPCs only) and `SELECT` (gated by
`audit.view`); **no role holds `UPDATE`/`DELETE`** — not even `service_role` in normal operation.
A `BEFORE UPDATE OR DELETE` trigger `RAISE EXCEPTION 'activity_log is append-only'` makes
immutability structural, mirroring the scoring-history-immutability invariant.

**Who-can-read:** `audit.view` permission (Owner/AD/Head Coach/Personal Trainer by default);
**athletes can always read their OWN** `activity_log` rows (`subject_athlete = auth.uid()`) — a
core transparency right ("who changed my macros and when?"). Parents read audit for their linked
athlete iff `report.view` via guardianship.

**Coverage (required by #20):** goal changes, plan edits, protein/macro changes, meal edits,
access grants/revokes, archival/restore, permission overrides, group assignments. Each is written
**in the same transaction** as the mutation by the RPC, so the log can never disagree with state.

**History / undo / dispute:** `before`/`after` make every change a reversible delta. *Undo* is a
new RPC `revert_change(activity_id)` that applies `before` (itself permission-checked and itself
logged — no silent undo). *History* is `select … where subject_athlete=? order by at`. *Compliance/
dispute* reads filter by org + action + window.

> **Founder confirm (INFERRED):** log meal **photo** edits as metadata deltas only (never store
> the image bytes in `after`) — keep PHI/photo out of the audit table; reference `photo_path`.

### 3.6 Safety: soft-delete / archive / restore / retention / permanent deletion

A four-state athlete lifecycle replaces ad-hoc `removed`:

```
athlete_lifecycle (on team_members / practice_clients / a new athlete_state row):
  status ∈ {active, invited, archived, removed}
  archived_at timestamptz null, archived_by uuid null,
  purge_after  timestamptz null    -- retention clock
```

- **Soft-delete / archive** (`athlete.archive`): sets `archived`, stops alerts/leaderboard
  inclusion, **freezes but never deletes** history. RLS hides archived athletes from default
  roster reads (`AND not is_archived(athlete_id)` in the roster predicate) but `report.view` +
  an explicit "show archived" still reads them. Logs an `athlete.archive` row.
- **Restore** (`athlete.restore`): clears `archived_at`, re-includes. Logged. Symmetric.
- **Retention:** archived athlete data is retained until `purge_after` (default INFERRED:
  **365 days** — founder confirm; minors may legally require longer). A scheduled job (Edge
  Function cron) hard-purges rows past `purge_after`, writing a final `retention.purge` audit row
  (org-scoped, athlete-id retained, no PHI) for compliance.
- **Permanent deletion:** **only the athlete** (account self-deletion, `0007_delete_account`) or
  a retention purge destroys raw athlete data. **An org can never permanently delete an athlete's
  history** — it can only *archive + lose access*. This enforces *athletes own their data;
  organizations own access only*. Org-side "delete" = remove the grant; the athlete's data lives
  on under their account.

> This is the most important safety invariant: **org-initiated removal is always reversible /
> access-only; only the data owner (or retention policy) destroys data.** Other docs MUST NOT add
> an org-side hard-delete of athlete logs.

### 3.7 The cross-cutting contract (the one predicate)

Every other architecture doc, RPC, Edge Function, and screen MUST route athlete access through:

```
allowed(viewer, athlete, scope, action) → boolean
  := consent_ok(athlete)                              -- §3.4 consent pre-filter (supreme)
     AND sees_athlete(viewer, athlete)                -- §3.3 reach + group scope
     AND has_permission(viewer, org_of(athlete), action)  -- §3.1 role ⊕ override
```
where `scope` is the org/unit/group context resolved from the viewer's grant, and `action` is a
permission key from §3.2. **Reads** use `action='report.view'`; **mutations** use the specific
key. No doc may invent a second access path; no surface may check role *names* directly (always
permission keys); no override may bypass `consent_ok`.

## 4. Open decisions for the founder

1. **Override granularity** (§3.1): per-(org, role, permission) only, no per-user exceptions? *(Recommended yes.)*
2. **Specialist default visibility** (§3.3): `deny_until_scoped` for specialist roles, `broad` for leadership — confirm the per-role `scope_default`.
3. **Parent billing context** (§3.2): `billing.own` ✓ for Parent only in the consumer Parent-Plan, ✗ in org context — confirm.
4. **Retention window** (§3.6): default purge horizon for archived athletes (365 days proposed); separate, longer horizon for minors?
5. **Custom-role authoring** is tagged **[DON'T BUILD YET]** — confirm the wedge ships with the **fixed 12-role catalog + per-org permission overrides** and defers user-authored roles.
6. **Audit read for assistant/specialist roles**: should Position/Strength coaches see audit for athletes in their group, or is `audit.view` leadership-only? *(Proposed leadership-only + athlete-self.)*
7. **Undo scope**: which actions are revertible via `revert_change` (goals/macros/plan yes; access-grant revert = re-grant, also fine)? Confirm meal-edit undo is in/out.
