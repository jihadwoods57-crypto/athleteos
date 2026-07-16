# Coach OS — Design (founder spec, 2026-07-16)

**Status: DRAFT — awaiting founder approval of this write-up.**
**Founder decisions already taken (2026-07-16):** migrations author+apply as we go ·
pragmatic v1 permissions · Nav+Home+Roster ships first · Insights v1 = plain-language
brief + trends.

Source: founder's 2026-07-16 coach-OS spec, grounded against the shipped proto WebView
(`proto/redesign-2026-07`) and the live backend (migrations 0001–0062 applied). This
supersedes two July-14 decisions with the founder's newer direction: **+ becomes a
Create menu** (was: Assign-only) and **Insights becomes a tab** (was: rejected in favor
of Inbox — both now fit because Profile moves off the tab bar).

**The core shift:** the coach side stops being a roster with red cards and becomes a
system that tells the coach *what matters, why it matters, what to do, and whether it
worked.*

---

## What already exists (do not rebuild)

From the July-14 overhaul, all live: requirements engine with team/position/athlete
precedence (`requirement_sets`, `requirements.js:118-126`), Assign composer
(`coach.js:258-351`), Inbox tab + deterministic briefing (`coach.js:778-861`), meal
threads with caps + private notes (`coach.js:1076-1271`), staff invites
head_coach/assistant/nutritionist (`roles.js:225-248`), custom team codes, coach
greeting, activity feed with unseen dots (`coach_views`), trust passes, standards
editor knobs 1–6 meals (`coach.js:672-772`), 527-org directory.

## What does not exist (confirmed 2026-07-16 exploration)

Priority ranking/mark-handled · scope selector · separate Roster tab · roster
search/filters/statuses/bulk actions · custom groups · coach-facing athlete profile
tabs · per-athlete coach notes · Create menu · requirement templates · meal time
windows · excused/absence state · Insights screen · grouped coach notifications ·
permission scoping (a position coach today sees everything).

---

## Design principles

1. **Deterministic honesty.** Priority ranking, statuses, and Insights sentences are
   computed from real data by plain code — never narrated fiction. The AI drafts;
   the coach sends; numbers never change by AI (D3 rails unchanged).
2. **One intervention log powers everything.** "Mark handled", nudges, messages, and
   assignments all write to one `coach_interventions` table — it drives the priority
   queue *and* later answers "did the intervention work?" in Insights.
3. **Scoped by responsibility.** Every coach-facing query and screen respects the
   staff member's scope (whole team vs position room). A position coach never sees
   athletes outside their room.
4. **Dark tokens, blue→teal on score surfaces, plain honest empty states** — existing
   brand rules unchanged.

---

## New navigation (Slice A)

`NAVS.coach` (`router.js:17-23`) becomes:

**Home · Roster · Create(+) · Inbox · Insights**

- Coach profile/settings move to an **avatar chip in the top-right of every coach
  screen header** → `coach-profile` (existing screen, upgraded later). Profile
  leaves the tab bar.
- The + FAB opens the **Create menu** (bottom sheet), not the Assign composer
  directly. Assign lives inside it.
- Route guards updated; trainer/parent navs untouched.

---

## Slice A — Home (daily command center) + Roster

### Home (`coach-home`, rebuilt from today's `coach` screen)

Order, per the founder spec:

1. **Header** — "Good afternoon, Coach Reynolds" + "{team} · {scope} · Today",
   avatar top-right, and a **scope selector** (chip row / sheet): *My room* (default
   for a scoped coach) · *Entire team* · custom groups · individual athletes. Scope
   drives every section below it and persists per coach.
2. **Team Pulse** — group score, change vs yesterday, on-standard count, due-soon
   count, overdue count, completion %. Tappable → a breakdown sheet that explains
   the number from real components (reuses the athlete breakdown-model pattern).
3. **Coach Priorities** — the centerpiece. A ranked queue, not a flat red list.
   - Deterministic ranking in a new `js/priority.js` (pure, testable like
     `notify-plan.js`): urgency score from overdue count × time-since-activity ×
     below-standard severity × due-soon proximity. Tiers: **Critical / Below
     standard / Due soon**.
   - Each card: athlete, reason lines ("Breakfast and lunch overdue · No activity
     since yesterday"), time, meal photo when relevant, score or missing
     requirement, and a **suggested action**.
   - Actions per card: **Open chat · Nudge · Assign · Mark handled.** Every action
     writes a `coach_interventions` row; handled/acted cards leave the active queue
     (reappear only if a *new* reason arises).
4. **Live Activity** — existing horizontal feed (`coach.js:166-196`), scope-filtered,
   every meal card always shows its image (signed-URL fallback hardening).
5. **Coach Follow-ups** — unresolved counts: athlete messages awaiting response,
   assignments due for review, unhandled priority items. Each row deep-links.

**No roster on Home.** Join requests collapse to a single pill-banner → Roster.

### Roster (`coach-roster`, new tab)

- **Search** (name), **sort** (score / status / last activity / name), **filters**:
  position rooms, custom groups, and status.
- **Statuses** (deterministic, computed in `js/status.js` from day + requirements +
  exceptions): `On standard · Due soon · Overdue · Below standard · Excused ·
  No activity · Needs review`. (Needs review = flagged meal or assignment awaiting
  coach review.)
- **Row:** name · position / today's score · status chip · last activity · 7-day
  sparkline (from `days` history).
- **Bulk actions** (multi-select mode): message, nudge, assign, move into group,
  mark absence/exception.
- **Custom groups:** new `coach_groups` table; create/edit from Roster; groups
  appear in the scope selector and Assign composer.
- **Excused:** new `athlete_exceptions` table (athlete, date range, reason).
  Excused athletes drop out of the priority queue and completion denominators for
  those days — no notification fires for an excused requirement.

### Slice A backend (migrations, applied as we go)

- `coach_groups` (team_id, name, athlete_ids or join table, created_by)
- `coach_interventions` (team_id, coach_id, athlete_id, kind
  `nudge|message|assign|handled`, reason_key, priority_tier, created_at, day) —
  RLS: team staff write/read
- `athlete_exceptions` (team_id, athlete_id, starts_on, ends_on, reason, created_by)
- `team_staff.scope_kind/scope_value` (null = whole team; `position` = room string).
  Scope *columns* land here; the `can_view()` RLS enforcement wires in at Slice F with
  the scoped roles — the live `can_view()` carries 0050 minor-consent logic, so that
  surgery ships as its own reviewed change once a scoped role can actually exist.

---

## Slice B — Coach-facing athlete profile

Tapping any athlete (Roster, priorities, activity) opens the rebuilt
`coach-athlete/{id}` with segmented sections:

- **Overview** — score, today's completion, streak, last activity, active alerts,
  7-day trend.
- **Today** — required vs logged meals, weight requirement, assignments, what's
  missing, deadlines (extends today's "what's open", `coach.js:1011-1021`).
- **Activity** — meal photos + AI analysis + scores, check-ins, weight logs, and
  this coach's interventions (from `coach_interventions`).
- **Conversation** — the meal/AI/coach thread history. Coach is automatically in
  every meal thread (already true via RLS); athlete never tags anyone.
- **Requirements** — the resolved set (individual > group > team), exceptions,
  temporary adjustments, assignment history.
- **Notes** — private coach notes: new `coach_notes` table (team_id, athlete_id,
  author, body, created_at), visible to approved staff only (RLS by staff role),
  never to the athlete.

Existing actions stay in the header: message, nudge, assign, targets, trust pass.

---

## Slice C — Create menu + Standards deepening

### Create menu (+)

Bottom sheet, options filtered by permission:

Assign requirement · Send announcement · Message athlete · Message group ·
Create check-in · Adjust schedule (exceptions/travel) · Add athlete (team code /
invite) · Invite staff.

- Announcements: new `announcements` table + push fan-out; appear in athlete
  notification feed and coach Inbox.
- Nutritionist sees meal-plan tools; position coach's audience is capped to their
  room; head coach sees everything.

### Standards (replaces the Plan tab concept)

Standards management lives in Create → "Standards" and via Home/avatar; the editor
(`coachPlanSet`) is extended, not rebuilt:

- **New knobs:** custom meal names, **meal time windows** (drives due-soon/overdue
  and nudge timing), hydration target, photo-required toggle, deadline logic,
  excused-day rules.
- **Templates:** new `requirement_templates` table (team_id, name, items jsonb,
  kind `game_week|off_season|travel|recovery|weight_gain|weight_loss|injured|custom`).
  Seed the seven standard templates on first open; save-as-template from any set;
  apply to team / room / group / athlete.
- **Preview as athlete:** render the athlete Home day-card from a draft set before
  publishing (pure function over the draft — same code path as `setDayStandard`).
- Scoring weights stay engine-owned (D3 rails); coaches set *requirements*, the
  engine converts completion → score.

---

## Slice D — Inbox v2

Categories (segmented control): **Needs response · Athletes · Meal reviews · Staff ·
Announcements · Resolved.**

- Thread previews carry substance: "AI flagged low protein · athlete explained ·
  coach response needed."
- Inside a meal thread: photo, macro breakdown, AI feedback, athlete response, and
  **suggested coach replies** — four stances (Supportive / Direct / Ask for context /
  Set a follow-up requirement), drafted via the existing coach-voice AI path;
  coach edits and sends, AI never auto-sends. Thread caps (2/3/1) unchanged.
- **AI-generated alerts** land as inbox rows (grouped: "3 athletes missed lunch"),
  produced by the same deterministic planner as notifications (below).
- Resolving a thread writes `coach_interventions` (kind `message`/`handled`) so
  Follow-ups and Insights see it.

---

## Slice E — Insights v1 + grouped notifications

### Insights (`coach-insights`, new tab)

Plain-language first, charts second:

- **What changed this week** — deterministic sentences from real deltas: completion
  %, average score, meal/weight compliance, by room. ("Meal completion improved
  12%, but lunch compliance declined in the linebacker room.")
- **Athletes to watch** — decliners (7-day slope), disengaging (activity gaps),
  recoverers (post-intervention improvers).
- **Most-missed requirement**, up/down movers, weekly vs monthly comparison.
- **Intervention outcomes** start honest-thin: `coach_interventions` records from
  day one; the "are nudges working?" panel unlocks when ≥2 weeks of data exist
  (honest empty state until then).
- Backend: 2–3 SQL RPCs aggregating `days`, `meals`, `requirement_assignments`,
  `coach_interventions` server-side (roster-sized client math is fine for pulse;
  history needs SQL).

### Grouped coach notifications

New pure planner `js/coach-notify-plan.js` (sibling of `notify-plan.js`): coalesces
athlete events into grouped alerts ("3 athletes missed lunch requirements"), never
fires for completed or excused requirements, respects quiet hours. Coach preferences
(avatar → notifications): immediate critical · hourly summary · morning briefing ·
evening recap · quiet hours · my-room-only.

---

## Slice F — Coach onboarding rebuild + permissions UI

### Onboarding (extends `coachSteps`, `roles.js:116-235`)

Collects: first/last name → **display name** (existing "what the room calls you") →
school/org (existing directory search) → sport + level → **role + responsibility**
(new step: *Entire organization / Entire team / Side of the ball / Position room /
Individual clients* — this sets `team_staff.scope`) → starting standard (existing,
now template-aware) → notification preferences → custom team code (existing
customize UI, surfaced at creation). "Coach view" as a label is already dead;
verify no regressions.

### Permissions (pragmatic v1)

`team_staff.staff_role` extends to: `head_coach · coordinator · position_coach ·
nutritionist · readonly` (existing `assistant` maps to coordinator). Scope column
from Slice A. Enforcement:

| Role | Sees | Creates/edits |
|---|---|---|
| Head coach | whole team | everything incl. staff, standards, groups |
| Coordinator | their side/scope | assign, message, standards for scope |
| Position coach | their room | assign, message, nudge in room |
| Nutritionist | whole team (nutrition surfaces) | targets, meal plans |
| Read-only | their scope | nothing (view + notes visibility optional) |

RLS enforces reads server-side; the client additionally hides what a role can't do
(Create menu filtering, roster scoping, standards editing). Org admin + academic
advisor: schema leaves room (enum + scope), UI later.

---

## Sequencing

| Slice | Contents | Size | Depends on |
|---|---|---|---|
| A | nav, Home (pulse/priorities/follow-ups), Roster (statuses/filters/bulk/groups), interventions+exceptions+scope schema | 1–2 sprints | — |
| B | athlete profile (6 sections), coach notes | ~1 sprint | A (interventions) |
| C | Create menu, announcements, templates, time windows, preview | ~1 sprint | A |
| D | Inbox categories, suggested replies, alert rows | ~1 sprint | A, C (announcements) |
| E | Insights RPCs + screen, grouped notification planner | ~1 sprint | A (needs intervention/status data flowing) |
| F | onboarding rebuild, permission roles/UI | ~1 sprint | A (scope schema) |

A ships first (founder call). B/C can interleave; D needs C's announcements; E last
so it reports on real accumulated data; F's schema (scope) actually lands in A —
F is the UI/onboarding layer.

## Out of scope

Native `src/` parity · scoring-formula changes (D3 rails are law) · org-admin and
academic-advisor UI · athlete-side redesigns · trainer/parent surfaces (they keep
their current mirrors; trainer gets the nav-guard updates only).
