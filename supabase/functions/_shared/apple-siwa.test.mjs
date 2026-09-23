/* Sign in with Apple revocation, the pure parts (G-R4): the ES256 client secret really verifies
 * with the key's public half, the claims and form bodies are what Apple documents, missing
 * secrets are reported (never thrown), and the network calls never throw.
 *
 * Run: node --test supabase/functions/_shared/apple-siwa.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import {
  siwaConfig, b64url, pemToPkcs8, clientSecretClaims, makeClientSecret, tokenForm, revokeForm,
  exchangeCode, revokeToken, APPLE_AUDIENCE, APPLE_REVOKE_URL, APPLE_TOKEN_URL, DEFAULT_CLIENT_ID,
} from './apple-siwa.mjs';

const subtle = webcrypto.subtle;
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function testKey() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: kp.publicKey };
}

test('config: missing secrets are listed, never thrown; the client id defaults to the bundle id', () => {
  const none = siwaConfig(() => '');
  assert.equal(none.ok, false);
  assert.deepEqual(none.missing, ['APPLE_SIWA_KEY_ID', 'APPLE_SIWA_P8', 'APPLE_TEAM_ID']);
  const env = { APPLE_SIWA_KEY_ID: 'KID123', APPLE_SIWA_P8: 'pem', APPLE_TEAM_ID: 'TEAM99' };
  const ok = siwaConfig((k) => env[k]);
  assert.equal(ok.ok, true);
  assert.equal(ok.clientId, DEFAULT_CLIENT_ID);
  assert.equal(DEFAULT_CLIENT_ID, 'com.onstandard.app');
});

test('claims are what Apple documents for a client secret', () => {
  const c = clientSecretClaims({ teamId: 'TEAM99', clientId: 'com.onstandard.app', nowSec: 1_800_000_000.7 });
  assert.deepEqual(c, { iss: 'TEAM99', iat: 1_800_000_000, exp: 1_800_000_300, aud: APPLE_AUDIENCE, sub: 'com.onstandard.app' });
});

test('the ES256 client secret verifies with the key, and the header names the key id', async () => {
  const { pem, publicKey } = await testKey();
  const jwt = await makeClientSecret({ keyId: 'KID123', p8: pem, teamId: 'TEAM99', clientId: 'com.onstandard.app', nowSec: 1_800_000_000, subtle });
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(fromB64url(h)), { alg: 'ES256', kid: 'KID123', typ: 'JWT' });
  assert.equal(JSON.parse(fromB64url(p)).iss, 'TEAM99');
  const sig = fromB64url(s);
  assert.equal(sig.length, 64, 'raw r||s, as JOSE wants');
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
  assert.equal(ok, true);
  // A .p8 pasted into a secret with literal \n still parses.
  assert.ok(pemToPkcs8(pem.replace(/\n/g, '\\n')).length > 100);
  assert.equal(b64url('hi?'), 'aGk_');
});

test('form bodies', () => {
  assert.equal(tokenForm({ clientId: 'c', clientSecret: 's', code: 'x' }).toString(), 'client_id=c&client_secret=s&code=x&grant_type=authorization_code');
  assert.equal(revokeForm({ clientId: 'c', clientSecret: 's', token: 't' }).toString(), 'client_id=c&client_secret=s&token=t&token_type_hint=refresh_token');
});

test('exchange and revoke talk to Apple and never throw', async () => {
  const { pem } = await testKey();
  const cfg = { keyId: 'K', p8: pem, teamId: 'T', clientId: 'com.onstandard.app', subtle };
  const seen = [];
  const okFetch = async (url, init) => { seen.push([url, init.body]); return { ok: true, status: 200, json: async () => ({ refresh_token: 'r.1' }) }; };
  assert.deepEqual(await exchangeCode(cfg, 'code1', okFetch), { refreshToken: 'r.1' });
  assert.deepEqual(await revokeToken(cfg, 'r.1', okFetch), { revoked: true });
  assert.equal(seen[0][0], APPLE_TOKEN_URL);
  assert.equal(seen[1][0], APPLE_REVOKE_URL);
  assert.match(seen[1][1], /token=r\.1&token_type_hint=refresh_token/);
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });
  assert.deepEqual(await exchangeCode(cfg, 'x', bad), { error: 'invalid_grant' });
  assert.deepEqual(await revokeToken(cfg, 'x', bad), { error: 'http_400' });
  const boom = async () => { throw new Error('offline'); };
  assert.deepEqual(await revokeToken(cfg, 'x', boom), { error: 'offline' });
  assert.ok((await exchangeCode({ ...cfg, p8: 'not a key' }, 'x', okFetch)).error);
});

test('delete-account never blocks a deletion; the app revokes first, then deletes as before', () => {
  const fn = readFileSync(join(process.cwd(), 'supabase', 'functions', 'delete-account', 'index.ts'), 'utf8');
  assert.doesNotMatch(fn, /status: 5\d\d|, 5\d\d, cors/, 'no failure status on the Apple path');
  assert.match(fn, /revokeToken\(cfg, token\)/);
  assert.match(fn, /from\('apple_siwa_tokens'\)\.delete\(\)/);
  const state = readFileSync(join(process.cwd(), 'proto', 'redesign-2026-07', 'js', 'state.js'), 'utf8');
  const del = state.slice(state.indexOf('async deleteAccount()'), state.indexOf('async deleteAccount()') + 1500);
  assert.ok(del.indexOf("'delete-account'") > 0 && del.indexOf("'delete-account'") < del.indexOf("rpc('delete_account'"),
    'revoke is asked before the account is deleted');
});
