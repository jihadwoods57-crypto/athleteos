// OnStandard — build preflight guard.
//
// EAS builds your LAST GIT COMMIT, not the files sitting in your folder. If you
// build with uncommitted changes, you silently ship the OLD commit — which is
// exactly how "10 updates, still the old version on my phone" happens.
//
// This runs before `eas build` (see `npm run ship`). It HARD-STOPS on a dirty
// tree and prints the exact commit that will be built, so you can match it to
// the stamp on your phone (Account screen footer). Refuses to let a stale build
// leave the ground.
import { execSync } from 'node:child_process';

const tty = process.stdout.isTTY;
const c = (code) => (tty ? code : '');
const RED = c('\x1b[31m'), GRN = c('\x1b[32m'), YEL = c('\x1b[33m');
const DIM = c('\x1b[2m'), BOLD = c('\x1b[1m'), RST = c('\x1b[0m');

const git = (args) => execSync(`git ${args}`, { encoding: 'utf8' }).trim();

// Rebuild the bundled proto from source so a stale assets/proto.zip can never ship. If the
// proto changed since the last zip, this makes the tree dirty and the clean-tree gate below
// stops the build until you commit the regenerated bundle — never a silent stale-proto ship.
try {
  execSync('node scripts/build-proto-zip.mjs', { stdio: 'inherit' });
} catch {
  console.error(`${RED}✗ preflight: failed to rebuild assets/proto.zip. Aborting.${RST}`);
  process.exit(1);
}

let branch, commit, subject, dirty;
try {
  branch = git('rev-parse --abbrev-ref HEAD');
  commit = git('rev-parse --short=7 HEAD');
  subject = git('log -1 --pretty=%s');
  dirty = git('status --porcelain');
} catch {
  console.error(`${RED}✗ preflight: not a git repository (or git unavailable). Aborting build.${RST}`);
  process.exit(1);
}

let ahead = '0';
try { ahead = git('rev-list --count @{u}..HEAD'); } catch { ahead = '?'; }

console.log('');
console.log(`${BOLD}──────── OnStandard build preflight ────────${RST}`);
console.log(`  Branch:  ${BOLD}${branch}${RST}`);
console.log(`  Commit:  ${BOLD}${commit}${RST}  ${DIM}${subject}${RST}`);

if (dirty) {
  console.log('');
  console.log(`${RED}✗ You have uncommitted changes.${RST}`);
  console.log(`${RED}  EAS builds your last COMMIT, so these would NOT reach your phone:${RST}`);
  for (const line of dirty.split('\n').slice(0, 25)) console.log(`    ${DIM}${line}${RST}`);
  const extra = dirty.split('\n').length - 25;
  if (extra > 0) console.log(`    ${DIM}…and ${extra} more${RST}`);
  console.log('');
  console.log(`  ${YEL}Commit them first, then build:${RST}`);
  console.log(`  ${DIM}git add -A && git commit -m "what changed"${RST}`);
  console.log('');
  process.exit(1);
}

if (ahead !== '0' && ahead !== '?') {
  console.log(`  ${YEL}Note: ${ahead} commit(s) not pushed to GitHub yet.${RST}`);
  console.log(`  ${DIM}The build still uses them; push to back up:  git push${RST}`);
}

console.log('');
console.log(`${GRN}✓ Working tree clean — the build will contain exactly ${commit}.${RST}`);
console.log(`${DIM}  Confirm in TestFlight that the new build number is the one you install.${RST}`);
console.log('');
