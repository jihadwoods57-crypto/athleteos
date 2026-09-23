/* Shared account-creation step for every onboarding flow (athlete/coach/trainer/client).
   Email + password + confirm + strength meter + implicit ToS line. Passwords are never
   persisted; the email is captured to RT.ob so a Terms detour doesn't lose it. */
import { RT, act, routeForRole } from '../state.js';
import { passwordStrength, weakPasswordReason } from '../ob-helpers.js';
import { socialAvailability, socialButtonHtml, socialSignIn, readIdentity, accountStepDecision, ssoNewNote, clearSsoNew } from '../social-auth.js';

export function accountBody(opts = {}) {
  const terms = opts.terms || 'ob';
  return `
    <div id="ap-wrap" class="sso-wrap"></div>
    <input id="su-email" class="ob-input" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Email" aria-label="Email" />
    <div style="height:12px"></div>
    <div class="pw-row"><input id="su-pass" class="ob-input" type="password" autocomplete="new-password" maxlength="64" placeholder="Create a password" aria-label="Create a password" /><span class="pw-eye" id="su-eye" role="button" tabindex="0" aria-pressed="false" aria-label="Show password">Show</span></div>
    <div class="pw-meter" id="su-meter"><i></i><i></i><i></i></div>
    <div id="su-meter-label" style="font-size:12px;font-weight:700;color:var(--text-3);min-height:16px;margin:0 2px 8px"></div>
    <input id="su-pass2" class="ob-input" type="password" autocomplete="new-password" maxlength="64" placeholder="Retype password" aria-label="Retype password" />
    <div id="su-err" style="color:var(--red-bright);font-size:13px;font-weight:600;min-height:18px;margin-top:12px;text-align:center"></div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);text-align:center;line-height:1.5;margin-top:4px">By creating an account you agree to the <span class="lnk" data-go="terms/${terms}">Terms of Service</span> and <a class="lnk" href="https://onstandard.app/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</div>`;
}

export function wireAccount(root, { role, onSession }) {
  const $ = (s) => root.querySelector(s);
  const btn = $('#su-go'), err = $('#su-err'), email = $('#su-email');
  const p1 = $('#su-pass'), p2 = $('#su-pass2'), eye = $('#su-eye');
  const meter = $('#su-meter'), mlabel = $('#su-meter-label');
  if (!btn) return;
  if (RT.ob && RT.ob.email) email.value = RT.ob.email;
  email.addEventListener('input', () => act.captureOb({ email: email.value.trim() }));
  const toggleEye = () => {
    const t = p1.type === 'password' ? 'text' : 'password';
    p1.type = t; p2.type = t;
    eye.textContent = t === 'password' ? 'Show' : 'Hide';
    eye.setAttribute('aria-pressed', String(t === 'text'));
    eye.setAttribute('aria-label', t === 'password' ? 'Show password' : 'Hide password');
  };
  eye.addEventListener('click', toggleEye);
  eye.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleEye(); } });
  const gate = () => {
    const s = passwordStrength(p1.value);
    meter.querySelectorAll('i').forEach((seg, i) => { seg.className = i < s.score ? `on${s.score === 3 ? ' s3' : ''}` : ''; });
    mlabel.textContent = p1.value ? s.label : 'At least 12 characters. A memorable phrase works well.';
    const match = !!p1.value && p1.value === p2.value;
    const weak = s.ok ? weakPasswordReason(p1.value, email.value) : null;
    err.textContent = weak || (p2.value && !match ? 'Passwords don’t match yet.' : '');
    btn.disabled = !(email.value.trim() && s.ok && match && !weak);
  };
  [p1, p2, email].forEach((el) => el.addEventListener('input', gate));
  gate();
  const submit = async () => {
    if (btn.disabled) return;
    err.textContent = '';
    const ob = RT.ob || {};
    const name = (ob.name || '').trim();
    if (!name) { err.textContent = 'Add your name on the name step first.'; return; }
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = 'Creating your account…';
    const r = await act.signUp(email.value.trim(), p1.value, name, role);
    if (r.ok) { await onSession(!!r.session); return; }
    err.textContent = r.error || 'Could not create your account.';
    btn.disabled = false;
    btn.textContent = was;
  };
  btn.addEventListener('click', submit);
  p2.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && !btn.disabled) submit(); });

  // Sign in with Apple / Google (G-P4, A-B5): Apple's own button, and Google only beside it
  // (Guideline 4.8). A fresh social identity (no primary_role) adopts THIS onboarding's role +
  // name; it has already answered the date-of-birth step, which comes before this one. An
  // existing identity is never silently demoted or renamed.
  const wireSocial = async () => {
    const avail = await socialAvailability();
    const wrap = $('#ap-wrap');
    if (!wrap || !avail.apple) return;
    wrap.innerHTML = socialButtonHtml('apple', 'ap') + (avail.google ? socialButtonHtml('google', 'ap') : '');
    wrap.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      if (b.disabled) return;
      const provider = b.id === 'ap-google' ? 'google' : 'apple';
      const label = provider === 'google' ? 'Google' : 'Apple';
      err.textContent = '';
      b.disabled = true;
      let proceed = false;
      try {
        const r = await socialSignIn(provider);
        if (r.cancelled) { b.disabled = false; return; }
        if (!r.user) { err.textContent = label + ' sign-in failed. Use email instead.'; b.disabled = false; return; }
        await act._syncSession(r.user);
        // I2: primary_role is never null, so "is this account new" is social-auth's decision
        // (terms never accepted, and created just now or already of this flow's role).
        const id = await readIdentity(r.user.id);
        if (!id.known) { err.textContent = label + ' sign-in failed. Use email instead.'; b.disabled = false; return; }
        if (accountStepDecision({ user: r.user, prof: id.prof, role, note: ssoNewNote() }) === 'route') {
          const own = (id.prof && id.prof.primary_role) || role;
          act.setAuthRole(own);
          window.__go(routeForRole(own));
          return;
        }
        act.setAuthRole(role);
        try {
          await window.sb.from('profiles').update({
            primary_role: role, ...(RT.ob && RT.ob.name ? { full_name: RT.ob.name } : {}),
          }).eq('id', r.user.id);
        } catch { /* best-effort */ }
        proceed = true;
      } catch { err.textContent = label + ' sign-in failed. Use email instead.'; b.disabled = false; }
      if (proceed) { await onSession(true); clearSsoNew(); }   // onboarding saved: the note is spent
    }));
  };
  void wireSocial();
}
