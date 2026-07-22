# Fable 5 — Foreman Upgrade — Design

**Date:** 2026-07-22
**Status:** Approved design → ready for implementation plan
**Author:** Fable 5 upgrade brainstorming session (Jihad Woods + Claude)
**Supersedes-in-part:** `docs/superpowers/specs/2026-07-11-fable5-orchestrator-design.md` (this doc only changes phase sequencing + staffing; the five-phase toolkit, Project Memory, and safety model it describes are unchanged and still apply)

## One-sentence pitch

Give Fable 5 a **Foreman** — a first sub-agent call that reads the vision and decides,
per run, which of the five phases are actually needed and which curated specialist
persona staffs each one — so a one-line fix and a whole new feature no longer run
through the identical assembly line.

## Problem

`tools/fable5/fable5.js` today is a straight-line script: Bootstrap → Audit → Design →
Plan → Build → Verify → QA → Report, unconditionally, every run. The only existing
variance is the `scope` arg (`feature` vs `app`, which only changes Audit's fan-out) and
the `touchesUI` flag (which only gates the Design-phase prototype). Every vision — a
typo fix, a security hardening pass, a brand-new feature — gets audited, designed,
planned, built, and QA'd by the same generic, un-specialized agents in the same fixed
order. That sameness is the "one outcome" feeling: the pipeline shape and the voice
doing each phase never adapt to what was actually asked for.

## What's changing

1. A new **Staffing** phase (the Foreman) runs immediately after Bootstrap and before
   Audit.
2. The Foreman's output — a `RunPlan` — replaces the hardcoded phase sequence: which
   phases run, in what order, who staffs each one, and how deep each goes.
3. The engine's control flow changes from a linear script to a loop that executes
   whatever `RunPlan.phases` says, so phases can be skipped (no Design/Plan for a
   trivial fix) or a run can stop early on purpose (an audit-only ask never reaches
   Build).
4. A curated **persona library** (~6-8 specialists) gives the Foreman something real to
   staff phases with, instead of every phase always being a generic auditor/designer/
   builder/QA agent.

Everything else about Fable 5 — Project Memory (`.fable5/memory.md`), the branch-only
safety model, the one-kickback-per-seam rule, the verify-gate, and adversarial QA
refutation — is unchanged and composes with this.

## The Foreman phase

**Model:** Opus 4.8, high effort (same as Audit today).
**Runs:** once, right after Bootstrap, before anything else.
**Reads:** the vision (founder's words), the optional `scope` hint, `.fable5/memory.md`,
a light repo skim (file tree / package.json / recent commits — whatever Bootstrap
already has access to), and the persona library (defaults + any `.fable5/config.json`
overrides).
**Produces:** a `RunPlan` (schema below).

The Foreman is told, in its prompt, what each of the five phases is *for* (so it can
reason about which are needed) and given a few worked examples of shapes it might
choose — a quick fix skipping Design/Plan straight to Build+QA; "just audit X, don't
build it" stopping at Audit; a new UI feature keeping all five. It is **not** given a
hardcoded decision tree to fill in — `taskType` and `phases` are its own judgment call,
expressed as structured output, not a menu pick from code-side logic. This is the crux
of "the orchestrator decides" — the branching lives in the Foreman's reasoning, not in
`if` statements in the workflow script.

`scope` (`feature`/`app`) becomes an optional hint the Foreman may weigh (e.g. "the
founder said app-wide, so lean toward the audit lens fan-out") rather than a hard
switch it must obey — consistent with "Foreman decides everything," which is what was
chosen when this was discussed.

### RunPlan schema (draft — plan/build phase should finalize exact JSON Schema)

```
RunPlan {
  taskType: string          // Foreman's own label, e.g. "quick-fix", "new-feature",
                             // "audit-only", "refactor", "content", "research"
  rationale: string         // one line — surfaces in the report so the founder sees why
  phases: string[]          // ordered subset of ["audit","design","plan","build","qa"]
                             // (must start with "audit"; the rest is the Foreman's call)
  auditMode: "single" | "lenses"
  auditLenses?: string[]    // only if auditMode = "lenses"; may reuse or reshape the
                             // existing retention/monetization/ux/techdebt set
  personas: {                // persona-library key (or a scoped custom blurb) per
    audit?: string,          // phase actually included in `phases`
    design?: string,
    plan?: string,
    build?: string,
    qa?: string,
  }
  depth: {                   // effort override per included phase
    audit?: "low"|"high", design?: "low"|"high", plan?: "low"|"high",
    build?: "low"|"high", qa?: "low"|"high",
  }
}
```

Validation rule: `"audit"` is always first in `phases` (every run starts by
understanding the repo/vision) — the Foreman cannot omit it. All other inclusion/order
decisions are free.

## Persona library

Lives in `tools/fable5/personas.json` (repo-agnostic defaults, shipped with the skill),
with per-repo additions/overrides in `.fable5/config.json` under a new `personas` key —
same override pattern already used for `phaseSkills`.

**Starting roster (curated, ~6-8):**

| Key | Lens |
|---|---|
| `growth` | retention/monetization-obsessed — will this bring people back, does it justify paying |
| `security` | paranoid/defensive — attack surface, data exposure, auth edges |
| `ux` | friction-obsessed — tap counts, confusing flows, missing states |
| `infra` | migration/scaling/tech-debt — architecture risk, fragile seams |
| `content` | words-first — copy, tone, information clarity |
| `bugfix` | surgical, minimal-diff — smallest correct change, no drive-by refactors |
| `research` | exploratory, no-build mindset — depth of investigation over speed to ship |
| `generalist` | fallback when nothing else fits |

Each persona is a short blurb (a few sentences) injected into that phase's prompt as a
"channel this persona" preamble — a new axis alongside the existing domain-skill
heuristic (`skillsForPhase`, which loads `football-mind`, `impeccable`, etc. based on
keyword matches). Personas answer "whose judgment shapes this phase"; domain skills
answer "what specialized knowledge does this phase need." Both apply together — e.g.
Build could be staffed with the `infra` persona while also loading `live-pipeline-
architecture` if the vision hints at it.

## Engine control-flow change

`fable5.js` changes from one long sequential script to a small dispatch loop:

```js
const PHASE_RUNNERS = { audit: runAudit, design: runDesign, plan: runPlan, build: runBuild, qa: runQa }

let ctx = { vision, scope, cfg, runPlan, audit: null, design: null, plan: null, build: null, qa: null, gate: null }
for (const name of runPlan.phases) {
  ctx = await PHASE_RUNNERS[name](ctx)
  if (ctx.stop) break
}
```

Each existing phase body (Audit's lens fan-out, Design's prototype publish, Plan's
kickback-to-Design, Build's kickback-to-Plan + verify-gate + repair pass, QA's
adversarial refute) is refactored into one of these runner functions, reading its
persona/depth from `ctx.runPlan` instead of the current fixed model/effort table. The
one-kickback-per-seam rule only applies between phases that are both actually present
in `runPlan.phases` — a run that skipped Design has nothing for Plan to kick back to,
so `designFeasible: false` on such a run becomes a hard stop with a clear reason instead
of a kickback attempt.

**Build without a Plan.** When `phases` includes `build` but not `plan` (the fast-fix
shape), Build's prompt is assembled from the Audit output directly (`buildTarget`,
`gaps`, `fileHints`) rather than a `PLAN_SCHEMA` object — Build's runner needs a branch
for "plan is null, work from the audit brief instead."

**QA without Design/Plan.** Unaffected — QA already only ever reads the real git diff,
never the Design/Plan objects directly.

**Audit-only runs.** When `phases = ["audit"]`, the run goes straight from Audit to
Report after Staffing+Audit — this becomes a first-class, Foreman-chosen outcome,
distinct from today's only early-exit path (`worthBuilding: false`). Both still route
through the same Report phase, which now needs to handle "no build was ever attempted
by design" as a normal, non-apologetic outcome rather than a failure state.

## Report changes

The report gains a line near the top: `Staffed as: <taskType> — phases: <list> —
personas: <list>. <rationale>` so the founder can see the Foreman's call at a glance.
The body only includes sections for phases that actually ran (no more empty "THE PLAN"
section when Plan was skipped). Memory updates (`.fable5/memory.md`) note the staffing
decision alongside the usual "what was built" so future runs' Foreman calls can see
what shapes were chosen before.

## Safety rails (unchanged, binding regardless of RunPlan)

Branch-only, tagged per run, never merged to master; never applies live DB migrations,
deploys, touches secrets, or weakens a test/RLS to pass — those remain founder-gated
proposals in the report. These live in the `CREED` preamble injected into every phase
regardless of which phases the Foreman includes, and the Foreman itself cannot alter
them — `RunPlan` has no field that could waive them.

## What this is NOT (scope guards / YAGNI)

- Not a rewrite of Project Memory, the verify-gate, or QA's adversarial refute — those
  mechanics are reused as-is inside whichever runner functions they now live in.
- Not a persona-per-vision generator — the library is curated and small; the Foreman
  picks from it, it does not invent new personas each run (that was explicitly decided
  against in favor of consistency).
- Not a change to how `crew-forge` or any other skill works — scoped entirely to
  `tools/fable5/` and `~/.claude/skills/fable5/SKILL.md`.
- Not a change to the founder-facing trigger phrases or the Skill's preflight
  (branch/clean-tree/scaffold) — `scope` simply becomes optional in the `Workflow`
  call rather than required.

## Open implementation notes (for the plan)

- Finalize `RunPlan` as strict JSON Schema (`additionalProperties: false`, enums for
  `phases` items, etc.), mirroring the existing schema style in `fable5.js`.
- `personas.json` format + the `.fable5/config.json` merge/override behavior (same
  shape as the existing `phaseSkills` override).
- Refactor each current inline phase block into a named runner function taking/
  returning `ctx`, without changing its internal logic (lens fan-out, kickback,
  verify-gate + repair pass, refute pass).
- Update `tools/fable5/fable5.helpers.test.mjs` — new pure helpers (RunPlan validation,
  persona resolution, phase-inclusion checks) should be unit-tested the same way
  `slugify`/`mergeConfig`/etc. are today.
- Update `~/.claude/skills/fable5/SKILL.md` to describe the Foreman step and make
  `scope` optional in the preflight instructions.
- Decide exact wording for the Foreman's worked examples (the few shapes it's shown as
  illustrations) — keep them as illustrations, not an exhaustive enum, so novel
  `taskType`s remain possible.
