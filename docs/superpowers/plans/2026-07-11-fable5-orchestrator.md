# Fable 5 Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `fable5` — an invokable Skill that drives a vision through a five-phase, real-agent build pipeline (Audit → Design → Plan → Build → QA) with a persistent Project Memory and a branch-only safety model.

**Architecture:** A **Skill** (front door: preflight + launch) starts a **Workflow script** (the Fable 5 orchestrator) that sequences five model-specialized sub-agents, passing schema-validated objects between them. All *deterministic decision logic* lives in a delimited `HELPERS` region of the workflow file and is unit-tested via `node --test` (single source of truth, extracted-and-imported). Agent wiring is verified by `node --check` plus one supervised end-to-end acceptance run. Engine is developed + tested inside this repo at `tools/fable5/`, then deployed (copied) to the global `~/.claude/` paths the loaders read.

**Tech Stack:** Node 24 (built-in `node:test`, `node:assert`), the Claude Code Workflow runtime (`agent`/`parallel`/`pipeline`/`phase`/`log`/`budget`), plain ESM JavaScript. No runtime imports in the workflow file (matches `crew-forge.js`), no filesystem/Node API inside the workflow sandbox.

## Global Constraints

- **Runtime file is self-contained** — `fable5.js` uses ZERO imports (the Workflow sandbox has no filesystem/Node API). Mirror `crew-forge.js` exactly.
- **Forbidden inside the workflow sandbox:** `Date.now()`, `Math.random()`, argless `new Date()` (they throw). Get dates via a bash-running agent, vary randomness by index.
- **Models (verbatim):** orchestrator/foreman `fable`; Audit/Design/Plan/QA `opus`; **Build `sonnet`**; refuters `opus` effort `low`. Overridable via `.fable5/config.json` `roles`.
- **Safety rails (verbatim):** Build works a `fable5/<date>-<slug>` branch, tags each run, **NEVER merges to master**. Never applies live DB migrations, deploys, runs `eas`/`ship`, touches secrets, or weakens a test/RLS to pass — those become founder-gated proposals in the report.
- **Kickback cap:** at most **one kickback per seam** (plan→design, build→plan).
- **Verify-gate before QA:** run `.fable5/config.json` `verify` (default `npm run verify`); on red, Build gets **one** repair pass; QA runs regardless and flags red loudly.
- **Deploy targets (verbatim):** workflow → `C:\Users\Administrator\.claude\workflows\fable5.js`; skill → `C:\Users\Administrator\.claude\skills\fable5\SKILL.md`. Dev/source copies live in-repo at `tools/fable5/`.
- **Repo verify command today:** `npm run verify` = `tsc --noEmit && jest && npm run bundle`.
- **Ground every agent claim in a real tool result** (a real file, a passing test, a real diff). Mirror `crew-forge.js`'s `CREED` preamble.

---

## File Structure

**In-repo (git-tracked, this repo):**
- `tools/fable5/fable5.js` — the Workflow orchestrator (source of truth). Deployed to `~/.claude/workflows/`.
- `tools/fable5/fable5.helpers.test.mjs` — `node --test` suite that extracts the `HELPERS` region from `fable5.js` and asserts the pure logic.
- `tools/fable5/SKILL.md` — the Skill front door (source of truth). Deployed to `~/.claude/skills/fable5/`.
- `tools/fable5/deploy.sh` — copies the two source files to their global `~/.claude/` targets.
- `tools/fable5/README.md` — one-screen operator note (how to invoke, where memory lives, how to review/merge).

**Per-repo runtime state (git-tracked in whatever repo Fable 5 runs in; here, this repo):**
- `.fable5/memory.md` — living Project Memory.
- `.fable5/config.json` — per-repo overrides (roles, verify command, phaseSkills, defaultScope).
- `.fable5/reports/` — per-run reports.

**Deployed (global, NOT git-tracked — deploy.sh writes these):**
- `~/.claude/workflows/fable5.js`
- `~/.claude/skills/fable5/SKILL.md`

---

## Task 1: Pure decision helpers (TDD) + the extract-and-import test harness

The deterministic brain of Fable 5. Everything here is a pure function with a real test. `fable5.js` will inline these between sentinel comments; the test extracts that exact region so there is one source of truth and zero drift.

**Files:**
- Create: `tools/fable5/fable5.js` (only the `meta` + `HELPERS` region for now)
- Create: `tools/fable5/fable5.helpers.test.mjs`

**Interfaces:**
- Produces (all inside the `HELPERS` region, all `export`ed there for the test to import):
  - `slugify(s: string) -> string`
  - `DEFAULT_ROLES: object`
  - `resolveRole(config, role: string) -> {model, effort}`
  - `mergeConfig(defaults: object, user: object) -> object`
  - `auditModeForScope(scope: string) -> 'single' | 'lenses'`
  - `shouldEarlyExit(audit) -> boolean`
  - `makeKickbacks() -> {used: object}` and `kickbackAllowed(state, seam: string) -> boolean`
  - `skillsForPhase(phase: string, config, hints: string) -> string[]`
  - `gateCommand(config) -> string`
  - `tokensByPhase(entries: {phase,tokens}[]) -> object`

- [ ] **Step 1: Write the failing test**

Create `tools/fable5/fable5.helpers.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Extract the delimited HELPERS region from fable5.js and import it as a module.
// Single source of truth: the test runs the REAL runtime code, not a copy.
const here = dirname(fileURLToPath(import.meta.url))
const src = await readFile(join(here, 'fable5.js'), 'utf8')
const START = '/* ===== HELPERS:START (test-mirrored, keep exports) ===== */'
const END = '/* ===== HELPERS:END ===== */'
const i = src.indexOf(START), j = src.indexOf(END)
assert.ok(i !== -1 && j !== -1 && j > i, 'HELPERS sentinels must exist in fable5.js')
const block = src.slice(i + START.length, j)
const H = await import('data:text/javascript,' + encodeURIComponent(block))

test('slugify normalizes to a safe, capped slug', () => {
  assert.equal(H.slugify('Meal-Streak Leaderboard!'), 'meal-streak-leaderboard')
  assert.equal(H.slugify(''), 'run')
  assert.equal(H.slugify('   '), 'run')
  assert.ok(H.slugify('x'.repeat(80)).length <= 40)
})

test('resolveRole falls back to DEFAULT_ROLES then to opus/high', () => {
  assert.deepEqual(H.resolveRole({}, 'build'), { model: 'sonnet', effort: 'high' })
  assert.deepEqual(H.resolveRole({ roles: { build: { model: 'opus', effort: 'low' } } }, 'build'), { model: 'opus', effort: 'low' })
  assert.deepEqual(H.resolveRole({}, 'nonexistent'), { model: 'opus', effort: 'high' })
})

test('mergeConfig merges nested objects one level deep, user wins', () => {
  const d = { defaultScope: 'feature', roles: { build: { model: 'sonnet', effort: 'high' } }, verify: 'npm run verify' }
  const u = { roles: { build: { model: 'opus' } }, verify: 'make check' }
  const m = H.mergeConfig(d, u)
  assert.equal(m.defaultScope, 'feature')
  assert.equal(m.verify, 'make check')
  assert.deepEqual(m.roles.build, { model: 'opus', effort: 'high' })
})

test('auditModeForScope: app fans out, everything else single', () => {
  assert.equal(H.auditModeForScope('app'), 'lenses')
  assert.equal(H.auditModeForScope('feature'), 'single')
  assert.equal(H.auditModeForScope(undefined), 'single')
})

test('shouldEarlyExit true when audit missing or worthBuilding false', () => {
  assert.equal(H.shouldEarlyExit(null), true)
  assert.equal(H.shouldEarlyExit({ worthBuilding: false }), true)
  assert.equal(H.shouldEarlyExit({ worthBuilding: true }), false)
})

test('kickbackAllowed permits a seam once, then blocks it', () => {
  const s = H.makeKickbacks()
  assert.equal(H.kickbackAllowed(s, 'plan->design'), true)
  assert.equal(H.kickbackAllowed(s, 'plan->design'), false)
  assert.equal(H.kickbackAllowed(s, 'build->plan'), true) // independent seam
})

test('skillsForPhase: config override wins, else heuristic on hints', () => {
  assert.deepEqual(H.skillsForPhase('design', { phaseSkills: { design: ['x'] } }, 'anything'), ['x'])
  assert.deepEqual(H.skillsForPhase('design', {}, ''), ['impeccable', 'frontend-design'])
  assert.ok(H.skillsForPhase('build', {}, 'new coverage read for linebacker grading').includes('lb-football-domain'))
  assert.ok(H.skillsForPhase('qa', {}, 'formation scout card').includes('football-mind'))
  assert.ok(H.skillsForPhase('build', {}, 'whisper transcriber sse pipeline').includes('live-pipeline-architecture'))
})

test('gateCommand: config wins, else repo default', () => {
  assert.equal(H.gateCommand({ verify: 'make ci' }), 'make ci')
  assert.equal(H.gateCommand({}), 'npm run verify')
})

test('tokensByPhase sums per phase', () => {
  assert.deepEqual(
    H.tokensByPhase([{ phase: 'Audit', tokens: 10 }, { phase: 'Build', tokens: 5 }, { phase: 'Audit', tokens: 2 }]),
    { Audit: 12, Build: 5 },
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs`
Expected: FAIL — `ENOENT` (no `fable5.js`) or the sentinel assertion throws.

- [ ] **Step 3: Write the minimal implementation**

Create `tools/fable5/fable5.js` with the `meta` block and the sentinel-delimited HELPERS region:

```js
export const meta = {
  name: 'fable5',
  description: 'Drive a vision through five model-specialized phases — Audit → Design → Plan → Build → QA — with a persistent Project Memory and a branch-only safety model. You launch it; it never merges to master.',
  phases: [
    { title: 'Bootstrap', detail: 'read .fable5 config + memory, confirm clean tree on a fable5/* branch' },
    { title: 'Audit', detail: 'Opus audits the vision against memory + repo (parallel lenses for app scope)' },
    { title: 'Design', detail: 'Opus designs screens/flows/states; publishes a clickable prototype when UI is involved' },
    { title: 'Plan', detail: 'Opus writes the engineering plan (may kick Design back once)' },
    { title: 'Build', detail: 'Sonnet implements the plan on the branch (may kick Plan back once)' },
    { title: 'Verify', detail: 'run the repo verify command; one repair pass on red' },
    { title: 'QA', detail: 'Opus audits the diff; each finding is adversarially refuted before it counts' },
    { title: 'Report', detail: 'tag the branch, write the run report + token table, update memory' },
  ],
}

/* ===== HELPERS:START (test-mirrored, keep exports) ===== */
export const slugify = (s) =>
  (String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)) || 'run'

export const DEFAULT_ROLES = {
  orchestrator: { model: 'fable',  effort: 'high' },
  foreman:      { model: 'fable',  effort: 'high' },
  audit:        { model: 'opus',   effort: 'high' },
  'audit.lens': { model: 'opus',   effort: 'high' },
  design:       { model: 'opus',   effort: 'high' },
  plan:         { model: 'opus',   effort: 'high' },
  build:        { model: 'sonnet', effort: 'high' },
  qa:           { model: 'opus',   effort: 'high' },
  refuter:      { model: 'opus',   effort: 'low'  },
}

export const resolveRole = (config, role) =>
  (config && config.roles && config.roles[role]) || DEFAULT_ROLES[role] || { model: 'opus', effort: 'high' }

export const mergeConfig = (defaults, user) => {
  const out = { ...defaults, ...(user || {}) }
  for (const k of Object.keys(defaults)) {
    const dv = defaults[k]
    if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
      out[k] = { ...dv, ...((user && user[k]) || {}) }
    }
  }
  return out
}

export const auditModeForScope = (scope) => (scope === 'app' ? 'lenses' : 'single')

export const shouldEarlyExit = (audit) => !audit || audit.worthBuilding === false

export const makeKickbacks = () => ({ used: {} })
export const kickbackAllowed = (state, seam) => {
  if (state.used[seam]) return false
  state.used[seam] = true
  return true
}

export const skillsForPhase = (phase, config, hints = '') => {
  const override = config && config.phaseSkills && config.phaseSkills[phase]
  if (override) return override
  const base = { design: ['impeccable', 'frontend-design'], build: [], qa: [] }[phase] || []
  const h = String(hints || '').toLowerCase()
  const domain = []
  if (/\blb\b|linebacker|grading|thundercloud/.test(h)) domain.push('lb-football-domain')
  else if (/football|formation|coverage|scout|\bcard\b/.test(h)) domain.push('football-mind')
  if (/whisper|transcri|recorder|\bsse\b|pipeline/.test(h)) domain.push('live-pipeline-architecture')
  return [...base, ...domain]
}

export const gateCommand = (config) => (config && config.verify) || 'npm run verify'

export const tokensByPhase = (entries) => {
  const out = {}
  for (const e of (entries || [])) out[e.phase] = (out[e.phase] || 0) + (e.tokens || 0)
  return out
}
/* ===== HELPERS:END ===== */
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Verify the runtime file still parses**

Run: `node --check tools/fable5/fable5.js`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add tools/fable5/fable5.js tools/fable5/fable5.helpers.test.mjs
git commit -m "feat(fable5): pure decision helpers + extract-and-import test harness"
```

---

## Task 2: Schemas + shared preamble (the phase contracts)

Define the JSON Schemas every phase hand-off must validate against, and the `CREED` safety preamble. These are the interfaces between phases.

**Files:**
- Modify: `tools/fable5/fable5.js` (append a `// schemas` section + `CREED` after the HELPERS region)
- Modify: `tools/fable5/fable5.helpers.test.mjs` (add a schema-validity test)

**Interfaces:**
- Produces (module-scope consts in `fable5.js`, NOT inside the HELPERS region): `PREFLIGHT_SCHEMA`, `AUDIT_SCHEMA`, `DESIGN_SCHEMA`, `PLAN_SCHEMA`, `BUILD_SCHEMA`, `QA_SCHEMA`, `REFUTE_SCHEMA`, `GATE_SCHEMA`, `SEAL_SCHEMA`, and `CREED` (string).
- To keep schemas testable without a JSON-Schema library, also export a tiny validity self-check inside the HELPERS region: `isPlainSchema(s) -> boolean` (asserts `type:'object'` + `properties`), used only to smoke-test shape.

- [ ] **Step 1: Write the failing test**

Add to `tools/fable5/fable5.helpers.test.mjs`:

```js
test('isPlainSchema recognizes object schemas', () => {
  assert.equal(H.isPlainSchema({ type: 'object', properties: {} }), true)
  assert.equal(H.isPlainSchema({ type: 'array' }), false)
  assert.equal(H.isPlainSchema(null), false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs`
Expected: FAIL — `H.isPlainSchema is not a function`.

- [ ] **Step 3: Add `isPlainSchema` to the HELPERS region**

Inside the `HELPERS:START/END` region of `fable5.js`, add:

```js
export const isPlainSchema = (s) => !!s && s.type === 'object' && typeof s.properties === 'object'
```

- [ ] **Step 4: Add the schemas + CREED after the HELPERS region**

In `fable5.js`, after `/* ===== HELPERS:END ===== */`, add:

```js
// -------------------------------------------------------------------- schemas
const PREFLIGHT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['onFable5Branch', 'cleanTree', 'config'],
  properties: {
    onFable5Branch: { type: 'boolean' }, cleanTree: { type: 'boolean' },
    reason: { type: 'string' }, config: { type: 'object', additionalProperties: true },
  },
}
const AUDIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['worthBuilding', 'buildTarget', 'rationale', 'gaps'],
  properties: {
    worthBuilding: { type: 'boolean' },
    buildTarget: { type: 'string' },
    rationale: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
    uxIssues: { type: 'array', items: { type: 'string' } },
    opportunities: { type: 'array', items: { type: 'string' } },
    touchesUIHint: { type: 'boolean' },
    fileHints: { type: 'string' },
  },
}
const DESIGN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'touchesUI', 'screens'],
  properties: {
    summary: { type: 'string' }, touchesUI: { type: 'boolean' },
    screens: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['name', 'purpose', 'states'],
      properties: {
        name: { type: 'string' }, purpose: { type: 'string' },
        states: { type: 'array', items: { type: 'string' } }, // empty/loading/error/success
      },
    } },
    flows: { type: 'array', items: { type: 'string' } },
    prototypeUrl: { type: 'string' },
  },
}
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['designFeasible', 'files', 'steps'],
  properties: {
    designFeasible: { type: 'boolean' },
    infeasibleReason: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    dataChanges: { type: 'array', items: { type: 'string' } },
    apis: { type: 'array', items: { type: 'string' } },
    migrations: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
  },
}
const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'summary', 'filesTouched'],
  properties: {
    status: { type: 'string', enum: ['implemented', 'blocked', 'proposal'] },
    summary: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    planInfeasible: { type: 'boolean' },
    blockedReason: { type: 'string' },
    committed: { type: 'boolean' },
  },
}
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['green', 'summary'],
  properties: { green: { type: 'boolean' }, summary: { type: 'string' } },
}
const QA_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: { findings: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['title', 'severity', 'evidence', 'file', 'proposedFix'],
    properties: {
      title: { type: 'string' },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'blocker'] },
      category: { type: 'string' }, // bug/security/perf/a11y/consistency
      evidence: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' },
      proposedFix: { type: 'string' },
    },
  } } },
}
const REFUTE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['refuted', 'reason'],
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
}
const SEAL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['tag', 'committed'],
  properties: { tag: { type: 'string' }, committed: { type: 'boolean' }, summary: { type: 'string' } },
}

// -------------------------------------------------------------------- shared preamble
const CREED = `
FIRST read .fable5/memory.md and .fable5/config.json in the current repo. Memory is the product's living brain —
honor decisions already settled there; do not re-litigate them.
SAFETY (binding): build works ONLY on the current fable5/* branch and is NEVER merged to master — integration is
the founder's call. NEVER apply live DB migrations, deploy/ship (eas, npm run ship), touch secrets, or weaken a
test/RLS to make a gate pass. Anything like that becomes a FOUNDER-GATED PROPOSAL in the report, not an action.
GROUND EVERY CLAIM in a tool result you actually ran (a real file, a passing test, a real diff). Never report work
you cannot point to evidence for.`
```

- [ ] **Step 5: Run tests + parse check**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js`
Expected: all tests PASS, `node --check` exit 0.

- [ ] **Step 6: Commit**

```bash
git add tools/fable5/fable5.js tools/fable5/fable5.helpers.test.mjs
git commit -m "feat(fable5): phase-contract schemas + CREED safety preamble"
```

---

## Task 3: Bootstrap phase + prompt builders (append the run body)

Wire the Workflow run: read args, load config, run the Bootstrap agent (confirm branch + clean tree, return config verbatim), and stop early if the preflight fails. Add the prompt-builder functions each phase will use.

**Files:**
- Modify: `tools/fable5/fable5.js` (append the run body after the schemas/CREED)

**Interfaces:**
- Consumes: `slugify`, `resolveRole`, `mergeConfig`, `auditModeForScope`, `gateCommand`, `CREED`, `PREFLIGHT_SCHEMA`.
- Produces: run-scope consts `vision`, `scope`, `slug`, `cfg`; helper `R(role)` = `resolveRole(cfg, role)`; the workflow returns `{ stopped: 'bootstrap' }` on preflight failure.

- [ ] **Step 1: Append the run body to `fable5.js`**

After the `CREED` const, append:

```js
// -------------------------------------------------------------------- run
const DEFAULT_CONFIG = {
  defaultScope: 'feature',
  verify: 'npm run verify',
  roles: DEFAULT_ROLES,
  phaseSkills: null, // null => heuristic (skillsForPhase)
}
const vision = (args && args.vision) || ''
if (!vision) { log('No vision provided (args.vision is required). Stopping.'); return { stopped: 'no-vision' } }

phase('Bootstrap')
const boot = await agent(
  `You are the Fable 5 bootstrap in the current repo.
${CREED}
1) Read .fable5/config.json and return it verbatim as 'config' (return {} if the file does not exist).
2) Confirm HEAD is on a fable5/* branch that is NOT master/main (onFable5Branch), and the tree is clean (cleanTree),
   using real git commands.
Change no code. If anything is off, set the flag false and explain in 'reason'.`,
  { label: 'bootstrap', phase: 'Bootstrap', model: 'opus', effort: 'low', schema: PREFLIGHT_SCHEMA },
)
if (!boot || !boot.onFable5Branch || !boot.cleanTree) {
  log(`Bootstrap failed — not on a clean fable5/* branch. ${boot ? boot.reason || '' : 'no result'}`)
  return { stopped: 'bootstrap', boot }
}
const cfg = mergeConfig(DEFAULT_CONFIG, boot.config || {})
const scope = (args && args.scope) || cfg.defaultScope || 'feature'
const slug = slugify(vision)
const R = (role) => resolveRole(cfg, role)
const tokenLog = []
const track = async (name, fn) => { const t0 = budget.spent(); const r = await fn(); tokenLog.push({ phase: name, tokens: budget.spent() - t0 }); return r }
log(`Fable 5 — vision="${vision}" scope=${scope} slug=${slug}`)
```

- [ ] **Step 2: Parse check**

Run: `node --check tools/fable5/fable5.js`
Expected: exit 0.

- [ ] **Step 3: Structural assertion (bootstrap wiring present)**

Run:
```bash
grep -c "phase('Bootstrap')" tools/fable5/fable5.js
grep -c "stopped: 'bootstrap'" tools/fable5/fable5.js
```
Expected: each prints `1`.

- [ ] **Step 4: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "feat(fable5): bootstrap phase, config merge, token tracker"
```

---

## Task 4: Audit phase (U5 scope-scaled + U6 early exit)

Run the Product Audit. For `scope:'feature'` a single Opus audit; for `scope:'app'`, fan out parallel lenses (retention, monetization, UX, tech-debt) and synthesize. If the audit says nothing is worth building, stop and report.

**Files:**
- Modify: `tools/fable5/fable5.js` (append after the bootstrap block)

**Interfaces:**
- Consumes: `auditModeForScope`, `shouldEarlyExit`, `AUDIT_SCHEMA`, `R`, `track`, `vision`, `scope`, `slug`.
- Produces: run-scope const `audit` (an `AUDIT_SCHEMA` object) or an early return `{ stopped: 'not-worth-building' }`.

- [ ] **Step 1: Append the Audit phase**

```js
// ---------------------------------------------------------------- Audit (U5 + U6)
phase('Audit')
const auditMode = auditModeForScope(scope)
const auditBase = `You are Fable 5's Product Audit (Opus). ${CREED}
The founder's vision: "${vision}". Scope: ${scope}.
Audit the CURRENT repo against this vision and .fable5/memory.md. Find the real gaps, UX issues, and the single
highest-value thing to build now. Be honest: if this vision is already met, or not worth building right now, say so
(worthBuilding=false) — do NOT manufacture work. Set touchesUIHint if the build will touch UI, and put concrete
path hints (files/dirs likely involved) in fileHints. Ground every claim in a file you actually read.`

let audit
if (auditMode === 'lenses') {
  const LENSES = [
    { key: 'retention', focus: 'will athletes come back tomorrow? habit loops, streaks, notifications, empty states.' },
    { key: 'monetization', focus: 'coach/parent value that justifies paying; conversion + upgrade friction.' },
    { key: 'ux', focus: 'friction: tap counts, confusing flows, weak information density, missing states.' },
    { key: 'techdebt', focus: 'architecture risk, scaling limits, fragile seams that will block the roadmap.' },
  ]
  const lensResults = (await parallel(LENSES.map((l) => () =>
    agent(`${auditBase}\nYOUR LENS ONLY: ${l.focus}`, {
      label: `audit:${l.key}`, phase: 'Audit', model: R('audit.lens').model, effort: R('audit.lens').effort, schema: AUDIT_SCHEMA,
    }),
  ))).filter(Boolean)
  audit = await track('Audit', () => agent(
    `You are Fable 5's audit synthesizer (Opus). ${CREED}
Fold these ${lensResults.length} lens audits (JSON) into ONE AuditReport for the whole app. Pick the single
buildTarget with the best impact-per-effort; set worthBuilding honestly. Lenses:
${JSON.stringify(lensResults).slice(0, 14000)}`,
    { label: 'audit:synth', phase: 'Audit', model: R('audit').model, effort: R('audit').effort, schema: AUDIT_SCHEMA },
  ))
} else {
  audit = await track('Audit', () => agent(auditBase, {
    label: 'audit', phase: 'Audit', model: R('audit').model, effort: R('audit').effort, schema: AUDIT_SCHEMA,
  }))
}

if (shouldEarlyExit(audit)) {
  phase('Report')
  await agent(
    `You are Fable 5. Write a SHORT report to .fable5/reports/<today>-${slug}.md (get today's date via bash).
${CREED}
The audit concluded there is nothing worth building for vision "${vision}" right now. Explain why in the founder's
terms, cite the evidence from the audit, and suggest what WOULD be worth doing. Audit JSON:
${JSON.stringify(audit).slice(0, 6000)}`,
    { label: 'report:early-exit', phase: 'Report', model: R('foreman').model, effort: R('foreman').effort },
  )
  log('Audit: nothing worth building — early exit.')
  return { stopped: 'not-worth-building', audit }
}
log(`Audit: buildTarget = ${audit.buildTarget}`)
```

- [ ] **Step 2: Parse check + structural assertion**

Run:
```bash
node --check tools/fable5/fable5.js
grep -c "stopped: 'not-worth-building'" tools/fable5/fable5.js
grep -c "audit:synth\|label: 'audit'" tools/fable5/fable5.js
```
Expected: parse exit 0; first grep `1`; second grep `>=1`.

- [ ] **Step 3: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "feat(fable5): audit phase — scope-scaled lenses + early exit"
```

---

## Task 5: Design phase (U3 domain skills + U4 clickable prototype)

Run the UX/UI Design agent. It loads `impeccable`/`frontend-design` plus any heuristic domain skill, produces a `DesignSpec`, and — when the design touches UI — publishes a real Artifact prototype and records its URL.

**Files:**
- Modify: `tools/fable5/fable5.js` (append after the Audit block)

**Interfaces:**
- Consumes: `skillsForPhase`, `DESIGN_SCHEMA`, `audit`, `R`, `track`.
- Produces: run-scope const `design` (a `DESIGN_SCHEMA` object; `design.prototypeUrl` set when UI is involved).

- [ ] **Step 1: Append the Design phase**

```js
// ---------------------------------------------------------------- Design (U3 + U4)
phase('Design')
const designSkills = skillsForPhase('design', cfg, `${audit.buildTarget} ${audit.fileHints || ''}`)
const design = await track('Design', () => agent(
  `You are Fable 5's UX/UI Design phase (Opus). ${CREED}
FIRST invoke these skills so your design meets the bar: ${JSON.stringify(designSkills)} (use the Skill tool).
Build target (from the audit): ${JSON.stringify({ buildTarget: audit.buildTarget, uxIssues: audit.uxIssues, touchesUIHint: audit.touchesUIHint })}
Design every screen, flow, and state (empty / loading / error / success). Set touchesUI honestly.
IF touchesUI is true: build a real, self-contained HTML mockup of the primary screen(s) and PUBLISH it with the
Artifact tool (favicon "🎛️"); put the returned artifact URL in prototypeUrl so the founder can click it BEFORE any
code is written. If touchesUI is false, leave prototypeUrl empty.`,
  { label: 'design', phase: 'Design', model: R('design').model, effort: R('design').effort, schema: DESIGN_SCHEMA },
))
if (!design) { log('Design failed — stopping.'); return { stopped: 'design', audit } }
log(`Design: ${design.screens.length} screen(s)${design.prototypeUrl ? ` — prototype ${design.prototypeUrl}` : ''}`)
```

- [ ] **Step 2: Parse check + structural assertion**

Run:
```bash
node --check tools/fable5/fable5.js
grep -c "phase('Design')" tools/fable5/fable5.js
grep -c "prototypeUrl" tools/fable5/fable5.js
```
Expected: parse exit 0; both greps `>=1`.

- [ ] **Step 3: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "feat(fable5): design phase — domain skills + clickable prototype"
```

---

## Task 6: Plan phase + the Plan→Design kickback seam (U2)

Run the Engineering Plan agent. If it finds the design infeasible AND a kickback for this seam hasn't been used, re-run Design once with the plan's reason, then re-plan. Capped at one kickback.

**Files:**
- Modify: `tools/fable5/fable5.js` (append after the Design block)

**Interfaces:**
- Consumes: `makeKickbacks`, `kickbackAllowed`, `PLAN_SCHEMA`, `DESIGN_SCHEMA`, `design`, `audit`, `R`, `track`.
- Produces: run-scope const `kb` (kickback state, reused in Task 7), and mutable `design`/`plan`.

- [ ] **Step 1: Change `design` to be reassignable**

In the Design block (Task 5), change `const design =` to `let design =`.

Run: `grep -n "design = await track('Design'" tools/fable5/fable5.js` — confirm it now reads `let design`.

- [ ] **Step 2: Append the Plan phase + kickback**

```js
// ---------------------------------------------------------------- Plan (+ U2 kickback)
const kb = makeKickbacks()
const planPrompt = () => `You are Fable 5's Engineering Plan phase (Opus). ${CREED}
Design spec (JSON): ${JSON.stringify(design).slice(0, 12000)}
Write the concrete implementation plan for THIS repo: exact files to create/modify, data changes, APIs, migrations
(as PROPOSALS — never applied here), risks, and an ordered step list a builder can follow. If the design cannot be
built as specified, set designFeasible=false and put the precise reason in infeasibleReason.`

phase('Plan')
let plan = await track('Plan', () => agent(planPrompt(), {
  label: 'plan', phase: 'Plan', model: R('plan').model, effort: R('plan').effort, schema: PLAN_SCHEMA,
}))

if (plan && plan.designFeasible === false && kickbackAllowed(kb, 'plan->design')) {
  log(`Plan kicked Design back once: ${plan.infeasibleReason}`)
  phase('Design')
  design = await track('Design', () => agent(
    `You are Fable 5's UX/UI Design phase (Opus), REVISING after the engineering plan found the design infeasible.
${CREED}
Reason it was infeasible: "${plan.infeasibleReason}". Previous design (JSON): ${JSON.stringify(design).slice(0, 8000)}
Produce a revised, buildable DesignSpec. Re-publish the prototype Artifact if touchesUI (put the URL in prototypeUrl).`,
    { label: 'design:revise', phase: 'Design', model: R('design').model, effort: R('design').effort, schema: DESIGN_SCHEMA },
  )) || design
  phase('Plan')
  plan = await track('Plan', () => agent(planPrompt(), {
    label: 'plan:re', phase: 'Plan', model: R('plan').model, effort: R('plan').effort, schema: PLAN_SCHEMA,
  }))
}
if (!plan) { log('Plan failed — stopping.'); return { stopped: 'plan', audit, design } }
log(`Plan: ${plan.files.length} file(s), ${plan.steps.length} step(s)`)
```

- [ ] **Step 3: Parse check + structural assertion**

Run:
```bash
node --check tools/fable5/fable5.js
grep -c "kickbackAllowed(kb, 'plan->design')" tools/fable5/fable5.js
grep -c "let design = await" tools/fable5/fable5.js
```
Expected: parse exit 0; both greps `1`.

- [ ] **Step 4: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "feat(fable5): plan phase + bounded plan->design kickback"
```

---

## Task 7: Build phase + Build→Plan kickback + verify-gate + one repair pass

Sonnet implements the plan on the branch and commits. If it finds the plan infeasible AND the build→plan seam is unused, re-plan once and rebuild. After a successful build, run the verify-gate; on red, one repair pass. QA runs regardless (next task).

**Files:**
- Modify: `tools/fable5/fable5.js` (append after the Plan block)

**Interfaces:**
- Consumes: `kickbackAllowed`, `kb`, `gateCommand`, `skillsForPhase`, `BUILD_SCHEMA`, `GATE_SCHEMA`, `plan`, `audit`, `R`, `track`.
- Produces: run-scope consts `build` (`BUILD_SCHEMA`) and `gate` (`GATE_SCHEMA`).

- [ ] **Step 1: Append the Build phase**

```js
// ---------------------------------------------------------------- Build (Sonnet) + kickback + gate
const buildSkills = skillsForPhase('build', cfg, `${audit.buildTarget} ${audit.fileHints || ''} ${plan.files.join(' ')}`)
const buildPrompt = () => `You are Fable 5's Build phase (Sonnet). ${CREED}
FIRST invoke these skills for repo conventions + domain correctness: ${JSON.stringify(buildSkills)} (Skill tool).
Implement EXACTLY this plan on the CURRENT fable5/* branch — nothing more, no unrequested refactors:
${JSON.stringify(plan).slice(0, 12000)}
Do NOT apply live DB migrations, deploy, or touch secrets; if the plan needs one, implement the code and leave the
migration as a PROPOSAL (status stays 'implemented', note it in summary). When done, 'git add -A && git commit' your
work on this branch and set committed=true. If the plan cannot be implemented as written, set status='blocked' and
planInfeasible=true with blockedReason.`

phase('Build')
let build = await track('Build', () => agent(buildPrompt(), {
  label: 'build', phase: 'Build', model: R('build').model, effort: R('build').effort, schema: BUILD_SCHEMA,
}))

if (build && build.planInfeasible && kickbackAllowed(kb, 'build->plan')) {
  log(`Build kicked Plan back once: ${build.blockedReason}`)
  phase('Plan')
  plan = await track('Plan', () => agent(
    `You are Fable 5's Engineering Plan phase (Opus), REVISING after the builder hit a wall.
${CREED}
Builder's blocker: "${build.blockedReason}". Previous plan (JSON): ${JSON.stringify(plan).slice(0, 8000)}
Design (JSON): ${JSON.stringify(design).slice(0, 6000)}. Produce a corrected, buildable plan.`,
    { label: 'plan:re2', phase: 'Plan', model: R('plan').model, effort: R('plan').effort, schema: PLAN_SCHEMA },
  )) || plan
  phase('Build')
  build = await track('Build', () => agent(buildPrompt(), {
    label: 'build:re', phase: 'Build', model: R('build').model, effort: R('build').effort, schema: BUILD_SCHEMA,
  }))
}
if (!build || build.status !== 'implemented') {
  log(`Build did not implement (status=${build ? build.status : 'none'}). Stopping before QA.`)
  return { stopped: 'build', audit, design, plan, build }
}

// verify-gate + one repair pass
phase('Verify')
const gateCmd = gateCommand(cfg)
let gate = await agent(
  `You are Fable 5's gate runner. Run: ${gateCmd}
Report green=true ONLY if it exits 0; name the failing command in summary. Do not edit code.`,
  { label: 'gate', phase: 'Verify', model: 'opus', effort: 'low', schema: GATE_SCHEMA },
)
if (gate && !gate.green) {
  log(`Verify red — one repair pass. ${gate.summary}`)
  await track('Verify', () => agent(
    `You are Fable 5's Build phase (Sonnet), REPAIRING a red gate. ${CREED}
The gate '${gateCmd}' failed: ${gate.summary}. Fix ONLY what's needed to make it pass, on this branch, then commit.
Do not expand scope. If you cannot make it green, say so plainly.`,
    { label: 'build:repair', phase: 'Verify', model: R('build').model, effort: R('build').effort },
  ))
  gate = await agent(
    `You are Fable 5's gate runner. Re-run: ${gateCmd}. green=true only on exit 0; name the failing command. Do not edit code.`,
    { label: 'gate:re', phase: 'Verify', model: 'opus', effort: 'low', schema: GATE_SCHEMA },
  )
}
log(`Verify: ${gate && gate.green ? 'GREEN' : 'RED — QA will flag it'}`)
```

- [ ] **Step 2: Parse check + structural assertion**

Run:
```bash
node --check tools/fable5/fable5.js
grep -c "kickbackAllowed(kb, 'build->plan')" tools/fable5/fable5.js
grep -c "build:repair" tools/fable5/fable5.js
```
Expected: parse exit 0; both greps `1`.

- [ ] **Step 3: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "feat(fable5): build phase (Sonnet) + build->plan kickback + verify-gate/repair"
```

---

## Task 8: QA phase with adversarial refutation (U1)

Opus audits the branch diff and emits findings. Each finding is independently refuted by a skeptic agent (default refuted-if-uncertain); only survivors count. Findings are graded and carried to the report.

**Files:**
- Modify: `tools/fable5/fable5.js` (append after the Verify block)

**Interfaces:**
- Consumes: `QA_SCHEMA`, `REFUTE_SCHEMA`, `skillsForPhase`, `gate`, `build`, `audit`, `R`, `track`.
- Produces: run-scope const `confirmedBugs` (array of surviving findings, each with `.refuteReason`).

- [ ] **Step 1: Append the QA phase**

```js
// ---------------------------------------------------------------- QA (U1 adversarial refute)
phase('QA')
const qaSkills = skillsForPhase('qa', cfg, `${audit.buildTarget} ${audit.fileHints || ''}`)
const qa = await track('QA', () => agent(
  `You are Fable 5's QA / Audit & Security phase (Opus). ${CREED}
FIRST invoke these skills for domain correctness: ${JSON.stringify(qaSkills)} (Skill tool).
The build is on this fable5/* branch (gate was ${gate && gate.green ? 'GREEN' : 'RED: ' + (gate ? gate.summary : 'unknown')}).
Read the REAL diff (git diff master...HEAD) and the changed files. Find bugs, security issues, perf problems,
accessibility gaps, and inconsistencies. Grade each severity low/medium/high/blocker. Only surface findings you can
back with evidence from the actual diff.`,
  { label: 'qa', phase: 'QA', model: R('qa').model, effort: R('qa').effort, schema: QA_SCHEMA },
))
const rawFindings = (qa && qa.findings) || []

// refute each finding once (an LLM never grades an LLM's work unrefuted)
const verdicts = await parallel(rawFindings.map((f) => () =>
  agent(
    `You are an adversarial verifier for a QA finding on the current branch. ${CREED}
Finding: ${JSON.stringify(f)}
REFUTE it: read the real code at ${f.file} and the diff. Is this actually a real, reproducible problem in THIS diff,
or a false positive / pre-existing / out-of-scope? Default refuted=true unless you can confirm it's real and caused
by this change.`,
    { label: `refute:${(f.file || 'x').split('/').pop()}`, phase: 'QA', model: R('refuter').model, effort: R('refuter').effort, schema: REFUTE_SCHEMA },
  ).then((v) => ({ f, v })),
))
const confirmedBugs = verdicts.filter(Boolean).filter((x) => x.v && !x.v.refuted).map((x) => ({ ...x.f, refuteReason: x.v.reason }))
log(`QA: ${confirmedBugs.length}/${rawFindings.length} findings survived refutation.`)
```

- [ ] **Step 2: Parse check + structural assertion**

Run:
```bash
node --check tools/fable5/fable5.js
grep -c "refuted" tools/fable5/fable5.js
grep -c "confirmedBugs" tools/fable5/fable5.js
```
Expected: parse exit 0; both greps `>=1`.

- [ ] **Step 3: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "feat(fable5): QA phase with adversarial refutation"
```

---

## Task 9: Seal (tag) + report + memory update + token table

Tag the branch, write the run report (audit → design → plan → build → refute-verified bugs → founder-gated proposals → tokens-per-phase), update `.fable5/memory.md`, and return a compact summary.

**Files:**
- Modify: `tools/fable5/fable5.js` (append after the QA block; this is the end of the run body)

**Interfaces:**
- Consumes: `tokensByPhase`, `SEAL_SCHEMA`, all prior run-scope consts, `tokenLog`, `slug`.
- Produces: the workflow's final return object.

- [ ] **Step 1: Append the Report phase + final return**

```js
// ---------------------------------------------------------------- Seal + Report + Memory
phase('Report')
const seal = await agent(
  `You are Fable 5 sealing the run on the current fable5/* branch. ${CREED}
Get today's date via bash. Commit any uncommitted build output, then create an annotated git tag
'fable5/<today>-${slug}' pointing at HEAD. Do NOT merge to master. Return the tag and committed=true.`,
  { label: 'seal', phase: 'Report', model: R('orchestrator').model, effort: 'low', schema: SEAL_SCHEMA },
)

const costTable = tokensByPhase(tokenLog)
await agent(
  `You are Fable 5 writing the run REPORT to .fable5/reports/<today>-${slug}.md (date via bash). ${CREED}
Structure it for the founder:
- One-line outcome + the branch/tag: ${seal ? seal.tag : '(seal failed)'}.
- WHAT THE AUDIT DECIDED: ${JSON.stringify({ buildTarget: audit.buildTarget, rationale: audit.rationale }).slice(0, 2000)}
- THE DESIGN${design.prototypeUrl ? ` (clickable prototype: ${design.prototypeUrl})` : ''}: ${JSON.stringify(design.summary).slice(0, 1500)}
- THE PLAN: ${JSON.stringify(plan.steps).slice(0, 2000)}
- WHAT GOT BUILT: ${JSON.stringify(build.summary).slice(0, 1500)} — verify gate: ${gate && gate.green ? 'GREEN' : 'RED'}.
- VERIFIED BUGS/FIXES (refute-survivors only): ${JSON.stringify(confirmedBugs).slice(0, 4000)}
- FOUNDER-GATED PROPOSALS: any migrations/guarded actions the build left as proposals, plus design taste calls.
- TOKENS PER PHASE: ${JSON.stringify(costTable)}.
Then append to .fable5/memory.md: what was built (decision + rationale), any new tech debt, open bugs from QA, and
what the next sprint should tackle — so the next run builds on this instead of re-auditing from zero.
Remind the founder: master is untouched; merging the branch is their call (git reset --hard ${seal ? seal.tag : '<tag>'} to discard).`,
  { label: 'report', phase: 'Report', model: R('foreman').model, effort: R('foreman').effort },
)

return {
  vision, scope, slug,
  branchTag: seal ? seal.tag : null,
  buildTarget: audit.buildTarget,
  prototypeUrl: design.prototypeUrl || null,
  verifyGreen: !!(gate && gate.green),
  confirmedBugs: confirmedBugs.length,
  tokensByPhase: costTable,
}
```

- [ ] **Step 2: Parse check + structural assertion**

Run:
```bash
node --check tools/fable5/fable5.js
grep -c "fable5/<today>-" tools/fable5/fable5.js
grep -c "return {" tools/fable5/fable5.js
```
Expected: parse exit 0; first grep `>=2`; second grep `>=1`.

- [ ] **Step 3: Run the full helper test suite once more (regression)**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs`
Expected: all tests PASS (the appended run body must not have broken the HELPERS region extraction).

- [ ] **Step 4: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "feat(fable5): seal/tag + founder report + memory update + token table"
```

---

## Task 10: The `fable5` Skill front door + `.fable5/` scaffolding + deploy

Write the Skill that preflights the repo (clean tree, scaffold `.fable5/` on first run, cut/checkout the run branch) and launches the Workflow. Add the deploy script and scaffold this repo's `.fable5/`.

**Files:**
- Create: `tools/fable5/SKILL.md`
- Create: `tools/fable5/deploy.sh`
- Create: `tools/fable5/README.md`
- Create: `.fable5/config.json`, `.fable5/memory.md`, `.fable5/reports/.gitkeep`

**Interfaces:**
- Consumes: nothing (entry point). Produces: the deployed skill + workflow the user invokes as `/fable5` or "Fable 5, build X".

- [ ] **Step 1: Write the Skill front door**

Create `tools/fable5/SKILL.md`:

```markdown
---
name: fable5
description: Drive a vision through the five-phase Fable 5 build pipeline — Audit → Design → Plan → Build → QA — with real model-specialized sub-agents (Opus on Audit/Design/Plan/QA, Sonnet on Build, Fable 5 orchestrating), a persistent .fable5/ Project Memory, a clickable design prototype, adversarial QA, and a branch-only safety model. It NEVER merges to master. Use when the user says "Fable 5", "/fable5", "run the orchestrator", "build me X end-to-end", or "audit and build X". Scoped to one vision per run; for autonomous overnight app-wide improvement use crew-forge instead.
---

# Fable 5 Orchestrator — front door

You (the agent) preflight the repo, then launch the Fable 5 Workflow. The Workflow is the orchestrator; you are the launcher.

## When to use
- "Fable 5, build/audit/ship <X>" · "/fable5 <X>" · "run the orchestrator on <X>".
- One vision per run. Sibling: `crew-forge` (autonomous, app-wide, overnight). Fable 5 is you-launched and scoped.

## Preflight (do these IN ORDER, stop on the first failure)
1. **Get the vision + scope.** The vision is the user's words. Scope is `feature` (default) or `app` (whole-app audit fan-out). If the vision is unclear, ask ONE clarifying question, then proceed.
2. **Clean tree.** Run `git status --porcelain`. If dirty, stop and tell the user to commit/stash first.
3. **Scaffold `.fable5/` if missing.** If `.fable5/config.json` does not exist, create `.fable5/` from the templates in `tools/fable5/` (config.json, memory.md seeded from the repo's vision docs, reports/), and commit it.
4. **Cut the run branch.** Compute `slug` from the vision (lowercase, non-alphanumerics → `-`, capped 40). Create + checkout `fable5/$(date +%Y-%m-%d)-<slug>` from the current branch. (Build happens here; master is never touched.)
5. **Launch.** `Workflow({ name: 'fable5', args: { vision: "<vision>", scope: "<feature|app>" } })`. It runs in the background and notifies on completion.

## After the run
- Read `.fable5/reports/<date>-<slug>.md` — the run report (audit decision, design + prototype link, plan, what built, refute-verified bugs, founder-gated proposals, tokens/phase).
- Review the branch diff (`git diff master...HEAD`) and the prototype Artifact.
- **You** merge the branch to master, or `git reset --hard <tag>` to discard. Fable 5 never merges.

## Safety (binding)
Branch-only, tagged per run, never merged. No live migrations, deploys, secret access, or test/RLS weakening — those come back as founder-gated proposals in the report.
```

- [ ] **Step 2: Write the deploy script**

Create `tools/fable5/deploy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Deploy the Fable 5 engine from this repo to the global ~/.claude paths the loaders read.
CLAUDE_DIR="${CLAUDE_HOME:-$HOME/.claude}"
SRC="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$CLAUDE_DIR/workflows" "$CLAUDE_DIR/skills/fable5"
cp "$SRC/fable5.js" "$CLAUDE_DIR/workflows/fable5.js"
cp "$SRC/SKILL.md" "$CLAUDE_DIR/skills/fable5/SKILL.md"
echo "Deployed fable5.js -> $CLAUDE_DIR/workflows/ and SKILL.md -> $CLAUDE_DIR/skills/fable5/"
```

- [ ] **Step 3: Scaffold this repo's `.fable5/`**

Create `.fable5/config.json`:

```json
{
  "defaultScope": "feature",
  "verify": "npm run verify",
  "roles": {
    "orchestrator": { "model": "fable",  "effort": "high" },
    "foreman":      { "model": "fable",  "effort": "high" },
    "audit":        { "model": "opus",   "effort": "high" },
    "audit.lens":   { "model": "opus",   "effort": "high" },
    "design":       { "model": "opus",   "effort": "high" },
    "plan":         { "model": "opus",   "effort": "high" },
    "build":        { "model": "sonnet", "effort": "high" },
    "qa":           { "model": "opus",   "effort": "high" },
    "refuter":      { "model": "opus",   "effort": "low"  }
  },
  "phaseSkills": null
}
```

Create `.fable5/memory.md`:

```markdown
# Fable 5 — Project Memory (OnStandard / athleteos)

## Product Vision
OnStandard is honest athlete nutrition + performance: real habit formation over vanity metrics; coaches are the
buyers, parents pay, athletes are taught (not just scored).

## Features shipped
- (seed from git history / docs as runs proceed)

## Decisions (with rationale)
- Fable 5 never merges to master; the founder integrates. Rationale: LLM output is reviewed before it ships.

## Tech Debt
- (populated by QA + audit as runs proceed)

## Open Bugs
- (populated by QA)

## Roadmap
- (populated by audits)

## Launch Checklist
- See docs/LAUNCH-CHECKLIST.md
```

Create `.fable5/reports/.gitkeep` (empty file).

- [ ] **Step 4: Write the operator README**

Create `tools/fable5/README.md`:

```markdown
# Fable 5 Orchestrator

Source of truth for the Fable 5 engine. Edit here, test here, then deploy.

- `fable5.js` — the Workflow (five phases: Audit → Design → Plan → Build → QA).
- `fable5.helpers.test.mjs` — `node --test` suite for the pure decision logic (extracted from `fable5.js`).
- `SKILL.md` — the `/fable5` front door.
- `deploy.sh` — copies `fable5.js` + `SKILL.md` to `~/.claude/workflows/` and `~/.claude/skills/fable5/`.

## Develop
    cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js

## Deploy
    bash tools/fable5/deploy.sh

## Invoke
Say "Fable 5, build <X>" or `/fable5 <X>`. Per-repo memory + config live in `.fable5/`.
Review the branch + `.fable5/reports/<date>-<slug>.md`, then merge (or `git reset --hard <tag>` to discard).
```

- [ ] **Step 5: Deploy and verify the files landed**

Run:
```bash
bash tools/fable5/deploy.sh
node --check "/c/Users/Administrator/.claude/workflows/fable5.js"
test -f "/c/Users/Administrator/.claude/skills/fable5/SKILL.md" && echo "skill deployed"
```
Expected: deploy message printed; `node --check` exit 0; `skill deployed` printed.

- [ ] **Step 6: Commit**

```bash
git add tools/fable5/SKILL.md tools/fable5/deploy.sh tools/fable5/README.md .fable5/
git commit -m "feat(fable5): skill front door, deploy script, .fable5 scaffold, README"
```

---

## Task 11: Supervised end-to-end acceptance run (the real integration test)

Everything above proves the parts parse and the logic is correct. This task proves the orchestra actually plays, on a deliberately tiny, low-risk scope, with a human reviewing before merge.

**Files:** none created — this is an execution + observation task.

- [ ] **Step 1: Pick a trivially small vision and cut the branch**

Choose a low-risk, genuinely useful micro-vision (e.g. "add an empty-state message to the meal history list when there are no meals yet"). Preflight per the Skill: clean tree, `.fable5/` exists, then:

```bash
git checkout -b "fable5/$(date +%Y-%m-%d)-empty-state-meal-history"
```

- [ ] **Step 2: Launch Fable 5 on it**

Invoke: `Workflow({ name: 'fable5', args: { vision: "add an empty-state message to the meal history list when there are no meals yet", scope: "feature" } })`

Watch it in `/workflows` (or the `workflow-watch` skill, since this is the VS Code extension — see MEMORY.md).

- [ ] **Step 3: Verify the run produced the expected artifacts**

Confirm, with real commands:
```bash
git tag --list "fable5/*"                 # a tag exists for this run
ls .fable5/reports/                        # a <date>-empty-state-meal-history.md report exists
git log --oneline master..HEAD             # build commits are on the branch, not master
git rev-parse --abbrev-ref HEAD            # still on the fable5/* branch (never merged)
```
Expected: a `fable5/*` tag; a report file; build commits present on the branch; HEAD still on the fable5 branch.

- [ ] **Step 4: Read the report and eyeball the diff**

Read `.fable5/reports/<date>-empty-state-meal-history.md`. Confirm it has: the audit decision, the design (with prototype URL if UI), the plan, what built, the refute-verified bug list, and the tokens-per-phase table. Open the prototype Artifact. Run `git diff master...HEAD` and confirm the change matches the vision and nothing out of scope was touched.

- [ ] **Step 5: Confirm the verify-gate actually ran green on the branch**

Run: `npm run verify`
Expected: exit 0 (the branch build is green). If red, that's a real finding — file it and fix the engine, don't paper over it.

- [ ] **Step 6: Decide integration (founder step) and record the outcome**

If the change is good, this is where the *founder* would merge. For the acceptance test, either merge it or `git reset --hard <tag>`/`git checkout master` to discard — then note in the plan's PR/summary that the end-to-end run succeeded, with the tag name and the tokens-per-phase table as evidence.

- [ ] **Step 7: Commit any engine fixes surfaced by the run**

If Steps 3–5 exposed a bug in `fable5.js`, fix it in `tools/fable5/fable5.js`, re-run `node --test` + `node --check`, re-`deploy.sh`, and:

```bash
git add tools/fable5/fable5.js
git commit -m "fix(fable5): <what the acceptance run surfaced>"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Skill-launches-Workflow architecture → Tasks 1–9 (workflow) + Task 10 (skill). ✓
- One input (vision + scope) → Task 3 (args, scope default from config). ✓
- Five phases + model table (Opus×4, Sonnet build, Fable orchestrator) → Tasks 4–9 + `DEFAULT_ROLES`/config (Tasks 1, 10). ✓
- U1 adversarial QA → Task 8. ✓
- U2 bounded kickback (both seams) → Task 6 (plan→design) + Task 7 (build→plan), capped by `kickbackAllowed`. ✓
- U3 phases load domain skills → `skillsForPhase` (Task 1) wired in Tasks 5, 7, 8. ✓
- U4 clickable prototype → Task 5. ✓
- U5 scope-scaled audit → Task 4. ✓
- U6 early exit → Task 4 (`shouldEarlyExit`). ✓
- Verify-gate + one repair pass → Task 7. ✓
- Project Memory `.fable5/` (memory.md, reports/, config.json) → Task 10 scaffold; read in bootstrap/audit; updated in Task 9. ✓
- Safety rails (branch-only, never merge, no migrations/deploys/secrets) → `CREED` (Task 2) + seal (Task 9) + Skill (Task 10). ✓
- Deliverables (branch+tag, prototype, report with token table, updated memory) → Task 9. ✓
- Reuse on another repo → `deploy.sh` + `.fable5/` per-repo (Task 10) + README. ✓
- "What this is NOT" scope guards → encoded in Skill description + README (crew-forge for autonomous). ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases" left in steps; the `.fable5/memory.md` "(seed from…)" lines are intentional living-document placeholders, not plan gaps. ✓

**Type consistency:** `resolveRole`/`R(role)` role keys match `DEFAULT_ROLES` and `.fable5/config.json` (orchestrator, foreman, audit, audit.lens, design, plan, build, qa, refuter). Schema names (`AUDIT_SCHEMA` … `SEAL_SCHEMA`) are used exactly as defined. `kb`/`kickbackAllowed(kb, seam)` seam strings (`plan->design`, `build->plan`) are consistent between Tasks 6–7. `design` is `let` (Tasks 5–6). `tokenLog`/`track`/`tokensByPhase` consistent (Tasks 3, 9). ✓

**Note on TDD shape:** pure decision logic is genuinely test-first (Tasks 1–2). Agent-wired phase bodies (Tasks 3–9) can't be unit-tested in the sandbox; they're gated by `node --check` + structural asserts and proven by the supervised end-to-end run (Task 11) — stated honestly rather than faked with hollow tests.
