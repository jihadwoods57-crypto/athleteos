# Fable 5 Orchestrator — Design

**Date:** 2026-07-11
**Status:** Approved design → ready for implementation plan
**Author:** Fable 5 brainstorming session (Jihad Woods + Claude)

## One-sentence pitch

`fable5` is an invokable Skill that hands your vision to a five-phase, real-agent
build pipeline — **Audit → Design → Plan → Build → QA** — with the right model on
each job, a persistent Project Memory that compounds every sprint, and a
branch-only safety model so nothing reaches master until you merge it.

It is the first-class, on-demand sibling of `crew-forge`: crew-forge improves the
whole app while you sleep; **Fable 5 drives *your* vision through five specialized
phases while you stay in the loop at the ends.**

## The trust model (inherited from crew-forge)

The orchestrator's **opinion** decides *what to build*; each phase's **structured
output** is the contract to the next; the repo's **verify command** decides whether
the build stands; **you** decide whether it merges to master. QA findings are
**adversarially refuted** before they count — an LLM never grades an LLM's work
unrefuted.

## Architecture

A **Skill** (`~/.claude/skills/fable5/SKILL.md`) is the front door. It preflights the
repo and launches a **Workflow script** (`~/.claude/workflows/fable5.js`) — the same
Skill-launches-Workflow pattern proven in crew-forge. The Workflow script *is* the
Fable 5 orchestrator (`claude-fable-5`): it holds Project Memory, sequences the
phases, passes each schema-validated output to the next, and writes the report.

```
YOU ──vision+scope──▶ fable5 Skill ──preflight──▶ Workflow (Fable 5 orchestrator)
                                                        │ holds .fable5/memory.md
   ┌────────────────────────────────────────────────────┘
   ▼
 1 Audit ─▶ 2 Design ─▶ 3 Plan ─▶ 4 Build ─▶ verify-gate ─▶ 5 QA(+refute) ─▶ report+memory
   (Opus)    (Opus)      (Opus)    (Sonnet)                   (Opus)
        ▲__________one bounded kickback per seam (U2)__________▲
```

### Input

```js
Workflow({ name: 'fable5', args: { vision: "meal-streak leaderboard", scope: "feature" } })
```

- `vision` (string, required) — what you want, in your words.
- `scope` (`"feature"` | `"app"`, default `"feature"`).

## The five phases

Each phase is a **real sub-agent** with its own model and fresh context. Phases
communicate only through **schema-validated objects** (never parsed prose) held by
the orchestrator in Project Memory.

| # | Phase | Model | Reads | Produces (schema) |
|---|-------|-------|-------|-------------------|
| 1 | Product Audit | Opus 4.8 | vision + `memory.md` + repo | `AuditReport`: gaps, UX issues, opportunities, `buildTarget`, `worthBuilding` |
| 2 | UX/UI Design | Opus 4.8 | AuditReport | `DesignSpec`: screens, flows, states (empty/loading/error), `touchesUI` |
| 3 | Engineering Plan | Opus 4.8 | DesignSpec | `EngPlan`: files, data changes, APIs, migrations, risks, `designFeasible` |
| 4 | Build & Implement | **Sonnet 5** | EngPlan | `BuildSummary`: commits, files touched, gate result |
| 5 | QA / Audit & Security | Opus 4.8 | the branch diff | `BugList`: findings, each severity-graded + `refuted` verdict |

### Phase details & upgrades folded in

**U5 — Scope-scaled Audit.** `scope:"feature"` runs one focused Opus audit.
`scope:"app"` fans out crew-forge-style **parallel lenses** (retention, monetization,
UX, tech-debt), synthesized into one `AuditReport`.

**U6 — Early exit.** If the Audit returns `worthBuilding: false`, the orchestrator
stops, writes a short report explaining why, and does **not** manufacture work.

**U3 — Phases load domain skills.** Design loads `impeccable`/`frontend-design`.
Build inherits repo conventions and any relevant domain skill (e.g. `football-mind`,
`live-pipeline-architecture`) selected by config/heuristic. QA loads the matching
domain skill. Skill assignments are overridable in `.fable5/config.json`.

**U4 — Design emits a clickable prototype.** When `DesignSpec.touchesUI` is true, the
Design phase publishes a real **Artifact** mockup and links it in the report — you
catch "that's not what I meant" at phase 2, not phase 5.

**U2 — One bounded kickback per seam.** A phase may reject the previous phase's output
**once**: if `EngPlan.designFeasible` is false, Design redoes the spec before Build
starts; if Build can't implement the plan, Plan revises once. Capped at one kickback
per seam so it can never loop indefinitely.

**Verify-gate.** After Build, run the repo's verify command (`npm run verify` if
present, else from `.fable5/config.json`) so QA audits a *building* diff. On failure,
Build gets **one repair pass**; QA then runs regardless and flags the red gate loudly.

**U1 — Adversarial QA.** Every QA finding gets a short **refute pass** (a skeptic
agent prompted to prove the finding wrong, defaulting to refuted-if-uncertain) before
it enters the `BugList`. Only surviving findings ship in the report.

## Project Memory — `.fable5/` (mirrors `.crew/`)

- `memory.md` — the living brain, read by every Audit and updated after every QA:
  **Product Vision · Features shipped · Decisions (with rationale) · Tech Debt ·
  Open Bugs · Roadmap · Launch Checklist.** This is what makes sprints compound —
  run N+1 builds on run N's settled decisions instead of re-litigating them.
- `reports/<date>-<slug>.md` — the per-run report (see Deliverables).
- `config.json` — optional overrides: model per phase, default scope, verify command,
  domain-skill assignments per phase.

On first run the Skill **scaffolds `.fable5/`** (seeding `memory.md` from the repo's
existing vision docs where possible) so there is no manual setup.

## Safety rails

- Build works on a **`fable5/<date>-<slug>` branch**, **tagged** each run, and is
  **NEVER merged to master** — integration is your call (`git merge` or
  `git reset --hard <tag>` to discard).
- **Never** applies live DB migrations, deploys/ships, touches secrets, or weakens a
  test/RLS to pass. Those become **founder-gated proposals** in the report.
- Preflight refuses to run on a dirty tree or off the fable5 branch.

## Front door — the `fable5` Skill

- **Triggers:** `/fable5`, "Fable 5, build/audit/ship X", "run the orchestrator."
- **Preflight:** clean tree? `.fable5/` exists (else scaffold)? cut/checkout the
  `fable5/<date>-<slug>` branch? Then launch the Workflow in the background and notify
  on completion.

## Deliverables (after a run)

- A `fable5/<date>-<slug>` **branch + git tag** with the built feature.
- **(U4)** a clickable **Artifact mockup** when UI is involved, linked in the report.
- `.fable5/reports/<date>-<slug>.md` — the morning-after report:
  *what the Audit decided · the design · the plan · what got built · the
  **refute-verified** bug/fix list · founder-gated proposals · **tokens-per-phase***
  (so the graphic's "lower cost" claim is measurable).
- Updated `.fable5/memory.md`.
- **You** review branch + report, then merge or discard.

## Reusing on another repo

Drop a `.fable5/` folder into any repo, start a `fable5/*` branch, invoke from inside
it. The engine (`~/.claude/workflows/fable5.js`) is repo-agnostic; per-repo taste
lives in `.fable5/config.json` + `memory.md`.

## What this is NOT (scope guards / YAGNI)

- Not autonomous/overnight — that's `crew-forge`. Fable 5 is you-launched, one run.
- Not a hard-stop-between-phases wizard — it runs straight through; you review at the
  ends (design prototype at phase 2, everything at the end).
- Not a merger — it never touches master.
- Not a single-thread role-play — every phase is a real, model-specialized sub-agent.

## Open implementation notes (for the plan)

- Schemas for `AuditReport`, `DesignSpec`, `EngPlan`, `BuildSummary`, `BugList`.
- Kickback state machine (one per seam) inside the Workflow control flow.
- How Build isolates parallel file writes (worktree isolation is unnecessary here —
  phases are sequential, single build agent — but note it if the plan adds parallelism).
- Token accounting via `budget.spent()` deltas per phase for the cost table.
- Skill preflight scaffolding of `.fable5/` incl. seeding `memory.md` from repo docs.
