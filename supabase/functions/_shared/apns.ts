// OnStandard — a minimal APNs provider client, for the one thing Expo's push service cannot send:
// an ActivityKit (Live Activity) push. Every ordinary notification still goes through Expo.
//
// ZERO npm imports: Deno's WebCrypto signs the ES256 provider token natively.
//
// THE FOUR RULES APPLE ENFORCES, and where each is handled here:
//   1. ES256 only, and the JWT carries exactly {alg,kid} / {iss,iat}. No `exp`, no `aud`.
//   2. A token older than one hour is rejected (`ExpiredProviderToken`, 403), and reusing a NEW
//      token more than once every 20 minutes on the same connection is also an error. So the JWT is
//      CACHED and rotated on a fixed schedule, never minted per request. That is `tokenTtlMs`.
//   3. Production and sandbox are different hosts AND the key may be environment-scoped. A
//      TestFlight or App Store build is production; a debug build from Xcode is sandbox.
//   4. Payloads are capped at 4 KB.
// (https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)

import { liveActivityHeaders } from './rollcall-live.ts';

export const APNS_HOST_PRODUCTION = 'https://api.push.apple.com';
export const APNS_HOST_SANDBOX = 'https://api.sandbox.push.apple.com';

/** Apple rejects a provider token older than an hour and objects to minting one more often than
 *  every 20 minutes. 45 minutes sits clear of both edges. */
export const APNS_TOKEN_TTL_MS = 45 * 60 * 1000;

/** Apple's documented payload ceiling. Anything larger is refused outright, so we would rather
 *  find out here, with a named error, than read a 413 out of a response body. */
export const APNS_PAYLOAD_MAX_BYTES = 4096;

export type ApnsConfig = {
  /** Contents of the .p8 file from Certificates, Identifiers & Profiles -> Keys, with the
   *  "Apple Push Notifications service" box ticked. NOT an App Store Connect API key: those are
   *  also ES256 .p8 files, which is exactly why they get confused, and Apple states they "can't be
   *  used for other Apple services". */
  p8: string;
  /** The 10-character Key ID shown next to the key. */
  keyId: string;
  /** The 10-character Team ID. */
  teamId: string;
  /** The app's bundle identifier, e.g. com.onstandard.app. */
  bundleId: string;
  /** true for a debug build talking to the sandbox gateway. */
  sandbox?: boolean;
};

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strip the PEM armour and decode the base64 body to the DER bytes WebCrypto wants. */
export function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** WebCrypto signs ECDSA as the raw 64-byte r||s pair, which is exactly what JWS ES256 wants, so
 *  there is deliberately no DER re-encoding here. */
export async function signProviderToken(cfg: ApnsConfig, nowMs: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToPkcs8(cfg.p8) as unknown as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'ES256', kid: cfg.keyId })));
  const claims = b64url(enc.encode(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(nowMs / 1000) })));
  const signing = `${header}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signing),
  ));
  return `${signing}.${b64url(sig)}`;
}

/** A provider token and the moment it was minted. */
type CachedToken = { jwt: string; mintedAtMs: number };

/**
 * One APNs sender. Hold ONE of these per function invocation (or longer): it caches the provider
 * token, which is the whole point. Constructing a fresh one per push would mint a fresh JWT per
 * push, which Apple treats as an error.
 */
export class ApnsClient {
  private cached: CachedToken | null = null;

  constructor(
    private readonly cfg: ApnsConfig,
    private readonly tokenTtlMs: number = APNS_TOKEN_TTL_MS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get host(): string {
    return this.cfg.sandbox ? APNS_HOST_SANDBOX : APNS_HOST_PRODUCTION;
  }

  /** The cached provider token, minted or rotated as needed. Exposed for the tests. */
  async token(nowMs: number = Date.now()): Promise<string> {
    if (this.cached && nowMs - this.cached.mintedAtMs < this.tokenTtlMs) return this.cached.jwt;
    const jwt = await signProviderToken(this.cfg, nowMs);
    this.cached = { jwt, mintedAtMs: nowMs };
    return jwt;
  }

  /**
   * POST one Live Activity payload to one token. Returns a small result rather than throwing: a
   * roll call must never fail because one phone's activity could not be updated.
   *
   * `gone` means Apple told us this token is dead (410, or a BadDeviceToken/Unregistered reason).
   * The caller should forget it — replaying a dead token every minute is how you get rate limited.
   */
  async send(
    deviceToken: string, payload: Record<string, unknown>, nowMs: number = Date.now(),
  ): Promise<{ ok: boolean; status: number; reason?: string; gone: boolean }> {
    const body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).length > APNS_PAYLOAD_MAX_BYTES) {
      return { ok: false, status: 0, reason: 'PayloadTooLarge', gone: false };
    }
    try {
      const headers = liveActivityHeaders(this.cfg.bundleId, await this.token(nowMs));
      const res = await this.fetchImpl(`${this.host}/3/device/${deviceToken}`, {
        method: 'POST', headers, body,
      });
      if (res.ok) return { ok: true, status: res.status, gone: false };
      const text = await res.text().catch(() => '');
      let reason = text;
      try { reason = (JSON.parse(text) as { reason?: string }).reason ?? text; } catch { /* keep raw */ }
      const gone = res.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered';
      return { ok: false, status: res.status, reason, gone };
    } catch (e) {
      // A network failure is not a dead token: keep it and try on the next tick.
      return { ok: false, status: 0, reason: String((e as Error)?.message ?? e), gone: false };
    }
  }
}

/** Read the APNs config from the environment, or null when it is not configured. Absent config is
 *  a NORMAL state, not an error: it means the Apple-portal work has not been done yet, and every
 *  Live Activity call site is written to skip quietly and leave the notification path untouched. */
export function apnsFromEnv(env: (k: string) => string | undefined): ApnsConfig | null {
  const p8 = env('APNS_KEY_P8');
  const keyId = env('APNS_KEY_ID');
  const teamId = env('APNS_TEAM_ID');
  const bundleId = env('APNS_BUNDLE_ID') ?? 'com.onstandard.app';
  if (!p8 || !keyId || !teamId) return null;
  return { p8, keyId, teamId, bundleId, sandbox: env('APNS_SANDBOX') === '1' };
}
