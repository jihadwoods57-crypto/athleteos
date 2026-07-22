// OnStandard — Command Center auth-flow pure helpers. No DOM, no Supabase — so the login state
// machine's decisions are unit-testable (node --test authflow.test.mjs). admin.js does the wiring.

// Which screen to show after a correct password, from Supabase MFA assurance state.
export function nextScreen({ currentLevel, nextLevel, hasFactor }) {
  if (currentLevel === 'aal2') return 'app';        // already MFA-verified
  if (nextLevel === 'aal2' && hasFactor) return 'challenge';
  return 'enroll';                                   // no verified factor yet
}

// Recovery codes shown once, one per line.
export const formatRecoveryCodes = (codes) => (codes || []).join('\n');

// Mirror the prod password rule (config.toml: min 8, letters + digits).
export function validateNewPassword(pw) {
  if (!pw || pw.length < 8) return { ok: false, error: 'At least 8 characters' };
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return { ok: false, error: 'Needs letters and numbers' };
  return { ok: true };
}

// Build the authorized POST to admin-mfa-recover.
export function recoverRequest(fnBase, token, code) {
  return {
    url: `${fnBase}/admin-mfa-recover`,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code: (code || '').trim() }),
    },
  };
}
