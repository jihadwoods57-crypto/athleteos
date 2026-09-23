import { logoMark } from '../components.js';
import { icon } from '../icons.js';
import { RT, act, routeForRole } from '../state.js';
import { socialAvailability, socialButtonHtml, socialSignIn, readIdentity, isNewIdentity, isFreshUser, noteSsoNew } from '../social-auth.js';

/* Real email/password sign-in (returning users). Premium reshape scoped under `.si`
   (see flows.css "Sign-in (v2)") so the shared .welcome / .ob-* rules that reset.js
   relies on are untouched. Auth behavior preserved end-to-end: #si-email / #si-pass /
   #si-err / #si-go and the submit() wiring, plus real client field mechanics
   (lowercase+trim, on-blur validation, eye toggle, Caps-Lock, offline preflight,
   autofill metadata). "Continue with Apple" is the real gated flow (mirrors ob-account),
   shown only when the native shell offers it. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  hideTabs: true,
  render() {
    // The same back chip every onboarding step wears (2026-09-22): sign-in had no way back to
    // Welcome except "Create an account", which went somewhere else entirely.
    return `
    <div class="ob-nav si-nav"><button type="button" class="ob-back" data-go="welcome" aria-label="Back">${icon('chevron', 18)}</button></div>
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
            <input id="si-email" class="ob-input si-input" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="name@email.com" aria-label="Email" aria-describedby="si-email-err" aria-invalid="false">
          </div>
          <div id="si-email-err" class="si-field-err" aria-live="polite"></div>
        </div>
        <div class="si-field">
          <div class="si-label-row"><label class="si-label" for="si-pass">Password</label><button type="button" class="si-forgot" data-go="reset">Forgot password?</button></div>
          <div class="si-wrap">
            <span class="si-lead">${icon('lock', 20)}</span>
            <input id="si-pass" class="ob-input si-input" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" aria-describedby="si-err" aria-invalid="false">
            <button type="button" class="si-eye" id="si-eye" aria-label="Show password"><span class="eye-show">${icon('eye', 20)}</span><span class="eye-hide">${icon('eyeOff', 20)}</span></button>
          </div>
          <div id="si-caps" class="si-field-hint" style="display:none">Caps Lock is on</div>
        </div>
      </div>

      <div id="si-err" class="si-err" aria-live="polite"></div>

      <button id="si-go" class="btn primary si-cta"><span class="si-go-label">Sign in</span><span class="si-arrow" aria-hidden="true">${icon('arrowRight', 18)}</span></button>

      <div class="si-social" id="si-social" style="display:none">
        <div class="si-or"><span></span>or<span></span></div>
        <div class="sso-wrap" id="si-sso"></div>
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

    // The field says it is invalid whenever its error line has text, so a screen reader hears
    // the message with the field and not only as a stray live-region announcement.
    const setEmailErr = (msg) => { emailErr.textContent = msg; emailEl.setAttribute('aria-invalid', msg ? 'true' : 'false'); };
    const setErr = (msg) => {
      err.textContent = msg;
      passEl.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg && !(emailEl.value || '').trim()) emailEl.setAttribute('aria-invalid', 'true');
    };
    // Validate email format when the user LEAVES the field — not on every keystroke.
    emailEl.addEventListener('blur', () => {
      const v = (emailEl.value || '').trim();
      setEmailErr((v && !EMAIL_RE.test(v)) ? 'Enter a valid email address.' : '');
    });
    emailEl.addEventListener('focus', () => { setEmailErr(''); });

    const setLoading = (on) => {
      btn.disabled = on;
      btn.classList.toggle('loading', on);
      label.textContent = on ? 'Signing in…' : 'Sign in';
    };

    const submit = async () => {
      if (btn.disabled) return; // double-submit guard
      setErr('');
      const email = (emailEl.value || '').trim().toLowerCase();
      const password = passEl.value || '';
      if (!email || !password) { setErr('Enter your email and password.'); return; }
      if (!EMAIL_RE.test(email)) { setEmailErr('Enter a valid email address.'); return; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setErr("You're offline. Check your connection and try again."); return;
      }
      setLoading(true);
      const r = await act.signIn(email, password);
      if (r.ok) { go(routeForRole(r.role)); }
      else { setErr(r.error || "That didn't go through. Try again in a moment."); setLoading(false); }
    };
    btn.addEventListener('click', submit);
    emailEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); });
    passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); });

    /* Social sign-in (review pass 2026-09-23: G-R5, A-B5, G-P4; I2). The block shows only when
       Sign in with Apple is available, and Google only beside it (Guideline 4.8).
       A NEW identity must not land on Home: Supabase creates the user on the first
       signInWithIdToken, and a 12-year-old (or a coach) tapping "Continue with Apple" here used to
       become an athlete account with no age. primary_role cannot tell (it defaults to 'athlete'),
       so the signal is social-auth.isNewIdentity: never onboarded (no terms accepted) and created
       just now. A new identity is signed straight back out and sent to pick a role, DOB first; the
       same Apple or Google account finishes on that flow's account step. If the profile cannot be
       read, a fresh account is treated as new and an old one is not let in on a guess. */
    const wireSocial = async () => {
      const avail = await socialAvailability();
      const wrap = root.querySelector('#si-sso');
      const social = root.querySelector('#si-social');
      if (!wrap || !social || !avail.apple) return;
      wrap.innerHTML = socialButtonHtml('apple', 'si') + (avail.google ? socialButtonHtml('google', 'si') : '');
      social.style.display = 'block';
      wrap.querySelectorAll('button').forEach((sbtn) => sbtn.addEventListener('click', async () => {
        if (sbtn.disabled) return;
        const provider = sbtn.id === 'si-google' ? 'google' : 'apple';
        const label = provider === 'google' ? 'Google' : 'Apple';
        err.textContent = '';
        sbtn.disabled = true;
        const r = await socialSignIn(provider);
        if (r.cancelled) { sbtn.disabled = false; return; }
        if (!r.user) { err.textContent = label + " sign-in didn't complete. Try email instead."; sbtn.disabled = false; return; }
        const id = await readIdentity(r.user.id);
        const isNew = id.known ? isNewIdentity(r.user, id.prof) : isFreshUser(r.user);
        if (isNew) {
          // New to OnStandard: sign-up comes first, and it starts with who they are and their age.
          try { await window.sb.auth.signOut(); } catch { /* the role screen works either way */ }
          noteSsoNew(r.user.id, provider);   // R2-I1: the account step adopts exactly this identity
          go('role');
          return;
        }
        if (!id.known) {
          try { await window.sb.auth.signOut(); } catch { /* retry signs in again */ }
          err.textContent = "Couldn't load your account just now. Try again in a moment.";
          sbtn.disabled = false;
          return;
        }
        await act._syncSession(r.user);
        const final = (id.prof && id.prof.primary_role) || 'athlete';
        act.setAuthRole(final);
        // The age guard decides before Home paints, not after (review I2).
        if (final === 'athlete') { try { await act.checkAgeKnown(); } catch { /* the router guard still runs */ } }
        go(routeForRole(final));
      }));
    };
    void wireSocial();
  },
};
