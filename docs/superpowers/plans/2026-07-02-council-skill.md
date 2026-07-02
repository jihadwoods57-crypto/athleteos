# Council Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a user-level `council` skill that convenes a multi-agent council (gather → debate → cross-examine → judge) to decide one hard OnStandard call and end with a committed ruling doc plus a locked-decision memory.

**Architecture:** A `SKILL.md` orchestrates five moves and points to three reference files. The engine is a parameterized Claude **Workflow** script (fan-out evidence gatherers → parallel personas R1 → parallel personas R2 → single judge), mirroring the proven `upgraded-visio-council` workflow. Output is a ruling doc written to the OnStandard repo and a project memory entry.

**Tech Stack:** Claude Code skills (Markdown + YAML frontmatter), Claude Workflow scripting (plain JS with `agent()`/`parallel()`/`phase()`/`log()` globals and JSON-Schema structured output), Node (for `--check` syntax validation only).

## Global Constraints

- Skill install root: `C:\Users\Administrator\.claude\skills\council\` — verbatim.
- OnStandard repo: `c:\Users\Administrator\Downloads\athleteos` — verbatim. Ruling docs go to `docs/council/YYYY-MM-DD-<slug>.md` inside it.
- Council seats one decision at a time; roster capped at **3–5 personas**; judge is always the **head of product**.
- Two standing seats every council: **Athlete end-user** and **Product strategist / moat-keeper**.
- The Workflow script is JS, NOT TypeScript: no type annotations, no `import`. `meta` must be a pure literal. `Date.now()`/`Math.random()`/argless `new Date()` are forbidden inside scripts.
- No silent truncation: if the council bounds evidence coverage (N files, sampled screens), it must `log()`/state what was dropped.
- A council always ends in a decision, even on deadlock (dissent recorded under open questions).
- Date to use in generated filenames this session: `2026-07-02`.

---

### Task 1: Scaffold the skill directory and write SKILL.md

**Files:**
- Create: `C:\Users\Administrator\.claude\skills\council\SKILL.md`

**Interfaces:**
- Produces: the skill entry point. References (by relative path) `references/personas.md`, `references/workflow-template.md`, `references/ruling-doc-template.md` (created in Tasks 2–4).

- [ ] **Step 1: Define the acceptance check**

The file must: (a) start with valid YAML frontmatter containing `name: council` and a `description` that names OnStandard and the trigger phrases; (b) list the five moves as a checklist; (c) link to the three reference files. Acceptance = frontmatter parses and all five moves + three reference links are present.

- [ ] **Step 2: Create the skill directory**

Run:
```bash
mkdir -p "/c/Users/Administrator/.claude/skills/council/references"
```
Expected: no output, directory exists.

- [ ] **Step 3: Write SKILL.md**

Write this exact content to `C:\Users\Administrator\.claude\skills\council\SKILL.md`:

```markdown
---
name: council
description: Convene a multi-agent council to decide ONE hard OnStandard call (the athlete-accountability Expo/RN app at c:\Users\Administrator\Downloads\athleteos). Use when the user says "convene the council", "run the council on X", "/council", "let the council decide", or "council call on ...", or otherwise asks to make a hard OnStandard product/feature, UX/design, architecture/eng, or accountability-science decision by weighing multiple expert perspectives and a judge. Gathers grounded evidence (codebase, live app, competitor study), runs a persona debate + cross-examination, and ends with a decisive ruling doc plus a locked-decision memory. Not for live/mid-workout use, and not for other projects.
---

# The Council

Convene a council to decide **one** hard OnStandard call and end with a single decisive
ruling — not a menu of options. This generalizes the `upgraded-visio-council` workflow and
points it at OnStandard (`c:\Users\Administrator\Downloads\athleteos`).

Run the five moves in order. Create a todo per move.

## 1. Frame
Pin down the exact question, the real candidate options, and the decision type(s):
**Product & features / UX & design / Architecture & eng / Accountability science**.
Ask at most one or two clarifying questions, then **state the question and options back to
the user before spending any agents.** If several decisions are handed to you, seat one and
offer to seat the next afterward. If the question is vague or optionless, surface candidate
options first — never seat a council on a vague question.

## 2. Gather evidence
Pick only the evidence that fits the question (see `references/personas.md` for which
lenses need which evidence):
- **OnStandard codebase** — read relevant `src`/screens, the scoring engine, Supabase
  migrations, and `docs/` (`PRODUCT-CONSTITUTION.md`, `FOUNDER-DECISIONS.md`, relevant specs).
- **Live app walkthrough** — screenshot/click the running app (Expo web preview or
  Playwright) so the council sees real UX.
- **Competitor / reference study** — study competitor apps or reference material.

State what you gathered and, if you bounded coverage (read only N files, sampled screens),
say so. If a source is unavailable (app won't boot, no competitor material), note the gap
and proceed with what exists — never fabricate observations.

## 3–5. Run the council (Workflow)
Author and run the council **Workflow** using `references/workflow-template.md`. Fill in:
the framed question + options, the evidence gathered in move 2, and the persona roster
selected from `references/personas.md` (3–5 seats, the two standing seats always included,
judge = head of product). The workflow runs:
- **Debate R1** — parallel personas stake positions.
- **Debate R2** — parallel personas cross-examine.
- **Synthesize** — one judge writes the plan.

Invoking this skill is the Workflow opt-in.

## Output
When the judge returns:
1. Write a **ruling doc** to `c:/Users/Administrator/Downloads/athleteos/docs/council/2026-07-02-<slug>.md`
   using `references/ruling-doc-template.md`, then commit it to the OnStandard repo.
2. Write a **locked-decision memory** (type `project`) summarizing the call and linking the
   ruling doc, and add its index line to `MEMORY.md`.
3. Report the decision and the single best next step in chat.
```

- [ ] **Step 4: Verify frontmatter parses and required content is present**

Run:
```bash
cd "/c/Users/Administrator/.claude/skills/council" && \
awk 'NR==1{if($0!="---")exit 1} /^---$/{c++} END{exit (c>=2)?0:1}' SKILL.md && echo "FRONTMATTER_OK" && \
grep -q "name: council" SKILL.md && echo "NAME_OK" && \
grep -c "references/" SKILL.md
```
Expected: `FRONTMATTER_OK`, `NAME_OK`, and a count `>= 3` for the reference links.

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/Administrator/.claude/skills/council" && git init -q 2>/dev/null; \
git -C "/c/Users/Administrator/.claude" add skills/council/SKILL.md 2>/dev/null; \
echo "SKILL.md written"
```
Note: the `~/.claude` tree may or may not be a git repo; if `git -C` errors, that is fine — the file is saved regardless. Do not create a new repo inside `~/.claude`.

---

### Task 2: Write references/personas.md (the bench + roster rules)

**Files:**
- Create: `C:\Users\Administrator\.claude\skills\council\references\personas.md`

**Interfaces:**
- Consumes: nothing.
- Produces: named persona briefs (`athlete`, `strategist`, `ux`, `coach`, `architect`, `behavior`, `monetization`) and the roster-selection table used by the workflow template's `PERSONAS` array in Task 3.

- [ ] **Step 1: Define the acceptance check**

The file must define the two standing seats, the per-decision-type specialists, the 3–5 cap, the judge, and which evidence each lens wants. Acceptance = all seven persona keys present and the roster table maps each of the four decision types.

- [ ] **Step 2: Write personas.md**

Write this exact content:

```markdown
# Council Personas

Every council seats the **two standing seats**, then adds specialists for the decision
type(s). Cap the roster at **3–5 total**. If multiple decision types apply, pick the most
relevant specialists rather than seating everyone. The **judge** is always the head of
product (defined at the bottom).

Each persona brief below is the `brief` string to paste into the workflow's `PERSONAS`
array (Task 3). Keep the persona's voice and lens.

## Standing seats (always)

- **`athlete` — Athlete end-user.** A real user of an accountability app who logs, gets
  scored, and answers to a coach. Bar: does this earn reps and daily trust, or is it
  gold-plating? Hates fiddly flows and anything that feels like surveillance without payoff.
  Wants evidence: **live app walkthrough**.

- **`strategist` — Product strategist / moat-keeper.** Guards sequencing and
  differentiation. OnStandard already has multi-role accountability, a scoring engine,
  linking, and AI copilot/memory. Insists new work amplifies that moat, not scatter it.
  Decides MVP vs later; cuts ruthlessly. Wants evidence: **codebase + competitor study**.

## Specialists by decision type

| Decision type | Add these seats |
|---|---|
| Product & features | *(the two standing seats cover it)* |
| UX & design | `ux` + `coach` |
| Architecture & eng | `architect` |
| Accountability science | `behavior` + `coach` |

- **`ux` — UX/design architect (impeccable-flavored).** Obsesses over visual hierarchy,
  cognitive load, onboarding, empty/error states, and motion that earns its keep. Bar:
  would a first-time athlete know what to do without narration? Wants evidence: **live app
  walkthrough + competitor study**.

- **`coach` — Coach / trainer end-user.** Manages many athletes/clients; cares about
  seeing who is on-standard at a glance and where to intervene. Skeptical of features that
  add noise to the coach view. Wants evidence: **live app walkthrough**.

- **`architect` — Expo/RN + Supabase architect.** Weighs engineering reality: Expo/RN
  structure, mobile perf, Supabase migrations and RLS, the scoring engine, build-vs-buy,
  and protecting the team from a rewrite that strands working flows. Wants evidence:
  **codebase**.

- **`behavior` — Behavior / habit-science expert.** Grounds scoring rules and the
  habit/accountability model in how behavior change actually works (streaks, variable
  reward, autonomy vs. control, coach dynamics). Bar: does the mechanic drive lasting
  behavior, not just short-term compliance? Wants evidence: **codebase (scoring engine) +
  competitor study**.

- **`monetization` — Monetization / pricing seat (optional).** Add ONLY when the call
  touches pricing, checkout, or the Stripe seam. Guards compliant terms and whether the
  charge maps to real value. Wants evidence: **codebase + competitor study**.

## Judge

- **Head of product.** Reads the briefing + both debate rounds and makes the calls: the
  decision, feature priorities, phase plan, hard cut list, 2–4 open questions for the
  founder, and the single best next step. Always resolves — records dissent under open
  questions rather than deferring.
```

- [ ] **Step 3: Verify all persona keys and the roster table are present**

Run:
```bash
cd "/c/Users/Administrator/.claude/skills/council/references" && \
for k in athlete strategist ux coach architect behavior monetization; do \
  grep -q "\`$k\`" personas.md && echo "$k OK" || echo "$k MISSING"; done && \
grep -q "Accountability science" personas.md && echo "TABLE_OK"
```
Expected: `OK` for all seven keys and `TABLE_OK`.

- [ ] **Step 4: Commit**

```bash
echo "personas.md written"
```

---

### Task 3: Write references/workflow-template.md (the council Workflow script)

**Files:**
- Create: `C:\Users\Administrator\.claude\skills\council\references\workflow-template.md`
- Test: `C:\Users\ADMINI~1\AppData\Local\Temp\claude\c--Users-Administrator-Downloads-playsmithai2026\e801c019-9222-43d1-afc9-c51af64a4913\scratchpad\council-template.js` (extracted JS, for `node --check` only)

**Interfaces:**
- Consumes: persona briefs from Task 2 (pasted into `PERSONAS`), the framed question and evidence from moves 1–2.
- Produces: a runnable Workflow script the skill fills and passes to the `Workflow` tool. Returns `{ evidence, r1, r2, plan }` where `plan` matches `PLAN_SCHEMA` consumed by the ruling-doc template (Task 4).

- [ ] **Step 1: Define the acceptance check**

The template's embedded JS must be valid as a Workflow body (top-level `await`/`return` are legal there — validate by wrapping the body in an async function before `node --check`, since the runtime does the same) and contain the three deliberation schemas (`POSITION_SCHEMA`, `REBUTTAL_SCHEMA`, `PLAN_SCHEMA`), the `PERSONAS` array, and the three phases (`Debate R1`/`Debate R2`/`Synthesize`). Evidence gathering is intentionally NOT a workflow phase — it is done by the orchestrating agent in move 2 and passed in as the `BRIEFING` string (the live-app walkthrough needs the Playwright/browser MCP, which the Workflow runtime warns may be absent in headless runs). Acceptance = the wrapped `node --check` exits 0.

- [ ] **Step 2: Write workflow-template.md**

Write this exact content:

````markdown
# Council Workflow Template

Fill the three `<<FILL: ...>>` slots, delete any personas you did not seat, then pass the
whole script to the `Workflow` tool via its `script` argument. Do not add TypeScript
syntax. `meta` must stay a pure literal.

```javascript
export const meta = {
  name: 'onstandard-council',
  description: 'A council gathers evidence, debates one OnStandard decision across expert lenses, cross-examines, and a judge synthesizes one ruling.',
  phases: [
    { title: 'Debate R1', detail: 'personas stake positions' },
    { title: 'Debate R2', detail: 'personas cross-examine' },
    { title: 'Synthesize', detail: 'judge writes the ruling' },
  ],
}

// <<FILL: QUESTION>> — the framed decision + candidate options, verbatim.
const QUESTION = `REPLACE WITH THE FRAMED QUESTION AND OPTIONS`

// <<FILL: BRIEFING>> — the evidence gathered in move 2 (codebase notes, app-walkthrough
// findings, competitor study), as one plain-text block. If coverage was bounded, say so here.
const BRIEFING = `REPLACE WITH THE EVIDENCE BRIEFING`

// <<FILL: PERSONAS>> — keep only the seats you selected (3–5). Briefs come from
// references/personas.md.
const PERSONAS = [
  { key: 'athlete', label: 'Athlete end-user', brief: 'PASTE athlete brief' },
  { key: 'strategist', label: 'Product strategist / moat-keeper', brief: 'PASTE strategist brief' },
  // add specialists: ux / coach / architect / behavior / monetization
]

const POSITION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    thesis: { type: 'string', description: 'core position in 2-3 sentences, in your expert voice.' },
    must_haves: { type: 'string', description: 'capabilities/decisions you insist on, prioritized, with WHY.' },
    approach_take: { type: 'string', description: 'your call on the approach/architecture and why.' },
    cut_or_defer: { type: 'string', description: 'what you would explicitly NOT do now.' },
    strongest_disagreement: { type: 'string', description: 'the view you most expect to clash with, and your pre-emptive argument.' },
  },
  required: ['thesis', 'must_haves', 'approach_take', 'cut_or_defer', 'strongest_disagreement'],
}

const REBUTTAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    concessions: { type: 'string', description: 'where the others moved you — be specific and honest.' },
    hold_firm: { type: 'string', description: 'where you still disagree, sharpened.' },
    synthesis_offer: { type: 'string', description: 'a concrete compromise respecting the strongest points.' },
  },
  required: ['concessions', 'hold_firm', 'synthesis_offer'],
}

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    vision: { type: 'string', description: 'crisp statement of what the decision commits to.' },
    decision: { type: 'string', description: 'THE call, with the reasoning that won and any migration-from-today note.' },
    feature_priorities: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { feature: { type: 'string' }, why: { type: 'string' }, from_evidence: { type: 'string', description: 'which evidence motivates it' } }, required: ['feature', 'why', 'from_evidence'] }, description: 'prioritized capability list.' },
    phase_plan: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { phase: { type: 'string' }, goal: { type: 'string' }, includes: { type: 'string' } }, required: ['phase', 'goal', 'includes'] }, description: 'sequenced build phases.' },
    cut_list: { type: 'string', description: 'what is explicitly out of scope now and why.' },
    open_questions: { type: 'string', description: '2-4 decisions that genuinely need the founder (record dissent here).' },
    recommended_next_step: { type: 'string', description: 'the single most valuable thing to do first.' },
  },
  required: ['vision', 'decision', 'feature_priorities', 'phase_plan', 'cut_list', 'open_questions', 'recommended_next_step'],
}

const briefing = `=== DECISION ===\n${QUESTION}\n\n=== EVIDENCE BRIEFING ===\n${BRIEFING}`

const r1Prompt = (p) => `You are the ${p.label} on an OnStandard product council deciding ONE call.\n\nYOUR LENS: ${p.brief}\n\nShared briefing (the decision + the evidence gathered):\n\n${briefing}\n\nStake your position. Be opinionated and specific in your expert voice. Argue for what matters most through YOUR lens, name the approach you favor, say what to cut, and anticipate where you'll clash with the other experts.`

const r2Prompt = (p, r1, idx) => `You are the ${p.label} on the council. You already staked a position. Read ALL opening positions and respond honestly — concede where they moved you, hold firm where they didn't (sharpened), and offer a concrete synthesis.\n\nTHE OPENING POSITIONS:\n${r1.map((r, i) => `--- ${PERSONAS[i].label} ---\nThesis: ${r.thesis}\nMust-haves: ${r.must_haves}\nApproach: ${r.approach_take}\nCut/defer: ${r.cut_or_defer}`).join('\n\n')}\n\nYour own opening was position #${idx + 1}. Engage the others' ACTUAL arguments — no restating.`

const judgePrompt = (r1, r2) => `You are the head of product, synthesizing this council into ONE decisive ruling for OnStandard.\n\nTHE BRIEFING:\n${briefing}\n\nOPENING POSITIONS:\n${r1.map((r, i) => `[${PERSONAS[i].label}] thesis: ${r.thesis} | must-haves: ${r.must_haves} | approach: ${r.approach_take} | cut: ${r.cut_or_defer}`).join('\n')}\n\nCROSS-EXAMINATION:\n${r2.map((r, i) => `[${PERSONAS[i].label}] concedes: ${r.concessions} | holds: ${r.hold_firm} | synthesis: ${r.synthesis_offer}`).join('\n')}\n\nMake the calls. Resolve the decision decisively, prioritize the work, sequence it into phases, cut hard, name 2-4 founder questions (record any dissent here), and the single best next step. A council always ends in a decision.`

phase('Debate R1')
const r1 = (await parallel(PERSONAS.map((p) => () => agent(r1Prompt(p), { schema: POSITION_SCHEMA, label: `R1: ${p.key}`, phase: 'Debate R1' })))).filter(Boolean)
if (r1.length === 0) return { error: 'R1 produced nothing' }
log(`${r1.length} opening positions on the table. Cross-examining.`)

phase('Debate R2')
const r2 = (await parallel(PERSONAS.map((p, i) => () => agent(r2Prompt(p, r1, i), { schema: REBUTTAL_SCHEMA, label: `R2: ${p.key}`, phase: 'Debate R2' })))).filter(Boolean)
log(`Cross-examination done. Synthesizing the ruling.`)

phase('Synthesize')
const plan = await agent(judgePrompt(r1, r2), { schema: PLAN_SCHEMA, label: 'judge: final ruling', phase: 'Synthesize' })

return { evidence: BRIEFING, r1, r2, plan }
```
````

- [ ] **Step 3: Extract the JS and syntax-check it**

Extract the fenced ```javascript block into the scratchpad test file, then run `node --check`. Run:
```bash
SCRATCH="/c/Users/ADMINI~1/AppData/Local/Temp/claude/c--Users-Administrator-Downloads-playsmithai2026/e801c019-9222-43d1-afc9-c51af64a4913/scratchpad"; \
awk '/^```javascript$/{f=1;next} /^```$/{if(f){f=0}} f' "/c/Users/Administrator/.claude/skills/council/references/workflow-template.md" > "$SCRATCH/council-template.js" && \
node --check "$SCRATCH/council-template.js" && echo "SYNTAX_OK"
```
Expected: `SYNTAX_OK` (note: `export`/`await` at top level parse under Node's module check; if `node --check` complains about `export`, prepend nothing and re-run with `node --input-type=module --check < "$SCRATCH/council-template.js"` — expected `SYNTAX_OK`).

- [ ] **Step 4: Verify the four schemas and phases are present**

Run:
```bash
cd "/c/Users/Administrator/.claude/skills/council/references" && \
for s in POSITION_SCHEMA REBUTTAL_SCHEMA PLAN_SCHEMA; do grep -q "$s" workflow-template.md && echo "$s OK"; done && \
for ph in "Debate R1" "Debate R2" "Synthesize"; do grep -q "$ph" workflow-template.md && echo "phase $ph OK"; done
```
Expected: `OK` for all three schemas and all three phases.

- [ ] **Step 5: Commit**

```bash
echo "workflow-template.md written"
```

---

### Task 4: Write references/ruling-doc-template.md

**Files:**
- Create: `C:\Users\Administrator\.claude\skills\council\references\ruling-doc-template.md`

**Interfaces:**
- Consumes: the `plan` object (`PLAN_SCHEMA`) returned by the workflow in Task 3, plus the roster and evidence from moves 1–2.
- Produces: the on-disk ruling doc shape written to `docs/council/` in the OnStandard repo.

- [ ] **Step 1: Define the acceptance check**

The template must map every `PLAN_SCHEMA` field (vision, decision, feature_priorities, phase_plan, cut_list, open_questions, recommended_next_step) plus a header (question, council seats, evidence). Acceptance = all seven plan fields referenced.

- [ ] **Step 2: Write ruling-doc-template.md**

Write this exact content:

````markdown
# Ruling Doc Template

Fill from the judge's `plan` object and the run's framing. Save to
`c:/Users/Administrator/Downloads/athleteos/docs/council/2026-07-02-<slug>.md`
(`<slug>` = short kebab-case of the decision). Then commit it to the OnStandard repo.

```markdown
# Council Ruling: <one-line decision title>

**Date:** 2026-07-02
**Decision type(s):** <Product & features | UX & design | Architecture & eng | Accountability science>
**Council seats:** <persona labels seated> — judged by head of product

## The question
<the framed question + candidate options>

## Evidence gathered
<what was read/walked/studied; note any bounded coverage or unavailable source>

## Vision
<plan.vision>

## The decision
<plan.decision>

## Feature priorities
| Priority | Feature | Why | Motivated by |
|---|---|---|---|
| 1 | <feature> | <why> | <from_evidence> |
<one row per plan.feature_priorities item>

## Phase plan
1. **<phase>** — <goal>. Includes: <includes>.
<one entry per plan.phase_plan item>

## Cut list
<plan.cut_list>

## Open questions for the founder
<plan.open_questions — includes any recorded dissent>

## Next step
<plan.recommended_next_step>
```

After writing and committing the doc, write a **locked-decision memory** (type `project`):
a short file in the active project's memory dir summarizing the call, naming OnStandard,
and linking this ruling doc; then add its one-line pointer to `MEMORY.md`.
````

- [ ] **Step 3: Verify all plan fields are referenced**

Run:
```bash
cd "/c/Users/Administrator/.claude/skills/council/references" && \
for f in vision decision feature_priorities phase_plan cut_list open_questions recommended_next_step; do \
  grep -q "$f" ruling-doc-template.md && echo "$f OK" || echo "$f MISSING"; done
```
Expected: `OK` for all seven fields.

- [ ] **Step 4: Commit**

```bash
echo "ruling-doc-template.md written"
```

---

### Task 5: End-to-end dry run on a real small OnStandard call

**Files:**
- Create (by running the skill): `c:\Users\Administrator\Downloads\athleteos\docs\council\2026-07-02-<slug>.md` and a memory file.

**Interfaces:**
- Consumes: all of Tasks 1–4.
- Produces: proof the skill runs end to end and emits both artifacts.

- [ ] **Step 1: Pick a small real decision**

Choose one narrow, real OnStandard call with clear options (e.g. "Should the athlete home screen lead with today's score or today's tasks?"). State it as the council question.

- [ ] **Step 2: Invoke the skill and run the five moves**

Invoke `council` on the chosen question. Frame it (echo question + options back), gather the fitting evidence (for a UX call: a quick live/codebase look at the athlete home screen), then fill and run the workflow template via the `Workflow` tool with the `ux` + `coach` specialists plus the two standing seats.

- [ ] **Step 3: Verify the workflow returned a plan**

Expected: the Workflow completes with `{ evidence, r1, r2, plan }`, `r1` and `r2` non-empty, and `plan` populated with all seven fields. If any persona returned null, confirm the roster still had ≥2 seats and the judge still produced a decision.

- [ ] **Step 4: Verify both output artifacts exist**

Run:
```bash
ls "/c/Users/Administrator/Downloads/athleteos/docs/council/" && \
ls "/c/Users/Administrator/.claude/projects/c--Users-Administrator-Downloads-playsmithai2026/memory/" | grep -i council
```
Expected: a `2026-07-02-<slug>.md` ruling doc, and a council memory file. Also confirm `MEMORY.md` gained a pointer line.

- [ ] **Step 5: Commit the ruling doc in the OnStandard repo**

```bash
cd "/c/Users/Administrator/Downloads/athleteos" && \
git add docs/council/ && \
git commit -q -m "docs(council): ruling — <slug>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" && \
git log --oneline -1
```
Expected: a commit containing the ruling doc.

---

## Self-Review

**Spec coverage:**
- Skill location + files (SKILL.md + 3 references) → Task 1–4. ✓
- Five moves (Frame/Gather/R1/R2/Judge) → SKILL.md (Task 1) + workflow (Task 3). ✓
- Four decision types + adaptive roster → personas.md (Task 2). ✓
- Evidence menu (codebase / live walkthrough / competitor) + no silent truncation → SKILL.md move 2 + personas evidence notes. ✓
- Two standing seats + specialists + 3–5 cap + judge = head of product → Task 2, Global Constraints. ✓
- Workflow engine (deliberation phases R1/R2/Synthesize; evidence gathered by the parent agent in move 2, not in-workflow — a deliberate deviation from upgraded-visio-council for MCP/Playwright reliability) → Task 3. ✓
- Output: ruling doc in `docs/council/` + locked memory + MEMORY.md pointer → Task 1 Output, Task 4, Task 5. ✓
- Edge cases (vague question, unavailable evidence, deadlock, multiple decisions, wrong project) → SKILL.md move 1–2 + judge prompt. ✓
- Verification (frontmatter, node --check, dry run) → Tasks 1, 3, 5. ✓

**Placeholder scan:** The `<<FILL: ...>>` and `<slug>` tokens are intentional template slots the skill fills at runtime, not plan placeholders — every task's own content is complete. No TBD/TODO in the plan itself.

**Type consistency:** `PLAN_SCHEMA` fields (vision, decision, feature_priorities{feature,why,from_evidence}, phase_plan{phase,goal,includes}, cut_list, open_questions, recommended_next_step) are identical in Task 3 (schema) and Task 4 (ruling-doc mapping) and Task 5 (verification). `POSITION_SCHEMA`/`REBUTTAL_SCHEMA` field names used in `r2Prompt`/`judgePrompt` match their schema definitions. Persona keys (athlete/strategist/ux/coach/architect/behavior/monetization) are consistent across Task 2 and Task 3's `PERSONAS`. ✓
