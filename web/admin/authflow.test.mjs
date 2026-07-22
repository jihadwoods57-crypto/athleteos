// run: node --test web/admin/authflow.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { nextScreen, formatRecoveryCodes, validateNewPassword, recoverRequest } from './authflow.mjs';

test('nextScreen: no factor -> enroll', () =>
  assert.equal(nextScreen({ currentLevel: 'aal1', nextLevel: 'aal1', hasFactor: false }), 'enroll'));
test('nextScreen: factor + aal1 -> challenge', () =>
  assert.equal(nextScreen({ currentLevel: 'aal1', nextLevel: 'aal2', hasFactor: true }), 'challenge'));
test('nextScreen: aal2 -> app', () =>
  assert.equal(nextScreen({ currentLevel: 'aal2', nextLevel: 'aal2', hasFactor: true }), 'app'));

test('formatRecoveryCodes joins by newline', () =>
  assert.equal(formatRecoveryCodes(['aa', 'bb']), 'aa\nbb'));

test('validateNewPassword rejects short', () => assert.equal(validateNewPassword('abc12').ok, false));
test('validateNewPassword rejects letters-only', () => assert.equal(validateNewPassword('abcdefgh').ok, false));
test('validateNewPassword rejects digits-only', () => assert.equal(validateNewPassword('12345678').ok, false));
test('validateNewPassword accepts strong', () => assert.equal(validateNewPassword('abcd1234').ok, true));

test('recoverRequest builds authorized POST', () => {
  const r = recoverRequest('https://x.functions.supabase.co', 'tok', ' code1 ');
  assert.equal(r.url, 'https://x.functions.supabase.co/admin-mfa-recover');
  assert.equal(r.init.headers.Authorization, 'Bearer tok');
  assert.equal(JSON.parse(r.init.body).code, 'code1');
});
