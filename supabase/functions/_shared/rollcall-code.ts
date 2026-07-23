// OnStandard — signed one-time roll-call code. Shared by commitment-reminders (mint) and
// roll-call-ack (verify). ZERO framework imports: loaded by both Deno (edge) and jest (babel).
// The code is the credential for a lock-screen "I'm Up": it proves one athlete + one instance,
// only inside the response window, and cannot be forged without ROLLCALL_ACK_SECRET.
const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export type RollCallClaims = { instanceId: string; athleteId: string; deadlineMs: number; iatMs: number };

export async function signRollCallCode(
  secret: string,
  c: { instanceId: string; athleteId: string; deadlineMs: number; iatMs: number },
): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify({ i: c.instanceId, a: c.athleteId, d: c.deadlineMs, t: c.iatMs })));
  const sig = b64urlEncode(await hmac(secret, payload));
  return `${payload}.${sig}`;
}

export async function verifyRollCallCode(
  secret: string, code: string, nowMs: number, graceMs: number,
): Promise<{ ok: true; claims: RollCallClaims } | { ok: false; reason: 'malformed' | 'bad_sig' | 'expired' }> {
  const dot = code.indexOf('.');
  if (dot <= 0 || dot === code.length - 1) return { ok: false, reason: 'malformed' };
  const payload = code.slice(0, dot);
  let given: Uint8Array;
  try { given = b64urlDecode(code.slice(dot + 1)); } catch { return { ok: false, reason: 'malformed' }; }
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_sig' };
  let obj: { i?: unknown; a?: unknown; d?: unknown; t?: unknown };
  try { obj = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))); } catch { return { ok: false, reason: 'malformed' }; }
  const claims: RollCallClaims = {
    instanceId: String(obj.i ?? ''), athleteId: String(obj.a ?? ''),
    deadlineMs: Number(obj.d), iatMs: Number(obj.t),
  };
  if (!claims.instanceId || !claims.athleteId || !Number.isFinite(claims.deadlineMs)) return { ok: false, reason: 'malformed' };
  if (nowMs > claims.deadlineMs + graceMs) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}
