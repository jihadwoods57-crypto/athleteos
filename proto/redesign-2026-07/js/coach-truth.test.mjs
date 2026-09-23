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
