/**
 * TRUTHFUL COACH FIRST DASHBOARD: a brand-new coach's empty state must invite athletes (code +
 * QR + share) and a setup checklist, show the team score as "Not scored yet", and NEVER a
 * fabricated athlete, priority card, or team score. Requires jsdom globals before requiring the
 * screen (coach-home pulls the state.js graph) — same pattern as protoSessionWipe.test.ts.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { emptyTeamDashboard } = require('../../proto/redesign-2026-07/js/screens/coach-home.js');

describe('coach empty dashboard — with a live athlete code', () => {
  const html: string = emptyTeamDashboard('ABC123', 'Varsity Football');

  test('invites athletes: code boxes, scannable QR, Copy + Share', () => {
    expect(html).toContain('Athlete invitation code');
    expect(html).toContain('SCAN TO JOIN'); // the QR block
    expect(html).toContain('id="coach-copy-code"');
    expect(html).toContain('id="coach-share-invite"');
    for (const ch of 'ABC123') expect(html).toContain(`>${ch}</div>`); // each code char in its own box
  });
  test('shows a first-run setup checklist that links to real screens', () => {
    expect(html).toContain('Finish setting up your team');
    expect(html).toContain('data-go="coach-plan"');
    expect(html).toContain('data-go="coach-notif-settings"');
    expect(html).toContain('data-go="coach-profile"');
  });
  test('team score reads "Not scored yet", never a fabricated number', () => {
    expect(html).toContain('Not scored yet');
    expect(html).toContain('Team score');
  });
  test('honest empty roster + activity, and NO fabricated athletes or priority cards', () => {
    expect(html).toContain('No athletes yet');
    expect(html).toContain('No activity yet');
    expect(html).not.toContain('Demo Varsity');
    expect(html).not.toContain('co-pri');   // no priority/needs-attention cards
    expect(html).not.toContain('needs attention');
  });
});

describe('coach empty dashboard — before the code has minted', () => {
  const html: string = emptyTeamDashboard(null, 'Varsity Football');
  test('shows an honest "minting" note instead of a dead code', () => {
    expect(html).toContain('minting');
    expect(html).not.toContain('SCAN TO JOIN'); // no QR for a code that does not exist yet
  });
  test('still shows the checklist and the not-scored team tile', () => {
    expect(html).toContain('Finish setting up your team');
    expect(html).toContain('Not scored yet');
  });
});
