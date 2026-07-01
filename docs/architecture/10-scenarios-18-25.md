# 10 — Architectural Scenarios 18–25 (validating the models)

> Slice owner: Principal Enterprise Architect. Status: **DESIGN ONLY** (no app/TS code, no SQL
> migrations, no tests). Authored 2026-06-29.
>
> Like doc `09`, this doc introduces **no new primitives**. It validates the models authored in
> docs `01`–`07` by walking eight more concrete scenarios end-to-end, and surfaces the gaps those
> docs left open. Every scenario resolves through the existing cross-cutting contracts:
> `org_memberships` + `can_view` (doc 01), `allowed(viewer, athlete, scope, action)` + `activity_log`
> (doc 02), the `ScoringContext` tuple + immutable `plan_versions` (doc 03), the
> `accountability_events` ledger + structured messaging (doc 04), the **Authority Boundary** +
> `assist()` seam + Performance Profile + Memory (doc 05), `resolveEntitlement`/`hasFeature` keyed on
> `organization_id` + the four billing layers (doc 06), and `ActiveWorkspace` + `org_branding` +
> `outbox` (doc 07). Where a scenario needs a decision none of those docs made, it is flagged
> **GAP →** with the doc that owns it.

---

## 1. Summary

These eight scenarios stress the *commercial and lifecycle edges* of the system — the places where
money, multi-org identity, time, and AI longevity meet the athlete-owned data invariant. They fall
out cleanly from three doc-level moves: (a) **billing is org-keyed and the four layers never blur**
(doc 06), so cancellation (18) and mid-season purchase (19) are status/plan transitions on a
`subscriptions` row that *never touch* the athlete's profile half; (b) **the profile half is
permanent and org-free** (doc 01), so graduation (23) and workspace switching (22) move *access*,
not *data* — the athlete's score history, Performance Profile, and AI Memory survive intact; and (c)
**the AI only phrases over a deterministic, athlete-owned substrate** (doc 05), so AI memory and
long-term profiles (25) are an athlete-owned, portable record the org *reads through* `allowed()`,
never owns. Coach approval workflows (20) are the one scenario that exercises a primitive thinly
covered today — a generic **`approvals` request/decision ledger** layered on doc-02's permission
keys and doc-04's event stream — and this doc nails its shape. Optional team leaderboards (21) and
org branding (24) are **opt-in, entitlement-gated chrome** that the Constitution explicitly warns
can distract from execution (§5/§8) — they ship *off by default* and may **never** restyle the
Development Score. The real gaps the models left open and this doc closes: (i) **what happens to an
org's read access and license seat the instant a subscription cancels** (18 — doc 06 left the
data-access consequence implicit); (ii) **mid-season proration + retroactive history visibility** on
a new purchase (19); (iii) the **`approvals` ledger shape** for coach sign-off (20 — no doc owns it
yet); and (iv) the **leaderboard consent + opt-in model** (21 — doc 04 owns the signal but no doc
made the visibility call). Of the eight: **20 (approvals scaffolding via `activity_log`)**,
**21 (leaderboard math)**, and **25 (Performance Profile / Memory)** are partly **[ALREADY BUILT]**;
**24 (branding)**, **21 (team leaderboards)**, and the deep parts of **22/23** are **[DON'T BUILD
YET]** until a multi-org / paying-department customer exists.

---

## 2. Reconciliation with today

| Tag | Scenario element | Where it lives |
|---|---|---|
| **[ALREADY BUILT]** | Inert per-owner subscription seam + fail-safe `previewEntitlement()` | `src/core/subscription.ts`, `0010` — cancellation (18) / purchase (19) start here; org-keying is the doc-06 EVOLVE. |
| **[ALREADY BUILT]** | Pure leaderboard builder + re-rank + `coachRosterKpis` | `src/core/leaderboard.ts` — scenario 21's math exists and is tested; demo-data only (Constitution Rule #10), opt-in + real-data is the gap. |
| **[ALREADY BUILT]** | `coach_set_goals` SECURITY DEFINER RPC (the sanctioned overseer write) | `0002` — scenario 20's "coach changes a target" is already gated; an *approval* wrapper is the [NEW] piece. |
| **[ALREADY BUILT]** | Append-only `activity_log` (doc 02 §3.5) covering goal/plan/access changes | doc 02 — scenario 20's audit trail + scenario 23's lifecycle ledger reuse it verbatim. |
| **[ALREADY BUILT]** | Performance Profile + `athlete_memory_facts` (athlete-owned, portable, append-with-supersede) | doc 05 §4–5 — scenario 25 *is* this model; this doc validates the long-term/longevity edges. |
| **[ALREADY BUILT]** | Theme palette swap via `ThemeProvider`/`useColors` | `src/ui/theme.tsx` — scenario 24's branding layers on this; no new theming engine. |
| **[ALREADY BUILT]** | Membership lifecycle (`graduated`/`transferred`/`left`) + `membership_events` ledger | doc 01 §3.9 — scenario 23 (graduation) is a status transition; the access-half-only move is the whole point. |
| **[ALREADY BUILT]** | `ActiveWorkspace` + `available[]` switcher + `acting_org` re-validation | doc 07 §6 — scenario 22 *is* this model; this doc validates the staff-switching + entitlement-per-org edges. |
| **[EVOLVE]** | `subscriptions.owner_id` → `organization_id`; binary tier → catalog `plan_code`; `licenses` capacity | doc 06 §3.3 — scenarios 18/19. |
| **[EVOLVE]** | `leaderboard.ts` demo constants → real-roster, opt-in, consent-filtered board | scenario 21 — Constitution Rule #10 (demo data never touches a real user) forces this. |
| **[NEW]** | `approvals` (request → decision ledger) for coach/guardian/admin sign-off workflows | scenario 20 — no doc owns it; §20 below. |
| **[NEW]** | `leaderboard_settings` (opt-in, scope, metric, anonymity) per group + per-athlete consent | scenario 21 — the visibility/consent layer doc 04 left open. |
| **[NEW]** | Score-history *snapshot on graduation/cancel* (read-side, derived) for portability proof | scenario 23 — a derived export, not a duplicate store. |
| **[DON'T BUILD YET]** | Full proration/dunning/credit-note engine; in-app plan-change UI | scenarios 18/19 — Stripe Billing Portal (hosted) covers cancel + mid-cycle change at launch (doc 06 §2). |
| **[DON'T BUILD YET]** | Team leaderboards as a shipped surface; org branding beyond logo+accent+copy | scenarios 21/24 — Constitution §5/§8 rate both ≤4; ship the *opt-in seam*, populate after the loop retains. |
| **[DON'T BUILD YET]** | Multi-stage approval routing / SoD workflow engine; AI-memory vector DB | scenarios 20/25 — a single request→decision row covers the wedge; embeddings stay deferred (doc 05 §5.1). |

---

## 3. The scenarios

Each subsection uses the required headings: **Ideal UX · Backend architecture · Permissions · Data
ownership · AI behavior · Edge cases · Scalability.**

---

### Scenario 18 — Subscription cancellation

A coach/org admin (or a solo consumer) cancels their OnStandard subscription. **The single hardest
question, which doc 06 left implicit: what happens to the org's *read access* and the athletes' data
the instant the contract lapses?**

**Ideal UX.** The admin taps **Account → Billing & plan → Manage plan**, which deep-links to the
**Stripe Billing Portal** (B2B) or the OS subscription settings (consumer IAP) — *not* a bespoke
in-app cancel flow (doc 06 §3.7; FTC/ARL "easy as it was to subscribe", `2026-06-29-subscription-
compliance.md`). Cancellation is **at period end by default** (`cancel_at_period_end=true`): the
admin keeps full access until the paid period expires, sees a clear "active until <date>, then
Preview" line, and gets *no* dark-pattern retention maze. Athletes see **nothing** at cancel time —
their app keeps working; only the *org-inherited* premium features quietly fall back to Preview when
the period ends. No data disappears, no roster is wiped, no "your coach left" alarm.

**Backend architecture.** Cancellation is a **status transition on the org's one `subscriptions`
row** (doc 06 §3.3), written *only* by the service-role webhook:

```
Stripe customer.subscription.updated (cancel_at_period_end=true)
  → POST /webhooks/stripe (service_role Edge Fn)
  → idempotent billing_events insert (provider_event_id)
  → update subscriptions set cancel_at_period_end=true            -- still 'active' until period end
...later, at period end...
Stripe customer.subscription.deleted
  → update subscriptions set status='canceled', cancel_at_period_end=false
  → recompute_active_seats(org)        -- license capacity now irrelevant; entitlement falls to preview
```

`resolveEntitlement(viewer)` (doc 06 §3.6) then resolves the org to a **canceled** subscription →
the plan's feature bundle no longer applies → every member of that org **falls back to
`previewEntitlement()`** (the preserved fail-safe). `hasFeature(viewer, key)` returns the Preview
defaults. **No athlete-data table is touched.**

**The access consequence (the gap doc 06 left implicit, closed here):** *billing lapse does NOT
revoke `org_memberships`, and does NOT end `can_view`.* Per doc 02 §3.6 and doc 06 §7.6 — **a paid
seat never implied data access, so losing the seat never removes it.** Access is governed by the
*membership* (doc 01) + *consent* (doc 02), which are independent of who pays. So after cancellation:

- The coach **still sees their roster** (the memberships are intact) but through **Preview-tier
  feature gates** — e.g. `team_analytics`, `restaurant_coach`, AI Copilot drafts go behind the
  paywall, while the core "see your athletes' Development Scores" stays (it's not a premium gate; it's
  the product). *(GAP → doc 06: confirm **which** features are org-premium vs. always-on after lapse;
  the `plan_entitlements` seed for `preview` is the founder's packaging call, doc 06 OD#6.)*
- Athletes **keep logging, keep their score, keep their full history** — they own that data (doc 01).
  An athlete who was *inheriting* premium via the org loses the premium *features* but never the loop.

**Permissions.** Only a member with **`billing.own`** (doc 02 §3.2 — Org Owner / AD / Personal
Trainer / Parent-in-consumer-context) can reach the Billing Portal; the
`create_billing_portal_session(organization_id)` RPC asserts `has_billing_view`/`billing.own` and is
admin-only (doc 06 §4). A position coach or athlete **cannot** cancel the org's plan. All writes are
service-role (the webhook) — *a user can never set `status='canceled'` directly*, only request it via
the provider.

**Data ownership.** This is the scenario that most sharply proves **athletes own their data;
organizations own access only.** Cancellation is an **access-half-only event** (doc 01 §3.1): it
changes the org's *entitlement and license capacity*, never the profile half. The athlete's
`days`/`meals`/`checkins`/`performance_profiles`/`athlete_memory_facts` are byte-identical the
millisecond before and after the org's plan lapses. If the org later re-subscribes, premium features
light back up with zero data migration.

**AI behavior.** The Coach Copilot (doc 05 §6) is an org-premium feature → behind `hasFeature(viewer,
'copilot')`; on cancel it falls back to **deterministic-only** surfaces (`attention.ts` "who needs
attention" still renders its numbers; the *LLM narration* is gated off, exactly as
`isAiConfigured===false` already degrades, doc 05 §3). The AI **never** sends a "your subscription
lapsed" guilt message or pressures re-subscribe — that would violate Founder Rule #6/#8 and the
compliance no-dark-pattern rule. Memory and Performance Profile (athlete-owned) are **untouched** by
cancellation.

**Edge cases.**
- **Past-due → canceled grace:** `status='past_due'` keeps entitlement *active* during the grace
  window (doc 06 §3.6 treats past_due/trialing as still-entitled) so a failed card doesn't instantly
  brick a coach mid-season. The webhook flips to `canceled` only on the provider's terminal event.
- **Cancel with athletes mid-season:** access persists (memberships intact); only premium *features*
  degrade. The coach is never locked out of their roster they still legitimately oversee.
- **Re-subscribe before period end:** `cancel_at_period_end` flips back to `false` on the next
  `subscription.updated` — fully reversible, no data event.
- **Consumer IAP cancel:** routed to OS settings (Apple/Google policy); the RevenueCat webhook writes
  the same `canceled` status to the personal **org-of-one** (doc 06 §3.7) — *no athlete-keyed
  subscription anywhere*, so the consumer and B2B paths share one resolution.
- **Refund/chargeback:** a `billing_events` row records it; `status` follows the provider; no
  athlete-data consequence ever.

**Scalability.** O(1) per cancel (one row update + one recompute). `recompute_active_seats` only ever
*lowers* `active_count`, freeing capacity automatically — seat recovery is emergent (doc 06 §3.4),
never a manual reclaim. Idempotent on `provider_event_id` so Stripe re-deliveries are no-ops. Tens of
thousands of orgs cancel/renew on independent provider clocks with zero cross-org contention because
each touches exactly one org-scoped row.

> **[DON'T BUILD YET]:** in-app cancel UI, retention-offer flows, credit-note/proration-on-cancel
> engine. The hosted Billing Portal satisfies compliance and the wedge.

---

### Scenario 19 — Mid-season program purchase

An org on Preview (or a coach with a code) decides **mid-season** to buy a paid plan — and crucially,
the athletes have *already been logging for weeks*. What unlocks, what's prorated, and **does the new
plan retroactively see the history?**

**Ideal UX.** The admin taps **Upgrade** on a gated feature (the Copilot, team analytics) or in
Billing & plan → **Stripe Checkout** opens (hosted; doc 06 §3.7). On completion the app **lights up
the unlocked features instantly** (next `resolveEntitlement`) — no reinstall, no data re-entry. The
weeks of athlete logging that already happened are **immediately visible** under the new premium
surfaces ("here's your team's last-3-weeks compliance" populates from existing history). Stripe
handles proration of the partial first period; the admin sees the prorated amount in Checkout, not a
surprise.

**Backend architecture.** A plan *acquisition/upgrade* is a webhook-written transition on the same
org `subscriptions` row, plus a license issue:

```
admin → create_checkout_session(org_id, plan_code, price_id) → Stripe Checkout URL
Stripe checkout.session.completed / customer.subscription.created
  → POST /webhooks/stripe (service_role)
  → idempotent billing_events insert
  → upsert subscriptions(organization_id, plan_code, price_id, status='active'/'trialing', provider='stripe', current_period_end)
  → issue licenses(seat_model, seat_limit from plan) → recompute_active_seats(org)
```

`resolveEntitlement` now resolves the org → active plan → `features` bundle → members **inherit**
premium (doc 06 §3.6 step 2: athletes attached to an active org never pay separately). **Proration is
Stripe's job** (the partial-period credit/charge is computed by the provider on the price's billing
anchor) — OnStandard stores only the resulting `current_period_end` and `price_id`. **[DON'T BUILD
YET]** a local proration engine; the rail owns it (doc 06 §2).

**Retroactive history visibility (the gap closed here):** because **athlete data is never gated by
billing** — only *premium feature surfaces* are — the history was *always there*; the purchase just
unlocks the *premium lens* over it. The new Copilot/analytics read the **existing immutable `days`/
score history** (doc 03's frozen tuple) and the **existing `accountability_events`** (doc 04). There
is **no backfill, no migration** — the data predates the purchase and is read through `allowed()`
exactly as before; only `hasFeature` flipped. This is a direct consequence of doc 06 §7.6 (a paid seat
never *implied* access; conversely, the absence of a paid seat never *withheld* the data, only the
premium feature). *(GAP → doc 06: confirm a newly-purchased plan sees history from **before** purchase
with no extra consent step beyond the standing per-org consent the athlete already granted on join.
Recommend: yes — the org already had `report.view` access; the purchase unlocks features, not access.)*

**Permissions.** `billing.own` to purchase (the Checkout RPC asserts it). Feature unlock is **per-org
inherited** (doc 06 §3.6) — no per-athlete grant. Seat accounting at purchase: if the org already has
N active athletes logging and buys a plan whose `seat_limit < N`, `commit`/`recompute` applies the
`overage_policy` (doc 06 §3.5) — recommend `soft_warn` at launch so a mid-season buyer isn't
hard-blocked from their existing roster.

**Data ownership.** Untouched. Purchase is an **access-half event** that *adds* an entitlement; the
profile half (the weeks of logged meals) is the same data, now viewed through a premium lens. The
org **buys access to a richer view of data the athletes own**, never the data itself.

**AI behavior.** The Copilot (doc 05 §6) becomes available the moment `hasFeature(viewer,'copilot')`
flips true; it immediately operates over the **already-existing** signals — "summarize the last 3
weeks" works on day one because the engines (`weeklyReport.ts`, `attention.ts`) were always computing
deterministically; the LLM narration layer simply turns on (doc 05 §3). The AI **never** withholds or
hallucinates pre-purchase history; it reads the immutable record. Meal analysis confidence and Memory
were always accruing (athlete-owned), so the AI is *already warmed up* at purchase.

**Edge cases.**
- **Mid-cycle upgrade Starter→Growth** (athletes crossed `max_active`): Stripe proration handles the
  price delta; `licenses.seat_limit` updates via the webhook; `recompute_active_seats` clears the
  overage flag.
- **Trial → paid:** `status: trialing → active` on the provider's clock; entitlement already active
  during trial (doc 06 §3.6), so the unlock is seamless and the *trial terms were disclosed* (doc 06
  OD#7 / compliance).
- **Purchase then immediate cancel (buyer's remorse):** §18 path; reversible; no data event.
- **Consumer mid-season IAP buy:** RevenueCat webhook → personal org-of-one (doc 06 §3.7); same
  resolution.
- **Coach buys, but some athletes are unverified minors:** the purchase succeeds and the seat is
  *provisioned*, but the minor's real data **still doesn't render** until guardian `verified`
  (consent gate, doc 02 §3.4) — billing never overrides consent (doc 06 §7.6). The org pays for a
  *placeholder seat* only if the minor is `active` (has synced), and an unverified minor never syncs,
  so they don't even consume a seat (doc 06 §3.4 — invited-but-never-synced = free).

**Scalability.** O(1) per purchase (one subscription upsert + one license issue + one recompute). No
data backfill ever (history is read in place). Independent per-org provider clocks; idempotent
webhooks. The "retroactive view" is free because it's a *read* over existing immutable history, not a
write.

> **[ALREADY BUILT]-adjacent:** the inert seam + `previewEntitlement` default mean the app is
> *already* byte-identical pre-purchase; this scenario is the doc-06 EVOLVE turning on.

---

### Scenario 20 — Coach approval workflows

A coach changes an athlete's protein target; or a parent must approve a minor's plan change; or an
assistant coach's roster edit needs head-coach sign-off; or an athlete requests to leave a program.
**No doc owns a generic approval primitive — this scenario defines it.**

**Ideal UX.** The requester takes an action that *requires sign-off* and sees **"Sent for approval"**
(not "Done") — honest, no fake completion (Rule #8). The approver gets a structured, one-tap card:
*"<Assistant Coach> wants to set <Athlete>'s protein target to 180g (was 160g). Approve · Decline ·
Suggest change."* with the **before/after diff** visible. On approval the change applies and both
parties see it in the audit history ("who changed my macros and when?" — doc 02 §3.5 transparency
right). Most actions need **no** approval (a head coach editing a target just does it); approval is the
*exception* configured per-org, surfaced only when a permission requires it.

**Backend architecture.** A generic **`approvals` request→decision ledger**, layered on doc-02
permissions and doc-04's event pattern. This is the [NEW] primitive (no existing doc owns it):

```sql
create table approvals (                       -- request → single decision; append-only after decided
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  requester_id    uuid not null references profiles(id),
  subject_athlete uuid references profiles(id),      -- whom it affects (if any)
  action_key      text not null,                     -- the doc-02 permission this gates: 'goals.edit'|'nutrition.edit'|'athlete.archive'|'member.remove'|...
  payload         jsonb not null,                    -- the proposed change (the would-be RPC args)
  before          jsonb,                             -- current value (for the diff)
  required_role   text,                              -- who must decide: 'head_coach'|'guardian'|'org_owner'|...
  status          text not null default 'pending'
                    check (status in ('pending','approved','declined','withdrawn','expired')),
  decided_by      uuid references profiles(id),
  decided_at      timestamptz,
  reason          text,                              -- approver note (dispute trail)
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index appr_pending on approvals(required_role, status) where status = 'pending';
create index appr_subject on approvals(subject_athlete, created_at desc);
```

The flow reuses the existing RPC-gateway pattern:

```
1. requester calls the action RPC (e.g. coach_set_goals) WITHOUT the full permission
   → the RPC checks has_permission(requester, org, 'goals.edit'):
        - granted        → apply immediately + activity_log row (today's path, unchanged)
        - requires_approval (per-org override flag) → insert approvals(status='pending') instead;
          return "pending approval", do NOT mutate
2. approver calls decide_approval(approval_id, 'approved'|'declined', reason)
   → asserts approver has the required_role/permission in the org
   → on 'approved': executes the original action atomically (calls the same SECURITY DEFINER
     mutation with the payload) + writes activity_log + emits an accountability_event
   → on 'declined': status='declined'; nothing mutates; requester notified
```

`decide_approval` is the **only** thing that applies a pending change, and it **writes the
`activity_log` in the same transaction** (doc 02 §3.5) — so the audit always shows *who requested* and
*who approved*. An approved change becomes a normal versioned plan write (doc 03's `plan_versions`), so
the score history still freezes the version that the *approved* value produced.

**Whether an action needs approval is configurable, not hardcoded.** It's a per-org policy: an
`org_permission_overrides`-style flag (`requires_approval` on a (role, action_key) pair). A solo coach
or single-team wedge org has **zero** approval requirements — every sanctioned write applies directly
(today's behavior, unchanged). Approval routing turns on only when an org configures it (a department
with assistant coaches; a minor whose guardian must co-sign). *(GAP → doc 02: the
`requires_approval` flag is a natural extension of `org_permission_overrides`; recommend doc 02 own a
3-state cell `{deny, allow, allow_with_approval}` rather than a separate table.)*

**Permissions.** The **requester** needs the base reach (`sees_athlete` + a *propose* right); the
**approver** needs the full `action_key` permission (doc 02 §3.2). Self-deciding is forbidden
(`decided_by ≠ requester_id`). For a **minor's plan change**, `required_role='guardian'` and
`decide_approval` asserts an active `guardianship`/guardian membership — folding the COPPA co-sign
into the same ledger. The consent gate still sits above everything (doc 02 §3.7): an approval to view
a minor's data is *moot* until the guardian is `verified`.

**Data ownership.** Approvals govern **plan/access mutations** (the access half + plan config), never
the athlete's raw logs — `days`/`meals` stay self-write-only (doc 02 §3.4, unchanged). An approval can
gate a coach's *target* change or an *archive*; it can never gate or alter what the athlete logged. The
`before`/`after` make every approved change a reversible delta (doc 02 §3.5 `revert_change`).

**AI behavior.** The Copilot can **draft** the proposed change and its rationale (doc 05 §6 — "draft a
protein-target bump for Jordan with the evidence"), creating a *pending `approvals` row a human must
approve* — never auto-applying (the Authority Boundary, doc 05 §3/§8: the AI suggests, the human
decides, and the safety floor can refuse even an approved value, doc 05 §8.2). An AI-originated
proposal is recorded in `ai_recommendations` (doc 05 §8.2) *and* flows through `approvals`, so the
audit shows "AI suggested → coach requested → head coach approved." The AI **never** sits in the
`approver` seat.

**Edge cases.**
- **Approver declines / suggests change:** status `declined`; the requester can resubmit with the
  approver's note — a lightweight negotiation without a multi-stage workflow engine.
- **Stale approval:** `expires_at` → `expired` (a target proposed 3 weeks ago shouldn't silently apply
  now); the would-be change is re-validated against current plan state on `decide_approval` (the plan
  may have moved — apply against the *current* version, append a new version).
- **Race (two assistants propose conflicting targets):** both are pending rows; the approver sees both;
  approving one doesn't auto-decline the other (the approver acts explicitly) — but applying one
  appends a plan version, so the second approval applies *on top* (last approved wins, fully audited).
- **Requester withdraws:** `withdrawn`; no mutation.
- **Org with no approval policy:** the `requires_approval` branch never fires; **byte-identical to
  today** — this is the inert-seam discipline (the table exists; it's empty until a policy turns it on).

**Scalability.** One row per request + one per decision; partial index on `(required_role, status)
where pending` makes an approver's queue a cheap lookup. No multi-stage routing graph (**[DON'T BUILD
YET]** — SoD/sequential-approver workflows are doc-02-flagged over-build). Scales to a department with
hundreds of pending sign-offs as a simple indexed inbox.

> **[ALREADY BUILT]:** the audit/sanctioned-write half (`coach_set_goals` + `activity_log`). **[NEW]:**
> the `approvals` request/decision ledger + the `allow_with_approval` permission state.

---

### Scenario 21 — Optional team leaderboards

A coach wants a team leaderboard to drive friendly competition. The Constitution is **skeptical**
(§5/§8 rate Squad/leaderboard ≤4: "can distract from execution"; Rule #2: every feature must move
*execution*). So the architecture must make it **opt-in, consent-respecting, execution-aligned, and
off by default** — and **never** let it dilute the one number.

**Ideal UX.** Off by default. A coach with `group.manage` can **opt a group in** to a leaderboard and
choose the **metric** — and the only metrics offered are **execution metrics** (compliance %, logging
streak, days-on-plan), *not* raw weight or PRs (which would shame and distract, Rule #4 "reward
execution, not perfection"). Each athlete sees a **consent prompt** the first time ("Show your standing
to teammates? You can stay anonymous or opt out"). Athletes who opt out simply **don't appear** (no
"hidden" placeholder that outs them). The board celebrates **the top movers and the most consistent**,
not just the highest absolute score — recognition over ranking (doc 05 §6 `positiveTrends` is the
engine). It is a **Coach-tab sub-surface**, foldable away (Constitution §6: "Squad folds into Coach or
is cut").

**Backend architecture.** Reuse the **existing pure builder** (`src/core/leaderboard.ts` — already
re-ranks live and is tested) but feed it **real, consent-filtered roster rows** instead of demo
constants (Rule #10: demo data never touches a real user — this is the EVOLVE). Add an opt-in config +
per-athlete consent:

```sql
create table leaderboard_settings (
  group_id        uuid primary key references groups(id) on delete cascade,
  enabled         bool not null default false,        -- OFF by default
  metric          text not null default 'compliance'  -- 'compliance'|'streak'|'days_on_plan'|'score' (execution metrics only)
                    check (metric in ('compliance','streak','days_on_plan','score')),
  anonymity       text not null default 'opt_in'      -- 'opt_in'|'names'|'anonymous' (display mode)
                    check (anonymity in ('opt_in','names','anonymous')),
  configured_by   uuid references profiles(id),
  updated_at      timestamptz not null default now()
);
create table leaderboard_optouts (                    -- athlete-owned visibility control
  group_id   uuid not null references groups(id) on delete cascade,
  athlete_id uuid not null references profiles(id) on delete cascade,
  opted_out  bool not null default false,
  primary key (group_id, athlete_id)
);
```

The board is a **read-side projection**: the server selects the group's athletes the viewer
`allowed(... 'report.view')` *and* who haven't opted out, computes each athlete's chosen metric from
the **existing immutable history** (doc 03 score / doc 04 compliance), and feeds rows into
`buildLeaderboard`. **No new score, no leaderboard-specific number** — it reads the platform-owned
Development Score / compliance the same value everywhere (Rule #13). The board is *derived*, never
stored.

**Permissions.** `group.manage` to **enable/configure** a leaderboard (doc 02 §3.2). Each **athlete
owns their inclusion** via `leaderboard_optouts` (athlete-self-write) — an org can enable the board but
**cannot force an athlete onto it** (athletes own their data/visibility, doc 01). Minors: a leaderboard
is a *real-data render*, so a minor only appears if guardian-`verified` (consent gate) **and** opted in
— *(GAP → doc 02: recommend a minor's leaderboard appearance defaults **off** and may need guardian,
not just athlete, opt-in. Founder/legal confirm.)*

**Data ownership.** The board **reads** athlete-owned scores; it **stores** only the group config +
opt-out flags (org/athlete-owned access settings, not athlete data). No athlete's score is copied into
a leaderboard table — the projection reads the one source of truth, so the board can never drift from
the real number (the same anti-drift discipline as `coachRosterKpis`, `leaderboard.ts`).

**AI behavior.** The AI's role is **recognition, not ranking pressure** (doc 05 §6 `positive_trends`):
it narrates "biggest improvement this week" and celebrates consistency — never shames the bottom of the
board (Rule #4, and the personality safety clamp doc 05 §7 forbids body-image/shaming even on
`tough_love`). The AI may *draft* a celebratory team message (a `copilot_artifact`, drafts-only, doc 05
§6.2). It never auto-posts a ranking.

**Edge cases.**
- **Everyone opts out:** the board renders empty / hides itself (no shaming, no "0 participants" call-
  out).
- **Tiny group (2 athletes):** ranking is meaningless/identifying; recommend a minimum participant
  threshold before a board shows (avoids a 1-on-1 "you're last" — Rule #4).
- **Athlete opts out mid-season:** they vanish from the board immediately (read-side filter); their
  history is untouched.
- **Cross-org athlete (multi-workspace):** a leaderboard is **group-scoped within one org** (doc 07
  `ActiveWorkspace` selects the org); an athlete's standing in their *school* board is independent of
  their *private-trainer* context — they never see one org's roster while acting in another.
- **Gaming:** because the metric is the platform-owned compliance/score (un-reweightable, Rule #13), a
  coach can't flatter their board, and an athlete can't inflate (it's execution of *their* plan).

**Scalability.** A pure read-side projection over already-indexed score/compliance history; one config
row + sparse opt-out rows per group. No leaderboard write path, no fan-out. Computed on read, cached
per group. Scales trivially (it's the existing `buildLeaderboard` over real rows).

> **[DON'T BUILD YET]:** team leaderboards as a *shipped, default-on* surface. Ship the **opt-in seam**
> (config + opt-out tables, the real-roster EVOLVE of `leaderboard.ts`) but populate/enable only after
> the loop retains — the Constitution explicitly warns this can distract from execution (§8). The wedge
> keeps it folded away or cut.

---

### Scenario 22 — Workspace switching for multi-organization staff

A nutritionist serves 6 schools; an assistant coach works a school team *and* runs a private practice;
a strength coach covers two programs in one department. They must switch between organizations cleanly,
with each workspace's roster, branding, permissions, and **entitlement** correctly scoped.

**Ideal UX.** A **workspace switcher** in the top bar (visible only when `available.length > 1`, doc 07
§6.3) shows each org with its **logo/accent** (doc 07 §4). Tapping switches the *entire app* — roster,
reports, branding, and which athletes are visible — to that org. A single-org user sees **no switcher**
(byte-identical to today). The active org is sticky (persisted last-active). Switching feels like
changing rooms, not re-logging-in.

**Backend architecture.** This **is** doc 07 §6 — `ActiveWorkspace` is the app-wide context naming the
one `org_membership` in force; this scenario validates the *staff* edges. `available[]` is derived from
the user's active `org_memberships` (doc 01); `active` is one of them. The critical mechanism (doc 07
§6.2): the active workspace **narrows, never widens** — RLS (`org_memberships`/`allowed(...)`) is the
authority; the active org is passed as **`acting_org`** to every scoped query/RPC and *re-validated
server-side*. An invalid `acting_org` is **denied, never default-allowed** (fail-closed).

```ts
// reuses src/core/workspace.ts (doc 07) — no new primitive
resolveActive(available, lastActiveId)  // pick the in-force membership
switchTo(state, organizationId)         // change the selector; re-resolve branding + entitlement
```

**Entitlement is per-org** (doc 06 keys subs to `organization_id`): the same staff member is **Pro in
School A** (which pays) and **Preview in School B** (which doesn't) — `resolveEntitlement(viewer)`
resolves *through the active workspace's org* (doc 06 §3.6). So switching workspace can change *which
premium features are lit* — the Copilot works in the paying org, falls back to deterministic-only in
the Preview org. This is the clean payoff of org-keyed billing (doc 06 §7.2).

**Permissions.** Each membership carries its **own role + scope + permissions** (doc 01 §3.3). A
nutritionist is `nutritionist` (group-scoped to Weight-Gain) in School A and `org_owner` of their
private practice — **different permissions per workspace**, resolved from the active membership, *never*
a global role (doc 07 §6: "no surface reads the user's role globally anymore"). Group scope follows the
active org (doc 02 §3.3): in School A they see only their scoped group; switching to their practice they
see their full client book.

**Data ownership.** Switching workspace **never touches athlete data** — it's a pure *selector* over
access grants (doc 01 access half). A staff member viewing an athlete in School A and that same athlete
in their practice are **two memberships over the same one profile** (if the athlete happens to be in
both) — but the staff sees the athlete **only through the active org's lens** (doc 01 §3.6 per-viewer
projection): School A's targets/metrics in School A, the practice's plan in the practice. One data set,
N lenses.

**AI behavior.** The Copilot is **scoped to the active workspace's groups** (doc 05 §6 — RLS-scoped to
what the coach can see *in the current org*). Switching orgs re-scopes the Copilot's roster context; it
can never narrate an athlete from a *different* org than the active one (the `ContextPack` is built only
from `allowed()` rows under `acting_org`). The **AI Personality** also re-resolves per org (doc 05 §7 —
School A's `performance_driven` vs. the practice's `supportive`), so the coaching tone follows the
workspace. Memory remains athlete-owned and is read only for athletes the active workspace authorizes.

**Edge cases.**
- **Same athlete in two of the staff's orgs:** seen twice, projected differently; the staff's edits in
  org A write org-A plan config, never org-B's (author_scope on the plan, doc 03 §3.1).
- **Mid-action switch:** an in-flight draft/compose is workspace-tagged; switching prompts to save or
  discard rather than silently leaking a draft across orgs.
- **Stale `acting_org` (membership revoked while active):** the server re-check denies; the client
  drops to a valid workspace or solo context (fail-closed).
- **Solo + one org:** `available.length === 1`, no switcher; **today's experience unchanged** (the
  inert-seam discipline, doc 07 §6.3).
- **Athlete (not staff) in multiple orgs:** the switcher changes *which org's targets/branding/reports
  they view*, but their **one** `days`/`meals` stream and personal Game Plan follow the **primary**
  workspace (doc 07 §6.1 / doc 01 §3.7 — the athlete owns the primary designation; this scenario
  reaffirms that decision).

**Scalability.** O(memberships) to build `available[]` (a handful even for a busy pro); switching is a
client state change + a re-resolved entitlement/branding fetch. RLS already scopes every query by
`org_memberships`, so no extra server work — the active org is just *which permitted membership the
request asserts*. A nutritionist with 40 schools is 40 cheap membership rows and a long switcher list,
not 40x the query cost.

> **[ALREADY BUILT]-as-seam:** `ActiveWorkspace`/`workspace.ts` ship inert for the single-role world
> (doc 07 §6.3) and *activate* the moment a second membership exists. **[DON'T BUILD YET]:** the deep
> multi-org tree is deferred until a real multi-org staff member exists.

---

### Scenario 23 — Athlete graduation

A high-school senior graduates. The school loses live access; **the athlete keeps their entire
profile, score history, Performance Profile, and AI Memory** — and can carry it to a college org or use
it solo. *"Graduation never resets progress"* is the literal moat (Constitution §11.3 — a college
inherits the HS record).

**Ideal UX.** Around graduation the athlete (or the school admin) marks the membership **graduated**.
The athlete sees a celebratory, *not* punitive, moment: *"You're carrying 3 years of progress with you.
Your Development Score history, habits, and plan come with you."* The school's roster shows the athlete
as **graduated** (archived from active views, not deleted). If the athlete joins a college org, the
college coach — once the athlete re-grants consent — sees the **full history from day one**. If the
athlete goes solo, the app keeps working with their own data.

**Backend architecture.** This **is** doc 01 §3.9 — a **status transition on the access half only**:

```
graduate_membership(membership_id)  -- SECURITY DEFINER, doc 01
  → org_memberships.status: 'active' → 'graduated'
  → append membership_events(kind='graduated', actor_id, occurred_at)   -- immutable ledger
  → recompute_active_seats(org)   -- the seat frees automatically (doc 06 §3.4)
```

The athlete's **profile half is untouched** (doc 01 §3.1): `profiles`, `athlete_profiles`, `days`,
`meals`, `checkins`, `performance_profiles`, `athlete_memory_facts`, frozen score history — *byte-
identical* before and after. The org's `can_view` over the athlete ends (the membership is no longer
`active`, so the doc-01 §3.4 predicate excludes it), but the data persists under the athlete's account.
Joining a college is a **new `active` membership** in the college org (doc 01 §3.9 transfer/join) — the
history "carries over automatically because it was never attached to the org."

**A graduation snapshot (the one [NEW] read-side affordance):** to make portability *tangible*, the
athlete can export a **derived snapshot** of their record (score-history trend, Performance Profile
summary, baselines) — a read-side projection over the immutable history (doc 05 §4.1 — *derive, don't
duplicate*), reusing `dataExport.ts`. This is a **proof of portability**, not a new store; it's the
athlete's data leaving *with* them.

**Permissions.** Either the **athlete** (it's their lifecycle) or a school admin with the right (a
roster-management permission) can mark graduation; the athlete can always *leave* an org (athletes own
their data). The school **cannot delete** the athlete's history — only `graduate`/`archive` (lose
access), per doc 02 §3.6 ("org-initiated removal is always access-only; only the data owner destroys
data"). The college's access requires a **new membership + re-granted consent** (doc 01 §3.9; a fresh
per-org consent, COPPA-safe if still a minor → now likely 18, simpler).

**Data ownership.** This is the **purest expression of the invariant.** The school *never owned* the
athlete's data — it held *access*. Graduation ends access; ownership was always the athlete's. The
Performance Profile and Memory (doc 05 §4.2/§5) are **keyed to the athlete, not the org**, so they
follow the person. *What does NOT transfer:* an org's **private coach feedback** about the athlete
(doc 05 §4.2 — `feedback_log` carries `author_id`/`scope`; the college sees feedback authored under a
relationship it holds, not the HS coach's private notes). *(GAP → doc 05 OD#3: confirm athlete-
acknowledged feedback is portable; raw private HS-coach notes are not.)*

**AI behavior.** The athlete's **AI Memory and Performance Profile travel with them** — the college
coach's AI is *immediately warmed up* on the athlete's allergies, habits, favorite foods, and behavior
patterns (doc 05 §5), because Memory is athlete-owned and portable (the behavioral-data flywheel, the
moat, doc 05 §5.1). The HS org's AI Copilot **loses the athlete** the instant the membership is
`graduated` (it can only narrate `allowed()` rows). The AI **never** retains a graduated athlete in a
prior org's context. Safety facts (allergies) follow the athlete and stay hard constraints in the new
org (doc 05 §5.1).

**Edge cases.**
- **Graduate then go solo:** no new org; the athlete uses the app on their own data (the consumer
  path; entitlement falls to Preview or a personal IAP sub, doc 06 §3.7).
- **Graduate then join college mid-cycle:** a new membership + consent re-prompt (doc 01 §3.9); the
  college's mid-season purchase (§19 here) lights up premium over the inherited history.
- **Re-grant consent declined at the college:** the college coach sees the *membership* but **no real
  data** until consent (fail-closed gate) — a graduated athlete controls who sees their carried
  history.
- **Accidental graduation:** reversible — the membership row persists; a `reactivated` event restores
  access (doc 01 §3.9; never duplicate an athlete).
- **Retention at the HS:** the *org* loses access; if no other org/athlete holds the data live, the
  athlete's own account retains it indefinitely (deletion is the athlete's right alone, doc 02 §3.6 /
  `delete_account`).

**Scalability.** O(1) per graduation (one status flip + one ledger row + one recompute); a whole
senior class graduating is N independent transitions, each freeing a seat automatically (doc 06 §3.4).
No data movement at *any* scale — the entire point is that history doesn't move. A college inheriting a
recruit is *zero* migration: a new membership over an existing profile.

> **[ALREADY BUILT]:** the lifecycle + ledger (doc 01 §3.9), Performance Profile/Memory portability
> (doc 05). **[NEW]:** the derived graduation snapshot (a `dataExport.ts` projection). **[DON'T BUILD
> YET]:** automated HS→college transfer matching is the doc-07 bulk-import dedupe path, deferred.

---

### Scenario 24 — Organization branding

A premium school/department/private practice wants the app to feel like *theirs* — their logo, colors,
welcome message. The Constitution constrains this hard: branding may theme **chrome and copy only** and
**must never** restyle the Development Score or alter any number's meaning (Rule #13).

**Ideal UX.** A premium org admin sets a **logo, an accent color, and welcome/announcement/AI-greeting
copy** in a simple settings form (doc 07 §4). Members of that org see the app **accented in the org's
color**, the org's **logo** in the header, a branded **welcome** on first claim, and a coach-voice
greeting prefixed with the org's identity ("Coach K's program"). The **Development Score ring, grade
bands, and every number look identical to every other org** — a premium org gets *their colors around*
the number, never *their version of* it. A solo user or non-premium org sees the default Athlete-Blue,
**byte-identical to today**.

**Backend architecture.** This **is** doc 07 §4 — `org_branding` config hanging off `organizations`,
delivered as part of resolving `ActiveWorkspace` (doc 07 §6). The existing `ThemeProvider`/`useColors`
(`src/ui/theme.tsx`) gains a **third palette input layered on top** of light/dark: the active
workspace's `accent_color` overrides the `accent`/`brand` tokens **only** — every structural and
**semantic** token (surfaces, text, and critically the **score-band colors**) is untouched.

```
effective palette = basePalette(scheme) ⊕ activeWorkspace.branding.accent   // accent token ONLY
```

`accent_color` contrast is **validated at write time** with `src/core/contrast.ts` so branding can
never produce an unreadable UI. Logo lives in an org-scoped, public-read `org-assets` bucket (a logo is
not PHI). Switching workspace (§22) re-resolves the accent so the *whole app re-skins* with no
per-screen wiring.

**Permissions.** `branding.edit` (doc 02 — default Org Owner / AD / Personal Trainer) via an RPC that
writes an `activity_log` row (doc 02 §3.5). Branding is **entitlement-gated** — premium orgs only
(`hasFeature(viewer,'custom_branding')`, doc 06 §3.2). Members **read** branding (org-public to
members); only the admin **writes** it.

**Data ownership.** Branding is **org-owned config**, the cleanest case of the access half — it's
*about the org*, contains no athlete data, and is correctly org-keyed. Identity moves to the org
(`organizations.name` + `org_branding.org_display_name` supersede `profiles.org_name`, doc 07 §3/§4).
On cancellation (§18) the org keeps its branding config but **non-premium → falls back to default
palette** (branding is an entitlement-gated *read*, doc 07 §4.1).

**AI behavior.** The `ai_greeting` is a **prefix**, never a rewrite (doc 07 §4.1 / Rule #8): it may
prepend the org's identity to the coach voice but **must not** touch scoring or safety copy, and never
restyles a number. The AI Personality (doc 05 §7) is the *tone*; branding is the *chrome* — orthogonal.
Neither can alter what the deterministic engine decided.

**Edge cases.**
- **Unreadable accent:** rejected at write time by `contrast.ts` — branding can never break legibility.
- **Branding the score:** structurally impossible — semantic/score-band tokens are *not* in the
  override set; the override touches `accent` only. A premium org *cannot* recolor the ring even if it
  wanted to (Rule #13 enforced by token scoping, not by policy alone).
- **Multi-org member:** each workspace carries its own branding; switching re-skins (§22). A solo
  context = default palette.
- **Non-premium org sets branding then lapses:** config persists but renders default until re-
  subscribe (entitlement-gated read).
- **Minor/consent:** branding is chrome, not data; the consent gate is unaffected.

**Scalability.** One config row per org + one logo asset; resolved once per workspace activation,
cached. No per-athlete or per-screen cost. Scales to thousands of branded orgs trivially (it's a
palette token + an image URL).

> **[DON'T BUILD YET]:** custom fonts, per-screen layouts, native white-label app builds (doc 07 §2 —
> enterprise v3). The wedge ships **logo + accent + welcome/announcement/AI-greeting only**, and
> branding **never** restyles the Development Score. Branding is rated ≤4 on the pillar matrix
> (Constitution §5) — ship the seam, populate when a premium org pays.

---

### Scenario 25 — AI memory and long-term performance profiles

Over months and years, OnStandard builds a rich, personal understanding of an athlete — goals,
allergies, favorite foods, habits, behavior patterns, coach feedback, Development Score history — that
makes recommendations smarter every month and **follows the athlete across orgs**. This is the
behavioral-data flywheel and the Proof moat (Constitution §11.1/§11.3).

**Ideal UX.** The athlete's experience gets **quietly more personal over time**: the meal analyzer
pre-adjusts to "you always bump the rice portion"; the Game Plan knows "you skip breakfast on game
days"; the Decision Engine remembers your Chipotle order and your budget band; a stated allergy is
**never** violated. A coach (with permission) sees a **Performance Profile** — strengths, weaknesses,
consistency, habits, score history — that's *already populated* when an athlete transfers in. The
athlete owns a **transparent, editable** memory ("here's what OnStandard remembers about you — fix
anything"). Nothing feels surveilled; everything feels *understood* (Constitution §11b "this app
understands me").

**Backend architecture.** This **is** doc 05 §4–5 — two athlete-owned assets this scenario validates at
the *longevity* edge:

- **Performance Profile** (`performance_profiles`, doc 05 §4): a **projection + curation**, not a
  duplicate store. Most of it (score/weight/consistency/timing) is *derived* from the immutable history
  (doc 03); only the slow-moving curated record (`summary`, confirmed `habits`/`preferences`,
  `feedback_log`, immutable `baselines`) is stored. `buildProfileView()` (pure, doc 05 §4.1) composes
  the runtime view — so the profile **can never disagree** with the Development Score history.
- **AI Memory** (`athlete_memory_facts`, doc 05 §5): **structured, typed facts FIRST, embeddings
  LATER** (the single most important deferral, doc 05 §5.1). Append-with-supersede; safety facts
  (allergies) are **hard constraints** the deterministic recommender honors, never fuzzy vectors.
  "Smarter every month" is **growth in the data, not the model**: inferred facts accrue `evidence_n` +
  `last_seen` and `promoteFact()` raises confidence with repetition (doc 05 §5.1).

The **Authority Boundary** (doc 05 §3) governs all of it: the LLM **retrieves and phrases** over an
authorized, consent-filtered `ContextPack` (Profile + retrieved Memory facts + signals); it **never
writes the store** — it can only *propose* candidate facts (`memory_extract` task) that the
deterministic pipeline validates, dedupes, and (for safety kinds) routes to the athlete to confirm
(doc 05 §5.2).

**Permissions.** Memory + Profile are **athlete-owned data** under the same `allowed()` predicate +
consent gate as everything else (doc 05 §4.3/§5.4). **Tiered visibility:** allergies/dislikes/meal-
timing/budget-band are coach-visible (they inform coaching); `motivation_style`, travel, raw spend, and
personal restaurant history default **athlete-only**, athlete-overridable (doc 05 §5.4 — GAP doc 05
OD#2, founder confirm the per-kind `coach_visible` matrix). The athlete has full control: edit, reject
a fact, or `delete_account` purges everything (right to forget). A coach **reads** a permitted subset;
only the **athlete** (or a coach-stated fact the athlete confirms) writes.

**Data ownership.** The defining property: **Memory and Profile are keyed to the athlete
(`profiles.id`), never to an org** (doc 05 §4.2). When an athlete changes orgs (§23 graduation, §22
multi-org), the **record follows the person**; the new org gains *access* via `allowed()`, never
*ownership*. This is the moat made concrete — a college inherits the HS athlete's warmed-up profile.
Leaving an org revokes *access*, never deletes the profile; deletion is the athlete's right alone.

**AI behavior.** Memory is *the* thing that makes the AI personal over time, but it stays **bounded by
the Authority Boundary** (doc 05 §3/§8):
- Retrieval is **deterministic** (`retrieveForTask()` — kind + recency + confidence ranking; the "RAG"
  without a vector DB, doc 05 §5.3) — the model sees a small, relevant, authorized fact set, never the
  whole store, never raw PHI/photos in the prompt.
- **Safety facts outrank everyone** (doc 05 §8.2) — a stated allergy refuses a recommendation even a
  coach set; a safety fact is **never auto-superseded by inference**, only by the athlete/guardian.
- The AI **explains and refines**, never invents the scoring or safety numbers (Constitution §11b /
  Rule #13); for minors and weight-loss clients the deterministic bounds are hard.
- The flywheel (corrections → candidate facts → pre-adjusted next analysis, doc 05 §9.3) lives in
  **deterministic core**, so it works *before any model is wired* — Memory accrues honestly today.

**Edge cases.**
- **Stale/wrong fact:** correction = **supersede, never edit** (doc 05 §5.1) — full provenance survives
  ("OnStandard thought you liked X; you corrected it on <date>").
- **Conflicting facts across time** (was vegetarian, now isn't): the `supersedes_id` chain keeps the
  active fact current; history is auditable.
- **Inferred fact wrong** (one-off cheat meal → "loves donuts"): low `evidence_n` keeps it below the
  surfacing threshold until repetition; the athlete can reject it.
- **Minor:** no memory leaves the device or reaches the model until guardian `verified` (consent
  supremacy, doc 05 §5.4) — Memory is "real data."
- **Cross-org privacy:** a coach in org A sees only the coach-visible memory kinds for athletes they're
  `allowed()` to see *in org A*; org B's private coach feedback doesn't leak (doc 05 §4.2).
- **Scale of free-text memory:** when typed/keyword retrieval becomes insufficient, embeddings are
  added behind the *unchanged* `retrieveForTask` interface (doc 05 §5.3) — **[DON'T BUILD YET]** until
  post-proof; safety facts stay typed forever.

**Scalability.** Profile is read-mostly + derived (no growing duplicate of history). Memory is
append-with-supersede with `status='active'` partial indexes; retrieval is a bounded, deterministic
top-K over a per-athlete fact set (small even after years — facts are curated, not raw logs). The
embeddings accelerator is deferred precisely so the wedge never carries vector-DB cost before it's
justified (doc 05 §9/§12). Per-athlete isolation means memory scales linearly with athletes, with no
cross-athlete contention. The behavioral flywheel compounds value without compounding cost (the
moat economics, Constitution §11.1).

> **[ALREADY BUILT]:** the Performance Profile + Memory models (doc 05 §4–5), the deterministic
> flywheel in `src/core`. **[DON'T BUILD YET]:** the vector/semantic memory DB (the single most
> important deferral — a missed allergy in a vector is a safety incident, doc 05 §5.1) and learned
> behavioral-pattern ML (needs real outcome data, doc 05 §12).

---

## 4. Gaps these scenarios surface (routed to the owning doc)

1. **Billing lapse → data access consequence (18):** doc 06 left it implicit. **Closed here:** lapse
   degrades *features* (entitlement → Preview), never *access* (memberships + consent persist). →
   doc 06 should state this explicitly in §7; confirm the `preview` `plan_entitlements` seed (which
   features survive a lapse).
2. **Retroactive history visibility on purchase (19):** a new plan sees *pre-purchase* history with no
   extra consent (the org already had `report.view`); the purchase unlocks features, not access. →
   doc 06 confirm.
3. **The `approvals` primitive (20):** no doc owned coach/guardian/admin sign-off. **Defined here** as
   a request→decision ledger + an `allow_with_approval` permission state. → doc 02 should adopt the
   3-state permission cell `{deny, allow, allow_with_approval}` as an `org_permission_overrides`
   extension.
4. **Leaderboard opt-in + consent (21):** doc 04 owns the signal; no doc made the visibility call.
   **Defined here** as off-by-default `leaderboard_settings` + athlete-owned `leaderboard_optouts`,
   execution-metrics-only, minor-opt-in defaults off. → doc 02/04 confirm minor guardian-opt-in.
5. **Graduation snapshot (23):** a derived portability export (a `dataExport.ts` projection), not a new
   store. → doc 05/01 confirm it's read-side-derived.
6. **Branding never restyles the score (24):** enforced by **token scoping** (override = `accent` only;
   score-band tokens excluded), not policy alone. → doc 07 confirm the override token set.

---

## 5. Open decisions for the founder

1. **Post-lapse feature set (18/19):** which features are org-premium (gate off on cancel / unlock on
   purchase) vs. always-on? This is the `plan_entitlements` `preview` seed — a packaging call (doc 06
   OD#6).
2. **Pre-purchase history visible to a new plan (19):** confirm a mid-season purchase sees prior
   history with no extra consent step (recommend yes — access predates the purchase).
3. **Approvals adopt the `allow_with_approval` permission state (20):** confirm the 3-state cell in
   `org_permission_overrides` (vs. a separate routing engine — recommend the simple cell;
   multi-stage SoD is **[DON'T BUILD YET]**).
4. **Leaderboard policy (21):** off by default, **execution metrics only** (no raw weight/PR), athletes
   opt in (minors guardian-opt-in, default off), minimum participant threshold. Confirm — and confirm
   it stays folded away / **[DON'T BUILD YET]** as a default-on surface (Constitution §8).
5. **Graduated/private coach feedback portability (23/25):** confirm athlete-acknowledged feedback is
   portable; raw private coach notes are **not** (doc 05 OD#3).
6. **Memory coach-visibility matrix (25):** which fact kinds are coach-visible by default vs.
   athlete-only (doc 05 OD#2). Recommend allergies/timing/budget-band visible; motivation/travel/spend
   athlete-only.
7. **Branding never touches the score (24):** confirm the override token set is `accent`/`brand` only,
   structurally excluding score-band/semantic tokens (Rule #13).
8. **Embeddings stay deferred (25):** confirm the typed-fact store ships and the vector DB is
   **[DON'T BUILD YET]** until free-text volume forces it post-proof (doc 05 OD#1) — safety facts typed
   forever.

---

## 6. Cross-cutting contract (what these scenarios require other docs to honor)

1. **No scenario introduces a new access path.** Every read in 18–25 resolves through `can_view` /
   `allowed(...)` (docs 01/02); every entitlement through `resolveEntitlement`/`hasFeature` keyed on
   `organization_id` (doc 06); every "which org am I in" through `ActiveWorkspace` + `acting_org`
   (doc 07); every AI output through the Authority Boundary + `assist()` (doc 05).
2. **Billing is access-half-only.** Cancellation (18) and purchase (19) are status/plan transitions on
   the org's one `subscriptions` row; they change *entitlement and license capacity*, **never** the
   athlete's profile half. A paid seat never implied data access; losing it never removes it (doc 06
   §7.6).
3. **The profile half is permanent, org-free, and athlete-owned.** Graduation (23), workspace switching
   (22), and memory/profile (25) move *access*, never *data*; the athlete's `days`/`meals`/score
   history / Performance Profile / Memory survive every org change with zero movement (doc 01 §3.1).
4. **History and memory are immutable / append-with-supersede.** Approved plan changes (20) append a
   `plan_version`; memory corrections (25) supersede, never edit; the audit trail (`activity_log`,
   `membership_events`, `approvals`, `billing_events`) is append-only (docs 02/01/06).
5. **The consent gate sits above everything.** A paid seat (19), a coach approval (20), a leaderboard
   render (21), and a transferred/graduated athlete's carried history (23/25) all obey
   `src/core/consent.ts` unchanged — a minor's real data never renders until a guardian is verified, and
   no payment, permission, or membership overrides it.
6. **The score is platform-owned and identical everywhere.** Leaderboards (21) read the one Development
   Score and may use **execution metrics only**; branding (24) themes chrome and **never** restyles the
   score (enforced by token scoping); approvals (20) gate the *plan*, never the *formula* (Rule #13).
7. **The AI recommends, never dictates.** It drafts approvals (20), narrates recognition not ranking
   (21), warms up portable memory (23/25), and degrades to deterministic-only when unconfigured or
   unentitled (18) — the coach's plan and the deterministic engine win, and the safety floor outranks
   even the coach (doc 05 §8).
