// Coach OS Slice E — pure team insights engine (weekly brief, watch lists, most-missed, outcomes).
// @ts-ignore
import { weekWindows, weeklyBrief, athletesToWatch, mostMissed, weekVsMonth, interventionOutcomes } from '../../proto/redesign-2026-07/js/insights.js';

const rr = (athleteId: string, day: string, over: object = {}) => ({
  athlete_id: athleteId, day, position: 'LB', score: 80, meals_logged: 3,
  tasks_done: ['meal-1', 'meal-2', 'meal-3'], checkin_done: false, weight_logged: false, ...over,
});
const oc = (id: string, athleteId: string, kind: string, day: string, over: object = {}) => ({
  intervention_id: id, athlete_id: athleteId, kind, tier: 'standard', day,
  score_before: 70, score_after: 70, days_before: 7, days_after: 7, ...over,
});

const TODAY = '2026-07-16';

// ---------------- weekWindows ----------------
test('weekWindows: this=last 7 ending today, prev=7 before, month=last 28', () => {
  const w = weekWindows(TODAY);
  expect(w).toEqual({
    thisFrom: '2026-07-10', thisTo: '2026-07-16',
    prevFrom: '2026-07-03', prevTo: '2026-07-09',
    monthFrom: '2026-06-19',
  });
});

// ---------------- weeklyBrief ----------------
test('weeklyBrief: completion delta computed from two weeks of rollup rows', () => {
  const rollup = [
    ...['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16']
      .map(d => rr('a1', d, { meals_logged: 3 })), // this week: logged every day -> 100%
    ...['2026-07-03', '2026-07-04', '2026-07-05'].map(d => rr('a1', d, { meals_logged: 0 })), // 0%
    ...['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'].map(d => rr('a1', d, { meals_logged: 3 })), // 100%
  ];
  const roster = [{ athleteId: 'a1', name: 'Devin', position: 'LB' }];
  const b = weeklyBrief({ rollup, roster, todayISO: TODAY });
  // prev week: 3 zero days + 4 full days over 7 = 400/7 = 57.14% -> this(100) - prev(57) = 43
  const line = b.lines.find(l => /Meal completion/.test(l.text));
  expect(line).toBeTruthy();
  expect(line!.dir).toBe('up');
  expect(line!.text).toBe('Meal completion improved 43% this week.');
});

test('weeklyBrief: byRoom only for rooms with >=2 athletes and a nonzero delta', () => {
  const rollup = [
    rr('a1', '2026-07-16', { meals_logged: 3 }), rr('a1', '2026-07-09', { meals_logged: 0 }), // LB, swings 0->100
    rr('a2', '2026-07-16', { meals_logged: 3 }), rr('a2', '2026-07-09', { meals_logged: 0 }), // LB, swings 0->100
    rr('a3', '2026-07-16', { meals_logged: 3 }), rr('a3', '2026-07-09', { meals_logged: 0 }), // QB solo, would swing too
    rr('a4', '2026-07-16', { meals_logged: 3 }), rr('a4', '2026-07-09', { meals_logged: 3 }), // WR, no delta
    rr('a5', '2026-07-16', { meals_logged: 3 }), rr('a5', '2026-07-09', { meals_logged: 3 }), // WR, no delta
  ];
  const roster = [
    { athleteId: 'a1', name: 'A1', position: 'LB' }, { athleteId: 'a2', name: 'A2', position: 'LB' },
    { athleteId: 'a3', name: 'A3', position: 'QB' },
    { athleteId: 'a4', name: 'A4', position: 'WR' }, { athleteId: 'a5', name: 'A5', position: 'WR' },
  ];
  const b = weeklyBrief({ rollup, roster, todayISO: TODAY });
  expect(b.byRoom.map(r => r.room)).toEqual(['LB']);
  expect(b.byRoom[0].completionDelta).toBe(100);
});

test('weeklyBrief: empty rollup -> no lines, no byRoom', () => {
  const roster = [{ athleteId: 'a1', name: 'A1', position: 'LB' }, { athleteId: 'a2', name: 'A2', position: 'LB' }];
  const b = weeklyBrief({ rollup: [], roster, todayISO: TODAY });
  expect(b).toEqual({ lines: [], byRoom: [] });
});

// ---------------- athletesToWatch ----------------
test('athletesToWatch: a clean negative slope is a decliner; a 2-scored-day athlete is not', () => {
  const days = ['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'];
  const scores = [90, 85, 80, 75, 70, 65, 60];
  const rollup = [
    ...days.map((d, i) => rr('a1', d, { score: scores[i] })),
    rr('b1', '2026-07-15', { score: 50 }), rr('b1', '2026-07-16', { score: 45 }), // only 2 scored days
  ];
  const roster = [{ athleteId: 'a1', name: 'Devin', position: 'LB' }, { athleteId: 'b1', name: 'Sam', position: 'LB' }];
  const w = athletesToWatch({ rollup, roster, todayISO: TODAY });
  expect(w.decliners.map(d => d.athleteId)).toEqual(['a1']);
  expect(w.decliners[0].slope).toBeCloseTo(-5, 1);
  expect(w.decliners[0].text).toMatch(/Devin/);
  expect(w.recoverers).toEqual([]);
});

test('athletesToWatch: disengaging counts the no-data gap ending today, bounded by earliest data', () => {
  const rollup = [
    rr('control', '2026-07-16', {}), rr('control', '2026-07-15', {}), rr('control', '2026-07-01', {}),
    rr('jordan', '2026-07-08', {}), // last activity 8 days before today
  ];
  const roster = [{ athleteId: 'control', name: 'Control', position: 'LB' }, { athleteId: 'jordan', name: 'Jordan', position: 'LB' }];
  const w = athletesToWatch({ rollup, roster, todayISO: TODAY });
  const j = w.disengaging.find(d => d.athleteId === 'jordan');
  expect(j).toBeTruthy();
  expect(j!.gapDays).toBe(8);
  expect(j!.text).toBe('Jordan has no logged activity in 8 days.');
  expect(w.disengaging.find(d => d.athleteId === 'control')).toBeFalsy(); // no gap, not flagged
});

test('athletesToWatch: an athlete with zero rollup rows is excluded from disengaging (and decliners), even with a teammate\'s 30-day history', () => {
  const vetDays: string[] = [];
  let d = '2026-06-17';
  while (d <= TODAY) { vetDays.push(d); d = new Date(new Date(d + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10); }
  const rollup = vetDays.map(day => rr('vet', day, { score: 80 })); // 30 days of history; nothing for 'cam'
  const roster = [{ athleteId: 'vet', name: 'Vet', position: 'LB' }, { athleteId: 'cam', name: 'Cam', position: 'LB' }];
  const w = athletesToWatch({ rollup, roster, todayISO: TODAY });
  expect(w.disengaging.find(x => x.athleteId === 'cam')).toBeUndefined(); // no rows at all -> excluded, not a fabricated gap
  expect(w.decliners.find(x => x.athleteId === 'cam')).toBeUndefined();
});

test('athletesToWatch: disengaging gap is athlete-anchored — own last row, unaffected by a teammate\'s older rows', () => {
  const vetDays: string[] = [];
  let d = '2026-06-17';
  while (d <= TODAY) { vetDays.push(d); d = new Date(new Date(d + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10); }
  const rollup = [
    ...vetDays.map(day => rr('vet', day, { score: 80 })), // teammate's 30-day-old history, must not bound riley's walk-back
    rr('riley', '2026-07-11', {}), // riley's own earliest row: 5 days before today
    rr('riley', '2026-07-12', {}), // riley's own last activity: 4 days before today
  ];
  const roster = [{ athleteId: 'vet', name: 'Vet', position: 'LB' }, { athleteId: 'riley', name: 'Riley', position: 'LB' }];
  const w = athletesToWatch({ rollup, roster, todayISO: TODAY });
  const r = w.disengaging.find(x => x.athleteId === 'riley');
  expect(r).toBeTruthy();
  expect(r!.gapDays).toBe(4);
  expect(r!.text).toBe('Riley has no logged activity in 4 days.');
});

// ---------------- mostMissed ----------------
test('mostMissed: counts absent req ids only on the days the athlete actually has data', () => {
  const reqsByAthlete = {
    a1: [
      { id: 'recovery', title: 'Recovery Check-In', kind: 'other', required: true, freq: { type: 'daily' } },
      { id: 'weight', title: 'Morning Weight', kind: 'weigh', required: true, freq: { type: 'daily' } },
    ],
  };
  // Only 5 days of data in the window (not the full 7) -> missedCount must reflect 5, not 7.
  const rollup = ['2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16']
    .map(d => rr('a1', d, { tasks_done: [], weight_logged: true })); // recovery always missing; weight always logged
  const m = mostMissed({ rollup, reqsByAthlete, todayISO: TODAY });
  expect(m).toHaveLength(1); // weight has 0 misses -> silent, omitted entirely
  expect(m[0]).toEqual({
    reqId: 'recovery', title: 'Recovery Check-In', missedCount: 5,
    text: 'Recovery Check-In was missed 5 times across the team this week.',
  });
});

test('mostMissed: empty rollup -> empty list, never throws', () => {
  expect(mostMissed({ rollup: [], reqsByAthlete: {}, todayISO: TODAY })).toEqual([]);
});

// ---------------- weekVsMonth ----------------
test('weekVsMonth: averages the score windows correctly', () => {
  const weekDays = ['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'];
  const olderDays: string[] = [];
  let d = '2026-06-19';
  while (d < '2026-07-10') { olderDays.push(d); d = new Date(new Date(d + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10); }
  const rollup = [
    ...weekDays.map(day => rr('a1', day, { score: 80 })),
    ...olderDays.map(day => rr('a1', day, { score: 60 })),
  ];
  const v = weekVsMonth({ rollup, todayISO: TODAY });
  expect(v.weekAvg).toBe(80);
  expect(v.monthAvg).toBe(65); // (7*80 + 21*60) / 28 = 65
  expect(v.text).toBe("This week's average score (80) is above the trailing 28-day average (65).");
});

test('weekVsMonth: no scored days -> silent (empty text, null averages)', () => {
  const v = weekVsMonth({ rollup: [], todayISO: TODAY });
  expect(v).toEqual({ weekAvg: null, monthAvg: null, text: '' });
});

// ---------------- interventionOutcomes ----------------
test('interventionOutcomes: locked under 14-day span even with 5 qualifying outcomes', () => {
  const day = '2026-07-11'; // 5 days before today
  const outcomes = Array.from({ length: 5 }, (_, i) => oc(`i${i}`, `a${i}`, 'meal_reminder', day));
  const roster = Array.from({ length: 5 }, (_, i) => ({ athleteId: `a${i}`, name: `A${i}`, position: 'LB' }));
  const r = interventionOutcomes({ outcomes, roster, todayISO: TODAY });
  expect(r.unlocked).toBe(false);
  expect(r.sinceISO).toBe(day);
  expect(r.recoverers).toEqual([]);
  expect((r as any).text).toBeUndefined();
});

test('interventionOutcomes: locked under 5 qualifying outcomes even with a 14+ day span', () => {
  const day = '2026-06-25'; // span 21 days, plenty
  const outcomes = [
    oc('i0', 'a0', 'meal_reminder', day),
    oc('i1', 'a1', 'meal_reminder', day),
    oc('i2', 'a2', 'meal_reminder', day, { days_before: 0 }), // not qualifying
  ];
  const roster = [{ athleteId: 'a0', name: 'A0', position: 'LB' }, { athleteId: 'a1', name: 'A1', position: 'LB' }, { athleteId: 'a2', name: 'A2', position: 'LB' }];
  const r = interventionOutcomes({ outcomes, roster, todayISO: TODAY });
  expect(r.unlocked).toBe(false);
  expect(r.sinceISO).toBe(day);
});

test('interventionOutcomes: unlocks with correct avgLift, byKind, and recoverers (>= +5 lift)', () => {
  const outcomes = [
    oc('i0', 'a1', 'meal_reminder', '2026-07-01', { score_before: 70, score_after: 80 }), // lift +10
    oc('i1', 'a1', 'meal_reminder', '2026-07-05', { score_before: 75, score_after: 78 }), // lift +3 -> a1 avg 6.5
    oc('i2', 'a2', 'checkin_call', '2026-07-06', { score_before: 60, score_after: 58 }), // lift -2
    oc('i3', 'a3', 'checkin_call', '2026-07-07', { score_before: 50, score_after: 53 }), // lift +3
    oc('i4', 'a4', 'meal_reminder', '2026-07-08', { score_before: 65, score_after: 90 }), // lift +25
  ];
  // PostgREST numeric-as-string simulation on one row.
  (outcomes[4] as any).score_before = '65'; (outcomes[4] as any).score_after = '90';
  const roster = [
    { athleteId: 'a1', name: 'Devin', position: 'LB' }, { athleteId: 'a2', name: 'Sam', position: 'LB' },
    { athleteId: 'a3', name: 'Jo', position: 'LB' }, { athleteId: 'a4', name: 'Cam', position: 'LB' },
  ];
  const r = interventionOutcomes({ outcomes, roster, todayISO: TODAY });
  expect(r.unlocked).toBe(true);
  expect(r.sinceISO).toBe('2026-07-01');
  expect(r.byKind).toEqual([
    { kind: 'meal_reminder', n: 3, avgLift: 12.7 },
    { kind: 'checkin_call', n: 2, avgLift: 0.5 },
  ]);
  expect(r.recoverers).toEqual([
    { athleteId: 'a4', name: 'Cam', lift: 25 },
    { athleteId: 'a1', name: 'Devin', lift: 6.5 },
  ]);
  expect(r.text).toBe('Since 2026-07-01, 5 interventions show an average lift of +7.8 points.');
});

test('interventionOutcomes: no outcomes -> locked, sinceISO falls back to todayISO', () => {
  const r = interventionOutcomes({ outcomes: [], roster: [], todayISO: TODAY });
  expect(r).toEqual({ unlocked: false, sinceISO: TODAY, recoverers: [] });
});

// ---------------- empty inputs never throw ----------------
test('every function survives fully empty inputs without throwing', () => {
  expect(() => weekWindows(TODAY)).not.toThrow();
  expect(() => weeklyBrief({ rollup: [], roster: [], todayISO: TODAY })).not.toThrow();
  expect(() => athletesToWatch({ rollup: [], roster: [], todayISO: TODAY })).not.toThrow();
  expect(() => mostMissed({ rollup: [], reqsByAthlete: {}, todayISO: TODAY })).not.toThrow();
  expect(() => weekVsMonth({ rollup: [], todayISO: TODAY })).not.toThrow();
  expect(() => interventionOutcomes({ outcomes: [], roster: [], todayISO: TODAY })).not.toThrow();

  expect(weeklyBrief({ rollup: [], roster: [], todayISO: TODAY })).toEqual({ lines: [], byRoom: [] });
  expect(athletesToWatch({ rollup: [], roster: [], todayISO: TODAY })).toEqual({ decliners: [], disengaging: [], recoverers: [] });
  expect(mostMissed({ rollup: [], reqsByAthlete: {}, todayISO: TODAY })).toEqual([]);
});

// ---------------- determinism ----------------
test('determinism: same input twice -> deep-equal output', () => {
  const rollup = [rr('a1', '2026-07-16', { score: 90 }), rr('a1', '2026-07-10', { score: 70 }), rr('a1', '2026-07-12', { score: 80 })];
  const roster = [{ athleteId: 'a1', name: 'Devin', position: 'LB' }];
  const outcomes = [
    oc('i0', 'a1', 'meal_reminder', '2026-07-01', { score_before: 70, score_after: 80 }),
    oc('i1', 'a1', 'meal_reminder', '2026-07-02', { score_before: 71, score_after: 81 }),
    oc('i2', 'a1', 'meal_reminder', '2026-07-03', { score_before: 72, score_after: 82 }),
    oc('i3', 'a1', 'meal_reminder', '2026-07-04', { score_before: 73, score_after: 83 }),
    oc('i4', 'a1', 'meal_reminder', '2026-07-05', { score_before: 74, score_after: 84 }),
  ];
  expect(weeklyBrief({ rollup, roster, todayISO: TODAY })).toEqual(weeklyBrief({ rollup, roster, todayISO: TODAY }));
  expect(athletesToWatch({ rollup, roster, todayISO: TODAY })).toEqual(athletesToWatch({ rollup, roster, todayISO: TODAY }));
  expect(weekVsMonth({ rollup, todayISO: TODAY })).toEqual(weekVsMonth({ rollup, todayISO: TODAY }));
  expect(interventionOutcomes({ outcomes, roster, todayISO: TODAY })).toEqual(interventionOutcomes({ outcomes, roster, todayISO: TODAY }));
});
