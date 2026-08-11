// OnStandard — node:test runner that refuses to pass by running nothing.
//
// `node --test "some/**/*.test.mjs"` exits ZERO when the glob matches no files. The output is
// "pass 0, fail 0" and the shell sees success. So a gate wired straight to a glob keeps reporting
// green after a directory is renamed, a suite is moved, or a pattern picks up a typo — it just
// silently stops testing anything. That is the same failure this repo has now been bitten by three
// times (rls_authz_test.sql taking five SQL suites down with it; lint:score taking five npm gates
// down with it), except here there is no red anywhere to notice.
//
// So: expand the patterns first, hard-fail on zero matches, print the file count, and only then
// hand the concrete file list to `node --test`.
//
//   node scripts/node-test.mjs "proto/redesign-2026-07/js/**/*.test.mjs" [more patterns...]
import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const tty = process.stdout.isTTY;
const c = (code) => (tty ? code : '');
const RED = c('\x1b[31m'), DIM = c('\x1b[2m'), RST = c('\x1b[0m');

const patterns = process.argv.slice(2);
if (!patterns.length) {
  console.error(`${RED}✗ node-test: no glob pattern given.${RST}`);
  process.exit(1);
}

const files = [...new Set(patterns.flatMap((p) => globSync(p)))].sort();

if (!files.length) {
  console.error('');
  console.error(`${RED}✗ node-test: ${patterns.join(' ')} matched NO test files.${RST}`);
  console.error(`${RED}  Refusing to report success for a suite that ran nothing.${RST}`);
  console.error(`${DIM}  Either the pattern is wrong or the tests moved — both are real failures.${RST}`);
  console.error('');
  process.exit(1);
}

console.log(`${DIM}node-test: ${files.length} suite file(s) from ${patterns.join(' ')}${RST}`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
