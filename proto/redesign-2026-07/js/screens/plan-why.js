/* Plan > Why these numbers (goals and eating plan, A2, 2026-09-25).
 *
 * The athlete's real graded targets, explained: what each one is made of, how to eat it, and what
 * the other goals would mean. An Intuitive athlete gets "Why this plate" and not one figure. The
 * rules live in plan-why-model.js (tested in Node); this file reads the live day and draws.
 * Lazy (screens/index.js): nothing here is in the boot graph. Deterministic, never signed as Nia.
 */
import { S, RT, nutritionConfigForGoal, goalBodyweight } from '../state.js';
import { DAY } from '../day.js';
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import { slotOrder } from '../plan-today-model.js';
import { plate } from '../plan-today.js';
import { explainTargets, compareLine } from '../plan-why-model.js';

/** The comparison's selected goal family, for this visit. Reset when the screen is left. */
let PICK = null;
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').slice(1).split('/')[0] !== 'plan-why') PICK = null;
  });
}

/** The explanation of what this device grades today. */
export function whyModel() {
  const PS = S.planStyle;
  const p = RT.profile || {};
  const T = S.planTargets || {};
  const g = goalBodyweight();
  // A coach figure counts only when it IS the graded number: with no goal set, applyGoalToDay
  // grades the shipped defaults, and "your coach set these" over a number they did not set is
  // exactly the claim this screen exists to get right.
  const coachSet = {
    protein: Number(T.protein) > 0 && Math.round(Number(T.protein)) === DAY.proteinTarget,
    calories: Number(T.calories) > 0 && Math.round(Number(T.calories)) === DAY.calTarget,
  };
  return explainTargets({
    goalKey: p.baseGoal || (RT.ob && RT.ob.goal) || null,
    bodyweight: g.known ? g.bw : null,
    defaultBw: g.bw,
    protein: DAY.proteinTarget,
    kcal: DAY.calTarget,
    coachSet,
    who: S.coach.noun === 'trainer' ? 'trainer' : 'coach',
    minor: !!(S.consent && S.consent.minor),
    showMacros: !!PS.showMacros,
    showCalories: !!PS.showCalories,
    requiredMeals: slotOrder(RT.stdMeals).required.length,
    derive: (k, bw) => nutritionConfigForGoal(k, bw, null),
  });
}

function figure(label, part) {
  if (!part) return '';
  return `<section class="pw-fig">
    <div class="pw-k">${esc(label)}</div>
    <div class="pw-v">${esc(part.value)}</div>
    <p class="pw-b">${esc(part.basis)}</p>
    ${part.perMeal ? `<p class="pw-m">${esc(part.perMeal)}</p>` : ''}
  </section>`;
}

function compareHtml(M) {
  if (!M.compare) return '';
  const pick = M.compare.find((c) => c.fam === (PICK || M.family)) || M.compare.find((c) => c.mine) || M.compare[M.compare.length - 1];
  return `<h2 class="eyebrow">What each goal would mean</h2>
  <div class="pw-seg" role="radiogroup" aria-label="Compare goals">
    ${M.compare.map((c) => `<button type="button" class="pw-sg${c === pick ? ' on' : ''}${c.mine ? ' mine' : ''}" role="radio" aria-checked="${c === pick ? 'true' : 'false'}" data-pw-goal="${esc(c.fam)}">${esc(c.label)}</button>`).join('')}
  </div>
  <div class="pw-cmp">
    <div class="pw-cmp-h"><b>${esc(compareLine(pick))}</b>${pick.mine ? '<span class="pw-mine">Your goal</span>' : ''}</div>
    <p class="pw-b">${esc(pick.means)}</p>
  </div>`;
}

function plateHtml(M) {
  const dots = ['pr', 'cb', 'vg'];
  // The same plate Plan > Today draws, then its three parts explained for the goal.
  return `<div class="pw-plate-art">${plate()}</div>
  <ul class="pt-rules pw-plate">${M.plate.map((t, i) => `<li><i class="${dots[i]}"></i>${esc(t)}</li>`).join('')}</ul>`;
}

export default {
  tab: 'plan',
  render() {
    const M = whyModel();
    const change = M.source !== 'coach'
      ? `<button type="button" class="pw-link" data-go="profile">Change your goal in your profile${icon('chevron', 13)}</button>` : '';
    const body = M.mode === 'plate'
      ? `${plateHtml(M)}
        <h2 class="eyebrow">How to eat it</h2>
        <p class="pw-how">${esc(M.how)}</p>`
      : `${figure('Protein a day', M.protein)}
        ${figure('Calories a day', M.calories)}
        <h2 class="eyebrow">How to eat it</h2>
        <p class="pw-how">${esc(M.how)}</p>
        ${compareHtml(M)}`;
    return `
    ${backHead(M.title, null, 'plan')}
    <div class="pw">
      <p class="pw-lead">${esc(M.lead)}</p>
      ${body}
      ${change}
    </div>
    `;
  },
  mount(root) {
    const box = root.querySelector('.pw');
    if (!box) return;
    box.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-pw-goal]') : null;
      if (!b) return;
      PICK = b.dataset.pwGoal;
      window.__render();
    });
  },
};
