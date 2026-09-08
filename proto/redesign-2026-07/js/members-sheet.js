/* Who can read this conversation — a DOM overlay, opened from the participants header.
 *
 * WHY IT EXISTS. The meal thread became a group chat, and a messaging surface that hides its own
 * audience is a privacy problem wearing a UI problem's clothes. An athlete typing "I skipped
 * breakfast, don't tell anyone" deserves to know, before they hit send, that their coach and
 * their mother can both read it. So the header names the room and this sheet spells it out.
 *
 * It grants nothing and changes nothing: the list comes from meal_thread_participants (0158),
 * which is gated on the same can_view() that already governs the thread. This is disclosure.
 *
 * Same overlay idiom as image-viewer.js — no route change, so closing lands exactly where the
 * athlete opened it from, mid-scroll and mid-conversation.
 */

import { participantMeta, initialsFor } from './chat-view.js';
import { esc } from './components.js';
import { icon } from './icons.js';
import { hydrateAvatars } from './avatar.js';
import { overlayOpen } from './overlay-guard.js';
import { act } from './state.js';
import * as roles from './roles.js';

let overlay = null;
let opener = null;   // the element that opened the sheet; focus returns to it on close

function close() {
  if (!overlay) return;
  const o = overlay;
  overlay = null;
  o.classList.remove('on');
  setTimeout(() => { try { o.remove(); } catch { /* already gone */ } }, 180);
  try { document.removeEventListener('keydown', onKey); } catch { /* not attached */ }
  // Round-trip focus: open() moves focus to the close button, so closing must hand it back or
  // the user is dumped to <body> and loses the mid-conversation position this overlay exists
  // to preserve.
  const back = opener;
  opener = null;
  if (back && typeof back.focus === 'function') { try { back.focus(); } catch { /* opener left the DOM */ } }
}
function onKey(e) {
  if (e.key === 'Escape') { close(); return; }
  // aria-modal promised AT the background doesn't exist; Tab has to keep that promise too.
  if (e.key === 'Tab' && overlay) {
    const f = overlay.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

/** Open the sheet on a participant list (see chat-view.participantList). */
export function openMembersSheet(members, ctx = {}) {
  const list = Array.isArray(members) ? members.filter(Boolean) : [];
  // One overlay at a time (DESIGN.md): the tour's cutout leaves the participants header live, so
  // without this a tap there opened the sheet UNDER a running tour. The marker list lives in
  // overlay-guard.js; this caller only excludes its own.
  if (!list.length || overlay || overlayOpen('.memsheet')) return;
  // Record who opened it BEFORE focus moves to the close button below; close() hands it back.
  opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;

  const rows = list.map((p) => {
    const meta = participantMeta(p.kind);
    // "You" is the athlete's own row: naming their role back at them is noise, so it says what
    // it is. Everyone else gets the plain-English sentence about what they can see.
    const sub = p.self ? 'This is your log' : meta.access;
    /* Report and Mute live on the person, not the bubble (App Store Guideline 1.2: user-generated
       content needs a way to report it and to block who posted it). The bubbles carry no message
       id and this sheet already knows exactly who is in the conversation, so this is the honest
       place for both. Mute is immediate and device-local (state.js muteUser; layoutThread drops
       the author everywhere). Report opens a reason row and lands in content_reports (0227). */
    const person = p.kind !== 'ai' && !p.self && p.id;
    const muted = person && act.isMuted(p.id);
    const acts = person ? `
        <span class="ms-acts">
          <button type="button" class="btn ghost sm" data-ms-report="${esc(p.id)}" aria-label="Report ${esc(p.name)}">Report</button>
          <button type="button" class="btn ghost sm${muted ? ' danger' : ''}" data-ms-mute="${esc(p.id)}" aria-pressed="${muted}" aria-label="${muted ? `Unmute ${esc(p.name)}` : `Mute ${esc(p.name)}`}">${muted ? 'Muted' : 'Mute'}</button>
        </span>` : '';
    return `
      <div class="ms-row" data-ms-uid="${esc(p.id || '')}">
        <span class="ms-av ${esc(p.kind === 'ai' ? 'ai' : p.self ? 'self' : 'other')}"${p.kind !== 'ai' && p.id ? ` data-avatar-uid="${esc(p.id)}"` : ''}>${p.kind === 'ai' ? icon(meta.ic, 16) : `<span data-avatar-fallback>${esc(initialsFor(p.name))}</span>`}</span>
        <span class="ms-txt">
          <span class="ms-name">${esc(p.name)}</span>
          <span class="ms-kind">${icon(meta.ic, 12, 'style="vertical-align:-2px;margin-right:1px"')} ${esc(p.self ? 'Athlete' : meta.noun)} · ${esc(muted ? 'Muted on this phone' : sub)}</span>
        </span>${acts}
      </div>`;
  }).join('');

  const el = document.createElement('div');
  el.className = 'memsheet';
  el.innerHTML = `
    <div class="ms-card" role="dialog" aria-modal="true" aria-label="Who can see this conversation">
      <div class="ms-head">
        <div class="ms-title">In this conversation</div>
        <button class="ms-x" aria-label="Close">×</button>
      </div>
      <div class="ms-list">${rows}</div>
      <div class="ms-foot">Anyone connected to your plan (coaches, trainers, parents, dietitians) appears here. Nobody else can read this.</div>
    </div>`;

  document.body.appendChild(el);
  overlay = el;
  hydrateAvatars(el);   // faces answer "who can read this" faster than monograms (0206)
  requestAnimationFrame(() => el.classList.add('on'));
  document.addEventListener('keydown', onKey);
  el.querySelector('.ms-x').addEventListener('click', close);
  // Tapping the scrim closes; tapping the card itself must not.
  el.addEventListener('click', (ev) => { if (ev.target === el) close(); });

  // Mute: toggle, repaint the thread behind the sheet, and reopen the sheet on the same list so
  // the row reads "Muted" and the button flips. Report: swap the row's actions for a reason row;
  // a tap on a reason files it and the row says so. Both are the reader's own actions on their
  // own device; nothing here needs a round trip to feel done.
  el.addEventListener('click', async (ev) => {
    const mute = ev.target && ev.target.closest && ev.target.closest('[data-ms-mute]');
    const report = ev.target && ev.target.closest && ev.target.closest('[data-ms-report]');
    const reason = ev.target && ev.target.closest && ev.target.closest('[data-ms-reason]');
    if (mute) {
      const id = mute.getAttribute('data-ms-mute');
      if (act.isMuted(id)) act.unmuteUser(id); else act.muteUser(id);
      close();
      try { window.__render && window.__render(); } catch { /* repaint is best-effort */ }
      openMembersSheet(list);
      return;
    }
    if (report) {
      const row = report.closest('.ms-row');
      const acts = row && row.querySelector('.ms-acts');
      if (!acts) return;
      const id = report.getAttribute('data-ms-report');
      acts.innerHTML = ['harassment', 'inappropriate', 'spam', 'safety'].map((r) => `<button type="button" class="chip" data-ms-reason="${r}" data-ms-uid="${esc(id)}">${r === 'harassment' ? 'Harassment' : r === 'inappropriate' ? 'Inappropriate' : r === 'spam' ? 'Spam' : 'Safety concern'}</button>`).join('');
      return;
    }
    if (reason) {
      const row = reason.closest('.ms-row');
      const acts = row && row.querySelector('.ms-acts');
      const id = reason.getAttribute('data-ms-uid');
      const why = reason.getAttribute('data-ms-reason');
      if (acts) acts.innerHTML = `<span class="ms-kind">Sending…</span>`;
      const r = await roles.reportContent({ subjectId: id, reason: why, mealId: ctx.mealId || null, teamId: ctx.teamId || null });
      if (acts) acts.innerHTML = `<span class="ms-kind" role="status">${r && r.ok ? 'Reported. A person on the OnStandard team reviews every report.' : 'Could not send. Try again from a connection.'}</span>`;
    }
  });
  try { el.querySelector('.ms-x').focus(); } catch { /* focus is a nicety */ }
}
