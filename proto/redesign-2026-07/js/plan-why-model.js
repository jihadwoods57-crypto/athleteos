/* Why these numbers, the pure half (goals and eating plan, A2, 2026-09-25).
 *
 * Plan > Today's "Why these numbers" used to open the goal panel, which listed the numbers again.
 * This explains them: the athlete's REAL graded targets (DAY.proteinTarget / DAY.calTarget), what
 * each one is made of, how to eat it, and what the other goals would mean. Deterministic text the
 * app writes, never signed as Nia.
 *
 * THE RULES THIS FILE HOLDS
 *  1. ONE DERIVATION. Every number comes from the caller's `derive` (state.js nutritionConfigForGoal,
 *     the same function that sets the graded targets), and every "per pound" figure is read back
 *     off the real target and the real bodyweight, so the explanation can never quote a factor
 *     the math did not use. plan-why.test.mjs pins the parity.
 *  2. COACH WINS. A coach-set figure says so and keeps only the general why; the goal comparison
 *     disappears, because the goal no longer decides the number.
 *  3. MINORS. No bodyweight figure, no "per pound", no weight-change words, no goal comparison
 *     (its whole content is weight goals): "for your body and training".
 *  4. INTUITIVE. "Why this plate": not one figure; the plate explained for the goal.
 */
import { perMealShare } from './plan-today-model.js';
import { whyPhaseLine } from './season-phase.js';

/** Goal families, tolerant of every stored spelling. null = no goal set. */
export function goalFamily(key) {
  const k = String(key || '').toLowerCase();
  if (!k) return null;
  if (k === 'gain' || k === 'build' || k === 'gain_muscle' || k === 'gain_weight') return 'gain';
  if (k === 'lose' || k === 'lose_fat') return 'lose';
  if (k === 'maintain' || k === 'health') return 'maintain';
  return 'perform';
}

/** The comparison's four goals, in the order the control shows them, with the key each one is
 *  stored as (what `derive` is called with). */
export const GOALS = [
  { fam: 'maintain', key: 'maintain', label: 'Maintain', means: 'Protein to keep your muscle fed, calories near what you burn.' },
  { fam: 'lose', key: 'lose', label: 'Lean out', means: 'Protein held high, calories a bit under what you burn.' },
  { fam: 'gain', key: 'gain', label: 'Gain', means: 'Protein scaled to your size, calories above what you burn.' },
  { fam: 'perform', key: 'performance', label: 'Perform', means: 'A fixed performance standard, set by training load.' },
];

const GOAL_WORD = { gain: 'gaining', lose: 'losing fat', maintain: 'maintaining', perform: 'performing' };

const round1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => Number(n).toLocaleString('en-US');
const perLb = (v) => { const r = round1(v); return Number.isInteger(r) ? String(r) : r.toFixed(1); };

/** How to eat it: one or two plain sentences per goal. The minor's is the same for every goal. */
export const HOW_TO_EAT = {
  gain: 'Eat every meal and add a real snack. Building comes from never skipping, not from one huge plate.',
  lose: 'Protein and vegetables first at every meal, carbs mostly around training. You stay full while the day comes in a little lighter.',
  maintain: 'Keep a steady rhythm: similar protein at each meal, and carbs that rise and fall with how hard you train.',
  perform: 'Protein at every meal, and carbs around training: before hard sessions and after them.',
  minor: 'Eat every meal with protein in it, and more carbs on hard training days. Enough is the goal, never less.',
  none: 'Protein at every meal and carbs around training. Pick a goal and the numbers fit you.',
};

/** The plate, explained for the goal (Intuitive). No figures anywhere. */
const PLATE = {
  gain: ['A palm of protein feeds new muscle at every meal.', 'Two fists of carbs after hard training: building needs energy to spare.', 'Half the plate vegetables, and never skip the plate itself.'],
  lose: ['A palm of protein keeps you full and protects your muscle.', 'One fist of carbs, two only after hard training.', 'Half the plate vegetables, so every meal fills you up.'],
  maintain: ['A palm of protein keeps your muscle fed.', 'One fist of carbs, two after hard training.', 'Half the plate vegetables for fiber and steady energy.'],
  perform: ['A palm of protein repairs the work from training.', 'A fist of carbs fuels practice, two after hard sessions.', 'Half the plate vegetables for recovery and steady energy.'],
};
const PLATE_HOW = {
  gain: 'Build every plate like this, and add a snack on hard days.',
  lose: 'Build every plate like this, and let hunger and fullness set the portions.',
  maintain: 'Build every plate like this, and keep the meals on a steady rhythm.',
  perform: 'Build every plate like this, and put the extra carbs around training.',
};

/**
 * The whole explanation. Every input is plain data:
 *   goalKey       RT.profile.baseGoal (or the onboarding scratch); null = none
 *   bodyweight    the bodyweight the targets were derived from (applyGoalToDay's resolution), or null
 *   defaultBw     what the math used when there was none (state.js GOAL_BW_DEFAULT)
 *   protein, kcal the graded targets (DAY.proteinTarget / DAY.calTarget)
 *   coachSet      { protein, calories } true where a coach or trainer set that figure
 *   who           'coach' | 'trainer' | 'self' (a solo athlete who accepted a suggested change, 0253)
 *   minor         a PROVABLE minor (unknown age is an adult, 0050)
 *   showMacros, showCalories   the plan style's surface flags
 *   requiredMeals how many required meal slots the day has (plan-today-model slotOrder)
 *   derive        (goalKey, bodyweight) => { proteinTarget, calTarget }: nutritionConfigForGoal
 *   phase         the season phase that applies (state.js seasonPhase), or null (B)
 *   phaseAdjust   state.js phaseCalAdjust(goal, phase): what the phase moved the calories by
 */
export function explainTargets({
  goalKey = null, bodyweight = null, defaultBw = 171, protein = 0, kcal = 0,
  coachSet = {}, who = 'coach', minor = false, showMacros = true, showCalories = true,
  requiredMeals = 3, derive = null, phase = null, phaseAdjust = 0,
} = {}) {
  const fam = goalFamily(goalKey);
  const coach = { protein: !!coachSet.protein, calories: !!coachSet.calories };
  const anyCoach = coach.protein || coach.calories;
  const source = anyCoach ? 'coach' : fam ? 'goal' : 'default';
  const numbers = !!(showMacros || showCalories);
  const bwKnown = Number(bodyweight) > 0;
  const bw = bwKnown ? Number(bodyweight) : defaultBw;
  const goalWord = fam ? GOAL_WORD[fam] : null;

  // The lead names exactly what the coach set (review 2026-09-26): "these numbers" only when both
  // are theirs. Each figure then explains itself from its own real source.
  const coachWhat = !numbers ? 'your plan'
    : coach.protein && coach.calories ? 'these numbers'
      : coach.protein ? 'your protein target' : 'your calorie target';
  const lead = source === 'coach' ? (who === 'self' ? `You set ${coachWhat} from a suggested change.` : `Your ${who} set ${coachWhat}.`)
    : minor ? 'Set for your body and training.'
      : fam ? `From your goal: ${goalWord}.`
        : "OnStandard's starting targets.";

  if (!numbers) {
    const pf = minor || !fam ? 'perform' : fam;
    return {
      mode: 'plate', source, family: fam, lead,
      title: 'Why this plate',
      plate: PLATE[pf].slice(),
      how: minor ? HOW_TO_EAT.minor : PLATE_HOW[pf],
      compare: null,
      season: whyPhaseLine({ phase, mode: 'plate' }),
    };
  }

  // The 1500 calorie safety floor (state.js goalDerivedTargets): the per-pound factor, read off a
  // size no floor touches, would have landed under it, so the number is the floor.
  const calFloor = (k, w) => {
    if (k !== 1500 || !derive) return false;
    const f = derive(goalKey, 1000).calTarget / 1000;
    return f > 0 && Math.round((w * f) / 50) * 50 < 1500;
  };

  // PROTEIN. The per-pound figure is read back off the REAL target, so it is the factor the math
  // used (the 5g rounding moves it by a hair, never by a different rule).
  let proteinPart = null;
  if (showMacros && protein > 0) {
    let basis;
    // The lead already names what the coach set, so the figure explains itself, not its author.
    if (coach.protein) basis = 'Protein repairs training and keeps muscle fed, so it counts at every meal.';
    else if (minor) basis = 'Enough protein to repair training, set for your body and training.';
    else if (fam === 'gain' || fam === 'lose' || fam === 'maintain') {
      // The 80g safety floor: the per-pound factor (read off a size no floor touches) would have
      // landed under it, so the number is the floor, and saying "per pound" would be untrue.
      const factor = derive ? derive(goalKey, 1000).proteinTarget / 1000 : 0;
      const floor = protein === 80 && factor > 0 && Math.round((bw * factor) / 5) * 5 < 80;
      basis = floor ? "OnStandard's minimum. It sits above the per-pound math for your size."
        : bwKnown ? `About ${perLb(protein / bw)}g per pound of your ${fmt(Math.round(bw))} lb, for ${goalWord}.`
          : `About ${perLb(protein / bw)}g per pound, for ${goalWord}. It uses ${fmt(bw)} lb until you log your weight.`;
    } else if (fam === 'perform') basis = 'The performance standard: enough to repair hard training, set by the work you do.';
    else basis = "OnStandard's starting protein for athletes. Pick a goal and it fits you.";
    const per = requiredMeals >= 2 ? perMealShare(protein, requiredMeals) : null;
    proteinPart = {
      value: `${fmt(protein)}g`,
      basis,
      perMeal: per ? `About ${per}g at each of your ${requiredMeals} meals.` : null,
    };
  }

  // CALORIES, and what they mean for this goal.
  let calPart = null;
  if (showCalories && kcal > 0) {
    let basis;
    if (coach.calories) basis = 'Calories are the fuel for training and recovery.';
    else if (minor) basis = 'Enough fuel for your body and training. Running short costs you energy and recovery.';
    else if ((fam === 'gain' || fam === 'lose' || fam === 'maintain') && calFloor(kcal, bw)) {
      basis = "OnStandard's minimum. It sits above the per-pound math for your size, so you always fuel enough to train.";
    } else if (fam === 'gain' || fam === 'lose' || fam === 'maintain') {
      const per = `About ${fmt(Math.round(kcal / bw))} calories per pound`;
      basis = fam === 'gain' ? `${per}: more than you burn, so training has material to build with.`
        : fam === 'lose' ? `${per}: a bit under what you burn, with protein held high so the change comes from fat.`
          : `${per}: close to what you burn, so you hold steady while you train.`;
    } else if (fam === 'perform') basis = 'The performance standard: enough fuel for practice and recovery, set by training load.';
    else basis = "OnStandard's starting fuel target for training days.";
    calPart = { value: fmt(kcal), basis };
  }

  // THE COMPARISON: goal-derived targets with a goal actually set (no goal = the shipped defaults,
  // which no goal chose), adults only, from the athlete's own inputs. Any coach figure hides it.
  let compare = null;
  if (source === 'goal' && !minor && typeof derive === 'function') {
    compare = GOALS.map((g) => {
      const d = derive(g.key, bw);
      return {
        fam: g.fam, label: g.label, means: g.means, mine: fam === g.fam,
        protein: showMacros ? d.proteinTarget : null,
        kcal: showCalories ? d.calTarget : null,
      };
    });
  }

  return {
    mode: 'numbers', source, family: fam, lead,
    title: 'Why these numbers',
    protein: proteinPart,
    calories: calPart,
    how: minor ? HOW_TO_EAT.minor : fam ? HOW_TO_EAT[fam] : HOW_TO_EAT.none,
    compare,
    // B: what the season does to these numbers, in one line. Goal-derived calories only; a coach's
    // (or an accepted) number says the season leaves it alone. No phase = no line = today.
    season: whyPhaseLine({ phase, family: fam, coachSet: coach.calories, who, minor, numbers: showCalories, adjust: phaseAdjust }),
  };
}

/** One goal's figures in the comparison, as the line under the control. */
export function compareLine(c) {
  const bits = [];
  if (c.protein != null) bits.push(`${fmt(c.protein)}g protein`);
  if (c.kcal != null) bits.push(`${fmt(c.kcal)} cal`);
  return bits.join(' · ');
}
