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
  for (const k of Object.keys(defaults || {})) {
    const dv = defaults[k]
    if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
      out[k] = mergeConfig(dv, (user && user[k]) || {})
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

export const isPlainSchema = (s) => !!s && s.type === 'object' && typeof s.properties === 'object'
/* ===== HELPERS:END ===== */

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

// ---------------------------------------------------------------- Design (U3 + U4)
phase('Design')
const designSkills = skillsForPhase('design', cfg, `${audit.buildTarget} ${audit.fileHints || ''}`)
let design = await track('Design', () => agent(
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
