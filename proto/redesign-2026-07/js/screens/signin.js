import { logoMark } from '../components.js';
import { icon } from '../icons.js';
import { RT, act, routeForRole } from '../state.js';

/* Real email/password sign-in (returning users). Premium reshape scoped under `.si`
   (see flows.css "Sign-in (v2)") so the shared .welcome / .ob-* rules that reset.js
   relies on are untouched. Auth behavior preserved end-to-end: #si-email / #si-pass /
   #si-err / #si-go and the submit() wiring, plus real client field mechanics
   (lowercase+trim, on-blur validation, eye toggle, Caps-Lock, offline preflight,
   autofill metadata). "Continue with Apple" is the real gated flow (mirrors ob-account),
   shown only when the native shell offers it. */
const APPLE_GLYPH = `<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.89 2.65 3.24 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.28-1.27 3.13-2.53.99-1.45 1.4-2.85 1.42-2.93-.03-.01-2.72-1.04-2.75-4.13zM14.6 4.5c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-3 1.54-.66.76-1.24 1.98-1.08 3.15 1.14.09 2.31-.58 3.02-1.44z"/></svg>`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  hideTabs: true,
  render() {
    return `
    <div class="si">
      <div class="si-logo">${logoMark(60, 'welcome')}</div>
      <div class="si-mark"><span class="on">On</span>Standard</div>
      <h1 class="si-title">Welcome back</h1>
      <div class="si-sub">Continue building your standard.</div>

      <div class="si-form">
        <div class="si-field">
          <label class="si-label" for="si-email">Email</label>
          <div class="si-wrap">
            <span class="si-lead">${icon('mail', 20)}</span>
            <input id="si-email" class="ob-input si-input" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="name@email.com" aria-label="Email">
          </div>
          <div id="si-email-err" class="si-field-err" aria-live="polite"></div>
        </div>
        <div class="si-field">
          <div class="si-label-row"><label class="si-label" for="si-pass">Password</label><button type="button" class="si-forgot" data-go="reset">Forgot password?</button></div>
          <div class="si-wrap">
            <span class="si-lead">${icon('lock', 20)}</span>
            <input id="si-pass" class="ob-input si-input" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password">
            <button type="button" class="si-eye" id="si-eye" aria-label="Show password"><span class="eye-show">${icon('eye', 20)}</span><span class="eye-hide">${icon('eyeOff', 20)}</span></button>
          </div>
          <div id="si-caps" class="si-field-hint" style="display:none">Caps Lock is on</div>
        </div>
      </div>

      <div id="si-err" class="si-err" aria-live="polite"></div>

      <button id="si-go" class="btn primary si-cta"><span class="si-go-label">Sign In</span><span class="si-arrow" aria-hidden="true">&#8594;</span></button>

      <div class="si-social" id="si-social" style="display:none">
        <div class="si-or"><span></span>or<span></span></div>
        <button class="btn ghost si-apple" id="si-apple"><span class="si-apple-ic">${APPLE_GLYPH}</span><span>Continue with Apple</span></button>
      </div>

      <div class="si-create">New to OnStandard? <button class="si-link" data-go="role">Create an account</button></div>
    </div>`;
  },
  mount(root) {
    const go = window.__go;
    const emailEl = root.querySelector('#si-email');
    const passEl = root.querySelector('#si-pass');
    const err = root.querySelector('#si-err');
    const emailErr = root.querySelector('#si-email-err');
    const caps = root.querySelector('#si-caps');
    const eye = root.querySelector('#si-eye');
    const btn = root.querySelector('#si-go');
    const label = root.querySelector('.si-go-label');

    // Prefill the email a just-signed-up user typed, so a confirm-then-sign-in round trip
    // only asks for the password.
    if (RT.email && !emailEl.value) { emailEl.value = RT.email; }
    if (emailEl.value) { passEl.focus(); }

    // Show / hide password — icon swap via a class, never dynamic innerHTML.
    eye.addEventListener('click', () => {
      const show = passEl.type === 'password';
      passEl.type = show ? 'text' : 'password';
      eye.classList.toggle('on', show);
      eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });

    // Caps-Lock hint while typing the password.
    const capsCheck = (e) => { try { caps.style.display = (e.getModifierState && e.getModifierState('CapsLock')) ? 'block' : 'none'; } catch { /* no-op */ } };
    passEl.addEventListener('keydown', capsCheck);
    passEl.addEventListener('keyup', capsCheck);
    passEl.addEventListener('blur', () => { caps.style.display = 'none'; });

    // Validate email format when the user LEAVES the field — not on every keystroke.
    emailEl.addEventListener('blur', () => {
      const v = (emailEl.value || '').trim();
      emailErr.textContent = (v && !EMAIL_RE.test(v)) ? 'Enter a valid email address.' : '';
    });
    emailEl.addEventListener('focus', () => { emailErr.textContent = ''; });

    const setLoading = (on) => {
      btn.disabled = on;
      btn.classList.toggle('loading', on);
      label.textContent = on ? 'Signing in…' : 'Sign In';
    };

    const submit = async () => {
      if (btn.disabled) return; // double-submit guard
      err.textContent = '';
      const email = (emailEl.value || '').trim().toLowerCase();
      const password = passEl.value || '';
      if (!email || !password) { err.textContent = 'Enter your email and password.'; return; }
      if (!EMAIL_RE.test(email)) { emailErr.textContent = 'Enter a valid email address.'; return; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        err.textContent = 'Network problem — check your connection.'; return;
      }
      setLoading(true);
      const r = await act.signIn(email, password);
      if (r.ok) { go(routeForRole(r.role)); }
      else { err.textContent = r.error || 'Sign in failed.'; setLoading(false); }
    };
    btn.addEventListener('click', submit);
    emailEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    // Continue with Apple — shown only when the native shell offers it; the real
    // signInWithIdToken flow (mirrors ob-account.js). Inert in the web proto.
    (async () => {
      try {
        const native = window.OnStandardNative;
        if (!native || !native.apple || !(await native.apple.available())) return;
        const social = root.querySelector('#si-social');
        const apple = root.querySelector('#si-apple');
        social.style.display = 'block';
        apple.addEventListener('click', async () => {
          if (apple.disabled) return;
          err.textContent = '';
          apple.disabled = true;
          try {
            const token = await native.apple.signIn();
            if (!token) { apple.disabled = false; return; }
            const sb = window.sb;
            const { data, error } = await sb.auth.signInWithIdToken({ provider: 'apple', token });
            if (error) throw error;
            let role = 'athlete';
            try {
              const { data: prof } = await sb.from('profiles').select('primary_role').eq('id', data.user.id).maybeSingle();
              if (prof && prof.primary_role) role = prof.primary_role;
            } catch { /* fall back to athlete */ }
            go(routeForRole(role));
          } catch { err.textContent = "Apple sign-in didn't complete. Try email instead."; apple.disabled = false; }
        });
      } catch { /* no native seam — email/password only */ }
    })();
  },
};
