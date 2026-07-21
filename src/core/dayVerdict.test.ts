// @ts-ignore — proto is plain ESM JS (allowJs), same import pattern as exec.test.ts
import { dayDecided } from '../../proto/redesign-2026-07/js/dayverdict.js';

const req = (state: string) => ({ required: true, state });
const opt = (state: string) => ({ required: false, state });

describe('dayDecided — the day is over for on-time purposes', () => {
  test('an open required window (ready) → not decided', () => {
    expect(dayDecided([req('overdue'), req('ready')])).toBe(false);
  });
  test('a locked (not-yet-open) required window → not decided (still ahead)', () => {
    expect(dayDecided([req('done'), req('locked')])).toBe(false);
  });
  test('a due_soon required window → not decided', () => {
    expect(dayDecided([req('due_soon')])).toBe(false);
  });
  test('all required done or past-window → decided', () => {
    expect(dayDecided([req('done'), req('done_late'), req('overdue')])).toBe(true);
  });
  test('all required done → decided (a finished win)', () => {
    expect(dayDecided([req('done'), req('done')])).toBe(true);
  });
  test('open windows are optional only → decided (optional never holds the day open)', () => {
    expect(dayDecided([req('done'), opt('ready'), opt('due_soon')])).toBe(true);
  });
  test('excused pre-activation windows do not hold the day open', () => {
    expect(dayDecided([req('not_required'), req('overdue')])).toBe(true);
  });
  test('empty / no required items → vacuously decided', () => {
    expect(dayDecided([])).toBe(true);
    expect(dayDecided([opt('ready')])).toBe(true);
  });
});
