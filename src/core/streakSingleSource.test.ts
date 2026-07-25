/**
 * The streak has exactly ONE implementation.
 *
 * It used to have two. `src/core/history.ts` and `proto/redesign-2026-07/js/day.js` disagreed on:
 *
 *   - whether an incomplete today zeroes the run  (history.ts: yes / day.js: no)
 *   - grace: a fixed trailing 7 days, or one miss per ROLLING 7
 *   - whether the activation day counts
 *
 * Both were unit-tested. `history.test.ts` asserted a streak of 0 where `protoStreakGrace.test.ts`
 * asserted a non-zero run, and BOTH SUITES WERE GREEN — the test suite was certifying two
 * different answers to "what is my streak?" in a product whose promise is that the score never
 * lies. A passing suite is not evidence of agreement unless something checks for agreement.
 *
 * The TS copy is gone (its only callers were the unreachable src/screens tree). This test fails
 * the build if a second one reappears, which is the failure mode that actually happened: someone
 * needs a streak in TS, writes a "quick" local version, and the divergence is invisible again.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

/** Every source file we own, excluding tests, build output and dependencies. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', '.expo', '.aos-export', 'qc', 'web'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

describe('streak has a single source of truth', () => {
  const files = sourceFiles(ROOT);

  it('scans a plausible number of source files', () => {
    // Guards against a broken walk making the assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(100);
  });

  it('defines streakInfo in exactly one place', () => {
    const definers = files.filter((f) =>
      /(?:export\s+)?function\s+streakInfo\b|streakInfo\s*[:=]\s*(?:function|\()/.test(readFileSync(f, 'utf8')),
    ).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'));

    expect(definers).toEqual(['proto/redesign-2026-07/js/day.js']);
  });

  it('keeps the shipped implementation where the app can reach it', () => {
    const day = readFileSync(join(ROOT, 'proto/redesign-2026-07/js/day.js'), 'utf8');
    // The three rules that distinguish the surviving semantics from the deleted ones. If someone
    // "simplifies" any of these back, the drift returns silently — so pin them.
    expect(day).toMatch(/export function streakInfo/);
    expect(day).toMatch(/todayCounted/);   // an incomplete today does not zero the run
    expect(day).toMatch(/lastGrace/);      // rolling-7 grace, not a fixed trailing window
    expect(day).toMatch(/isActivationDay/); // activation day never counts and never breaks
  });
});
