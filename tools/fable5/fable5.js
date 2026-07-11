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
/* ===== HELPERS:END ===== */
