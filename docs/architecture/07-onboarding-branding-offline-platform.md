# 07 — Onboarding, Bulk Provisioning, Branding, Offline, Multi-Org & Enterprise Platform

> Target 10-year architecture for how people and organizations *get into* OnStandard (solo
> athlete → 150-athlete department), how a premium org *brands* the experience, how the app
> works *offline*, how a multi-org member *switches workspaces*, and the *seam* for the
> enterprise platform surface (SSO/API). Plus a non-destructive migration path from today's
> role/flow-centric onboarding (`src/screens/onboarding`, `flows.ts`), local-first Zustand +
> AsyncStorage store, and flag-OFF backend.
> **Design only** — no app/TS code, no SQL migrations shipped here. Authored 2026-06-29.
> Depends on doc `01` (the `organizations`/`org_memberships` spine + `invitations` table) and
> doc `02` (the `allowed(viewer, athlete, scope, action)` predicate + group scoping). This doc
> owns *provisioning, identity claim, branding config, the offline durable queue, the active-
> workspace context object, and the SSO/API seam.*

---

## 1. Summary

OnStandard must onboard a continuum — a 14-year-old logging her first meal solo, a private
nutritionist with a cross-school book, and an athletic director provisioning **150 athletes from
a SIS export in one sitting** — through *one* identity model where **every athlete claims exactly
one permanent profile** (doc 01's "athlete owns the data"), and an import **dedupes a transferring
athlete against their existing profile rather than minting a second** (the cardinal sin this doc
must prevent). The deliverable has five parts: (1) an **onboarding architecture** that splits
*activation* (the solo, score-first hero path that exists today) from *provisioning* (bulk roster
import + invite/claim) and unifies both on doc 01's `invitations`/`org_memberships`; (2)
**organization branding** stored as an `org_branding` config that themes the app *per active
workspace* by extending the existing `ThemeProvider`; (3) an **offline durable queue** (`outbox`)
that makes meal photos, water, weight, and notes survive an offline session and sync with
deterministic, last-writer-wins-by-field conflict resolution — evolving today's AsyncStorage
day-cache into a proper write-ahead log; (4) the cross-cutting **active-workspace context object**
(`ActiveWorkspace`) that the *entire app* reads to scope every view, every report, every brand,
and — critically — every RLS query, because RLS already keys off `org_memberships` (doc 01) and
the active workspace simply *selects which membership is in force*; and (5) **SSO (SAML/OIDC) and a
public API** designed as `[DON'T BUILD YET]` target capabilities with a concrete seam, not built
now. The cross-cutting contract this doc exports: **`ActiveWorkspace` is the single source of
truth for "which org am I acting in right now"; every screen, query, brand, and report reads it,
and it resolves to exactly one `org_membership` whose scope feeds doc 02's `allowed(...)`.**

---

## 2. Reconciliation with today

| Tag | Element | Reality |
|---|---|---|
| **[ALREADY BUILT]** | Activation-first athlete onboarding (score-first, <5 min) | `src/screens/onboarding/Onboarding.tsx`, `flows.ts` (`athleteFlowKeys`), `ScoreReveal.tsx`, spec `2026-06-23-onboarding-redesign.md`. The hero path. KEEP — it becomes the *individual activation* leg. |
| **[ALREADY BUILT]** | Data-driven role flows (one renderer, `ROLE_FLOWS` as step descriptors) | `flows.ts`. The right abstraction (flows-as-data). EVOLVE to add a provisioning leg, don't rewrite. |
| **[ALREADY BUILT]** | Backend-gated account step + consent step spliced in only when `isBackendLive` | `flows.ts` (`roleFlowFor`, `ACCOUNT_STEP`; athlete `'account','consent'` only when live). The seam that keeps flag-OFF byte-identical. PRESERVE this discipline for every new step. |
| **[ALREADY BUILT]** | Server-generated unique join code + atomic create-as-staff RPC | `0004_create_team.sql` (`gen_join_code`, `create_team`), `join_team`. The provisioning primitive. EVOLVE into `accept_invitation` (doc 01 §3.8). |
| **[ALREADY BUILT]** | One-profile-per-`auth.users` identity + auto-profile-on-signup trigger | `0001_schema.sql` (`profiles`, `handle_new_user`). This **is** "one permanent profile." Claim/dedupe builds on it. |
| **[ALREADY BUILT]** | Guardian-consent fail-closed gate (minor data stays on-device) | `src/core/consent.ts`, `0008_guardian_consent.sql`. Bulk import NEVER bypasses it — a provisioned minor is a *placeholder*, not synced data, until a guardian verifies. |
| **[ALREADY BUILT]** | Local-first Zustand store + AsyncStorage persist with `partialize` | `src/store/useStore.ts` (`persist`, `aos_day`, `partialize`). The app already works fully offline for the *current* day. The offline section EVOLVES this, it doesn't invent local-first. |
| **[ALREADY BUILT]** | Inert sync seam, consent-gated, fail-closed | `src/store/sync.ts` (`pushDay`/`hydrateDay`), `mealSync.ts` (`recordMeal`, photo upload). The offline `outbox` wraps THESE — they stay the single write path. |
| **[ALREADY BUILT]** | Theme mechanism (palette swap via `ThemeProvider`/`useColors`) | `src/ui/theme.tsx`, `tokens.ts`. Org branding is a *third palette source* layered on this — no new theming engine. |
| **[ALREADY BUILT]** | `profiles.org_name` (overseer-editable display name, syncs) | `0009_profile_org_name.sql`. The seed of "org identity." EVOLVE: identity belongs on the *org*, not the person. |
| **[ALREADY BUILT]** | Per-owner subscription seam (`isPro`, entitlement) | `0010_subscriptions.sql`, `src/core/subscription.ts`. Branding + bulk-seat provisioning are entitlement-gated reads off this. |
| **[EVOLVE]** | `flows.ts` role flows → add an `import` provisioning step + a `claim` flow | New step kinds (`{kind:'import'}`, claim landing), gated `isBackendLive` exactly like `ACCOUNT_STEP`. |
| **[EVOLVE]** | `aos_day` AsyncStorage cache → durable `outbox` write-ahead log | The day-cache is *state*, not a *queue*; offline edits to past days / multiple meals / a flaky network need an explicit op log. |
| **[EVOLVE]** | `profiles.org_name` → `organizations.name` + `org_branding` | Identity + branding move to the org (doc 01's `organizations`). |
| **[EVOLVE]** | Implicit "current flow/role" → explicit `ActiveWorkspace` context | Today a user IS one role. Multi-org needs an *active selection* among N memberships. |
| **[NEW]** | `roster_imports` + `roster_import_rows` (staging) + `claim` flow + dedupe/match | The bulk-150 path. Staging rows become `invitations`; an athlete claims → one `org_membership`. |
| **[NEW]** | `org_branding` (logo, colors, welcome, announcement, AI greeting) | Premium-org identity config. |
| **[NEW]** | `outbox` (durable offline op queue) + `sync_state` (cursor/conflict log) | The offline durable queue + sync. |
| **[NEW]** | `ActiveWorkspace` context object (pure `src/core/workspace.ts` + a React provider) | The cross-cutting contract of this doc. |
| **[DON'T BUILD YET]** | SSO (SAML/OIDC), SCIM auto-provisioning, public REST/GraphQL API + API keys + webhooks | Correct 10-year enterprise target; massive over-build with zero enterprise customers and a flag-OFF backend. Ship the **seam** (`identity_providers` table shape, `domain → org` mapping, an `api_clients` stub) and the architectural shape; build nothing live. §7. |
| **[DON'T BUILD YET]** | Direct SIS/roster real-time integrations (PowerSchool, Arms, Teamworks API sync) | The wedge ships **CSV import** (covers 95% of the 150-athlete case). A live SIS connector is a partner-driven v3. Design the import as a *pluggable source* so SIS is "another row producer." |
| **[DON'T BUILD YET]** | Full theming surface (custom fonts, per-screen layouts, white-label app builds) | Org branding ships **logo + accent color + welcome/announcement/AI-greeting copy** only. Custom fonts/layouts/native white-label are enterprise v3. |

---

## 3. The design — Onboarding (Deliverable #15)

### 3.1 The split: ACTIVATION vs. PROVISIONING (the key onboarding insight)

Today's onboarding conflates two jobs the 10-year model must separate:

- **ACTIVATION** = *one person reaching first value* (the score-first hero path; `athleteFlowKeys`).
  Owned by the individual; optimizes for time-to-first-meal. **Unchanged in shape** — it stays the
  bespoke athlete flow + the short overseer flows.
- **PROVISIONING** = *an org granting many people access* (the AD importing 150 athletes; a coach
  sharing a code; a nutritionist inviting a client). Owned by the org; optimizes for throughput and
  **must never create a duplicate athlete**.

The two meet at exactly one object — doc 01's **`invitations`** — and resolve to exactly one
**`org_memberships`** row. Every provisioning path (a typed code, a targeted email, a CSV row, a
future SIS feed) is *a way to produce an `invitations` row*; every activation path ends in *claiming*
that invitation onto the user's one permanent profile.

```
PROVISIONING (org grants)                        ACTIVATION (person claims)
  bulk CSV/SIS  ─┐                                  ┌─ existing profile  ─┐
  coach code    ─┼─► roster_import_rows ─► invitations ─► accept_invitation ─► org_memberships
  email invite  ─┘   (staged, deduped)            └─ new signup ─────────┘        (the one grant)
```

### 3.2 Solo → department: the onboarding ladder (one model, four sizes)

| Onboarder | Path | Org created | Provisioning |
|---|---|---|---|
| **Solo athlete** (today's hero) | `athleteFlowKeys` activation | none (or a `kind='family'` org only if a parent links) | self-claims own profile |
| **Solo pro** (trainer/nutritionist) | overseer flow → `create_organization(kind='private_practice')` | 1 org (themselves = `admin`) | invites clients one at a time (email/code), each `scope_kind=individual` |
| **Single coach / one team** (today's `create_team`) | overseer flow → `create_organization(kind='school'|'club')` + one program + one group | 1 org → 1 program → 1 group | shares a group join code (a standing `open` invitation) |
| **Athletic department (150)** | **AD provisioning flow** → org + N programs/groups → **bulk CSV import** → invite/claim | 1 org → N programs → N groups | `roster_import` → staged rows → bulk `invitations` → athletes claim |

> The first three already exist (or are doc-01 evolutions of `create_team`). **The fourth is the
> net-new work of this slice**, and the rest of §3 details it.

### 3.3 Bulk onboarding of 150 athletes (the requirement)

**Step 1 — Source the roster (pluggable).** The AD uploads a **CSV** (or, `[DON'T BUILD YET]`, a
SIS feed produces the same rows). The CSV is parsed *client-side into staging rows* — the file
itself never needs to leave the device until the AD confirms a mapping. Expected columns (lenient,
header-mapped): `first_name, last_name, email?, grad_year?, sport?, group?, position?,
guardian_email?, birthdate?`.

```sql
create table roster_imports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by      uuid references profiles(id) on delete set null,
  source          text not null default 'csv' check (source in ('csv','sis','manual')),
  filename        text,
  row_count       int not null default 0,
  status          text not null default 'staged'
                    check (status in ('staged','matched','invited','completed','aborted')),
  created_at      timestamptz not null default now()
);

create table roster_import_rows (
  id              uuid primary key default gen_random_uuid(),
  import_id       uuid not null references roster_imports(id) on delete cascade,
  raw             jsonb not null,                  -- the original CSV cells (audit + re-map)
  first_name      text, last_name text, email text,
  grad_year       int,  sport text, group_hint text, position text,
  guardian_email  text, birthdate date,
  -- DEDUPE RESULT (the cardinal-sin guard):
  match_profile_id uuid references profiles(id),   -- the existing athlete this row resolves to
  match_kind       text not null default 'new'
                    check (match_kind in ('new','exact_email','probable','manual','ambiguous')),
  match_score      numeric,                         -- 0..1 confidence for probable matches
  invitation_id    uuid references invitations(id), -- set once the row is converted
  status           text not null default 'pending'
                    check (status in ('pending','matched','skipped','invited','claimed','error')),
  error            text
);
```

**Step 2 — Dedupe / match (so a transferring athlete is MATCHED, never DUPLICATED).** Before any
invitation is sent, every staging row is resolved against existing `profiles` via a
**`SECURITY DEFINER` matching RPC** (`match_roster(import_id)`), tiered most-specific-first:

1. **`exact_email`** — `email` matches an existing `profiles.email` (case-folded) → bind
   `match_profile_id`, `match_kind='exact_email'`. This is the transfer/return case: the athlete
   already has a profile (from a prior school, a private trainer, or solo use) and we attach a *new
   membership*, not a new profile.
2. **`probable`** — fuzzy on `(last_name, first_name, grad_year, birthdate)` within a normalized
   distance → `match_kind='probable'`, `match_score`, surfaced to the AD for **one-tap confirm or
   reject** (never auto-merged — a wrong merge leaks one athlete's data to another).
3. **`new`** — no candidate → a fresh invitation that will mint a profile when claimed.

> **Privacy guard (must honor consent + minimization):** matching runs server-side in a
> `SECURITY DEFINER` RPC that returns **only** `(row_id, match_kind, match_score, masked_hint)` —
> e.g. "Possible match: J. C., '26" — **never** another athlete's email, full name, or any health
> data. The AD confirms a match without ever seeing the matched athlete's protected data. This is
> the dedupe-vs-privacy tension resolved in favor of privacy.
>
> **INFERRED — founder/legal confirm:** an `exact_email` match **auto-binds** (high confidence);
> a `probable` match **requires human confirm**; an `ambiguous` (>1 candidate) match is **never
> auto-bound**. Confirm the auto-bind-on-exact-email policy — the alternative (confirm *every*
> match) is safer but kills the throughput that makes bulk import worth building.

**Step 3 — Convert to invitations (bulk).** `commit_roster(import_id)` (SECURITY DEFINER, requires
`member.invite` / `group.manage` per doc 02) walks `status='pending'|'matched'` rows and, for each,
inserts a doc-01 `invitations` row carrying `intended_role='athlete'`, the resolved `scope_kind=group`
+ `scope_id` (from `group_hint`), an `email` (targeted), and — for minors — a `guardian_email`. It
sets `roster_import_rows.invitation_id` and flips status to `invited`. Idempotent: re-running skips
already-`invited` rows (so a partial failure is safely resumable). **Seat accounting:** the count of
`invited` rows is checked against the org's `subscriptions.seats` (doc 01 keys subs to the org); over
capacity → the import stages but `commit` blocks with a clear "N seats short" error rather than
silently over-provisioning.

**Step 4 — Invite delivery + claim.** Each `invitation` produces (a) a **per-row claim link/code**
(deep link `aos://claim/<code>` + a short human code) emailed to the athlete or `guardian_email`, and
(b) a fallback **single group join code** the coach can broadcast (today's `join_code`, unchanged).
The athlete opens the app and hits the **claim flow**:

- If `match_profile_id` is set and the user **signs in** as that profile → `accept_invitation(code)`
  reactivates/creates the `org_membership` against their **existing** profile. *No duplicate.* Their
  full history is already there — the new coach sees it the moment consent is (re)granted.
- If `match_kind='new'` → a **shortened activation** (sign up → minimal baseline → claim). The
  invitation pre-fills sport/group/position so the athlete confirms rather than re-enters.
- If a **minor** → the claim routes through `request_guardian_consent` (`0008`) to `guardian_email`;
  **the membership is created but the consent gate (`src/core/consent.ts`) keeps the minor's real
  data on-device until the guardian is `verified`.** A provisioned-but-unclaimed minor is a *seat
  placeholder*, not a data subject. This is the non-negotiable reconciliation with the fail-closed
  gate.

> **INFERRED — founder confirm:** the athlete **always claims their own profile** (athletes own
> their data, doc 01). An AD **cannot** create a usable athlete account *on behalf of* a student and
> backfill data — they can only *invite*. The only thing that exists pre-claim is an invitation + an
> empty seat. Confirm this; it is the literal mechanism of "athlete owns one permanent profile."

### 3.4 The claim flow as a `flows.ts` evolution (preserve the seam)

`flows.ts` gains two additive, **`isBackendLive`-gated** pieces (flag-OFF stays byte-identical):

- a new overseer step kind `{ kind: 'import'; title; sub }` spliced into the AD/coach flow only when
  live (mirrors `ACCOUNT_STEP`'s `roleFlowFor` splice); and
- a **claim landing** (`flow: 'onboarding'`, entered via the `aos://claim/<code>` deep link) that
  short-circuits the athlete flow: known invitation → confirm-and-claim instead of the full baseline.

Pure flow-key logic stays unit-testable in `src/core` (a `claimFlowKeys(invitation)` companion to
`athleteFlowKeys`), keeping `src/core` purity (no RN import) intact.

---

## 4. The design — Organization Branding

### 4.1 Where branding lives

Branding is **org config, entitlement-gated** (premium orgs only — reads off `0010` via `isPro`).
It hangs off doc 01's `organizations` and is delivered to the client as part of resolving the
`ActiveWorkspace` (§6).

```sql
create table org_branding (
  organization_id uuid primary key references organizations(id) on delete cascade,
  logo_path       text,            -- storage: org-assets/{org_id}/logo.png (public-read bucket)
  accent_color    text,            -- hex, validated; themes the accent token (§4.2)
  accent_dark     text,            -- optional dark-scheme accent
  welcome_title   text,            -- post-claim welcome screen ("Welcome to Lincoln Football")
  welcome_body    text,
  announcement    jsonb default '{}',   -- {text, starts_at, ends_at, dismissible} — a banner
  ai_greeting     text,            -- prepended to the coach-voice greeting ("Coach K's program")
  org_display_name text,           -- supersedes profiles.org_name (identity moves to the org)
  updated_by      uuid references profiles(id) on delete set null,
  updated_at      timestamptz not null default now()
);
```

**Read access:** branding is **org-public to members** — `select using (caller has any active
`org_membership` in organization_id)`. **Write access:** `branding.edit` permission (doc 02; default
Org Owner / AD / Personal Trainer), via an RPC that writes an `activity_log` row (doc 02 §3.5).
**Logo storage:** an `org-assets` bucket, org-scoped path, public-read (a logo is not PHI); contrast
of `accent_color` against the light/dark surfaces is validated with the existing `core/contrast.ts`
util at write time so branding can never produce an unreadable UI.

> **Constitution guard (Rule #8/#9):** branding themes *chrome and copy* — it **must not** restyle
> the Development Score ring, recolor grade bands, or alter any number's meaning. The score stays
> platform-owned and identical across orgs (Rule #13). A premium org gets *their colors around* the
> number, never *their version of* the number. `ai_greeting` is a *prefix*, not a replacement, and
> never touches scoring/safety copy.

### 4.2 How the app themes per active workspace

The existing `ThemeProvider` (`src/ui/theme.tsx`) swaps light/dark palettes. Branding adds a **third
input layered on top**: the active workspace's `accent_color` overrides the `accent`/`brand` tokens
**only**, leaving every structural/semantic token (surfaces, text, score-band colors) untouched.

```
effective palette = basePalette(scheme)            // existing light/dark (theme.tsx)
                    ⊕ activeWorkspace.branding.accent   // org accent override (premium only)
```

Concretely: `useColors()` evolves to read `{ ...basePalette, accent: workspace.branding?.accent ??
basePalette.accent }`. Components already migrating from `import { colors }` → `useColors()`
(theme.tsx's documented step 1) inherit branding for free. Switching workspace (§6) re-resolves the
accent, so the *whole app re-skins* to the active org with no per-screen wiring. A solo user or a
non-premium org gets the default Athlete-Blue (byte-identical to today).

---

## 5. The design — Offline mode (durable queue + sync)

### 5.1 What exists vs. what's missing

Today the app is **local-first for the current day**: the Zustand store + `aos_day` AsyncStorage
`partialize` (`useStore.ts`) means meals/water/weight/notes already *work* with no network — they
mutate local state and the UI updates. What's missing for true offline is **durability of intent
across sessions and a deterministic sync**: the current cache is *latest state of today*, so (a) edits
to a *past* day made offline, (b) *multiple* meal photos captured offline, and (c) ordering/retry on
a flaky network have no home. `sync.ts`/`mealSync.ts` push *immediately* when live and *drop* when
off (the photo is dropped by design). We make the drop **durable**.

### 5.2 The `outbox` write-ahead log (the durable queue)

Introduce a **local, durable, append-only op log** in front of `pushDay`/`recordMeal`. Every
offline-capable mutation enqueues an **operation**; a sync worker drains it FIFO when connectivity +
consent allow. The queue lives in **AsyncStorage today** (consistent with the existing persist
mechanism) with the *interface* designed so it can swap to SQLite/MMKV later without call-site change.

```ts
// src/core/outbox.ts  (NEW, pure — no React/RN/Supabase; the queue MODEL + reducers)
export type OutboxOpKind = 'meal.log' | 'water.set' | 'weight.set' | 'note.set' | 'day.upsert';
export interface OutboxOp {
  id: string;                 // client-generated uuid (idempotency key)
  kind: OutboxOpKind;
  athleteId: string;
  date: string;               // the day the op applies to (YYYY-MM-DD) — supports past-day edits
  payload: Record<string, unknown>;   // e.g. meal macros + a LOCAL photo handle (not bytes)
  baseVersion: number | null; // the day's version this op was authored against (conflict detect)
  createdAt: number;          // client clock (ms) — the LWW timestamp
  attempts: number;
  status: 'pending' | 'inflight' | 'synced' | 'conflict' | 'failed';
}
export function enqueue(q: OutboxOp[], op: OutboxOp): OutboxOp[];
export function nextBatch(q: OutboxOp[], now: number): OutboxOp[];   // FIFO, respects backoff
export function reconcile(q: OutboxOp[], result: SyncResult): OutboxOp[]; // apply server outcome
```

Key properties:
- **Idempotent by `op.id`** — the server upsert keys on it, so a retry after an ambiguous failure
  never double-writes (e.g. two meals). Photo bytes are **not** in the op (kept out of AsyncStorage,
  as `mealPhoto` already is in `partialize`); the op holds a **local file handle** to the captured
  JPEG, uploaded at drain time via the existing `uploadMealPhoto`.
- **Consent still gates the drain, not the enqueue.** Enqueue always succeeds (the athlete can log
  offline). The **drain** calls `realDataConsent` (unchanged `core/consent.ts`): a minor without a
  verified guardian **accumulates ops locally and never drains** — the data stays on-device exactly
  as the fail-closed gate requires. If consent is later granted, the backlog drains; if `delete
  account` / `sharingPaused`, the outbox is purged/held. This is the cleanest possible reconciliation
  of offline-durability with the consent invariant.
- **The pure reducers live in `src/core`** (`outbox.ts`), so queue logic is unit-testable offline and
  stays free of RN/Supabase — same discipline as `sync.ts`'s pure `mapStateToDayRow`. The RN side is a
  thin worker (`src/store/outboxWorker.ts`) wiring connectivity (`NetInfo`) + the AsyncStorage adapter.

### 5.3 Sync & conflict resolution

Add a server `version` to the `days` row and a lightweight per-meal idempotency key:

```sql
alter table days  add column version int not null default 0;     -- bumped each upsert
alter table meals add column client_op_id uuid unique;           -- idempotency from outbox
```

**Resolution policy — last-writer-wins *per field*, with an immutable-history exception:**

- **Counters/scalars (water, weight, note, checkin answers):** **field-level LWW by
  `op.createdAt`**. Because the athlete is the *only* writer of their own logs (doc 01/02 invariant),
  cross-device conflict is the only real case (phone offline at the gym + tablet at home). Field-level
  LWW means "the most recently *intended* value wins," which matches user expectation and is
  deterministic. The server compares `op.baseVersion` to the row's current `version`: equal → apply +
  bump; stale → **merge field-by-field by timestamp** (the offline op only wins fields it actually
  changed and is newer for), then bump. No silent whole-row clobber.
- **Meals (append events):** meals are **additive**, keyed by `client_op_id` — two offline meals are
  two inserts, never a conflict. Re-logging the *same slot* upserts on the stable photo path (existing
  `mealSync` behavior) — last capture wins for that slot.
- **Score history (immutable):** `scoreHistory`/`days.score` for a **closed past day is never
  overwritten by a late offline op** — the score is recomputed by `src/core` from the merged inputs
  and written forward; a finalized historical day is append-not-mutate (honors the scoring-integrity /
  history-immutability invariant from the Constitution + doc 02). An offline edit to *today* is fine
  (the day isn't closed); an offline edit arriving for a long-closed day is recorded as a correction
  event, not a silent rewrite of a graded day.

> **INFERRED — founder confirm:** field-level LWW (vs. a CRDT or a user-facing conflict prompt). For
> single-writer athlete data the conflict surface is tiny, so LWW is the right amount of machinery; a
> conflict *prompt* would violate Rule #5 ("reduce decisions"). Confirm LWW-by-field as the policy;
> revisit only if real multi-device conflict data shows it's wrong.

---

## 6. The design — Workspace switching & the `ActiveWorkspace` context (THE cross-cutting contract)

### 6.1 The object

A multi-org member — a nutritionist serving 6 schools, or an athlete in *university + private trainer
+ 7-on-7 club* — has **N `org_memberships`** (doc 01 §3.7) but acts in **exactly one at a time**. The
**`ActiveWorkspace`** is the app-wide context that names which one, and **everything reads it**:
navigation, dashboards, reports, branding (§4), and — the load-bearing part — the **RLS scope** of
every query.

```ts
// src/core/workspace.ts  (NEW, pure — no React/RN/Supabase)
export interface Workspace {
  organizationId: string;
  organizationName: string;
  kind: string;                       // school|club|private_practice|family|college|...
  membershipId: string;               // the doc-01 org_membership in force
  role: import('./membership').MembershipRole;
  scopeKind: import('./membership').ScopeKind;
  scopeId: string | null;
  branding?: { accent?: string; accentDark?: string; logoUrl?: string; aiGreeting?: string };
  entitlement: import('./subscription').Entitlement;  // per-ORG entitlement (doc 01 keys subs to org)
}
export interface ActiveWorkspace {
  active: Workspace | null;           // null = solo / personal context (no org)
  available: Workspace[];             // all of the user's active memberships, for the switcher
}
export function resolveActive(available: Workspace[], lastActiveId: string | null): Workspace | null;
export function switchTo(state: ActiveWorkspace, organizationId: string): ActiveWorkspace;
```

`available` is derived from the user's active `org_memberships`; `active` is one of them (persisted
last-active id, defaulting to the athlete's **primary** membership — the doc-01 §3.7 open question of
*which* membership drives a multi-org athlete's personal Game Plan resolves here: the **primary**
workspace is the personal-plan driver; other workspaces are read-side projections).

### 6.2 How RLS follows the active workspace (the critical part)

Doc 01/02 already make **`can_view` / `allowed(...)` key off `org_memberships`** — so RLS is *already*
org-scoped. The active workspace does **not** add a new access path; it **selects which membership the
*current request* asserts**. Mechanism:

- For **staff** (coach/nutritionist/trainer viewing a roster), every roster/report query is filtered
  client-side to the active workspace's `organizationId` + scope, and the server RLS independently
  re-checks `allowed(viewer, athlete, scope, 'report.view')` (doc 02). The active workspace is a
  *narrowing* of what RLS already permits — it can never *widen* access (defense in depth: even if the
  client sent the wrong org, RLS denies what the membership doesn't cover).
- The active `organizationId` rides every request as a **scope hint** (e.g. a request header / RPC
  arg `acting_org`), and scoped RPCs (`coach_set_goals`, report fetches) assert the caller has an
  active membership in `acting_org` with the needed permission. **An invalid `acting_org` is denied,
  never default-allowed** (fail-closed).
- For an **athlete** in multiple orgs, switching workspace changes *which org's targets/branding/
  reports they view*, but their **one** stream of `days`/`meals` is unchanged (athlete owns one data
  set; orgs are lenses — doc 01 §3.6). Their personal Game Plan follows the **primary** workspace.

> **Cross-cutting contract exported by this doc:** *no screen, query, or RPC reads "the user's role"
> globally anymore — they read `ActiveWorkspace.active` and derive role + scope + branding + org
> entitlement from it.* The active org is passed as `acting_org` to every scoped RPC and re-validated
> server-side; RLS (`org_memberships`) is the authority, the active workspace is the selector. This is
> the successor to today's single implicit `flow`/`role`.

### 6.3 Migration from "you are one role" to "you select a workspace"

Today the store holds a single `flow`/`role` (and `partialize` persists them). Migration is
non-destructive: a single-membership user's `ActiveWorkspace.active` is *that* membership, and the UI
shows **no switcher** (one workspace = today's experience, unchanged). The switcher appears only when
`available.length > 1`. Flag-OFF / solo users get `active = null` (personal context) and the app reads
exactly as today. So the cross-cutting object ships *inert* for the current single-role world and
*activates* the moment a second membership exists — the same inert-seam discipline as
`subscription.ts`/`consent.ts`.

---

## 7. The design — Enterprise platform: SSO & public API (`[DON'T BUILD YET]` seam)

Both are **target capabilities with a defined seam, built later**. We author the *shape* so the
schema and auth flow don't need a disruptive migration when an enterprise customer appears.

### 7.1 SSO (SAML / OIDC) — seam only

Schools/departments will demand "sign in with our Google Workspace / district SSO." Supabase Auth
supports SSO (SAML/OIDC) providers; the OnStandard-specific work is **mapping an IdP + email domain to
an organization** so an SSO sign-in *auto-resolves the right workspace*.

```sql
-- [DON'T BUILD YET] — seam shape only
create table identity_providers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  protocol        text not null check (protocol in ('saml','oidc')),
  email_domain    text,            -- "lincoln.k12.us" → auto-join this org on SSO sign-in
  config          jsonb not null default '{}',   -- IdP metadata/endpoints (no secrets in plaintext)
  status          text not null default 'disabled' check (status in ('disabled','active')),
  created_at      timestamptz not null default now()
);
```

Flow (designed, unbuilt): SSO sign-in → existing `handle_new_user` mints the one `profile` → a
`domain → organization` lookup auto-provisions an `org_membership` (or pre-binds a pending
`invitation`). **SCIM auto-provisioning/deprovisioning** is a further v3 layer on the same `invitations`
+ `membership_events` spine (doc 01) — a deprovision is just a `removed` status transition, so the
lifecycle ledger already models it. **Nothing here is built now**; the column exists so it isn't a
migration emergency later.

> **INFERRED — founder confirm:** consumer auth (athletes, parents, solo pros) stays
> email/password/Apple (`src/lib/auth/apple.ts`); **SSO is an *org-staff* and *enrolled-student*
> convenience, never the only path** (a transferring athlete must be able to sign in to their
> permanent profile even after leaving the SSO org — else "athlete owns the profile" breaks). Confirm
> SSO is additive, never exclusive.

### 7.2 Public API — seam only

A public API (programs pulling roster compliance into their own systems; partners building on the
Proof dataset) is a real 10-year asset but **premature**. The seam:

```sql
-- [DON'T BUILD YET] — seam shape only
create table api_clients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  key_hash        text not null,          -- hashed API key; never store the raw key
  scopes          text[] not null default '{}',  -- e.g. {'reports:read','roster:read'}
  status          text not null default 'active',
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
```

Design principles for when it's built: (a) the API is **org-scoped and read-mostly** — it can read
roster compliance/reports its `scopes` allow, but **never** an athlete's raw meal photos or bypass the
consent gate (the API is *another viewer*, subject to the same `allowed(...)` predicate, doc 02); (b)
it surfaces **the Proof/outcomes dataset** as the eventual sellable asset (Constitution §11.3); (c)
versioned, key-hashed, rate-limited, webhook-capable — standard Stripe/Slack-style API hygiene. Built
only when a partner with a signed need exists.

---

## 8. RPC / Edge-Function surface (target signatures)

All `SECURITY DEFINER`, `search_path=public`, permission/scope-checked (doc 02), consent-respecting,
each writing an `activity_log` row where it mutates.

- `create_organization(name, kind) → org_id` — caller becomes `admin` membership (doc 01).
- `start_roster_import(org_id, source, filename) → import_id` + client-side staging insert.
- `match_roster(import_id) → {row_id, match_kind, match_score, masked_hint}[]` — privacy-safe dedupe.
- `confirm_roster_match(row_id, profile_id | null)` — AD resolves a `probable`/`ambiguous` row.
- `commit_roster(import_id) → {invited:int, seats_short:int}` — staged rows → bulk `invitations`;
  blocks on seat shortfall.
- `accept_invitation(code) → membership_id` — doc 01's claim; binds to existing profile if matched
  (no duplicate); routes minors through guardian consent.
- `set_org_branding(org_id, branding jsonb)` — `branding.edit`; validates contrast.
- `set_active_workspace(org_id)` — server-side record of last-active (optional; client can hold it).
- `[DON'T BUILD YET]` `provision_via_sso(...)`, `create_api_client(...)`, `rotate_api_key(...)`.

---

## 9. Migration path (non-destructive, staged)

1. **Phase 0 (now / flag-OFF):** nothing destructive. Author `outbox` reducers in `src/core` + the
   `ActiveWorkspace`/`Workspace` pure types (`src/core/workspace.ts`, `src/core/outbox.ts`) as inert
   seams (the established `consent.ts`/`subscription.ts` pattern). The app stays single-role,
   single-day-cache, byte-identical. ~970 tests pass (new pure modules are additive + unit-tested).
2. **Phase 1 (offline durability):** wire the `outbox` worker in `src/store` in *front* of the
   existing `pushDay`/`recordMeal` — they remain the single write path + consent gate. Add `days.version`
   + `meals.client_op_id` (authored migrations, applied at go-live per the D1 guardrail). User-visible
   win: offline logging survives app restart and syncs deterministically.
3. **Phase 2 (active workspace, inert):** introduce `ActiveWorkspace` resolved from the single
   membership a user already has; **no switcher** until `available.length > 1`. Every scoped read
   starts passing `acting_org`. No behavior change for single-org users.
4. **Phase 3 (branding):** `org_branding` table + `org-assets` bucket; `useColors()` reads the active
   workspace accent. Default palette unchanged for non-premium/solo.
5. **Phase 4 (bulk provisioning):** `roster_imports`/`roster_import_rows` + match/commit RPCs + the
   `flows.ts` `import`/`claim` steps. **Needed only when the first department-scale customer exists** —
   until then the single-coach `create_team`/`join_team` path is sufficient (`[DON'T BUILD YET]`-adjacent).
6. **Phase 5 (enterprise):** `identity_providers` (SSO) + `api_clients` (API) — **seam shapes only**;
   activated per signed enterprise customer.

`src/core` purity holds throughout (`outbox.ts`, `workspace.ts` import no RN/Supabase). The consent
gate is untouched and sits above the outbox drain and every workspace-scoped read.

---

## 10. Open decisions for the founder

1. **Dedupe auto-bind policy (§3.3):** `exact_email` auto-binds, `probable` requires human confirm,
   `ambiguous` never auto-binds. Confirm — this is the duplicate-vs-throughput tradeoff.
2. **Athlete-always-claims (§3.3):** an org may only *invite*, never create-and-backfill a usable
   athlete account; pre-claim = an empty seat + an invitation. Confirm (it's the mechanism of "athlete
   owns one permanent profile").
3. **Conflict policy (§5.3):** field-level last-writer-wins by client timestamp, no user-facing
   conflict prompt, never overwrite a closed/graded day. Confirm (vs. CRDT or prompt).
4. **Primary workspace drives the personal plan (§6.1):** a multi-org athlete designates one
   **primary** membership that drives their Game Plan; other orgs are read-side projections. Confirm —
   this also closes doc 01 §3.7's open question.
5. **Branding scope (§4.1):** logo + accent + welcome/announcement/AI-greeting **only**; no custom
   fonts/layouts/white-label; branding never restyles the Development Score. Confirm the boundary.
6. **SSO is additive, never exclusive (§7.1):** a transferring/graduated athlete can always sign in to
   their permanent profile via email/Apple even after leaving the SSO org. Confirm.
7. **How deep to build now:** confirm the staged plan — offline `outbox` + `ActiveWorkspace` seam are
   the near-term work; **bulk provisioning, branding, SSO, and the API are deferred** until a real
   department/enterprise customer exists. The wedge stays "one coach, one team, one role."

---

## 11. Cross-cutting contract (what every other doc MUST honor)

1. **`ActiveWorkspace.active` is the single source of "which org am I acting in."** Every screen,
   query, report, and brand reads it; no surface reads a global `role`/`flow` anymore. It resolves to
   exactly one `org_membership` and is passed as `acting_org` to every scoped RPC.
2. **The active workspace NARROWS, never widens.** RLS (`org_memberships` / `allowed(...)`, docs
   01/02) is the authority; the active workspace selects which permitted membership a request asserts.
   An invalid `acting_org` is denied, never default-allowed.
3. **Provisioning never creates a duplicate athlete.** Every bulk/invite/SIS path resolves through
   `roster_import_rows` → dedupe → `invitations` → athlete-claim onto their **one** profile. An
   `exact_email`/confirmed match binds a new *membership*, never a new *profile* or a copy of history.
4. **The consent gate sits above the offline drain and every provisioned membership.** Enqueue is
   always allowed; the drain (and any sync of a minor's data) obeys `src/core/consent.ts` unchanged. A
   provisioned-but-unverified minor is a seat placeholder, never a synced data subject.
5. **Branding themes chrome + copy only.** No org config may alter the Development Score's color,
   bands, scale, or meaning (Constitution Rule #13). `ai_greeting` is a prefix, never a scoring/safety
   rewrite.
6. **Workspace/offline logic lives once and pure** — `src/core/workspace.ts` (active selection) and
   `src/core/outbox.ts` (queue reducers, conflict policy). No doc reimplements switching or sync
   resolution; no `src/core` module imports React/RN/Supabase.
