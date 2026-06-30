# Role Architecture Redesign — AthleteOS

**Date:** 2026-06-30 · **Status:** RATIFIED (founder-directed) · **Supersedes** the 7-role label model
for onboarding/identity. Builds on `docs/founding/ROLE_EXPERIENCE_ARCHITECTURE.md` and the 2026-06-29
Role Review Board.

## The thesis (founder, 2026-06-30)

> One platform, role-specific experiences. Same design language, components, navigation philosophy.
> Only the workflows, permissions, dashboards, AI, and terminology change. Think Apple / Notion / Linear.
> **Role determines** navigation, permissions, dashboard, visibility, workflows, responsibilities.
> **Goal determines** AI coaching, score weighting, targets, game plan, feedback, language, notifications.

This is correct, and the codebase is already half-built for it: `flowForRole()` collapses 7 role labels
into 4 dashboard flows, and `ScoringProfile` already re-weights the one engine by client kind. The redesign
is mostly a **simplification** (delete role labels, promote `goal` to a first-class field), not a rebuild.

## The one refinement that makes it scalable: three axes, not one enum

Modeling this as a single `Role` enum is the SaaS-cliché shape and is why "Gym Owner" reads as a 4th
sibling to "Coach." It is not. The scalable spine is **three orthogonal axes**; every persona is a
coordinate, so a new customer type is a value, never a new product.

| Axis | Question | Values |
|---|---|---|
| **Identity** (role) | What do I *do*? | `execute` · `manage` · `observe` |
| **Org position** | *Where* do I sit? | `solo` · `member` (in a practice/team) · `owner` (runs the org) |
| **Goal** | What am I *optimizing*? | `performance` · `lose_fat` · `build_muscle` · `recomp` · `health` · `maintain` |

Gym Owner is not a role. It is `manage` + `owner`. An Athletic Director is the same cell at a bigger org.
We never write a "Gym Owner role" again; we write an **org-position tier** any Manager can occupy.

## Final role hierarchy (7 labels → 3 active roles + 1 reserved)

| Role | Absorbs | Managed object | Beta? |
|---|---|---|---|
| **General User** | athlete + all consumer client types | their own day | ✅ |
| **Professional** | personal_trainer, nutritionist, all coaches, strength coach | people they manage | ✅ |
| **Observer** | parent | someone else's progress | V2 (needs live link) |
| **Owner** *(reserved)* | gym / facility / academy / AD / org-admin | the business | V2+ |

**Professional keeps two configurations**, set in onboarding, not two products:
- **Coach** — manages a *roster / team* (a group object). Routes to the `coach` flow.
- **Practitioner** (trainer / nutritionist) — manages a *book of individuals* (a client object). `trainer` flow.

The managed object genuinely differs, so the query differs; the design system, nav skeleton, and overlays
are shared. This is exactly today's `coach` vs `trainer` split — keep it.

### Roles → goals (the collapse)
Weight-Loss and Muscle-Gain are **goals, not roles.** The three phantom "client roles" collapse into one
**General User** whose entire experience is goal-personalized. Goal drives: scoring profile, targets, AI
voice, daily game plan, meal feedback, language, notifications.

## Role review (every existing role)

| Existing role | Keep / merge / goal | Decision |
|---|---|---|
| athlete | → **General User** (goal = performance) | merge |
| weight-loss / muscle-gain / general (implicit) | → **goals** on General User | become goals |
| personal_trainer | → **Professional / Practitioner** | merge |
| nutritionist | → **Professional / Practitioner** | merge |
| sports_perf_coach | → **Professional / Coach** | merge |
| hs_coach / college_coach | → **Professional / Coach** (level set in onboarding) | merge |
| strength_coach (proposed) | → **Professional / Coach** (responsibility = performance) | merge |
| parent | → **Observer** | keep, lightweight |
| gym owner / facility / AD / org-admin | → **Owner** (org-position tier) | reserved, unbuilt for beta |

## Onboarding (identity-first, not role-first)

One funnel, branches by axis. Every answer collected must change a screen (the board's #1 sin was
asking position group then ignoring it).

1. **"What brings you here?"** → Execute / Manage / Observe (sets Identity).
2. Branch:
   - **Execute** → goal → sport (optional, never forced on non-performance goals) → who manages you
     (team code, optional) → baseline → **Score Reveal**.
   - **Manage** → Coach or Practitioner → org/practice name → (Coach: sport, level, group, responsibilities)
     / (Practitioner: specialty) → roster/invite.
   - **Observe** → who you follow → consent.
3. Platform self-configures from the answers.

## Navigation — exactly 5 primary destinations (Observer 3, by design)

| Role | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **General User** | Today (briefing) | Nutrition | Progress | Squad | Profile |
| **Coach** | Briefing | Roster (risk-ranked, scoped) | Reports | Meal Review | Profile |
| **Practitioner** | Briefing | Client Book | Meal Review | Messages | Profile |
| **Observer** | This Week | Support Tips | Profile | — | — |
| **Owner** *(reserved)* | Business Health | Locations | Trainers | Members | Profile |

Shared skeleton everywhere: **briefing home · action queue · trend · profile · one primary action.**
That consistency is the "Linear feel."

## Dashboard — the Morning Briefing answers five questions

*What happened · What matters · What to do now · What can wait · How am I doing.*

- **General User:** today's Execution Score + "Finish Today" projection + the single Next Move.
- **Coach:** count needing attention (Risk Engine, scoped) + biggest mover + one recommended outreach.
- **Practitioner:** clients at retention risk + who to message today + book trend direction.
- **Observer:** one plain-language status sentence + freshness line. Often "No action needed."

## Permission model (RLS already enforces it)

- **General User** → self only.
- **Professional** → managed people via `org_memberships` (Coach) / `practice_clients` (Practitioner) —
  already the live `can_view` predicate.
- **Observer** → read-only via `guardianships`.
- **Owner** *(reserved)* → org-aggregate only, never raw athlete meals.

No schema rework; the authz boundary already matches. This redesign is a label collapse above a model
that already supports it.

## AI behavior by role (different voice, one deterministic engine)

| Role | AI's job | Tone |
|---|---|---|
| General User | "Here's your one move today" | personal coach; goal-specific |
| Coach | "These 3 athletes are sliding, here's why + who to talk to" | chief of staff; triage |
| Practitioner | "Maria's logging dropped 40% — nudge before she churns" | retention analyst |
| Observer | "Strong week — just encourage her" | reassuring; de-escalating |
| Owner *(reserved)* | "Retention dipped 4% at the downtown location" | BI analyst |

The deterministic core computes the facts; AI only rewords per role, and the "AI" badge renders only when
a model actually ran (Founder Rule #8).

## Profile / settings architecture

- **General User:** goal + targets + scoring profile **disclosed**, editable meal-time windows,
  weight-display sensitivity, solo/Squad toggle.
- **Professional:** org/practice branding, risk thresholds, outreach-voice defaults, honest "Free preview"
  billing (no fake seat management).
- **Observer:** notification cadence only.

## The logic upgrades (the brains, per role) — pure deterministic core

Two shared engines power five roles:
- **Risk Engine** (`src/core/risk.ts`) — per-person at-risk score from logging-frequency slope, compliance
  trend direction, days-since-open, missed check-ins. Powers Practitioner book + Coach attention + Nutritionist
  exceptions.
- **Readiness Engine** (`src/core/readiness.ts`) — per-athlete composite from recovery + sleep + check-in,
  with an overtraining flag. Powers Coach (performance responsibility) + bridges nutrition into training.

Per role: General User gets a **Next-Move ranker** + adaptive meal windows + honest projection; the goal
profiles get a **`gain`** profile (the existing `general` two-sided calorie adherence wrongly penalizes a
surplus); Practitioner/Coach get Risk + an **intervention-outcome loop**; Nutritionist gets an **Exceptions
engine**; Observer gets **stand-down logic** (when to say "no action needed") + **freshness logic**.

## The 9 questions (brutal)

1. **Scalable to millions?** The 3-axis model, yes. But the wall today is the **backend being off**, not
   architecture. Go-live ops bites before scale does.
2. **Maintainable by a small team?** *More* than today — this deletes surfaces (7 labels → 3 roles). The
   change pays for itself.
3. **Daily reason for every role?** No, and we won't pretend. General User: daily. Professional: daily.
   **Observer: weekly — correct.** Owner: weekly/monthly. Forcing a daily hook on observers/owners is the
   anti-pattern.
4. **Beta:** General User + Professional (both configs).
5. **V2:** Observer (needs live link), Owner (needs the org axis built + real multi-location data).
6. **Most revenue:** Professional — the facility coach is the one-conversation, multi-seat sale. Owner is
   bigger ACV later, not beta.
7. **Strongest moat:** not the dashboards (copyable). The **accountability graph** — longitudinal athlete
   execution data + the Risk/Readiness engines on top of it.
8. **Highest retention:** General User (the daily log loop). Everyone else's retention is derived from it.
9. **Would I build it this way?** The role/goal split: **yes, the right spine.** Two changes make it
   billion-dollar: (a) **Owner is an org-axis tier, not a 4th role**; (b) **goal is primary-goal + constraints,
   not a single enum**, so coaching truly personalizes. With those, yes.

## Implementation note (how we land it without a big-bang refactor)

The existing `Role` union and `flowForRole()` already do the real routing work. We land the redesign
**additively and verify-green**, not via a destabilizing rename:

1. Promote **`Goal`** to a first-class type; auto-assign the scoring profile from goal at signup and disclose
   it; add the **`gain`** profile. (pure core)
2. Model the **three axes** as derived helpers over the existing `Role` (`identityOf`, `orgPositionOf`) so
   new code reasons in axes while old code/tests keep passing.
3. Collapse the **picker labels** (one "Team Coach" entry; goal-driven General User) without renaming the
   stored `Role` values.
4. Reserve the **Owner** tier in the type system; build nothing for it in beta.

This is a simplification that removes more than it adds, which is why it is safe to do before beta.
