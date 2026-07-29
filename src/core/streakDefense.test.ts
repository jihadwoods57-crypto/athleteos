/**
 * STREAK DEFENSE — the streak is congratulated but never defended.
 *
 * Today the only streak copy in the whole planner is the `celebrate` body ("day N of your
 * streak"), which fires AFTER the day is already won. The moment that actually decides retention
 * is the opposite one: a real run is alive, the day is not finished, and the window is closing.
 * Nothing spoke there, so the streak silently died and the athlete found out the next morning.
 *
 * Rules this locks in:
 *  - Only when a run worth defending exists (>= 2 days) AND required work is still open.
 *  - One per day, late in the day, never a second voice.
 *  - Names the streak, never a score formula (the planner's standing copy rule).
 *  - Suppressed on `gentle` — the same contract that suppresses `celebrate` there.
 *  - Subject to quiet hours: it is a nudge the app invented, not a coach-scheduled event.
 *  - Never fires once the day is complete (that path returns the celebration instead).
 */
/* eslint-disable @typescript-eslint/no-var-requires */
// @ts-ignore
import { planNotifications } from '../../proto/redesign-2026-07/js/notify-plan.js';

const meal = (id: string, title: string, open: number, due: number) => ({
  id, title, proof: 'photo', reminder: 'medium',
  impact: { kind: 'component', comp: 'nutrition' }, window: { open, due }, required: true,
});
const DINNER = meal('dinner', 'Dinner', 18 * 60, 1230);
const RECOVERY = {
  id: 'recovery', title: 'Recovery Check-In', proof: 'form', reminder: 'high',
  impact: { kind: 'component', comp: 'recovery' }, window: { due: 1410 }, required: true,
};

type Entry = { id: string; stage: string; fireAtMin: number; title: string; body: string };

const plan = (over: object = {}): Entry[] =>
  planNotifications({
    nowMin: 17 * 60, dateISO: '2026-07-29', reqs: [DINNER, RECOVERY],
    pressure: 'accountable', streak: 6, ...over,
  } as never);

const defense = (p: Entry[]) => p.filter((e) => e.stage === 'streak');

describe('streak defense — fires exactly when a live run is at risk', () => {
  test('a 6-day run with work still open gets one defense', () => {
    const d = defense(plan());
    expect(d).toHaveLength(1);
    expect(d[0].body).toContain('6');
  });

  test('it lands late but while there is still time to act', () => {
    // Deliberately NOT anchored after the final requirement reminder: a day with a 23:30
    // recovery check-in would push it past midnight, which only reports a loss.
    const d = defense(plan())[0];
    expect(d.fireAtMin).toBeGreaterThanOrEqual(18 * 60);
    expect(d.fireAtMin).toBeLessThan(22 * 60); // before the default quiet window opens
  });

  test('never more than one, however many requirements are open', () => {
    expect(defense(plan({ reqs: [DINNER, RECOVERY, meal('lunch', 'Lunch', 720, 840)] }))).toHaveLength(1);
  });

  test('no run, or a one-day run, is not yet a streak to lose', () => {
    expect(defense(plan({ streak: 0 }))).toHaveLength(0);
    expect(defense(plan({ streak: 1 }))).toHaveLength(0);
  });

  test('a 2-day run is the floor where it starts', () => {
    expect(defense(plan({ streak: 2 }))).toHaveLength(1);
  });

  test('gentle pressure stays quiet, exactly as it does for the celebration', () => {
    expect(defense(plan({ pressure: 'gentle' }))).toHaveLength(0);
  });

  test('a finished day celebrates instead of defending', () => {
    const p = plan({ celebration: true, score: 92 });
    expect(defense(p)).toHaveLength(0);
    expect(p.map((e) => e.stage)).toEqual(['celebrate']);
  });

  test('nothing required left open → nothing to defend', () => {
    expect(defense(plan({ reqs: [] }))).toHaveLength(0);
  });

  test('notifications off kills it with everything else', () => {
    expect(defense(plan({ prefs: { enabled: false } }))).toHaveLength(0);
  });

  test('it respects quiet hours rather than breaking through them', () => {
    // Quiet from 17:30 — a nudge the app invented must not punch through.
    const p = plan({ prefs: { quietFrom: 17 * 60 + 30, quietTo: 7 * 60 } });
    for (const e of defense(p)) expect(e.fireAtMin).toBeLessThan(17 * 60 + 30);
  });

  test('too late in the day to place it honestly → it is dropped, not fired at midnight', () => {
    expect(defense(plan({ nowMin: 23 * 60 + 50 }))).toHaveLength(0);
  });

  test('it names the streak and never a scoring formula', () => {
    const body = defense(plan())[0].body;
    expect(body).not.toMatch(/%|\bpoints?\b|50|score of/i);
    expect(`${defense(plan())[0].title} ${body}`.toLowerCase()).toContain('streak');
  });
});
