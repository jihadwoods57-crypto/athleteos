// Enriched roster projection (Coach OS slice A) — pure merge, no client needed.
// @ts-ignore
import { buildRosterRow } from '../../proto/redesign-2026-07/js/roles.js';

const member = { athlete_id: 'a1', athlete_name: 'Devin Cole', position: 'LB' };
const day = { athlete_id: 'a1', date: '2026-07-16', score: 55, tasks: [{ id: 'breakfast', done: true }, { id: 'lunch', done: false }] };

test('row carries tasks, history and lastMealAt for the status/priority engines', () => {
  const hist = [{ date: '2026-07-15', score: 70 }, { date: '2026-07-16', score: 55 }];
  const r = buildRosterRow(member, day, { scoreHistory: hist, lastMealAt: '2026-07-16T12:10:00Z' });
  expect(r.tasks).toHaveLength(2);
  expect(r.scoreHistory).toEqual(hist);
  expect(r.lastMealAt).toBe('2026-07-16T12:10:00Z');
  expect(r.position).toBe('LB');
});

test('extras are optional — legacy two-arg calls unchanged', () => {
  const r = buildRosterRow(member, day);
  expect(r.score).toBe(55);
  expect(r.scoreHistory).toEqual([]);
  expect(r.lastMealAt).toBeNull();
});
