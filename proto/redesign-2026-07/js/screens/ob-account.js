/* Shared account-creation step for every onboarding flow (athlete/coach/trainer/client).
   Email + password + confirm + strength meter + implicit ToS line. Passwords are never
   persisted; the email is captured to RT.ob so a Terms detour doesn't lose it. */
import { RT, act, routeForRole } from '../state.js';
import { passwordStrength } from '../ob-helpers.js';

export function accountBody(opts = {}) {
  const terms = opts.terms || 'ob';
  return `
    <div id="ap-wrap"></div>
    <input id="su-email" class="ob-input" type="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Email" aria-label="Email" />
    <div style="height:12px"></div>
    <div class="pw-row"><input id="su-pass" class="ob-input" type="password" placeholder="Create a password (8+ characters)" aria-label="Create a password" /><span class="pw-eye" id="su-eye" role="button" tabindex="0" aria-pressed="false" aria-label="Show password">Show</span></div>
    <div class="pw-meter" id="su-meter"><i></i><i></i><i></i></div>
    <div id="su-meter-label" style="font-size:12px;font-weight:700;color:var(--text-3);min-height:16px;margin:0 2px 8px"></div>
    <input id="su-pass2" class="ob-input" type="password" placeholder="Retype password" aria-label="Retype password" />
    <div id="su-err" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;margin-top:12px;text-align:center"></div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);text-align:center;line-height:1.5;margin-top:4px">By creating an account you agree to the <span class="lnk" data-go="terms/${terms}">Terms of Service</span> and <span class="lnk" data-go="privacy/${terms}">Privacy Policy</span>.</div>`;
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
    mlabel.textContent = p1.value ? s.label : '';
    const match = !!p1.value && p1.value === p2.value;
    err.textContent = p2.value && !match ? 'Passwords don’t match yet.' : '';
    btn.disabled = !(email.value.trim() && s.ok && match);
  };
  [p1, p2, email].forEach((el) => el.addEventListener('input', gate));
  gate();
  const submit = async () => {
    if (btn.disabled) return;
    err.textContent = '';
    const ob = RT.ob || {};
    const name = (ob.name || '').trim();
    if (!name) { err.textContent = 'Add your name in step 1 before creating your account.'; return; }
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
  p2.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) submit(); });

  // Sign in with Apple — renders only when the native seam reports availability (go-live).
  (async () => {
    const native = window.OnStandardNative && window.OnStandardNative.apple;
    if (!native) return;
    let ok = false;
    try { ok = await native.available(); } catch { /* treat as unavailable */ }
    if (!ok) return;
    const wrap = $('#ap-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<button class="btn ghost" id="su-apple" style="margin-bottom:14px"> Continue with Apple</button>`;
    wrap.querySelector('#su-apple').addEventListener('click', async () => {
      err.textContent = '';
      let proceed = false;
      try {
        const token = await native.signIn();
        if (!token) return; // user cancelled
        const { data, error } = await window.sb.auth.signInWithIdToken({ provider: 'apple', token });
        if (error || !data || !data.user) { err.textContent = 'Apple sign-in failed. Use email instead.'; return; }
        act._syncSession(data.user);
        // This Apple identity may already belong to an existing account (any role) — never let
        // onboarding silently demote/rename it. Only a fresh (no primary_role) account proceeds
        // through this onboarding's role + name.
        const { data: prof } = await window.sb.from('profiles').select('primary_role').eq('id', data.user.id).maybeSingle();
        if (prof && prof.primary_role) {
          act.setAuthRole(prof.primary_role);
          window.__go(routeForRole(prof.primary_role));
          return;
        }
        act.setAuthRole(role);
        try {
          await window.sb.from('profiles').update({
            primary_role: role, ...(RT.ob && RT.ob.name ? { full_name: RT.ob.name } : {}),
          }).eq('id', data.user.id);
        } catch { /* best-effort */ }
        proceed = true;
      } catch { err.textContent = 'Apple sign-in failed. Use email instead.'; }
      if (proceed) await onSession(true);
    });
  })();
}
