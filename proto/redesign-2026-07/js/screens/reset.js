import { logoMark } from '../components.js';
import { act } from '../state.js';

/* Request a password-reset email (returning users who forgot their password). The link in the
   email lands on the configured recovery target where the new password is set. Confirmation is
   neutral — it never reveals whether the address has an account (anti-enumeration). */
export default {
  hideTabs: true,
  render() {
    return `
    <div class="welcome" style="justify-content:flex-start;padding-top:64px">
      <div class="logo-wrap">${logoMark(72, 'welcome')}</div>
      <div class="wordmark" style="margin-top:12px"><span class="on">On</span>Standard</div>
      <div class="ob-title" style="margin-top:30px;text-align:center">Reset your password</div>
      <div class="ob-sub" style="text-align:center">Enter your email and we'll send a reset link.</div>
      <div style="height:22px"></div>
      <input id="rs-email" class="ob-input" type="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Email" aria-label="Email" />
      <div id="rs-msg" style="font-size:13px;font-weight:600;min-height:18px;margin-top:12px;text-align:center;color:#f87171"></div>
      <div class="spacer"></div>
      <button id="rs-go" class="btn green">Send reset link</button>
      <div style="height:10px"></div>
      <button class="btn ghost" data-go="signin">Back to sign in</button>
      <div style="height:14px"></div>
    </div>`;
  },
  mount(root) {
    const emailEl = root.querySelector('#rs-email');
    const msg = root.querySelector('#rs-msg');
    const btn = root.querySelector('#rs-go');
    const submit = async () => {
      if (btn.disabled) return; // Enter on the email field must not silently re-fire mid-send
      msg.style.color = '#f87171';
      const email = (emailEl.value || '').trim();
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
