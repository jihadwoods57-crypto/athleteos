/* Redeem a code. Two kinds arrive here and the athlete should not have to know the difference:

     SP-…  a sponsor bought premium seats (0132)
     TR-…  they paid a trainer from that trainer's public page before they had an account (0166),
           and this code is what turns that payment into a connection + premium

   The TR path is load-bearing: it is the ONLY way a pay-first buyer reaches the thing they were
   charged for, so an unrecognised code must never silently do nothing. We route on the prefix and
   fall back to trying both, because someone reading a code off a page will not reliably tell us
   which kind they have. The RPCs remain the source of truth on validity — this screen only maps
   their result to plain English. */
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';

let UI = { code: '', busy: false, result: null, kind: null }; // kind: 'trainer' | 'sponsor' | null
// Leaving the screen clears the last result so a return visit starts fresh — otherwise a stale
// "That code isn't valid." (or a success card) from a prior visit would greet the athlete.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').slice(1).split('/')[0] !== 'redeem-code') UI = { code: '', busy: false, result: null, kind: null };
  });
}

function reasonMessage(r) {
  if (r && r.error) return r.error;
  const reason = r && r.reason;
  if (reason === 'invalid_code') return "That code isn't valid.";
  if (reason === 'full') return 'This sponsorship is full.';
  if (reason === 'already_redeemed') return 'You already redeemed this.';
  // Trainer-code specific: the code was real but someone else got there first, or it aged out.
  if (reason === 'already_used') return 'That code has already been used on another account.';
  if (reason === 'expired') return 'That code has expired — contact your trainer.';
  if (reason === 'sign_in') return 'Please sign in.';
  return "That code isn't valid.";
}

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return String(d); }
}

/* Try the code against the right RPC. A TR- prefix means trainer; SP- means sponsor; anything
   else (a code typed without its prefix, say) tries trainer first, then sponsor — a wasted RPC
   call is cheaper than telling a paying customer their code is invalid. */
async function redeemEither(code) {
  const c = code.trim().toUpperCase();
  if (c.startsWith('TR-')) return { kind: 'trainer', r: await roles.redeemOfferCode(code) };
  if (c.startsWith('SP-')) return { kind: 'sponsor', r: await roles.redeemSponsorCode(code) };
  const t = await roles.redeemOfferCode(code);
  if (t && t.ok) return { kind: 'trainer', r: t };
  const s = await roles.redeemSponsorCode(code);
  if (s && s.ok) return { kind: 'sponsor', r: s };
  return { kind: 'sponsor', r: s };   // report the sponsor result; both said no
}

export default {
  render() {
    const r = UI.result;
    const success = r && r.ok === true;
    const viaTrainer = UI.kind === 'trainer';
    const who = viaTrainer ? (r && r.trainer_name) : (r && r.label);
    return `${backHead('Redeem a code', 'Unlock premium with a code you were given', 'profile')}

    <section class="card pad">
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Your code</div>
      <input class="ob-input" id="rc-code" value="${esc(UI.code)}" placeholder="TR-XXXXX-XXXXX" autocapitalize="characters" autocomplete="off" />
      <div style="font-size:12px;color:var(--text-3);margin-top:6px">From your trainer after you paid, or from a sponsor.</div>
      <div style="height:14px"></div>
      <div id="rc-err" style="color:var(--red);font-size:13px;font-weight:600;min-height:18px">${!success && r ? esc(reasonMessage(r)) : ''}</div>
      <button class="btn primary" id="rc-redeem" ${UI.busy ? 'disabled style="opacity:.6"' : ''}>${icon('key', 18)} ${UI.busy ? 'Redeeming…' : 'Redeem'}</button>
    </section>

    ${success ? `
    <div class="sidebox" style="margin-top:10px"><div class="req-icon g" style="width:38px;height:38px">${icon('check', 18)}</div>
      <div><div class="tt">${viaTrainer ? 'You are connected' : 'Premium unlocked'}</div>
      <div class="ts">${[
        viaTrainer
          ? (who ? `Working with ${esc(who)} · membership included` : 'Membership included with your coaching')
          : (who ? `Sponsored by ${esc(who)}` : ''),
        r.expires_at ? `${viaTrainer ? 'Covered through' : 'Until'} ${esc(formatDate(r.expires_at))}` : '',
      ].filter(Boolean).join(' · ')}</div></div>
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
      UI.busy = true; UI.result = null; UI.kind = null; if (window.__render) window.__render();
      const { kind, r } = await redeemEither(code);
      UI.busy = false;
      UI.kind = kind;
      UI.result = r;
      if (window.__render) window.__render();
    });
  },
};
