/**
 * PERSONAL STANDARD WIRING: an independent athlete's chosen meal count must actually govern their
 * scored day — but ONLY for NEW solo athletes (RT.activationDate stamped by this build), so
 * existing solo users are never silently re-scored. A coach standard always wins. jsdom globals
 * before requiring the state graph (protoSessionWipe pattern).
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const { dayStandard } = require('../../proto/redesign-2026-07/js/day.js');

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
  RT.userId = 'solo-1';
});

test('a NEW solo athlete: their 2-meal personal standard governs the scored day', () => {
  RT.activationDate = '2026-07-18T18:34:00.000Z';
  RT.reqSets = null;
  RT.profile = { standard: { mealsPerDay: 2 } };
  act._applyStandardFromSets();
  expect(RT.stdMeals.mealsRequired).toBe(2);
  expect(dayStandard().mealsRequired).toBe(2);
});

test('an EXISTING solo athlete (no activation stamp): the classic 4-meal day stands', () => {
  RT.activationDate = null;
  RT.reqSets = null;
  RT.profile = { standard: { mealsPerDay: 2 } };
  act._applyStandardFromSets();
  expect(RT.stdMeals).toBeNull();
  expect(dayStandard()).toBeNull();
});

test('a coach standard always wins over a personal standard, regardless of activation', () => {
  RT.activationDate = null; // even an existing coach athlete
  RT.profile = { standard: { mealsPerDay: 2 }, position: null };
  RT.reqSets = [{ scope_kind: 'team', scope_value: null, items: [
    { id: 'm1', title: 'Breakfast', kind: 'meal' },
    { id: 'm2', title: 'Lunch', kind: 'meal' },
    { id: 'm3', title: 'Dinner', kind: 'meal' },
  ] }];
  act._applyStandardFromSets();
  expect(RT.stdMeals.mealsRequired).toBe(3); // the coach's 3-meal team standard, not the personal 2
});
