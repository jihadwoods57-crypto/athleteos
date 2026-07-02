# Design: the `council` skill (for OnStandard)

**Date:** 2026-07-02
**Status:** Approved design — ready for implementation plan
**Author:** Bo Woods + Claude

## Purpose

A user-level Claude skill that convenes a multi-agent **council** to decide one hard
OnStandard call and end with a single decisive ruling — not a menu of options.

It generalizes the one-off `upgraded-visio-council` workflow (the run that produced the
locked PlaySmith editor-architecture decision) and points it at OnStandard. The proven
shape is preserved: **gather grounded evidence → personas stake positions → personas
cross-examine → a judge synthesizes one plan.**

## When it fires

Trigger phrases: "convene the council", "run the council on X", "/council",
"let the council decide", "council call on …".

The skill takes exactly **one** decision at a time. If handed several, it asks which one
to seat first (each decision gets its own council run + ruling doc).

## Scope

Built for OnStandard (the athlete-accountability Expo/RN app at
`c:\Users\Administrator\Downloads\athleteos`). It handles four decision types, and the
persona roster + evidence menu adapt to whichever apply:

- **Product & features** — what to build next, cut lines, roadmap sequencing, MVP vs later.
- **UX & design** — screen flows, redesigns, visual direction, onboarding.
- **Architecture & eng** — Expo/RN structure, backend/migrations, scoring-engine design,
  build-vs-buy, tech tradeoffs.
- **Accountability science** — scoring rules, habit/behavior model, coach–athlete dynamics.

## File layout

Lives at the user skills root so it is available across sessions and projects:

```
C:\Users\Administrator\.claude\skills\council\
  SKILL.md                     # the skill: trigger, the five moves, how to run it
  references\
    personas.md                # the persona bench + roster-selection rules
    workflow-template.md        # the parameterized council Workflow script (JS) + how to fill it
    ruling-doc-template.md      # the decision-doc shape written to the OnStandard repo
```

`SKILL.md` frontmatter:

- `name: council`
- `description:` written to trigger on the phrases above and on any request to make a
  hard OnStandard product/UX/architecture/accountability call by convening multiple
  expert perspectives and a judge. Names OnStandard and the repo path so it does not
  fire for unrelated projects.

## The flow (five moves)

`SKILL.md` instructs the agent to run these in order. Each is a checklist item.

### 1. Frame
Pin down the exact question, the real candidate options, and the decision type(s). Ask at
most one or two clarifying questions, then **state the question and options back to the
user before spending any agents.** Record: the question, the options, the decision
type(s), and the success criterion for the ruling.

### 2. Gather (parallel evidence agents)
Pick only the evidence that fits the question, from this menu:

- **OnStandard codebase** — read the relevant screens/`src`, scoring engine, Supabase
  migrations, and `docs/` (e.g. `PRODUCT-CONSTITUTION.md`, `FOUNDER-DECISIONS.md`,
  relevant specs). Grounds the debate in what exists today.
- **Live app walkthrough** — screenshot/click the running app (web preview, e.g. the
  `:8082`-style Expo web build, or Playwright) so the council sees real UX, not just code.
- **Competitor / reference study** — study competitor apps or reference material
  (videos/screenshots) the way the Visio council studied tutorials.

A pure-strategy call may gather little; a UX call should walk the app. If the skill
bounds coverage (e.g. reads only N files, samples screens), it **says so** in the
briefing — no silent truncation.

Each gatherer returns a structured digest. The digests are concatenated into a shared
**briefing** handed to every persona.

### 3. Debate R1 — positions
Each persona, in its own voice and lens, returns: thesis, must-haves (prioritized, with
why), the architecture/approach call it favors, what to cut or defer, and where it
expects to clash with the others.

### 4. Debate R2 — cross-examination
Each persona reads **all** R1 positions and returns: concessions (where it was moved),
hold-firm (sharpened), and a concrete synthesis offer. Real engagement, no restating.

### 5. Judge — synthesize
A head-of-product agent reads the briefing + R1 + R2 and makes the calls: the vision, the
**decision** (with the reasoning that won and any migration-from-today note), feature
priorities (each with why + which evidence motivates it), a sequenced phase plan, a hard
cut list, 2–4 open questions that genuinely need the founder, and the single best next
step.

## Persona bench (adapts per decision type)

Defined in `references/personas.md`. Two **standing** seats on every council:

- **Athlete end-user** — a real accountability-app user. Bar: does this earn reps and
  trust, or is it gold-plating?
- **Product strategist / moat-keeper** — guards sequencing and differentiation; decides
  MVP vs later; cuts ruthlessly.

Specialists added by decision type:

| Decision type | Added personas |
|---|---|
| Product & features | *(covered by the two standing seats)* |
| UX & design | UX/design architect (impeccable-flavored) + Coach/trainer end-user |
| Architecture & eng | Expo/RN + Supabase architect (mobile perf, migrations, build-vs-buy) |
| Accountability science | Behavior/habit-science expert + Coach/trainer end-user |

Rules: judge is always the **head of product**. Roster is capped at **3–5 personas** total
so the debate stays sharp; if multiple decision types apply, pick the most relevant
specialists rather than seating everyone. A monetization/Stripe seat is available but only
added when the call touches pricing/checkout.

## Engine

Evidence gathering happens **before** the Workflow, in the Frame/Gather moves, done by the
orchestrating agent with its real tools (Read/Bash/Playwright/MCP) and passed into the
Workflow as a static briefing string. This deviates deliberately from the
`upgraded-visio-council` shape (which gathered inside the workflow): OnStandard's live-app
walkthrough relies on the Playwright/browser MCP, which the Workflow runtime warns "may be
absent in headless/cron runs" — so gathering must stay with the parent agent, and keeping
the Workflow gather-free also makes it deterministic and cheaper.

The skill then authors and runs a **Workflow script** built from
`references/workflow-template.md`, parameterized by the framed question, the gathered
briefing, and the chosen persona roster. The Workflow is pure deliberation:

- `phase('Debate R1')` → `parallel(...)` personas, `POSITION_SCHEMA`.
- `phase('Debate R2')` → `parallel(...)` personas, `REBUTTAL_SCHEMA`.
- `phase('Synthesize')` → single judge agent, `PLAN_SCHEMA`.
- Returns `{ evidence, r1, r2, plan }`.

Invoking the skill is itself the Workflow opt-in. The template uses structured-output
schemas so personas return data, not prose, and the judge's plan is machine-shaped for the
ruling doc.

## Output (two artifacts)

1. **Ruling doc** → written to the OnStandard repo at
   `docs/council/YYYY-MM-DD-<slug>.md`, following `references/ruling-doc-template.md`:
   the question, who sat on the council, the evidence gathered, the decision, feature
   priorities, phase plan, cut list, open questions, and next step. Committed to the
   OnStandard repo.
2. **Locked-decision memory** → a memory entry (type `project`) so the ruling sticks
   across sessions, summarizing the call and linking the ruling doc. Written to the active
   project's memory store; the entry names OnStandard explicitly.

After both are written, the agent reports the decision and the single best next step in
chat.

## Edge cases

- **No clear options given** → Frame step surfaces candidate options first; do not seat a
  council on a vague question.
- **Evidence source unavailable** (app won't boot for a walkthrough, no competitor
  material) → note the gap in the briefing and proceed with the evidence that exists;
  never fabricate what an agent could not observe.
- **Personas deadlock** → the judge still makes a call and records the dissent under open
  questions; a council always ends in a decision.
- **Multiple decisions requested** → seat one, produce its ruling, then offer to seat the
  next.
- **Wrong project** → the description is scoped to OnStandard; if invoked against an
  unrelated repo, the Frame step confirms scope before spending agents.

## Verification

The skill is "done" when:

1. `SKILL.md` + the three reference files exist and the frontmatter description triggers
   on the phrases above (and does not over-trigger on unrelated work).
2. A dry run on a real, small OnStandard call (e.g. a single feature-cut question)
   produces: a framed question echoed back, a briefing, R1/R2 persona output, a judge
   ruling, a committed ruling doc under `docs/council/`, and a locked-decision memory.
3. The produced workflow script parses and runs (fan-out gather → personas → judge) with
   no schema errors, mirroring the structure of `upgraded-visio-council`.

## Out of scope (cut list)

- No standing/scheduled councils — it is invoked per decision.
- No live/mid-session use during a workout; it is a deliberation tool.
- Not wired to PlaySmith or other projects; OnStandard only for v1.
- No persona-count autoscaling beyond the 3–5 cap.
