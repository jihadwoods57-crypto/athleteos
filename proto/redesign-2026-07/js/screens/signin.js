import { logoMark } from '../components.js';
import { act, routeForRole } from '../state.js';

/* Real email/password sign-in (returning users). Replaces the simulated role-picker. */
export default {
  hideTabs: true,
  render() {
    return `
    <div class="welcome" style="justify-content:flex-start;padding-top:64px">
      <div class="logo-wrap">${logoMark(72, 'welcome')}</div>
      <div class="wordmark" style="margin-top:12px"><span class="on">On</span>Standard</div>
      <div class="ob-title" style="margin-top:30px;text-align:center">Welcome back</div>
      <div class="ob-sub" style="text-align:center">Sign in to pick up where you left off.</div>
      <div style="height:22px"></div>
      <input id="si-email" class="ob-input" type="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Email" />
      <div style="height:12px"></div>
      <input id="si-pass" class="ob-input" type="password" placeholder="Password" />
      <div id="si-err" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;margin-top:12px;text-align:center"></div>
      <div class="spacer"></div>
      <button id="si-go" class="btn green">Sign In</button>
      <div style="height:10px"></div>
      <button class="btn ghost" data-go="role">Create an account</button>
      <div style="height:14px"></div>
    </div>`;
  },
  mount(root) {
    const go = window.__go;
    const emailEl = root.querySelector('#si-email');
    const passEl = root.querySelector('#si-pass');
    const err = root.querySelector('#si-err');
    const btn = root.querySelector('#si-go');
    const submit = async () => {
      err.textContent = '';
      const email = (emailEl.value || '').trim();
      const password = passEl.value || '';
      if (!email || !password) { err.textContent = 'Enter your email and password.'; return; }
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      const r = await act.signIn(email, password);
      if (r.ok) {
        go(routeForRole(r.role));
      } else {
        err.textContent = r.error || 'Sign in failed.';
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    };
    btn.addEventListener('click', submit);
    passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};
