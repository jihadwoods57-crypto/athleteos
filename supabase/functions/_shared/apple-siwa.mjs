// OnStandard: Sign in with Apple, server side (review pass 2026-09-23, G-R4).
//
// Apple requires an app that offers Sign in with Apple to revoke the user's Apple tokens when
// they delete their account (https://appleid.apple.com/auth/revoke). Two steps, two functions:
//   apple-token     the app hands over the one-time authorizationCode from the sign-in sheet;
//                   this exchanges it for a refresh token (/auth/token) and stores it
//                   (apple_siwa_tokens, 0246, service role only).
//   delete-account  revokes that refresh token, then deletes the row; the app deletes the account
//                   as it always has (delete_account RPC) right after.
//
// Both authenticate to Apple with a CLIENT SECRET: a short-lived ES256 JWT signed with the Sign in
// with Apple key. Secrets (founder): APPLE_SIWA_KEY_ID, APPLE_SIWA_P8 (the .p8 file's contents),
// APPLE_TEAM_ID, and optionally APPLE_SIWA_CLIENT_ID (default com.onstandard.app, the bundle id).
// Missing secrets are LOGGED and never block anything: sign-in and deletion carry on.
//
// Plain ES module with WebCrypto only (no npm), so node:test can pin the signing, the form bodies
// and the claims exactly as Deno runs them.

export const APPLE_AUDIENCE = 'https://appleid.apple.com';
export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
export const DEFAULT_CLIENT_ID = 'com.onstandard.app';

/** The secrets this needs, read from an env getter, or null with the list of what is missing. */
export function siwaConfig(getEnv) {
  const get = (k) => { try { return (getEnv(k) || '').trim(); } catch { return ''; } };
  const cfg = {
    keyId: get('APPLE_SIWA_KEY_ID'),
    p8: get('APPLE_SIWA_P8'),
    teamId: get('APPLE_TEAM_ID'),
    clientId: get('APPLE_SIWA_CLIENT_ID') || DEFAULT_CLIENT_ID,
  };
  const missing = ['APPLE_SIWA_KEY_ID', 'APPLE_SIWA_P8', 'APPLE_TEAM_ID']
    .filter((k) => !cfg[{ APPLE_SIWA_KEY_ID: 'keyId', APPLE_SIWA_P8: 'p8', APPLE_TEAM_ID: 'teamId' }[k]]);
  return missing.length ? { ok: false, missing } : { ok: true, ...cfg };
}

/** base64url of bytes or a string. */
export function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The DER bytes of a PKCS#8 PEM (the .p8 file), tolerant of \n written as literal "\\n". */
export function pemToPkcs8(pem) {
  const body = String(pem || '').replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  if (!body) throw new Error('empty key');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The client-secret claims Apple expects. Lives 5 minutes (Apple allows up to 6 months). */
export function clientSecretClaims({ teamId, clientId, nowSec }) {
  const iat = Math.floor(nowSec);
  return { iss: teamId, iat, exp: iat + 300, aud: APPLE_AUDIENCE, sub: clientId };
}

/** Sign the client secret (ES256). WebCrypto's ECDSA output is already the raw r||s JOSE wants. */
export async function makeClientSecret({ keyId, p8, teamId, clientId, nowSec = Date.now() / 1000, subtle = globalThis.crypto.subtle }) {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(clientSecretClaims({ teamId, clientId, nowSec })))}`;
  const key = await subtle.importKey('pkcs8', pemToPkcs8(p8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

/** Form body for exchanging the sign-in code. */
export function tokenForm({ clientId, clientSecret, code }) {
  return new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' });
}

/** Form body for revoking a refresh token. */
export function revokeForm({ clientId, clientSecret, token }) {
  return new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token, token_type_hint: 'refresh_token' });
}

/** Exchange a code. Resolves { refreshToken } or { error }. Never throws. */
export async function exchangeCode(cfg, code, fetchImpl = fetch) {
  try {
    const clientSecret = await makeClientSecret(cfg);
    const r = await fetchImpl(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenForm({ clientId: cfg.clientId, clientSecret, code }).toString(),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body || !body.refresh_token) return { error: (body && body.error) || `http_${r.status}` };
    return { refreshToken: String(body.refresh_token) };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/** Revoke a refresh token. Resolves { revoked: true } or { error }. Never throws. Apple answers
 *  200 with an empty body on success. */
export async function revokeToken(cfg, token, fetchImpl = fetch) {
  try {
    const clientSecret = await makeClientSecret(cfg);
    const r = await fetchImpl(APPLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: revokeForm({ clientId: cfg.clientId, clientSecret, token }).toString(),
    });
    if (!r.ok) return { error: `http_${r.status}` };
    return { revoked: true };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}
