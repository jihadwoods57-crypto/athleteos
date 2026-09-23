/* Review pass 2026-09-23, stream C: small coach-side truths, pinned. */
import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { inboxAlerts } from './inbox.js';
import { buildPriorities } from './priority.js';
import { statusLabel, STATUS_META } from './status.js';
import { buildRosterRow, lastScoredDayOf } from './roles.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('C-M9: an overdue alert is stamped with when it went overdue, not "now"', () => {
  const entries = [
    { status: { openItems: [{ id: 'lunch', title: 'Lunch', state: 'overdue', dueMin: 14 * 60 }] } },
    { status: { openItems: [{ id: 'lunch', title: 'Lunch', state: 'overdue', dueMin: 14 * 60 + 30 }] } },
  ];
  const [a] = inboxAlerts(entries, 1);
  assert.strictEqual(a.title, "2 athletes haven't logged Lunch");
  assert.strictEqual(a.whenLabel, 'since 2:00 PM', 'the earliest deadline in the group');
  assert.match(src('screens/coach.js'), /const when = r\.whenLabel \|\| \(r\.ts \?/, 'the inbox row prefers the label');
});

test('C-M2: a quiet-since-Monday athlete reads "Last logged", not "No activity on record"', () => {
  const hist = [{ date: '2026-09-14', score: 81 }, { date: '2026-09-15', score: null }, { date: '2026-09-13', score: 70 }];
  assert.strictEqual(lastScoredDayOf(hist), '2026-09-14');
  assert.strictEqual(lastScoredDayOf([]), null);
  const row = buildRosterRow({ athlete_id: 'a1', athlete_name: 'Tommy Vargas' }, null, { scoreHistory: hist, lastMealAt: null });
  assert.strictEqual(row.lastDayISO, '2026-09-14');
  const [card] = buildPriorities({ nowMs: Date.now(), entries: [{ row, status: { key: 'no_activity', detail: 'No activity in the last day', openItems: [] } }], interventions: [] });
  assert.ok(card.reasons.includes('Last logged Mon'), card.reasons.join(' | '));
  assert.ok(!card.reasons.includes('No activity on record'));
  const fresh = buildRosterRow({ athlete_id: 'a2', athlete_name: 'New Kid' }, null, {});
  const [c2] = buildPriorities({ nowMs: Date.now(), entries: [{ row: fresh, status: { key: 'no_activity', detail: '', openItems: [] } }], interventions: [] });
  assert.ok(c2.reasons.includes('No activity on record'), 'kept for an athlete with no history at all');
  assert.match(src('screens/coach-roster.js'), /lastDayLabel\(row && row\.lastDayISO\) \|\| 'No logs yet'/);
});

test('C-M3: one word per status; a below-standard day is not renamed to its tier', () => {
  assert.strictEqual(statusLabel({ key: 'below_standard' }, 71), 'Below standard');
  assert.strictEqual(statusLabel({ key: 'below_standard' }, 45), 'Below standard');
  for (const k of Object.keys(STATUS_META)) assert.strictEqual(statusLabel({ key: k }, 95), STATUS_META[k].label);
  const home = src('screens/coach-home.js');
  assert.doesNotMatch(home, /critical: 'Critical'/, 'the queue rank is not printed as a fourth vocabulary');
  assert.match(home, /const tierLbl = statusLabel\(\{ key: c\.statusKey \}\)/);
});

test('C-M7: Copilot is unregistered (no screen linked to it) and its counts are gone', () => {
  const idx = src('screens/index.js');
  assert.doesNotMatch(idx, /copilot/);
  assert.doesNotMatch(src('screens/coach.js'), /export const copilot/);
});

test('C-B2 / Polish 6 / 9: nudge editors give the message its own 44px row and name the push plainly', () => {
  for (const f of ['screens/coach-home.js', 'screens/coach.js', 'screens/coach-roster.js']) {
    const s = src(f);
    assert.match(s, /class="ob-input nx-input"/, f);
    assert.doesNotMatch(s, /This exact message goes to/, f);
    assert.doesNotMatch(s, /nudge-body"[^>]*height:36px/, f);
  }
  assert.match(src('../css/coach.css'), /\.nx-input\.ob-input \{ width: 100%; min-height: 44px;/);
});

test('C-B4 / B9 / P2: Create names the book from the role cold, and its rows land with a next step', () => {
  const c = src('screens/coach-create.js');
  assert.match(c, /const practice = CD\.kind === 'practice' \|\| RT\.authRole === 'trainer';/);
  assert.match(c, /loadBook\(false, bookKindFor\(RT\.authRole\)\)/);
  assert.match(c, /go: 'coach-roster\/message'/);
  assert.match(c, /go: 'coach-roster\/excuse'/);
  assert.doesNotMatch(c, /title: 'Message a group'/);
  assert.match(src('screens/coach-roster.js'), /function taskFromSub\(sub\)/);
});

test('C-B8: an empty roster is not "loading" on Assign or Announce', () => {
  assert.match(src('screens/coach.js'), /if \(CD\.roster && !CD\.roster\.offline && !rows\.length\) \{/);
  assert.match(src('screens/coach-announce.js'), /if \(CD\.roster && !CD\.roster\.offline && !rows\.length\) \{/);
});

test('C-M5: most-missed stops at what is due today and skips rows without the meals column', async () => {
  const { mostMissed } = await import('./insights.js');
  const today = '2026-09-22';
  const reqs = { a1: [{ id: 'breakfast', title: 'Breakfast', kind: 'meal', required: true, freq: { type: 'daily' }, window: { due: 570 } },
    { id: 'lunch', title: 'Lunch', kind: 'meal', required: true, freq: { type: 'daily' }, window: { due: 840 } }] };
  const rollup = [
    { athlete_id: 'a1', day: today, meals_logged: 1, tasks_done: [] },
    { athlete_id: 'a1', day: '2026-09-21', meals_logged: null, tasks_done: [] },
  ];
  assert.deepStrictEqual(mostMissed({ rollup, reqsByAthlete: reqs, todayISO: today, nowMin: 10 * 60 }), [],
    'breakfast is in and lunch is not due yet; the null row proves nothing');
  const later = mostMissed({ rollup, reqsByAthlete: reqs, todayISO: today, nowMin: 15 * 60 });
  assert.deepStrictEqual(later.map((m) => [m.title, m.missedCount]), [['Lunch', 1]]);
});

test('C-M6 / P5 / P7 / Polish 1-4, 8, 11, 13: copy and doors', () => {
  assert.doesNotMatch(src('screens/auth.js') + src('screens/ob2-dietitian.js'), /never lies/);
  assert.doesNotMatch(src('screens/coach.js'), /'coach view'/);
  assert.match(src('screens/roles.js'), /dietLens\(\) \? 'Dietitian Profile' : 'Coach Profile'/);
  assert.match(src('components.js'), /const onProfile = /);
  assert.doesNotMatch(src('screens/account.js'), /backHead\('Account', email/);
  const rs = src('screens/rollcall-setup.js');
  assert.match(rs, /x\.skipped \? 'Cancelled'/);
  assert.match(rs, /id="rw-move" disabled>Move it/);
  assert.match(src('screens/coach-commitments.js'), /const DOW = \['S', 'M', 'T', 'W', 'T', 'F', 'S'\];/);
  assert.match(src('screens/roles.js'), /data-go="coach-plan-set\/team"><div class="lic">\$\{icon\('plus', 17\)\}<\/div><div class="lm"><div class="lt">Requirement templates/);
  assert.match(src('screens/rollcall-board.js'), /Roll call not found/);
  assert.match(src('screens/coach-home.js'), /S\.operatorIdentity\.state === 'loading' && !code \? ''/);
  assert.match(src('screens/settings.js'), /'coach-notif-settings'/);
  assert.match(src('screens/coach.js'), /co-tabs-fit co-scroll edge-fade/);
});
