/**
 * TASK 5 — coach devices schedule the COACH plan, not athlete meal reminders.
 *
 * Two layers, matching the brief's testing guidance:
 *   1. The extracted PURE helper buildCoachSyncPlan (proto/redesign-2026-07/js/coach-notify-plan.js)
 *      — the coach-branch plan-building, testable without the full state.js module graph:
 *        - coach plan carries ONLY deterministic cn-* ids (never an athlete meal reminder);
 *        - null entries (coach data still loading) → null, so the caller posts nothing / retries;
 *        - a tomorrow morning-briefing preview is present, tagged dayOffset:1;
 *        - lastAlertKeys is threaded into today's planner (immediate-critical NEW-key diff).
 *   2. state.js integration (JSDOM + lazy require, same pattern as protoSessionWipe.test.ts):
 *        - the ATHLETE sync path is UNTOUCHED — an athlete device still posts its athlete plan
 *          (no cn-* ids leak in), proving the additive coach branch never hijacks it;
 *        - a COACH whose roster data is not loaded yet posts NOTHING and leaves _lastPlan unset,
 *          so the next trigger (loadCoachRoster completion) retries.
 *
 * The broader athlete-flow regression gate is the full `jest src/core` suite (exec/notify/etc.),
 * which must pass unchanged — this file only pins the coach-specific seams.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
// Required AFTER the JSDOM globals exist so the proto module graph (state.js) evaluates cleanly.
const { buildCoachSyncPlan, alertKeys } = require('../../proto/redesign-2026-07/js/coach-notify-plan.js');
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const { DAY } = require('../../proto/redesign-2026-07/js/day.js');

const openItem = (id: string, title: string, dueMin: number, state: string) => ({ id, title, dueMin, state });
const entry = (athleteId: string, name: string, key: string, openItems: object[] = []) =>
  ({ row: { athleteId, name }, status: { key, openItems } });

type Item = { id: string; dayOffset: number; immediate: boolean };

describe('buildCoachSyncPlan (pure helper)', () => {
  test('null entries → null (coach data still loading → caller posts nothing, retries)', () => {
    expect(buildCoachSyncPlan({ entries: null, nowMin: 9 * 60, dateISO: '2026-07-17' })).toBeNull();
    // undefined is treated the same (entries == null), never a thrown/empty post.
    expect(buildCoachSyncPlan({ entries: undefined, nowMin: 9 * 60 })).toBeNull();
  });

  test('coach plan carries ONLY cn-* ids — no athlete meal reminder can leak into a coach post', () => {
    const entries = [
      entry('a1', 'Devin Ross', 'overdue', [openItem('lunch', 'Lunch', 12 * 60, 'overdue')]),
      entry('a2', 'Marcus Lane', 'overdue', [openItem('lunch', 'Lunch', 12 * 60, 'overdue')]),
    ];
    const plan: Item[] = buildCoachSyncPlan({ entries, nowMin: 15 * 60, dateISO: '2026-07-17', lastAlertKeys: [] });
    expect(plan.length).toBeGreaterThan(0);
    for (const p of plan) expect(p.id.startsWith('cn-')).toBe(true);
    // Explicitly: none of the athlete catalog ids (the bug this task fixes).
    const athleteIds = ['breakfast', 'lunch', 'dinner', 'snack', 'hydrate', 'weight', 'recovery', 'celebrate'];
    for (const p of plan) expect(athleteIds).not.toContain(p.id);
  });

  test('empty (all-clear) roster → an empty array, never null — the caller still posts [] to clear', () => {
    const plan = buildCoachSyncPlan({ entries: [], nowMin: 9 * 60, dateISO: '2026-07-17' });
    expect(Array.isArray(plan)).toBe(true);
  });

  test('tomorrow morning-briefing preview is present and tagged dayOffset:1', () => {
    const entries = [entry('a1', 'Devin Ross', 'overdue', [openItem('lunch', 'Lunch', 12 * 60, 'overdue')])];
    // nowMin 9:00 AM is AFTER the 7:30 briefing slot, so today has NO briefing — the only
    // cn-open-briefing in the plan is tomorrow's, which must carry dayOffset 1.
    const plan: Item[] = buildCoachSyncPlan({ entries, nowMin: 9 * 60, dateISO: '2026-07-17', lastAlertKeys: [] });
    const briefs = plan.filter((p) => p.id === 'cn-open-briefing');
    expect(briefs).toHaveLength(1);
    expect(briefs[0].dayOffset).toBe(1);
    // Everything else stays dayOffset 0 (today) — the preview is briefing-only.
    for (const p of plan) if (p.id !== 'cn-open-briefing') expect(p.dayOffset).toBe(0);
  });

  test('lastAlertKeys threads into today\'s planner — a KNOWN critical no longer fires immediately', () => {
    const entries = [
      entry('a1', 'Devin Ross', 'overdue', [openItem('lunch', 'Lunch', 12 * 60, 'overdue')]),
      entry('a2', 'Marcus Lane', 'overdue', [openItem('lunch', 'Lunch', 12 * 60, 'overdue')]),
    ];
    const nowMin = 15 * 60; // mid-afternoon, outside quiet hours
    // Sync 1: nothing known yet → a NEW n>=2 critical fires immediately.
    const first: Item[] = buildCoachSyncPlan({ entries, nowMin, dateISO: '2026-07-17', lastAlertKeys: [] });
    expect(first.some((p) => p.immediate)).toBe(true);
    // The caller persists alertKeys(entries) from the SAME snapshot (the binding contract):
    const keys = alertKeys(entries);
    expect(keys).toEqual(['overdue:lunch:2']);
    // Sync 2: same signature already known → no immediate item this time.
    const second: Item[] = buildCoachSyncPlan({ entries, nowMin, dateISO: '2026-07-17', lastAlertKeys: keys });
    expect(second.some((p) => p.immediate)).toBe(false);
  });

  test('prefs.enabled:false → an empty array (master switch off, but still a valid post)', () => {
    const entries = [entry('a1', 'Devin', 'overdue', [openItem('lunch', 'Lunch', 12 * 60, 'overdue')])];
    const plan = buildCoachSyncPlan({ entries, nowMin: 15 * 60, prefs: { enabled: false } });
    expect(plan).toEqual([]);
  });
});

describe('syncNotifications integration (state.js)', () => {
  let syncSpy: jest.Mock;
  beforeEach(() => {
    dom.window.localStorage.clear();
    act._wipeUserScopedState();
    syncSpy = jest.fn();
    (dom.window as any).OnStandardNative = { notify: { sync: syncSpy } };
    delete (dom.window as any).sb;
  });

  test('ATHLETE device: sync path is untouched — posts the athlete plan, never a cn-* coach id', () => {
    RT.userId = 'athlete-1';
    RT.authRole = 'athlete';
    act.syncNotifications();
    expect(syncSpy).toHaveBeenCalledTimes(1);
    const posted = syncSpy.mock.calls[0][0] as Array<{ id: string }>;
    for (const p of posted) expect(p.id.startsWith('cn-')).toBe(false);
  });

  test('COACH device with roster NOT loaded: posts nothing and leaves _lastPlan unset (retry-able)', () => {
    RT.userId = 'coach-1';
    RT.authRole = 'coach';
    // coach-data.js ROSTER/extras are unset in this JSDOM harness → entriesFor() returns null.
    act.syncNotifications();
    expect(syncSpy).not.toHaveBeenCalled();
    expect((RT as any)._lastPlan).toBeUndefined();
    expect((RT as any)._lastCoachAlertKeys).toEqual([]);
  });

  test('COACH device does NOT run the athlete plan branch (no athlete pre-schedule leaks out)', () => {
    RT.userId = 'coach-1';
    RT.authRole = 'coach';
    DAY.meals = { breakfast: false, lunch: false, snack: false, dinner: false };
    act.syncNotifications();
    // Entries null → nothing posted at all; crucially the athlete tomorrow pre-schedule never ran.
    expect(syncSpy).not.toHaveBeenCalled();
  });
});
