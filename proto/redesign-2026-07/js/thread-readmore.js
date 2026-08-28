/* "Read more" on a long AI message — the ONE implementation, shared by every thread renderer.
 *
 * WHY THIS EXISTS AS A MODULE. The clamp was written inside meal.js and stayed there, but four
 * screens render `.msg.ai` bubbles: the meal thread (meal.js), the season-long Nutrition chat
 * (nutrition-chat.js), the coach's view of an athlete's thread (coach.js) and the trust thread
 * (trust.js). Only the first one clamped. That is not a cosmetic gap: composeOpenerText in
 * supabase/functions/_shared/meal-opener.ts is WRITTEN against this control — its own header
 * says "the client clamps anything past the core with a Read more", and it deliberately packs
 * history, timing and the uncertainty line after the core on that promise, up to the 1000-char
 * ceiling meal_comments allows. On the three screens without the clamp, the athlete got the
 * whole thousand characters as one wall.
 *
 * The rules, unchanged from the meal thread where they were tuned:
 *   - only long bubbles (< 320 chars is a text, not a wall)
 *   - never a typing row, never a bubble holding a control or a photo (clipping a control
 *     breaks it, and a clamped image is just a cropped image)
 *   - a TOGGLE, not a one-way door (founder 2026-08-06): expanding used to delete the control,
 *     so a five-paragraph read stayed open forever with no way back
 *   - state keyed on the text's own head, so an expansion survives every repaint
 *
 * The caller owns the Set, which is what makes the state per-screen and repaint-proof.
 */

/** Bubbles shorter than this are a text message, not a wall. */
const MIN_CHARS = 320;

/**
 * Clamp long AI bubbles inside `threadEl` and give each one a Read more / Read less toggle.
 *
 * @param {Element} threadEl   the repainted thread container
 * @param {Set<string>} expanded  caller-owned expansion state, keyed on each bubble's text head
 */
export function wireReadMore(threadEl, expanded) {
  if (!threadEl || !threadEl.querySelectorAll) return;
  const open = expanded instanceof Set ? expanded : new Set();
  threadEl.querySelectorAll('.msg.ai .bubble').forEach((b) => {
    // Already wired this paint (a caller that wires twice must not nest clamps).
    if (b.querySelector(':scope > .bt-clamp')) return;
    if (b.closest('.typing') || b.closest('#ai-typing')) return;
    if (b.querySelector('.fq-chips, img, .chat-photo, button, input, textarea, select, a')) return;
    const t = b.textContent || '';
    if (t.length < MIN_CHARS) return;
    const key = t.slice(0, 64);
    // Clamp an inner wrapper, not the padded bubble itself — -webkit-line-clamp on a padded box
    // lets a partial fifth line bleed into the padding.
    const inner = document.createElement('div');
    inner.className = 'bt-clamp';
    while (b.firstChild) inner.appendChild(b.firstChild);
    b.appendChild(inner);
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'read-more';
    b.after(more);
    const sync = () => {
      const isOpen = open.has(key);
      inner.classList.toggle('bt-clamp', !isOpen);
      more.textContent = isOpen ? 'Read less' : 'Read more';
      more.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    };
    more.addEventListener('click', () => {
      if (open.has(key)) open.delete(key); else open.add(key);
      sync();
    });
    sync();
  });
}
