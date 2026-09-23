/* Account — the basics every signed-in person needs, in the app, for every role (2026-09-15).
 *
 * WHY. "Change password" existed only for coaches and trainers, and even there it was an email
 * with a reset link that opened in the phone's browser. Athletes and parents had nothing: no
 * signed-in address, no way to change a password or an email without signing out and going
 * through "Forgot password?". The founder asked for the basic account features to exist and work.
 *
 * WHAT IT DOES, and only what the auth server can honestly do:
 *   - Change password IN the app: the current password is checked first (signInWithPassword on
 *     the signed-in address, which never signs anyone out), then updateUser({ password }).
 *   - Change email: updateUser({ email }). Prod has double_confirm_changes on, so the change
 *     completes only after BOTH addresses confirm, and the copy says so. The signed-in address
 *     shown here is what the session says, refreshed on every paint.
 *   - Forgot the current password: the existing reset-link path, from here, without signing out.
 *   - Delete account: the existing screen (settings.js deleteAccount), reached from Profile and
 *     Privacy (and the operator account section), not from here.
 * The password rule is sign-up's own (ob-helpers.js): 12 characters, nothing common, nothing
 * built from the email. One rule, one helper, both doors.
 */
import { RT, act, roleNav, roleProfileRoute } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { passwordStrength, weakPasswordReason } from '../ob-helpers.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const account = {
  get nav() { return roleNav(); },
  hideTabs: true,
  render() {
    const email = RT.email || '';
    return `
    ${backHead('Account', email || 'Signed in', roleProfileRoute())}

    <section class="card rows ac-tasks">
      <div class="lrow ac-static">
        <div class="lic">${icon('user', 17)}</div>
        <div class="lm"><div class="lt">Signed in as</div><div class="ls" id="ac-email-now">${esc(email || 'Email unavailable. Sign in again to refresh.')}</div></div>
        ${RT.emailVerified === true ? '<span class="status-pill g">Verified</span>' : ''}
      </div>

    ${/* Two rows, each opening its own form in place (2026-09-22). Both forms used to sit open,
          five inputs and two buttons on arrival for someone who came to check one thing. The iOS
          shape is a row per task; a <details> keeps it one screen with no new routes, and the
          form's own ids and handlers are unchanged. Delete account left this screen: Profile and
          Privacy both carry it (App Review wants it easy to find, not in three places). */''}
      <details class="ac-sec" id="ac-sec-pass">
        <summary class="lrow">
          <div class="lic">${icon('lock', 17)}</div>
          <div class="lm"><div class="lt">Change password</div><div class="ls">Checks your current one first</div></div>
          <span class="ac-chev" aria-hidden="true">${icon('chevron', 15)}</span>
        </summary>
        <div class="ac-form">
          <label class="ac-label" for="ac-cur">Current password</label>
          <div class="pw-row"><input id="ac-cur" class="ob-input" type="password" autocomplete="current-password" maxlength="64" placeholder="Current password" aria-label="Current password" /><span class="pw-eye" id="ac-eye" role="button" tabindex="0" aria-pressed="false" aria-label="Show passwords">Show</span></div>
          <label class="ac-label" for="ac-new">New password</label>
          <input id="ac-new" class="ob-input" type="password" autocomplete="new-password" maxlength="64" placeholder="At least 12 characters" aria-label="New password" />
          <input id="ac-new2" class="ob-input" type="password" autocomplete="new-password" maxlength="64" placeholder="Retype new password" aria-label="Retype new password" />
          <div id="ac-pass-note" class="est-note ac-note" role="status" aria-live="polite"></div>
          <button class="btn primary" id="ac-pass-save" type="button">Update password</button>
          <div class="est-note ac-foot">Forgot the current one? <span class="link" id="ac-pass-link" role="button" tabindex="0">Email me a reset link</span></div>
        </div>
      </details>
      <details class="ac-sec" id="ac-sec-email">
        <summary class="lrow">
          <div class="lic">${icon('mail', 17)}</div>
          <div class="lm"><div class="lt">Change email</div><div class="ls">Confirmed from both addresses</div></div>
          <span class="ac-chev" aria-hidden="true">${icon('chevron', 15)}</span>
        </summary>
        <div class="ac-form">
          <label class="ac-label" for="ac-email">New email</label>
          <input id="ac-email" class="ob-input" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="name@email.com" aria-label="New email" />
          <div id="ac-email-note" class="est-note ac-note" role="status" aria-live="polite"></div>
          <button class="btn primary" id="ac-email-save" type="button">Send confirmation</button>
          <div class="est-note ac-foot">We send a confirmation to your current address and the new one. The change completes when both are confirmed; until then you stay signed in as you are.</div>
        </div>
      </details>
    </section>
    <div class="ac-tail"></div>`;
  },

  mount(root) {
    const $ = (id) => root.querySelector(id);
    const cur = $('#ac-cur'), nw = $('#ac-new'), nw2 = $('#ac-new2');
    const passNote = $('#ac-pass-note'), passBtn = $('#ac-pass-save'), passLink = $('#ac-pass-link');
    const eye = $('#ac-eye');
    const emailIn = $('#ac-email'), emailNote = $('#ac-email-note'), emailBtn = $('#ac-email-save');
    const say = (el, text, tone) => {
      if (!el) return;
      el.textContent = text || '';
      el.classList.toggle('ok', tone === 'ok');
      el.classList.toggle('bad', tone === 'bad');
    };

    // One eye for the three password fields: they are one form.
    if (eye) eye.addEventListener('click', () => {
      const on = eye.getAttribute('aria-pressed') !== 'true';
      eye.setAttribute('aria-pressed', String(on));
      eye.textContent = on ? 'Hide' : 'Show';
      for (const el of [cur, nw, nw2]) if (el) el.type = on ? 'text' : 'password';
    });

    let busy = false;
    const changePassword = async () => {
      if (busy) return;
      const current = cur ? cur.value : '';
      const next = nw ? nw.value : '';
      const again = nw2 ? nw2.value : '';
      if (!current) { say(passNote, 'Enter your current password first.', 'bad'); if (cur) cur.focus(); return; }
      const strength = passwordStrength(next);
      if (!strength.ok) { say(passNote, 'Use at least 12 characters.', 'bad'); if (nw) nw.focus(); return; }
      const weak = weakPasswordReason(next, RT.email);
      if (weak) { say(passNote, weak, 'bad'); if (nw) nw.focus(); return; }
      if (next !== again) { say(passNote, "Those two don't match.", 'bad'); if (nw2) nw2.focus(); return; }
      if (next === current) { say(passNote, 'That is your current password. Pick a new one.', 'bad'); return; }
      busy = true; passBtn.disabled = true; passBtn.textContent = 'Updating…'; say(passNote, '');
      const r = await act.changePassword({ current, next });
      busy = false; passBtn.disabled = false; passBtn.textContent = 'Update password';
      if (!r.ok) { say(passNote, r.error || "Couldn't update your password. Try again.", 'bad'); return; }
      for (const el of [cur, nw, nw2]) if (el) el.value = '';
      say(passNote, 'Password updated. Use the new one next time you sign in.', 'ok');
    };
    if (passBtn) passBtn.addEventListener('click', changePassword);
    for (const el of [cur, nw, nw2]) if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) changePassword(); });
    // Live strength read on the new password, sign-up's own helper, so the bar is one bar.
    if (nw) nw.addEventListener('input', () => {
      const v = nw.value;
      if (!v) { say(passNote, ''); return; }
      say(passNote, `Strength: ${passwordStrength(v).label}`);
    });

    if (passLink) passLink.addEventListener('click', async () => {
      if (busy) return;
      busy = true; passLink.textContent = 'Sending…';
      const r = await act.requestPasswordReset(RT.email || '');
      busy = false;
      passLink.textContent = 'Email me a reset link';
      const sent = !!(r.ok && RT.email);
      say(passNote, sent ? `Reset link sent to ${RT.email}. Open it on this phone and set a new password there.` : "Couldn't find your email. Sign in again first.", sent ? 'ok' : 'bad');
    });

    const changeEmail = async () => {
      if (busy) return;
      const next = (emailIn ? emailIn.value : '').trim().toLowerCase();
      if (!next) { say(emailNote, 'Enter the new email.', 'bad'); return; }
      if (!EMAIL_RE.test(next)) { say(emailNote, 'Enter a valid email address.', 'bad'); return; }
      if (next === String(RT.email || '').toLowerCase()) { say(emailNote, 'That is already your email.', 'bad'); return; }
      busy = true; emailBtn.disabled = true; emailBtn.textContent = 'Sending…'; say(emailNote, '');
      const r = await act.changeEmail(next);
      busy = false; emailBtn.disabled = false; emailBtn.textContent = 'Send confirmation';
      if (!r.ok) { say(emailNote, r.error || "Couldn't start the change. Try again.", 'bad'); return; }
      say(emailNote, `Confirmation sent to ${RT.email || 'your current address'} and ${next}. Tap the link in both and the change completes.`, 'ok');
    };
    if (emailBtn) emailBtn.addEventListener('click', changeEmail);
    if (emailIn) emailIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) changeEmail(); });
  },
};
