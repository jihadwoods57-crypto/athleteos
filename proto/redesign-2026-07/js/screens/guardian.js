import { S, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';

/* Guardian consent — the athlete side of 0008/0050. A provable minor's real data stays
   ON THIS DEVICE until a parent/guardian verifies; this screen explains that honestly and
   lets the athlete send (or re-send) the approval request. Adults and verified minors get
   an honest "nothing needed" state instead of a form. */
export default {
  tab: 'home',
  render() {
    const c = S.consent;
    if (!c.minor) {
      return `
      ${backHead('Parent Approval', 'Not needed for your account', 'home')}
      <div class="state-demo">
        <div class="sd-ic">${icon('shield', 24)}</div>
        <div class="sd-t">You're all set</div>
        <div class="sd-s">Parent approval applies to athletes under 18. Your account syncs normally.</div>
        <div class="sd-cta"><button class="btn ghost sm" data-go="home">Back Home</button></div>
      </div>
      <div style="height:10px"></div>`;
    }
    if (c.status === 'verified') {
      return `
      ${backHead('Parent Approval', 'Approved', 'home')}
      <div class="state-demo" style="border-style:solid;border-color:var(--green-border)">
        <div class="sd-ic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 24)}</div>
        <div class="sd-t">Approved</div>
        <div class="sd-s">${c.guardianEmail ? `${esc(c.guardianEmail)} approved your account.` : 'Your parent or guardian approved your account.'} Your day syncs and your coach can see it.</div>
        <div class="sd-cta"><button class="btn ghost sm" data-go="home">Back Home</button></div>
      </div>
      <div style="height:10px"></div>`;
    }
    if (c.status === 'pending') {
      return `
      ${backHead('Parent Approval', 'Waiting on your parent', 'home')}
      <div class="state-demo">
        <div class="sd-ic" style="background:rgba(245,165,36,0.16);color:var(--amber-bright)">${icon('clock', 24)}</div>
        <div class="sd-t">Request sent</div>
        <div class="sd-s">We asked ${c.guardianEmail ? esc(c.guardianEmail) : 'your parent'} to approve. Until they do, everything you log stays on this phone — nothing is lost, and it all syncs the moment they say yes.</div>
      </div>
      <div style="height:14px"></div>
      <div class="eyebrow">Haven't heard back? Send a reminder — or fix the email.</div>
      <input id="gd-email" class="ob-input" type="email" inputmode="email" autocapitalize="none" value="${esc(c.guardianEmail || '')}" placeholder="Parent or guardian email" />
      <div id="gd-err" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;margin-top:10px;text-align:center"></div>
      <button class="btn ghost" id="gd-send">Send reminder</button>
      <div style="height:10px"></div>`;
    }
    return `
    ${backHead('Parent Approval', 'One step before your day can sync', 'home')}

    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Why this exists</div>
      <div class="ts">You're under 18, so the law says a parent or guardian approves before your data leaves this phone. Everything you log still counts here — it just stays private until they say yes.</div></div>
    </div>

    <div style="height:16px"></div>
    <div class="eyebrow">Send the approval request</div>
    <input id="gd-email" class="ob-input" type="email" inputmode="email" autocapitalize="none" placeholder="Parent or guardian email" />
    <div id="gd-err" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;margin-top:10px;text-align:center"></div>
    <button class="btn" id="gd-send">Ask for approval</button>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div><div class="tt">What they see</div>
      <div class="ts">One email with one approve button. They never get your meals or photos — approving just lets your score reach your coach.</div></div>
    </div>
    <div style="height:10px"></div>`;
  },
  mount(root) {
    const btn = root.querySelector('#gd-send');
    const input = root.querySelector('#gd-email');
    const err = root.querySelector('#gd-err');
    if (!btn || !input) return;
    const submit = async () => {
      if (btn.disabled) return;
      err.textContent = '';
      btn.disabled = true;
      const was = btn.textContent;
      btn.textContent = 'Sending…';
      const r = await act.requestGuardianConsent(input.value);
      if (r.ok) {
        // Pending → pending repaints an identical view, so a successful reminder read as a
        // no-op. Show inline confirmation instead; the default → pending flip still repaints.
        if ((S.consent && S.consent.status) === 'pending') {
          err.style.color = 'var(--green-bright)';
          err.textContent = `Reminder sent${input.value ? ' to ' + input.value : ''}.`;
          btn.disabled = false; btn.textContent = was;
        } else { window.__render(); }
        return;
      }
      err.textContent = r.error || 'Could not send. Try again.';
      btn.disabled = false;
      btn.textContent = was;
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};
