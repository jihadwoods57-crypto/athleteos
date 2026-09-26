/* Adaptive targets (goals and eating plan, phase B, 2026-09-26).
 *
 * Pins the suggestion math (the pace fit, the thresholds, the 150/200/250 sizing, the direction,
 * the 1500 floor, the 10g protein rule, the 14-day cadence, the data minimum, the minor and goal
 * exclusions), the reason text, and the coach's approve path: it goes through roles.coachSetGoals
 * with the athlete's current targets kept whole, and only then marks the row approved.
 * Run: node --test proto/redesign-2026-07/js/target-suggest.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const M = await import('./target-suggest-model.js');
const { approveSuggestion, declineSuggestion } = await import('./season-coach.js');

const TODAY = '2026-09-26';
const iso = (daysAgo) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - daysAgo * 86400000).toISOString().slice(0, 10);
/** Weigh-ins on a straight line: `perWeek` lb a week, ending at `end` lb today, every `every` days over `span`. */
const line = (perWeek, end = 200, span = 14, every = 7) => {
  const rows = [];
  for (let d = span; d >= 0; d -= every) rows.push({ date: iso(d), weight: +(end - (perWeek / 7) * d).toFixed(2) });
  return rows;
};
/** The row the server stores for a proposal: the numbers only (0253 fills pace and plan itself). */
const rowOf = (s) => ({ current_protein: s.currentProtein, current_kcal: s.currentKcal, proposed_protein: s.proposedProtein,
  proposed_kcal: s.proposedKcal, pace_lb_wk: s.perWeek, plan_lb_wk: s.planRate });
const base = { goal: 'gain', rows: line(0.2), current: { protein: 200, kcal: 3400 }, basisLb: 200, todayISO: TODAY };

test('the spec example: gaining 0.2 a week against 0.5 suggests +200', () => {
  const s = M.suggestTargets(base);
  assert.equal(s.perWeek, 0.2);
  assert.equal(s.calDelta, 200);
  assert.equal(s.proposedKcal, 3600);
  assert.equal(s.proteinDelta, 0);
  assert.equal(M.composeReason(rowOf(s)), 'Gaining 0.2 lb a week against a plan of 0.5. Suggest +200 calories.');
  assert.equal(s.reason, undefined, 'no free text travels to the server');
});

test('on plan: nothing', () => {
  for (const r of [0.4, 0.5, 0.6]) assert.equal(M.suggestTargets({ ...base, rows: line(r) }), null, String(r));
  for (const r of [-0.8, -1.0, -1.2]) assert.equal(M.suggestTargets({ ...base, goal: 'lose', rows: line(r) }), null, String(r));
});

test('sizing by how far off: 150, 200, 250, never more', () => {
  const gain = (r) => M.calorieStep('gain', r);
  assert.equal(gain(0.3), 150);     // 0.2 off
  assert.equal(gain(0.2), 200);     // 0.3 off
  assert.equal(gain(0.0), 250);     // 0.5 off
  assert.equal(gain(-1.0), 250);    // way off still caps at 250
  assert.equal(gain(0.7), -150);    // too fast: toward the plan
  assert.equal(gain(1.2), -250);
  const lose = (r) => M.calorieStep('lose', r);
  assert.equal(lose(-0.6), -200);   // losing slower: less food
  assert.equal(lose(-0.3), -250);
  assert.equal(lose(0.3), -250);    // gaining on a lose goal
  assert.equal(lose(-1.3), 150);    // losing too fast: more food
  assert.equal(lose(-1.5), 200);
  assert.equal(lose(-1.8), 250);
  for (const r of [-3, -2, -1.5, -0.2, 0, 0.4, 2, 3]) {
    assert.ok(Math.abs(M.calorieStep('gain', r)) <= 250);
    assert.ok(Math.abs(M.calorieStep('lose', r)) <= 250);
  }
});

test('direction: gaining slower +, losing slower -, too fast goes toward the plan', () => {
  assert.ok(M.suggestTargets({ ...base, rows: line(0.1) }).calDelta > 0);
  assert.ok(M.suggestTargets({ ...base, rows: line(1.1) }).calDelta < 0);
  const lose = { ...base, goal: 'lose', current: { protein: 180, kcal: 2400 } };
  assert.ok(M.suggestTargets({ ...lose, rows: line(-0.3) }).calDelta < 0);
  assert.ok(M.suggestTargets({ ...lose, rows: line(-2.0) }).calDelta > 0);
  assert.match(M.composeReason(rowOf(M.suggestTargets({ ...lose, rows: line(-0.3) }))), /^Losing 0\.3 lb a week against a plan of 1\. Suggest -250 calories\.$/);
  assert.match(M.composeReason(rowOf(M.suggestTargets({ ...lose, rows: line(0.3) }))), /^Gaining 0\.3 lb a week against a plan of losing 1\./);
});

test('the 1500 floor: never below it, and a number already under it is left alone', () => {
  const lose = { ...base, goal: 'lose', rows: line(-0.2) };
  assert.equal(M.suggestTargets({ ...lose, current: { protein: 150, kcal: 1600 } }).proposedKcal, 1500);
  assert.equal(M.suggestTargets({ ...lose, current: { protein: 150, kcal: 1500 } }), null);
  assert.equal(M.suggestTargets({ ...lose, current: { protein: 150, kcal: 1400 } }), null);
});

test('protein moves only when the bodyweight moved the per-pound target by 10g or more', () => {
  // Gain: 1 g per lb, rounded to 5. From a 200 lb basis to 205 is +5g: not enough.
  const small = M.suggestTargets({ ...base, rows: line(0.2, 205), basisLb: 200 });
  assert.equal(small.proteinDelta, 0);
  // 210 lb is +10g: it moves, and the reason says why.
  const big = M.suggestTargets({ ...base, rows: line(0.2, 210), basisLb: 200 });
  assert.equal(big.proteinDelta, 10);
  assert.equal(big.proposedProtein, 210);
  assert.match(M.composeReason(rowOf(big)), /\+10g protein for the new bodyweight/);
  // A coach-set protein moves by the same per-pound delta, never to the formula.
  assert.equal(M.suggestTargets({ ...base, rows: line(0.2, 210), basisLb: 200, current: { protein: 240, kcal: 3400 } }).proposedProtein, 250);
  // On pace but 10g heavier: a protein-only suggestion.
  const pOnly = M.suggestTargets({ ...base, rows: line(0.5, 212), basisLb: 200 });
  assert.equal(pOnly.calDelta, 0);
  assert.equal(pOnly.proteinDelta, 10);
});

test('data minimum: 3 weigh-ins spanning 10 days, inside 21', () => {
  assert.equal(M.suggestTargets({ ...base, rows: line(0.2, 200, 7, 7) }), null);            // 2 weigh-ins
  assert.equal(M.suggestTargets({ ...base, rows: line(0.2, 200, 8, 4) }), null);            // 3, but 8 days
  assert.ok(M.suggestTargets({ ...base, rows: line(0.2, 200, 10, 5) }));                    // 3 over 10 days
  // Old weigh-ins outside the window do not count.
  const old = [{ date: iso(40), weight: 190 }, { date: iso(30), weight: 192 }, { date: iso(2), weight: 200 }];
  assert.equal(M.suggestTargets({ ...base, rows: old }), null);
  assert.equal(M.weighIns(old, TODAY).length, 1);
  // Nonsense weights are ignored, and one weigh-in per date (the last wins).
  assert.equal(M.weighIns([{ date: iso(1), weight: 5 }, { date: iso(1), weight: 'x' }, { date: iso(1), weight: 200 }, { date: iso(1), weight: 201 }], TODAY)[0].lb, 201);
});

test('the 14-day cadence counts from the later of made and decided', () => {
  assert.equal(M.suggestTargets({ ...base, lastAt: `${iso(13)}T09:00:00Z` }), null);
  assert.ok(M.suggestTargets({ ...base, lastAt: `${iso(14)}T09:00:00Z` }));
  const row = { created_at: `${iso(20)}T09:00:00Z`, decided_at: `${iso(5)}T09:00:00Z` };
  assert.equal(M.lastMoment(row), row.decided_at);
  assert.equal(M.suggestTargets({ ...base, lastAt: M.lastMoment(row) }), null);   // a decline 5 days ago
  assert.equal(M.lastMoment({ created_at: `${iso(3)}T09:00:00Z`, decided_at: null }), `${iso(3)}T09:00:00Z`);
});

test('minors and other goals get nothing', () => {
  assert.equal(M.suggestTargets({ ...base, minor: true }), null);
  for (const goal of ['maintain', 'health', 'perform', 'performance', null, '']) assert.equal(M.suggestTargets({ ...base, goal }), null, String(goal));
  for (const goal of ['gain', 'build', 'gain_muscle', 'gain_weight']) assert.ok(M.suggestTargets({ ...base, goal }));
  for (const goal of ['lose', 'lose_fat']) assert.ok(M.suggestTargets({ ...base, goal, rows: line(-0.2) }));
});

test('the proposal always fits the database bounds (0253)', () => {
  for (const goal of ['gain', 'lose']) {
    for (const r of [-3, -2, -1.2, -0.6, 0, 0.1, 0.9, 2, 3]) {
      for (const kcal of [1500, 1600, 2400, 3400, 5000]) {
        const s = M.suggestTargets({ ...base, goal, rows: line(r, 180), basisLb: 200, current: { protein: 190, kcal } });
        if (!s) continue;
        assert.ok(s.proposedKcal >= 1500 && Math.abs(s.proposedKcal - s.currentKcal) <= 250, `${goal} ${r} ${kcal}`);
        assert.ok(Math.abs(s.proposedProtein - s.currentProtein) <= 60);
        assert.ok(s.proposedKcal !== s.currentKcal || s.proposedProtein !== s.currentProtein);
        assert.match(M.composeReason(rowOf(s)), M.REASON_RE);
      }
    }
  }
});

test('live = pending and younger than 14 days', () => {
  assert.equal(M.isLive({ status: 'pending', created_at: `${iso(13)}T09:00:00Z` }, TODAY), true);
  assert.equal(M.isLive({ status: 'pending', created_at: `${iso(14)}T09:00:00Z` }, TODAY), false);
  assert.equal(M.isLive({ status: 'declined', created_at: `${iso(1)}T09:00:00Z` }, TODAY), false);
});

test('the coach headline shows both numbers', () => {
  assert.equal(M.changeHeadline({ current_kcal: 3400, proposed_kcal: 3600, current_protein: 200, proposed_protein: 200 }), '3,400 to 3,600 cal');
  assert.equal(M.changeHeadline({ current_kcal: 2400, proposed_kcal: 2150, current_protein: 180, proposed_protein: 190 }), '2,400 to 2,150 cal · 180g to 190g protein');
  assert.equal(M.changeHeadline({ current_kcal: 3000, proposed_kcal: 3000, current_protein: 180, proposed_protein: 190 }), '180g to 190g protein');
});

test('the sentence is composed from numbers only, inside a strict pattern', () => {
  const r = { current_protein: 200, proposed_protein: 200, current_kcal: 3000, proposed_kcal: 3200, pace_lb_wk: 0.2, plan_lb_wk: 0.5 };
  assert.equal(M.composeReason(r), 'Gaining 0.2 lb a week against a plan of 0.5. Suggest +200 calories.');
  assert.match(M.composeReason(r), M.REASON_RE);
  assert.equal(M.composeReason({ ...r, pace_lb_wk: 0, plan_lb_wk: -1, proposed_kcal: 2800 }), 'Holding steady against a plan of losing 1. Suggest -200 calories.');
  // Anything that is not a number (a tampered row, a stale cache) composes nothing.
  for (const bad of [{ pace_lb_wk: '<b>0.2</b>' }, { plan_lb_wk: 0.7 }, { proposed_kcal: 'lots' }, { pace_lb_wk: null }]) {
    assert.equal(M.composeReason({ ...r, ...bad }), '', JSON.stringify(bad));
  }
});

test('Intuitive wording follows what actually changes (never "less food" for a protein-only change)', () => {
  const r = { current_protein: 180, current_kcal: 3000, pace_lb_wk: 0.2, plan_lb_wk: 0.5 };
  assert.match(M.composeIntuitive({ ...r, proposed_protein: 180, proposed_kcal: 3200 }), /slower than your plan.*a little more food/i);
  assert.match(M.composeIntuitive({ ...r, proposed_protein: 180, proposed_kcal: 2800, pace_lb_wk: 0.9 }), /faster than your plan.*a little less food/i);
  const p = M.composeIntuitive({ ...r, proposed_protein: 190, proposed_kcal: 3000, pace_lb_wk: 0.5 });
  assert.match(p, /protein/i);
  assert.doesNotMatch(p, /less food|more food|\d/);
  assert.doesNotMatch(M.composeIntuitive({ ...r, proposed_protein: 180, proposed_kcal: 3200 }), /\d/);
});

test('a row whose current numbers are not the live targets is stale', () => {
  const row = { current_protein: 200, current_kcal: 3400 };
  assert.equal(M.liveMatches(row, { protein: 200, kcal: 3400 }), true);
  assert.equal(M.liveMatches(row, { kcal: 3000 }), false);
  assert.equal(M.liveMatches(row, { protein: 205 }), false);
  assert.equal(M.liveMatches(row, {}), true);   // nothing known: the server re-checks
});

test('the device plan is the database plan (0253 parity)', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../../../supabase/migrations/0253_target_suggestions.sql', import.meta.url), 'utf8');
  assert.match(sql, new RegExp(`then ${M.PLAN.gain.rate} else ${M.PLAN.lose.rate.toFixed(1)} end`));
  assert.match(sql, new RegExp(`then ${M.PLAN.gain.tolerance} else ${M.PLAN.lose.tolerance} end`));
  assert.match(sql, new RegExp(`then ${M.PLAN.gain.perLb.toFixed(1)} else ${M.PLAN.lose.perLb} end`));
  assert.match(sql, /greatest\(80,/);
});

/* ---------------- approve is ONE server call (0253 applies it through coach_set_goals) ---------------- */
function stubs(decideAnswer = null) {
  const calls = [];
  const roles = { coachSetGoals: async (...a) => { calls.push(['coachSetGoals', ...a]); return true; } };
  const sb = {
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      if (fn === 'decide_target_suggestion') return { data: decideAnswer || (args.p_decision === 'expire' ? 'expired' : args.p_decision), error: null };
      return { data: null, error: { message: 'unexpected' } };
    },
  };
  return { calls, roles, sb };
}
const ROW = { id: 's1', athlete_id: 'a1', current_protein: 200, current_kcal: 3400, proposed_protein: 200, proposed_kcal: 3600 };

test('approve: one decide call; the client never writes the targets itself', async () => {
  const { calls, roles, sb } = stubs();
  const r = await approveSuggestion(ROW, { roles, sb, live: { protein: 200, kcal: 3400 } });
  assert.deepEqual(r, { ok: true, status: 'approved' });
  assert.deepEqual(calls, [['decide_target_suggestion', { p_id: 's1', p_decision: 'approved' }]]);
});

test('approve: live targets that moved refuse on the device and close the row', async () => {
  const { calls, roles, sb } = stubs();
  const r = await approveSuggestion(ROW, { roles, sb, live: { protein: 200, kcal: 3000 } });
  assert.deepEqual(r, { ok: false, status: 'stale' });
  assert.deepEqual(calls, [['decide_target_suggestion', { p_id: 's1', p_decision: 'expire' }]]);
});

test('approve: the server\'s own stale / expired answer is reported as it is', async () => {
  for (const ans of ['stale', 'expired']) {
    const { roles, sb } = stubs(ans);
    assert.deepEqual(await approveSuggestion(ROW, { roles, sb, live: {} }), { ok: false, status: ans });
  }
});

test('decline: marks it and never touches the targets', async () => {
  const { calls, roles, sb } = stubs();
  assert.deepEqual(await declineSuggestion(ROW, { roles, sb }), { ok: true, status: 'declined' });
  assert.deepEqual(calls.map((c) => c[0]), ['decide_target_suggestion']);
});
