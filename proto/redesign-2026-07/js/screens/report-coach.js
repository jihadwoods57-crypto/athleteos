/* Report a marketplace coach — #report-coach/<practiceId>. The safety intake: reason + detail,
   straight into coach_reports for admin review. Transient so back never lands here again. */
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { track, EVENTS } from '../analytics.js';

const REASONS = [
  { key: 'scope', label: 'Acting outside their scope', sub: 'Medical, mental-health, or nutrition advice they aren’t verified for' },
  { key: 'conduct', label: 'Inappropriate conduct', sub: 'Disrespectful, pressuring, or made me uncomfortable' },
  { key: 'solicitation', label: 'Tried to take it off OnStandard', sub: 'Asked to pay or communicate outside the app' },
  { key: 'spam', label: 'Spam or automation', sub: 'Copy-paste messages, no real coaching' },
  { key: 'other', label: 'Something else', sub: 'Tell us below' },
];

let UI = { practice: null, reason: null, sending: false, sent: false, err: '' };

export default {
  hideTabs: true,
  transient: true,
  render({ sub }) {
    // A fresh target resets the form — never in mount(), because __render() re-runs mount() and a
    // reset there would wipe the success state the moment it painted.
    const practice = (sub || '').trim();
    if (UI.practice !== practice) UI = { practice, reason: null, detail: '', sending: false, sent: false, err: '' };
    if (UI.sent) {
      return `${backHead('Report received', '', 'profile')}
      <section class="state-demo"><div class="sd-ic" style="color:var(--green-bright)">${icon('check', 24)}</div>
      <div class="sd-t">Thank you — we take this seriously</div>
      <div class="sd-s">A person on the OnStandard team reviews every report. If this is an emergency, contact local emergency services — the app is not an emergency channel.</div></section>`;
    }
    return `${backHead('Report this coach', 'Reviewed by the OnStandard team', 'coach-directory')}

    <div class="eyebrow">What happened?</div>
    <section class="card" style="padding:6px 16px">
      ${REASONS.map((r) => `
      <div class="lrow" data-rc-reason="${r.key}">
        <div class="lic"${UI.reason === r.key ? ' style="background:var(--blue-bright);color:var(--ink-on-accent)"' : ''}>${icon(UI.reason === r.key ? 'check' : 'bell', 16)}</div>
        <div class="lm"><div class="lt">${esc(r.label)}</div><div class="ls">${esc(r.sub)}</div></div>
      </div>`).join('')}
    </section>

    <div class="eyebrow">Details (optional)</div>
    <section class="card pad">
      <textarea id="rc-detail" rows="4" maxlength="500" placeholder="What would help us understand?"
        style="width:100%;background:transparent;border:1px solid var(--hairline);border-radius:12px;padding:10px 12px;color:var(--text);font:inherit;font-size:13.5px;resize:vertical">${esc(UI.detail || '')}</textarea>
      ${UI.err ? `<div style="color:var(--red);font-size:12.5px;font-weight:600;margin-top:8px">${esc(UI.err)}</div>` : ''}
      <button class="btn primary" data-rc-send ${UI.reason && !UI.sending ? '' : 'disabled'} style="margin-top:12px">${UI.sending ? 'Sending…' : 'Send report'}</button>
    </section>

    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
      <div><div class="tt">Your coach doesn't see this</div><div class="ts">Reports go to OnStandard only. Serious findings can suspend a coach from the marketplace.</div></div></div>
    `;
  },
  mount(root) {
    if (UI.sent) return;
    const ta = root.querySelector('#rc-detail');
    if (ta) ta.addEventListener('input', () => { UI.detail = ta.value; });
    root.querySelectorAll('[data-rc-reason]').forEach((el) => el.addEventListener('click', () => {
      UI.reason = el.getAttribute('data-rc-reason');
      if (window.__render) window.__render();
    }));
    const send = root.querySelector('[data-rc-send]');
    if (send) send.addEventListener('click', async () => {
      const practiceId = UI.practice || '';
      const detail = UI.detail || '';
      if (!UI.reason || UI.sending) return;
      UI.sending = true; UI.err = '';
      if (window.__render) window.__render();
      const r = await roles.submitCoachReport(practiceId, UI.reason, detail);
      UI.sending = false;
      if (r && r.ok) { UI.sent = true; track(EVENTS.MKT_REPORT_SUBMITTED, { reason: UI.reason }); }
      else UI.err = (r && r.error) || 'Could not send the report — try again';
      if (window.__render) window.__render();
    });
  },
};
