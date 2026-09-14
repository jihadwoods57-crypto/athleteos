/* THE AI CALLED A LINEBACKER A LINEMAN (founder, 2026-09-13).
 *
 * A screenshot of the athlete's own meal thread: "which is exactly what a lineman needs", to an
 * athlete whose profile says LB. Two separate holes produced it.
 *
 * 1. THE POSITION WAS SENT AS A CODE. SPORT_POSITIONS stores 'LB', not 'Linebacker', and
 *    athlete-context.ts lowercased whatever it was handed. The prompt read
 *      "Athlete profile: football, lb, high school level, about 250 lb."
 *    A position that is spelled exactly like the weight unit beside it is not context, it is
 *    noise, and the model resolved it off the bodyweight instead. Fixed in positionWords(), whose
 *    own tests live next to it in supabase/functions/_shared/athlete-context.test.ts. The shared
 *    module cannot be imported here (Deno TS), so what THIS file pins is the other half.
 *
 * 2. THE THREAD KNEW NOTHING AT ALL. Only analyze-meal ever received the athlete. Every
 *    meal-chat caller — the meal thread composer, the Nutrition chat screen, the correction
 *    acknowledgement, and both coach-side calls — sent the meal, the day and the thread, and not
 *    one word about who was eating. So even a perfectly spelled position never reached a single
 *    follow-up answer.
 *
 * These are structural checks over source, deliberately: the failure is a field that is simply
 * absent from a request body, which no behavioural test of the surrounding screen can see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

const STATE = read('state.js');
const MEAL = read('screens', 'meal.js');
const NUTRITION_CHAT = read('screens', 'nutrition-chat.js');
const COACH = read('screens', 'coach.js');
const ROLES = read('roles.js');
const PROFILE = read('screens', 'profile.js');

/* ---- 1. one builder, shared by the read and every reply ------------------------------------ */

test('athleteContextForAnalysis is exported, so the read and the thread cannot describe two people', () => {
  assert.match(STATE, /export function athleteContextForAnalysis\(\)/,
    'the builder must be exported; a second, drifting copy in a screen is exactly how the read '
    + 'and the reply end up disagreeing about who the athlete is');
});

test('the builder still carries the position, and reads it off the athlete profile', () => {
  const body = STATE.slice(STATE.indexOf('export function athleteContextForAnalysis()'));
  const fn = body.slice(0, body.indexOf('\n}\n') + 1);
  for (const field of ['sport', 'position', 'level', 'bodyweightLb', 'dayType']) {
    assert.ok(fn.includes(field), `athleteContextForAnalysis must still send ${field}`);
  }
  assert.match(fn, /RT\.profile/, 'the athlete-side builder reads the signed-in athlete profile');
});

/* ---- 2. every athlete-facing meal-chat call carries it -------------------------------------- */

for (const [name, src] of [['the meal thread composer', MEAL], ['the Nutrition chat screen', NUTRITION_CHAT]]) {
  test(`${name} sends the athlete profile to meal-chat`, () => {
    assert.match(src, /athleteContextForAnalysis\b/,
      `${name} invokes meal-chat; without the athlete profile the AI answers a generic athlete`);
    assert.match(src, /import \{[^}]*athleteContextForAnalysis[^}]*\} from '\.\.\/state\.js'/,
      'a missing import throws at click time in this bundler-free app, not at build time');
  });
}

test('the correction acknowledgement carries it too', () => {
  const i = STATE.indexOf("correctionUpdate: true");
  assert.ok(i > 0, 'the correction acknowledgement still calls meal-chat');
  const call = STATE.slice(i - 200, i + 200);
  assert.match(call, /athleteContextForAnalysis\(\)/,
    'the reply that lands after a correction is coaching too, and it reads the same athlete');
});

/* ---- 3. the coach side reads the ROSTER, never the coach's own profile ---------------------- */

test("a coach-side call describes the ATHLETE, not the coach looking at the screen", () => {
  assert.match(COACH, /function athleteContextForMeal\(meal\)/,
    'the coach screens need their own builder: RT.profile there is the COACH');
  const body = COACH.slice(COACH.indexOf('function athleteContextForMeal(meal)'));
  const fn = body.slice(0, body.indexOf('\n}\n') + 1);
  assert.doesNotMatch(fn, /RT\.profile/,
    'sending RT.profile from a coach screen would have the AI describe the wrong person entirely');
  assert.match(fn, /CD\.roster/, 'the athlete on a coach screen comes off the roster row');
});

test('both coach-side meal-chat calls pass it', () => {
  assert.match(COACH, /coachAsk: true[\s\S]{0,160}athleteContextForMeal\(meal0\)/,
    "the coach's direct question to the AI carries the athlete's position");
  assert.match(COACH, /draftMealReplies\(sub, context, athleteContextForMeal\(meal0\)\.athlete\)/,
    'the four coach-voice drafts are about a specific athlete');
  assert.match(ROLES, /export async function draftMealReplies\(mealId, context, athlete\)/,
    'draftMealReplies must accept and forward the athlete');
  assert.match(ROLES, /draftReplies: true[\s\S]{0,160}athlete \? \{ athlete \} : \{\}/,
    'omitted rather than sent empty, so an unpositioned roster row leaves the prompt unchanged');
});

/* ---- 4. the codes are real, and they are what the app saves --------------------------------- */

test('the profile picker still saves CODES, which is why the prompt has to expand them', () => {
  assert.match(PROFILE, /Football: \['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'/,
    'if football positions ever become whole words here, positionWords() becomes a passthrough '
    + 'and this comment is the record of why it existed');
});
