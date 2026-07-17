// Coach notification planner (proto/redesign-2026-07/js/coach-notify-plan.js) — the coach-facing
// sibling of notify-plan.js's athlete engine. Proto is plain ESM JS (allowJs), same pattern as
// notifyPlan.test.ts / exec.test.ts.
// @ts-ignore
import {
  planCoachNotifications, normalizeCoachPrefs, alertKeys, DEFAULT_COACH_NOTIF_PREFS,
// @ts-ignore
} from '../../proto/redesign-2026-07/js/coach-notify-plan.js';

const NATIVE_KEYS = ['id', 'fireAtMin', 'dayOffset', 'immediate', 'stage', 'route', 'title', 'body'].sort();

const openItem = (id: string, title: string, dueMin: number, state: string) => ({ id, title, dueMin, state });
const entry = (athleteId: string, name: string, key: string, openItems: object[] = []) =>
  ({ row: { athleteId, name }, status: { key, openItems } });

const plan = (over: object = {}) =>
  planCoachNotifications({
    nowMin: 9 * 60, dateISO: '2026-07-17', entries: [], interventions: [], lastAlertKeys: [], ...over,
  } as never);

describe('prefs', () => {
  test('normalizeCoachPrefs: null → defaults, partial merges, junk clamped', () => {
    expect(normalizeCoachPrefs(null)).toEqual(DEFAULT_COACH_NOTIF_PREFS);
    expect(normalizeCoachPrefs({ briefingAt: 6 * 60 }).briefingAt).toBe(6 * 60);
    expect(normalizeCoachPrefs({ briefingAt: 6 * 60 }).recap).toBe(true);
    expect(normalizeCoachPrefs({ quietFrom: 9999 }).quietFrom).toBe(DEFAULT_COACH_NOTIF_PREFS.quietFrom);
    expect(normalizeCoachPrefs({ hourly: true }).hourly).toBe(true);
    expect(normalizeCoachPrefs({}).hourly).toBe(false);
    expect(normalizeCoachPrefs({ allowCriticalInQuiet: false }).allowCriticalInQuiet).toBe(false);
  });
  test('enabled:false → [] always, no matter what else is going on', () => {
    const e = entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]);
    expect(plan({ entries: [e], prefs: { enabled: false } })).toEqual([]);
  });
});

describe('alertKeys', () => {
  test('sorted "overdue:<id>:<n>" signatures, excused/on_standard never counted', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('lunch', 'Lunch', 650, 'overdue')]),
      entry('a3', 'Jess', 'overdue', [openItem('dinner', 'Dinner', 1100, 'overdue')]),
      entry('a4', 'Kim', 'excused', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a5', 'Lee', 'on_standard', [openItem('dinner', 'Dinner', 1100, 'overdue')]),
    ];
    expect(alertKeys(entries)).toEqual(['overdue:dinner:1', 'overdue:lunch:2']);
  });
  test('empty/garbage input degrades to []', () => {
    expect(alertKeys([])).toEqual([]);
    expect(alertKeys([null, undefined, {}] as never)).toEqual([]);
  });
});

describe('filtering + intervention-dedupe', () => {
  test('excused and on_standard entries never get a slot', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a2', 'Sam', 'excused', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a3', 'Jess', 'on_standard', []),
    ];
    const p = plan({ entries, prefs: { briefing: false, recap: false } });
    const due = p.filter((x: any) => x.stage === 'due' && !x.immediate);
    expect(due).toHaveLength(1);
    expect(due[0].title).toBe('Devin missed Lunch');
  });
  test('a today-intervention matching the CURRENT status signature drops the athlete', () => {
    const entries = [entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')])];
    const interventions = [{ athlete_id: 'a1', kind: 'nudge', reason_key: 'overdue:lunch' }];
    const p = plan({ entries, interventions, prefs: { briefing: false, recap: false } });
    expect(p.filter((x: any) => x.stage === 'due')).toHaveLength(0);
  });
  test('an intervention for a DIFFERENT status signature does not dedupe', () => {
    const entries = [entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')])];
    const interventions = [{ athlete_id: 'a1', kind: 'nudge', reason_key: 'due_soon:lunch' }];
    const p = plan({ entries, interventions, prefs: { briefing: false, recap: false } });
    expect(p.filter((x: any) => x.stage === 'due')).toHaveLength(1);
  });
  test('kind other than nudge/message/handled never dedupes', () => {
    const entries = [entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')])];
    const interventions = [{ athlete_id: 'a1', kind: 'assign', reason_key: 'overdue:lunch' }];
    const p = plan({ entries, interventions, prefs: { briefing: false, recap: false } });
    expect(p.filter((x: any) => x.stage === 'due')).toHaveLength(1);
  });
});

describe('grouped window alerts', () => {
  test('n===1 names the athlete directly', () => {
    const entries = [entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')])];
    const p = plan({ entries, prefs: { briefing: false, recap: false } });
    expect(p).toHaveLength(1);
    expect(p[0].title).toBe('Devin missed Lunch');
    expect(p[0].body).toBe('Devin.');
    expect(p[0].route).toBe('coach-inbox');
    expect(p[0].id).toBe('cn-due-overdue:lunch:1');
    expect(p[0].fireAtMin).toBe(Math.max(9 * 60 + 15, 700 + 30));
  });
  test('n>=2 counts athletes and lists first names', () => {
    const entries = [
      entry('a1', 'Devin Cole', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a2', 'Sam Rivera', 'overdue', [openItem('lunch', 'Lunch', 650, 'overdue')]),
    ];
    const p = plan({ entries, prefs: { briefing: false, recap: false, immediateCritical: false } });
    expect(p).toHaveLength(1);
    expect(p[0].title).toBe('2 athletes missed Lunch');
    expect(p[0].body).toBe('Devin, Sam.');
    expect(p[0].fireAtMin).toBe(700 + 30); // latest dueMin + 30 beats nowMin+15
  });
  test('body caps at 3 first names + "and N more"', () => {
    const entries = ['Devin', 'Sam', 'Jess', 'Kim'].map((n, i) =>
      entry(`a${i}`, n, 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]));
    const p = plan({ entries, prefs: { briefing: false, recap: false, immediateCritical: false } });
    expect(p[0].body).toBe('Devin, Sam, Jess and 1 more.');
  });
  test('distinct item ids group separately', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('dinner', 'Dinner', 1100, 'overdue')]),
    ];
    const p = plan({ entries, prefs: { briefing: false, recap: false } });
    expect(p.map((x: any) => x.title).sort()).toEqual(['Devin missed Lunch', 'Sam missed Dinner'].sort());
  });
});

describe('morning briefing + evening recap', () => {
  test('briefing only when briefingAt is still future, honest "Open for the latest" suffix', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', []),
      entry('a2', 'Sam', 'due_soon', []),
      entry('a3', 'Jess', 'on_standard', []),
    ];
    const future = plan({ entries, nowMin: 9 * 60, prefs: { briefingAt: 10 * 60, recap: false } });
    const b = future.find((x: any) => x.id === 'cn-open-briefing');
    expect(b).toBeTruthy();
    expect(b.title).toBe('Morning read');
    expect(b.body).toBe('1 overdue from yesterday · 1 due today. Open for the latest.');
    expect(b.route).toBe('coach-home');
    expect(b.stage).toBe('open');

    const past = plan({ entries, nowMin: 9 * 60, prefs: { briefingAt: 8 * 60, recap: false } });
    expect(past.find((x: any) => x.id === 'cn-open-briefing')).toBeUndefined();
  });
  test('recap only when recapAt is still future, honest counts excluding excused', () => {
    const entries = [
      entry('a1', 'Devin', 'on_standard', []),
      entry('a2', 'Sam', 'on_standard', []),
      entry('a3', 'Jess', 'overdue', []),
      entry('a4', 'Kim', 'excused', []),
    ];
    const future = plan({ entries, nowMin: 9 * 60, prefs: { recapAt: 10 * 60, briefing: false } });
    const r = future.find((x: any) => x.id === 'cn-open-recap');
    expect(r).toBeTruthy();
    expect(r.title).toBe('Evening recap');
    expect(r.body).toBe('2 finished on standard · 1 still open.');
    expect(r.route).toBe('coach-insights');

    const past = plan({ entries, nowMin: 9 * 60, prefs: { recapAt: 8 * 60, briefing: false } });
    expect(past.find((x: any) => x.id === 'cn-open-recap')).toBeUndefined();
  });
});

describe('hourly summary', () => {
  test('absent when there is nothing overdue', () => {
    const entries = [entry('a1', 'Devin', 'due_soon', [openItem('lunch', 'Lunch', 800, 'due_soon')])];
    const p = plan({ entries, nowMin: 10 * 60 + 5, prefs: { hourly: true, briefing: false, recap: false } });
    expect(p.filter((x: any) => x.stage === 'soon')).toHaveLength(0);
  });
  test('capped at the next 3 hourly marks while overdue persists', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('dinner', 'Dinner', 650, 'overdue')]),
    ];
    const nowMin = 10 * 60 + 5;
    const p = plan({ entries, nowMin, prefs: { hourly: true, briefing: false, recap: false } });
    const hourly = p.filter((x: any) => x.stage === 'soon');
    expect(hourly).toHaveLength(3);
    expect(hourly.map((x: any) => x.fireAtMin)).toEqual([11 * 60, 12 * 60, 13 * 60]);
    for (const h of hourly) {
      expect(h.title).toBe('2 requirements overdue across 2 athletes');
      expect(h.route).toBe('coach-inbox');
    }
  });
});

describe('immediate critical', () => {
  test('fires once for a NEW key with n>=2, absent when the key is already known', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('lunch', 'Lunch', 650, 'overdue')]),
    ];
    const fresh = plan({ entries, lastAlertKeys: [], prefs: { briefing: false, recap: false } });
    const imm = fresh.find((x: any) => x.immediate);
    expect(imm).toBeTruthy();
    expect(imm.title).toBe('2 athletes missed Lunch');
    expect(imm.stage).toBe('due');
    expect(imm.route).toBe('coach-inbox');

    const known = plan({ entries, lastAlertKeys: ['overdue:lunch:2'], prefs: { briefing: false, recap: false } });
    expect(known.find((x: any) => x.immediate)).toBeUndefined();
  });
  test('n===1 groups never trigger immediate (n>=2 required)', () => {
    const entries = [entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')])];
    const p = plan({ entries, lastAlertKeys: [], prefs: { briefing: false, recap: false } });
    expect(p.find((x: any) => x.immediate)).toBeUndefined();
  });
  test('only ONE immediate even with multiple new critical groups (alphabetically-first key wins)', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('lunch', 'Lunch', 650, 'overdue')]),
      entry('a3', 'Jess', 'overdue', [openItem('dinner', 'Dinner', 1100, 'overdue')]),
      entry('a4', 'Kim', 'overdue', [openItem('dinner', 'Dinner', 1050, 'overdue')]),
      entry('a5', 'Lee', 'overdue', [openItem('dinner', 'Dinner', 1000, 'overdue')]),
    ];
    const p = plan({ entries, lastAlertKeys: [], prefs: { briefing: false, recap: false } });
    const imm = p.filter((x: any) => x.immediate);
    expect(imm).toHaveLength(1);
    // 'overdue:dinner:3' sorts before 'overdue:lunch:2'
    expect(imm[0].title).toBe('3 athletes missed Dinner');
  });
  test('disabled via immediateCritical:false', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('lunch', 'Lunch', 650, 'overdue')]),
    ];
    const p = plan({ entries, lastAlertKeys: [], prefs: { immediateCritical: false, briefing: false, recap: false } });
    expect(p.find((x: any) => x.immediate)).toBeUndefined();
  });
});

describe('quiet hours', () => {
  test('briefing inside quiet hours shifts to quietTo', () => {
    const p = plan({ nowMin: 5 * 60, prefs: { briefingAt: 23 * 60, recap: false } });
    const b = p.find((x: any) => x.id === 'cn-open-briefing');
    expect(b).toBeTruthy();
    expect(b.fireAtMin).toBe(7 * 60); // default quietTo
  });
  test('window alert within 3h of quietTo shifts (2h59m)', () => {
    const entries = [entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 211, 'overdue')])];
    // natural = max(0+15, 211+30) = 241 → 179 min before quietTo(420) → shifts
    const p = plan({ entries, nowMin: 0, prefs: { briefing: false, recap: false } });
    expect(p).toHaveLength(1);
    expect(p[0].fireAtMin).toBe(7 * 60);
  });
  test('window alert more than 3h from quietTo drops (3h01m)', () => {
    const entries = [entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 209, 'overdue')])];
    // natural = max(0+15, 209+30) = 239 → 181 min before quietTo(420) → drops
    const p = plan({ entries, nowMin: 0, prefs: { briefing: false, recap: false } });
    expect(p).toHaveLength(0);
  });
  test('allowCriticalInQuiet (default true) fires immediate regardless of quiet', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 200, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('lunch', 'Lunch', 150, 'overdue')]),
    ];
    const p = plan({ entries, nowMin: 350, lastAlertKeys: [], prefs: { briefing: false, recap: false } }); // 350 is inside quiet (<420)
    const imm = p.find((x: any) => x.immediate);
    expect(imm).toBeTruthy();
    expect(imm.fireAtMin).toBe(350);
  });
  test('allowCriticalInQuiet:false demotes to a normal slot at quietTo (morning-side quiet)', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 200, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('lunch', 'Lunch', 150, 'overdue')]),
    ];
    const p = plan({
      entries, nowMin: 350, lastAlertKeys: [],
      prefs: { allowCriticalInQuiet: false, briefing: false, recap: false },
    });
    const critical = p.find((x: any) => x.id.startsWith('cn-due-immediate'));
    expect(critical).toBeTruthy();
    expect(critical.immediate).toBe(false);
    expect(critical.fireAtMin).toBe(7 * 60);
  });
  test('allowCriticalInQuiet:false on the evening side of the wrap drops entirely (pinned: no dayOffset roll)', () => {
    // nowMin 22:30 is inside quiet (evening side); quietTo (7:00) is numerically BEFORE nowMin,
    // and this planner never rolls a slot to tomorrow (dayOffset is always 0) — so it drops.
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 1300, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('lunch', 'Lunch', 1250, 'overdue')]),
    ];
    const p = plan({
      entries, nowMin: 22 * 60 + 30, lastAlertKeys: [],
      prefs: { allowCriticalInQuiet: false, briefing: false, recap: false, hourly: false },
    });
    expect(p.find((x: any) => x.id.startsWith('cn-due-immediate'))).toBeUndefined();
  });
  test('outside quiet hours, allowCriticalInQuiet:false has no effect', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 200, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('lunch', 'Lunch', 150, 'overdue')]),
    ];
    const p = plan({
      entries, nowMin: 9 * 60, lastAlertKeys: [],
      prefs: { allowCriticalInQuiet: false, briefing: false, recap: false },
    });
    const imm = p.find((x: any) => x.immediate);
    expect(imm).toBeTruthy();
  });
});

describe('cap + rank order', () => {
  const bigFixture = () => {
    const plain = Array.from({ length: 5 }, (_, i) =>
      entry(`p${i}`, `Plain${i}`, 'overdue', [openItem(`item${i}`, `Item ${i}`, 700 + i, 'overdue')]));
    const critical = [
      entry('c1', 'Critical One', 'overdue', [openItem('critical', 'Critical', 700, 'overdue')]),
      entry('c2', 'Critical Two', 'overdue', [openItem('critical', 'Critical', 650, 'overdue')]),
    ];
    return [...plain, ...critical];
  };
  test('cap holds at 8, rank immediate > due > soon > open, earliest-first within a rank', () => {
    const entries = bigFixture();
    const p = plan({
      entries, nowMin: 9 * 60, lastAlertKeys: [],
      prefs: { briefing: true, briefingAt: 10 * 60, recap: true, recapAt: 11 * 60, hourly: true },
    });
    expect(p).toHaveLength(8);
    expect(p.filter((x: any) => x.immediate)).toHaveLength(1);
    expect(p.filter((x: any) => x.stage === 'due')).toHaveLength(7); // 5 plain + 1 critical window alert + 1 immediate (also stage 'due')
    expect(p.filter((x: any) => x.stage === 'soon')).toHaveLength(1); // only 1 of 3 hourly marks fits
    expect(p.filter((x: any) => x.stage === 'open')).toHaveLength(0); // briefing + recap both dropped
    // still sorted earliest-first
    const times = p.map((x: any) => x.fireAtMin);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
  test('determinism: identical input twice yields deep-equal plans', () => {
    const entries = bigFixture();
    const args = {
      entries, nowMin: 9 * 60, lastAlertKeys: [],
      prefs: { briefing: true, briefingAt: 10 * 60, recap: true, recapAt: 11 * 60, hourly: true },
    };
    expect(plan(args)).toEqual(plan(args));
  });
});

describe('native shape', () => {
  test('every item has exactly the 8 native fields with valid ranges', () => {
    const entries = [
      entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 700, 'overdue')]),
      entry('a2', 'Sam', 'overdue', [openItem('lunch', 'Lunch', 650, 'overdue')]),
      entry('a3', 'Jess', 'on_standard', []),
    ];
    const p = plan({
      entries, nowMin: 9 * 60, lastAlertKeys: [],
      prefs: { briefing: true, briefingAt: 10 * 60, recap: true, recapAt: 11 * 60, hourly: true },
    });
    expect(p.length).toBeGreaterThan(0);
    for (const item of p) {
      expect(Object.keys(item).sort()).toEqual(NATIVE_KEYS);
      expect(typeof item.id).toBe('string');
      expect(Number.isInteger(item.fireAtMin)).toBe(true);
      expect(item.fireAtMin).toBeGreaterThanOrEqual(0);
      expect(item.fireAtMin).toBeLessThan(1440);
      expect(item.dayOffset).toBe(0);
      expect(typeof item.immediate).toBe('boolean');
      expect(typeof item.stage).toBe('string');
      expect(typeof item.route).toBe('string');
      expect(typeof item.title).toBe('string');
      expect(typeof item.body).toBe('string');
    }
  });
});

test('n===1 group title uses the FIRST name, consistent with the body style', () => {
  const entries = [
    { row: { athleteId: 'a1', name: 'Devin Cole' }, status: { key: 'overdue', openItems: [{ id: 'lunch', title: 'Lunch', dueMin: 840, state: 'overdue' }] } },
  ];
  const plan = planCoachNotifications({ nowMin: 900, dateISO: '2026-07-18', entries, interventions: [], prefs: { ...DEFAULT_COACH_NOTIF_PREFS, briefing: false, recap: false }, lastAlertKeys: [] });
  const alert = plan.find(p => p.stage === 'due');
  expect(alert).toBeTruthy();
  expect(alert!.title).toBe('Devin missed Lunch');
});
