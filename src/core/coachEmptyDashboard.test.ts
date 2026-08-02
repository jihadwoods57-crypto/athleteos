/**
 * TRUTHFUL COACH FIRST DASHBOARD: a brand-new coach's empty state must invite athletes (code +
 * QR + share) and a setup checklist, and NEVER a fabricated athlete, priority card, or team
 * score. Requires jsdom globals before requiring the screen (coach-home pulls the state.js
 * graph) — same pattern as protoSessionWipe.test.ts.
 *
 * 2026-08-01: the muted "Team score —" tile and the separate "No activity yet" section were
 * removed. Three consecutive empty sections, each with its own heading, read as a broken
 * dashboard rather than an empty one; they collapse into one forward-looking line. The honesty
 * invariant did not change and is asserted harder here: the empty dashboard now shows NO team
 * score at all, which is strictly more honest than a tile that renders an em-dash under the
 * words "Team score". Assertions target the invariant, not the old copy.
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
    expect(html).toContain('Invite code');
    expect(html).toContain('SCAN TO JOIN'); // the QR block
    expect(html).toContain('id="coach-copy-code"');
    expect(html).toContain('id="coach-share-invite"');
    for (const ch of 'ABC123') expect(html).toContain(`>${ch}</div>`); // each code char in its own box
  });
  test('shows a first-run setup checklist that links to real screens', () => {
    expect(html).toContain('Finish setting up your team');
    // Routes tracked to the coach-experience restructure (Plan hub + Profile sections).
    expect(html).toContain('data-go="coach-plan-set/team"');
    expect(html).toContain('data-go="coach-notif-settings"');
    expect(html).toContain('data-go="coach-profile/staff"');
  });
  test('shows NO team score at all — no tile, no numeral, nothing to misread as live', () => {
    expect(html).not.toContain('co-pulse');       // the score/standing tile must not render
    expect(html).not.toContain('class="num"');    // and therefore no score numeral
    expect(html).not.toContain('Group score');
  });
  test('honest empty roster, and NO fabricated athletes or priority cards', () => {
    expect(html).toContain('No athletes yet');
    // One forward-looking line replaces the old roster/activity/score empty sections. It must be
    // framed as what WILL happen, never as something that already has.
    expect(html).toContain('What fills in next');
    expect(html).not.toContain('Demo Varsity');
    expect(html).not.toContain('co-pri');   // no priority/needs-attention cards
    expect(html).not.toContain('needs attention');
  });
});

describe('coach empty dashboard — before the code has minted', () => {
  const html: string = emptyTeamDashboard(null, 'Varsity Football');
  test('shows an honest "checking" note instead of a dead code', () => {
    expect(html).toContain('Checking your team and code.'); // honest pending state, not a fake code
    expect(html).not.toContain('SCAN TO JOIN'); // no QR for a code that does not exist yet
  });
  test('still shows the checklist, and still no fabricated score', () => {
    expect(html).toContain('Finish setting up your team');
    expect(html).not.toContain('co-pulse');
  });
});

/**
 * The blocker this screen exists to survive: create_team failed during signup, so the coach is
 * signed in with NO team row. This state used to claim a code was being minted and tell the coach
 * to reopen the app — but nothing retried, and no act.* method could create a team outside
 * onboarding, so the account could never get a join code and no athlete could ever join.
 * It must now offer a real way out. Mutating RT here is safe: every `html` above is computed at
 * describe-evaluation time, which runs before any test body.
 */
describe('coach empty dashboard — team creation failed, no team row', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { RT } = require('../../proto/redesign-2026-07/js/state.js');

  test('offers a real Create team action instead of a fake "minting" promise', () => {
    RT.teamLoading = false; RT.teamOffline = false; RT.team = null;
    const html: string = emptyTeamDashboard(null, 'Varsity Football');

    expect(html).toContain('Create your team');
    expect(html).toContain('id="coach-team-create"');   // the button that calls act.createTeamNow
    expect(html).toContain('id="coach-team-name"');     // and something to name it

    // The old dead end must never come back in any form.
    expect(html).not.toContain('Creating your athlete code');
    expect(html).not.toContain("it'll retry");
    // Nor may it promise a code that does not exist.
    expect(html).not.toContain('SCAN TO JOIN');
  });
});
