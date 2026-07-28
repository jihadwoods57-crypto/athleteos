/**
 * Multi-domain completion surface (tracked, not scored): a coach's standing NON-MEAL item
 * (lift/custom) must appear in the athlete's exec list and complete one-tap via completeCheck →
 * DAY.checkedTasks, WITHOUT being injected when there is no coach set (parity). Same node+jsdom
 * bootstrap as firstDayActivationLive.test.ts — globals exist before the proto graph evaluates.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { S, RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const { DAY } = require('../../proto/redesign-2026-07/js/day.js');

const t = new Date();
const todayISO = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
  DAY.date = todayISO;
  RT.activationDate = null;
});

test('a coach standing LIFT item appears in the athlete exec list', () => {
  RT.stdItems = [{ id: 'squat-5x5', title: 'Squat 5x5', kind: 'lift' }];
  const item = S.exec.items.find((i: any) => i.id === 'squat-5x5');
  expect(item).toBeTruthy();
  expect(item.title).toBe('Squat 5x5');
});

test('completeCheck marks a standing lift done; it reads done in exec and lands in checkedTasks', () => {
  RT.stdItems = [{ id: 'squat-5x5', title: 'Squat 5x5', kind: 'lift' }];
  act.completeCheck('squat-5x5');
  expect(DAY.checkedTasks['squat-5x5']).toBe(true);
  const item = S.exec.items.find((i: any) => i.id === 'squat-5x5');
  expect(['done', 'done_late']).toContain(item.state);
});

test('completeCheck toggles OFF on a second tap (undo)', () => {
  RT.stdItems = [{ id: 'mobility', title: 'Mobility', kind: 'custom' }];
  act.completeCheck('mobility');
  act.completeCheck('mobility');
  expect('mobility' in DAY.checkedTasks).toBe(false);
});

test('PARITY: with no coach set, no coach items are injected into the exec list', () => {
  RT.stdItems = null;
  expect(S.exec.items.some((i: any) => i.id === 'squat-5x5')).toBe(false);
});

test('a coach recovery/checkin item is NOT duplicated by the fold (component items excluded)', () => {
  // recovery is a scored component already sourced from the built-in catalog — the fold must skip it.
  RT.stdItems = [{ id: 'recovery', title: 'Recovery', kind: 'recovery' }];
  const recos = S.exec.items.filter((i: any) => i.id === 'recovery');
  expect(recos.length).toBeLessThanOrEqual(1);
});
