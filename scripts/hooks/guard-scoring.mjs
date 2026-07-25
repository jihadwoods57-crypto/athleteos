#!/usr/bin/env node
// Scoring-engine tripwire (Claude Code PostToolUse hook).
//
// The product IS the daily number. These files compute or define it, and the shipped WebView proto
// must score byte-for-byte equal to the RN engine. This guard fires after any edit; if the edited
// file is part of the scoring core it runs the fast parity/engine tests and, on failure, blocks
// (exit 2) so the drift is caught the instant it's introduced — not at ship time.
//
// Skip for a bulk refactor with: SKIP_SCORE_GUARD=1
//
// Hook contract: receives JSON on stdin ({ tool_name, tool_input:{ file_path,... }, ... }).
// exit 0 = allow (silent unless it has something to say). exit 2 = block, stderr shown to Claude.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

// The scoring core — keep in sync with docs/SCORING-CORE.md. Edits to any of these run the guard.
const CORE = new Set([
  // RN engine (canonical)
  'src/core/scoring.ts', 'src/core/scoringProfiles.ts', 'src/core/constants.ts',
  'src/core/commitment.ts', 'src/core/macroGrounding.ts', 'src/core/foodDb.ts',
  'src/core/trustPass.ts', 'src/core/scoreIntegrity.ts', 'src/core/projection.ts',
  'src/core/startingScore.ts', 'src/core/history.ts', 'src/core/adherence.ts',
  'src/core/dayRollover.ts', 'src/core/evalScore.ts',
  // Shipped WebView proto — must stay parity-equal
  'proto/redesign-2026-07/js/day.js', 'proto/redesign-2026-07/js/nutrition.js',
  'proto/redesign-2026-07/js/meal-intel.js', 'proto/redesign-2026-07/js/breakdown-model.js',
  'proto/redesign-2026-07/js/dayverdict.js',
]);

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

let payload = {};
try { payload = JSON.parse(readStdin() || '{}'); } catch { /* no-op */ }

const fp = payload?.tool_input?.file_path || payload?.tool_input?.filePath;
if (!fp) process.exit(0);
if (process.env.SKIP_SCORE_GUARD === '1') process.exit(0);

const rel = relative(ROOT, resolve(fp)).replace(/\\/g, '/');
if (!CORE.has(rel)) process.exit(0);

// It's a scoring-core edit. Run the byte-parity guardrail (fast, targeted) + the engine tests.
process.stderr.write(`\n⚖️  Scoring core touched (${rel}) — running parity/engine checks…\n`);
try {
  execSync('npx jest --silent scoreParity scoring scoringProfiles scoreIntegrity', {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], timeout: 180000,
  });
} catch (e) {
  const out = (e.stderr?.toString() || e.stdout?.toString() || e.message || '').slice(-2000);
  process.stderr.write(
    `\n❌ SCORING GUARD FAILED after editing ${rel}.\n` +
    `The daily-number engine or the RN↔proto byte-parity broke. Do NOT proceed until this is green.\n\n` +
    out + `\n\nRe-run manually: npx jest scoreParity scoring scoringProfiles scoreIntegrity\n`,
  );
  process.exit(2);
}
process.stderr.write(
  `✅ Parity + engine tests green. Before shipping, also run the meal eval: npm run eval -- --replay\n`,
);
process.exit(0);
