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

let overlay = null;

function close() {
  if (!overlay) return;
  const o = overlay;
  overlay = null;
  o.classList.remove('on');
  setTimeout(() => { try { o.remove(); } catch { /* already gone */ } }, 180);
  try { document.removeEventListener('keydown', onKey); } catch { /* not attached */ }
}
function onKey(e) { if (e.key === 'Escape') close(); }

/** Open the sheet on a participant list (see chat-view.participantList). */
export function openMembersSheet(members) {
  const list = Array.isArray(members) ? members.filter(Boolean) : [];
  if (!list.length || overlay) return;

  const rows = list.map((p) => {
    const meta = participantMeta(p.kind);
    // "You" is the athlete's own row: naming their role back at them is noise, so it says what
    // it is. Everyone else gets the plain-English sentence about what they can see.
    const sub = p.self ? 'This is your log' : meta.access;
    return `
      <div class="ms-row">
        <span class="ms-av ${esc(p.kind === 'ai' ? 'ai' : p.self ? 'self' : 'other')}">${p.kind === 'ai' ? icon('bot', 16) : esc(initialsFor(p.name))}</span>
        <span class="ms-txt">
          <span class="ms-name">${esc(p.name)}</span>
          <span class="ms-kind">${icon(meta.ic, 12, 'style="vertical-align:-2px;margin-right:1px"')} ${esc(p.self ? 'Athlete' : meta.noun)} · ${esc(sub)}</span>
        </span>
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
      <div class="ms-foot">Anyone connected to your plan — coaches, trainers, parents, dietitians — appears here. Nobody else can read this.</div>
    </div>`;

  document.body.appendChild(el);
  overlay = el;
  requestAnimationFrame(() => el.classList.add('on'));
  document.addEventListener('keydown', onKey);
  el.querySelector('.ms-x').addEventListener('click', close);
  // Tapping the scrim closes; tapping the card itself must not.
  el.addEventListener('click', (ev) => { if (ev.target === el) close(); });
  try { el.querySelector('.ms-x').focus(); } catch { /* focus is a nicety */ }
}
