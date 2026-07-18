import { logoMark } from '../components.js';
import { icon } from '../icons.js';
import { act } from '../state.js';

/* Request a password-reset email (returning users who forgot their password). The link in the
   email lands on the configured recovery target where the new password is set. Confirmation is
   neutral — it never reveals whether the address has an account (anti-enumeration). Reshaped
   under the shared `.si` namespace (see flows.css) so it matches the sign-in screen. */
export default {
  hideTabs: true,
  render() {
    return `
    <div class="si">
      <div class="si-logo">${logoMark(60, 'welcome')}</div>
      <div class="si-mark"><span class="on">On</span>Standard</div>
      <h1 class="si-title">Reset your password</h1>
      <div class="si-sub">Enter your email and we'll send a reset link.</div>

      <div class="si-form">
        <div class="si-field">
          <label class="si-label" for="rs-email">Email</label>
          <div class="si-wrap">
            <span class="si-lead">${icon('mail', 20)}</span>
            <input id="rs-email" class="ob-input si-input" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="name@email.com" aria-label="Email">
          </div>
        </div>
      </div>

      <div id="rs-msg" class="si-err" aria-live="polite"></div>

      <button id="rs-go" class="btn primary si-cta">Send reset link</button>
      <div class="si-create"><button class="si-link" data-go="signin">Back to sign in</button></div>
    </div>`;
  },
  mount(root) {
    const emailEl = root.querySelector('#rs-email');
    const msg = root.querySelector('#rs-msg');
    const btn = root.querySelector('#rs-go');
    const submit = async () => {
      if (btn.disabled) return; // Enter on the email field must not silently re-fire mid-send
      msg.style.color = '#f87171';
      const email = (emailEl.value || '').trim().toLowerCase();
      if (!email) { msg.textContent = 'Enter your email.'; return; }
      btn.disabled = true;
      btn.textContent = 'Sending…';
      await act.requestPasswordReset(email);
      // Neutral confirmation regardless of whether the account exists.
      msg.style.color = 'var(--text-2)';
      msg.textContent = 'If an account exists for that email, a reset link is on its way. Open it on this device.';
      // Typo'd address / spam filter is common — leave a real resend path instead of a
      // permanently disabled button.
      btn.disabled = false;
      btn.textContent = 'Send again';
    };
    btn.addEventListener('click', submit);
    emailEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};
