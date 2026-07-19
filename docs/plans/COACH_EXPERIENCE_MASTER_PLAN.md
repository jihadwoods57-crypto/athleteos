# Coach Experience — Master Implementation Plan (v2.1)

**Scope:** the coach post-onboarding experience (from the end of coach onboarding through daily use).
**Status:** PLAN ONLY. No application code, schema, migration, policy, or test is changed by this document.
**Shipped surface:** the proto WebView at `proto/redesign-2026-07/` is the real coach UI (not `src/screens`). Server logic lives in `supabase/`.
**Latest migration on disk:** `0086_standard_item_depth.sql` → new migrations begin at **0087**.
**Date:** 2026-07-19

## Totals (recalculated for v2.1)

| | v1 | v2.1 |
|---|---|---|
| Tickets | 14 | **28** |
| Severity | 1 P0 / 6 P1 / 6 P2 / 1 P3 | **2 P0 / 9 P1 / 14 P2 / 3 P3** |
| Phases | 6 (0–5) | **9 (0–8)** |
| Migrations | 5 (0087–0091) | **12 (0087–0098)** |
| Coverage items | 20 product decisions | **34** = 20 product decisions + 14 review-expansion areas |
| Explicit corrections | — | **~100**, screen-by-screen (see §Correction register), each tagged to a ticket as a binding acceptance criterion |

**Coverage claim:** every one of the 34 items is represented by a ticket **and** a Definition of Done (see §Coverage matrix and §Definition of done); nothing is left as narrative-only. **v2.1 adds the §Correction register** — the ~100 concrete copy-and-behavior corrections from the coach-experience review, each tagged to its owning ticket. Those corrections are the binding acceptance-criteria layer under the tickets, so no specific fix (exact copy, rename, removed jargon, new control) is lost.

## Sources read

- `docs/audits/COACH_EXPERIENCE_IMPECCABLE_AUDIT.md` (UX / craft audit).
- `docs/audits/COACH_POST_ONBOARDING_LOGIC_AUDIT.md` (code-level logic audit).
- The **coach-experience review** — the 20 product decisions (v1) plus the 14 expansion areas that drive this v2.
- `PRODUCT.md`, `DESIGN.md` (governing product context + committed design system).
- `supabase/migrations/` through 0086, grounding every data-model claim below.
- `docs/coach-review/screenshots/` — **does not exist in the repo**; this plan is grounded in the two audits and the actual code, both authoritative.

## Working-tree note (must reconcile)

An earlier session left **uncommitted** interim edits: `RT.coachSetup` completion tracking; checklist routes to `coach-profile/code` / `coach-profile/staff` / a gated `coach-roster`; Coach-Profile deep-link scroll. This plan **supersedes the interim deep-links** with the dedicated flows the decisions require (staff, rooms, focused nav) and **absorbs** the completion tracking into the persisted state machine (T-16). Phase 1 folds these into the proper flows or reverts them; nothing here assumes they ship as-is.

## Design reconciliation — "urgent orange" (decision 10)

`PRODUCT.md` bans "neon, energetic orange, beast-mode" and side-stripe accents; `DESIGN.md` defines **Warning `#F59E0B` / deep `#D97706`** (proto `--amber*`). So **"urgent" = the amber Warning tokens, applied restrained** (leading indicator dot/number, tinted surface, small pill) — never a saturated fill, neon hue, or colored left border. All required-incomplete urgency uses these tokens only.

---

## Global standards (apply to every ticket)

These four standards are defined once and referenced by every ticket, satisfying decision 14 (acceptance criteria + tests on every ticket) and decision 12 (universal states).

### GS-1 · CTA trace standard (decision 14)

Every user-facing CTA (button, chip, toggle, row, submit) is specified and tested through **five states**. A ticket's "Tests" list its CTAs; each must pass all five:

1. **Persistence** — the result is written to the authoritative store (server where the data is server-owned), not local-only.
2. **Reload** — after a full app reload / cold start, the result persists and the UI reflects it (no local-only illusions).
3. **Back navigation** — Back returns to the exact origin with scroll restored (per the nav-stack), and the CTA's state is intact.
4. **Failure** — on offline/server error the UI shows an honest error + retry, never a false success, and preserves typed input.
5. **Success** — success feedback fires (toast/inline/state change), the setup state machine/store updates, and every dependent surface (Home, checklist, roster, Plan hub) refreshes.

### GS-2 · Universal state coverage (decision 12)

Every data-bearing coach surface implements: **loading** (skeleton, not a spinner-in-content), **empty** (teaches + offers a direct action — never a dead pointer), **error** (honest + retry, no fabricated data), **success**, and **permission-denied** (honest, role-scoped, no dangling controls). Offline reads as offline, never as "no data."

### GS-3 · Severity definitions (decision 1)

- **P0 — Release blocker.** Breaks a **required** setup action or corrupts data/notifications on a reachable path. **A broken first-run action that prevents required setup (Review Standard, Share Athlete Code) is P0 and blocks release.**
- **P1 — Major.** Core flow/logic defect or a required-decision feature not yet built. Fix before launch.
- **P2 — Minor.** Real but bounded; enhances a working surface.
- **P3 — Polish.** Craft/latent.

### GS-4 · Coach-setup state machine (decision 2) — canonical definition

A **persisted, server-owned** per-team setup model (implemented by T-16). Each setup **step** holds one state; the **team-setup status** is derived from the required steps.

- **Steps:** required = `{ share_code, set_standard }`; optional = `{ invite_staff, create_rooms, notification_rules, coach_voice, dietary_profile }`.
- **Step states:** `not_started · in_progress · completed · skipped · failed`.
- **Transitions:** `not_started → in_progress` when the coach opens the step's action; `in_progress → completed` on the real success signal (code shared; standard published; staff invite minted; room created; policy saved); `in_progress → failed` when the underlying write errors (surfaces inline retry); `* → skipped` only for **optional** steps via an explicit dismiss (**required steps can never be skipped or failed-into-done**); `completed` is terminal but re-openable for edits.
- **Source of truth:** required completion is derived from **real server signals** (a live `join_code`; an existing team `requirement_set`) so it is honest across devices; the state row additionally records `in_progress/failed/skipped/updated_by/updated_at` nuance. The client mirrors the row.
- **When Home updates:** any step state change (including a background sync of the derived signals) triggers a Home re-render of the checklist; success/failure of a step re-renders immediately.
- **When "Team ready" appears:** **only** when **both** required steps are `completed` **and** a live code exists — never before, never while a required step is `failed`.
- **When the checklist disappears:** while any **required** step is incomplete → the checklist is **prominent with amber urgency**; once required are `completed` but optional remain → it **collapses** to a compact persistent "finish optional setup" surface; it is **fully removed** only when every step is `completed` or `skipped`. It never vanishes merely because the first athlete joined.

### GS-5 · Customer-facing copy standard (no internal terminology) — decision-review corrections

No coach- or athlete-facing string may use engineering language. Owned and **CI-enforced by T-28** (a copy-lint that fails the build on any banned phrase). Banned → replacement:
- "minting" / "Your athlete code is minting…" → **"Creating your athlete code…"**
- "score denominator" → "the meals that count toward the daily score"
- "rails enforced server-side" → *(remove; limits are silent)*
- "prospective by default" → "applies going forward — starts on the date you choose"
- "never scored" → "tracked, not scored"
- "Planned on this phone from your latest roster view…" → a plain description of what the controls do
- "Hourly summary" → **"Overdue digest"**; **"Immediate critical" is reserved for genuine escalations, never a normal overdue meal**
- first-run "Team default" → **"Your Team Standard"**
- premature "Your team is ready" while incomplete → **"Let's get your team ready."**

Consistent domain nouns: **Standard** (never "default"/"plan"/"team standard" used interchangeably); **room** vs **custom group** vs **athlete**; **reminder** (athlete-facing) vs **alert** (coach-facing). Absolute: **no misleading labels, no fake loading states, no dead buttons, no internal engineering terminology anywhere a coach or athlete can read it.**

---

## Coverage matrix

**Product decisions (1–20 → tickets):** 1→T-15 · 2→T-16 · 3→T-07 · 4→T-03 · 5→T-03 · 6→T-04 · 7→T-04 · 8→T-06 · 9→T-05 · 10→T-05 · 11→T-05/T-16 · 12→T-10 · 13→T-01 · 14→T-01 · 15→T-01/T-07 · 16→T-08 · 17→T-01/T-17 · 18→T-12 · 19→T-11 · 20→T-09/T-20.

**Review-expansion areas (1–14 → tickets):** 1→T-15 · 2→T-16 · 3→T-17 · 4→T-18 · 5→T-12 · 6→T-07 · 7→T-03 · 8→T-04 · 9→T-19 · 10→T-10 · 11→T-11 · 12→T-20/T-21/T-22 (with T-09/T-23) · 13→T-24/T-25/T-26 · 14→GS-1 + every ticket's Acceptance/Tests.

Every item has a ticket and a DoD row. No item is narrative-only.

---

## 1. Current journey

After onboarding a coach lands on **Coach Home** (`coach-home.js`). Empty roster → `emptyTeamDashboard`: an **unconditional** "Your team is ready" banner, a "Team score — Not scored yet" tile flush against the code card (seam bleed), the invite card (code + QR + Copy/Share), and a **checklist** whose five steps misroute: **Review your standard → Plan hub** (no back, wrong tab), **Add staff → dense Coach Profile**, **Create groups → empty roster dead-end**, **notification rules → coach-only**, and a **Share-code** row that (pre-interim-edit) did nothing. Underneath, four **divergent** overdue definitions and two score formulas mean the coach can be shown wrong status and fire false "missed" pushes; scoring is **client-authored** with no server enforcement; the Team Standard editor **jumps to top** on every control; the school directory has **no real high-school data**. Full detail in the two audits.

## 2. Required journey

The coach finishes onboarding on a Home whose required next-actions are unmistakable and **amber** while incomplete; **"Your team is ready" appears only when required setup is truly complete** (live code + saved standard), driven by the persisted state machine. **Review Standard opens the editor**; **Plan is the permanent management hub**. Staff invitations are a **dedicated, named, role-and-scope-and-permission flow** distinct from athlete codes. Rooms are **first-class**, creatable **before athletes join**, with automatic assignment and a **Needs Assignment** queue. Notifications configure **both audiences** with presets, digests, quiet hours, dedup/idempotency, timezone-correctness, and **immediate cancellation on completion**. Coach Voice **reinforces** tone and standards with **hard medical/safety and no-impersonation guardrails**. The school selector is a **real searchable HS+college (and trainer/gym) directory** with city/state disambiguation and canonical IDs. Every surface has full loading/empty/error/retry/success/permission states, preserves scroll, and is never covered by nav or sticky actions. **Timing, scoring, overdue, AI feedback, and notifications all read one server-authoritative source of truth; nothing is overdue before deadline + grace; completed tasks stop receiving reminders; publishing never rewrites history.**

## 3. Routing matrix

| Action / entry | Current → destination | Required → destination | Back / tab | Decisions |
|---|---|---|---|---|
| Review your standard | `coach-plan` → Plan hub (no back, Roster tab lit) | **`coach-plan-set/team`** → Team Standard editor | origin → Home, scroll restored | 1, 2 |
| Plan (management) | `coach-plan` (also checklist target) | `coach-plan` → hub, reached from a Plan entry only | detail back; correct tab | 2, area 4 |
| Set notification rules | `coach-notif-settings` → coach alerts only | `coach-notif-settings` → coach alerts **+** athlete-reminder policy | origin → Home | 3, area 6 |
| Add another staff member | `coach-profile/staff` → profile section | **`coach-staff`** → dedicated named-invite flow | origin → Home | 4, 5, area 7 |
| Create rooms / groups | `coach-roster` → select-mode | **`coach-rooms`** → room/group builder | origin → Home | 6, 7, area 8 |
| Roster empty state | text "share from profile" | direct actions (Invite · Create room · Set standard) | — | 8 |
| Share athlete code | inline / `coach-profile/code` | inline **Copy + native Share** + `coach-profile` invitations section | — | 12, area 10 |
| Coach Profile | `coach-profile` → one dense page | `coach-profile` → **6 sections** (profile · team access · athlete invitations · staff · program settings · analytics) | detail back | area 9 |
| Coach Voice | `coach-voice` → static preview | `coach-voice` → tone/standards config + guardrails | origin | 18, area 5 |
| Trust Passes | in Plan list | Plan hub + per-athlete config | detail back | area 13 |
| Dietary sheet | `team-diet` → stub | `team-diet` → real dietary-profile view | detail back | area 13 |
| School selector | name-only, ~9 HS | real HS+college+trainer/gym, name + city/state | in-flow | 19, area 11 |

**Router invariants:** `coach-plan-set/*`, `coach-staff`, `coach-rooms`, and Coach-Profile sub-sections are **detail routes** (push origin, show back, correct tab); `coach-plan` presents a back affordance when entered from a detail context and is never the checklist target; a route reached via **focused setup navigation** (T-21) deep-links to the exact action and restores mid-setup position.

---

## 4. Deduplication map (two audits + review → one ticket set)

| Ticket | IMPECCABLE finding | LOGIC finding | Decisions / Areas |
|---|---|---|---|
| T-01 | — | P0-1, P1-1, P1-2, P2-1, P2-2, P2-3, P3-2, P3-4 | 13,14,15,17 |
| T-02 | F22 | P1-3 | 1,2 |
| T-03 | F1,F3,F23 | P2-6 (staff) | 4,5 / area 7 |
| T-04 | F2,F21 | P2-6 (groups) | 6,7 / area 8 |
| T-05 | F6,F7,F13 | P2-5 | 9,10,11 |
| T-06 | F12 | — | 8 |
| T-07 | F20 | (notif) | 3 / area 6 |
| T-08 | F27 (contradicted) | P1-4 | 16 |
| T-09 | F15,F14 | overlap | 20 |
| T-10 | F12 | Part A#1 | 12 / area 10 |
| T-11 | — | P1-5 | 19 / area 11 |
| T-12 | F8,F9 | P2-7 | 18 / area 5 |
| T-13 | — | P2-4,P2-5 | 11 |
| T-14 | F16,F17,F18,F25,F26 | P3-1,P3-3,P3-5 | design |
| T-15 | (routing blockers) | (required-action integrity) | 1 / area 1 |
| T-16 | F6 | P2-5 | 2,11 / area 2 |
| T-17 | (editor depth) | P1-4 context | 17 / area 3 |
| T-18 | F24 | — | area 4 |
| T-19 | F4,F5,F23 | P2-9 | area 9 |
| T-20 | F13,F4 | P3-1,P2-1(tab) | 20 / area 12 |
| T-21 | F1,F2 | — | area 12 |
| T-22 | F11(positive→standard) | — | area 12 |
| T-23 | F14,F16 | — | area 12 |
| T-24 | — | — | area 13 |
| T-25 | F9 | — | area 13 |
| T-26 | F10 | — | area 13 |

---

## 5. Tickets

Per-ticket fields: **Decisions/Areas · Severity · Phase**, then Goal, Scope, Files/Data/Security, **Acceptance criteria (AC)**, **Tests** (Auto + Manual; CTA trace = GS-1), Rollback, DoD. Cross-cutting detail is consolidated in §7–§14.

### P0 — Release blockers

**T-01 · One server-authoritative timing / scoring / overdue source of truth** — *Decisions 13,14,15,17 · P0 · Phases 0 + 2*
- **Goal:** collapse four overdue definitions and two/three score formulas into one source; make scoring server-authoritative; nothing overdue before `due+grace`; completed tasks excluded from reminders; history never rewritten.
- **Scope:** **Phase 0 (client, no migration):** shared `js/timing.js` (`isOverdue/dueSoon/onTime(req, atMin, nowMin, tz)` using `due+grace`) consumed by `day.js`, `exec.js`, `status.js`, `notify-plan.js`, `coach-notify-plan.js`; unify score to one profile-aware `scoreFor` (delete `state.js computeScore`/`WEIGHTS`; collapse `breakdown-model.dayScoreOf`); breakdown adds grace + honors `slotLateCredit`; legacy `coach.js` roster + trainer book routed through `athleteStatus`; `js/thresholds.js` centralizes 80 / 90-75-60 / 75-50. **Phase 2 (server):** `supabase/functions/score-day` recompute reading `meals` + resolved `requirement_sets` (grace/latePolicy/windows) + activation + `profiles.timezone`, authoritative; client advisory; shadow → compare → flag → cutover; never touches already-scored historical days (0085).
- **Files/Data/Security:** the six scoring/status/notif modules + new shared modules; `0088 profiles.timezone`, `0090 score-day` (+ temp `days.score_server/score_source`). Security-positive (removes client trust); `SECURITY DEFINER` RLS-scoped.
- **AC:** all seven surfaces (logic-audit parity table) return identical overdue verdict + identical score for the same athlete/day/instant; a meal logged at `due+grace` scores on-time; a completed requirement produces no reminder; publishing a tomorrow-effective standard leaves today's + past scores byte-identical; no threshold hardcoded outside `thresholds.js`.
- **Tests:** *Auto* — boundary matrix `due-1/due/due+1/due+grace/due+grace+1` × grace {0,15,60} × policy {half,full,none}; cross-tz coach==athlete; no-reminder-after-completion; client==server parity all profiles; historical immutability. *Manual* — two-timezone devices; publish-and-verify-history.
- **Rollback:** Phase 2 flag-gated; revert = client-authoritative (Phase 0 already correct); never overwrite history.
- **DoD:** decisions 13/14/15/17 demonstrably true on device; parity + boundary suites green.

**T-15 · First-run required-action release gate** — *Decision 1 · Area 1 · P0 · Phase 1*
- **Goal:** treat any broken **required** first-run action as a launch blocker. The two required actions — **Set the standard** (via Review Standard) and **Share the athlete code** — must work end-to-end or release is blocked.
- **Scope:** define the required-action set (ties to GS-4); assert each required CTA passes the full GS-1 trace; add a release checklist gate (CI + manual) that fails if any required action regresses; wire the state machine so a `failed` required step blocks "Team ready" and surfaces retry.
- **Files/Data/Security:** `coach-home.js`, `coach.js` (`coachPlanSet` save), `state.js` (setup state), CI test config; no new table beyond `0092` (T-16).
- **AC:** Review Standard reaches the editor in one tap and a publish persists + reflects on Home; Share Code copies/shares a real code and marks the step completed; a simulated failure of either shows retry, never false success; "Team ready" cannot appear while either required step is not `completed`.
- **Tests:** *Auto* — GS-1 five-state trace for both required CTAs (persist/reload/back/failure/success); release-gate test that fails on a broken required route. *Manual* — cold-start after each required action; offline failure + retry.
- **Rollback:** the gate is test/CI only; no runtime risk.
- **DoD:** CI blocks a build where a required first-run action is broken; both required actions pass GS-1.

### P1 — Major

**T-02 · Review → Team Standard editor; Plan stays the hub** — *Decisions 1,2 · P1 · Phase 1*
- **Goal:** Review Standard opens the editor directly; Plan is the permanent hub, not a checklist detour, with correct back + tab.
- **Scope:** checklist step → `coach-plan-set/team`; make `coach-plan-set/*` detail routes; give the hub a back affordance and stop it resetting the Roster tab when entered from a detail context; remove `coach-plan` as the checklist target.
- **Files/routes:** `coach-home.js`, `router.js` (`ROOT_TAB`, `navigateTo`), `coach.js` (`coachPlan` header).
- **AC:** one tap from the checklist opens the team editor; Back → Home @ prior scroll; correct tab lit throughout; Plan hub reachable from its own entry with a back affordance.
- **Tests:** *Auto* — routing + back-stack + active-tab assertions; GS-1 for the Review CTA. *Manual* — deep-link + hardware back.
- **Rollback:** route strings; trivial. **DoD:** decisions 1,2 true; no wrong-tab/no-back.

**T-03 · Staff invitations — named, scoped, permissioned, full lifecycle** — *Decisions 4,5 · Area 7 · P1 · Phase 4*
- **Goal:** a dedicated staff-invitation flow with named invites, role, scope, granular permissions, full states, resend/revoke/expire, audit history, owner-safety, and RLS — never a generic broad-access code.
- **Scope:** new `coach-staff` route + flow: **create** (name/label, role, scope = team/room/group, granular per-category permissions), **states** `pending · accepted · expired · revoked`, **resend**, **revoke**, **expiration**, **audit history** (who invited/accepted/revoked/when), **owner-safety** (the last head coach can never be revoked/demoted), and RLS so only head coach/team-admin manage invites and staff only see their scope. Extend the existing `staff_invites`/`team_staff`/`staff_role` (0083) — which today is role-only, single code — into the full model (0082 deferred per-category permissions land here).
- **Files/Data/Security:** new `js/screens/coach-staff.js`; `coach-home.js`, `coach-create.js`, `coach-profile` (link); `roles.js`; **`0093 staff_invitations_v2`** (name, scope_kind/value, permissions jsonb, state enum, expires_at, resend_count) + **`staff_audit_log`** + RLS; head-coach/team-admin write, staff scoped read; owner-safety constraint.
- **AC:** an invite carries a name, role, scope, and explicit permissions; it moves pending→accepted on redemption, →expired at TTL, →revoked on action; resend issues a fresh code and voids the prior; the last head coach cannot be removed; the audit log records every transition; a coordinator cannot invite; staff codes are visually + functionally distinct from the athlete join code.
- **Tests:** *Auto* — RLS matrix (head vs coordinator vs readonly); state transitions; owner-safety block; GS-1 for invite/resend/revoke CTAs; staff-code ≠ athlete-code. *Manual* — full invite→accept→revoke on two accounts; expiry.
- **Rollback:** new tables additive; flag the flow; keep interim deep-link.
- **DoD:** decisions 4,5 + area 7 true; no broad-access code path remains.

**T-04 · Position rooms vs custom groups — first-class, pre-athlete, auto-assigned** — *Decisions 6,7 · Area 8 · P1 · Phase 3*
- **Goal:** formal position **rooms** distinct from custom **groups**, creatable before athletes, with suggested rooms, automatic assignment, a Needs-Assignment queue, staff ownership, inheritance, overrides, reassignment, and empty-room display.
- **Scope:** `coach-rooms` builder: create/name rooms (with **suggested** rooms from the sport's position taxonomy), attach a room-scoped standard (`requirement_sets scope='position'`), assign a **staff owner**, show **inheritance** (team → room → group → individual) and **overrides**, **reassign** athletes, a **Needs Assignment** list (athletes whose position matches no room / are unassigned), and a clear **empty-room** state. Custom groups remain a separate, ad-hoc construct. Athletes auto-map to a room by position on join.
- **Files/Data/Security:** new `js/screens/coach-rooms.js`; `coach-roster.js`, `coach-data.js` (rooms in `CD.extras`), `requirements.js`, `roles.js`; **`0087 team_rooms`** (team_id, key, label, sort, staff_owner_id, needs_assignment view/flag) + backfill from positions; RLS team-read / head+coordinator write.
- **AC:** a room can be created with zero athletes; a matching athlete auto-joins; unassigned athletes appear in Needs Assignment; room-scoped standard resolves via `resolveRequirementSet` with correct inheritance/override precedence; empty rooms render an honest teach state; reassignment persists.
- **Tests:** *Auto* — pre-athlete room create; auto-assign on join; inheritance precedence; Needs-Assignment membership; GS-1 for create/assign/reassign CTAs. *Manual* — create rooms before invite, then have athletes join.
- **Rollback:** table additive; flag builder. **DoD:** decisions 6,7 + area 8 true.

**T-05 · Home checklist: required/optional, amber urgency, gated "ready"** — *Decisions 9,10,11 · P1 · Phase 1*
- **Goal:** split required vs optional; amber for required-incomplete; "Team ready" only when required complete; checklist lifecycle per GS-4.
- **Scope:** render Required (share code, set standard) and Optional (staff, rooms, notifications, Coach Voice, dietary) groups; amber Warning treatment on required-incomplete (restrained, per design reconciliation); readiness + checklist visibility driven by T-16's state machine and derived signals; next-actions above celebratory chrome (F7).
- **Files/Data/Security:** `coach-home.js`, `coach-data.js` (derived signals), `coach.css` (amber tokens); reads `0092` (T-16).
- **AC:** "ready" hidden until code+standard exist; required-incomplete shows amber; optional steps never gate readiness; checklist persists per GS-4 (collapses when required done, removed when all done/skipped); no side-stripe/neon.
- **Tests:** *Auto* — readiness gating; amber only on required-incomplete; checklist lifecycle transitions; GS-1 per checklist row. *Manual* — walk fresh team through required then optional.
- **Rollback:** revert to interim checklist. **DoD:** decisions 9,10,11 true.

**T-08 · Team Standard controls preserve scroll** — *Decision 16 · P1 · Phase 0*
- **Goal:** no jump-to-top on any editor control.
- **Scope:** replace per-tap `window.__render()` with in-place DOM patching (roster-search pattern) **or** have `router.render()` capture/restore `viewport.scrollTop` across a same-route re-render (preferred — also fixes the athlete profile chip jump); add `type="button"` to the late/effective `<button>`s (P3-3).
- **Files:** `coach.js` (`coachPlanSet`), `router.js`, `components.js`.
- **AC:** scrollTop preserved after every control tap; focused input not blurred by a sibling tap.
- **Tests:** *Auto* — scroll-preservation + focus assertions. *Manual* — change every control while scrolled.
- **Rollback:** scoped. **DoD:** decision 16 true.

**T-10 · Athlete-code behavior — full lifecycle** — *Decision 12 · Area 10 · P1 · Phase 4*
- **Goal:** generation, uniqueness, customization, regeneration with confirmation, persistence, retry, timeout, failure, replacement/revocation, rate limiting, copy, native share, success feedback.
- **Scope:** on team create the code is minted (existing `create_team gen_join_code`); expose **customize** (`set_my_team_code`, 0026) and **regenerate** (with a confirm dialog warning the old code stops working) and **revoke/replace**; **rate-limit** regen/customize server-side; honest **retry/timeout/failure** on any code op; **copy** + **native share** with clipboard fallback; **success feedback** (toast); persistence across reload.
- **Files/Data/Security:** `coach-home.js`, `coach-profile` (invitations section), `state.js`, `roles.js`; **`0098 join_code_guard`** (rate-limit + regen-confirm server support; extends 0026/0080). Uniqueness already enforced (`join_code` unique).
- **AC:** codes are unique; customize/regenerate persist and old codes stop working; regenerate requires confirmation; rate-limit blocks abuse with an honest message; copy writes the code; native share invoked with fallback; a failed op shows retry, never false success.
- **Tests:** *Auto* — uniqueness; rate-limit; regen invalidates old; GS-1 for copy/share/customize/regenerate/revoke. *Manual* — regenerate + confirm on device; share sheet.
- **Rollback:** guard migration additive. **DoD:** decision 12 + area 10 true.

**T-11 · Real HS + college (+ trainer/gym) directory, searchable with city/state** — *Decision 19 · Area 11 · P1 · Phase 6*
- **Goal:** real searchable directory with city/state disambiguation, canonical IDs, a missing-school flow, school↔coach association, coach-code validation, and trainer/gym equivalents.
- **Scope:** import NCES (HS) + IPEDS (college) into `orgs` with **canonical IDs**; add **city/state** filters to the `org-directory` edge function + UI; a **missing-school** flow (free-text → real unverified `orgs` row at commit, deduped) that flags for later verification; **school↔coach association** (a coach belongs to an org; staff inherit); **coach-code validation** (join/staff codes validated against the org context); **trainer/gym** org types for the trainer/nutritionist personas.
- **Files/Data/Security:** `supabase/functions/org-directory/index.ts`, `screens/roles.js` (`coachOb`), `state.js` (`find_org`/insert); **`0091 directory_import`** (seed + canonical `nces_id`/`ipeds_id`, trainer/gym `type`, trigram(name) + btree(state) indexes). Anon read only; dataset licensing reviewed (flagged in 0022).
- **AC:** a real HS/college resolves by name; name+state/city disambiguates two same-named schools; canonical IDs prevent duplicates; missing-school creates one unverified row and dedupes; trainer/gym orgs are searchable for those personas; coach/staff codes validate in the org context.
- **Tests:** *Auto* — name / name+state search; dedupe on re-entry; canonical-ID uniqueness. *Manual* — find a real school; disambiguate.
- **Rollback:** seed reversible by source tag. **DoD:** decision 19 + area 11 true.

**T-16 · Coach-setup state machine (persisted)** — *Decisions 2,11 · Area 2 · P1 · Phase 1*
- **Goal:** implement GS-4 exactly — persisted states, derived required signals, and the precise Home / "ready" / checklist rules.
- **Scope:** **`0092 coach_setup_state`** (team_id, step, state enum, updated_by, updated_at) server-owned; derive required completion from live `join_code` + team `requirement_set`; client mirror + render triggers; `failed`/`skipped`/`in_progress` nuance; optional-step skip (required cannot skip); all consumers (Home checklist, "ready" banner, T-05) read this.
- **Files/Data/Security:** `state.js`, `coach-home.js`, `coach-data.js`; `0092` + RLS (team staff read, head/coordinator write). Migrates the interim client-only `RT.coachSetup`.
- **AC:** exactly the GS-4 transitions; "ready" only when both required completed + live code; checklist lifecycle per GS-4; state survives reload and is consistent across staff devices; a failed required step blocks "ready" and shows retry.
- **Tests:** *Auto* — every GS-4 transition; reload persistence; required-cannot-skip; "ready"/checklist gating. *Manual* — reopen mid-setup on a second device.
- **Rollback:** table additive; fall back to derived-only (no in_progress/failed nuance). **DoD:** decision 2,11 + area 2 true.

**T-17 · Team Standard editor — full specification** — *Decision 17 · Area 3 · P1 · Phase 3*
- **Goal:** the editor covers assignment scope, inheritance, collapsible sections, templates, custom meal names, per-meal proof, schedule variations, training days/windows, custom weigh cadence, coach-review policy, score-weight validation, full athlete preview, effective dates, publish confirmation, sticky actions, and historical protection.
- **Scope (existing → extend):** *exists today* — meal count/names/windows, grace + late policy, lift cadence, weigh MWF/daily, recovery/checkin toggles, hydration, templates, "what the athlete sees" preview, effective-from (0085), server-validated rails (0086). *Add* — **assignment scope** picker (team/room/group/individual) with **inheritance** display + overrides; **collapsible sections** (persist open-state); **per-meal proof rules** (photo/check/scale/form per meal, not uniform); **schedule variations** (per-day windows, training vs off days); **custom weigh-in cadence** (arbitrary day set); **coach-review policy** wired to a real review queue (fixes dead `coachReview`); **score-weight validation** (weights sum to 100, honest rejection); **full athlete preview** (the complete scored day, not just meals); **publish confirmation** (diff + effective date + "history unaffected"); **sticky Save** that never covers content (T-09); **historical protection** (0085 preserved; publish is prospective).
- **Files/Data/Security:** `coach.js` (`coachPlanSet`), `requirements.js`, `state.js`, `coach.css`; `requirement_sets` (0055/0085/0086) extended in items jsonb for per-meal proof / schedule variations / weigh cadence — validated in `validate_requirement_items()` (extend 0086 rules; may need a small migration if new item shapes need server validation). Historical protection = 0085.
- **AC:** scope + inheritance shown and honored; sections collapse and persist; per-meal proof saved and enforced by scoring; schedule/training-day variations resolve correctly; weigh cadence arbitrary; coach-review routes to a real queue; weights must sum to 100 or Save is blocked with an honest message; the preview equals the athlete's real scored day (T-01 parity); publish shows a confirmation and never rewrites history; Save is sticky and non-occluding; scroll preserved (T-08).
- **Tests:** *Auto* — inheritance precedence; per-meal proof enforcement; weight-sum validation; preview==scored-day; publish leaves history byte-identical; GS-1 for Save/Publish/section-toggle. *Manual* — build a full standard with variations; publish; verify athlete + history.
- **Rollback:** item-shape additions gated by validation version; revert = ignore new item fields (older scoring tolerates). **DoD:** area 3 + decision 17 true.

### P2 — Minor

**T-06 · Roster empty-state direct actions** — *Decision 8 · P2 · Phase 4*
- **Goal:** the empty roster offers Invite · Create room · Set standard inline (+ code/share); no dead pointer.
- **Scope:** replace "share from your profile" text with direct action buttons wired to the real flows; honest empty state (GS-2).
- **Files:** `coach-roster.js`.
- **AC:** each action navigates to its real destination; code + share inline; no dead-end.
- **Tests:** *Auto* — GS-1 per CTA. *Manual* — empty-roster walkthrough.
- **Rollback:** trivial. **DoD:** decision 8 true.

**T-07 · Notification rules — full spec (coach + athlete)** — *Decisions 3,15 · Area 6 · P2 · Phase 5*
- **Goal:** one screen configures coach alerts **and** athlete reminders, with the full feature set.
- **Scope:** presets; due-soon + overdue reminders; recovery/weigh-in/check-in reminders; grouped coach alerts + thresholds; digests (briefing/recap exist); scope (my-room vs team); full quiet hours (start **and** end); previews; **duplicate suppression + idempotency** (server dispatch log, one fire per key); **timezone behavior** (athlete-local, ties T-01/0088); **repeated-miss escalation**; **immediate cancellation after completion** (decision 15). Team athlete-policy server-side; athlete personal prefs merge.
- **Files/Data/Security:** `settings.js` (`coachNotifSettings`), `state.js`, `notify-plan.js`, `coach-notify-plan.js`; **`0089 team_notification_policy`** + **`0095 notification_dispatch`**. Head+coordinator write.
- **AC:** coach policy drives athlete reminders; presets apply; each reminder type configurable; grouped alerts fire at thresholds; digests fire once (idempotent); quiet hours honored both ends; timezone-correct; a completed task cancels its pending reminder immediately; repeated misses escalate; previews render.
- **Tests:** *Auto* — idempotency (one dispatch/key); cancellation-on-completion; quiet-hours boundaries; timezone; GS-1 per control. *Manual* — set policy, observe on athlete device; complete a task → reminder cancels.
- **Rollback:** tables additive; flag. **DoD:** decisions 3,15 + area 6 true.

**T-09 · No nav / sticky covers content** — *Decision 20 · P2 · Phase 8*
- **Goal:** nothing interactive occluded by the tab bar or sticky actions.
- **Scope:** raise the roster bulk bar above the 96 px tab bar (`bottom: calc(96px + env(safe-area-inset-bottom) + 8px)`); audit every sticky/fixed element (editor Save, sheets); confirm the 128 px viewport reserve.
- **Files:** `coach-roster.js`, `app.css`, `coach.css`, `coach.js` (sticky Save).
- **AC:** bulk bar + sticky Save fully visible/tappable at min viewport incl. safe-area; no content under the tab bar.
- **Tests:** *Auto* — computed-position at small viewport. *Manual* — small device + safe-area.
- **Rollback:** CSS scoped. **DoD:** decision 20 true.

**T-12 · Coach Voice — full spec + guardrails** — *Decision 18 · Area 5 · P2 · Phase 7*
- **Goal:** a real config that reinforces tone/standards with hard guardrails; never impersonates or invents requirements.
- **Scope:** tone; accountability level; approved phrases; prohibited language; response triggers (when the AI speaks); escalation (when to defer to the coach); scenario previews (sample replies); feedback controls (tune via thumbs/report); **AI labeling** (every AI message labeled as AI, never the coach); **medical/safety boundaries** (never diagnoses, defers to medical, safety-flag handoff). Wire the dead `coachReview` into the review queue (with T-17).
- **Files/Data/Security:** `features.js` (`coachVoice`), `meal-intel.js` + `meal-chat` edge function (prompt guardrails + labeling), `coach.js`/`requirements.js`; **`0094 coach_voice_config`**. The edge function **must reject** AI-authored requirement creation and coach impersonation (fail-closed).
- **AC:** AI reinforces the coach's rulings in the chosen tone; always labeled AI; never signs as the coach; never creates a requirement; respects prohibited language; escalates/defers per config; medical/safety → boundary response; previews render; feedback tunes future output.
- **Tests:** *Auto* — red-team suite (impersonation, new-requirement, medical) all blocked; labeling present on every AI message. *Manual* — configure tone; preview scenarios.
- **Rollback:** config additive; guardrails fail-closed. **DoD:** decision 18 + area 5 true.

**T-13 · Minting / readiness honesty** — *Decision 11 · P2 · Phase 1*
- **Goal:** honest loading/offline/minting/live states; no fake async; real retry on failure.
- **Scope:** the dashboard consults `RT.teamLoading`/`RT.teamOffline`; drop "usually a few seconds" (mint is synchronous — `create_team gen_join_code`); real retry when `create_team` failed (today can read "minting" forever).
- **Files:** `coach-home.js`, `state.js` (`_loadTeamIntoRt`/`persistCoachOnboarding`).
- **AC:** each RT state renders its own message; failed create → retry; never indefinite minting.
- **Tests:** *Auto* — state→message mapping; failed-create→retry. *Manual* — offline; simulated create failure.
- **Rollback:** none needed. **DoD:** decision 11 true (with T-05/T-16).

**T-18 · Plan hub — permanent management surface** — *Area 4 · P2 · Phase 3*
- **Goal:** fully specify the permanent hub.
- **Scope:** sections — **Active standards** (team + per-room, with people-affected counts); **Rooms + overrides + inheritance** view; **Readiness** (setup completeness at a glance); **Upcoming changes** (scheduled effective-date versions, 0085); **Trust Passes** (roster-wide, links T-24); **Coach Voice status** (on/off + config link, T-12); **Dietary status** (declaration coverage, T-25); every empty state actionable (GS-2).
- **Files/Data/Security:** `coach.js` (`coachPlan`), `coach-data.js`, `requirements.js`; reads existing tables + `0085` (upcoming) + `0092` (readiness).
- **AC:** each section shows real data or an actionable empty state; people-affected counts correct; upcoming scheduled versions listed; Trust Pass / Coach Voice / dietary statuses accurate; inheritance/overrides legible.
- **Tests:** *Auto* — section derivation; empty-state actions GS-1. *Manual* — hub with mixed real data.
- **Rollback:** read-only surface. **DoD:** area 4 true.

**T-19 · Coach Profile restructure** — *Area 9 · P2 · Phase 4*
- **Goal:** split the dense profile into six sections.
- **Scope:** **Personal profile** (identity, handle, sign-out); **Team access** (code, join settings); **Athlete invitations** (code + share, links T-10); **Staff management** (links T-03 flow); **Program settings** (standards, templates, Coach Voice, notifications, visibility); **Analytics** (Insights entry). Fix the no-active-tab / stack-reset nav (F4/F5).
- **Files:** `roles.js` (`coachProfile`), `router.js`, `components.js`.
- **AC:** each concern on its own section; staff vs athlete invitations distinct; correct back + tab; no dangling controls for scoped roles (GS-2 permission state).
- **Tests:** *Auto* — section routing + tab; permission-scoped visibility. *Manual* — navigate all six.
- **Rollback:** revert to single page. **DoD:** area 9 true.

**T-20 · Layout & tab correctness** — *Decision 20 · Area 12 · P2 · Phase 1*
- **Goal:** fix the Team-Score/code seam bleed and incorrect active-tab lighting.
- **Scope:** add margin between the pulse tile and the code/minting box (kill the zero-gap seam + aurora bleed); ensure the active bottom tab reflects the real surface (coach-profile/coach-plan not mis-lighting Roster) — pairs with T-02/T-19 router fixes.
- **Files:** `coach.css`, `app.css`, `coach-home.js`, `router.js`.
- **AC:** no seam/bleed at the tile↔code boundary; the lit tab matches the surface or its origin.
- **Tests:** *Auto* — computed margin; active-tab per route. *Manual* — visual, both themes.
- **Rollback:** scoped. **DoD:** area 12 (overlap + tab) true.

**T-21 · Focused & resumable setup navigation** — *Area 12 · P2 · Phase 1*
- **Goal:** setup actions deep-link to the exact action and restore mid-setup position on reopen.
- **Scope:** each checklist/menu action lands on its specific target (not a hub) with focus set; reopening mid-setup restores the last position + the state machine's `in_progress` step; back returns to origin (nav-stack).
- **Files:** `coach-home.js`, `coach-create.js`, `router.js`, the new flow screens (T-03/T-04).
- **AC:** an action opens its exact target with focus; reopening mid-setup resumes; back → origin @ scroll.
- **Tests:** *Auto* — deep-link target + focus; resume-after-reload; back-stack. *Manual* — background/foreground mid-setup.
- **Rollback:** routing. **DoD:** area 12 (focused nav + reopen) true.

**T-22 · Universal state coverage** — *Area 12 · P2 · Phase 1*
- **Goal:** apply GS-2 to every coach surface as a verified standard.
- **Scope:** audit each coach screen for the five states; add missing skeletons, honest error+retry, success feedback, permission-denied; codify as a CI-tested checklist.
- **Files:** all coach screens; shared state components in `components.js`.
- **AC:** every data-bearing coach surface implements all five GS-2 states; no spinner-in-content; no dead pointers; offline reads honestly.
- **Tests:** *Auto* — per-surface state-render matrix. *Manual* — force each state (offline, error, role-scoped).
- **Rollback:** additive. **DoD:** area 12 (states) true.

**T-24 · Trust Pass configuration** — *Area 13 · P2 · Phase 3*
- **Goal:** configurable Trust Passes over the existing engine (`0033/0039`).
- **Scope:** config surface (default length, eligibility threshold, per-team defaults); per-athlete grant/end (exists) surfaced in Plan hub + athlete profile; honest eligibility messaging; server eligibility preserved as the wall.
- **Files/Data/Security:** `coach.js` (Plan/athlete), `roles.js`; **`0097 trust_pass_policy`** over `0033/0039`.
- **AC:** coach sets default length/eligibility; grant respects server eligibility; end works; status in Plan hub + profile.
- **Tests:** *Auto* — eligibility enforcement; GS-1 for grant/end/config. *Manual* — grant/end on a real athlete.
- **Rollback:** policy additive. **DoD:** area 13 (Trust Pass) true.

**T-25 · Dietary-profile management** — *Area 13 · P2 · Phase 3*
- **Goal:** a real dietary model (athlete declarations → coach view), replacing the `team-diet` stub.
- **Scope:** athlete declares restrictions/allergens (severity-flagged) in profile; coach sees a **Team Dietary Sheet** (severity-flagged, travel-ready, GS-2) + per-athlete dietary status in the Plan hub; privacy-scoped (coach + trainer read, not teammates).
- **Files/Data/Security:** `features.js` (`teamDiet`), athlete profile, `coach.js`/`coach-data.js`; **`0096 dietary_profiles`** (athlete write, team staff + trainer read). No first-class dietary table exists today.
- **AC:** an athlete declaration appears on the coach sheet, severity-flagged; empty state honest; privacy scoped; per-athlete status in Plan hub.
- **Tests:** *Auto* — RLS (teammate cannot read); declaration→sheet; GS-1 for declare/edit. *Manual* — declare as athlete, view as coach.
- **Rollback:** table additive. **DoD:** area 13 (dietary) true.

**T-27 · Coach display-name derivation** — *Area 9 · P2 · Phase 1*
- **Goal:** the coach's display handle is coach-chosen and correct (e.g. **Coach Woods**, from the last name or their explicit pick) — never silently auto-defaulted to the first name (**Coach Jihad**).
- **Scope:** fix the onboarding handle logic (`roles.js coachOb` suggestions + `profiles.coach_display_name`, 0056) so the default prefers "Coach \<lastname\>", the coach's explicit choice always wins and persists, and the Home greeting, meal threads, and the standard all read the chosen handle.
- **Files/Data:** `roles.js` (coachOb), `state.js` (`saveCoachHandle`), `coach-home.js` (greeting); `profiles.coach_display_name` (0056 — no new migration).
- **AC:** the suggested handle defaults to the last name; the coach can override; the choice persists across reload and appears everywhere; it is never silently "Coach \<firstname\>".
- **Tests:** *Auto* — default-derivation + override persistence + GS-1 for the handle CTA. *Manual* — onboard as "Jihad Woods", confirm "Coach Woods".
- **Rollback:** client logic; revert. **DoD:** correct handle everywhere.

**T-28 · Customer-facing copy & naming pass** — *GS-5 · P2 · Phase 8 (per-screen copy lands in each screen's own phase; T-28 is the enforcement sweep)*
- **Goal:** enforce GS-5 across every coach/athlete string — remove all internal terminology, apply the renames, make naming consistent.
- **Scope:** replace every banned phrase (GS-5) at its source; consistent "Standard" naming; the renames ("minting"→"Creating…", "Hourly summary"→"Overdue digest", first-run "Team default"→"Your Team Standard", "Add another staff member"→"Invite your staff", "Create Position Groups"→"Organize your roster", premature "ready"→"Let's get your team ready", the editor jargon removals, the notifications subtitle); add a **copy-lint** to CI that fails on any banned phrase in `proto/**/*.js`.
- **Files:** every coach screen's strings; a new CI copy-lint.
- **AC:** no banned phrase appears in shipped strings; every rename applied; naming consistent; the lint blocks regressions.
- **Tests:** *Auto* — copy-lint over the proto strings. *Manual* — read every coach screen for jargon.
- **Rollback:** copy-only; revert strings. **DoD:** GS-5 fully enforced.

### P3 — Polish

**T-14 · Design-system polish batch** — *design · P3 · Phase 8*
- 44 px touch targets (`.co-chip`/`.co-abtn`/avatar/inline sm, F16); remove side-stripes (`.co-pri`/`.std-preview`, F25, PRODUCT.md ban); gradient-score contrast fallback (F17); toggle/segment aria + focusability (F18); retire/relabel orphaned `copilot` (F26); empty team-score stray dash (F13); threshold-centralization UI follow-through (from T-01). **Files:** `coach.css`, `app.css`, `coach.js`, `components.js`. **AC:** a11y floor met, no anti-patterns. **Tests:** *Auto* — target-size + aria lint; *Manual* — a11y sweep. **DoD:** design clean.

**T-23 · Input & display resilience** — *Area 12 · P3 · Phase 8*
- Keyboard avoidance on all bottom-anchored inputs (composers, code entry, editor); safe-area insets on every surface; **dynamic/large-text scaling** (respect OS text size; no clipped/overlapping labels at 200%). **Files:** `router.js` (keyboardAvoidance), `app.css`, `coach.css`. **AC:** focused fields clear the keyboard; safe-area respected; layouts survive large text. **Tests:** *Auto* — text-scale snapshot; *Manual* — keyboard + large-text on device. **DoD:** area 12 (keyboard/safe-area/dynamic text) true.

**T-26 · Requirement template lifecycle** — *Area 13 · P3 · Phase 3*
- Complete CRUD on the existing template model (`0074`): create/apply/seed exist; add **rename**, **delete**, **edit**; team-scoped; apply fills the editor knobs (never writes the DB directly — the coach still publishes). **Files:** `coach.js` (`coachPlanSet`), `templates.js`, `roles.js`; extend `0074` (rename/delete RPCs + RLS — RPC-only or a small migration). **AC:** full CRUD; apply fills knobs; unique-name enforced. **Tests:** *Auto* — CRUD + apply + unique-name; GS-1 per template CTA; *Manual* — create/rename/delete/apply. **DoD:** area 13 (templates) true.

---

## Correction register (explicit, screen by screen)

Every correction raised in the coach-experience review, listed verbatim-in-intent and tagged to the ticket(s) that deliver it. **These are binding acceptance criteria** for their owning tickets — a ticket is not done until its register items pass. Copy strings, renames, and removed jargon are governed by **GS-5 / T-28**.

### Post-onboarding Home
- Replace premature "Your team is ready" while setup is incomplete with **"Let's get your team ready."** [T-05, GS-5]
- Make **"Finish setting up your team"** amber to signal urgency (design-system Warning, restrained). [T-05]
- Put setup tasks in a logical, actionable order. [T-05]
- Separate required tasks from optional tasks. [T-05]
- Show setup progress, e.g. **"2 of 3 required steps complete."** [T-05, T-16]
- Mark tasks complete only from persisted backend state. [T-16]
- Do not show Team Score as active before athletes have joined **and logged**. [T-13, T-05]
- Fix the Team Score / athlete-code card overlap. [T-20]
- **"Your athlete code is minting…" → "Creating your athlete code…"** [T-13, GS-5]
- Add real loading, failure, timeout, retry, and success states. [T-13, T-22]
- Make Share Athlete Code actually work (copy + native share + real success feedback). [T-10, T-15]
- Bottom navigation must not cover the final checklist item. [T-09]

### Review Your Standard
- Tapping opens the Team Standard editor directly; **do not route through the Plan hub.** [T-02]
- The screen states the standard was created from the coach's onboarding answers. [T-17]
- The confirmation marks the setup task complete and returns to Home. [T-02, T-16]
- Rename first-run "Team default" to **"Your Team Standard."** [T-17, GS-5]
- Explain it is the starting standard for athletes who don't have an override. [T-17]

### Team Standard editor
- Stop every interaction from snapping the page to the top. [T-08]
- Remove internal language ("score denominator", "rails enforced server-side", "prospective by default", "never scored") → normal coach-facing copy. [GS-5, T-28]
- Add assignment scope: **entire roster · position room · custom group · individual athlete.** [T-17]
- Break the page into collapsible sections, each showing a summary while collapsed. [T-17]
- Move Templates toward the beginning of the workflow. [T-17]
- Support custom meal names. [T-17]
- Support per-meal photo requirements, not one global toggle. [T-17]
- Support more flexible meal schedules. [T-17]
- Support custom lifting days and completion windows. [T-17]
- Support more weigh-in frequencies than Off / M-W-F / Daily. [T-17]
- Clarify what "Coach review on meals" does; options: **every meal · AI-flagged meals · late-or-missed meals · daily digest.** [T-17]
- Show the complete score impact. [T-17]
- Validate that score percentages total 100%. [T-17]
- Clarify how a weekly check-in affects scoring. [T-17]
- Make "What the athlete sees" a **complete** preview, not only meals. [T-17]
- Fix the contradiction where Today appears selected while the text says tomorrow is the default; support **Today · Tomorrow · Choose a date.** [T-17]
- Hide the normal bottom navigation while editing; add a sticky **Publish / Update** action. [T-09, T-17]
- Consistent naming: **Standard** (not default / plan / team standard mixed). [GS-5, T-28]

### Plan screen
- Fix the incorrect active nav state (Roster highlighted on the Plan page). [T-20, T-02]
- Do not fill the page with passive explanatory paragraphs; convert empty sections into actionable cards. [T-18]
- Show: **what's active · who it applies to · what's incomplete · position rooms · athlete overrides · inheritance status.** [T-18]
- Replace generic "Team default" language with clearer wording. [T-18, GS-5]
- Add a real program summary / readiness section. [T-18]
- Move Trust Passes into a configurable rewards/flexibility section; clarify rules, duration, revocation, and scoring behavior. [T-18, T-24]
- Rename / improve "Team dietary sheet"; **replace the unrelated bell icon** with a dietary icon. [T-25, T-14]
- Reduce the large dead area at the bottom. [T-18, T-14]

### Notification Rules
- Add separate sections for **Coach alerts** and **Athlete reminders** (the checklist promises both; today the page is coach-only). [T-07]
- Replace the internal subtitle "Planned on this phone from your latest roster view…" with a plain description. [T-07, GS-5]
- Add recommended quick-setup presets: **Essential · Balanced · Hands-on.** [T-07]
- Rename "Hourly summary" → **"Overdue digest."** [T-07, GS-5]
- Do not use "Immediate critical" for a normal overdue meal. [T-07, GS-5]
- Define what triggers a group-overdue alert; allow a **number or percentage** threshold. [T-07]
- Turn "My room only" from an unclear toggle into a proper **scope selector.** [T-07]
- Quiet hours must include both a **start and a resume** time. [T-07]
- Preview morning-briefing and evening-recap content. [T-07]
- Never remind an athlete after completion; stop notifications immediately after completion. [T-01, T-07]
- Never mark overdue before deadline + grace. [T-01]
- Suppress duplicate alerts; **group** coach notifications rather than one per athlete. [T-07]
- Respect athlete-assigned schedules and time zones. [T-01, T-07]

### Add staff
- "Add another staff member" must not open Coach Profile; rename the checklist item to **"Invite your staff."** [T-03, GS-5]
- Open a focused staff-invitation flow with: **role · team/room scope · permissions · email / invite link / supported method.** [T-03]
- Staff invitations stay separate from athlete codes. [T-03]
- States: **pending · accepted · expired · revoked · resend · retry.** [T-03]
- Return to Home after the invitation is completed or skipped. [T-03, T-21]
- Keep optional, not blocking launch. [T-03, GS-4]

### Coach Profile
- Stop using Coach Profile as a catch-all settings page. [T-19]
- Separate: **personal profile · team access · athlete code · staff management · program settings · analytics.** [T-19]
- Keep Standards, Templates, Insights, Coach Voice, staff, and athlete code out of one dense screen. [T-19]
- Fix coach display-name logic → **Coach Woods**, not automatically Coach Jihad. [T-27]

### Create Position Groups
- The button must not open a dead empty Roster; open a dedicated **position-room / group builder.** [T-04]
- Allow rooms to be created before athletes join. [T-04]
- Suggest groups based on sport and coach role. [T-04]
- Clearly distinguish **position rooms** from **custom groups.** [T-04]
- Support **staff ownership · standard inheritance · automatic athlete assignment · Needs Assignment fallback.** [T-04]
- Return to Home after setup. [T-04, T-21]
- Consider renaming the task to **"Organize your roster"** (position groups don't apply to every coach/trainer). [T-04, GS-5]

### Empty Roster
- Don't tell the coach to leave and find their code inside Profile. [T-06]
- Add direct actions: **share athlete code · create position rooms · add athlete manually (if supported).** [T-06]
- Show empty position rooms even when they contain zero athletes. [T-06, T-04]
- Give a useful next action instead of a passive dead end. [T-06]

### Coach Voice
- The screen must let the coach **configure** it, not only explain the idea. [T-12]
- Add: **tone · accountability level · coach-approved phrases · prohibited phrases · response triggers · escalation behavior · scenario previews · too-soft / too-harsh feedback.** [T-12]
- Don't hard-code generic phrases and call the feature complete. [T-12]
- Clearly **label AI messages as AI**; the AI must not impersonate the coach. [T-12]
- The AI must not **create requirements, change deadlines, alter scores, or improvise medical guidance.** [T-12]

### School directory
- Real high schools and colleges. [T-11]
- Search by **school name, city, and state**; clearly distinguish schools with the same name. [T-11]
- Use **canonical school IDs**; connect the selected school to the correct coach/team. [T-11]
- **Validate coach codes**; do not show unrelated coaches merely because names match. [T-11]
- Add a **missing-school request / controlled fallback.** [T-11]
- Build the equivalent **gym/trainer directory** logic for non-athlete clients. [T-11]

### Global visual & interaction
- Premium spacing on every page; nothing overlaps at any mobile size. [T-14, T-09, T-20]
- Correct safe-area padding; bottom navigation never covers content. [T-23, T-09]
- Focused setup screens should not show distracting normal navigation. [T-21, T-09]
- Minimum usable touch-target sizes (≥44 px). [T-14]
- Correct back-navigation behavior. [T-21]
- Full loading / error / retry / empty / success / permission-denied states. [T-22]
- Preserve progress when the app is closed and reopened. [T-16, T-21]
- No dead buttons, no fake loading, no misleading labels, no internal engineering terminology. [GS-5, T-28]

---

## 6. Implementation phases (9)

- **Phase 0 — Correctness foundation (client), no migration:** T-01 (phase 0), T-08. *Gate:* seven-surface parity + boundary suites pass.
- **Phase 1 — First-run integrity:** T-15, T-16 (`0092`), T-02, T-05, T-13, T-20, T-21, T-22, T-27. *Gate:* required-journey walkthrough + release gate pass.
- **Phase 2 — Server authority:** T-01 (phase 2) (`0088`, `0090`). *Gate:* server↔client parity; zero historical rewrites; flagged rollout.
- **Phase 3 — Standard & Plan management:** T-17, T-18, T-04 (`0087`), T-24 (`0097`), T-25 (`0096`), T-26. *Gate:* inheritance/preview parity; hub data correct.
- **Phase 4 — People & access:** T-03 (`0093`), T-19, T-10 (`0098`), T-06. *Gate:* RLS matrix + owner-safety; code lifecycle.
- **Phase 5 — Notifications:** T-07 (`0089`, `0095`). *Gate:* idempotency + cancellation + timezone suites.
- **Phase 6 — Directory:** T-11 (`0091`). *Gate:* real-school find rate; dedupe.
- **Phase 7 — Coach Voice:** T-12 (`0094`). *Gate:* red-team guardrail suite.
- **Phase 8 — Polish & resilience:** T-14, T-09, T-23, T-28. *Gate:* a11y + anti-pattern + occlusion + copy-lint review.

Phases 3–8 may overlap where independent; **0 → 1 → 2 are sequential** (correctness before authority before dependent surfaces).

## 7. Database migrations (0087–0098)

| # | Migration | Purpose | Phase | Reversible |
|---|---|---|---|---|
| 0087 | `team_rooms` | first-class rooms (+ `staff_owner`, needs-assignment); backfill from positions | 3 | yes |
| 0088 | `profiles.timezone` | IANA tz → overdue in the athlete's local day | 0/2 | yes |
| 0089 | `team_notification_policy` | coach-set athlete-reminder defaults | 5 | yes |
| 0090 | `score-day` recompute (+ shadow cols) | server-authoritative scoring; history-safe | 2 | yes |
| 0091 | `directory_import` | real HS + college + trainer/gym; canonical `nces_id`/`ipeds_id`; name trigram + state index | 6 | yes |
| 0092 | `coach_setup_state` | persisted per-team setup state machine | 1 | yes |
| 0093 | `staff_invitations_v2` + `staff_audit_log` | named invite, scope, granular permissions, states, expiry, resend/revoke, audit, owner-safety, RLS | 4 | yes |
| 0094 | `coach_voice_config` | tone, accountability, approved/prohibited phrases, triggers, escalation, safety flags | 7 | yes |
| 0095 | `notification_dispatch` | idempotency keys, dedup, digest state, cancellation | 5 | yes |
| 0096 | `dietary_profiles` | athlete restrictions/allergens + coach/trainer read RLS | 3 | yes |
| 0097 | `trust_pass_policy` | per-team Trust Pass defaults over `0033/0039` | 3 | yes |
| 0098 | `join_code_guard` | athlete-code rate-limit + regen-confirm support (extends `0026/0080`) | 4 | yes |

**Preserved, not modified:** `0085` versioning (historical immutability, decision 17); `0033/0039` trust-pass engine; `0074` templates; `0077/0082/0083` staff-roles base; `0026/0080` code base; `0029/0041` score guards.

## 8. Data-model changes

- **New tables:** `team_rooms`, `coach_setup_state`, `staff_invitations_v2` + `staff_audit_log`, `coach_voice_config`, `notification_dispatch`, `dietary_profiles`, `trust_pass_policy`, `team_notification_policy`; temp `days.score_server`/`score_source` (dropped post-cutover).
- **New columns:** `profiles.timezone`; `orgs.nces_id`/`ipeds_id` + trainer/gym `type`; `requirement_sets.items` gains per-meal-proof / schedule-variation / weigh-cadence shapes (validated in `validate_requirement_items`).
- **Reused as-is:** `requirement_sets` (grace/latePolicy, 0086), `teams.join_code`, `staff_role`/`team_staff`, trust passes, templates, standard versioning.
- **Client:** shared `js/timing.js` + `js/thresholds.js` (single sources); `RT.coachSetup` migrates to the server-owned state machine (`0092`).

## 9. Permissions & security

- **Staff (T-03):** head-coach/team-admin write; granular per-category permissions; **owner-safety** (last head coach immutable); full audit log; RLS-scoped read. Replaces any broad-access code path (decision 5 / area 7).
- **Rooms (T-04):** head+coordinator write; RLS team-read.
- **Notification policy (T-07):** head+coordinator write; dispatch log server-only.
- **Server scoring (T-01):** `SECURITY DEFINER`, RLS-scoped; removes client trust from the score (net gain).
- **Dietary (T-25):** athlete write; team staff + trainer read; teammates blocked.
- **Coach Voice (T-12):** edge-function guardrails reject impersonation + requirement creation; AI labeling enforced.
- **Directory (T-11):** anon read only; no new PII; licensing reviewed.
- **Timezone (0088):** low-sensitivity; deadline math only.

## 10. Automated tests (consolidated)

Every ticket lists its own; the cross-cutting suites: **GS-1 CTA trace** (persist/reload/back/failure/success) for every CTA in every ticket; **timing boundary matrix** + cross-tz + no-reminder-after-completion + client==server parity + historical immutability (T-01); **RLS matrices** (staff, rooms, dietary, notification policy); **owner-safety** (T-03); **state-machine transitions** (T-16); **inheritance precedence** + preview==scored-day + weight-sum validation (T-17); **notification idempotency + cancellation + quiet-hours + timezone** (T-07); **directory search / dedupe / canonical-ID** (T-11); **Coach-Voice red-team** (T-12); **routing / back-stack / active-tab** (T-02, T-19, T-20, T-21); **universal-state render matrix** (T-22); **occlusion + touch-target + text-scale** (T-09, T-14, T-23); **release gate** (T-15).

## 11. Manual tests (consolidated)

Full coach post-onboarding walkthrough on a small-screen device with safe-area; two-timezone coach/athlete overdue + notification timing; reopen-mid-setup on a second device; required-then-optional checklist with amber + gated "ready"; staff invite → accept → revoke on two accounts incl. owner-safety + expiry; rooms created before athletes, then athletes join and auto-map; Team Standard build-with-variations + publish + verify athlete & history; notification policy set as coach, observed on athlete, completion cancels a reminder; find + disambiguate a real school; Coach Voice tone + scenario preview + guardrail probes; keyboard + large-text + no-occlusion sweep.

## 12. Dependencies

- **T-01 Phase 2** ⇐ Phase 0 + `0088`; preserves `0085`.
- **T-05 / T-13 / T-15** ⇐ **T-16** state machine (`0092`).
- **T-17 preview** ⇐ **T-01** parity; **T-17 coach-review** ↔ **T-12** review queue.
- **T-04** ⇐ `0087`; **T-18** reads rooms + `0085` + `0092`.
- **T-07** ⇐ `0089` + `0095` + **T-01** timezone.
- **T-11** ⇐ dataset + **licensing decision** (external; the free-text escape keeps onboarding usable until it lands).
- **T-25** ⇐ `0096`; **T-24** ⇐ `0097` over `0033/0039`.
- **Concurrent-committer caution** (project memory): land Phase 0 as one cohesive commit before broad refactors.

## 13. Rollback risks

- **Server scoring (High):** recompute could shift live scores → shadow-compute + compare + per-team flag + never rewrite history; instant rollback = client-authoritative (Phase 0 already correct).
- **Staff permissions migration (Medium):** a wrong RLS/owner-safety rule could lock out an owner or leak scope → owner-safety constraint + RLS matrix tests + flag; additive tables drop to revert.
- **Notification dispatch (Medium):** an idempotency bug could drop or double reminders → dispatch-log + cancellation tests + staged rollout.
- **Directory import (Low):** large seed, reversible by source tag; licensing is the external blocker.
- **Rooms / dietary / trust / voice / policy / timezone (Low):** additive schema behind flags; drop to revert.
- **Routing / restructure (Low):** one-line reversible; back-stack + tab tests guard regressions.
- **Amber urgency (Low):** visual only; constrained to required-incomplete to avoid alarm-fatigue.

## 14. Definition of done

**Product decisions (1–20 → ticket):** 1 T-15 · 2 T-16 · 3 T-07 · 4 T-03 · 5 T-03 · 6 T-04 · 7 T-04 · 8 T-06 · 9 T-05 · 10 T-05 · 11 T-05/T-16 · 12 T-10 · 13 T-01 · 14 T-01/0088 · 15 T-01/T-07 · 16 T-08 · 17 T-01/0085 · 18 T-12 · 19 T-11 · 20 T-09/T-20.

**Review-expansion areas (1–14 → ticket):** 1 T-15 · 2 T-16 · 3 T-17 · 4 T-18 · 5 T-12 · 6 T-07 · 7 T-03 · 8 T-04 · 9 T-19 · 10 T-10 · 11 T-11 · 12 T-20/T-21/T-22/T-09/T-23 · 13 T-24/T-25/T-26 · 14 GS-1 + every ticket's AC/Tests.

**A ticket is done when:** its acceptance criteria pass; every one of its CTAs passes the GS-1 five-state trace; its automated + manual tests pass; its migration (if any) is applied and reversible; its security gate is verified; and its decision/area is checked on a real device. **The plan is done when all 34 coverage items are green.**

---

*Plan only (v2.1). No application code, schema, migration, policy, or test was changed. **28 tickets · 2 P0 / 9 P1 / 14 P2 / 3 P3 · 9 phases · 12 migrations (0087–0098) · 34/34 coverage items · ~100 explicit corrections** (see §Correction register), each tagged to a ticket + DoD. Deduplicated from the two coach audits and the coach-experience review; grounded in the current proto code and `supabase/` (latest migration 0086). The requested `docs/coach-review/screenshots/` directory does not exist in the repo.*
