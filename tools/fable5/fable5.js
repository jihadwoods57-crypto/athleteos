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
