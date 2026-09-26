/* Progress: "What works for you" (goals and eating plan, A2, 2026-09-25).
 *
 * Up to two honest, non-causal lines from the athlete's own days: how their check-in read on days
 * a meal behaviour happened, against days it did not. The rules (thresholds, polarity, wording)
 * live in what-works-model.js. Lazy: screens/progress.js is in the boot graph and draws this into
 * #ww-slot once it lands. Athletes only; a guardian, coach or trainer never sees it. Deterministic
 * text the app writes, never signed as Nia.
 */
import { S } from './state.js';
import { esc } from './components.js';
import { icon } from './icons.js';
import { slotShare } from './weekly-focus-model.js';
import { findPatterns, topInsights, insightText, MIN_DAYS } from './what-works-model.js';
import { isAthleteView, teachCtx, historyFacts, askedFields, titleOf } from './weekly-focus.js';

/** The lines to show ([] for none) and how many qualifying days there are so far. */
export function worksView() {
  if (!isAthleteView()) return { lines: [], eligible: 0 };
  const ctx = teachCtx();
  const { eligible, patterns } = findPatterns(historyFacts(ctx), { ...ctx, fields: askedFields() });
  const numbers = !!S.planStyle.showMacros;
  const share = slotShare(ctx.target, ctx.order);
  return { eligible, lines: topInsights(patterns).map((p) => insightText(p, { numbers, share, titleOf })) };
}

export function worksHtml() {
  let v;
  try { v = worksView(); } catch { return ''; }
  if (!v.lines.length) {
    // Close, but not there yet: one quiet line so the section is not a surprise when it arrives.
    if (v.eligible >= 3 && v.eligible < MIN_DAYS) {
      return `<h2 class="eyebrow">What works for you</h2>
      <p class="ww-soon">Log your meals and your nightly check-in for ${MIN_DAYS} days, and the patterns in your own days show up here.</p>`;
    }
    return '';
  }
  return `<h2 class="eyebrow">What works for you</h2>
  <section class="card pad ww">
    ${v.lines.map((t) => `<div class="ww-row"><span class="ww-i" aria-hidden="true">${icon('target', 16)}</span><p>${esc(t)}</p></div>`).join('')}
    <p class="ww-note">From your own days. A pattern, not a promise.</p>
  </section>`;
}
