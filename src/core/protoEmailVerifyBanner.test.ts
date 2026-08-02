/**
 * VERIFY-YOUR-EMAIL BANNER (2026-08-02). Prod runs mailer_autoconfirm=true so GoTrue itself sends
 * nothing and stamps every signup confirmed on arrival (see signup-autoconfirm-fix memory) — this
 * banner IS the entire confirmation UI, built independent of GoTrue. Locks down the one invariant
 * that matters most: it must render ONLY when the server has said, in words, "this address is not
 * verified" (RT.emailVerified === false). The two other states — null (not loaded yet) and true
 * (verified) — must both render nothing, so an unloaded account is never shown a false accusation
 * and a verified one never sees a stale nag.
 *
 * Same jsdom-before-require pattern as coachEmptyDashboard.test.ts / protoSessionWipe.test.ts —
 * components.js pulls the state.js graph, so window/document must exist before it evaluates.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const { emailVerifyBanner, wireEmailVerifyBanner } = require('../../proto/redesign-2026-07/js/components.js');

beforeEach(() => {
  RT.emailVerified = null;
  RT.email = 'coach@example.com';
});

describe('emailVerifyBanner() — the tri-state render rule', () => {
  test('renders nothing when unloaded (null) — never a false accusation on a guess', () => {
    RT.emailVerified = null;
    expect(emailVerifyBanner()).toBe('');
  });
  test('renders nothing once verified (true)', () => {
    RT.emailVerified = true;
    expect(emailVerifyBanner()).toBe('');
  });
  test('renders the banner when the server has confirmed it is NOT verified (false)', () => {
    RT.emailVerified = false;
    const html = emailVerifyBanner();
    expect(html).toContain('id="ev-banner"');
    expect(html).toContain('id="ev-resend"');
    expect(html).toContain('id="ev-dismiss"');
    expect(html).toContain('coach@example.com');
  });
  test('escapes the email address — it is user-authored content in an innerHTML sink', () => {
    RT.emailVerified = false;
    RT.email = '<script>alert(1)</script>@example.com';
    const html = emailVerifyBanner();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('wireEmailVerifyBanner() — dismiss and resend', () => {
  // Order matters: EV_DISMISSED is module-level state in components.js (deliberately NOT in RT —
  // see emailVerifyBanner's own comment on why a persisted dismiss would be permanent). That
  // makes it a real cross-test hazard within this file: dismiss must run LAST, or every test
  // after it inherits a banner that renders '' no matter what RT.emailVerified says.

  test('resend calls act.requestEmailVerification and shows its message', async () => {
    RT.emailVerified = false;
    const root = document.createElement('div');
    root.innerHTML = emailVerifyBanner();
    document.body.appendChild(root);
    const original = act.requestEmailVerification;
    act.requestEmailVerification = async () => ({ ok: true, emailed: true });
    try {
      wireEmailVerifyBanner(root);
      root.querySelector('#ev-resend')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      // the click handler awaits the RPC before updating the message
      await new Promise((r) => setTimeout(r, 0));
      const msg = root.querySelector('#ev-banner-msg')!.textContent || '';
      expect(msg).toMatch(/sent/i);
    } finally {
      act.requestEmailVerification = original;
      root.remove();
    }
  });

  test('wireEmailVerifyBanner self-guards when the banner is not in the DOM', () => {
    const empty = document.createElement('div');
    // must not throw when the banner didn't render (every mount() calls this unconditionally,
    // same self-guarding discipline as coach-home.js's other wiring)
    expect(() => wireEmailVerifyBanner(empty)).not.toThrow();
  });

  test('dismiss hides the banner until the render call after it', () => {
    RT.emailVerified = false;
    const root = document.createElement('div');
    root.innerHTML = emailVerifyBanner();
    document.body.appendChild(root);

    let rendered = false;
    (window as any).__render = () => { rendered = true; };
    wireEmailVerifyBanner(root);
    root.querySelector('#ev-dismiss')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(rendered).toBe(true);
    // Post-dismiss, the SAME call now renders nothing — the actual observable effect a screen's
    // next repaint depends on.
    expect(emailVerifyBanner()).toBe('');
    root.remove();
  });
});
