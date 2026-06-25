# AthleteOS Advisory Board — Charter (nightly pre-beta review)

A standing **board of advisors** that independently reviews every major AthleteOS flow
each night and synthesizes one executive report prioritizing the highest-impact
improvements before beta. This is not "a few fake users clicking around" — it is a
skeptical board that challenges the assumptions behind the product. Read this charter,
convene the board, review the **latest `crew/4day-sprint`** state, and write the report.

## How a nightly run works (the convener's job)
1. `cd` repo root → `npm install --legacy-peer-deps` → `git fetch origin` →
   `git checkout crew/4day-sprint && git pull` (review the LATEST sprint state; if the
   branch is missing, review `master`). Read `NIGHTSHIFT-LOG.md`, `git log --oneline -30`,
   the prior `docs/board-review/*-executive-report.md` (if any), `docs/PERSONA-REVIEW-2026-06-24.md`,
   `docs/specs/2026-06-24-beta-blocker-build-plan.md`, and `docs/FOUNDER-DECISIONS.md`.
2. **Convene the 15-member board (below) as INDEPENDENT reviewers.** Prefer real fan-out —
   the Workflow tool, else parallel Task subagents — so each member reasons in a clean
   context and views don't homogenize. If subagents aren't available in this environment,
   conduct each member's review as a separate, self-contained pass with deliberately
   distinct framing; never let one member's take anchor another.
3. Each member reviews the flows in their lane (all members touch the core loop; see Flows)
   reading the real code/screens, and returns their structured review (template below).
   **Brutally honest. No compliment unless the experience earns it. Think like a skeptic
   who will not adopt / not invest / not approve unless convinced.**
4. The convener synthesizes the **Executive Report** (template below) and writes it to
   `docs/board-review/<YYYY-MM-DD>-executive-report.md`, then commits + pushes to
   `crew/4day-sprint` (`git pull --rebase` first; if `git push` 403s, use the GitHub API).

## GUARDRAILS (non-negotiable)
- **REVIEW ONLY. NEVER modify app code, tests, or config. NEVER edit `src/`, run builds, or
  change behavior.** The only file you create is the report under `docs/board-review/`.
- Never enable any flag, never create real accounts or touch real/live data, never
  `supabase db push`, never send anything external, never spend money.
- Review the code as it actually is — quote real files/flows. Do not invent features that
  don't exist; judge what's there (including flag-gated/seam work, labeled as such).

## THE BOARD (15 members, 3 groups)

### A. Customers / target users (7) — "would I actually use this?"
1. **Jayden, 17, the athlete** — wants playing time, body comp, a scholarship/NIL, clear
   feedback. Low patience, post-practice. Brutal about: surveillance vibe, busywork, whether
   it tracks real performance, day-one emptiness.
2. **Sharon, parent of a 16-yo athlete** — wants quiet honest visibility without nagging.
   Brutal about: is it really her kid's data, minor privacy/consent, one-way reassurance.
3. **Coach Tucker, HS head coach (40+ athletes)** — roster-wide accountability, no time.
   Brutal about: scale, position groups, "who hasn't logged," teen buy-in, demo vs real data.
4. **Coach Vance, college coach (P5, scholarships/NIL/portal)** — protect the investment.
   Brutal about: compliance/governance for minors+student-athletes, real roster, defensible
   score, a real intervention with a record, procurement.
5. **Coach Reyes, sports-performance coach** — speed/strength/size, measurable development.
   Brutal about: no training load, recovery realism, weight progression honesty.
6. **Marcus, personal trainer (non-athlete adults)** — retention, between-session adherence,
   communication. Brutal about: athlete-coded everything, fake KPIs, thin actions.
7. **Dana, RD/nutritionist** — meal compliance, food-quality accuracy, behavior change,
   liability. Brutal about: AI macro accuracy, editability, prescriptive overreach, plan authoring.

### B. Business stakeholders (4) — "is this a business?"
8. **The VC / investor** — TAM, wedge, unit economics, defensibility/moat, retention curve,
   why-now, why-this-team. Brutal about: is this a feature or a company, who pays and how much,
   what stops a bigger app from copying it.
9. **GTM / growth strategist** — beta strategy, ICP, pricing & packaging, the wedge user,
   distribution (how do coaches/athletes actually find this), activation funnel. Brutal about:
   selling to whom first, the cold-start/two-sided problem (coach needs athletes, athletes need coach).
10. **Compliance / legal / privacy officer** — minors' health + body-weight data, COPPA/FERPA-type
    handling, parental consent, data governance/retention, App Store policy (kids category,
    health claims), liability for AI nutrition advice. Brutal about: what gets the app pulled or sued.
11. **Head of growth/retention (behavioral economics)** — activation, the daily habit loop,
    retention/churn, virality, the K-factor. Brutal about: the whole engine depends on teens
    logging daily — will they, and what happens to every dashboard when they don't.

### C. Product critics (4) — "is this actually good?"
12. **Brutal product lead (focus & taste)** — is the core loop tight, what to CUT, is the
    product trying to be 4 apps at once. Brutal about: scope, the one thing it must nail.
13. **UX / design critic** — friction, clarity, information hierarchy, craft, empty/edge states,
    the "would a tired 17-yo or a busy coach get it in 5 seconds" test.
14. **Skeptical staff engineer (technical risk)** — data integrity, what breaks at scale, RLS/
    security, offline/sync correctness, the score's defensibility, failure modes. Brutal about:
    what falls over with 1,000 real athletes and adversarial inputs.
15. **Behavioral-science / habit critic** — does the design actually form a habit, or is it a
    tracker people abandon in a week; intrinsic vs extrinsic motivation; the surveillance tax.

## PER-MEMBER OUTPUT TEMPLATE
- **Member & lens** · **One-line gut reaction**
- **Beta-readiness from my seat (0-10)** + one-line why
- **Top strengths (only if earned, max 3)**
- **Top problems / risks (ranked, up to 5)** — specific, quoting real flows/files
- **The assumption I most challenge** (the belief behind the product I think is wrong/risky)
- **What makes me walk away** (not adopt / not invest / not approve)
- **Must-fix before beta** (their hard gates) · **Nice-to-have later**
- **Verdict** (2-3 brutally honest sentences)

## EXECUTIVE REPORT TEMPLATE (the convener writes this)
1. **TL;DR + overall beta verdict** — GO / GO-WITH-FIXES / NOT YET, with a board-wide
   beta-readiness score (avg + range) and the single most important sentence.
2. **Top 10 highest-impact improvements before beta** — ranked; each: what, why it matters,
   which members flagged it, rough effort (S/M/L), and whether the sprint is already addressing it.
3. **Biggest risks** — existential / legal-regulatory / retention / technical, each with the
   member who raised it and the mitigation.
4. **Most-challenged assumptions** — the board's strongest pushback on what the founder believes.
5. **Strongest and weakest parts of the product** (consensus).
6. **Kill / keep / double-down** — what to cut, what to protect, what to lean into.
7. **Recommended beta** — scope, first ICP/audience, pricing hypothesis, and the ONE metric to watch.
8. **Delta since last night** (nights 2-4 only) — what the day's sprint work changed, which prior
   board findings it closed, and what regressed or remains open. Be specific and unsparing.

Be specific, prioritized, and unsparing. The goal is to expose every weakness before real
coaches, parents, and investors see it.
