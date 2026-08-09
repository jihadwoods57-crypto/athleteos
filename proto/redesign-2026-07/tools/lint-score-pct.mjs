#!/usr/bin/env node
/* Fails on a hardcoded score percentage. The weights were written down NINE times before v2 and
   that is why a coach and an athlete could read different numbers for the same day — the worst
   survivor was screens/meal.js's meal-log confirmation, a line every athlete hits on every single
   log. Print them with liveWeightPct(comp) / weightPct(comp) or don't print them.

   PATTERNS is wider than "word immediately touching a number" on purpose: a review of this lint's
   first draft found it would MISS real prose like "pushing nutrition to its 78% cap" (admin
   scoring.js, pre-fix) because the number sits a few words away from the component name, not
   glued to it. So this matches a component name and a percentage in PROXIMITY, not just
   adjacency, in both directions — plus "N% of the/your score" for sentences that never name the
   component at all ("Recovery stays 25% of your score").

   That widening creates its own false-positive risk: "...protein ~65% of nutrition..." (a real
   comment in state.js, about a food's macro split, not the score formula) would match a naive
   "number% ... of ... component-word" scan. The tell that distinguishes the two shapes is the
   word "of" sitting directly after the percent sign — "76% nutrition floor" (real, no "of") vs
   "65% of nutrition" (a fraction OF the noun, not a weight assigned TO it). The reverse-direction
   pattern below excludes that shape explicitly; "of (the/your) SCORE" is still caught by its own
   dedicated pattern because "score" is never a per-food macro.

   A second false-negative shape: HTML that spells a component and its weight as two DIFFERENT
   tags of the same "row" — `<div class="an-name">Nutrition</div>...<div class="an-w">50%</div>` —
   which sails past even the widened window because the tags in between push the two past
   arm's-length. Patterns also run against a TAG-STRIPPED copy of every line (all `<...>` removed)
   so that row collapses to "Nutrition 50%" and matches normally. Tag-stripping is what makes an
   attribute-heavy false positive like `id="recovery-done" ... style="width:100%"` safe too: that
   whole opening tag disappears in the stripped copy, taking "recovery" and "100%" with it, and the
   two never coexist unstripped within the window either.

   A third shape: cards.html's own anatomy deck spreads ONE row across FOUR lines — name, bar,
   weight, and a description each get their own `<span>` — so even the tag-stripped SINGLE line
   never contains both the name and the number. Every line THAT CONTAINS A PERCENTAGE is also
   checked joined with the 3 lines BEFORE it (tags stripped, whitespace collapsed), so that
   four-line row collapses to "Nutrition ... 50%" and reports on the line with the actual number —
   the useful, actionable location. This is deliberately anchored at the PERCENTAGE, not the
   component name: anchoring at the name instead (then scanning forward) would flag every line of
   a comment that merely mentions "commitment" on its way to a real number several lines later
   (commitments.js's vocabulary-note paragraph does this), producing 3-4 reports for one defect.

   Static marketing pages (web/landing/**, web/marketing-src/**) ship as flat HTML with no bound JS
   engine — they cannot call liveWeightPct(). A line that legitimately needs to print the reviewed,
   current number gets an explicit `lint-score-ok` marker in a comment on that line (or the line
   immediately above) instead of a silent path-based exemption, so every hardcoded survivor is a
   conscious, grep-able decision, not an accident. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['proto/redesign-2026-07/js', 'web/landing', 'web/marketing-src', 'web/admin'];
const EXT = new Set(['.js', '.mjs', '.html']);
const ALLOW_FILE = /lint-score-pct|\.test\.|weight-sources|score-v2/;
const SUPPRESS = /lint-score-ok/; // explicit, on the flagged line or the line before it

const WORD = '(?:nutrition|recovery|commitment|check-?in)';
const PCT = '\\d{1,3}\\s*(?:%|percent\\b)'; // \b must bind to "percent" — "%" is non-word, so \b right after it never fires

const PATTERNS = [
  // "76% of the score", "25% of your score", "15% of the daily score"
  new RegExp(`${PCT}\\s*of\\s+(?:the\\s+|your\\s+)?(?:\\w+\\s+){0,2}score\\b`, 'i'),
  // "Nutrition 50%", "Nutrition (50%)", "nutrition to its 78% cap" — name, then a % within reach
  new RegExp(`\\b${WORD}\\b[^%\\n]{0,25}?${PCT}`, 'i'),
  // "76% nutrition floor", "24% recovery cap" — % then name within reach, but NOT "65% of nutrition"
  // (a fraction of the noun, not a weight assigned to it — see header comment)
  new RegExp(`${PCT}(?!\\s+of\\b)[^%\\n]{0,15}?\\b${WORD}\\b`, 'i'),
];

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.has(extname(p))) yield p;
  }
}

// A numeric-hyphen HTML entity ("Weekly check&#8209;in") reads as a plain hyphen to a person but
// not to `check-?in` — decode the ones this codebase actually uses before matching.
const deentity = (s) => s.replace(/&#8209;|&#x2011;/gi, '-');
const detag = (s) => s.replace(/<[^>]+>/g, ' ');
const HAS_PCT = new RegExp(PCT, 'i'); // cheap gate: is there ANY percent-like token on this line at all
const WINDOW_BACK = 3; // lines looked at BEFORE a percentage for its component name

let bad = 0;
for (const root of ROOTS) {
  let files;
  try { files = [...walk(root)]; } catch { continue; }
  for (const f of files) {
    if (ALLOW_FILE.test(f)) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const suppressed = SUPPRESS.test(line) || (i > 0 && SUPPRESS.test(lines[i - 1]));
      if (suppressed) return;
      const single = deentity(line);
      const strippedSingle = detag(single); // collapses a multi-tag ROW into plain prose
      // Anchored at the PERCENTAGE (not the name — see header comment): only lines that carry a
      // percent-like token at all pull in prior lines looking for the component name.
      const windowed = HAS_PCT.test(line)
        ? detag(deentity(lines.slice(Math.max(0, i - WINDOW_BACK), i + 1).join(' '))).replace(/\s+/g, ' ')
        : '';
      for (const re of PATTERNS) {
        if (re.test(single) || re.test(strippedSingle) || (windowed && re.test(windowed))) {
          console.error(`${f}:${i + 1}  hardcoded score percentage — use liveWeightPct()/weightPct(), or mark it lint-score-ok if it's a reviewed static-copy literal\n    ${line.trim()}`);
          bad++;
          break; // one report per line is enough
        }
      }
    });
  }
}
if (bad) { console.error(`\n${bad} hardcoded score percentage(s).`); process.exit(1); }
console.log('lint:score — no hardcoded score percentages');
