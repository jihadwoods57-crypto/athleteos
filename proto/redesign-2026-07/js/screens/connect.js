import { S, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';

/* Connect a Coach — the athlete side of the invite loop. Coaches/trainers mint and share a
   real code; this screen redeems it against the real join RPCs (act.joinByCode) and flips to
   the connected state on success. Practice (trainer) codes work here too — one entry point. */

let justJoined = null; // 'team' | 'practice' — one-shot success banner for links S.coach can't show

export default {
  tab: 'profile',
  render() {
    const c = S.coach;
    if (c.hasCoach || justJoined) {
      const wasPractice = justJoined === 'practice' && !c.hasCoach;
      justJoined = null;
      return `
      ${backHead('Connect a Coach', 'Connected', 'profile')}
      <div class="state-demo" style="border-style:solid;border-color:var(--green-border)">
        <div class="sd-ic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 24)}</div>
        <div class="sd-t">${wasPractice ? 'Connected to your trainer' : esc(c.isNamed ? c.name : (c.team || 'Connected'))}</div>
        <div class="sd-s">${wasPractice
          ? 'Your trainer now sees your recovery, readiness, and nutrition consistency.'
          : `${esc(c.team || 'Your team')} now sees your daily score, requirement completion, meal logs, and check-ins.`}</div>
        <div class="sd-cta"><button class="btn ghost sm" data-go="profile">Back to profile</button></div>
      </div>
      <div style="height:10px"></div>
      `;
    }
    return `
    ${backHead('Connect a Coach', 'Enter the code your coach gave you', 'profile')}

    <div style="height:14px"></div>
    <input id="cc-code" class="ob-input" placeholder="Coach code" aria-label="Coach or trainer code" autocapitalize="characters" autocorrect="off" spellcheck="false" style="text-align:center;letter-spacing:0.2em;font-weight:800" />
    <div style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);margin-top:10px">Ask your coach or team group chat for the code. Trainer codes work here too.</div>
    <div id="cc-err" role="alert" aria-live="assertive" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;margin-top:10px;text-align:center"></div>

    <div style="height:6px"></div>
    <button class="btn" id="cc-join">Connect</button>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">What connecting will share</div>
      <div class="ts">Once you join a coach, they see your daily score, requirement completion, meal logs, and check-ins. Nothing is shared until you connect.</div></div>
    </div>

    <div style="height:18px"></div>
    <button class="btn ghost" data-go="profile">Back to profile</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const input = root.querySelector('#cc-code');
    const btn = root.querySelector('#cc-join');
    const err = root.querySelector('#cc-err');
    if (!btn || !input) return;
    const submit = async () => {
      if (btn.disabled) return;
      err.textContent = '';
      const code = (input.value || '').trim();
      if (!code) { err.textContent = 'Enter the code first.'; return; }
      // Definitive-offline preflight: joinByCode's RPC failure copy reads "code didn't match",
      // which is a lie when the real problem is the connection. navigator.onLine only ever
      // under-reports offline (never blocks a live connection), so this adds no false blocking.
      if (!navigator.onLine) { err.textContent = 'You need a connection for this — try again when you\'re online.'; return; }
      btn.disabled = true;
      const was = btn.textContent;
      btn.textContent = 'Connecting…';
      const r = await act.joinByCode(code);
      if (r.ok) { justJoined = r.kind; window.__render(); return; }
      err.textContent = r.error || 'Could not connect. Try again.';
      btn.disabled = false;
      btn.textContent = was;
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};
