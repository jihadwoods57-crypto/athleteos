# OnStandard — Academics Module (Pillar #2) — Design Spec

*Author: Bo Woods · Date: 2026-07-05 · Status: Design spec (pre-plan)*

> Academics is the **second pillar** of the athlete execution platform (see
> [BUSINESS_MODEL.md](./BUSINESS_MODEL.md)). It reuses the existing accountability engine; it is
> **not** a second product. This spec covers the score math, data model, the honesty rules, the
> screen inventory, and the phased build sequence.

**The one line it must never cross:** OnStandard measures *academic execution*, it is **not** a
gradebook. We never integrate the LMS/SIS, pull official grades, or store education records. We
track the **behavior that produces the grade** — deadlines handled, classes attended, study done
— verified at checkpoints. This keeps it solo-buildable and out of the FERPA/procurement swamp.

---

## 1. Locked decisions (from the brainstorm)

1. **Score model — two pillars + composite.** Nutrition Score and Academic Score each stand alone
   as honest 0–100 numbers, always visible; a **Development Score** composite rolls up the
   *enabled* pillars. A nutrition-only account shows **no composite** (existing users unchanged).
2. **Honesty — checkpoint reconciliation.** Self-report drives the live stream (flagged
   *provisional*); an advisor/parent confirmation at checkpoints trues up the *verified* portion
   and can only correct the score **down** to reality. Mirrors Trust Pass: provisional credit,
   reconciled against a trusted anchor, never allowed to exceed reality.
3. **Engine — one pillar registry, not a second module.** Academics is one artifact parser + one
   pillar config on the existing engine.
4. **Non-negotiable — execution layer, not system of record.** Advisor dashboard shows execution
   + risk, **never GPA**.

---

## 2. The Academic Score (pillar composition)

Mirrors the shape of the nutrition sub-score (a dominant lever + a participation share + a weekly
touch). Weights are a **coach-owned config** (platform owns structure, coach owns targets — same
pattern as `scoringProfiles`); defaults below.

| Sub-metric | Default weight | Nutrition analog | Honesty rule |
|---|---|---|---|
| **Deliverables on time** — assignments/exams/papers handled by their deadline | 60 | Protein (dominant lever) | Self-reported → *provisional*; trued up at checkpoint |
| **Attendance** — showed up to class | 25 | Meals logged | Self-reported, labeled |
| **Weekly academic check-in** — reflect + set next week's deadlines | 15 | Recovery / check-in | Self-reported |

- **The evidence-rule analog:** a bare "I did it" toggle earns the *consistency* credit (you
  showed up to the app and claimed it) but the deliverable's **verified** value stays provisional
  until a checkpoint confirms it — exactly as a bare meal toggle counts as "logged" but yields
  zero macros without a photo.
- **Eligibility risk is derived SEPARATELY**, not baked into the score (just as weight sits
  outside `athleteScore`). Risk = f(missed/late deliverables in trailing window, upcoming exam
  density, engagement). Surfaced to stakeholders as 🟢 On Track / 🟡 Falling Behind / 🔴 Academic
  Risk.

### The composite (Development Score)

```
DevelopmentScore = Σ (pillarWeight_p · pillarScore_p) over ENABLED pillars, weights renormalized
  • 1 pillar enabled  → composite == that pillar (no fake blend shown)
  • 2+ enabled        → coach-weighted blend; each pillar ALSO shown standalone
```

Default pillar weights (2-pillar launch): Nutrition 50 / Academics 50; a coach may set e.g.
40/60. Never a flat average — always the configured weights.

---

## 3. Data model (parallels the meals shape)

New state (`src/core/types.ts`, seeded in `defaultState.ts`, persisted via a new migration):

- **`courses[]`** — `{ id, name, code, professor?, meetingTimes[], term }`
- **`commitments[]`** — `{ id, courseId, title, kind: 'assignment'|'exam'|'reading'|'paper'|'quiz'|'class', dueAt, status: 'pending'|'done'|'late'|'missed', source: 'self'|'verified', reportedAt? }`
- **`academicCommitment`** — the weekly one-tap (parallels `dailyCommitment`)
- **`academicHistory[]`** — daily/weekly Academic Score points for the trend (parallels
  `nutritionHistory` / `scoreHistory`)
- **`checkpoints[]`** — `{ id, at, by: advisorId|parentId, confirmedStanding, note? }` — the
  reconciliation anchor
- **Advisor link** — extend the existing linking system (athlete ↔ advisor) alongside
  athlete↔coach / client↔trainer

Pillar-enablement flag per account (`enabledPillars: ('nutrition'|'academics')[]`) drives whether
the composite renders.

---

## 4. Features & ingestion

- **Syllabus / schedule upload** — a new `analyze-syllabus` mode on the **existing vision edge
  function** (`supabase/functions/analyze-meal` pattern, or a sibling fn): PDF/photo → extract
  course + graded items + due dates → populate `courses[]` + `commitments[]`. One-time per course
  per term, so it's negligible AI COGS (~$0.02/mo amortized). Same daily cap / prompt-caching
  discipline.
- **Weekly academic loop** — the athlete confirms deliverables/attendance (self-report), the app
  surfaces the week's upcoming deadlines and prompts next-week planning. Daily nudge only when a
  deadline is imminent (academics is deadline-driven, not meal-by-meal).
- **Checkpoint reconciliation** — advisor/parent enters confirmed standing at a checkpoint;
  the engine trues up verified deliverables and re-anchors the score.
- **Eligibility risk flag** — fires through the **existing notifications + `send-push` edge fn**
  to coach + advisor + parent *before* ineligibility.

### The Advisor Assistant (the headline of the advisor surface)

The advisor should feel like they have an **assistant**, exactly like the coach's Assistant
Nutritionist and the Coach Copilot. It is a **third consumer of the existing `assist` engine**,
not a new engine — a roster-level briefing for a "coach of academics."

- **The brief** — every morning: *"I reviewed all 84 athletes. Three need you today…"* — opens
  with the names that matter, not a spreadsheet to scan.
- **Triage queue** ("handle these today") — the 🔴/🟡 athletes, each with **evidence** + a
  **one-tap pre-drafted outreach** to athlete/parent/coach the advisor edits and sends. Kills the
  repetitive intervention-writing burden.
- **Praise lane** — earned recognition to send, so the advisor isn't only ever bad news.
- **Checkpoint nudges** — *"these 5 are due for a grade-check — here's the request to send each
  instructor"* — turns the mid-semester professor-chasing scramble into a click (and IS the
  checkpoint-reconciliation capture).
- **Auto-logged** — every brief, nudge, and message is logged: the compliance paper-trail
  (NCAA / CYA) happens as a byproduct.

Reuses: [`assist`](../../supabase/functions/assist/index.ts) (new `advisor_brief` task +
`BRIEF_SYSTEM` variant), a deterministic `core/advisorBrief` (parallel to `assistantBrief`), and
the existing [AssistantBriefCard](../../src/screens/roles/AssistantBriefCard.tsx) + TriageQueue
surface. **Same honesty firewall:** narrates over app-computed *execution + risk* facts (never a
grade), model rephrases and never adds. **Premium entitlement** (like the Assistant Nutritionist)
— an Advisor Assistant seat is new expansion revenue on a college/HS account.

---

## 5. Screen inventory

| Surface | New / changed | Reuses |
|---|---|---|
| **Academics tab** (athlete) | New — upcoming deadlines, week's commitments, class schedule, weekly one-tap | [Nutrition.tsx](../../src/screens/athlete/Nutrition.tsx) |
| **Home** (athlete) | Changed — Development composite + Nutrition & Academics pillar rings; "What's in this score?" extends to pillars | [Home.tsx](../../src/screens/athlete/Home.tsx), [SCORE_WEIGHTS](../../src/core/scoring.ts) |
| **Onboarding** | New step — "upload your schedule" | [ScoreReveal.tsx](../../src/screens/onboarding/ScoreReveal.tsx), `onboarding/flows.ts` |
| **Advisor view** | New role view — the **Advisor Assistant** (brief + triage queue + one-tap outreach + checkpoint-confirm), execution + risk **not GPA** | [AssistantBriefCard.tsx](../../src/screens/roles/AssistantBriefCard.tsx) + TriageQueue, [CoachView.tsx](../../src/screens/roles/CoachView.tsx) |
| **Coach view** | Changed — eligibility column (🟢🟡🔴) on the roster | [CoachView.tsx](../../src/screens/roles/CoachView.tsx) |
| **Parent view** | Changed — "going to class / passing / on track" surfaces alongside nutrition | [ParentView.tsx](../../src/screens/roles/ParentView.tsx) |

---

## 6. Build sequence (each phase ships runnable)

1. **Engine — pillar registry + composite.** Refactor `scoring.ts` so pillars are data, add
   `academicScoring.ts`, implement the enabled-pillars composite (nutrition-only path byte-for-byte
   unchanged). Unit-test the composite and the single-pillar no-blend rule first.
2. **Data model + migration.** `courses`/`commitments`/`academicHistory`/`checkpoints`, advisor
   link, `enabledPillars`.
3. **Syllabus ingest.** `analyze-syllabus` mode + parser; populate commitments; onboarding upload.
4. **Athlete UI.** Academics tab + Home pillar rings/composite + score panel.
5. **Advisor Assistant** — `core/advisorBrief` (deterministic facts) + `advisor_brief` assist task
   + `BRIEF_SYSTEM` variant; render via the existing AssistantBriefCard + TriageQueue; eligibility
   risk flag via existing notifications/push. Gated behind a premium entitlement.
6. **Checkpoint reconciliation** flow + provisional/verified labeling + score true-up.
7. **Coach dashboard** eligibility column; parent surfaces.

---

## 7. Guardrails carried from the business model

- **Execution, not records** — no LMS/SIS integration, no GPA, no stored education records.
- **Honesty keystone** — provisional vs verified is always visible; the checkpoint can only
  correct *down* to reality; no fabricated academic number, ever.
- **Solo-buildable** — every layer reuses an existing one; academics adds a parser + a pillar
  config, not a second stack.
- **Pillar-agnostic from day one** — Training / Mental / Habits must drop into the same registry
  later with no engine rewrite.

---

*Living document. Revisit after the first club cohort runs the two-pillar loop, and again before
adding pillar #3.*
