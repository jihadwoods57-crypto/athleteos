import {
  ApnsClient, signProviderToken, pemToPkcs8, apnsFromEnv,
  APNS_HOST_PRODUCTION, APNS_HOST_SANDBOX, APNS_PAYLOAD_MAX_BYTES, type ApnsConfig,
} from './apns';
import { liveStartPayload, liveContentState } from './rollcall-live';

/** A real P-256 key, generated once per run, so the JWT below is signed and verified for real
 *  rather than shape-checked. Nothing about APNs is mocked except the network. */
async function makeKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, '$1\n');
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
    publicKey: pair.publicKey,
  };
}

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

let cfg: ApnsConfig;
let publicKey: CryptoKey;

beforeAll(async () => {
  const k = await makeKey();
  publicKey = k.publicKey;
  cfg = { p8: k.pem, keyId: 'ABC123DEFG', teamId: 'DEF123GHIJ', bundleId: 'com.onstandard.app' };
});

describe('the provider token is exactly what Apple specifies', () => {
  it('carries only {alg,kid} and {iss,iat}: no exp, no aud', async () => {
    const jwt = await signProviderToken(cfg, Date.parse('2026-09-02T10:00:00Z'));
    const [h, c] = jwt.split('.');
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(c)));
    expect(header).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(claims).toEqual({ iss: 'DEF123GHIJ', iat: 1788343200 });
    // Apple's spec has no expiry claim; adding one is a documented way to get rejected.
    expect(claims).not.toHaveProperty('exp');
    expect(claims).not.toHaveProperty('aud');
  });

  it('is a signature that actually verifies against the key', async () => {
    const jwt = await signProviderToken(cfg, Date.now());
    const [h, c, s] = jwt.split('.');
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, publicKey,
      b64urlToBytes(s) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${h}.${c}`) as unknown as ArrayBuffer,
    );
    expect(ok).toBe(true);
  });

  it('emits the raw 64-byte r||s pair JWS wants, not DER', async () => {
    const jwt = await signProviderToken(cfg, Date.now());
    expect(b64urlToBytes(jwt.split('.')[2]).length).toBe(64);
  });

  it('reads a PEM with or without trailing newlines', () => {
    const a = pemToPkcs8(cfg.p8);
    const b = pemToPkcs8(cfg.p8.trim());
    const c = pemToPkcs8(cfg.p8.replace(/\n/g, '\r\n'));
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).toEqual(Array.from(c));
  });
});

describe('the provider token is cached, because Apple rejects churn', () => {
  it('reuses one token inside the window and rotates after it', async () => {
    const client = new ApnsClient(cfg, 45 * 60 * 1000);
    const t0 = Date.parse('2026-09-02T06:00:00Z');
    const first = await client.token(t0);
    expect(await client.token(t0 + 19 * 60 * 1000)).toBe(first);
    expect(await client.token(t0 + 44 * 60 * 1000)).toBe(first);
    const rotated = await client.token(t0 + 46 * 60 * 1000);
    expect(rotated).not.toBe(first);
  });

  it('never lets a token reach the one-hour ceiling Apple enforces', async () => {
    const client = new ApnsClient(cfg);
    const t0 = Date.now();
    const first = await client.token(t0);
    // At 59 minutes the cached token must already have been replaced.
    expect(await client.token(t0 + 59 * 60 * 1000)).not.toBe(first);
  });
});

describe('sending', () => {
  const state = liveContentState(
    { respond_by_at: '2026-09-02T10:05:00Z', closes_at: '2026-09-02T10:30:00Z', message: 'Up and at it.' },
    'initial',
  );
  const attrs = { instanceId: 'i1', title: 'Wake-Up Roll Call', coachName: "Coach D'Onofrio", coachInitials: 'D' };
  const alert = { title: "Coach D'Onofrio", body: 'Up and at it.', sound: 'default' };
  const payload = liveStartPayload(attrs, state, alert, Date.now());

  it('posts to the production host with Apple\'s headers', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const r = await new ApnsClient(cfg, undefined, fake).send('DEADBEEF', payload);
    expect(r).toEqual({ ok: true, status: 200, gone: false });
    expect(calls[0].url).toBe(`${APNS_HOST_PRODUCTION}/3/device/DEADBEEF`);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['apns-push-type']).toBe('liveactivity');
    expect(h['apns-topic']).toBe('com.onstandard.app.push-type.liveactivity');
    expect(h['apns-priority']).toBe('10');
    expect(h.authorization).toMatch(/^bearer eyJ/);
  });

  it('uses the sandbox host only when told to', async () => {
    const fake = (async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    expect(new ApnsClient({ ...cfg, sandbox: true }, undefined, fake).host).toBe(APNS_HOST_SANDBOX);
    expect(new ApnsClient(cfg, undefined, fake).host).toBe(APNS_HOST_PRODUCTION);
  });

  it('reports a dead token as gone so the caller stops replaying it', async () => {
    const fake = (async () => new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 400 })
    ) as unknown as typeof fetch;
    const r = await new ApnsClient(cfg, undefined, fake).send('DEAD', payload);
    expect(r.gone).toBe(true);
    expect(r.reason).toBe('BadDeviceToken');
  });

  it('treats a network failure as retryable, never as a dead token', async () => {
    const fake = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const r = await new ApnsClient(cfg, undefined, fake).send('T', payload);
    expect(r.ok).toBe(false);
    expect(r.gone).toBe(false);
  });

  it('refuses an over-4KB payload here rather than reading it back off Apple', async () => {
    let called = false;
    const fake = (async () => { called = true; return new Response('', { status: 200 }); }) as unknown as typeof fetch;
    const fat = liveStartPayload(attrs, { ...state, line: 'x'.repeat(APNS_PAYLOAD_MAX_BYTES) }, alert, Date.now());
    const r = await new ApnsClient(cfg, undefined, fake).send('T', fat);
    expect(r.reason).toBe('PayloadTooLarge');
    expect(called).toBe(false);
  });
});

describe('apnsFromEnv', () => {
  const full = {
    APNS_KEY_P8: '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----',
    APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T',
  } as Record<string, string>;

  it('returns null when the Apple-portal work has not been done (a normal state, not an error)', () => {
    expect(apnsFromEnv(() => undefined)).toBeNull();
    expect(apnsFromEnv((k) => (k === 'APNS_KEY_P8' ? full.APNS_KEY_P8 : undefined))).toBeNull();
  });
  it('defaults the bundle id and the environment', () => {
    const c = apnsFromEnv((k) => full[k])!;
    expect(c.bundleId).toBe('com.onstandard.app');
    expect(c.sandbox).toBe(false);
  });
  it('honours an explicit sandbox flag', () => {
    const c = apnsFromEnv((k) => ({ ...full, APNS_SANDBOX: '1' }[k]))!;
    expect(c.sandbox).toBe(true);
  });
});
