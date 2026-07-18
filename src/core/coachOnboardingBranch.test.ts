/**
 * COACH ONBOARDING BRANCH: step 3 is an explicit Create-vs-Join fork (never the old combined
 * screen with team fields AND a staff-code field competing), and a staff joiner reviews the
 * standard instead of setting it. Requires jsdom globals before requiring the screen graph.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const { coachOb } = require('../../proto/redesign-2026-07/js/screens/roles.js');

const setMode = (joinMode: string) => act.captureOb({ coach: { joinMode } });

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
});

describe('step 3 — create vs join fork', () => {
  test('create mode shows team-building fields and no staff-code field', () => {
    setMode('create');
    const html: string = coachOb.render({ sub: 3 });
    expect(html).toContain('id="co-team"');
    expect(html).toContain('Create a team');
    expect(html).not.toContain('id="co-staff-code"');
  });
  test('join mode shows only the staff-code field, no team-building fields', () => {
    setMode('join');
    const html: string = coachOb.render({ sub: 3 });
    expect(html).toContain('id="co-staff-code"');
    expect(html).not.toContain('id="co-team"');
    expect(html).not.toContain('id="co-sport"');
  });
});

describe('step 5 — joiner reviews, creator configures', () => {
  test('join mode reviews the coach-owned standard (no template picker)', () => {
    setMode('join');
    const html: string = coachOb.render({ sub: 5 });
    expect(html).toContain('Nothing to configure here');
    expect(html).not.toContain('id="co-tpl"');
  });
  test('create mode still offers the template picker', () => {
    setMode('create');
    const html: string = coachOb.render({ sub: 5 });
    expect(html).toContain('id="co-tpl"');
  });
});
