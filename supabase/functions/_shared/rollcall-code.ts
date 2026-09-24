// OnStandard — signed one-time roll-call code. Shared by commitment-reminders (mint),
// commitment-escalation (mint), roll-call-ack (verify) and roll-call-coach (verify).
// ZERO framework imports: loaded by both Deno (edge) and jest (babel).
//
// The code is the credential for a lock-screen action: it proves one SUBJECT + one instance, only
// inside the response window, and cannot be forged without ROLLCALL_ACK_SECRET.
//
// TWO KINDS, DELIBERATELY SEPARATED. An athlete code answers "I'm Up" for themselves; a coach code
// authorizes "Got it" / "Nudge them" over everyone on the instance. They are minted from the same
// secret, so without domain separation an athlete's own code — which that athlete legitimately
// holds — would be a valid coach credential for their whole team. The `k` claim is that separation
// and EVERY verify names the kind it expects; a mismatch is `bad_kind`, never a silent pass.
//
// `k` is absent on codes minted before 2026-08-26. Those are athlete codes by definition (no coach
// code has ever existed without it), so absent reads as 'athlete' and in-flight codes survive the
// deploy. A coach code is only ever the explicit 'c' — the permissive side of the compatibility
// window is the harmless one.
const enc = new TextEncoder();

export type CodeKind = 'athlete' | 'coach';

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

/** `subjectId` is the athlete on an athlete code and the coach on a coach code. `athleteId` is kept
 *  as an alias so the ack path — where the subject IS the athlete — keeps reading in its own terms. */
export type RollCallClaims = {
  instanceId: string; subjectId: string; athleteId: string;
  deadlineMs: number; iatMs: number; kind: CodeKind;
  /** True on a WINDOW code (claim `w: 1`): `iatMs` is the window's open and `deadlineMs` its close,
   *  not a mint instant and an expiry. See signWindowCode. */
  window: boolean;
};

/** 'not_yet' is a window code spent more than WINDOW_EARLY_MS before its roll call opens. */
export type VerifyFailure = 'malformed' | 'bad_sig' | 'expired' | 'bad_kind' | 'not_yet';

/** A window code is spendable from 15 minutes before the open (a phone clock that runs fast, an
 *  alarm the athlete set early) to 10 minutes after the close (a tap queued offline that reaches us
 *  late). The RPC judges the answer itself; these bounds only limit the credential. */
export const WINDOW_EARLY_MS = 15 * 60 * 1000;
export const WINDOW_LATE_MS = 10 * 60 * 1000;

async function sign(
  secret: string,
  c: { instanceId: string; subjectId: string; deadlineMs: number; iatMs: number },
  kind: CodeKind,
  window = false,
): Promise<string> {
  const body: Record<string, unknown> = { i: c.instanceId, a: c.subjectId, d: c.deadlineMs, t: c.iatMs };
  // Only the coach kind carries `k`. Athlete codes stay byte-identical to what shipped in 0144, so
  // this module can be deployed ahead of, or behind, its callers without invalidating a live code.
  if (kind === 'coach') body.k = 'c';
  // Only a window code carries `w`, inside the signed payload: stripping it breaks the signature,
  // so a window code can never be replayed as a one-shot code with a different reading of `t`.
  if (window) body.w = 1;
  const payload = b64urlEncode(enc.encode(JSON.stringify(body)));
  const sig = b64urlEncode(await hmac(secret, payload));
  return `${payload}.${sig}`;
}

/** Mint an ATHLETE code: authorizes "I'm Up" for that one athlete on that one instance. */
export async function signRollCallCode(
  secret: string,
  c: { instanceId: string; athleteId: string; deadlineMs: number; iatMs: number },
): Promise<string> {
  return sign(secret, { instanceId: c.instanceId, subjectId: c.athleteId, deadlineMs: c.deadlineMs, iatMs: c.iatMs }, 'athlete');
}

/** Mint a WINDOW code (2026-09-23): the credential the native Live Activity and alarm hold so a
 *  lock-screen tap can post the check-in itself with the app closed. It is minted up to 14 days
 *  ahead, so it cannot carry a "fresh" mint time; instead it is bound to one athlete, one instance
 *  and that instance's own window (open to close), and it is only valid inside it. Kind stays
 *  'athlete': it authorizes exactly what a one-shot athlete code does, for a longer but fixed span.
 *  `t` carries the open, so ack_commitment_by_token's "a phone cannot have tapped before the code
 *  existed" bound becomes "cannot have tapped before the window opened", which is also true. */
export async function signWindowCode(
  secret: string,
  c: { instanceId: string; athleteId: string; opensMs: number; closesMs: number },
): Promise<string> {
  return sign(secret, { instanceId: c.instanceId, subjectId: c.athleteId, deadlineMs: c.closesMs, iatMs: c.opensMs }, 'athlete', true);
}

/** Mint a COACH code: authorizes "Got it" / "Nudge them" for that one coach on that one instance.
 *  It is a strictly wider credential than an athlete code, which is why it is a separate kind. */
export async function signCoachCode(
  secret: string,
  c: { instanceId: string; coachId: string; deadlineMs: number; iatMs: number },
): Promise<string> {
  return sign(secret, { instanceId: c.instanceId, subjectId: c.coachId, deadlineMs: c.deadlineMs, iatMs: c.iatMs }, 'coach');
}

/** Verify a code AND assert its kind. `expectKind` defaults to 'athlete' so the pre-existing ack
 *  call site keeps its exact meaning; the coach endpoint must pass 'coach' explicitly.
 *  A window code ignores `graceMs`: its bounds are its own window (WINDOW_EARLY_MS / WINDOW_LATE_MS).
 *  `opts.allowEarly` lifts only the early bound, for the armed report (roll-call-ack 'armed'). */
export async function verifyRollCallCode(
  secret: string, code: string, nowMs: number, graceMs: number, expectKind: CodeKind = 'athlete',
  opts: { allowEarly?: boolean } = {},
): Promise<{ ok: true; claims: RollCallClaims } | { ok: false; reason: VerifyFailure }> {
  const dot = code.indexOf('.');
  if (dot <= 0 || dot === code.length - 1) return { ok: false, reason: 'malformed' };
  const payload = code.slice(0, dot);
  let given: Uint8Array;
  try { given = b64urlDecode(code.slice(dot + 1)); } catch { return { ok: false, reason: 'malformed' }; }
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_sig' };
  let obj: { i?: unknown; a?: unknown; d?: unknown; t?: unknown; k?: unknown; w?: unknown };
  try { obj = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))); } catch { return { ok: false, reason: 'malformed' }; }
  const subjectId = String(obj.a ?? '');
  const claims: RollCallClaims = {
    instanceId: String(obj.i ?? ''), subjectId, athleteId: subjectId,
    deadlineMs: Number(obj.d), iatMs: Number(obj.t),
    kind: obj.k === 'c' ? 'coach' : 'athlete',
    window: obj.w === 1,
  };
  if (!claims.instanceId || !claims.subjectId || !Number.isFinite(claims.deadlineMs)) return { ok: false, reason: 'malformed' };
  // Kind BEFORE expiry: a coach code presented to the athlete endpoint is the wrong credential
  // whether or not it is still fresh, and 'expired' would misdescribe it in the logs.
  if (claims.kind !== expectKind) return { ok: false, reason: 'bad_kind' };
  if (claims.window) {
    if (!Number.isFinite(claims.iatMs)) return { ok: false, reason: 'malformed' };
    // allowEarly: the push extension REPORTS an alarm it armed days before the window (roll call
    // v3). It can only ever mark this athlete's own morning armed; the check-in path never passes it.
    if (!opts.allowEarly && nowMs < claims.iatMs - WINDOW_EARLY_MS) return { ok: false, reason: 'not_yet' };
    if (nowMs > claims.deadlineMs + WINDOW_LATE_MS) return { ok: false, reason: 'expired' };
    return { ok: true, claims };
  }
  if (nowMs > claims.deadlineMs + graceMs) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}
