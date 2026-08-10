import test from 'node:test';
import assert from 'node:assert/strict';
import { passCoverage, slotMedians, withPassCredit, creditsLeft } from './pass.js';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const WINDOW = {
  id: 'p1', credits_total: null,
  covers_from: '2026-08-08', covers_until: '2026-08-09',
  expires_on: '2026-08-09', ended_at: null,
};
const CREDITS = {
  id: 'p2', credits_total: 3,
  covers_from: null, covers_until: null,
  expires_on: '2026-08-23', ended_at: null,
};

/* ---------------------------------------------------------------- coverage */

test('a window covers every slot inside its range', () => {
  assert.equal(passCoverage('2026-08-09', [WINDOW], [], SLOTS).size, 4);
});

test('a window covers nothing outside its range', () => {
  assert.equal(passCoverage('2026-08-10', [WINDOW], [], SLOTS).size, 0);
  assert.equal(passCoverage('2026-08-07', [WINDOW], [], SLOTS).size, 0);
});

test('a window respects a coach standard slot list', () => {
  const c = passCoverage('2026-08-09', [WINDOW], [], ['meal-1', 'meal-5', 'meal-6']);
  assert.deepEqual([...c].sort(), ['meal-1', 'meal-5', 'meal-6']);
});

test('a credit pass covers only the slots with a spend row', () => {
  const spends = [{ pass_id: 'p2', day_date: '2026-08-09', slot: 'dinner' }];
  assert.deepEqual([...passCoverage('2026-08-09', [CREDITS], spends, SLOTS)], ['dinner']);
});

test('a spend on another day does not leak into today', () => {
  const spends = [{ pass_id: 'p2', day_date: '2026-08-08', slot: 'dinner' }];
  assert.equal(passCoverage('2026-08-09', [CREDITS], spends, SLOTS).size, 0);
});

test('an ended pass covers nothing, and neither do its spends', () => {
  const dead = { ...WINDOW, ended_at: '2026-08-08T12:00:00Z' };
  assert.equal(passCoverage('2026-08-09', [dead], [], SLOTS).size, 0);
  const deadCredits = { ...CREDITS, ended_at: '2026-08-08T12:00:00Z' };
  const spends = [{ pass_id: 'p2', day_date: '2026-08-09', slot: 'dinner' }];
  assert.equal(passCoverage('2026-08-09', [deadCredits], spends, SLOTS).size, 0);
});

test('an expired window covers nothing even inside its dates', () => {
  const expired = { ...WINDOW, expires_on: '2026-08-08' };
  assert.equal(passCoverage('2026-08-09', [expired], [], SLOTS).size, 0);
});

test('credits fenced to a window still need a spend', () => {
  const fenced = { ...CREDITS, covers_from: '2026-08-08', covers_until: '2026-08-09' };
  assert.equal(passCoverage('2026-08-09', [fenced], [], SLOTS).size, 0,
    'a credit pass never auto-covers, even inside its fence');
});

test('coverage is empty when there is no pass at all', () => {
  assert.equal(passCoverage('2026-08-09', [], [], SLOTS).size, 0);
  assert.equal(passCoverage('2026-08-09', null, null, SLOTS).size, 0);
});

/* ---------------------------------------------------------------- credits left */

test('creditsLeft counts spends against the grant', () => {
  assert.equal(creditsLeft(CREDITS, [{ pass_id: 'p2' }, { pass_id: 'p2' }]), 1);
  assert.equal(creditsLeft(CREDITS, []), 3);
});

test('creditsLeft ignores spends belonging to another pass', () => {
  assert.equal(creditsLeft(CREDITS, [{ pass_id: 'other' }]), 3);
});

test('a window pass has no counter to show', () => {
  assert.equal(creditsLeft(WINDOW, []), null);
});

/* ---------------------------------------------------------------- medians */

const hist = (n, protein) => Array.from({ length: n }, (_, i) => ({
  date: `2026-07-${String(i + 1).padStart(2, '0')}`,
  meals: { dinner: true },
  checkin: { slotMacros: { dinner: { protein, kcal: protein * 15, carbs: 40, fat: 20, quality: 8 } } },
}));

test('the median comes from real earned days', () => {
  const m = slotMedians(hist(10, 40), ['dinner']);
  assert.equal(m.dinner.protein, 40);
  assert.equal(m.dinner.kcal, 600);
});

test('fewer than five real days yields null, not a guess', () => {
  assert.equal(slotMedians(hist(4, 40), ['dinner']).dinner, null);
});

test('a dup-flagged plate is not real evidence', () => {
  const rows = hist(6, 40);
  for (const r of rows) r.checkin.slotMacros.dinner.flagged = 'dup';
  assert.equal(slotMedians(rows, ['dinner']).dinner, null);
});

test('a slot the athlete never logs has no median', () => {
  assert.equal(slotMedians(hist(10, 40), ['breakfast']).breakfast, null);
});

test('pass-covered days are excluded from the median source', () => {
  const rows = hist(10, 40);
  const covered = new Set(rows.slice(0, 6).map((r) => `${r.date}|dinner`));
  assert.equal(slotMedians(rows, ['dinner'], { coveredKeys: covered }).dinner, null,
    'only four real days remain, so there is no honest median');
});

test('the median is the middle value, not the mean, so one hero plate cannot inflate it', () => {
  const rows = hist(9, 40);
  rows[8].checkin.slotMacros.dinner.protein = 400;   // the hero plate
  assert.equal(slotMedians(rows, ['dinner']).dinner.protein, 40);
});

test('only the trailing ten count', () => {
  const rows = hist(30, 10);
  for (const r of rows.slice(20)) r.checkin.slotMacros.dinner.protein = 50;
  assert.equal(slotMedians(rows, ['dinner']).dinner.protein, 50,
    'the older 20 days are outside the window and must not drag it down');
});

/* ---------------------------------------------------------------- synthesis */

test('a covered slot is filled from the median without touching the live day', () => {
  const live = { meals: { dinner: false }, slotMacros: {} };
  const { day } = withPassCredit(live, null, new Set(['dinner']),
    { dinner: { protein: 40, kcal: 600, carbs: 40, fat: 20, quality: 8 } });
  assert.equal(day.meals.dinner, true);
  assert.equal(day.slotMacros.dinner.protein, 40);
  assert.equal(day.slotMacros.dinner.via, 'pass');
  assert.equal(live.meals.dinner, false, 'the live day must keep telling the truth');
  assert.equal(Object.keys(live.slotMacros).length, 0);
});

test('a real log always beats a pass', () => {
  const live = { meals: { dinner: true }, slotMacros: { dinner: { protein: 99, kcal: 1000 } } };
  const { day } = withPassCredit(live, null, new Set(['dinner']),
    { dinner: { protein: 40, kcal: 600 } });
  assert.equal(day.slotMacros.dinner.protein, 99, 'the real plate is not overwritten');
});

test('a covered slot with no median leaves the denominator instead of scoring zero', () => {
  const live = { meals: { breakfast: true, lunch: false, dinner: false, snack: false }, slotMacros: {} };
  const { day, std } = withPassCredit(live, null, new Set(['dinner']), { dinner: null });
  assert.equal(std.mealsRequired, 3, 'the excused slot left the denominator');
  assert.ok(!std.slots.includes('dinner'));
  assert.equal(day.meals.dinner, false, 'and it was not credited from nothing');
});

test('excusing never drives the denominator below one', () => {
  const live = { meals: { breakfast: false, lunch: false, dinner: false, snack: false }, slotMacros: {} };
  const { std } = withPassCredit(live, null, new Set(SLOTS),
    { breakfast: null, lunch: null, dinner: null, snack: null });
  assert.equal(std.mealsRequired, 1);
});

test('a coach standard is preserved and only its covered slot is dropped', () => {
  const coachStd = { mealsRequired: 6, slots: ['meal-1', 'meal-2', 'meal-3', 'meal-4', 'meal-5', 'meal-6'], deadlines: { 'meal-1': 540 }, titles: { 'meal-1': 'Pre-lift' } };
  const live = { meals: {}, slotMacros: {} };
  const { std } = withPassCredit(live, coachStd, new Set(['meal-5']), { 'meal-5': null });
  assert.equal(std.mealsRequired, 5);
  assert.deepEqual(std.slots, ['meal-1', 'meal-2', 'meal-3', 'meal-4', 'meal-6']);
  assert.equal(std.deadlines['meal-1'], 540, 'the rest of the standard rides through untouched');
  assert.equal(std.titles['meal-1'], 'Pre-lift');
});

test('no coverage is a true no-op that returns the very same objects', () => {
  const live = { meals: { dinner: false }, slotMacros: {} };
  const stdIn = { mealsRequired: 4, slots: SLOTS };
  const out = withPassCredit(live, stdIn, new Set(), {});
  assert.equal(out.day, live, 'the common path must not clone');
  assert.equal(out.std, stdIn);
});

/* ---------------------------------------------------------------- integration with the scorer */

import { computeComponents, setDayStandard, scoreFor, evidenceCeiling } from './day.js';

const H = (n, protein) => Array.from({ length: n }, (_, i) => ({
  date: `2026-07-${String(i + 1).padStart(2, '0')}`,
  meals: { breakfast: true, lunch: true, dinner: true, snack: true },
  checkin: { slotMacros: { dinner: { protein, kcal: protein * 15, carbs: 50, fat: 20, quality: 8 } } },
}));

function scenario(over = {}) {
  return {
    date: '2026-08-09',
    meals: { breakfast: true, lunch: true, dinner: false, snack: true },
    mealLoggedAt: {},
    slotMacros: {
      breakfast: { protein: 30, kcal: 500, quality: 8 },
      lunch:     { protein: 40, kcal: 700, quality: 8 },
      snack:     { protein: 15, kcal: 200, quality: 8 },
    },
    quickAdded: [false, false, false],
    proteinTarget: 180, calTarget: 3200, scoringProfile: 'athlete',
    dailyCommitment: null, ci: {}, ciConfig: {}, ciSubmitted: false, ciLast: null,
    hydrationL: 3,
    passes: [], passSpends: [], scoreHistory: H(10, 45),
    ...over,
  };
}

test('a covered dinner scores from the median instead of zero', () => {
  setDayStandard(null);
  const bare = computeComponents(scenario(), null);
  const credited = computeComponents(scenario({
    passes: [CREDITS],
    passSpends: [{ pass_id: 'p2', day_date: '2026-08-09', slot: 'dinner' }],
  }), null);
  assert.ok(credited.nutrition > bare.nutrition,
    `the pass must actually move nutrition (bare ${bare.nutrition}, credited ${credited.nutrition})`);
});

test('a day with no pass is scored byte-identically to before', () => {
  setDayStandard(null);
  const a = computeComponents(scenario(), null);
  const b = computeComponents(scenario({ passes: undefined, passSpends: undefined }), null);
  assert.deepEqual(a, b, 'the no-pass path must not change for anybody');
});

test('a thin history excuses the slot rather than tanking the score', () => {
  setDayStandard(null);
  const thin = { passes: [CREDITS], passSpends: [{ pass_id: 'p2', day_date: '2026-08-09', slot: 'dinner' }], scoreHistory: H(2, 45) };
  const bare = computeComponents(scenario({ scoreHistory: H(2, 45) }), null);
  const excusedDay = computeComponents(scenario(thin), null);
  assert.ok(excusedDay.nutrition >= bare.nutrition,
    `excusing must never score WORSE than not having the pass (bare ${bare.nutrition}, excused ${excusedDay.nutrition})`);
});

test("another athlete's passes cannot leak in through module state", () => {
  setDayStandard(null);
  // A reconstructed day that carries no pass context of its own must score as unpassed, whatever
  // the signed-in user happens to be holding. coach.js:1811 scores other athletes this way.
  const foreign = scenario();
  delete foreign.passes;
  delete foreign.passSpends;
  assert.deepEqual(computeComponents(foreign, null), computeComponents(scenario(), null));
});

test('the write-path invariant survives a pass: scoreFor never exceeds evidenceCeiling', () => {
  setDayStandard(null);
  // score-v2.test.mjs pins this for logged days. A credited pass day must obey it too, or the
  // client hands the server a score its own ceiling refuses and the athlete silently loses the
  // points the reward just gave them.
  // Nothing logged at all, so the PASS is the only nutrition evidence on the row. With three
  // slots already logged the raw day has evidence anyway and the invariant holds by accident.
  const d = scenario({
    meals: { breakfast: false, lunch: false, dinner: false, snack: false },
    slotMacros: {},
    passes: [CREDITS],
    passSpends: [{ pass_id: 'p2', day_date: '2026-08-09', slot: 'dinner' }],
  });
  assert.ok(scoreFor(d) <= evidenceCeiling(d),
    `scoreFor ${scoreFor(d)} exceeded evidenceCeiling ${evidenceCeiling(d)} on a pass day`);
});
