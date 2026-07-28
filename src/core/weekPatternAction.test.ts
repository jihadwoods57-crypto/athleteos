// act.setWeekPattern (0100): seeds an all-training week on first touch, writes one weekday, and
// ignores an out-of-range day. jsdom globals before the proto graph — protoSessionWipe pattern.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');

describe('act.setWeekPattern', () => {
  beforeEach(() => { RT.weekPattern = null; RT.team = null; });

  it('seeds a full training week then sets the chosen weekday', () => {
    act.setWeekPattern(0, 'rest'); // Sunday
    expect(RT.weekPattern).toEqual(['rest', 'training', 'training', 'training', 'training', 'training', 'training']);
  });
  it('preserves other days across edits', () => {
    act.setWeekPattern(0, 'rest');
    act.setWeekPattern(6, 'rest');
    expect(RT.weekPattern[0]).toBe('rest');
    expect(RT.weekPattern[6]).toBe('rest');
    expect(RT.weekPattern[3]).toBe('training');
  });
  it('an out-of-range day is a no-op', () => {
    act.setWeekPattern(7, 'rest');
    expect(RT.weekPattern).toBeNull();
  });
  it('an unknown type falls back to training', () => {
    act.setWeekPattern(2, 'nonsense');
    expect(RT.weekPattern[2]).toBe('training');
  });
});
