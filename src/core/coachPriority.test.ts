// Coach Priorities ranking — deterministic, mark-handled-aware (spec §Coach Priorities).
// @ts-ignore
import { buildPriorities, reasonKey } from '../../proto/redesign-2026-07/js/priority.js';

const status = (key: string, openIds: string[] = [], detail = '') => ({
  key, detail, label: key,
  openItems: openIds.map(id => ({ id, title: id, dueMin: 840, state: key === 'overdue' ? 'overdue' : 'due_soon' })),
});
const entry = (id: string, key: string, over: object = {}, openIds: string[] = []) => ({
  row: { athleteId: id, name: id, unit: 'LB', score: 50, loggedToday: true, lastMealAt: null, tasks: [], scoreHistory: [], ...over },
  status: status(key, openIds),
});

test('critical outranks below outranks due_soon', () => {
  const p = buildPriorities({
    nowMin: 900,
    entries: [entry('due', 'due_soon', {}, ['lunch']), entry('below', 'below_standard'), entry('crit', 'overdue', { loggedToday: false, lastMealAt: null }, ['breakfast', 'lunch'])],
    interventions: [],
  });
  expect(p.map(x => x.athleteId)).toEqual(['crit', 'below', 'due']);
  expect(p[0].tier).toBe('critical');
});
test('on_standard / excused athletes never appear', () => {
  const p = buildPriorities({ nowMin: 900, entries: [entry('ok', 'on_standard'), entry('ex', 'excused')], interventions: [] });
  expect(p).toHaveLength(0);
});
test('reasonKey is stable regardless of item order', () => {
  expect(reasonKey(status('overdue', ['lunch', 'breakfast']))).toBe(reasonKey(status('overdue', ['breakfast', 'lunch'])));
});
test('a handled intervention with the same signature clears the card; a new reason resurfaces it', () => {
  const e = entry('a1', 'overdue', {}, ['lunch']);
  const key = reasonKey(e.status);
  expect(buildPriorities({ nowMin: 900, entries: [e], interventions: [{ athlete_id: 'a1', kind: 'handled', reason_key: key }] })).toHaveLength(0);
  const worse = entry('a1', 'overdue', {}, ['lunch', 'dinner']);
  expect(buildPriorities({ nowMin: 900, entries: [worse], interventions: [{ athlete_id: 'a1', kind: 'handled', reason_key: key }] })).toHaveLength(1);
});
test('every card carries a suggested action', () => {
  const p = buildPriorities({ nowMin: 900, entries: [entry('crit', 'overdue', { loggedToday: false }, ['breakfast', 'lunch']), entry('b', 'below_standard'), entry('d', 'due_soon', {}, ['lunch'])], interventions: [] });
  expect(p.find(x => x.athleteId === 'crit')!.suggestedAction.kind).toBe('message');
  expect(p.find(x => x.athleteId === 'b')!.suggestedAction.kind).toBe('review');
  expect(p.find(x => x.athleteId === 'd')!.suggestedAction.kind).toBe('nudge');
});

test('staleness escalation uses nowMs purely, never wall-clock', () => {
  const e = entry('a1', 'overdue', { loggedToday: false, lastMealAt: '2026-07-15T12:00:00Z' }, ['lunch']);
  const crit = buildPriorities({ nowMin: 900, nowMs: new Date('2026-07-17T12:00:00Z').getTime(), entries: [e], interventions: [] });
  expect(crit[0].tier).toBe('critical');       // 48h stale + 1 overdue ⇒ critical
  const fresh = buildPriorities({ nowMin: 900, nowMs: new Date('2026-07-15T14:00:00Z').getTime(), entries: [e], interventions: [] });
  expect(fresh[0].tier).toBe('due_soon');      // 2h old ⇒ not stale ⇒ single overdue stays due_soon tier
  const unk = buildPriorities({ nowMin: 900, entries: [e], interventions: [] });
  expect(unk[0].tier).toBe('due_soon');        // unknown nowMs ⇒ staleness never invented
});
