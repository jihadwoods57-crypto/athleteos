/* Account (2026-09-15): change password and change email, in the app, for every role.
 *
 * Structural pins against the source, the shape this repo uses for wiring that no unit test can
 * see: the route exists and is reachable from both profiles, the password change PROVES the
 * current password before it sets the new one, and the rule for a new password is sign-up's own. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, p), 'utf8');

test('the account route is registered and reachable from the athlete Profile and the operator account section', () => {
  const index = src('screens/index.js');
  assert.match(index, /^  account: lazy\(accountMod, 'account'\),$/m, 'one route line, as qc-capture enumerates them');
  assert.match(src('screens/profile.js'), /data-go="account"/);
  assert.match(src('screens/roles.js'), /data-go="account"/);
  // The old operator row emailed a reset link from the row itself; that handler is retired.
  assert.doesNotMatch(src('screens/roles.js'), /id="acct-pass" role="button"/);
});

test('the screen carries every role (roleNav), no tab bar, and both forms', () => {
  const s = src('screens/account.js');
  assert.match(s, /get nav\(\) \{ return roleNav\(\); \}/);
  assert.match(s, /hideTabs: true/);
  for (const id of ['ac-cur', 'ac-new', 'ac-new2', 'ac-pass-save', 'ac-pass-link', 'ac-email', 'ac-email-save']) {
    assert.match(s, new RegExp(`id="${id}"`), `${id} is rendered`);
  }
  // The password rule is sign-up's: 12 characters, nothing common, nothing built from the email.
  assert.match(s, /passwordStrength\(next\)/);
  assert.match(s, /weakPasswordReason\(next, RT\.email\)/);
  assert.match(s, /placeholder="At least 12 characters"/);
  // No inline styles: the file is new and the ratchet's ceiling for it is zero.
  assert.doesNotMatch(s, /style="/);
});

test('changePassword proves the current password before it sets the new one; changeEmail never rewrites the session email', () => {
  const st = src('state.js');
  const a = st.indexOf('async changePassword(');
  const b = st.indexOf('async requestPasswordReset(');
  assert.ok(a > 0 && b > a, 'both actions exist, in order');
  const body = st.slice(a, b);
  const proof = body.indexOf('signInWithPassword({ email, password: current })');
  const set = body.indexOf("updateUser({ password: next })");
  assert.ok(proof > 0 && set > proof, 'signInWithPassword runs before updateUser');
  assert.match(body, /updateUser\(\{ email: addr \}\)/);
  assert.doesNotMatch(body, /RT\.email = /, 'the email flips only once the server confirms both addresses');
});
