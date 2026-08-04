/**
 * Morning weight keeps its tenths (0179): the stepper moves by 0.1 and the screen now takes a
 * typed decimal, so dayLogWeight must store what was entered to one decimal — the old
 * Math.round(lb) silently discarded every tenth. Same node+jsdom bootstrap as the other
 * proto tests.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { DAY, dayLogWeight, dayResetLocal } = require('../../proto/redesign-2026-07/js/day.js');

beforeEach(() => {
  dom.window.localStorage.clear();
  dayResetLocal();
});

test('a typed decimal is stored to one decimal, not rounded to a whole pound', () => {
  dayLogWeight('u1', 183.46);
  expect(DAY.currentWeight).toBe(183.5);
  dayLogWeight('u1', 183.4);
  expect(DAY.currentWeight).toBe(183.4);
});

test('whole numbers stay whole — the pre-0179 write shape is unchanged', () => {
  dayLogWeight('u1', 183);
  expect(DAY.currentWeight).toBe(183);
});

test('a falsy value never overwrites the day', () => {
  dayLogWeight('u1', 183.4);
  dayLogWeight('u1', 0);
  expect(DAY.currentWeight).toBe(183.4);
  dayLogWeight('u1', NaN);
  expect(DAY.currentWeight).toBe(183.4);
});
