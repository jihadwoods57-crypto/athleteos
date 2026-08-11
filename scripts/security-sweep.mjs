#!/usr/bin/env node
// Weekly security sweep. Runs the checks that guard OnStandard's two biggest risk surfaces —
// authorization (RLS) and leaked secrets/CVEs — records the result, and flags only what is NEWLY
// broken versus the saved baseline. Designed to run unattended: every check is best-effort and a
// missing tool marks that check "skipped", never crashes the whole run.
//
//   node scripts/security-sweep.mjs            # run + compare to baseline, exit 1 if newly broken
//   node scripts/security-sweep.mjs --baseline # save current result as the new baseline
//
// Baseline lives at scripts/.security-baseline.json (gitignored — it's machine state, not source).
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BASELINE = join(ROOT, 'scripts', '.security-baseline.json');
const SAVE = process.argv.includes('--baseline');

const run = (cmd, opts = {}) =>
  execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, ...opts }).toString();

const checks = {};

// 1. Secrets accidentally tracked by git (the #1 leak vector: .env, *.p8, credentials.json, keys).
try {
  const tracked = run('git ls-files').split(/\r?\n/).filter(Boolean);
  const SECRET = /(^|\/)\.env(\.|$)|\.p8$|\.pem$|\.key$|credentials\.json$|serviceAccount.*\.json$|_secrets\//i;
  const ALLOW = /\.env\.example$/i;
  const leaked = tracked.filter((f) => SECRET.test(f) && !ALLOW.test(f));
  checks.tracked_secrets = { ok: leaked.length === 0, detail: leaked.slice(0, 20) };
} catch (e) {
  checks.tracked_secrets = { ok: null, detail: `skipped: ${String(e.message).slice(0, 120)}` };
}

// 2. Dependency CVEs (high/critical only — noise floor is too high otherwise).
try {
  let audit;
  try { audit = run('npm audit --omit=dev --json'); }
  catch (e) { audit = (e.stdout || '').toString(); }   // npm audit exits non-zero when vulns exist
  const j = JSON.parse(audit || '{}');
  const v = j.metadata?.vulnerabilities || {};
  const bad = (v.high || 0) + (v.critical || 0);
  checks.dep_cves = { ok: bad === 0, detail: { high: v.high || 0, critical: v.critical || 0 } };
} catch (e) {
  checks.dep_cves = { ok: null, detail: `skipped: ${String(e.message).slice(0, 120)}` };
}

// 3. Adversarial RLS / authorization suite. Needs a local Postgres with migrations (supabase start
//    → :54322). NEVER prod. If the DB is genuinely unreachable, mark skipped rather than fail.
//
//    The reachability probe used to be a bare `psql ... -c "select 1"`. psql is not on PATH on
//    Windows, which is this founder's machine — so the probe threw every time, the most important
//    check in the sweep was reported "⚪ skipped", and skipped never fails. The single check this
//    tool exists for had been silently not running here.
//
//    supabase/tests/run.sh already solved exactly this: psql when present, otherwise `docker exec`
//    into the local Supabase container. The probe just never got the same treatment. It does now —
//    and "skipped" is reserved for the case where BOTH routes are unavailable.
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_onstandard';
function dbReachable() {
  try { run(`psql "${DB_URL}" -c "select 1"`, { timeout: 15000 }); return true; } catch { /* fall through */ }
  try {
    const names = run('docker ps --format "{{.Names}}"', { timeout: 15000 });
    if (!names.split(/\r?\n/).some((n) => n.trim() === CONTAINER)) return false;
    run(`docker exec -i ${CONTAINER} psql "postgresql://postgres:postgres@127.0.0.1:5432/postgres" -c "select 1"`, { timeout: 20000 });
    return true;
  } catch { return false; }
}

if (dbReachable()) {
  try {
    run('bash supabase/tests/run.sh');
    checks.rls_authz = { ok: true, detail: 'all authorization boundaries held' };
  } catch (e) {
    checks.rls_authz = { ok: false, detail: (e.stdout || e.stderr || e.message || '').toString().slice(-1500) };
  }
} else {
  checks.rls_authz = { ok: null, detail: `skipped: no psql on PATH and container '${CONTAINER}' not running (run \`supabase start\`)` };
}

// ---- compare to baseline: flag only NEWLY broken ----
const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const result = { checks };

if (SAVE) {
  writeFileSync(BASELINE, JSON.stringify(result, null, 2));
  console.log('✅ security baseline saved:', relative(ROOT, BASELINE));
  process.exit(0);
}

const newlyBroken = [];
const lines = [];
for (const [name, c] of Object.entries(checks)) {
  const mark = c.ok === true ? '✅' : c.ok === false ? '❌' : '⚪';
  lines.push(`  ${mark} ${name}${c.ok === null ? ' (skipped)' : ''}`);
  const was = prev.checks?.[name]?.ok;
  if (c.ok === false && was !== false) newlyBroken.push(name);   // regressed (or first-ever fail)
}

console.log('SECURITY SWEEP\n' + lines.join('\n'));
for (const [name, c] of Object.entries(checks)) {
  if (c.ok === false) console.log(`\n❌ ${name}:\n`, typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail, null, 2));
}

if (newlyBroken.length) {
  console.log(`\n🚨 NEWLY BROKEN since baseline: ${newlyBroken.join(', ')}`);
  console.log('Re-run to confirm, fix, then `node scripts/security-sweep.mjs --baseline` to re-anchor.');
  process.exit(1);
}
console.log('\nNo new regressions vs. baseline.');
process.exit(0);
