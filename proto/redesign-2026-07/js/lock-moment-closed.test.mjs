/* A DAY THAT CLOSED BELOW STANDARD ALSO CLOSES (impeccable critique, 2026-09-16).
 *
 * `maybeShowLock` used to open with `if (score === null || score < THRESH) return false`, so the
 * product's one end-of-day moment fired only above 80. An athlete who closed at 51 got no stamp,
 * no line and no acknowledgment; the next morning simply arrived with a fresh empty ring. The peak
 * of the daily loop is excellent and the END only existed on good days, which for a product built
 * on honest reckoning is the wrong half to have built.
 *
 * The rules the low branch has to keep, each pinned below, because each one is the difference
 * between an honest close and the app scolding a teenager:
 *
 *   NEVER INVENTED — a cause is named only when the day can actually be reconstructed and graded.
 *   `dayFromHistoryRow` returns null for rows written before the jsonb ride-along, and a sub-2
 *   point "biggest gap" points at nothing, so both cases fall back to the no-cause line.
 *
 *   NEVER A SECOND FORMULA — points lost are the same terms scoreFor() adds up, read off the
 *   reconstructed day. A parallel calculation here is exactly how the tier ladder drifted to
 *   75-vs-80 across four files (score-band.js:41).
 *
 *   NEVER RED, NEVER A BUZZ, NEVER A RATING ASK — red means "missed" in this system and the day
 *   is not a missed requirement; the heavy 'lock' haptic is the sound of something landing in the
 *   athlete's favour; and the review prompt stays milestone-only, which is the one moment the app
 *   has earned the right to ask.
 *
 *   STILL ONCE — the low branch shares the same `RT.lastLockSeen` marker, so it cannot re-show.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from '../tools/strip-comments.mjs';

const JS = dirname(fileURLToPath(import.meta.url));
const src = stripComments(readFileSync(join(JS, 'lock-moment.js'), 'utf8'));
const css = readFileSync(join(JS, '..', 'css', 'flows.css'), 'utf8');

test('a below-standard day is no longer thrown away before it can be shown', () => {
  assert.doesNotMatch(src, /score === null \|\| score < THRESH/,
    'the early return must no longer bundle "no row" together with "under 80"');
  // A missing row still says nothing: the app cannot claim a lock it never saw.
  assert.match(src, /if \(score === null\) return false/,
    'a day with no history row must still produce no stamp at all');
  assert.match(src, /const onStandard = score >= THRESH/,
    'the branch must be decided by the SAME threshold the ring and the streak use');
});

test('the cause is derived from scoreFor terms, never a second formula', () => {
  assert.match(src, /weightsForDay|computeComponents/, 'the gap must be read off the real engine');
  const fn = src.slice(src.indexOf('function biggestGap'), src.indexOf('function yesterdayScore'));
  assert.match(fn, /w\.nutrition \|\| 0\) \* \(100 - c\.nutrition\)/, 'nutrition points lost = weight x shortfall');
  assert.match(fn, /c\.recoveryContribution/, 'recovery must use the CONTRIBUTION, as scoreFor does');
  assert.match(fn, /dayFromHistoryRow/, 'the day must be reconstructed, not guessed at');
});

test('a cause that contradicts the stored score is not printed', () => {
  /* The first thing this feature printed was "Yesterday closed at 51. Nutrition cost the most, 73
     points." Both halves were individually true and together they were nonsense: the 51 came from
     the stored row and the 73 from a reconstruction that scored the day at 9. Points lost are only
     meaningful beside the score they were lost FROM, so the cause is dropped whenever the two
     disagree. Same shape as meal-intel's fiber guard: when the derived view and the evidence
     disagree, the derived view is the suspect and the app stays quiet rather than narrating. */
  const fn = src.slice(src.indexOf('function biggestGap'), src.indexOf('function yesterdayScore'));
  assert.match(fn, /Math\.abs\(scoreFor\(day\) - storedScore\) > 3/,
    'the reconstruction must be checked against the stored score before it is quoted');
  assert.match(src, /biggestGap\(date, score\)/, 'the stored score must be handed to the guard');
});

test('a cause it cannot prove is not printed', () => {
  const fn = src.slice(src.indexOf('function biggestGap'), src.indexOf('function yesterdayScore'));
  assert.match(fn, /if \(!day\) return null/, 'an unreconstructable day must name no cause');
  assert.match(fn, /lost >= 2 \? \{/, 'a sub-2-point "biggest gap" points at nothing and must be dropped');
  assert.match(fn, /catch \{/, 'an explanation must never become an error path');
  // And the copy has to have somewhere to go when there is no cause.
  assert.match(src, /It's on the record either way\. Today is open\./,
    'the no-cause line must still close the day and still point forward');
});

test('the low branch never celebrates, never buzzes, and never asks for a rating', () => {
  assert.match(src, /if \(onStandard\) buzz\(/,
    'the heavy lock haptic must fire only on a day that went the athlete\'s way');
  // The rating ask rides `milestone`, and milestone is now gated on onStandard.
  assert.match(src, /const milestone = onStandard &&/,
    'a milestone (and therefore the review prompt) must be impossible below standard');
  assert.match(src, /icon\(onStandard \? 'check' : 'target', 26\)/,
    'a day that did not pass must not wear the check mark');
});

test('it is the same card at a lower volume, not a red screen', () => {
  assert.match(css, /\.lockstamp\.closed \.ls-mark \{[^}]*background: var\(--surface-3\)/,
    'the closed mark must be neutral');
  const block = css.slice(css.indexOf('.lockstamp.closed .ls-mark'), css.indexOf('@media (prefers-reduced-motion'));
  assert.doesNotMatch(block, /--red/, 'red means "missed" in this system and must not be borrowed here');
  assert.match(block, /\.lockstamp\.closed\.on \.ls-mark::after \{ content: none; \}/,
    'the impact ripple must not play for a day that did not land');
});

test('the closed stamp still shows exactly once', () => {
  assert.match(src, /if \(RT\.lastLockSeen === date\) return false/,
    'the once-per-day marker must guard both branches');
  const guardIdx = src.indexOf('RT.lastLockSeen === date');
  const branchIdx = src.indexOf('const onStandard =');
  assert.ok(guardIdx < branchIdx, 'the seen-marker guard must run BEFORE the branch, so both share it');
  assert.match(src, /act\.markLockSeen\(date, milestone \? streakDays : null\)/,
    'the marker must still be claimed on show');
});
