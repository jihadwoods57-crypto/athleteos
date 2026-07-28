/**
 * days.checked_tasks (0112): the per-day store for standing NON-MEAL check completions (coach
 * lift/custom). dayCheckTask sets/clears a { id: true } map that pushDay serializes into the row,
 * so the coach sees it (via days.tasks) while it stays OUT of the score. Tracked, not scored.
 * Same node+jsdom bootstrap as the other proto day tests.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { DAY, dayResetLocal, pushDay, dayCheckTask } = require('../../proto/redesign-2026-07/js/day.js');

function makeSb() {
  const upserts: any[] = [];
  const from = () => {
    const p: any = new Proxy(function () {}, {
      get(_t, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
        return (...args: unknown[]) => { if (prop === 'upsert') upserts.push(args[0]); return p; };
      },
      apply() { return p; },
    });
    return p;
  };
  return { sb: { from, rpc: async () => ({ data: null, error: null }) }, upserts };
}

const UID = 'checked-user';

beforeEach(() => {
  dom.window.localStorage.clear();
  dayResetLocal();
  DAY.date = '2026-07-16';
  delete (dom.window as any).sb;
});

test('dayCheckTask marks a standing check item done; the completion serializes into the pushed row', async () => {
  const { sb, upserts } = makeSb();
  (dom.window as any).sb = sb;
  dayCheckTask(UID, 'squat-5x5', true);         // sets the map + schedules a debounced push
  expect(DAY.checkedTasks['squat-5x5']).toBe(true);
  await pushDay(UID, true);                      // flush immediately (mirrors the debounce firing)
  expect(upserts[upserts.length - 1].checked_tasks).toEqual({ 'squat-5x5': true });
});

test('un-completing removes the id from the map', async () => {
  const { sb } = makeSb();
  (dom.window as any).sb = sb;
  await dayCheckTask(UID, 'squat-5x5', true);
  await dayCheckTask(UID, 'squat-5x5', false);
  expect('squat-5x5' in DAY.checkedTasks).toBe(false);
});

test('pushDay ALWAYS includes checked_tasks (defaults to {}), unlike the conditional tasks column', async () => {
  const { sb, upserts } = makeSb();
  (dom.window as any).sb = sb;
  await pushDay(UID, true);
  expect(upserts[0].checked_tasks).toEqual({});
});

test('dayResetLocal clears checked completions (a new day starts empty)', async () => {
  const { sb } = makeSb();
  (dom.window as any).sb = sb;
  await dayCheckTask(UID, 'mobility', true);
  dayResetLocal();
  expect(DAY.checkedTasks).toEqual({});
});

test('a blank id is a no-op (never fabricates a completion)', async () => {
  const { sb } = makeSb();
  (dom.window as any).sb = sb;
  await dayCheckTask(UID, '', true);
  expect(DAY.checkedTasks).toEqual({});
});
