/**
 * days.tasks WRITER: pushDay must serialize the day's per-requirement done-ness (from the
 * registered task provider) into the upserted row, so the coach side finally sees non-meal
 * completion (recovery, etc.). Before this, `tasks` was never written and defaulted to '[]'.
 * When no provider is registered, the row must OMIT tasks entirely (never clobber the column
 * with a stale empty array). Same node+jsdom bootstrap as the other proto day tests.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { DAY, dayResetLocal, pushDay, setDayTaskProvider } = require('../../proto/redesign-2026-07/js/day.js');

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

const UID = 'tasks-user';

beforeEach(() => {
  dom.window.localStorage.clear();
  dayResetLocal();
  DAY.date = '2026-07-16';
  setDayTaskProvider(null);
  delete (dom.window as any).sb;
});

test('pushDay serializes the provider’s [{id,done}] into the row', async () => {
  setDayTaskProvider(() => [
    { id: 'breakfast', done: true },
    { id: 'lunch', done: false },
    { id: 'recovery', done: true },
  ]);
  const { sb, upserts } = makeSb();
  (dom.window as any).sb = sb;
  await pushDay(UID, true);
  expect(upserts).toHaveLength(1);
  expect(upserts[0].tasks).toEqual([
    { id: 'breakfast', done: true },
    { id: 'lunch', done: false },
    { id: 'recovery', done: true },
  ]);
});

test('no provider registered → the row OMITS tasks (never clobbers the column with [])', async () => {
  const { sb, upserts } = makeSb();
  (dom.window as any).sb = sb;
  await pushDay(UID, true);
  expect(upserts).toHaveLength(1);
  expect('tasks' in upserts[0]).toBe(false);
});

test('malformed provider entries are dropped; ids coerced to strings, done to booleans', async () => {
  setDayTaskProvider(() => [
    { id: 'recovery', done: 1 },      // truthy -> true
    { id: 'weight' },                 // missing done -> false
    null,                             // dropped
    { done: true },                   // no id -> dropped
    { id: 42, done: false },          // numeric id -> '42'
  ]);
  const { sb, upserts } = makeSb();
  (dom.window as any).sb = sb;
  await pushDay(UID, true);
  expect(upserts[0].tasks).toEqual([
    { id: 'recovery', done: true },
    { id: 'weight', done: false },
    { id: '42', done: false },
  ]);
});

test('a throwing provider never breaks the push — tasks is just omitted', async () => {
  setDayTaskProvider(() => { throw new Error('exec not ready'); });
  const { sb, upserts } = makeSb();
  (dom.window as any).sb = sb;
  await pushDay(UID, true);
  expect(upserts).toHaveLength(1);
  expect('tasks' in upserts[0]).toBe(false);
});
