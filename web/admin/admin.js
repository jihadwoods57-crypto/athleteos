// OnStandard — Command Center entry. Server-authoritative: admin_bootstrap decides who is an admin AND
// whether MFA (aal2) has been satisfied; the client only routes to the right screen. Access to the shell
// requires access_granted (platform_admin AND aal2 AND enrolled) — enforced again in Postgres on every
// RPC, so the client is never the boundary. Publishable key + login JWT only.
import { sb, bootstrap, FUNCTIONS_URL } from './api.js';
import { show, h, $, setIdentity, toast } from './ui.js';
import { mountShell, refreshActive } from './shell.js';
import { nextScreen, formatRecoveryCodes, recoverRequest } from './authflow.mjs';
import { startSessionWatch } from './session.mjs';
import home from './sections/home.js';
import users from './sections/users.js';
import orgs from './sections/orgs.js';
import revenue from './sections/revenue.js';
import ai from './sections/ai.js';
import errors from './sections/errors.js';
import audit from './sections/audit.js';
import security from './sections/security.js';
import support from './sections/support.js';
import config from './sections/config.js';
import scoring from './sections/scoring.js';
import payments from './sections/payments.js';

const SECTIONS = [home, users, scoring, orgs, revenue, payments, ai, errors, support, audit, security, config];

// ---- screen management: exactly one auth screen (or the app) visible ----
const SCREENS = ['login', 'challenge', 'enroll', 'recovery', 'recovery-entry', 'app'];
function screen(name) {
  for (const s of SCREENS) show($(s), s === name);
  showDenied(false);
}

let sessionStop = null;

// The single router: from the current session + bootstrap, decide what to show.
async function route() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return screen('login');

  let boot;
  try { boot = await bootstrap(); } catch { boot = { is_admin: false }; }
  if (!boot || !boot.is_admin) { for (const s of SCREENS) show($(s), false); showDenied(true); return; }

  if (boot.access_granted) return mountApp(boot);

  // Admin, but MFA not yet satisfied this session — enroll (no factor) or challenge.
  const { data: fl } = await sb.auth.mfa.listFactors();
  const factor = (fl?.totp ?? []).find((x) => x.status === 'verified');
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  const target = nextScreen({ currentLevel: aal?.currentLevel, nextLevel: aal?.nextLevel, hasFactor: !!factor });
  if (target === 'challenge') return showChallenge(factor.id);
  return showEnroll();
}

function mountApp(boot) {
  screen('app');
  setIdentity(boot.email);
  mountShell(SECTIONS, boot);
  if (sessionStop) sessionStop();
  sessionStop = startSessionWatch({
    onExpire: async (why) => { toast(why === 'idle' ? 'Signed out (idle).' : 'Session expired.', true); await sb.auth.signOut(); location.reload(); },
  });
}

// Signed in, but not a platform admin — a clean, honest state.
function showDenied(on) {
  let d = $('denied');
  if (!d) {
    d = h('div', { id: 'denied', class: 'login hidden' }, [h('div', { class: 'card' }, [
      h('div', { class: 'brand', style: 'margin-bottom:14px' }, [h('span', { class: 'mark' }), h('div', {}, ['OnStandard', h('small', { text: 'Command Center' })])]),
      h('h1', { text: 'Access denied' }),
      h('p', { text: 'This account is signed in but is not a platform admin. Ask an existing admin to add you to the platform_admins allowlist.' }),
      h('div', { style: 'height:14px' }),
      h('button', { class: 'btn', text: 'Sign out', onclick: async () => { await sb.auth.signOut(); location.reload(); } }),
    ])]);
    document.body.appendChild(d);
  }
  show(d, on);
}

// ---- MFA challenge (per login) ----
function showChallenge(factorId) {
  screen('challenge');
  $('chalerr').textContent = '';
  $('chal-code').value = '';
  $('chal-verify').onclick = async () => {
    $('chalerr').textContent = '';
    const code = $('chal-code').value.trim();
    const { data: ch, error: cErr } = await sb.auth.mfa.challenge({ factorId });
    if (cErr) { $('chalerr').textContent = cErr.message; return; }
    const { error } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    if (error) { $('chalerr').textContent = error.message; return; }  // surfaces MFA lockout message (Plan 2)
    route();
  };
  $('use-recovery').onclick = (e) => { e.preventDefault(); showRecoveryEntry(); };
  setTimeout(() => { try { $('chal-code').focus(); } catch (_) { /* noop */ } }, 60);
}

// ---- TOTP enroll (first run) ----
async function showEnroll() {
  screen('enroll');
  $('enrollerr').textContent = '';
  // clean any half-finished unverified factors so re-enroll never collides
  try {
    const { data: fl } = await sb.auth.mfa.listFactors();
    for (const f of (fl?.all ?? [])) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
  } catch (_e) { /* best effort */ }

  const { data: en, error } = await sb.auth.mfa.enroll({ factorType: 'totp' });
  if (error) { $('enrollerr').textContent = error.message; return; }
  $('enroll-qr').setAttribute('src', en.totp.qr_code);         // data: URI — allowed by CSP img-src data:
  $('enroll-secret').textContent = en.totp.secret;
  $('enroll-code').value = '';
  $('enroll-verify').onclick = async () => {
    $('enrollerr').textContent = '';
    const code = $('enroll-code').value.trim();
    const { data: ch, error: cErr } = await sb.auth.mfa.challenge({ factorId: en.id });
    if (cErr) { $('enrollerr').textContent = cErr.message; return; }
    const { error: vErr } = await sb.auth.mfa.verify({ factorId: en.id, challengeId: ch.id, code });
    if (vErr) { $('enrollerr').textContent = vErr.message; return; }
    // now aal2 — mint recovery codes and show them once
    try {
      const { data: codes, error: rErr } = await sb.rpc('admin_generate_recovery_codes');
      if (rErr) throw rErr;
      $('recovery-list').textContent = formatRecoveryCodes(codes);
    } catch (e) { $('recovery-list').textContent = '(could not generate recovery codes: ' + ((e && e.message) || e) + ')'; }
    screen('recovery');
    $('recovery-done').onclick = () => route();
  };
  setTimeout(() => { try { $('enroll-code').focus(); } catch (_) { /* noop */ } }, 60);
}

// ---- recovery-code entry (lost authenticator) ----
function showRecoveryEntry() {
  screen('recovery-entry');
  $('recerr').textContent = '';
  $('rec-code').value = '';
  $('rec-back').onclick = (e) => { e.preventDefault(); route(); };
  $('rec-submit').onclick = async () => {
    $('recerr').textContent = '';
    const { data } = await sb.auth.getSession();
    if (!data.session) { $('recerr').textContent = 'Session expired — sign in again.'; return; }
    const { url, init } = recoverRequest(FUNCTIONS_URL, data.session.access_token, $('rec-code').value);
    let res;
    try { res = await fetch(url, init); } catch (_e) { $('recerr').textContent = 'Network error.'; return; }
    if (!res.ok) { const b = await res.json().catch(() => ({})); $('recerr').textContent = b.error || 'Recovery failed'; return; }
    toast('Recovery accepted — set up your authenticator again.');
    showEnroll();   // factor removed server-side; enroll fresh
  };
  setTimeout(() => { try { $('rec-code').focus(); } catch (_) { /* noop */ } }, 60);
}

// ---- login wiring ----
$('signin').onclick = async () => {
  $('loginerr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
  if (error) { $('loginerr').textContent = error.message; return; }  // surfaces 'Too many attempts' etc.
  route();
};
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('signin').click(); });
$('forgot').onclick = async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  if (!email) { $('loginerr').textContent = 'Enter your email first.'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/reset.html' });
  $('loginerr').textContent = error ? error.message : 'Check your email for a reset link.';
};
$('signout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('refresh').onclick = () => refreshActive();
route();
