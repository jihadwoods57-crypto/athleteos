// Pure request validation for admin-mfa-recover — testable outside Deno (node --test).
export function parseRecoverBody(body) {
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!code) return { ok: false, error: 'code required' };
  return { ok: true, code };
}
