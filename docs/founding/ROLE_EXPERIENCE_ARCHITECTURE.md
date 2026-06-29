# ROLE_EXPERIENCE_ARCHITECTURE — one platform, many morning briefings (board altitude)

> **Status:** FOUNDING DEEP-DIVE. Elevates and integrates the role/IA canon already on the record;
> it does not override or re-derive it. Sources: `PRODUCT-CONSTITUTION.md` §6/§12 + Rule #7 (the IA),
> `00_STRATEGIC_QUESTIONS` §13/§19-#4/§20 (the signature + Needs-Attention flagship), `05_SYNTHESIS`
> SD-4/SD-5 + §A (the wedge), `02-roles-permissions-security` §3 (the 12-role matrix), `04-accountability-
> communication` §3 (the daily loop + escalation), `GYM_STRATEGY` (gym BI), `AI_STRATEGY`.
> **Two ratified locks this doc honors that the source prompt violated:** the in-product number is the
> **Execution Score** (SD-5), not "Development Score"; and roles ship in **wedge order** (SD-1), not all
> at once. The honest headline below: **the app already embodies ~80% of this vision.**

## A. The one IA standard every role obeys (already canon)

The prompt's core idea — "every role opens to a morning briefing that answers *what should I do next*,
with only ~5 top-level destinations" — is not new. It is the ratified product. Stated once, applied to all:

1. **Morning Briefing, not a browse screen.** Every role's Home opens with the day's state, what needs
   attention, the single highest-value action, and what can wait. This is the **Daily Game Plan**
   (SD-4, the non-deferrable signature) generalized: the athlete's is "how do I win today," the coach's
   is "who needs me today." *Constitution §3, `00` §20.*
2. **One number, not four.** Every role reads the **same platform-owned Execution Score** (no per-role
   number, no re-weighting; keystone D3). The coach sees roll-ups of it; the gym sees roll-ups of those.
3. **Five destinations max:** One Home (briefing) · One Work area · One Action/Comms · One Insights ·
   One Profile/Admin. *Constitution §6.* Drill-downs are fine; top-level stays flat.
4. **Action over information. Every screen answers "what do I do next?"** *Constitution §12, Rule #7.*

If a proposed screen or widget does not help *today's* decision for that role, it does not belong on the
briefing. It goes a drill-down deeper, or nowhere.

## B. The role ladder (ship in wedge order, not all at once)

The prompt specs seven role operating systems as equals. The ratified wedge (SD-1, RT-4) sequences them.
Building all seven now is the breadth-before-depth trap the founding set exists to prevent.

| Role | Wedge stage | Today's state | What this doc specs |
|---|---|---|---|
| **Athlete** | MVP (the daily user) | **~90% built** | Confirm + small polish |
| **Coach** (HS / sports-perf) | MVP (primary buyer) | **~80% built** | Formalize IA + a real Reports area |
| **Parent** | MVP (viewer/consent, not a buyer) | Built, read-only | Keep minimal; it's a viewer, not an OS |
| **Trainer** (personal) | Wedge-adjacent | Built (TrainerView) | Lens polish |
| **Nutritionist** | V1 | Maps to TrainerView; **Meal Review absent** | Spec the signature Meal Review (build at V1) |
| **Gym Owner** | Post-PMF (per `GYM_STRATEGY`) | Uses the coach roll-up | Spec the Business Dashboard; **do not build until PMF** |
| **Athletic Director** | V2 | Not built | Spec the Department view; defer |

## C. Per-role specs (wedge roles deep, deferred roles stubbed)

### Athlete — MVP — ~90% built
- **Goal:** execute today's plan. **Briefing (Home, exists):** Execution Score hero + week delta;
  Finish-Today projection (score now → reachable today) with the action list; Today's Progress
  (protein/hydration/tasks/recovery); "Your Next Move" (highest-impact action); coach guidance card;
  weekly check-in banner. *(Home.tsx already renders all of this.)*
- **Nav (5):** Home · Log (camera FAB) · Nutrition · Progress · Profile. *(Today: Home/Nutrition/Plan/
  Squad + camera. Gap: "Squad" is community; a true "Progress" insights destination is split across
  Home-trend + Performance. Minor refinement, not a rebuild.)*
- **AI:** meal vision + grounding, label scan, Nutrition Memory, Restaurant Coach (all built, `AI_STRATEGY`).
- **Status:** essentially done. Do-now = none beyond the onboarding lean pass already shipped.

### Coach — MVP — ~80% built
- **Goal:** know exactly who needs coaching today without searching. **Briefing (exists):** team KPIs
  (avg Execution Score, compliance %, alert count); This-Week headline (week-over-week, best mover, most
  at-risk); **Needs-Attention roster** ranked by risk with one-tap nudge (flagship #4, `attention.ts`).
- **Nav (5, the gap):** Dashboard · Roster · Needs Attention · Reports · Profile. *Today it is ONE
  scrolling dashboard + overlays; "Reports" is a single share button, not an area.* The content largely
  exists (roster filters by position/search/not-logged; PersonDetail; CoachGoalsEditor; Messages); the
  **opportunity is to formalize it into named destinations and a real Reports area** (weekly/position/
  compliance), not to build new intelligence.
- **AI:** Needs-Attention is a **deterministic** risk rank today (`AI_STRATEGY`: a learned predictor stays
  unbuilt until the Proof pillar has outcome data). Coach Copilot (drafted outreach) is designed, not built.
- **Do-now (small):** name the destinations; add a Reports drill-down over the data already computed.

### Parent — MVP — viewer, keep minimal
- Built read-only (score, weekly compliance, weight + nutrition trends, weekly digest, coach note). This
  is correct: parent is a *viewer/consent* role, not a buyer (the wedge defers parent-as-buyer). Do **not**
  expand it into a full OS; resist feature pressure here.

### Trainer (personal) — wedge-adjacent — built
- TrainerView: client KPIs, 8-week compliance trend, Needs-Follow-Up list, same overlays as coach,
  multi-org book (not a team). Lens-aware copy. Fine as-is for now.

### Nutritionist — V1 — the one real signature GAP
- Today routes to TrainerView with "Nutrition clients" copy; **there is no Meal Review workflow.**
- **Spec (build at V1):** a **Meal Review** destination — the AI's first-pass analysis queue, nutritionist
  reviews exceptions: meal photo + AI macros + **confidence score** (already produced by `macroGrounding`)
  + actions **Approve / Correct / Comment / Teach / Escalate**. "Teach" saves a corrected gold-standard the
  grounding can learn from. This is genuinely additive and the prompt's strongest new idea. **Gate it to V1**
  (after the coach wedge retains), and keep the number rule: the nutritionist edits the *plan/macros*, never
  the *formula* (D3).

### Gym Owner — post-PMF — Business Dashboard (defer the build)
- **Briefing (spec):** member retention, members at cancellation risk, nutrition engagement, challenge
  participation, trainer performance, new signups. **Nav (5):** Business Dashboard · Challenges · Members ·
  Analytics · Settings. Per `GYM_STRATEGY` §F, the **Member Risk Score IS the Execution Score trend, not a
  second number**, and the whole BI layer is **post-PMF behind RT-9 guardrails**, gated on the unproven
  "nutrition adherence predicts churn" hypothesis. Today the gym owner uses the coach org roll-up. **Do not
  build the BI dashboard until a real gym pays for the retention story.**

### Athletic Director — V2 — defer
- **Spec (stub):** Department briefing (every program's Execution-Score compliance at a glance, team
  comparisons, staff performance, risk). Needs cross-program comparability (the platform-default weight set,
  `Scenario 10` open GAP) and FERPA. Correctly a V2 pull, not a launch build.

## D. Product audit (the existing app, honestly)

What the prompt asked for, grounded in the real screens (not aspiration):

- **Missing workflows:** the **nutritionist Meal Review** (the one worth building, at V1). The gym Business
  Dashboard and AD Department view are "missing" only in the sense of correctly-deferred.
- **Missing dashboards:** gym owner, AD. Both deferred by the wedge, not oversights.
- **Missing AI / automation:** Coach Copilot (drafted interventions), the Meal Review teach-back loop, and
  Organization Intelligence (cross-org risk/learning) — all **designed, deterministic-first, deferred** per
  `AI_STRATEGY`. Do not invent org-learning before there is outcome data.
- **Workflow bottlenecks:** the **coach dashboard is one long scroll + overlays** with no named destinations
  and no Reports area (reports = a share button). This is the single highest-value IA cleanup.
- **Redundant / merge / remove — the honest finding:** there is **very little to cut.** The audit found the
  overlays (MealDetail vs MealHistory, Plans vs CoachPlanEditor, FoodCoach vs NutritionMemory vs Capture)
  are each justified by a distinct use. The app is **not bloated**; resist the reflex to "simplify by
  removal" when there is nothing redundant. The cleanup is *structural* (name the coach destinations), not
  *subtractive*.
- **Reduce clicks — already good:** log a meal = 1 tap (FAB), check-in = 1 tap, nudge an at-risk athlete =
  1 tap, athlete detail = 2 taps. No fix needed.
- **One real open question** the IA depends on (from the canon): when an athlete belongs to multiple orgs,
  **whose plan drives the Game Plan?** (the primary-membership rule, `Scenario 12`). Decide before multi-org.
- **Indispensability:** it already comes from the two morning briefings that exist (athlete "win today,"
  coach "who needs me"). The lever is to make the coach briefing a true 5-destination workspace, not to add
  surfaces.

## E. The honest conclusion

You did not need an IA redesign. You built the app on this exact principle, so the athlete morning briefing
and the coach 3-second triage already exist. The valuable, *small* do-now list:

1. **Formalize the coach IA** into the five named destinations + a real Reports area over data already computed.
2. **(Optional) align athlete tab names** toward the pillars (a "Progress" insights destination).
3. **Hold the line on the deferred roles** (nutritionist Meal Review at V1; gym BI post-PMF; AD at V2) and
   **resist building all seven now** — that is the wedge discipline working.

Everything else the prompt asks for is either already shipped or correctly waiting for its wedge stage.

---

**Deference footer.** IA + signature: `PRODUCT-CONSTITUTION` §6/§12, `00` §20, `05` SD-4. Roles + permissions:
`02` §3. Needs-Attention: `00` §19-#4, `04` §3, `attention.ts`. Wedge order: `00` §6, `05` §A, SD-1.
Score naming: `05` SD-5 (Execution Score in-product). Gym BI: `GYM_STRATEGY`. AI: `AI_STRATEGY`. Keystone D3
(one platform-owned formula) governs every role: nobody re-weights the number.
