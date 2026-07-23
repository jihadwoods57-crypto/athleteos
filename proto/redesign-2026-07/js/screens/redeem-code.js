/* Redeem a sponsor code: an athlete types in a code a sponsor gave them and unlocks premium.
   Reached from Profile's Settings section. Single input + button; the RPC is the source of
   truth on validity/capacity, this screen just maps its result to plain-English copy. */
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';

let UI = { code: '', busy: false, result: null }; // result: { ok, reason, label, expires_at } | { error } | null
// Leaving the screen clears the last result so a return visit starts fresh — otherwise a stale
// "That code isn't valid." (or a success card) from a prior visit would greet the athlete.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').slice(1).split('/')[0] !== 'redeem-code') UI = { code: '', busy: false, result: null };
  });
}

function reasonMessage(r) {
  if (r && r.error) return r.error;
  const reason = r && r.reason;
  if (reason === 'invalid_code') return "That code isn't valid.";
  if (reason === 'full') return 'This sponsorship is full.';
  if (reason === 'already_redeemed') return 'You already redeemed this.';
  if (reason === 'sign_in') return 'Please sign in.';
  return "That code isn't valid.";
}

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return String(d); }
}

export default {
  render() {
    const r = UI.result;
    const success = r && r.ok === true;
    return `${backHead('Redeem a code', 'Unlock premium with a sponsor code', 'profile')}

    <section class="card pad">
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Sponsor code</div>
      <input class="ob-input" id="rc-code" value="${esc(UI.code)}" placeholder="Enter code" autocapitalize="characters" autocomplete="off" />
      <div style="height:14px"></div>
      <div id="rc-err" style="color:var(--red-bright);font-size:13px;font-weight:600;min-height:18px">${!success && r ? esc(reasonMessage(r)) : ''}</div>
      <button class="btn primary" id="rc-redeem" ${UI.busy ? 'disabled style="opacity:.6"' : ''}>${icon('key', 18)} ${UI.busy ? 'Redeeming…' : 'Redeem'}</button>
    </section>

    ${success ? `
    <div class="sidebox" style="margin-top:10px"><div class="req-icon g" style="width:38px;height:38px">${icon('check', 18)}</div>
      <div><div class="tt">Premium unlocked</div>
      <div class="ts">${[r.label ? `Sponsored by ${esc(r.label)}` : '', r.expires_at ? `Until ${esc(formatDate(r.expires_at))}` : ''].filter(Boolean).join(' · ')}</div></div>
    </div>` : ''}
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const codeEl = root.querySelector('#rc-code');
    if (codeEl) codeEl.addEventListener('input', () => { UI.code = codeEl.value; });

    const btn = root.querySelector('#rc-redeem');
    if (btn) btn.addEventListener('click', async () => {
      const err = root.querySelector('#rc-err');
      const code = UI.code.trim();
      if (!code) { if (err) err.textContent = 'Enter a code.'; return; }
      if (err) err.textContent = '';
      UI.busy = true; UI.result = null; if (window.__render) window.__render();
      const r = await roles.redeemSponsorCode(code);
      UI.busy = false;
      UI.result = r;
      if (window.__render) window.__render();
    });
  },
};
