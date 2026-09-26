/* Plan > Why these numbers (goals and eating plan, A2, 2026-09-25).
 *
 * The athlete's real graded targets, explained: what each one is made of, how to eat it, and what
 * the other goals would mean. An Intuitive athlete gets "Why this plate" and not one figure. The
 * rules live in plan-why-model.js (tested in Node); this file reads the live day and draws.
 * Lazy (screens/index.js): nothing here is in the boot graph. Deterministic, never signed as Nia.
 */
import { S, RT, act, nutritionConfigForGoal, goalBodyweight, seasonPhase, phaseCalAdjust } from '../state.js';
import { DAY } from '../day.js';
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import { slotOrder } from '../plan-today-model.js';
import { plate } from '../plan-today.js';
import { explainTargets, compareLine } from '../plan-why-model.js';
import { PHASES } from '../season-phase.js';

/** The comparison's selected goal family, for this visit. Reset when the screen is left. */
let PICK = null;
/** A solo athlete's season save in flight, and its one-line result. */
let SEASON = { busy: false, note: '' };
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').slice(1).split('/')[0] !== 'plan-why') { PICK = null; SEASON = { busy: false, note: '' }; }
  });
}

/** The explanation of what this device grades today. */
export function whyModel() {
  const PS = S.planStyle;
  const p = RT.profile || {};
  const T = S.planTargets || {};
  const g = goalBodyweight();
  const goalKey = p.baseGoal || (RT.ob && RT.ob.goal) || null;
  const phase = seasonPhase();
  // A coach figure counts only when it IS the graded number: with no goal set, applyGoalToDay
  // grades the shipped defaults, and "your coach set these" over a number they did not set is
  // exactly the claim this screen exists to get right.
  const coachSet = {
    protein: Number(T.protein) > 0 && Math.round(Number(T.protein)) === DAY.proteinTarget,
    calories: Number(T.calories) > 0 && Math.round(Number(T.calories)) === DAY.calTarget,
  };
  return explainTargets({
    goalKey,
    bodyweight: g.known ? g.bw : null,
    defaultBw: g.bw,
    protein: DAY.proteinTarget,
    kcal: DAY.calTarget,
    coachSet,
    // A solo athlete's accepted suggestion (0253) is theirs, not a coach's.
    who: T.source === 'self' ? 'self' : S.coach.noun === 'trainer' ? 'trainer' : 'coach',
    minor: !!(S.consent && S.consent.minor),
    showMacros: !!PS.showMacros,
    showCalories: !!PS.showCalories,
    requiredMeals: slotOrder(RT.stdMeals).required.length,
    derive: (k, bw) => nutritionConfigForGoal(k, bw, null, phase),
    phase,
    phaseAdjust: phaseCalAdjust(goalKey, phase),
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
  <div class="pwy-seg" role="radiogroup" aria-label="Compare goals">
    ${M.compare.map((c) => `<button type="button" class="pw-sg${c === pick ? ' on' : ''}${c.mine ? ' mine' : ''}" role="radio" aria-checked="${c === pick ? 'true' : 'false'}" data-pw-goal="${esc(c.fam)}">${esc(c.label)}</button>`).join('')}
  </div>
  <div class="pw-cmp">
    <div class="pw-cmp-h"><b>${esc(compareLine(pick))}</b>${pick.mine ? '<span class="pw-mine">Your goal</span>' : ''}</div>
    <p class="pw-b">${esc(pick.means)}</p>
  </div>`;
}

const capFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
/* B: the season, in one line under the lead. Teal like the goal: it is context, not an action. */
function seasonHtml(M) {
  if (!M.season) return '';
  return `<p class="pw-season"><span class="pw-season-k">${esc(M.season.label)}</span>${esc(capFirst(M.season.text.replace(/^[^:]+:\s*/, '')))}</p>`;
}

/* B: a SOLO athlete sets their own season here (0252 set_my_season_phase). A team athlete's phase
   is the team's and a trainer's client has none, so neither ever sees this. */
function soloSeasonHtml() {
  if (!(RT.season && RT.season.canSetSelf) || S.coach.hasCoach) return '';
  const cur = seasonPhase();
  const opts = [...PHASES.map((ph) => ({ key: ph.key, label: ph.short })), { key: '', label: 'None' }];
  return `<h2 class="eyebrow">Your season</h2>
  <div class="pwy-seg pwy-season" role="radiogroup" aria-label="Your season">
    ${opts.map((o) => `<button type="button" class="pw-sg${(cur || '') === o.key ? ' on' : ''}" role="radio" aria-checked="${(cur || '') === o.key ? 'true' : 'false'}" data-pw-season="${esc(o.key)}"${SEASON.busy ? ' disabled' : ''}>${esc(o.label)}</button>`).join('')}
  </div>
  <p class="pw-b pw-season-note" role="status">${esc(SEASON.note || 'On a team, your coach sets this. On your own, you do.')}</p>`;
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
      ${seasonHtml(M)}
      ${body}
      ${soloSeasonHtml()}
      ${change}
    </div>
    `;
  },
  mount(root) {
    const box = root.querySelector('.pw');
    if (!box) return;
    box.addEventListener('click', async (e) => {
      const sb = e.target && e.target.closest ? e.target.closest('[data-pw-season]') : null;
      if (sb && !SEASON.busy) {
        SEASON = { busy: true, note: '' };
        window.__render();
        const ok = await act.setMySeasonPhase(sb.dataset.pwSeason || null);
        SEASON = { busy: false, note: ok ? '' : 'Could not save that. Check your connection and try again.' };
        window.__render();
        return;
      }
      const b = e.target && e.target.closest ? e.target.closest('[data-pw-goal]') : null;
      if (!b) return;
      PICK = b.dataset.pwGoal;
      window.__render();
    });
  },
};
