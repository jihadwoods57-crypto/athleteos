/* iMessage tapbacks — press and hold a message to react to it.
 *
 * WHY. Both meal threads used to carry a permanent row of four emoji buttons sitting between the
 * last message and the composer, on the coach side TWICE (a `.rx-strip` above the quick actions
 * and a `.qa-row` below them). Reactions are worth keeping — a coach watching sixty athletes
 * cannot write sixty comments, and "no reply" is indistinguishable from "not seen" — but a
 * permanently parked control panel is not how a messaging app asks for one. Every real thread the
 * athlete has ever used hides this behind a long press. So does this one now.
 *
 * WHAT IT IS NOT. A true iMessage tapback attaches to ONE message. `meal_comments` has no column
 * pointing a reaction at another comment (0046/0049 store reactions as meal-level rows with
 * kind='reaction'), so the reaction this posts is still about the MEAL, exactly as before — the
 * gesture changed, the data did not. Giving reactions a target is a migration, not a UI change,
 * and inventing one here would have written rows nothing else in the app knows how to read.
 *
 * The picker is appended to <body> and positioned fixed on purpose: #view is replaced wholesale on
 * every render, so a picker parented inside the thread would vanish mid-gesture on any repaint.
 */

const LONG_PRESS_MS = 420;
/* Past this the finger is scrolling the thread, not holding a message. */
const SLOP_PX = 10;

let openPicker = null;

/** Tear down whatever picker is up. Safe to call when there isn't one. */
export function closeTapback() {
  if (!openPicker) return;
  const { el, cleanup } = openPicker;
  openPicker = null;
  try { cleanup(); } catch { /* listeners already gone with the node */ }
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/* One entry per persistent root: the live config, so a re-mount swaps callbacks instead of
   stacking another set of listeners. See wireTapback's header for why that matters here. */
const WIRED = new WeakMap();

/**
 * Wire long-press-to-react onto a screen's threads.
 *
 * ATTACHED TO THE PERSISTENT ROOT, NOT THE THREAD. `#view` is rebuilt wholesale on every
 * `__render()`, and both meal screens re-render freely — a participant name resolving, a comment
 * landing, the athlete correcting a macro. Wiring the `.thread` element itself therefore worked
 * only until the next repaint, and mount()'s re-run does not close that window: it re-attaches at
 * the END of an async function that first awaits a network fetch, so there is a real interval
 * where a long press does nothing. This was caught by pressing after a scroll — exactly the order
 * a person does it in. So the listeners live on `root`, which the router never replaces, and the
 * gesture is scoped by `closest(scope)` at press time against whatever is currently painted.
 *
 * Re-entrant by design: calling it again for the same root REPLACES the config (`mine`/`onReact`
 * close over the mount's fetched comments, so the newest mount must win) and adds no listeners.
 *
 * @param {object}   o
 * @param {Element}  o.root     the persistent screen root the router does not replace
 * @param {string}   o.scope    selector the pressed bubble must sit inside. Pass something UNIQUE
 *                              to the screen (an id, not '.thread' — five other screens render
 *                              one): the listeners outlive the screen, so a loose scope would let
 *                              a press on an unrelated thread fire the last screen's handler.
 * @param {string[]} o.emoji    the reaction set, in order
 * @param {Function} o.mine     () => Set<string> of emoji this user has already sent
 * @param {Function} o.onReact  async (emoji) => void — post/remove; toggling is the caller's job
 * @returns {Function} detach
 */
export function wireTapback({ root, scope = '.thread', emoji, mine, onReact }) {
  if (!root || typeof document === 'undefined') return () => {};
  const set = Array.isArray(emoji) ? emoji : [];
  if (!set.length) return () => {};

  const prior = WIRED.get(root);
  if (prior) {
    prior.cfg = { scope, emoji: set, mine, onReact };
    return prior.detach;
  }
  const live = { cfg: { scope, emoji: set, mine, onReact }, detach: () => {} };
  WIRED.set(root, live);

  let timer = null;
  let start = null;      // { x, y, bubble }

  const cancelPress = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (start && start.bubble) start.bubble.classList.remove('pressing');
    start = null;
  };

  const open = (bubble) => {
    // One overlay at a time (DESIGN.md): a long-press on a bubble the tour or another overlay is
    // sitting over must not stack a reaction picker on top of it.
    if (document.querySelector('.tour, .lockstamp, .imgview, .memsheet')) return;
    closeTapback();
    const { emoji: emojiNow, mine: mineNow, onReact: reactNow } = live.cfg;
    const already = (() => { try { return mineNow ? mineNow() : new Set(); } catch { return new Set(); } })();
    const el = document.createElement('div');
    el.className = 'tapback';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', 'React to this message');
    // Built node-by-node rather than with innerHTML. The emoji set is a frozen module constant
    // today (meal-intel.js REACTION_EMOJI), but this is a generic helper taking a caller's array,
    // and a string template here would be the seam where that stops being true quietly.
    for (const e of emojiNow) {
      const on = already.has(e);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('data-tb', e);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `React ${e}`);
      if (on) btn.classList.add('on');
      btn.textContent = e;
      el.appendChild(btn);
    }
    document.body.appendChild(el);

    // Anchor above the bubble, clamped into the viewport on both axes so a reaction on the first
    // or last message in a thread is never half off-screen.
    const place = () => {
      const b = bubble.getBoundingClientRect();
      const p = el.getBoundingClientRect();
      const pad = 8;
      let top = b.top - p.height - 6;
      if (top < pad) top = Math.min(b.bottom + 6, window.innerHeight - p.height - pad);
      let left = b.left + (b.width - p.width) / 2;
      left = Math.max(pad, Math.min(left, window.innerWidth - p.width - pad));
      el.style.top = `${Math.max(pad, top)}px`;
      el.style.left = `${left}px`;
    };
    place();

    const onPick = async (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-tb]') : null;
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      const pick = btn.getAttribute('data-tb');
      closeTapback();
      if (reactNow) await reactNow(pick);
    };
    const onAway = (ev) => { if (!el.contains(ev.target)) closeTapback(); };
    const onKey = (ev) => { if (ev.key === 'Escape') closeTapback(); };

    /* THE PICKER FOLLOWS ITS BUBBLE; IT DOES NOT DIE ON SCROLL.
       This closed on any scroll event, which looked correct and was not: the app sets
       `scroll-behavior: smooth` (app.css), so a thread the user has just flicked is STILL
       animating when their finger settles and the long press completes. The picker opened and a
       residual scroll frame killed it in the same breath — press and hold did nothing, which is
       exactly what it looked like in testing. Re-anchoring instead is also the native behaviour:
       a tapback stays glued to the message it belongs to. It only gives up once that message has
       actually left the screen, which is the one case where staying would be nonsense. */
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (!openPicker || openPicker.el !== el) return;
        const b = bubble.getBoundingClientRect();
        if (b.bottom < 0 || b.top > window.innerHeight) { closeTapback(); return; }
        place();
      });
    };

    el.addEventListener('click', onPick);
    // Capture phase, and on the next frame: the same pointerup that ENDED the long press would
    // otherwise land here immediately and dismiss the picker before a finger could reach it.
    let armed = false;
    const arm = () => { armed = true; document.addEventListener('pointerdown', onAway, true); };
    const raf = requestAnimationFrame(arm);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);

    openPicker = {
      el,
      cleanup() {
        cancelAnimationFrame(raf);
        el.removeEventListener('click', onPick);
        if (armed) document.removeEventListener('pointerdown', onAway, true);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('scroll', onScroll, true);
        bubble.classList.remove('pressing');
      },
    };
  };

  const bubbleFrom = (target) => {
    const el = target && target.closest ? target.closest('.bubble') : null;
    // Bubbles that ARE a control (the clarifying-question form, the follow-up chips) own their own
    // taps; a long press that fires a reaction over an input the athlete is answering is a bug.
    if (!el || el.querySelector('input, textarea, button')) return null;
    // Scoped at press time against what is painted NOW — the thread element this bubble sits in
    // is very likely not the one that existed when these listeners were attached.
    if (!el.closest(live.cfg.scope)) return null;
    return root.contains(el) ? el : null;
  };

  const onDown = (ev) => {
    if (ev.button != null && ev.button !== 0) return;   // right-click has its own path below
    const bubble = bubbleFrom(ev.target);
    if (!bubble) return;
    start = { x: ev.clientX, y: ev.clientY, bubble };
    bubble.classList.add('pressing');
    timer = setTimeout(() => {
      timer = null;
      const b = start && start.bubble;
      cancelPress();
      if (b) open(b);
    }, LONG_PRESS_MS);
  };
  const onMove = (ev) => {
    if (!start) return;
    if (Math.abs(ev.clientX - start.x) > SLOP_PX || Math.abs(ev.clientY - start.y) > SLOP_PX) cancelPress();
  };
  // Desktop parity: right-click and double-click both open it, so the gesture is reachable
  // without a touchscreen (the proto is QA'd in a browser).
  const onContext = (ev) => {
    const bubble = bubbleFrom(ev.target);
    if (!bubble) return;
    ev.preventDefault();
    open(bubble);
  };

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', cancelPress);
  root.addEventListener('pointercancel', cancelPress);
  root.addEventListener('contextmenu', onContext);
  root.addEventListener('dblclick', onContext);

  live.detach = () => {
    cancelPress();
    closeTapback();
    WIRED.delete(root);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', cancelPress);
    root.removeEventListener('pointercancel', cancelPress);
    root.removeEventListener('contextmenu', onContext);
    root.removeEventListener('dblclick', onContext);
  };
  return live.detach;
}
