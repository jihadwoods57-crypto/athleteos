/* WHAT THE ATHLETE SEES WHEN THEY CORRECT A MEAL.
 *
 * 2026-09-14: "I had core power with this" -> the AI said the numbers were updating, and nothing
 * visibly happened. 2026-09-24: "double chicken" -> the AI said the numbers were updating, nothing
 * changed, and an amber line under the message box contradicted it.
 *
 * The rule both taught: Nia may only say the numbers moved once they have. So a correction is
 * applied first (correction-turn.js), and meal-chat then files what Nia says about it: her ack and
 * the receipt when it landed, her one precise question when it did not. Nothing about a correction
 * is ever said under the box, and nothing is animated that did not happen. The receipt that proves
 * the change counts from the old figures to the new ones as it ARRIVES, on every screen that shows
 * the thread, because it is the filed row (chat-view.js playFreshReceipts); the meal screen's
 * private live card, which could only ever play on one screen, is gone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from '../tools/strip-comments.mjs';

const JS = dirname(fileURLToPath(import.meta.url));
const read = (...p) => stripComments(readFileSync(join(JS, ...p), 'utf8'));
const MEAL = read('screens', 'meal.js');
const CHAT = read('screens', 'nutrition-chat.js');
const TURN = read('correction-turn.js');
const VIEW = read('chat-view.js');
const STATE = read('state.js');
const CSS = readFileSync(join(JS, '..', 'css', 'screens.css'), 'utf8');

/* ---- the order: apply, then speak --------------------------------------------------------- */

test('both athlete surfaces close the loop through the one shared module', () => {
  for (const src of [MEAL, CHAT]) {
    assert.match(src, /await import\('\.\.\/correction-turn\.js'\)/, 'lazily: nothing new at boot');
    assert.match(src, /runChatCorrection\(\{/);
    assert.match(src, /canConfirmCorrection: true/, 'Nia\'s ack waits for the plate');
  }
});

test('a correction that carries only `more`, or only a token, still runs and is reported', () => {
  for (const src of [MEAL, CHAT]) {
    assert.match(src, /data\.pending \|\| data\.correction\.item \|\| \['missed', 'more'\]\.some\(/);
    assert.match(src, /uid: RT\.userId/, 'the outbox job is the signed-in athlete\'s');
  }
});

test('nothing about a correction is said under the box', () => {
  for (const src of [MEAL, CHAT]) {
    for (const phrase of [/didn't line up with anything/, /have nothing on file for/, /Added what I could price/, /No numbers on file/]) {
      assert.doesNotMatch(src, phrase, `${phrase} belongs to Nia, in the thread`);
    }
  }
});

test('the typing row stays up until Nia has said what happened', () => {
  const i = MEAL.indexOf('runChatCorrection({');
  const before = MEAL.slice(i - 300, i).replace(/\s+/g, ' ');
  const after = MEAL.slice(i, i + 700).replace(/\s+/g, ' ');
  assert.match(before, /setTyping\(true\)/);
  assert.match(after, /setTyping\(false\)/);
  assert.ok(after.indexOf('setTyping(false)') < after.indexOf('await refresh()'), 'then the thread refetches her words');
});

test('the outcome is reported with the token, and the receipt goes with it', () => {
  assert.match(TURN, /correctionOutcome: \{ token, correction, \.\.\.outcome \}/, 'bound to the correction it was issued for');
  assert.ok(TURN.indexOf('SQ.putJob(job)') < TURN.indexOf('await sendOutcome(job, sb)'), 'queued in the outbox before the first try (I4)');
  assert.match(STATE, /job\.kind === 'correction-outcome'\) return \(await import\('\.\/correction-turn\.js'\)\)\.sendOutcome\(job, sbc\)/, 'and the outbox drain knows it, lazily');
  // R2: an exhausted receipt job is never abandoned: a launch or a foreground tries it again.
  assert.match(STATE, /if \(revive\) for \(const j of SQ\.readQueue\(\)\) if \(j\.kind === 'correction-outcome' && !j\.noRevive && j\.tries >= SQ\.MAX_TRIES\) SQ\.patchJob\(SQ\.keyOf\(j\), \{ tries: 0, lastTryAt: 0 \}\);/);
  assert.equal((STATE.match(/drainSyncQueue\(true\)/g) || []).length, 2, 'boot and foreground revive; reconnect and the timer do not');
  assert.match(TURN, /correctionReceipt: rows/);
  assert.match(TURN, /noReceipt: !!token/, 'so the reducer does not file a second, earlier receipt');
  assert.match(TURN, /resolveChatCorrection\(meta, correction, said/, 'the athlete\'s own words decide first');
});

/* ---- the receipt: only real moves, score last, counted as it arrives ------------------------ */

test('only figures that moved are listed, and the meal score is last and carries its band', () => {
  const i = STATE.indexOf('_correctionReceiptRows(before, after) {');
  const body = STATE.slice(i, i + 1400).replace(/\s+/g, ' ');
  assert.match(body, /Math\.round\(\+a\) !== Math\.round\(\+b\)/, 'a number that did not move is not a row');
  assert.match(body, /qualityBand\(Math\.round\(\+b\)\)/);
  assert.match(body, /\.sort\(\(x, y\) => \(x\.score \? 1 : 0\) - \(y\.score \? 1 : 0\)\)/);
});

test('an arriving receipt counts from the old figures to the new; a re-read one does not', () => {
  const i = VIEW.indexOf('export function receiptCardHtml(');
  const body = VIEW.slice(i, i + 2200);
  assert.match(body, /data-fx-from="\$\{r\.from\}" data-fx-to="\$\{r\.to\}"/);
  assert.match(body, /fresh \? ' counting' : ' landed'/);
  for (const src of [MEAL, CHAT]) assert.match(src, /playFreshReceipts\(/, 'every athlete surface plays it');
});

test('the turn and the haptic land after the count, never during it', () => {
  const i = VIEW.indexOf('export function playFreshReceipts(');
  const body = VIEW.slice(i, i + 2400).replace(/\s+/g, ' ');
  const land = body.indexOf('const land = () =>');
  assert.ok(land > 0);
  const landBody = body.slice(land, land + 400);
  assert.match(landBody, /classList\.add\('landed', 'just-landed'\)/);
  assert.match(landBody, /classList\.add\('turn'\)/);
  assert.match(landBody, /onLand\(\)/);
  assert.match(body, /if \(p < 1\) requestAnimationFrame\(step\); else land\(\);/);
  assert.match(body, /if \(reduce \|\| typeof requestAnimationFrame !== 'function'\) \{ land\(\); continue; \}/, 'reduced motion lands at once');
});

/* ---- the motion keeps its two rules --------------------------------------------------------- */

test('the card arrives with depth, using transforms only', () => {
  assert.match(CSS, /\.corr-card:not\(\.in\)\{transform:translateY\(6px\) rotateX\(-14deg\)\}/);
  for (const kf of ['@keyframes corr-turn{', '@keyframes corr-exhale{']) {
    const block = CSS.slice(CSS.indexOf(kf), CSS.indexOf(kf) + 240);
    assert.doesNotMatch(block, /\b(width|height|top|left|margin|padding)\s*:/, `${kf} must not move layout`);
  }
});

test('green is the verdict: nothing is green until it lands, and nothing glows after', () => {
  assert.match(CSS, /\.corr-card:not\(\.landed\) \.corr-head\{color:var\(--text-3\)\}/);
  assert.match(CSS, /\.corr-card\.just-landed\{animation:corr-exhale/, 'the glow is the landing, once');
  assert.doesNotMatch(CSS, /\.corr-card\.landed\{box-shadow/, 'a record read back later does not glow');
});

test('every beat is switched off under prefers-reduced-motion', () => {
  const i = CSS.indexOf('@media (prefers-reduced-motion: reduce){', CSS.indexOf('.corr-card{'));
  const block = CSS.slice(i, i + 420);
  for (const sel of ['.corr-card', 'b.turn', '.corr-card.just-landed']) assert.ok(block.includes(sel), `${sel} must be neutralised`);
});

test('the note outlives the render that paints it, and is restored on the next paint', () => {
  assert.match(MEAL, /^let CHAT_NOTE = null;$/m);
  assert.match(MEAL, /CHAT_NOTE = t \? \{ key: corrKey/, 'setNote records as well as writes');
  assert.match(MEAL, /writeNote\(CHAT_NOTE\.text, CHAT_NOTE\.retry\)/);
  assert.doesNotMatch(MEAL, /CORR_FX|corrReceipt|playCorrReceipt|setCorrFx/, 'the private live card is gone');
});
