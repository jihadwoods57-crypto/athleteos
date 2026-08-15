// OnStandard — the verification gate runner.
//
// WHY THIS EXISTS. `npm run verify` used to be nine commands chained with `&&`. That chain has one
// property that turns out to be dangerous: when a gate fails, every gate BEHIND it never runs, and
// nothing says so. The output just stops. You are looking at one failure and quietly assuming the
// other eight passed.
//
// It cost this repo real coverage twice.
//   · supabase/tests/run.sh aborts on ERROR. rls_authz_test.sql went red at migration 0194 and
//     every SQL suite after it silently stopped running — for weeks, unnoticed.
//   · lint:score (gate 4 of 9) went red on a vendored, gitignored marketing-skills drop it should
//     never have been scanning. Nobody could clear it, so typecheck, jest, test:proto, test:admin
//     and bundle simply did not run. Three genuinely red jest tests sat on master behind it.
//
// So this runner does two things the `&&` chain could not:
//   1. It runs EVERY gate, even after one fails. You fix the whole tree in one pass instead of
//      peeling failures off one at a time, each behind a full re-run.
//   2. It ends with a summary naming every gate and its verdict, and it is loud about the count.
//      A gate that did not run is reported as such and is never mistaken for a gate that passed.
//
// Exit code is unchanged: zero only when every gate passes. `--fail-fast` restores the old
// stop-at-first-failure behaviour for a tight edit loop; `--only <name,name>` runs a subset;
// `--with-rls` appends the SQL suite (what `verify:full` runs — it needs a local Supabase stack,
// so it is opt-in rather than default). Note that test:rls was previously chained onto verify with
// `&&`, meaning a red gate anywhere above it silently skipped the entire authorization suite —
// the same blindness one level up. As a gate it gets a verdict like everything else.
import { spawnSync } from 'node:child_process';

const tty = process.stdout.isTTY;
const c = (code) => (tty ? code : '');
const RED = c('\x1b[31m'), GRN = c('\x1b[32m'), YEL = c('\x1b[33m');
const DIM = c('\x1b[2m'), BOLD = c('\x1b[1m'), RST = c('\x1b[0m');

// Ordered cheapest-first so a typo surfaces in seconds rather than after a four-minute export.
// `bundle` is last for the same reason: it is the only gate measured in minutes.
const GATES = [
  { name: 'lint:xss',   what: 'every user-data innerHTML interpolation is escaped' },
  { name: 'lint:copy',  what: 'no internal terminology in athlete/coach copy' },
  { name: 'lint:type',  what: 'the raw font-size count did not grow' },
  { name: 'lint:inline', what: 'the inline-style count did not grow' },
  { name: 'lint:dash',  what: 'em dashes in copy did not grow (DESIGN.md ban)' },
  { name: 'lint:score', what: 'no hardcoded score percentages' },
  { name: 'typecheck',  what: 'tsc --noEmit' },
  { name: 'test',       what: 'jest' },
  { name: 'test:proto', what: 'the proto node:test suites' },
  { name: 'test:admin', what: 'the Command Center suites' },
  // Added 2026-08-10. admin-alert / admin-auth-monitor / admin-mfa-recover each ship a
  // logic.test.mjs, written and passing, that NO runner picked up — test:proto globs proto/ and
  // test:admin globs web/admin/, and nothing globbed supabase/functions/. 17 tests covering the
  // alert renderer, the auth-burst classifier and the MFA-recovery body parser were running only
  // when someone pasted the command out of the comment at the top of the file.
  { name: 'test:fn',    what: 'the edge-function logic suites' },
  { name: 'bundle',     what: 'expo export actually builds' },
];
// Opt-in (`--with-rls`): needs a running local Supabase stack, so it cannot be a default gate.
const RLS_GATE = { name: 'test:rls', what: 'the adversarial RLS / authorization suites' };

const argv = process.argv.slice(2);
const failFast = argv.includes('--fail-fast');
const withRls = argv.includes('--with-rls');
const onlyArg = argv.indexOf('--only');
const only = onlyArg >= 0 && argv[onlyArg + 1] ? new Set(argv[onlyArg + 1].split(',')) : null;
const ALL = withRls ? [...GATES, RLS_GATE] : GATES;
const gates = only ? ALL.filter((g) => only.has(g.name)) : ALL;

if (only) {
  const unknown = [...only].filter((n) => !ALL.some((g) => g.name === n));
  if (unknown.length) {
    console.error(`${RED}✗ verify: unknown gate(s): ${unknown.join(', ')}${RST}`);
    console.error(`${DIM}  known: ${ALL.map((g) => g.name).join(', ')}${RST}`);
    if (!withRls && [...only].includes('test:rls')) console.error(`${DIM}  (test:rls needs --with-rls)${RST}`);
    process.exit(1);
  }
}

const results = [];
const started = Date.now();

for (const gate of gates) {
  const stop = failFast && results.some((r) => r.status === 'fail');
  if (stop) { results.push({ ...gate, status: 'skipped', ms: 0 }); continue; }

  console.log('');
  console.log(`${BOLD}▸ ${gate.name}${RST} ${DIM}— ${gate.what}${RST}`);
  const t0 = Date.now();
  // shell:true so this works with npm's own resolution on Windows (npm.cmd) as well as POSIX.
  const r = spawnSync('npm', ['run', '--silent', gate.name], { stdio: 'inherit', shell: true });
  const ms = Date.now() - t0;
  const ok = r.status === 0 && !r.error;
  results.push({ ...gate, status: ok ? 'pass' : 'fail', ms });
  if (!ok) console.log(`${RED}✗ ${gate.name} failed${RST}`);
}

const pad = Math.max(...gates.map((g) => g.name.length));
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skipped');

console.log('');
console.log(`${BOLD}──────── verify: ${results.length} gates ────────${RST}`);
for (const r of results) {
  const mark = r.status === 'pass' ? `${GRN}✓${RST}` : r.status === 'fail' ? `${RED}✗${RST}` : `${YEL}–${RST}`;
  const note = r.status === 'skipped' ? `${YEL}did not run${RST}` : `${DIM}${secs(r.ms)}${RST}`;
  console.log(`  ${mark} ${r.name.padEnd(pad)}  ${note}`);
}
console.log(`${DIM}  ${secs(Date.now() - started)} total${RST}`);
console.log('');

if (!failed.length && !skipped.length) {
  console.log(`${GRN}${BOLD}✓ all ${results.length} gates passed.${RST}`);
  console.log('');
  process.exit(0);
}

// The whole point of the runner: never let a failure imply anything about what came after it.
console.log(`${RED}${BOLD}✗ ${failed.length} gate(s) failed:${RST} ${failed.map((r) => r.name).join(', ')}`);
if (skipped.length) {
  console.log(`${YEL}  ${skipped.length} gate(s) never ran (--fail-fast): ${skipped.map((r) => r.name).join(', ')}${RST}`);
  console.log(`${DIM}  Their status is UNKNOWN, not passing. Re-run without --fail-fast.${RST}`);
}
console.log('');
process.exit(1);
