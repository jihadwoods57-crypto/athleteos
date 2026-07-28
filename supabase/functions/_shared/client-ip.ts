// OnStandard — trustworthy client-IP resolution for rate limits / anti-enumeration / cost caps.
// ZERO framework imports: loadable by both Deno (edge) and jest (babel).
//
// WHY NOT THE LEFTMOST X-Forwarded-For VALUE:
// X-Forwarded-For is an append-only list. A trusted proxy APPENDS the address of the peer it
// actually saw to the RIGHT end; everything to its left was supplied by the client (or by
// upstream proxies we do not control). So the LEFTMOST entry is fully attacker-controlled —
// an attacker rotating `X-Forwarded-For: <random>` per request gets a fresh limit bucket every
// time, which silently disables any per-IP cap built on it.
//
// Correct order:
//   1. `x-real-ip` — set by the platform edge, overwritten (not appended) on every request, so a
//      client-supplied value cannot survive.
//   2. RIGHTMOST entry of `x-forwarded-for` — the hop our own trusted edge appended.
//   3. A stable literal fallback, so limits still bucket (shared bucket) rather than silently
//      turning off when no header is present.
export const UNKNOWN_CLIENT_IP = 'unknown';

export function clientIpFrom(req: Request): string {
  const real = (req.headers.get('x-real-ip') ?? '').trim();
  if (real) return real;

  const parts = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length > 0) return parts[parts.length - 1];

  return UNKNOWN_CLIENT_IP;
}
