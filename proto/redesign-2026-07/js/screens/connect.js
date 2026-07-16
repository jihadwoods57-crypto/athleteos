import { S, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { dir, CODE_RE } from '../ob-directory.js';

/* Connect a coach or trainer (spec §12) — the athlete side of the invite loop.
   Flow: enter code → VALIDATE + PREVIEW (the real org/team behind the code, via the
   org-directory preview_code endpoint) → confirm → join (act.joinByCode, real RPCs).
   The preview step prevents accidental wrong-team connections; when the directory is
   unreachable the code still redeems directly (the server re-validates either way). */

let justJoined = null;      // 'team' | 'practice' — one-shot success banner
let preview = null;         // { code, name, kind, teamName } — the confirm step's payload

export default {
  tab: 'profile',
  render() {
    const c = S.coach;
    if (c.hasCoach || justJoined) {
      const wasPractice = justJoined === 'practice' && !c.hasCoach;
      const isTrainer = wasPractice || c.kind === 'trainer';
      justJoined = null;
      preview = null;
      const title = c.isNamed ? esc(c.name) : (isTrainer ? 'Connected to your trainer' : esc(c.team || 'Connected'));
      const sub = isTrainer
        ? `${c.team ? esc(c.team) + ' now sees' : 'Your trainer now sees'} your recovery, readiness, and nutrition consistency.`
        : `${esc(c.team || 'Your team')} now sees your daily score, requirement completion, meal logs, and check-ins.`;
      return `
      ${backHead(isTrainer ? 'Connect a Trainer' : 'Connect a Coach', 'Connected', 'profile')}
      <div class="state-demo" style="border-style:solid;border-color:var(--green-border)">
        <div class="sd-ic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 24)}</div>
        <div class="sd-t">${title}</div>
        <div class="sd-s">${sub}</div>
      </div>
      <div style="height:10px"></div>
      `;
    }

    // ---- Step 2: confirm the REAL team behind the code before anything is shared ----
    if (preview) {
      const isTeam = preview.kind !== 'practice';
      return `
      ${backHead('Confirm connection', 'Check this is your team before you join', 'connect')}
      <section class="card team-preview" style="margin-top:8px">
        <div class="tp-av">${esc((preview.name || 'T').slice(0, 2).toUpperCase())}</div>
        <div style="flex:1">
          <div style="font-size:16.5px;font-weight:800">${esc(preview.name || (isTeam ? 'Your team' : 'Your trainer'))}</div>
          ${preview.teamName ? `<div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(preview.teamName)}</div>` : ''}
          <div style="font-size:11.5px;font-weight:700;color:var(--text-3);margin-top:3px">Code ${esc(preview.code)}</div>
        </div>
      </section>
      <div class="sidebox" style="margin-top:12px">
        <div class="req-icon b" style="width:38px;height:38px">${icon('eye', 17)}</div>
        <div><div class="tt">What they'll see</div>
        <div class="ts">${isTeam ? 'This coach will see your score, requirements, meal logs, and check-ins.' : 'This trainer will see your recovery, readiness, and nutrition consistency.'}</div></div>
      </div>
      <div id="cc-err" role="alert" aria-live="assertive" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;margin-top:12px;text-align:center"></div>
      <button class="btn primary" id="cc-confirm">${icon('check', 18)} Connect to ${esc(preview.name || 'this team')}</button>
      <div style="height:8px"></div>
      <button class="btn ghost sm" id="cc-cancel">Not my team — re-enter code</button>
      <div style="height:10px"></div>
      `;
    }

    // ---- Step 1: enter the code ----
    return `
    ${backHead('Connect a coach or trainer', 'Enter the code they gave you', 'profile')}

    <div style="height:14px"></div>
    <input id="cc-code" class="ob-input" placeholder="Team or trainer code" aria-label="Coach or trainer code"
      autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go"
      style="text-align:center;letter-spacing:0.2em;font-weight:800;text-transform:uppercase" />
    <div style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);margin-top:10px">Ask your coach or team group chat for the code. Trainer codes work here too.</div>
    <div id="cc-err" role="alert" aria-live="assertive" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;margin-top:10px;text-align:center"></div>

    <div style="height:6px"></div>
    <button class="btn primary" id="cc-join" disabled style="opacity:.5">Continue</button>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">Nothing is shared until you confirm</div>
      <div class="ts">You'll see exactly which team the code belongs to — and what they can see — before you join.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const err = root.querySelector('#cc-err');

    // ---- confirm step ----
    const confirmBtn = root.querySelector('#cc-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        if (confirmBtn.disabled || !preview) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Connecting…';
        const r = await act.joinByCode(preview.code);
        if (r.ok) { justJoined = r.kind; window.__render(); return; }
        err.textContent = r.error || 'Could not connect. Try again.';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Connect';
      });
      const cancel = root.querySelector('#cc-cancel');
      if (cancel) cancel.addEventListener('click', () => { preview = null; window.__render(); });
      return;
    }

    // ---- code-entry step ----
    const input = root.querySelector('#cc-code');
    const btn = root.querySelector('#cc-join');
    if (!btn || !input) return;
    const normalize = () => {
      // Paste-friendly (spec §12.2): trim, strip inner spaces, force uppercase.
      const v = input.value.replace(/\s+/g, '').toUpperCase();
      if (v !== input.value) input.value = v;
      const ok = v.length >= 4;
      btn.disabled = !ok;
      btn.style.opacity = ok ? '1' : '.5';
    };
    input.addEventListener('input', normalize);
    input.addEventListener('paste', () => setTimeout(normalize, 0));
    const submit = async () => {
      if (btn.disabled) return;
      err.textContent = '';
      const code = input.value.replace(/\s+/g, '').toUpperCase();
      if (!code) { err.textContent = 'Enter the code first.'; return; }
      if (!CODE_RE.test(code)) { err.textContent = 'Codes are 4–12 letters and numbers. Check it and try again.'; return; }
      // Definitive-offline preflight: joinByCode's RPC failure copy reads "code didn't match",
      // which is a lie when the real problem is the connection.
      if (!navigator.onLine) { err.textContent = 'You need a connection for this — try again when you\'re online.'; return; }
      btn.disabled = true;
      const was = btn.textContent;
      btn.textContent = 'Checking…';
      // Preview the code (spec §12.1): show the real org/coach behind it before anything connects.
      try {
        const { match } = await dir.previewCode(code);
        if (match) {
          preview = {
            code,
            kind: match.kind === 'practice' ? 'practice' : 'team',
            name: match.name || (match.kind === 'practice' ? 'Your trainer' : 'Your team'),
            teamName: match.kind === 'practice'
              ? (match.trainer_name ? `Trainer ${match.trainer_name}` : null)
              : [match.coach_name ? `Coach ${match.coach_name}` : null, match.school || null].filter(Boolean).join(' · ') || null,
          };
          window.__render();
          return;
        }
        err.textContent = 'That code didn\'t match a team or practice. Check it with your coach and try again.';
      } catch {
        // Directory unreachable — redeem directly; the join RPC re-validates the code anyway.
        const r = await act.joinByCode(code);
        if (r.ok) { justJoined = r.kind; window.__render(); return; }
        err.textContent = r.error || 'Could not connect. Try again.';
      }
      btn.disabled = false;
      btn.textContent = was;
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};
