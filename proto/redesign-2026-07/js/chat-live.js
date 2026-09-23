/* The live half of a thread: what happens between tapping Send and the row coming back, and
 * everything that must survive a repaint while it does. Shared by all four renderers (meal.js,
 * nutrition-chat.js, coach.js, trust.js).
 *
 * WHY A MODULE, AND WHY MODULE STATE. Every renderer's send lock was a `let busy` inside
 * mount(), and mount() runs again on every __render(). The coach screen re-renders whenever
 * anything lands, so a lock held by the old mount meant nothing to the new one, and the coach
 * composer had no lock at all: a tap that showed no sign of working was simply tapped again.
 * That is how "The nutrition facts is in the picture" was stored twice, 15 seconds apart
 * (2026-09-22). The state here is keyed by THREAD (the meal id), not by mount, so a repaint
 * cannot forget a send that is in flight.
 *
 * WHAT LIVES HERE
 *   - the send guard: one send in flight per thread, and the same words re-sent inside a short
 *     window are recognised as the same intent (unless the first one failed)
 *   - the outbox: the bubble you sent, shown the instant you send it, "Sending…" under it, and
 *     "Not delivered" with a retry if it never lands (the rows are drawn by chat-view.js)
 *   - the AI-at-work flag, which any send path can raise (setAiWorking) so the typing row shows
 *     for as long as the AI is working, on whichever screen is showing that thread
 *   - arrivals: which rows are new since the last paint, for the entrance and the unread count
 *   - the reply being composed (swipe right, or hold and pick Reply)
 *   - the jump-to-latest pill with its unread count
 *
 * Live rows (typing, pending) are placed into the painted thread by DOM, never by re-render: a
 * full __render() rebuilds the composer, and one landing while someone types would eat their
 * words. Renderers call syncLive() at the end of every paint, because a paint's innerHTML wipes
 * whatever was placed before it.
 */
import { pendingRowHtml, typingRowHtml } from './chat-view.js';
import { icon } from './icons.js';

/** The same words, again, inside this window, are the same intent: the incident was 15s.
 *  20s, not 45s (founder, 2026-09-23): the thread now shows "Sending…" and the AI's working
 *  row, so the resend-because-nothing-happened case is rarer, and a longer window blocked
 *  people who meant to say something twice. */
export const DUP_WINDOW_MS = 20000;
/** How long a new row counts as arriving (its entrance plays inside this beat, then stops). */
const ARRIVE_MS = 450;

const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.!?]+$/, '').trim();
let SEQ = 0;

/* key -> { inflight: lid|null, items: [], last: { n, at }|null, working: {label}|null,
            reply: ref|null, seen: Map(id -> firstSeenAt)|null, unread: number, onRetry, paint } */
const THREADS = new Map();
function slot(key) {
  const k = String(key || '');
  let s = THREADS.get(k);
  if (!s) {
    s = { inflight: null, items: [], last: null, working: null, reply: null, seen: null, unread: 0, onRetry: null, sync: null };
    THREADS.set(k, s);
  }
  return s;
}
const notify = (key) => { const s = slot(key); if (typeof s.sync === 'function') { try { s.sync(); } catch { /* the screen is gone */ } } };

/* ---------------- the send guard + outbox ---------------- */

/**
 * Claim a send. Returns { ok: true, item } (the outbox bubble, already showing) or
 * { ok: false, reason } where reason is 'inflight' (a send for this thread has not settled) or
 * 'duplicate' (the same words went out a moment ago and landed). A photo is never a duplicate:
 * two pictures can share a caption.
 */
export function beginSend(key, { text = '', photo = null, replyTo = null } = {}) {
  const s = slot(key);
  if (s.inflight) return { ok: false, reason: 'inflight' };
  const n = norm(text);
  if (!photo && n && s.last && s.last.n === n && Date.now() - s.last.at < DUP_WINDOW_MS) {
    return { ok: false, reason: 'duplicate' };
  }
  const item = { lid: `l${++SEQ}`, text: String(text || ''), photo: photo || null, replyTo: replyTo || null, state: 'sending', at: Date.now() };
  s.items.push(item);
  s.inflight = item.lid;
  notify(key);
  return { ok: true, item };
}

/** Settle a send. Success takes the bubble out of the outbox (the real row replaces it on the
 *  refetch the caller does next) and remembers the words for the duplicate window; failure
 *  leaves it in place as "Not delivered". Either way the thread is free to send again. */
export function endSend(key, lid, { ok } = {}) {
  const s = slot(key);
  if (s.inflight === lid) s.inflight = null;
  const i = s.items.findIndex((x) => x.lid === lid);
  if (i < 0) return;
  const item = s.items[i];
  if (ok) {
    s.items.splice(i, 1);
    if (!item.photo && norm(item.text)) s.last = { n: norm(item.text), at: Date.now() };
  } else {
    item.state = 'failed';
  }
  notify(key);
}

/** Take a failed bubble back out (its retry is about to send it again as a new one). */
export function takeFailed(key, lid) {
  const s = slot(key);
  const i = s.items.findIndex((x) => x.lid === lid && x.state === 'failed');
  if (i < 0) return null;
  const [item] = s.items.splice(i, 1);
  notify(key);
  return item;
}

/** Were these exact words just posted to this thread? The coach's sparkle uses it: typing the
 *  same sentence again to get the AI to look is one intent, so the question is not posted a
 *  second time, only asked. */
export function justSent(key, text) {
  const s = slot(key);
  const n = norm(text);
  return !!(n && s.last && s.last.n === n && Date.now() - s.last.at < DUP_WINDOW_MS);
}

/** Remember words that were posted by a path that does not go through beginSend. */
export function noteSent(key, text) {
  const n = norm(text);
  if (n) slot(key).last = { n, at: Date.now() };
}

export function isSending(key) { return !!slot(key).inflight; }
export function pendingOf(key) { return slot(key).items.slice(); }

/* ---------------- the AI at work ---------------- */

/**
 * THE HOOK. Any send path raises this while the AI is working on THIS thread and lowers it when
 * the answer (or the failure) is in; every screen showing the thread draws the typing row for
 * exactly that long. `label` says what it is doing when that is known ("Reading the photo",
 * "Reading the label"); empty is the three dots.
 */
export function setAiWorking(key, on, { label = '' } = {}) {
  const s = slot(key);
  s.working = on ? { label: String(label || ''), at: Date.now() } : null;
  notify(key);
}
export function aiWorkingOf(key) { return slot(key).working; }

/* ---------------- replies ---------------- */

export function setReply(key, ref) { slot(key).reply = ref || null; notify(key); }
export function replyOf(key) { return slot(key).reply; }
export function clearReply(key) { if (slot(key).reply) { slot(key).reply = null; notify(key); } }

/* ---------------- arrivals ---------------- */

/**
 * Which of these rows are new. The first call for a thread only learns what is there (opening a
 * thread plays no entrances); after that a row is "fresh" for ARRIVE_MS from the paint that
 * first saw it, so a repaint inside that beat does not cut its entrance short and one after it
 * does not replay it. `added` counts rows by someone else that arrived on this call.
 */
export function noteArrivals(key, rows, selfId = null) {
  const s = slot(key);
  const now = Date.now();
  const list = (Array.isArray(rows) ? rows : []).filter((c) => c && c.id != null);
  let added = 0;
  if (!s.seen) {
    s.seen = new Map();
    for (const c of list) s.seen.set(String(c.id), 0);
    return { fresh: new Set(), added: 0 };
  }
  const fresh = new Set();
  for (const c of list) {
    const id = String(c.id);
    // Your own row arrives already seen: its outbox bubble made the entrance, and the real row
    // taking that bubble's place must not play it a second time.
    const own = !!(selfId && c.author_id === selfId && c.role !== 'ai');
    if (!s.seen.has(id)) {
      s.seen.set(id, own ? 0 : now);
      if (!own) added++;
    }
    const t = s.seen.get(id);
    if (t && now - t < ARRIVE_MS) fresh.add(id);
  }
  return { fresh, added };
}

/* ---------------- placing the live rows ---------------- */

/**
 * Put the outbox bubbles and the typing row at the end of a painted thread. Idempotent: it
 * removes what it placed before and places the current state, so it is safe after every paint
 * and on every state change. Returns true when an outbox bubble is showing (the caller forces
 * the scroll: you just sent it and are watching it go).
 */
export function syncLive(threadEl, key, { esc, imgSrc, label = '' } = {}) {
  if (!threadEl || !esc) return false;
  const s = slot(key);
  threadEl.querySelectorAll(':scope > .live-row').forEach((n) => n.remove());
  const now = Date.now();
  const html = s.items.map((it) => pendingRowHtml(it, esc, imgSrc, { fresh: now - it.at < ARRIVE_MS })).join('')
    + (s.working ? typingRowHtml(esc, { label: s.working.label || label }) : '');
  if (html) threadEl.insertAdjacentHTML('beforeend', html);
  return s.items.length > 0;
}

/**
 * Register how a screen re-places its live rows when state changes outside a paint (a send
 * settling, the AI starting or finishing). One per thread; the newest mount wins, so a re-mount
 * replaces rather than stacks. `onRetry(item)` re-sends a failed bubble.
 */
export function bindLive(key, { sync, onRetry } = {}) {
  const s = slot(key);
  s.sync = sync || null;
  s.onRetry = onRetry || null;
}

/* ---------------- the reply chip in the dock ---------------- */

/** Draw (or remove) the "Replying to" strip above the composer in `dock`. */
export function paintReplyChip(dock, key, esc) {
  if (!dock) return;
  const s = slot(key);
  let chip = dock.querySelector(':scope > .reply-chip');
  if (!s.reply) { if (chip) chip.remove(); return; }
  const r = s.reply;
  const body = r.text || (r.photo ? 'Photo' : '');
  const html = `<span class="rc-t"><b>Replying to ${esc(r.who || 'this message')}</b><span>${esc(body)}</span></span>
    <button type="button" class="rc-x" data-reply-clear="1" aria-label="Cancel the reply">${icon('x', 14)}</button>`;
  if (!chip) {
    chip = document.createElement('div');
    chip.className = 'reply-chip';
    const composerEl = dock.querySelector(':scope > .composer');
    dock.insertBefore(chip, composerEl || dock.firstChild);
  }
  chip.innerHTML = html;
}

/* ---------------- delegated taps: jump to a quote, cancel a reply, retry ---------------- */

const TAPS = new WeakMap();
/**
 * One delegated listener per persistent root. `scope` is the screen's thread selector; `key()`
 * resolves the thread at tap time (nutrition-chat spans meals, so its key moves).
 */
export function wireThreadTaps({ root, scope, key, onReplyCleared } = {}) {
  if (!root) return;
  const prior = TAPS.get(root);
  if (prior) { Object.assign(prior, { scope, key, onReplyCleared }); return; }
  const cfg = { scope, key, onReplyCleared };
  TAPS.set(root, cfg);
  root.addEventListener('click', (ev) => {
    const t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    const jump = t.closest('[data-jump]');
    if (jump && jump.closest(cfg.scope)) {
      ev.preventDefault();
      jumpToMessage(jump.closest(cfg.scope), jump.getAttribute('data-jump'));
      return;
    }
    const clr = t.closest('[data-reply-clear]');
    if (clr) {
      const k = typeof cfg.key === 'function' ? cfg.key() : cfg.key;
      clearReply(k);
      const chip = clr.closest('.reply-chip');
      if (chip) chip.remove();
      if (typeof cfg.onReplyCleared === 'function') cfg.onReplyCleared();
      return;
    }
    const retry = t.closest('[data-out-retry]');
    if (retry && retry.closest(cfg.scope)) {
      const k = typeof cfg.key === 'function' ? cfg.key() : cfg.key;
      const item = takeFailed(k, retry.getAttribute('data-out-retry'));
      const s = slot(k);
      if (item && typeof s.onRetry === 'function') void s.onRetry(item);
    }
  });
}

/** Scroll the original of a quote into view and mark it for a beat. Returns false when it is
 *  not on this screen (a preview that only shows the latest few). */
export function jumpToMessage(threadEl, id) {
  if (!threadEl || !id) return false;
  let row = null;
  try { row = threadEl.querySelector(`.msg[data-cid="${CSS.escape(String(id))}"]`); } catch { row = null; }
  if (!row) return false;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({ block: 'center', behavior: reduce ? 'instant' : 'smooth' });
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 1400);
  return true;
}

/* ---------------- jump to latest ---------------- */

/** How far from the end counts as "reading back", not "at the conversation". */
const FAR_PX = 240;
const JUMPS = new WeakMap();   // viewport -> { key, always, btn }

const vpOf = (el) => (el && el.closest && el.closest('.viewport')) || (el && el.querySelector && el.querySelector('.viewport')) || null;

function paintJump(vp) {
  const st = JUMPS.get(vp);
  if (!st) return;
  const s = slot(st.key);
  const gap = vp.scrollHeight - vp.clientHeight - vp.scrollTop;
  if (gap <= FAR_PX) s.unread = 0;
  const dock = st.dockEl && st.dockEl.isConnected ? st.dockEl : null;
  if (!dock) return;
  let btn = dock.querySelector(':scope > .jump-latest');
  const show = gap > FAR_PX && (s.unread > 0 || (st.always && gap > vp.clientHeight * 0.6));
  if (!show) { if (btn) btn.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jump-latest';
    btn.addEventListener('click', () => {
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      vp.scrollTo({ top: vp.scrollHeight, behavior: reduce ? 'instant' : 'smooth' });
      slot(st.key).unread = 0;
    });
    dock.appendChild(btn);
  }
  const n = s.unread;
  btn.setAttribute('aria-label', n ? `${n} new message${n === 1 ? '' : 's'}. Jump to the latest` : 'Jump to the latest message');
  btn.innerHTML = `${n ? `<span class="jl-n">${n > 99 ? '99+' : n}</span>` : ''}${icon('arrowDown', 16)}`;
}

/**
 * Keep the jump-to-latest pill true after a paint. `added` is noteArrivals' count: when the
 * reader is scrolled back, those become unread; when they are at the end, nothing is. `always`
 * shows the pill whenever the reader is far back (the full chat), not only for unread rows.
 */
export function syncJump(anchor, key, { dock = null, added = 0, always = false } = {}) {
  const vp = vpOf(anchor);
  if (!vp) return;
  let st = JUMPS.get(vp);
  if (!st) {
    st = { key, always, dockEl: dock };
    JUMPS.set(vp, st);
    let raf = 0;
    vp.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; paintJump(vp); });
    }, { passive: true });
  }
  st.key = key; st.always = always; st.dockEl = dock;
  const s = slot(key);
  const gap = vp.scrollHeight - vp.clientHeight - vp.scrollTop;
  if (added > 0 && gap > FAR_PX) s.unread += added;
  paintJump(vp);
}

/** Test seam: forget every thread. */
export function __resetChatLive() { THREADS.clear(); }
