# Fable 5 Foreman Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fable5's fixed 5-phase pipeline with a Foreman-staffed run: one new Staffing phase decides, per vision, which of Audit/Design/Plan/Build/QA this run needs and which curated specialist persona staffs each one.

**Architecture:** Add a `Staffing` phase right after Bootstrap that produces a `RunPlan` (task type, ordered phase subset, persona per phase, effort overrides) via a schema-validated Opus/Fable call. The existing linear phase blocks in `tools/fable5/fable5.js` stay linear (no generic dispatch loop — lower risk, same outcome) but each gets wrapped in an inclusion check against `runPlan.phases`, reads its persona text from a small curated library instead of a fixed generic voice, and reads its effort from `runPlan.depth` when the Foreman overrode it. Personas are stored inline as `DEFAULT_PERSONAS` next to the existing `DEFAULT_ROLES` (not a separate JSON file) — same override pattern (`.fable5/config.json`), no new deploy step, no runtime file reads. Deviates from `docs/superpowers/specs/2026-07-22-fable5-foreman-upgrade-design.md` in these two ways for simplicity; spec intent (curated small library, Foreman decides everything, safety unchanged) is otherwise followed exactly.

**Tech Stack:** Plain JS Workflow script (`tools/fable5/fable5.js`, no TypeScript, no filesystem/Node API access inside the script body — all repo access happens through spawned `agent()` calls), `node --test` for the pure-helper unit suite (`tools/fable5/fable5.helpers.test.mjs`), `node --check` for syntax validation.

## Global Constraints

- `fable5.js` must keep exactly one top-level `export` (`export const meta = {...}`) — the Workflow runtime executes everything after it as an async function body; a second top-level `export` throws at launch. Verified by the existing "obeys the Workflow runtime model" test — do not break it.
- The `HELPERS:START` / `HELPERS:END` sentinel comments in `fable5.js` must keep bracketing every pure helper as plain `const` (not `export`) — `fable5.helpers.test.mjs` extracts that exact region by string search and re-exports it itself. New helpers go inside this region.
- Every new/changed helper name used inside `fable5.helpers.test.mjs`'s `EXPORTS` template string (line 19) must exist verbatim in the HELPERS region, or the dynamic import throws `SyntaxError` at test load.
- Safety rails are non-negotiable and unaffected by this change: branch-only, never merged to master, no live DB migrations/deploys/secrets, no test/RLS weakening. These live in the `CREED` constant injected into every phase prompt — do not remove or weaken it.
- Run `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js` after every task and confirm all tests pass before committing.
- Deploy with `bash tools/fable5/deploy.sh` only in the final task, once everything is green — it copies `fable5.js`/`SKILL.md` to `~/.claude/workflows/` and `~/.claude/skills/fable5/`, which is what actually makes the change live.

---

### Task 1: Persona library + RunPlan normalization (pure helpers, TDD)

**Files:**
- Modify: `tools/fable5/fable5.js:20-34` (HELPERS region — add after `resolveRole`)
- Modify: `tools/fable5/fable5.helpers.test.mjs:19` (EXPORTS line) and end of file (new tests)

**Interfaces:**
- Produces: `CANONICAL_PHASES: string[]` (`['audit','design','plan','build','qa']`), `DEFAULT_PERSONAS: Record<string,string>`, `resolvePersona(config, key): string`, `normalizeRunPlan(raw): RunPlan`, `effortFor(config, runPlan, role, phaseKey): 'low'|'high'` — consumed by Task 2 (schema) and Tasks 3-8 (phase wiring).
- `RunPlan` shape produced by `normalizeRunPlan`: `{ taskType: string, rationale: string, phases: string[] (subset of CANONICAL_PHASES, always includes 'audit', preserves canonical order, drops 'qa' if 'build' absent), auditMode: 'single'|'lenses', auditLenses: string[]|null, personas: Record<phase,string> (only keys for phases present, default 'generalist'), depth: Record<phase,'low'|'high'> }`.

- [ ] **Step 1: Write the failing tests**

Append to `tools/fable5/fable5.helpers.test.mjs` (before the final closing of the file, after the existing `isPlainSchema` test):

```js
test('resolvePersona: config override wins, else DEFAULT_PERSONAS, else generalist', () => {
  assert.equal(H.resolvePersona({ personas: { growth: 'custom blurb' } }, 'growth'), 'custom blurb')
  assert.equal(H.resolvePersona({}, 'growth'), H.DEFAULT_PERSONAS.growth)
  assert.equal(H.resolvePersona({}, 'nonexistent-key'), H.DEFAULT_PERSONAS.generalist)
})

test('normalizeRunPlan: always includes audit first, preserves canonical order, filters unknown phases', () => {
  assert.deepEqual(H.normalizeRunPlan({ phases: ['qa', 'build', 'audit'] }).phases, ['audit', 'build', 'qa'])
  assert.deepEqual(H.normalizeRunPlan({ phases: ['audit', 'bogus', 'build'] }).phases, ['audit', 'build'])
  assert.deepEqual(H.normalizeRunPlan({}).phases, ['audit'])
})

test('normalizeRunPlan: drops qa when build is not requested', () => {
  assert.deepEqual(H.normalizeRunPlan({ phases: ['qa'] }).phases, ['audit'])
  assert.deepEqual(H.normalizeRunPlan({ phases: ['audit', 'build', 'qa'] }).phases, ['audit', 'build', 'qa'])
})

test('normalizeRunPlan: defaults persona to generalist only for included phases', () => {
  const rp = H.normalizeRunPlan({ phases: ['audit', 'build'], personas: { audit: 'security' } })
  assert.deepEqual(rp.personas, { audit: 'security', build: 'generalist' })
  assert.equal(rp.personas.design, undefined)
})

test('normalizeRunPlan: defaults taskType/rationale/auditMode/auditLenses when missing', () => {
  const rp = H.normalizeRunPlan(null)
  assert.equal(rp.taskType, 'unspecified')
  assert.equal(rp.rationale, '')
  assert.equal(rp.auditMode, 'single')
  assert.equal(rp.auditLenses, null)
})

test('normalizeRunPlan: auditMode only becomes lenses on exact match, auditLenses passes through arrays', () => {
  assert.equal(H.normalizeRunPlan({ auditMode: 'lenses' }).auditMode, 'lenses')
  assert.equal(H.normalizeRunPlan({ auditMode: 'bogus' }).auditMode, 'single')
  assert.deepEqual(H.normalizeRunPlan({ auditLenses: ['a', 'b'] }).auditLenses, ['a', 'b'])
})

test('effortFor: runPlan.depth override wins, else role default from resolveRole', () => {
  assert.equal(H.effortFor({}, { depth: { build: 'low' } }, 'build', 'build'), 'low')
  assert.equal(H.effortFor({}, {}, 'build', 'build'), 'high')
  assert.equal(H.effortFor({}, null, 'build', 'build'), 'high')
})
```

Update the `EXPORTS` template string (line 19) to add the new names:

```js
const EXPORTS = `\nexport { slugify, DEFAULT_ROLES, resolveRole, mergeConfig, auditModeForScope, shouldEarlyExit, makeKickbacks, kickbackAllowed, skillsForPhase, gateCommand, tokensByPhase, isPlainSchema, normalizeArgs, CANONICAL_PHASES, DEFAULT_PERSONAS, resolvePersona, normalizeRunPlan, effortFor };\n`
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs`
Expected: FAIL — `TypeError: Cannot read properties of undefined` (or similar) on `H.resolvePersona`/`H.normalizeRunPlan`/`H.effortFor`/`H.DEFAULT_PERSONAS`/`H.CANONICAL_PHASES`, since none exist yet.

- [ ] **Step 3: Implement the helpers**

In `tools/fable5/fable5.js`, insert this block immediately after the closing `}` of `resolveRole` (after line 33, before the `mergeConfig` declaration on line 35):

```js
const CANONICAL_PHASES = ['audit', 'design', 'plan', 'build', 'qa']

const DEFAULT_PERSONAS = {
  growth: 'Channel a retention- and monetization-obsessed growth PM. Judge everything by: will this bring people back tomorrow, and does it justify someone paying for it.',
  security: 'Channel a paranoid, defense-first security reviewer. Assume hostile input everywhere; look for data exposure, auth edges, and privilege leaks first.',
  ux: 'Channel a friction-obsessed UX lead. Count taps, chase confusing flows, and never let empty/loading/error states go undesigned.',
  infra: 'Channel an infrastructure and migration specialist. Weigh architecture risk, scaling limits, and fragile seams over surface polish.',
  content: 'Channel a words-first content specialist. Copy, tone, and clarity of language lead; visuals and mechanics are secondary.',
  bugfix: 'Channel a surgical bugfix engineer. Find the smallest correct change; never drive-by refactor or expand scope beyond the reported problem.',
  research: 'Channel an exploratory researcher. Depth and honesty of investigation matter more than speed to a build; it is fine to conclude nothing should be built.',
  generalist: 'A capable, well-rounded generalist with no particular axe to grind - the default judgment when nothing more specific fits this vision.',
}

const resolvePersona = (config, key) =>
  (config && config.personas && config.personas[key]) || DEFAULT_PERSONAS[key] || DEFAULT_PERSONAS.generalist

const normalizeRunPlan = (raw) => {
  const requested = new Set(((raw && raw.phases) || []).filter((p) => CANONICAL_PHASES.includes(p)))
  requested.add('audit')
  if (!requested.has('build')) requested.delete('qa')
  const phases = CANONICAL_PHASES.filter((p) => requested.has(p))
  const personas = {}
  for (const p of phases) personas[p] = (raw && raw.personas && raw.personas[p]) || 'generalist'
  return {
    taskType: (raw && raw.taskType) || 'unspecified',
    rationale: (raw && raw.rationale) || '',
    phases,
    auditMode: (raw && raw.auditMode === 'lenses') ? 'lenses' : 'single',
    auditLenses: (raw && Array.isArray(raw.auditLenses)) ? raw.auditLenses : null,
    personas,
    depth: (raw && raw.depth) || {},
  }
}

const effortFor = (config, runPlan, role, phaseKey) =>
  (runPlan && runPlan.depth && runPlan.depth[phaseKey]) || resolveRole(config, role).effort
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js`
Expected: all tests PASS, `node --check` exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add tools/fable5/fable5.js tools/fable5/fable5.helpers.test.mjs
git commit -m "$(cat <<'EOF'
feat(fable5): add persona library + RunPlan normalization helpers

Pure, unit-tested groundwork for the Foreman upgrade: a curated persona
library (growth/security/ux/infra/content/bugfix/research/generalist)
and normalizeRunPlan, which enforces audit-always-first, canonical phase
ordering, and qa-requires-build.
EOF
)"
```

---

### Task 2: RunPlan schema, meta.phases, and the staffing role

**Files:**
- Modify: `tools/fable5/fable5.js:1-14` (meta.phases)
- Modify: `tools/fable5/fable5.js:20-30` (DEFAULT_ROLES)
- Modify: `tools/fable5/fable5.js:89-96` (schemas — insert STAFFING_SCHEMA before AUDIT_SCHEMA)
- Modify: `.fable5/config.json` (add `staffing` role, matching the file's exhaustive-listing style)

**Interfaces:**
- Consumes: nothing new (schema is a plain object literal).
- Produces: `STAFFING_SCHEMA` (JSON Schema) — consumed by Task 3's Staffing agent call. `DEFAULT_ROLES.staffing = { model: 'fable', effort: 'high' }` — consumed via `R('staffing')` in Task 3.

- [ ] **Step 1: Update `meta.phases`**

Replace the `phases` array in `export const meta` (lines 4-13) with:

```js
  phases: [
    { title: 'Bootstrap', detail: 'read .fable5 config + memory, confirm clean tree on a fable5/* branch' },
    { title: 'Staffing', detail: 'the Foreman decides which phases this run needs and who staffs each one' },
    { title: 'Audit', detail: 'staffed persona audits the vision against memory + repo (parallel lenses when the Foreman calls for them)' },
    { title: 'Design', detail: 'staffed persona designs screens/flows/states when the Foreman included Design; publishes a clickable prototype when UI is involved' },
    { title: 'Plan', detail: 'staffed persona writes the engineering plan when the Foreman included Plan (may kick Design back once)' },
    { title: 'Build', detail: 'staffed persona implements on the branch (may kick Plan back once when Plan ran)' },
    { title: 'Verify', detail: 'run the repo verify command; one repair pass on red' },
    { title: 'QA', detail: 'staffed persona audits the diff when the Foreman included QA; each finding is adversarially refuted before it counts' },
    { title: 'Report', detail: 'tag the branch, write the run report + staffing rationale + token table, update memory' },
  ],
```

Also update the `description` field (line 3) to:

```js
  description: 'Drive a vision through a Foreman-staffed pipeline - the Foreman decides which of Audit/Design/Plan/Build/QA this run needs and who staffs each one - with a persistent Project Memory and a branch-only safety model. You launch it; it never merges to master.',
```

- [ ] **Step 2: Add the `staffing` role to `DEFAULT_ROLES`**

In `tools/fable5/fable5.js`, change:

```js
const DEFAULT_ROLES = {
  orchestrator: { model: 'fable',  effort: 'high' },
  foreman:      { model: 'fable',  effort: 'high' },
```

to:

```js
const DEFAULT_ROLES = {
  orchestrator: { model: 'fable',  effort: 'high' },
  foreman:      { model: 'fable',  effort: 'high' },
  staffing:     { model: 'fable',  effort: 'high' },
```

- [ ] **Step 3: Add `STAFFING_SCHEMA`**

In `tools/fable5/fable5.js`, immediately before the `const AUDIT_SCHEMA = {` line (line 97), insert:

```js
const STAFFING_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['taskType', 'rationale', 'phases', 'auditMode'],
  properties: {
    taskType: { type: 'string' },
    rationale: { type: 'string' },
    phases: { type: 'array', items: { type: 'string', enum: ['audit', 'design', 'plan', 'build', 'qa'] } },
    auditMode: { type: 'string', enum: ['single', 'lenses'] },
    auditLenses: { type: 'array', items: { type: 'string' } },
    personas: {
      type: 'object', additionalProperties: false,
      properties: {
        audit: { type: 'string' }, design: { type: 'string' }, plan: { type: 'string' },
        build: { type: 'string' }, qa: { type: 'string' },
      },
    },
    depth: {
      type: 'object', additionalProperties: false,
      properties: {
        audit: { type: 'string', enum: ['low', 'high'] }, design: { type: 'string', enum: ['low', 'high'] },
        plan: { type: 'string', enum: ['low', 'high'] }, build: { type: 'string', enum: ['low', 'high'] },
        qa: { type: 'string', enum: ['low', 'high'] },
      },
    },
  },
}
```

- [ ] **Step 4: Add the `staffing` role to `.fable5/config.json`**

This repo's `.fable5/config.json` lists every `DEFAULT_ROLES` entry explicitly (a full mirror, not just overrides). Keep that pattern consistent — change:

```json
    "orchestrator": { "model": "fable",  "effort": "high" },
    "foreman":      { "model": "fable",  "effort": "high" },
```

to:

```json
    "orchestrator": { "model": "fable",  "effort": "high" },
    "foreman":      { "model": "fable",  "effort": "high" },
    "staffing":     { "model": "fable",  "effort": "high" },
```

- [ ] **Step 5: Verify**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js`
Expected: all tests PASS (unchanged from Task 1 — this task adds no new pure helpers), `node --check` exits 0. Also run `node -e "JSON.parse(require('fs').readFileSync('../../.fable5/config.json','utf8'))"` from `tools/fable5/` to confirm the config JSON is still valid.

- [ ] **Step 6: Commit**

```bash
git add tools/fable5/fable5.js .fable5/config.json
git commit -m "$(cat <<'EOF'
feat(fable5): add Staffing to meta.phases, STAFFING_SCHEMA, staffing role

Groundwork for the Foreman's structured RunPlan output; no behavior
change yet (the Staffing agent call itself lands in the next commit).
EOF
)"
```

---

### Task 3: Wire the Staffing (Foreman) phase

**Files:**
- Modify: `tools/fable5/fable5.js:198-230` (from `const A = normalizeArgs(args)` through the `log('Fable 5 - ...')` line, just before the Audit section comment)

**Interfaces:**
- Consumes: `normalizeRunPlan`, `STAFFING_SCHEMA`, `auditModeForScope` (existing), `R('staffing')` from Task 1/2.
- Produces: `runPlan: RunPlan` (module-scope `const`, in execution order) — consumed by every later phase (Tasks 4-8). `scope` becomes an optional hint (may be `''`), no longer defaults to `'feature'` at the point it's read into the Foreman prompt (the config-level `defaultScope` still defaults to `'feature'` in `DEFAULT_CONFIG` — unchanged — this only changes how the *value* is used downstream, from a hard switch to a hint string).

- [ ] **Step 1: Replace the scope/log block and add the Staffing call**

Find this block (lines ~216-229 in the current file):

```js
const cfg = mergeConfig(DEFAULT_CONFIG, boot.config || {})
const scope = A.scope || cfg.defaultScope || 'feature'
const slug = slugify(vision)
const R = (role) => resolveRole(cfg, role)
const tokenLog = []
const track = async (name, fn) => { const t0 = budget.spent(); const r = await fn(); tokenLog.push({ phase: name, tokens: budget.spent() - t0 }); return r }
// Degrade a schema agent that exhausts its StructuredOutput retry cap to null (the phase's
// own null-guard then stops cleanly) instead of crashing the whole run.
const safeAgent = async (prompt, opts) => {
  try { return await agent(prompt, opts) }
  catch (e) { log(`[${(opts && opts.label) || 'agent'}] failed (${String((e && e.message) || e).slice(0, 140)}) - degrading to null`); return null }
}
const LEAN = `STRUCTURED-OUTPUT DISCIPLINE (critical): your StructuredOutput MUST be compact or it gets truncated and rejected. NEVER paste HTML, code, or long prose into any field; keep each string field to a few sentences. Put full detail in files/artifacts, not in the structured object - it is a short INDEX, not the deliverable.`
log(`Fable 5 - vision="${vision}" scope=${scope} slug=${slug}`)

// ---------------------------------------------------------------- Audit (U5 + U6)
```

Replace it with:

```js
const cfg = mergeConfig(DEFAULT_CONFIG, boot.config || {})
const scope = A.scope || cfg.defaultScope || ''
const slug = slugify(vision)
const R = (role) => resolveRole(cfg, role)
const tokenLog = []
const track = async (name, fn) => { const t0 = budget.spent(); const r = await fn(); tokenLog.push({ phase: name, tokens: budget.spent() - t0 }); return r }
// Degrade a schema agent that exhausts its StructuredOutput retry cap to null (the phase's
// own null-guard then stops cleanly) instead of crashing the whole run.
const safeAgent = async (prompt, opts) => {
  try { return await agent(prompt, opts) }
  catch (e) { log(`[${(opts && opts.label) || 'agent'}] failed (${String((e && e.message) || e).slice(0, 140)}) - degrading to null`); return null }
}
const LEAN = `STRUCTURED-OUTPUT DISCIPLINE (critical): your StructuredOutput MUST be compact or it gets truncated and rejected. NEVER paste HTML, code, or long prose into any field; keep each string field to a few sentences. Put full detail in files/artifacts, not in the structured object - it is a short INDEX, not the deliverable.`
log(`Fable 5 - vision="${vision}"${scope ? ` scope-hint=${scope}` : ''} slug=${slug}`)

// ---------------------------------------------------------------- Staffing (the Foreman decides the run's shape)
phase('Staffing')
const scopeHint = scope ? auditModeForScope(scope) : 'single'
const rawRunPlan = await track('Staffing', () => safeAgent(
  `You are Fable 5 (the Foreman) staffing THIS run. ${CREED}
The founder's vision, in their own words: "${vision}"${scope ? ` (they hinted scope="${scope}")` : ''}.
Decide, for THIS vision only:
1) taskType - your own label for what kind of job this is (e.g. "quick-fix", "new-feature", "audit-only", "refactor",
   "content", "research" - or a better label if none of those fit). Do not force it into a category that doesn't fit.
2) phases - which of audit/design/plan/build/qa this run actually needs. audit always runs. A trivial, well-understood
   fix needs audit+build+qa and nothing else. "just look into X, don't build anything" needs audit alone. A genuine
   new feature or anything touching UI usually wants all five. Think like a manager staffing a job, not a checklist.
3) auditMode - "single" for a focused audit, "lenses" for a parallel multi-angle audit (retention/monetization/ux/
   tech-debt) when the vision is broad or ambiguous enough to need more than one perspective (their scope hint, if
   any, suggests "${scopeHint}" as a default - override it if you have a better reason).
4) personas - for each phase you included, pick the ONE persona that best fits from: growth, security, ux, infra,
   content, bugfix, research, generalist. Use generalist when nothing else clearly fits.
5) depth - optionally override effort ("low"|"high") per included phase if this job is simple enough to not need
   full depth, or gnarly enough to need more.
Read .fable5/memory.md first so you're staffing this run in light of what's already been decided.
${LEAN}`,
  { label: 'staffing', phase: 'Staffing', model: R('staffing').model, effort: R('staffing').effort, schema: STAFFING_SCHEMA },
))
const runPlan = normalizeRunPlan(rawRunPlan)
log(`Staffing: taskType=${runPlan.taskType} phases=[${runPlan.phases.join(',')}] - ${runPlan.rationale}`)

// ---------------------------------------------------------------- Audit (U5 + U6)
```

- [ ] **Step 2: Verify**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js`
Expected: all tests PASS, `node --check` exits 0. (The Staffing call itself isn't unit-testable — it invokes the real `agent()` — this step only confirms the file is still syntactically valid and the untouched pure-helper suite still passes.)

- [ ] **Step 3: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "$(cat <<'EOF'
feat(fable5): wire the Staffing (Foreman) phase

One new Opus/Fable call right after Bootstrap produces a normalized
RunPlan (taskType, phase subset, personas, effort overrides). Later
phases aren't wired to read it yet - that lands over the next commits.
EOF
)"
```

---

### Task 4: Audit phase reads the RunPlan; audit-only / early-exit branch

**Files:**
- Modify: `tools/fable5/fable5.js:231-280` (Audit block through `log('Audit: buildTarget = ...')`)

**Interfaces:**
- Consumes: `runPlan` (Task 3), `resolvePersona`, `effortFor` (Task 1).
- Produces: `audit` (unchanged shape — `AUDIT_SCHEMA`), `auditMode`/`auditPersona`/`auditEffort` (local), and the audit-only early-exit branch now covers two distinct reasons — consumed by Task 5 onward exactly as `audit` was before.

- [ ] **Step 1: Replace the Audit block**

Find this block (the `phase('Audit')` comment through the line `log(\`Audit: buildTarget = ${audit.buildTarget}\`)`):

```js
// ---------------------------------------------------------------- Audit (U5 + U6)
phase('Audit')
const auditMode = auditModeForScope(scope)
const auditBase = `You are Fable 5's Product Audit (Opus). ${CREED}
The founder's vision: "${vision}". Scope: ${scope}.
Audit the CURRENT repo against this vision and .fable5/memory.md. Find the real gaps, UX issues, and the single
highest-value thing to build now. Be honest: if this vision is already met, or not worth building right now, say so
(worthBuilding=false) - do NOT manufacture work. Set touchesUIHint if the build will touch UI, and put concrete
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
  log('Audit: nothing worth building - early exit.')
  return { stopped: 'not-worth-building', audit }
}
log(`Audit: buildTarget = ${audit.buildTarget}`)
```

Replace it with:

```js
// ---------------------------------------------------------------- Audit (U5 + U6)
phase('Audit')
const auditMode = runPlan.auditMode
const auditPersona = resolvePersona(cfg, runPlan.personas.audit)
const auditEffort = effortFor(cfg, runPlan, 'audit', 'audit')
const auditBase = `You are Fable 5's Product Audit. ${auditPersona} ${CREED}
The founder's vision: "${vision}". Task type (from Staffing): ${runPlan.taskType} - ${runPlan.rationale}
Audit the CURRENT repo against this vision and .fable5/memory.md. Find the real gaps, UX issues, and the single
highest-value thing to build now. Be honest: if this vision is already met, or not worth building right now, say so
(worthBuilding=false) - do NOT manufacture work. Set touchesUIHint if the build will touch UI, and put concrete
path hints (files/dirs likely involved) in fileHints. Ground every claim in a file you actually read.`

let audit
if (auditMode === 'lenses') {
  const LENSES = (runPlan.auditLenses && runPlan.auditLenses.length)
    ? runPlan.auditLenses.map((focus, i) => ({ key: `lens${i + 1}`, focus }))
    : [
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
    `You are Fable 5's audit synthesizer. ${auditPersona} ${CREED}
Fold these ${lensResults.length} lens audits (JSON) into ONE AuditReport for the whole app. Pick the single
buildTarget with the best impact-per-effort; set worthBuilding honestly. Lenses:
${JSON.stringify(lensResults).slice(0, 14000)}`,
    { label: 'audit:synth', phase: 'Audit', model: R('audit').model, effort: auditEffort, schema: AUDIT_SCHEMA },
  ))
} else {
  audit = await track('Audit', () => agent(auditBase, {
    label: 'audit', phase: 'Audit', model: R('audit').model, effort: auditEffort, schema: AUDIT_SCHEMA,
  }))
}

const auditOnlyByDesign = !runPlan.phases.includes('build')
if (shouldEarlyExit(audit) || auditOnlyByDesign) {
  phase('Report')
  const reason = shouldEarlyExit(audit)
    ? `The audit concluded there is nothing worth building for vision "${vision}" right now.`
    : `The Foreman staffed this as an audit-only run (taskType=${runPlan.taskType}: ${runPlan.rationale}) - no build was ever attempted, by design.`
  await agent(
    `You are Fable 5. Write a SHORT report to .fable5/reports/<today>-${slug}.md (get today's date via bash).
${CREED}
${reason} Explain the outcome in the founder's terms, cite the evidence from the audit, and (if nothing was worth
building) suggest what WOULD be worth doing. Audit JSON:
${JSON.stringify(audit).slice(0, 6000)}`,
    { label: 'report:early-exit', phase: 'Report', model: R('foreman').model, effort: R('foreman').effort },
  )
  log(shouldEarlyExit(audit) ? 'Audit: nothing worth building - early exit.' : 'Staffing: audit-only run - stopping after Audit by design.')
  return { stopped: shouldEarlyExit(audit) ? 'not-worth-building' : 'audit-only', audit, runPlan }
}
log(`Audit: buildTarget = ${audit.buildTarget}`)
```

- [ ] **Step 2: Verify**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js`
Expected: all tests PASS, `node --check` exits 0.

- [ ] **Step 3: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "$(cat <<'EOF'
feat(fable5): Audit phase reads the RunPlan; first-class audit-only exit

Audit now uses the Foreman's auditMode/auditLenses/persona/effort
instead of the scope-derived defaults. A run the Foreman staffed as
audit-only (no 'build' in phases) now stops cleanly after Audit with
its own report framing, distinct from the existing worthBuilding=false
early exit.
EOF
)"
```

---

### Task 5: Design phase becomes conditional and persona-staffed

**Files:**
- Modify: `tools/fable5/fable5.js:282-297` (Design block)

**Interfaces:**
- Consumes: `runPlan.phases`, `resolvePersona`, `effortFor` (Task 1); `audit` (Task 4).
- Produces: `let design` — now `null` when the Foreman didn't include `'design'` in `runPlan.phases`. Consumed by Task 6 (Plan) and Task 7 (Build), both already written to handle `design === null` in this plan.

- [ ] **Step 1: Replace the Design block**

Find:

```js
// ---------------------------------------------------------------- Design (U3 + U4)
phase('Design')
const designSkills = skillsForPhase('design', cfg, `${audit.buildTarget} ${audit.fileHints || ''}`)
let design = await track('Design', () => safeAgent(
  `You are Fable 5's UX/UI Design phase (Opus). ${CREED}
FIRST invoke these skills so your design meets the bar: ${JSON.stringify(designSkills)} (use the Skill tool).
Build target (from the audit): ${JSON.stringify({ buildTarget: audit.buildTarget, uxIssues: audit.uxIssues, touchesUIHint: audit.touchesUIHint })}
Design every screen, flow, and state (empty / loading / error / success). Set touchesUI honestly.
IF touchesUI is true: build a real, self-contained HTML mockup of the primary screen(s) and PUBLISH it with the
Artifact tool (favicon: a fitting dial or gauge emoji); put the returned artifact URL in prototypeUrl so the founder can click it BEFORE any
code is written. If touchesUI is false, leave prototypeUrl empty.
${LEAN} Concretely: summary <= 600 chars; screens <= 6 items, each name <= 40 chars and purpose <= 120 chars; states is just the label list (e.g. ["empty","loading","error"]). The full design belongs in the published prototype - you MAY also append a longer write-up to .fable5/reports/ via bash - but the StructuredOutput stays lean.`,
  { label: 'design', phase: 'Design', model: R('design').model, effort: R('design').effort, schema: DESIGN_SCHEMA },
))
if (!design) { log('Design failed - stopping.'); return { stopped: 'design', audit } }
log(`Design: ${design.screens.length} screen(s)${design.prototypeUrl ? ` - prototype ${design.prototypeUrl}` : ''}`)
```

Replace it with:

```js
// ---------------------------------------------------------------- Design (U3 + U4)
let design = null
if (runPlan.phases.includes('design')) {
  phase('Design')
  const designPersona = resolvePersona(cfg, runPlan.personas.design)
  const designEffort = effortFor(cfg, runPlan, 'design', 'design')
  const designSkills = skillsForPhase('design', cfg, `${audit.buildTarget} ${audit.fileHints || ''}`)
  design = await track('Design', () => safeAgent(
    `You are Fable 5's UX/UI Design phase. ${designPersona} ${CREED}
FIRST invoke these skills so your design meets the bar: ${JSON.stringify(designSkills)} (use the Skill tool).
Build target (from the audit): ${JSON.stringify({ buildTarget: audit.buildTarget, uxIssues: audit.uxIssues, touchesUIHint: audit.touchesUIHint })}
Design every screen, flow, and state (empty / loading / error / success). Set touchesUI honestly.
IF touchesUI is true: build a real, self-contained HTML mockup of the primary screen(s) and PUBLISH it with the
Artifact tool (favicon: a fitting dial or gauge emoji); put the returned artifact URL in prototypeUrl so the founder can click it BEFORE any
code is written. If touchesUI is false, leave prototypeUrl empty.
${LEAN} Concretely: summary <= 600 chars; screens <= 6 items, each name <= 40 chars and purpose <= 120 chars; states is just the label list (e.g. ["empty","loading","error"]). The full design belongs in the published prototype - you MAY also append a longer write-up to .fable5/reports/ via bash - but the StructuredOutput stays lean.`,
    { label: 'design', phase: 'Design', model: R('design').model, effort: designEffort, schema: DESIGN_SCHEMA },
  ))
  if (!design) { log('Design failed - stopping.'); return { stopped: 'design', audit, runPlan } }
  log(`Design: ${design.screens.length} screen(s)${design.prototypeUrl ? ` - prototype ${design.prototypeUrl}` : ''}`)
} else {
  log('Staffing: Design not needed for this run - skipped.')
}
```

- [ ] **Step 2: Verify**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js`
Expected: all tests PASS, `node --check` exits 0.

- [ ] **Step 3: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "$(cat <<'EOF'
feat(fable5): Design phase is conditional on the RunPlan, persona-staffed

design is now null when the Foreman didn't include 'design' - Plan and
Build (next commits) are written to handle that.
EOF
)"
```

---

### Task 6: Plan phase becomes conditional, persona-staffed, design-optional

**Files:**
- Modify: `tools/fable5/fable5.js:299-330` (Plan block, `const kb = makeKickbacks()` through `log(\`Plan: ...\`)`)

**Interfaces:**
- Consumes: `runPlan.phases`, `resolvePersona`, `effortFor` (Task 1); `audit` (Task 4); `design` (Task 5, may be `null`).
- Produces: `let plan` — `null` when the Foreman didn't include `'plan'`, or when `design` is `null` the plan prompt now reads from `audit` directly instead of `design`. `kb` (kickback tracker) is created unconditionally (still needed by Task 7's build→plan kickback). Consumed by Task 7 (Build) and Task 8 (Report), both written in this plan to handle `plan === null`.

- [ ] **Step 1: Replace the Plan block**

Find:

```js
// ---------------------------------------------------------------- Plan (+ U2 kickback)
const kb = makeKickbacks()
const planPrompt = () => `You are Fable 5's Engineering Plan phase (Opus). ${CREED}
Design spec (JSON): ${JSON.stringify(design).slice(0, 12000)}
Write the concrete implementation plan for THIS repo: exact files to create/modify, data changes, APIs, migrations
(as PROPOSALS - never applied here), risks, and an ordered step list a builder can follow. If the design cannot be
built as specified, set designFeasible=false and put the precise reason in infeasibleReason.
${LEAN} Keep each step/file entry to one line; no code blocks in the structured fields.`

phase('Plan')
let plan = await track('Plan', () => safeAgent(planPrompt(), {
  label: 'plan', phase: 'Plan', model: R('plan').model, effort: R('plan').effort, schema: PLAN_SCHEMA,
}))

if (plan && plan.designFeasible === false && kickbackAllowed(kb, 'plan->design')) {
  log(`Plan kicked Design back once: ${plan.infeasibleReason}`)
  phase('Design')
  design = await track('Design', () => safeAgent(
    `You are Fable 5's UX/UI Design phase (Opus), REVISING after the engineering plan found the design infeasible.
${CREED}
Reason it was infeasible: "${plan.infeasibleReason}". Previous design (JSON): ${JSON.stringify(design).slice(0, 8000)}
Produce a revised, buildable DesignSpec. Re-publish the prototype Artifact if touchesUI (put the URL in prototypeUrl).
${LEAN} summary <= 600 chars; screens <= 6 items (name <= 40, purpose <= 120); states is just the label list.`,
    { label: 'design:revise', phase: 'Design', model: R('design').model, effort: R('design').effort, schema: DESIGN_SCHEMA },
  )) || design
  phase('Plan')
  plan = await track('Plan', () => safeAgent(planPrompt(), {
    label: 'plan:re', phase: 'Plan', model: R('plan').model, effort: R('plan').effort, schema: PLAN_SCHEMA,
  }))
}
if (!plan) { log('Plan failed - stopping.'); return { stopped: 'plan', audit, design } }
log(`Plan: ${plan.files.length} file(s), ${plan.steps.length} step(s)`)
```

Replace it with:

```js
// ---------------------------------------------------------------- Plan (+ U2 kickback)
const kb = makeKickbacks()
let plan = null
if (runPlan.phases.includes('plan')) {
  const planPersona = resolvePersona(cfg, runPlan.personas.plan)
  const planEffort = effortFor(cfg, runPlan, 'plan', 'plan')
  const planPrompt = () => `You are Fable 5's Engineering Plan phase. ${planPersona} ${CREED}
${design
    ? `Design spec (JSON): ${JSON.stringify(design).slice(0, 12000)}`
    : `No Design phase ran for this task. Build target (from the audit): ${JSON.stringify({ buildTarget: audit.buildTarget, gaps: audit.gaps, fileHints: audit.fileHints }).slice(0, 6000)}`}
Write the concrete implementation plan for THIS repo: exact files to create/modify, data changes, APIs, migrations
(as PROPOSALS - never applied here), risks, and an ordered step list a builder can follow. ${design ? 'If the design cannot be built as specified, set designFeasible=false and put the precise reason in infeasibleReason.' : 'designFeasible should be true unless the vision itself is not buildable.'}
${LEAN} Keep each step/file entry to one line; no code blocks in the structured fields.`

  phase('Plan')
  plan = await track('Plan', () => safeAgent(planPrompt(), {
    label: 'plan', phase: 'Plan', model: R('plan').model, effort: planEffort, schema: PLAN_SCHEMA,
  }))

  if (plan && plan.designFeasible === false && design && kickbackAllowed(kb, 'plan->design')) {
    log(`Plan kicked Design back once: ${plan.infeasibleReason}`)
    phase('Design')
    design = await track('Design', () => safeAgent(
      `You are Fable 5's UX/UI Design phase, REVISING after the engineering plan found the design infeasible.
${resolvePersona(cfg, runPlan.personas.design)} ${CREED}
Reason it was infeasible: "${plan.infeasibleReason}". Previous design (JSON): ${JSON.stringify(design).slice(0, 8000)}
Produce a revised, buildable DesignSpec. Re-publish the prototype Artifact if touchesUI (put the URL in prototypeUrl).
${LEAN} summary <= 600 chars; screens <= 6 items (name <= 40, purpose <= 120); states is just the label list.`,
      { label: 'design:revise', phase: 'Design', model: R('design').model, effort: effortFor(cfg, runPlan, 'design', 'design'), schema: DESIGN_SCHEMA },
    )) || design
    phase('Plan')
    plan = await track('Plan', () => safeAgent(planPrompt(), {
      label: 'plan:re', phase: 'Plan', model: R('plan').model, effort: planEffort, schema: PLAN_SCHEMA,
    }))
  }
  if (!plan) { log('Plan failed - stopping.'); return { stopped: 'plan', audit, design, runPlan } }
  log(`Plan: ${plan.files.length} file(s), ${plan.steps.length} step(s)`)
} else {
  log('Staffing: Plan not needed for this run - skipped.')
}
```

- [ ] **Step 2: Verify**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js`
Expected: all tests PASS, `node --check` exits 0.

- [ ] **Step 3: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "$(cat <<'EOF'
feat(fable5): Plan phase is conditional, persona-staffed, design-optional

plan is now null when the Foreman didn't include 'plan'. When 'plan'
runs without a preceding 'design', it plans directly from the audit
brief instead of a design spec. The plan->design kickback only fires
when design actually ran.
EOF
)"
```

---

### Task 7: Build phase becomes persona-staffed and plan/design-optional

**Files:**
- Modify: `tools/fable5/fable5.js:332-367` (Build block, `const buildSkills = ...` through the `if (!build || build.status !== 'implemented')` return)

**Interfaces:**
- Consumes: `runPlan.phases` (only for the kickback guard — Build itself is unconditional here because `auditOnlyByDesign` in Task 4 already returned early whenever `'build'` is absent), `resolvePersona`, `effortFor` (Task 1); `audit` (Task 4); `design` (Task 5, may be `null`); `plan` (Task 6, may be `null`).
- Produces: `let build` (unchanged shape). The build→plan kickback only fires when `plan` is non-null (i.e. `'plan'` was actually in `runPlan.phases`).

- [ ] **Step 1: Replace the Build block**

Find:

```js
// ---------------------------------------------------------------- Build (Sonnet) + kickback + gate
const buildSkills = skillsForPhase('build', cfg, `${audit.buildTarget} ${audit.fileHints || ''} ${plan.files.join(' ')}`)
const buildPrompt = () => `You are Fable 5's Build phase (Sonnet). ${CREED}
FIRST invoke these skills for repo conventions + domain correctness: ${JSON.stringify(buildSkills)} (Skill tool).
Implement EXACTLY this plan on the CURRENT fable5/* branch - nothing more, no unrequested refactors:
${JSON.stringify(plan).slice(0, 12000)}
Do NOT apply live DB migrations, deploy, or touch secrets; if the plan needs one, implement the code and leave the
migration as a PROPOSAL (status stays 'implemented', note it in summary). When done, 'git add -A && git commit' your
work on this branch and set committed=true. If the plan cannot be implemented as written, set status='blocked' and
planInfeasible=true with blockedReason.
${LEAN} summary is a few sentences; filesTouched is a path list. The code lives in your commits, not in the output.`

phase('Build')
let build = await track('Build', () => safeAgent(buildPrompt(), {
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
  build = await track('Build', () => safeAgent(buildPrompt(), {
    label: 'build:re', phase: 'Build', model: R('build').model, effort: R('build').effort, schema: BUILD_SCHEMA,
  }))
}
if (!build || build.status !== 'implemented') {
  log(`Build did not implement (status=${build ? build.status : 'none'}). Stopping before QA.`)
  return { stopped: 'build', audit, design, plan, build }
}
```

Replace it with:

```js
// ---------------------------------------------------------------- Build + kickback + gate
const buildPersona = resolvePersona(cfg, runPlan.personas.build)
const buildEffort = effortFor(cfg, runPlan, 'build', 'build')
const buildSkills = skillsForPhase('build', cfg, `${audit.buildTarget} ${audit.fileHints || ''} ${plan ? plan.files.join(' ') : ''}`)
const buildPrompt = () => `You are Fable 5's Build phase. ${buildPersona} ${CREED}
FIRST invoke these skills for repo conventions + domain correctness: ${JSON.stringify(buildSkills)} (Skill tool).
${plan
    ? `Implement EXACTLY this plan on the CURRENT fable5/* branch - nothing more, no unrequested refactors:\n${JSON.stringify(plan).slice(0, 12000)}`
    : `No formal engineering plan ran for this task (taskType=${runPlan.taskType}). Implement directly from ${design ? `this design spec:\n${JSON.stringify(design).slice(0, 8000)}\nand ` : ''}the audit's brief:\n${JSON.stringify({ buildTarget: audit.buildTarget, gaps: audit.gaps, fileHints: audit.fileHints }).slice(0, 4000)}\nMake the smallest correct change that satisfies the vision - no unrequested refactors.`}
Do NOT apply live DB migrations, deploy, or touch secrets; if the plan needs one, implement the code and leave the
migration as a PROPOSAL (status stays 'implemented', note it in summary). When done, 'git add -A && git commit' your
work on this branch and set committed=true. If the plan cannot be implemented as written, set status='blocked' and
planInfeasible=true with blockedReason.
${LEAN} summary is a few sentences; filesTouched is a path list. The code lives in your commits, not in the output.`

phase('Build')
let build = await track('Build', () => safeAgent(buildPrompt(), {
  label: 'build', phase: 'Build', model: R('build').model, effort: buildEffort, schema: BUILD_SCHEMA,
}))

if (build && build.planInfeasible && plan && kickbackAllowed(kb, 'build->plan')) {
  log(`Build kicked Plan back once: ${build.blockedReason}`)
  phase('Plan')
  plan = await track('Plan', () => agent(
    `You are Fable 5's Engineering Plan phase, REVISING after the builder hit a wall.
${resolvePersona(cfg, runPlan.personas.plan)} ${CREED}
Builder's blocker: "${build.blockedReason}". Previous plan (JSON): ${JSON.stringify(plan).slice(0, 8000)}
${design ? `Design (JSON): ${JSON.stringify(design).slice(0, 6000)}. ` : ''}Produce a corrected, buildable plan.`,
    { label: 'plan:re2', phase: 'Plan', model: R('plan').model, effort: effortFor(cfg, runPlan, 'plan', 'plan'), schema: PLAN_SCHEMA },
  )) || plan
  phase('Build')
  build = await track('Build', () => safeAgent(buildPrompt(), {
    label: 'build:re', phase: 'Build', model: R('build').model, effort: buildEffort, schema: BUILD_SCHEMA,
  }))
}
if (!build || build.status !== 'implemented') {
  log(`Build did not implement (status=${build ? build.status : 'none'}). Stopping before QA.`)
  return { stopped: 'build', audit, design, plan, build, runPlan }
}
```

- [ ] **Step 2: Verify**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js`
Expected: all tests PASS, `node --check` exits 0.

- [ ] **Step 3: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "$(cat <<'EOF'
feat(fable5): Build phase is persona-staffed and works without Plan/Design

Build now reads its persona/effort from the RunPlan and constructs its
prompt from whichever of plan/design/audit is actually available. The
build->plan kickback only fires when a Plan phase actually ran.
EOF
)"
```

---

### Task 8: QA becomes conditional and persona-staffed; Report reflects staffing

**Files:**
- Modify: `tools/fable5/fable5.js:369-457` (from the Verify-gate comment through the final `return` statement)

**Interfaces:**
- Consumes: `runPlan.phases`, `resolvePersona`, `effortFor` (Task 1); `audit`, `design`, `plan`, `build` (Tasks 4-7, `design`/`plan` may be `null`).
- Produces: `confirmedBugs: array` (now `[]` when the Foreman didn't include `'qa'`), and the final `return` object gains `taskType`/`phasesRun`.

- [ ] **Step 1: Replace the Verify/QA/Report block**

Find (from `// verify-gate + one repair pass` through the end of the file):

```js
// verify-gate + one repair pass
phase('Verify')
const gateCmd = gateCommand(cfg)
let gate = await agent(
  `You are Fable 5's gate runner. Run: ${gateCmd}
Report green=true ONLY if it exits 0; name the failing command in summary. Do not edit code.`,
  { label: 'gate', phase: 'Verify', model: 'opus', effort: 'low', schema: GATE_SCHEMA },
)
if (gate && !gate.green) {
  log(`Verify red - one repair pass. ${gate.summary}`)
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
log(`Verify: ${gate && gate.green ? 'GREEN' : 'RED - QA will flag it'}`)

// ---------------------------------------------------------------- QA (U1 adversarial refute)
phase('QA')
const qaSkills = skillsForPhase('qa', cfg, `${audit.buildTarget} ${audit.fileHints || ''}`)
const qa = await track('QA', () => safeAgent(
  `You are Fable 5's QA / Audit & Security phase (Opus). ${CREED}
FIRST invoke these skills for domain correctness: ${JSON.stringify(qaSkills)} (Skill tool).
The build is on this fable5/* branch (gate was ${gate && gate.green ? 'GREEN' : 'RED: ' + (gate ? gate.summary : 'unknown')}).
Read the REAL diff (git diff master...HEAD) and the changed files. Find bugs, security issues, perf problems,
accessibility gaps, and inconsistencies. Grade each severity low/medium/high/blocker. Only surface findings you can
back with evidence from the actual diff.
${LEAN} Keep each finding's evidence/proposedFix to a couple of sentences; cite file:line rather than pasting code.`,
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
- WHAT GOT BUILT: ${JSON.stringify(build.summary).slice(0, 1500)} - verify gate: ${gate && gate.green ? 'GREEN' : 'RED'}.
- VERIFIED BUGS/FIXES (refute-survivors only): ${JSON.stringify(confirmedBugs).slice(0, 4000)}
- FOUNDER-GATED PROPOSALS: any migrations/guarded actions the build left as proposals, plus design taste calls.
- TOKENS PER PHASE: ${JSON.stringify(costTable)}.
Then append to .fable5/memory.md: what was built (decision + rationale), any new tech debt, open bugs from QA, and
what the next sprint should tackle - so the next run builds on this instead of re-auditing from zero.
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

Replace it with:

```js
// verify-gate + one repair pass (mechanical - runs whenever Build ran, which it always did here)
phase('Verify')
const gateCmd = gateCommand(cfg)
let gate = await agent(
  `You are Fable 5's gate runner. Run: ${gateCmd}
Report green=true ONLY if it exits 0; name the failing command in summary. Do not edit code.`,
  { label: 'gate', phase: 'Verify', model: 'opus', effort: 'low', schema: GATE_SCHEMA },
)
if (gate && !gate.green) {
  log(`Verify red - one repair pass. ${gate.summary}`)
  await track('Verify', () => agent(
    `You are Fable 5's Build phase, REPAIRING a red gate. ${buildPersona} ${CREED}
The gate '${gateCmd}' failed: ${gate.summary}. Fix ONLY what's needed to make it pass, on this branch, then commit.
Do not expand scope. If you cannot make it green, say so plainly.`,
    { label: 'build:repair', phase: 'Verify', model: R('build').model, effort: buildEffort },
  ))
  gate = await agent(
    `You are Fable 5's gate runner. Re-run: ${gateCmd}. green=true only on exit 0; name the failing command. Do not edit code.`,
    { label: 'gate:re', phase: 'Verify', model: 'opus', effort: 'low', schema: GATE_SCHEMA },
  )
}
log(`Verify: ${gate && gate.green ? 'GREEN' : 'RED - QA will flag it'}`)

// ---------------------------------------------------------------- QA (U1 adversarial refute)
let confirmedBugs = []
if (runPlan.phases.includes('qa')) {
  phase('QA')
  const qaPersona = resolvePersona(cfg, runPlan.personas.qa)
  const qaEffort = effortFor(cfg, runPlan, 'qa', 'qa')
  const qaSkills = skillsForPhase('qa', cfg, `${audit.buildTarget} ${audit.fileHints || ''}`)
  const qa = await track('QA', () => safeAgent(
    `You are Fable 5's QA / Audit & Security phase. ${qaPersona} ${CREED}
FIRST invoke these skills for domain correctness: ${JSON.stringify(qaSkills)} (Skill tool).
The build is on this fable5/* branch (gate was ${gate && gate.green ? 'GREEN' : 'RED: ' + (gate ? gate.summary : 'unknown')}).
Read the REAL diff (git diff master...HEAD) and the changed files. Find bugs, security issues, perf problems,
accessibility gaps, and inconsistencies. Grade each severity low/medium/high/blocker. Only surface findings you can
back with evidence from the actual diff.
${LEAN} Keep each finding's evidence/proposedFix to a couple of sentences; cite file:line rather than pasting code.`,
    { label: 'qa', phase: 'QA', model: R('qa').model, effort: qaEffort, schema: QA_SCHEMA },
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
  confirmedBugs = verdicts.filter(Boolean).filter((x) => x.v && !x.v.refuted).map((x) => ({ ...x.f, refuteReason: x.v.reason }))
  log(`QA: ${confirmedBugs.length}/${rawFindings.length} findings survived refutation.`)
} else {
  log('Staffing: QA not needed for this run - skipped (verify gate still ran).')
}

// ---------------------------------------------------------------- Seal + Report + Memory
phase('Report')
const seal = await agent(
  `You are Fable 5 sealing the run on the current fable5/* branch. ${CREED}
Get today's date via bash. Commit any uncommitted build output, then create an annotated git tag
'fable5/<today>-${slug}' pointing at HEAD. Do NOT merge to master. Return the tag and committed=true.`,
  { label: 'seal', phase: 'Report', model: R('orchestrator').model, effort: 'low', schema: SEAL_SCHEMA },
)

const costTable = tokensByPhase(tokenLog)
const designSection = design
  ? `- THE DESIGN${design.prototypeUrl ? ` (clickable prototype: ${design.prototypeUrl})` : ''}: ${JSON.stringify(design.summary).slice(0, 1500)}`
  : `- THE DESIGN: skipped by Staffing (${runPlan.rationale}).`
const planSection = plan
  ? `- THE PLAN: ${JSON.stringify(plan.steps).slice(0, 2000)}`
  : `- THE PLAN: skipped by Staffing - built directly from the audit${design ? '/design' : ''}.`
await agent(
  `You are Fable 5 writing the run REPORT to .fable5/reports/<today>-${slug}.md (date via bash). ${CREED}
Structure it for the founder:
- Staffed as: ${runPlan.taskType} - phases: ${runPlan.phases.join(', ')} - personas: ${JSON.stringify(runPlan.personas)}. ${runPlan.rationale}
- One-line outcome + the branch/tag: ${seal ? seal.tag : '(seal failed)'}.
- WHAT THE AUDIT DECIDED: ${JSON.stringify({ buildTarget: audit.buildTarget, rationale: audit.rationale }).slice(0, 2000)}
${designSection}
${planSection}
- WHAT GOT BUILT: ${JSON.stringify(build.summary).slice(0, 1500)} - verify gate: ${gate && gate.green ? 'GREEN' : 'RED'}.
- VERIFIED BUGS/FIXES (refute-survivors only)${runPlan.phases.includes('qa') ? '' : ' - QA was skipped by Staffing for this run'}: ${JSON.stringify(confirmedBugs).slice(0, 4000)}
- FOUNDER-GATED PROPOSALS: any migrations/guarded actions the build left as proposals, plus design taste calls.
- TOKENS PER PHASE: ${JSON.stringify(costTable)}.
Then append to .fable5/memory.md: what was built (decision + rationale), the staffing decision (taskType + why),
any new tech debt, open bugs from QA (if it ran), and what the next sprint should tackle - so the next run builds on
this instead of re-auditing from zero.
Remind the founder: master is untouched; merging the branch is their call (git reset --hard ${seal ? seal.tag : '<tag>'} to discard).`,
  { label: 'report', phase: 'Report', model: R('foreman').model, effort: R('foreman').effort },
)

return {
  vision, scope, slug,
  taskType: runPlan.taskType,
  phasesRun: runPlan.phases,
  branchTag: seal ? seal.tag : null,
  buildTarget: audit.buildTarget,
  prototypeUrl: (design && design.prototypeUrl) || null,
  verifyGreen: !!(gate && gate.green),
  confirmedBugs: confirmedBugs.length,
  tokensByPhase: costTable,
}
```

- [ ] **Step 2: Verify**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js`
Expected: all tests PASS, `node --check` exits 0.

- [ ] **Step 3: Commit**

```bash
git add tools/fable5/fable5.js
git commit -m "$(cat <<'EOF'
feat(fable5): QA is conditional and persona-staffed; report shows staffing

QA is skipped when the Foreman didn't include it (verify-gate still
runs regardless). The report now leads with a "Staffed as" line and
only includes Design/Plan sections for phases that actually ran.
EOF
)"
```

---

### Task 9: Docs, full verification, and deploy

**Files:**
- Modify: `C:\Users\Administrator\.claude\skills\fable5\SKILL.md`
- Modify: `tools/fable5/README.md:5`

**Interfaces:** none (documentation + operational task).

- [ ] **Step 1: Update the SKILL.md front door**

In `C:\Users\Administrator\.claude\skills\fable5\SKILL.md`, replace the frontmatter `description` (line 3) with:

```
description: Drive a vision through a Foreman-staffed Fable 5 pipeline - a Staffing phase decides which of Audit -> Design -> Plan -> Build -> QA this run needs and which curated specialist persona (growth, security, ux, infra, content, bugfix, research) staffs each one - with real model-specialized sub-agents, a persistent .fable5/ Project Memory, a clickable design prototype when UI is touched, adversarial QA, and a branch-only safety model. It NEVER merges to master. Use when the user says "Fable 5", "/fable5", "run the orchestrator", "build me X end-to-end", or "audit and build X". Scoped to one vision per run; for autonomous overnight app-wide improvement use crew-forge instead.
```

Replace preflight step 1 (currently `1. **Get the vision + scope.** The vision is the user's words. Scope is \`feature\` (default) or \`app\` (whole-app audit fan-out). If the vision is unclear, ask ONE clarifying question, then proceed.`) with:

```
1. **Get the vision.** The vision is the user's words - that's all that's required. If they said something like
   "audit the whole app" you may pass `scope: "app"` as a hint, but the Foreman decides the actual shape of the run
   (which phases, which specialist personas, how deep) regardless of any hint. If the vision is unclear, ask ONE
   clarifying question, then proceed.
```

Replace step 5 (`5. **Launch.** \`Workflow({ name: 'fable5', args: { vision: "<vision>", scope: "<feature|app>" } })\`. ...`) with:

```
5. **Launch.** `Workflow({ name: 'fable5', args: { vision: "<vision>", scope: "<feature|app>" } })` (`scope` is
   optional - omit it if the founder gave no hint). It runs in the background and notifies on completion.
```

Add one line under "## After the run" noting the new staffing visibility, right after the existing first bullet:

```
- The report opens with a "Staffed as: ..." line - what kind of job the Foreman decided this was, which phases it
  ran, and which specialist personas staffed each one.
```

- [ ] **Step 2: Update the source README**

In `tools/fable5/README.md`, replace line 5:

```
- `fable5.js` — the Workflow (five phases: Audit → Design → Plan → Build → QA).
```

with:

```
- `fable5.js` — the Workflow. A Staffing phase (the Foreman) decides which of Audit → Design → Plan → Build → QA this run needs and which curated persona staffs each one.
```

- [ ] **Step 3: Full verification**

Run: `cd tools/fable5 && node --test fable5.helpers.test.mjs && node --check fable5.js`
Expected: all tests PASS (including every test added in Task 1), `node --check` exits 0 with no output.

Also confirm the file still obeys the single-export rule (belt-and-suspenders, since this is exactly what one of the existing tests checks):

Run: `grep -n "^export" tools/fable5/fable5.js` (or `Select-String "^export" tools/fable5/fable5.js` on Windows)
Expected: exactly one line, `export const meta = {`.

- [ ] **Step 4: Deploy**

Run: `bash tools/fable5/deploy.sh`
Expected: `Deployed fable5.js -> .../workflows/ and SKILL.md -> .../skills/fable5/ (LF-normalized)` — this is what makes the Foreman upgrade live for `/fable5` going forward.

- [ ] **Step 5: Commit**

```bash
git add "C:\Users\Administrator\.claude\skills\fable5\SKILL.md" tools/fable5/README.md
git commit -m "$(cat <<'EOF'
docs(fable5): document the Foreman upgrade in SKILL.md and README

scope is now an optional hint, not a required switch; the report
surfaces the Foreman's staffing decision.
EOF
)"
```

(Note: `~/.claude/skills/fable5/SKILL.md` is outside this repo's git tree — only the in-repo copies under `tools/fable5/` and this repo's `.fable5/` are tracked here. If the deployed SKILL.md path isn't part of any repo, skip adding it to this commit and just confirm `deploy.sh` copied it correctly.)

## Self-Review Notes

- **Spec coverage:** every element of `docs/superpowers/specs/2026-07-22-fable5-foreman-upgrade-design.md` is covered — Staffing phase (Task 3), RunPlan schema (Task 2), persona library (Task 1, inlined per the noted deviation), conditional phase execution (Tasks 4-8), design/plan-optional Build (Task 7), qa-requires-build (Task 1's `normalizeRunPlan`), report changes (Task 8), safety rails untouched (`CREED` never modified in any task), docs (Task 9).
- **Two deliberate deviations from the spec**, called out in the Architecture section: personas ship inline as `DEFAULT_PERSONAS` (not `tools/fable5/personas.json`) to avoid a new deploy step and runtime file read; the engine stays a guarded linear script rather than a generic `PHASE_RUNNERS` dispatch loop, since the phase-specific kickback rules (plan↔design, build↔plan) don't generalize cleanly and a linear script with inclusion guards is lower-risk to get right.
- **Type/name consistency checked:** `runPlan.phases`/`.personas`/`.depth`/`.auditMode`/`.auditLenses`/`.taskType`/`.rationale` are used identically across Tasks 3-8; `resolvePersona`, `effortFor`, `normalizeRunPlan`, `CANONICAL_PHASES`, `DEFAULT_PERSONAS` are defined once in Task 1 and never redefined; `R('staffing')` (Task 2/3) is distinct from `R('foreman')` (still used for seal/report-writing only, unchanged from the original file).
