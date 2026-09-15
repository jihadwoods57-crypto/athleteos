// The coach's management batch (founder 2026-09-15): athlete-event notifications, the Manage
// sheet on the athlete card, the Requirements tab, position as ONE column, the AI Nutritionist's
// read on Overview, and the clutter sweep. Pure functions are exercised directly; screens are
// source-shape pinned, because the shipped proto has no bundler and a missing wire only throws at
// tap time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { feedRowFromServer } from './notif-feed.js';
import { normalizeCoachPrefs, DEFAULT_COACH_NOTIF_PREFS } from './coach-notify-plan.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');
const readRepo = (rel) => readFileSync(join(here, '..', '..', '..', rel), 'utf8');
const NOW = Date.parse('2026-09-15T14:00:00Z');

/* ---------- notifications: the coach knows the moment it happens ---------- */
test('every athlete event kind routes the coach to the right door', () => {
  const at = (kind) => feedRowFromServer({ id: 'n', kind, title: 't', created_at: '2026-09-15T13:00:00Z' }, NOW);
  const U = 'a1b2c3d4-0000-4000-8000-000000000001';
  assert.equal(at(`weight_logged:${U}`).route, `coach-athlete/${U}`);
  assert.equal(at(`checkin_logged:${U}`).route, `coach-athlete/${U}`);
  assert.equal(at(`training_logged:${U}`).route, `coach-athlete/${U}`);
  assert.equal(at(`rollcall_answered:${U}`).route, `coach-commitments/${U}`);
  assert.equal(at(`athlete_message:${U}`).route, `coach-meal/${U}`);
  assert.equal(at(`athlete_closing:${U}`).route, `coach-athlete/${U}`);
  assert.equal(at('weight_logged:abc').route, null, 'a malformed suffix routes nowhere, never somewhere wrong');
  assert.equal(at('miss_digest').route, 'coach-home');
  // A message to the coach and a closing window are the two that must read as urgent.
  assert.equal(at('athlete_message:m').level, 'high');
  assert.equal(at('athlete_closing:a').level, 'high');
});

test('the four athlete-event switches default ON and normalize honestly', () => {
  for (const k of ['onLog', 'onMessage', 'onLate', 'onClosing']) assert.equal(DEFAULT_COACH_NOTIF_PREFS[k], true, k);
  const p = normalizeCoachPrefs({ onLog: false, onClosing: 'nope' });
  assert.equal(p.onLog, false);
  assert.equal(p.onMessage, true);
  assert.equal(p.onClosing, true, 'only a literal false switches one off');
});

test('the switches are mirrored to profiles.coach_notify as ONE whole object', () => {
  const src = read('state.js');
  assert.match(src, /if \(\['onLog', 'onMessage', 'onLate', 'onClosing'\]\.some\(\(k\) => k in patch\)\)/);
  assert.match(src, /out\.coach_notify = \{ onLog: prefs\.onLog !== false, onMessage: prefs\.onMessage !== false, onLate: prefs\.onLate !== false, onClosing: prefs\.onClosing !== false \}/);
  // The settings screen exposes all four.
  const settings = read('screens/settings.js');
  for (const id of ['cns-onlog', 'cns-onmessage', 'cns-onclosing', 'cns-onlate']) assert.match(settings, new RegExp(`id="${id}"`), id);
});

test('every athlete log fires notifyCoachEvent with a deep-linkable kind', () => {
  const state = read('state.js');
  assert.match(state, /notifyCoachEvent\(\{ kind: `weight_logged:\$\{RT\.userId\}`/);
  assert.match(state, /notifyCoachEvent\(\{ kind: `checkin_logged:\$\{RT\.userId\}`/);
  assert.match(read('screens/log-training.js'), /training_logged:\$\{/);
  assert.match(read('screens/roll-call.js'), /rollcall_answered:\$\{/);
  assert.match(read('screens/nutrition-chat.js'), /kind: `athlete_message:\$\{target\.id\}`, urgent: true/);
  assert.match(read('screens/meal.js'), /athlete_message:\$\{/);
});

test('send-push honours the coach switches and quiet hours on the to_coach branch', () => {
  const fn = readRepo('supabase/functions/send-push/index.ts');
  assert.match(fn, /payload\.to_coach === true/);
  assert.match(fn, /coach_notify/);
  assert.match(fn, /function inQuietHours\(/);
  const esc = readRepo('supabase/functions/meal-miss-escalation/index.ts');
  assert.match(esc, /closingTasks\(/, 'the about-to-be-late rung');
  assert.match(esc, /athlete_closing:/);
  const shared = readRepo('supabase/functions/_shared/meal-miss.ts');
  assert.match(shared, /export const CLOSING_LEAD_MIN = 20/);
});

/* ---------- the athlete card: picture, real position, Manage ---------- */
test('the athlete head carries the avatar and the action row is Nudge / Targets / Manage / Reward', () => {
  const coach = read('screens/coach.js');
  assert.match(coach, /class="ca-av" data-avatar-uid=/);
  assert.match(coach, /id="ca-manage"/);
  assert.doesNotMatch(coach, /data-passign=/, 'Assign is gone from the athlete card');
  assert.match(coach, /function manageSheet\(P, athleteId, position\)/);
  for (const id of ['ca-pos-input', 'ca-pos-save', 'ca-remove', 'ca-remove-go', 'ca-remove-cancel', 'ca-mstatus']) assert.match(coach, new RegExp(`id="${id}"`), id);
  assert.match(coach, /\[data-ca-pos\]/);
  assert.match(coach, /\[data-ca-room\]/);
  assert.match(coach, /roles\.coachSetAthletePosition\(athleteIdM, v\)/);
  assert.match(coach, /roles\.removePracticeClient\(book, athleteIdM\) : await roles\.declineMember\(book, athleteIdM\)/);
});

test('position is written to the one source column through the RPC', () => {
  const roles = read('roles.js');
  assert.match(roles, /export async function coachSetAthletePosition\(athleteId, position\)/);
  assert.match(roles, /c\.rpc\('coach_set_athlete_position', \{ p_athlete: athleteId, p_position:/);
  const mig = readRepo('supabase/migrations/0237_position_is_one_column.sql');
  assert.match(mig, /create trigger trg_sync_position_to_memberships/);
  assert.match(mig, /coalesce\(nullif\(trim\(ap\.position\), ''\), m\.position\) as "position"/);
  assert.match(mig, /create or replace function public\.coach_set_athlete_position/);
});

test('the Requirements tab shows windows, targets and roll call with a door to change each', () => {
  const coach = read('screens/coach.js');
  const block = coach.slice(coach.indexOf('function requirementsSection(P, athleteId)'), coach.indexOf('function requirementsSection(P, athleteId)') + 9000);
  assert.match(block, /fmtMin\(/, 'meal windows are printed as clock times');
  assert.match(block, /coach-plan-set\//, 'a door to edit the standard');
  assert.match(block, /data-go="coach-plan\/\$\{/, 'a door to the targets');
  assert.match(block, /morning_roll_call/, 'the roll call card reads the board');
  assert.match(block, /coach-wakeup-(edit|new)/);
});

/* ---------- the AI Nutritionist's read ---------- */
test('the Overview carries the AI read with cadence and a two-day refresh throttle', () => {
  const coach = read('screens/coach.js');
  assert.match(coach, /\$\{aiSummaryCard\(P, athleteId\)\}\s*\$\{todayBlock\(P, athleteId\)\}/, 'the card sits right under the hero');
  assert.match(coach, /const SUMMARY_REFRESH_MS = 2 \* 24 \* 3600 \* 1000/);
  assert.match(coach, /data-asum-cad="3"/);
  assert.match(coach, /data-asum-cad="6"/);
  assert.match(coach, /id="asum-refresh"/);
  assert.match(coach, /roles\.refreshAthleteSummary\(athleteIdM\)/);
  assert.match(coach, /roles\.setAiSummaryCadence\(athleteIdM, kind, book, days\)/);
  // A repaint must never refetch: the loader is guarded by athlete id.
  assert.match(coach, /if \(!athleteId \|\| \(ASUM\.id === athleteId && \(ASUM\.loading \|\| ASUM\.row \|\| ASUM\.error\)\)\) return;/);
  const roles = read('roles.js');
  assert.match(roles, /c\.functions\.invoke\('athlete-summary', \{ body \}\)/);
  assert.match(roles, /error\.context\.json\(\)/, 'the 429 body is read off error.context');
  assert.match(roles, /c\.rpc\('set_ai_summary_cadence'/);
  const fn = readRepo('supabase/functions/athlete-summary/index.ts');
  assert.match(fn, /const MANUAL_EVERY_MS = 2 \* 24 \* 3600 \* 1000/);
  assert.match(fn, /error: 'throttled', retryAt:/);
  assert.match(fn, /checkSpend\(EST_USD\.text\)/, 'every paid call goes through the spend gate');
  const mig = readRepo('supabase/migrations/0238_athlete_ai_summaries.sql');
  assert.match(mig, /cadence_days\s+smallint not null default 6 check \(cadence_days in \(3, 6\)\)/);
});

/* ---------- today's proof and what's open read ONE fact ---------- */
test('a meal row for a slot counts as logged even when days.meals lags', () => {
  const coach = read('screens/coach.js');
  assert.match(coach, /const rowSlots = new Set\(todayMeals\.map\(m => String\(m\.type \|\| ''\)\.toLowerCase\(\)\)\)/);
  assert.match(coach, /const isLogged = \(k\) => !!mealsJson\[k\] \|\| rowSlots\.has\(k\)/);
});

/* ---------- the clutter sweep ---------- */
test('the sweep: no DB names, no fake counts, no orphan headings, no "Soon"', () => {
  assert.doesNotMatch(read('screens/coach.js'), /athlete_profiles\.targets\) via the coach_set_goals RPC/);
  assert.doesNotMatch(read('screens/coach.js'), /four honest components/);
  assert.doesNotMatch(read('plan-ask.js'), /is four parts/);
  assert.doesNotMatch(read('screens/plan.js'), /" s38">/, 'the s38 class sits INSIDE the class attribute');
  assert.equal((read('screens/plan.js').match(/ s38">/g) || []).length, 7);
  assert.doesNotMatch(read('screens/coach-home.js'), />Soon</);
  assert.doesNotMatch(read('screens/coach-home.js'), /What fills in next/);
  assert.doesNotMatch(read('screens/coach-home.js'), /data-tour="followups"/);
  assert.doesNotMatch(read('screens/home.js'), /Recent Results <span class="link" data-go="history">View all<\/span><\/h2>`\}/, 'no empty Recent Results heading');
  assert.doesNotMatch(read('screens/settings.js'), /Coach sets urgency/);
  assert.doesNotMatch(read('screens/settings.js'), /US units for now/);
  assert.doesNotMatch(read('screens/coach-insights.js'), /Nothing here is generated/);
  assert.doesNotMatch(read('screens/coach.js'), /from your real roster/);
  assert.doesNotMatch(read('screens/progress.js'), /four scored days of history/);
  assert.doesNotMatch(read('screens/notifications.js'), /Accountability moments, not spam/);
  assert.match(read('screens/notifications.js'), /isOperator\(\) \? 'coach-notif-settings' : 'notif-settings'/, 'operators get a door to their notification settings');
  // Trainers are never told "athlete" on the screens that carry the noun.
  const cc = read('screens/coach-commitments.js');
  assert.doesNotMatch(cc, /Athletes were told/);
  assert.doesNotMatch(cc, /Tell athletes/);
  assert.doesNotMatch(cc, /Athletes see this on Home/);
  assert.doesNotMatch(read('screens/coach-connected.js'), /counting against the athlete\./);
});

test('cards never touch: the app-wide adjacency floor is in app.css', () => {
  assert.match(read('../css/app.css'), /\.card \+ \.card \{ margin-top: var\(--s3\); \}/);
});
