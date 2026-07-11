import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Extract the delimited HELPERS region from fable5.js and import it as a module.
// Single source of truth: the test runs the REAL runtime code, not a copy.
// The region uses plain `const` (NOT `export`) so the Workflow runtime — which
// only tolerates the leading `export const meta` — can execute fable5.js as an
// async function body. The test re-exports the helpers here to import them.
const here = dirname(fileURLToPath(import.meta.url))
const src = await readFile(join(here, 'fable5.js'), 'utf8')
const START = '/* ===== HELPERS:START (test-mirrored; plain const, test re-exports) ===== */'
const END = '/* ===== HELPERS:END ===== */'
const i = src.indexOf(START), j = src.indexOf(END)
assert.ok(i !== -1 && j !== -1 && j > i, 'HELPERS sentinels must exist in fable5.js')
const block = src.slice(i + START.length, j)
const EXPORTS = `\nexport { slugify, DEFAULT_ROLES, resolveRole, mergeConfig, auditModeForScope, shouldEarlyExit, makeKickbacks, kickbackAllowed, skillsForPhase, gateCommand, tokensByPhase, isPlainSchema, normalizeArgs };\n`
const H = await import('data:text/javascript,' + encodeURIComponent(block + EXPORTS))

test('fable5.js obeys the Workflow runtime model (only `export const meta`, body wraps as async fn)', () => {
  // The runtime special-cases the leading `export const meta` and executes the
  // rest of the file as an async function body — where `export` and top-level
  // `return` are... return is fine, but a stray `export` throws "Unexpected
  // keyword 'export'" at launch (node --check does NOT catch this). Guard it.
  const exportLines = src.split('\n').filter((l) => /^export\b/.test(l))
  assert.deepEqual(exportLines.length, 1, 'exactly one top-level export (const meta) is allowed')
  assert.match(exportLines[0], /^export const meta\b/)
  const body = src.replace(/^export const meta/, 'const meta')
  assert.doesNotThrow(
    () => new Function('agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'args', `return (async () => {\n${body}\n})()`),
    'fable5.js must wrap as an async function body with no illegal syntax',
  )
})

test('normalizeArgs accepts an object, a JSON string, or garbage', () => {
  assert.deepEqual(H.normalizeArgs({ vision: 'x', scope: 'app' }), { vision: 'x', scope: 'app' })
  assert.deepEqual(H.normalizeArgs('{"vision":"x","scope":"app"}'), { vision: 'x', scope: 'app' })
  assert.deepEqual(H.normalizeArgs('not json'), {})
  assert.deepEqual(H.normalizeArgs(undefined), {})
  assert.deepEqual(H.normalizeArgs(null), {})
})

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

test('isPlainSchema recognizes object schemas', () => {
  assert.equal(H.isPlainSchema({ type: 'object', properties: {} }), true)
  assert.equal(H.isPlainSchema({ type: 'array' }), false)
  assert.equal(H.isPlainSchema(null), false)
})
