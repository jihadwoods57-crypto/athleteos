/* Lessons and the team challenge on the athlete's side (goals and eating plan, phase D, 2026-09-26).
 *
 * Pins: finishing a lesson is recorded (and never lost: a failed send stays pending, counts as done,
 * and goes on the next read); Home's slot draws the assigned lesson on top and lets a running team
 * challenge REPLACE the weekly focus; the challenge card is the server's numbers, a count for the
 * team and no names; Intuitive reads no grams; coaches, trainers and guardians get none of it; the
 * staff create menu and the Home door fail closed for view-only staff.
 * Run: node --test proto/redesign-2026-07/js/learn.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const mem = new Map();
const fakeStore = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => {}, localStorage: fakeStore,
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = fakeStore;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const { RT } = await import('./state.js');
const { DAY } = await import('./day.js');
const LD = await import('./learn-data.js');
const HT = await import('./home-teach.js');

/** A stub Supabase client: rpc answers from `answers`, and every call is recorded. */
function stubSb(answers) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      const a = answers[name];
      return typeof a === 'function' ? a(args) : (a || { data: null, error: { message: 'no stub' } });
    },
  };
}

function athlete(id, style = null) {
  LD._resetLearning();
  mem.clear();
  RT.userId = id;
  RT.authRole = 'athlete';
  RT.stdMeals = null;
  RT.profile = { baseGoal: 'gain', ...(style ? { planStyle: style } : {}) };
  RT.planStyle = null;
  DAY.date = '2026-09-24';
  DAY.proteinTarget = 180;
  DAY.meals = { breakfast: false, lunch: false, dinner: false, snack: false };
  DAY.slotMacros = {}; DAY.mealLoggedAt = {};
  DAY.scoreHistory = [];
}

const CHALLENGE = {
  id: 'c1', team_id: 't1', habit: 'protein:breakfast', starts_on: '2026-09-21', ends_on: '2026-09-27', goal_days: 5, from: 'Coach Grinch',
  team_on_track: 14, team_total: 22,
  mine: { eligible: true, hits: 2, reached: false, on_track: true, days: [
    { date: '2026-09-21', hit: true }, { date: '2026-09-22', hit: false }, { date: '2026-09-23', hit: true },
    { date: '2026-09-24', hit: false }, { date: '2026-09-25', hit: null }, { date: '2026-09-26', hit: null }, { date: '2026-09-27', hit: null },
  ] },
};
const ASSIGNED = [{ id: 'a1', lesson_id: 'carbs-are-fuel', due_on: '2026-09-25', created_at: '2026-09-23T12:00:00Z', from: 'Coach Grinch' }];

test('finishing a lesson is recorded through complete_lesson and counts as done at once', async () => {
  athlete('ln-a');
  const sb = stubSb({ complete_lesson: ({ p_lesson, p_correct }) => ({ data: { lesson_id: p_lesson, completed_at: '2026-09-24T12:00:00Z', quiz_correct: p_correct }, error: null }) });
  window.sb = sb;
  const r = await LD.recordCompletion('carbs-are-fuel', true);
  assert.equal(r.ok, true);
  assert.deepEqual(sb.calls, [{ name: 'complete_lesson', args: { p_lesson: 'carbs-are-fuel', p_correct: true } }]);
  assert.ok(LD.doneIds().includes('carbs-are-fuel'));
  assert.deepEqual(LD.pendingCompletions(), []);
  assert.equal((await LD.recordCompletion('not-a-lesson', true)).ok, false, 'an unknown lesson is never sent');
});

test('a failed send is never lost: it stays pending, counts as done, and goes on the next read', async () => {
  athlete('ln-b');
  let up = false;
  const sb = stubSb({
    complete_lesson: ({ p_lesson, p_correct }) => (up ? { data: { lesson_id: p_lesson, completed_at: 'x', quiz_correct: p_correct }, error: null } : { data: null, error: { message: 'offline' } }),
    my_learning: () => ({ data: { today: '2026-09-24', assignments: [], completions: [{ lesson_id: 'game-day', completed_at: 'x', quiz_correct: false }], challenge: null }, error: null }),
  });
  window.sb = sb;
  const r = await LD.recordCompletion('game-day', false);
  assert.equal(r.ok, false);
  assert.equal(LD.pendingCompletions().length, 1);
  assert.ok(LD.doneIds().includes('game-day'), 'the athlete never sees a finished lesson come back');
  up = true;
  await LD.loadLearning(true);
  assert.deepEqual(sb.calls.map((c) => c.name), ['complete_lesson', 'complete_lesson', 'my_learning'], 'flushed first, then read');
  assert.deepEqual(LD.pendingCompletions(), []);
  assert.ok(LD.doneIds().includes('game-day'));
});

test('THE HOME PRIORITY: the assigned lesson on top, and a running challenge replaces the focus card', async () => {
  athlete('ln-c');
  window.sb = stubSb({ my_learning: () => ({ data: { today: '2026-09-24', assignments: ASSIGNED, completions: [], challenge: CHALLENGE }, error: null }) });
  assert.equal(await LD.loadLearning(true), true);
  const html = HT.focusHtml();
  const lesson = html.indexOf('class="lnh"');
  const ch = html.indexOf('class="tch"');
  assert.ok(lesson >= 0 && ch > lesson, 'lesson card first, then the challenge');
  assert.doesNotMatch(html, /class="wf"/, 'never two focus cards');
  assert.match(html, /From Coach Grinch/);
  assert.match(html, /Carbs are fuel/);
  assert.match(html, /1 min · Due tomorrow/);
  assert.match(html, /14 of 22 on track/);
  assert.match(html, /2 of 5 days so far/);
  assert.match(html, /Protein at breakfast/);
  assert.match(html, /data-go="lesson\/breakfast-that-holds"/, 'the habit links its lesson');
  assert.doesNotMatch(html, /—/);
});

test('without a challenge the weekly focus is back; a finished lesson leaves Home', async () => {
  athlete('ln-d');
  window.sb = stubSb({ my_learning: () => ({ data: { today: '2026-09-24', assignments: ASSIGNED, completions: [{ lesson_id: 'carbs-are-fuel', completed_at: 'x', quiz_correct: true }], challenge: null }, error: null }) });
  await LD.loadLearning(true);
  const dates = ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
  DAY.scoreHistory = dates.map((date) => ({ date, score: 80, meals: { breakfast: true, lunch: true, dinner: true, snack: false },
    checkin: { slotMacros: { breakfast: { protein: 20 }, lunch: { protein: 60 }, dinner: { protein: 65 } }, mealLoggedAt: { breakfast: 500, lunch: 700, dinner: 1100 } } }));
  const html = HT.focusHtml();
  assert.doesNotMatch(html, /class="lnh"/, 'the done lesson is off Home');
  assert.doesNotMatch(html, /class="tch"/);
  assert.match(html, /class="wf"/, 'the personal focus is back');
  assert.match(html, /Learn: A breakfast that holds up/, 'and it links its lesson');
});

test('a challenge the athlete is not part of does not replace their focus', async () => {
  athlete('ln-e');
  const out = { ...CHALLENGE, habit: 'snack', mine: { ...CHALLENGE.mine, eligible: false } };
  window.sb = stubSb({ my_learning: () => ({ data: { today: '2026-09-24', assignments: [], completions: [], challenge: out }, error: null }) });
  await LD.loadLearning(true);
  assert.equal(HT.runningChallenge(), null);
  assert.doesNotMatch(HT.focusHtml(), /class="tch"/);
});

test('an Intuitive athlete reads the challenge without grams', async () => {
  athlete('ln-f', 'intuitive');
  window.sb = stubSb({ my_learning: () => ({ data: { today: '2026-09-24', assignments: [], completions: [], challenge: CHALLENGE }, error: null }) });
  await LD.loadLearning(true);
  const html = HT.challengeHtml();
  assert.match(html, /A palm of protein at breakfast/);
  assert.doesNotMatch(html, /\d+ ?g\b|gram|calorie/i);
});

test('coaches, trainers and guardians never get the slot', async () => {
  athlete('ln-g');
  window.sb = stubSb({ my_learning: () => ({ data: { today: '2026-09-24', assignments: ASSIGNED, completions: [], challenge: CHALLENGE }, error: null }) });
  await LD.loadLearning(true);
  for (const role of ['coach', 'trainer', 'parent']) {
    RT.authRole = role;
    assert.equal(HT.focusHtml(), '', role);
  }
});

test('the staff doors fail closed: only the standards editors get Assign and Start', async () => {
  const create = readFileSync(new URL('./screens/coach-create.js', import.meta.url), 'utf8');
  assert.match(create, /teachKey\(o\.key\) \? \(!practice && CD\.kind === 'team' && canSetTargets\(myRole\)\)/);
  const tc = readFileSync(new URL('./teach-coach.js', import.meta.url), 'utf8');
  assert.match(tc, /canSetTargets\(CD\.extras\.myRole\)/);
  const { canSetTargets } = await import('./staff-access.js');
  assert.equal(canSetTargets('readonly'), false);
  assert.equal(canSetTargets('position_coach'), false);
  assert.equal(canSetTargets(null), false, 'a loading role gets nothing');
  assert.equal(canSetTargets('nutritionist'), true);
});

test('the coach Home door: a running challenge and the lessons, or the editor\'s way in', async () => {
  const TC = await import('./teach-coach.js');
  const board = { challenge: { habit: 'missed', starts_on: '2026-09-21', ends_on: '2026-09-27', ended_at: null }, on_track: 14, total: 22 };
  assert.deepEqual(TC.challengeValue(board, '2026-09-24', false), { text: 'Every meal in · 14 of 22 on track', go: 'coach-challenge', cta: 'Open', unset: false });
  assert.equal(TC.challengeValue(null, '2026-09-24', false), null, 'view-only staff with nothing running see no row');
  assert.equal(TC.challengeValue(null, '2026-09-24', true).go, 'coach-challenge/new');
  assert.equal(TC.challengeValue({ ...board, challenge: { ...board.challenge, ended_at: 'x' } }, '2026-09-24', true).go, 'coach-challenge/new');
  assert.deepEqual(TC.lessonsValue([{ done: 14, total: 22 }, { done: 3, total: 22 }], false).text, '2 assigned · 14 of 22 done on the latest');
  assert.equal(TC.lessonsValue([], false), null);
  assert.equal(TC.lessonsValue([], true).go, 'coach-lessons/assign');
});

test('assigning saves the row, then announces it once through send-push', async () => {
  const { assignLesson, startChallenge } = await import('./screens/coach-teach.js');
  const invoked = [];
  const sb = {
    from: () => ({ insert: (row) => ({ select: () => ({ single: async () => ({ data: { id: 'as-1', row }, error: null }) }) }) }),
    rpc: async () => ({ data: 'ch-1', error: null }),
    functions: { invoke: async (name, { body }) => { invoked.push([name, body]); return { error: null }; } },
  };
  window.sb = sb;
  assert.deepEqual(await assignLesson({ team: 't1', lesson: 'carbs-are-fuel', room: null, due: null }, sb), { ok: true, id: 'as-1' });
  assert.deepEqual(await startChallenge({ team: 't1', habit: 'missed', starts: '2026-09-21', ends: '2026-09-27', goal: 5 }, sb), { ok: true, id: 'ch-1' });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(invoked, [
    ['send-push', { teach_push: { kind: 'lesson', id: 'as-1' } }],
    ['send-push', { teach_push: { kind: 'challenge', id: 'ch-1' } }],
  ]);
  const dup = { ...sb, from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }) }) };
  assert.match((await assignLesson({ team: 't1', lesson: 'carbs-are-fuel' }, dup)).note, /already assigned/);
  const running = { ...sb, rpc: async () => ({ data: null, error: { code: '23505', message: 'a team challenge is already running' } }) };
  assert.match((await startChallenge({ team: 't1', habit: 'missed', starts: 'a', ends: 'b', goal: 5 }, running)).note, /already running/);
});

test('the bell links an assigned lesson and the challenge', async () => {
  const { feedRowFromServer } = await import('./notif-feed.js');
  assert.equal(feedRowFromServer({ kind: 'lesson:carbs-are-fuel', title: 'New lesson', created_at: '2026-09-24T12:00:00Z' }, Date.parse('2026-09-24T12:05:00Z')).route, 'lesson/carbs-are-fuel');
  assert.equal(feedRowFromServer({ kind: 'challenge', title: 'Team challenge', created_at: '2026-09-24T12:00:00Z' }, Date.parse('2026-09-24T12:05:00Z')).route, 'home');
});

test('fix: the weekly focus never repaints the slot on its own (it would wipe the lesson card)', () => {
  const wf = readFileSync(new URL('./weekly-focus.js', import.meta.url), 'utf8');
  assert.match(wf, /if \(SLOT_PAINTER\) \{ SLOT_PAINTER\(root\); return; \}/);
  const ht = readFileSync(new URL('./home-teach.js', import.meta.url), 'utf8');
  assert.match(ht, /WF\.setSlotPainter\(repaint\)/);
  const home = readFileSync(new URL('./screens/home.js', import.meta.url), 'utf8');
  assert.match(home, /import\('\.\.\/home-teach\.js'\)/, 'Home draws the slot through home-teach.js');
});

test('staff read the habit about the athletes, the athlete about themself', async () => {
  const { habitRule } = await import('./challenge-model.js');
  assert.equal(habitRule('protein:lunch'), 'A day counts when your lunch carries its share of your protein.');
  assert.equal(habitRule('protein:lunch', true, true), 'A day counts when their lunch carries its share of their protein.');
  assert.equal(habitRule('late', true, true), 'A day counts when every meal they log comes in on time.');
});
