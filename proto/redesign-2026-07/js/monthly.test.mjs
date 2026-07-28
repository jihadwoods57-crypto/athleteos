import assert from 'node:assert';
import { buildMonthPayload } from './monthly.js';

const days = [
  { date: '2026-06-02', score: 80, weight: 200, tasksDone: 3, tasksTotal: 3 },
  { date: '2026-06-03', score: 60, weight: 199, tasksDone: 2, tasksTotal: 4 },
  { date: '2026-06-28', score: 90, weight: 197, tasksDone: 4, tasksTotal: 4 },
  { date: '2026-05-30', score: 10, weight: 210 }, // out of month, must be excluded
];
const p = buildMonthPayload(days, '2026-06');
assert.strictEqual(p.period, '2026-06');
assert.strictEqual(p.loggedDays, 3);              // May row excluded
assert.strictEqual(p.avgScore, 77);               // round((80+60+90)/3)
assert.strictEqual(p.bestDay.score, 90);
assert.strictEqual(p.worstDay.score, 60);
assert.strictEqual(p.weightStart, 200);
assert.strictEqual(p.weightEnd, 197);

const sparse = buildMonthPayload([], '2026-06');
assert.strictEqual(sparse.loggedDays, 0);
assert.strictEqual(sparse.avgScore, null);
assert.strictEqual(sparse.bestDay, null);

console.log('buildMonthPayload: all assertions passed');
