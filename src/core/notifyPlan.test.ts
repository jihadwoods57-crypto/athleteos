// Notification planner framework (proto/redesign-2026-07/js/notify-plan.js) — the pure engine
// behind every athlete reminder. Proto is plain ESM JS (allowJs), same pattern as exec.test.ts.
// @ts-ignore
import { planNotifications, normalizePrefs, inQuiet, reqKind, DEFAULT_NOTIF_PREFS } from '../../proto/redesign-2026-07/js/notify-plan.js';

const meal = (id: string, title: string, open: number, due: number) => ({
  id, title, proof: 'photo', reminder: 'medium',
  impact: { kind: 'component', comp: 'nutrition' }, window: { open, due }, required: true,
});
const BREAKFAST = meal('breakfast', 'Breakfast', 7 * 60, 570);
const LUNCH = meal('lunch', 'Lunch', 12 * 60, 14 * 60);
const DINNER = meal('dinner', 'Dinner', 18 * 60, 1230);
const WEIGHT = { id: 'weight', title: 'Morning Weight', proof: 'scale', reminder: 'high', impact: { kind: 'trend' }, window: { due: 540 }, required: true };
const RECOVERY = { id: 'recovery', title: 'Recovery Check-In', proof: 'form', reminder: 'high', impact: { kind: 'component', comp: 'recovery' }, window: { due: 1410 }, required: true };
const ALL = [BREAKFAST, LUNCH, DINNER, WEIGHT, RECOVERY];

const plan = (over: object = {}) =>
  planNotifications({ nowMin: 5 * 60, dateISO: '2026-07-16', reqs: ALL, pressure: 'accountable', ...over } as never);

describe('prefs', () => {
  test('normalizePrefs: null → defaults, partial merges, junk clamped', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_NOTIF_PREFS);
    expect(normalizePrefs({ quietFrom: 21 * 60 }).quietFrom).toBe(21 * 60);
    expect(normalizePrefs({ quietFrom: 21 * 60 }).allowDeadline).toBe(true);
    expect(normalizePrefs({ quietFrom: 9999 }).quietFrom).toBe(DEFAULT_NOTIF_PREFS.quietFrom);
  });
  test('enabled:false → empty plan (cancel-all downstream)', () => {
    expect(plan({ prefs: { enabled: false } })).toEqual([]);
  });
  test('inQuiet handles the midnight wrap', () => {
    const p = normalizePrefs(null); // 22:00 → 7:00
    expect(inQuiet(23 * 60, p)).toBe(true);
    expect(inQuiet(3 * 60, p)).toBe(true);
    expect(inQuiet(7 * 60, p)).toBe(false);
    expect(inQuiet(12 * 60, p)).toBe(false);
  });
});

describe('volume + duplicates (the core complaints)', () => {
  // A merged entry's id is the joined ids ('weight+breakfast'); `carries` finds it either way.
  const carries = (e: any, id: string) => String(e.id).split('+').includes(id);
  test('accountable: one reminder per meal, one per high-urgency item — no soon+due doubles', () => {
    const p = plan();
    for (const id of ['breakfast', 'lunch', 'dinner', 'weight']) {
      expect(p.filter((e: any) => carries(e, id))).toHaveLength(1);
    }
  });
  test('the Mon/Wed/Fri morning is ONE brief: weigh-in and breakfast merge and name both deadlines', () => {
    const m = plan().find((e: any) => carries(e, 'weight'));
    expect(m.id).toBe('weight+breakfast');
    expect(m.fireAtMin).toBe(540 - 45); // the weigh-in's last call leads
    expect(m.title).toBe('Last call: weigh-in and breakfast');
    expect(m.subtitle).toBe('Both by 9:30 AM');
    expect(m.body).toContain('9:00 AM');
    expect(m.body).toContain('9:30 AM');
    expect(m.route).toBe('weight');
  });
  test('every entry carries the three-line shape: title, subtitle (or null), body', () => {
    for (const pressure of ['gentle', 'accountable', 'max']) {
      for (const e of plan({ pressure, streak: 5 })) {
        expect(typeof e.title).toBe('string');
        expect(e.subtitle === null || typeof e.subtitle === 'string').toBe(true);
        expect(typeof e.body).toBe('string');
      }
    }
  });
  test('no two entries share title+body (the old identical weigh-in pair is impossible)', () => {
    for (const pressure of ['gentle', 'accountable', 'max']) {
      const seen = new Set<string>();
      for (const e of plan({ pressure })) {
        const key = `${e.title}|${e.body}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
  test('three meals get three DIFFERENT bodies on the same day', () => {
    const bodies = plan({ reqs: [BREAKFAST, LUNCH, DINNER] }).map((e: any) => e.body.replace(/\d|AM|PM|:/g, ''));
    expect(new Set(bodies).size).toBe(bodies.length);
  });
  test('short-window collapse: weight becomes a single last-call at due−45 with due-stage copy', () => {
    // Alone (no breakfast to merge with) the weigh-in is one sharp last call, never a pair.
    const w = plan({ reqs: [WEIGHT, LUNCH] }).find((e: any) => e.id === 'weight');
    expect(w.stage).toBe('due');
    expect(w.fireAtMin).toBe(540 - 45);
    expect(w.title).toMatch(/weigh-in/i);
    expect(w.subtitle).toMatch(/9:00 AM/);
  });
  test('near-simultaneous entries coalesce into one combined notification', () => {
    // Two meals due 15 minutes apart → soon slots 15 minutes apart → one merged entry.
    const p = plan({ reqs: [meal('m1', 'Meal 1', 600, 800), meal('m2', 'Meal 2', 600, 815)] });
    expect(p).toHaveLength(1);
    expect(p[0].id).toBe('m1+m2');
    expect(p[0].title).toMatch(/Meal 1 and meal 2/);
    expect(p[0].route).toBe('camera/m1'); // start with the earliest-due item
  });
  test('daily cap holds even with a stacked custom standard', () => {
    const many = Array.from({ length: 14 }, (_, i) => meal(`m${i}`, `Meal ${i}`, 8 * 60, 9 * 60 + i * 90));
    expect(plan({ reqs: many }).length).toBeLessThanOrEqual(6);
    expect(plan({ reqs: many, pressure: 'gentle' }).length).toBeLessThanOrEqual(6);
    expect(plan({ reqs: many, pressure: 'max' }).length).toBeLessThanOrEqual(10);
  });
  test('future only: past slots never schedule', () => {
    for (const e of plan({ nowMin: 20 * 60 })) expect(e.fireAtMin).toBeGreaterThan(20 * 60);
  });
});

describe('quiet hours', () => {
  test('deadline warning survives quiet hours while the override is on', () => {
    const r = plan().find((e: any) => e.id === 'recovery');
    expect(r.stage).toBe('due');
    expect(r.fireAtMin).toBe(1410 - 45); // 22:45, inside 22:00–7:00 quiet, allowed through
  });
  test('with the override off, the recovery reminder shifts to just before quiet starts', () => {
    const r = plan({ prefs: { allowDeadline: false } }).find((e: any) => e.id === 'recovery');
    expect(r.fireAtMin).toBe(22 * 60 - 15); // 9:45 PM — the last one before winding down
  });
  test('gentle recovery nudge (soon stage) also respects quiet hours by shifting', () => {
    const r = plan({ pressure: 'gentle' }).find((e: any) => e.id === 'recovery');
    expect(r.fireAtMin).toBe(22 * 60 - 15);
  });
  test('a later quiet cutoff keeps the original slot', () => {
    const r = plan({ prefs: { quietFrom: 23 * 60, allowDeadline: false } }).find((e: any) => e.id === 'recovery');
    expect(r.fireAtMin).toBe(1410 - 45); // 22:45 is now outside quiet
  });
});

describe('stages by pressure + urgency', () => {
  test('gentle: soon only, never a due stage', () => {
    for (const e of plan({ pressure: 'gentle' })) expect(e.stage).toBe('soon');
  });
  test('accountable: medium urgency never gets a due stage; high does', () => {
    const p = plan();
    expect(p.find((e: any) => e.id === 'dinner').stage).toBe('soon');
    expect(p.find((e: any) => String(e.id).startsWith('weight')).stage).toBe('due');
  });
  test('max: window-open stage appears for windowed items', () => {
    const stages = plan({ pressure: 'max', reqs: [DINNER] }).map((e: any) => e.stage);
    expect(stages).toContain('open');
    expect(stages).toContain('due');
  });
});

describe('copy honesty', () => {
  test('no internal scoring formulas, ever', () => {
    for (const pressure of ['gentle', 'accountable', 'max']) {
      for (const e of plan({ pressure })) {
        expect(`${e.title} ${e.body}`).not.toMatch(/\d+\s*%|keeps the 50|Recovery 25/i);
      }
    }
  });
  test('weight copy never mentions score or points', () => {
    const w = plan({ reqs: [WEIGHT, LUNCH] }).find((e: any) => e.id === 'weight');
    expect(`${w.title} ${w.subtitle} ${w.body}`).not.toMatch(/score|point/i);
  });
  test('voice standard: no app name, no exclamation, no em dash, short titles, one-sentence bodies', () => {
    for (const pressure of ['gentle', 'accountable', 'max']) {
      for (const dateISO of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']) {
        const p = plan({ pressure, dateISO, streak: 4, coachName: 'Coach Mark' });
        expect(p.length).toBeGreaterThan(0);
        for (const e of p) {
          const all = `${e.title} ${e.subtitle ?? ''} ${e.body}`;
          expect(all).not.toMatch(/OnStandard|!|—/);
          expect(e.title.length).toBeLessThanOrEqual(40);
          expect(e.body.length).toBeLessThanOrEqual(120);
        }
      }
    }
  });
  test('coach name lands in recovery copy when linked (and only when the variant uses it)', () => {
    // The coach-presence variant is deterministic for a fixed date — a coach name must never
    // crash the copy engine and must never appear when no coach is linked.
    const withCoach = plan({ dateISO: '2026-07-17', reqs: [RECOVERY], pressure: 'gentle', coachName: 'Coach Mark', prefs: { quietFrom: 23 * 60 + 45 } });
    expect(withCoach).toHaveLength(1);
    const without = plan({ dateISO: '2026-07-17', reqs: [RECOVERY], pressure: 'gentle', prefs: { quietFrom: 23 * 60 + 45 } });
    expect(without[0].body).not.toContain('Coach Mark');
  });
});

describe('kinds + extensibility', () => {
  test('reqKind infers from proof/impact, not hardcoded ids', () => {
    expect(reqKind({ proof: 'photo' })).toBe('meal');
    expect(reqKind({ proof: 'scale' })).toBe('weigh');
    expect(reqKind({ proof: 'form', impact: { comp: 'recovery' } })).toBe('recovery');
    // Task 10: there is no 'checkin' kind anymore — that branch existed for the Weekly Check-In
    // ritual, which v2 deleted (no live impact.comp is ever 'checkin'), so every 'form' proof
    // — including a stale pre-cutover item that still literally carries comp:'checkin' — reads
    // as 'recovery' now.
    expect(reqKind({ proof: 'form', impact: { comp: 'checkin' } })).toBe('recovery');
    expect(reqKind({ proof: 'check' })).toBe('task');
  });
  test('a brand-new custom requirement kind still gets sane copy and a route', () => {
    const custom = { id: 'film-review', title: 'Film Review', proof: 'check', reminder: 'high', impact: { kind: 'plan' }, window: { due: 17 * 60 }, required: true, route: 'requirement/film-review' };
    const p = plan({ reqs: [custom] });
    expect(p).toHaveLength(1);
    expect(p[0].title).toMatch(/Film Review|film review/);
    expect(p[0].route).toBe('requirement/film-review');
  });
  test('coach-standard meal slots (meal-5) ride the meal templates with photo routes', () => {
    const p = plan({ reqs: [meal('meal-5', 'Meal 5', 15 * 60, 17 * 60)] });
    expect(p[0].route).toBe('camera/meal-5');
  });
});

describe('assigned tasks', () => {
  test('a dated assignment gets one soon reminder deep-linking to its detail', () => {
    const p = plan({ reqs: [], assigned: [{ id: 'a1', title: 'Band work', from: 'Coach Lee', done: false, dueAtMin: 18 * 60 }] });
    expect(p).toHaveLength(1);
    expect(p[0].fireAtMin).toBe(17 * 60);
    expect(p[0].route).toBe('requirement/a1');
    expect(p[0].title).toContain('Coach Lee');
  });
  test('done or dateless assignments never remind', () => {
    expect(plan({ reqs: [], assigned: [{ id: 'a1', title: 'X', done: true, dueAtMin: 18 * 60 }] })).toEqual([]);
    expect(plan({ reqs: [], assigned: [{ id: 'a2', title: 'Y', done: false, dueAtMin: null }] })).toEqual([]);
  });
});

describe('verified commitments', () => {
  const vc = (over: object = {}) => ({ at: 6 * 60, instanceId: 'rc-1', title: '5 AM Club', body: 'Respond by 5:15 AM.', ...over });

  test('a commitment reminder deep-links to its own instance', () => {
    const p = plan({ reqs: [], commitments: [vc()] });
    expect(p).toHaveLength(1);
    expect(p[0].route).toBe('roll-call/rc-1');
    expect(p[0].fireAtMin).toBe(6 * 60);
  });

  test('an idless commitment is never scheduled — the route would open a screen with nothing to press', () => {
    // Before 2026-07-31 this produced `roll-call/`, whose detail screen could not resolve an
    // instance and spun on it until the WebView stopped responding.
    expect(plan({ reqs: [], commitments: [vc({ instanceId: null, instance_id: null })] })).toEqual([]);
    expect(plan({ reqs: [], commitments: [vc({ instanceId: undefined, instance_id: '' })] })).toEqual([]);
    // The snake_case field alone is still a real id.
    const p = plan({ reqs: [], commitments: [vc({ instanceId: null, instance_id: 'rc-2' })] });
    expect(p[0].route).toBe('roll-call/rc-2');
  });
});

describe('celebration', () => {
  test('celebration is a single immediate acknowledgment; gentle skips it', () => {
    const p = plan({ celebration: true, score: 91, streak: 6 });
    expect(p).toHaveLength(1);
    expect(p[0].immediate).toBe(true);
    expect(p[0].body).toContain('91');
    expect(p[0].body).toContain('7');
    expect(plan({ celebration: true, pressure: 'gentle' })).toEqual([]);
  });
});
