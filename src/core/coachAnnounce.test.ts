/**
 * Announcement compose screen — pure pieces (proto/redesign-2026-07/js/screens/coach-announce.js).
 *
 * coach-announce.js imports components.js -> state.js, whose `export const RT = load()` reads
 * localStorage at MODULE LOAD TIME — same gotcha documented in coachPlanKnobs.test.ts. Build a
 * real DOM with jsdom and install window/document/localStorage globals BEFORE lazily requiring
 * the screen module.
 *
 * Runs under the default node environment (jest-environment-jsdom v29 is incompatible with
 * this repo's jest 30 runtime).
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).MouseEvent = dom.window.MouseEvent;

// Lazy CJS require so the globals above exist before the proto module graph evaluates.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { audienceLabel } = require('../../proto/redesign-2026-07/js/screens/coach-announce.js');

test('audience labels are plain language', () => {
  expect(audienceLabel('team', null, [])).toBe('Entire team');
  expect(audienceLabel('position', 'LB', [])).toBe('LB room');
  expect(audienceLabel('group', 'g1', [{ id: 'g1', name: 'Travel squad' }])).toBe('Travel squad');
  expect(audienceLabel('group', 'gone', [])).toBe('Group');
});
