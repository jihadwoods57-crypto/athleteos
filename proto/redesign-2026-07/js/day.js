// Real per-account day state + the honest score, computed from real logged data (not demo
// constants). The formulas are a byte-exact port of the RN engine (src/core/scoring.ts +
// scoringProfiles.ts + commitment.ts) — proven equal by a parity test (scripts/score-parity).
//
// The pure compute functions (computeComponents / scoreFor / tierFor) touch no browser APIs so
// they can be imported by the Node parity test. All Supabase / localStorage I/O is inside
// functions guarded for a non-browser environment.

/* ---------------- engine constants (ported exactly) ---------------- */
export const PROFILE_WEIGHTS = {
  athlete: { nutrition: 0.50, recovery: 0.25, commitment: 0.15, checkin: 0.10 },
  general: { nutrition: 0.55, recovery: 0.20, commitment: 0.15, checkin: 0.10 },
  gain:    { nutrition: 0.55, recovery: 0.25, commitment: 0.10, checkin: 0.10 },
};
const MEAL_KEYS = ['breakfast', 'lunch', 'snack', 'dinner'];
const DEADLINE = { breakfast: 570, lunch: 840, snack: 1020, dinner: 1230 }; // minutes from midnight
const QUICK_G = [18, 30, 22]; // Greek yogurt / protein shake / turkey roll-ups
const PROTEIN_TARGET = 180;
const CI_KEYS = ['energy', 'recovery', 'sleep', 'confidence', 'soreness', 'motivation'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function withinTrailingWeek(dateStr, todayStr) {
  if (!dateStr || !todayStr) return false;
  const a = new Date(dateStr + 'T00:00:00');
  const b = new Date(todayStr + 'T00:00:00');
  const diff = (b - a) / 86400000;
  return diff >= 0 && diff <= 6;
}

function effectiveMeals(day) {
  let n = 0;
  for (const k of MEAL_KEYS) {
    if (!day.meals || !day.meals[k]) continue;
    const at = day.mealLoggedAt && day.mealLoggedAt[k];
    n += (at == null || at <= DEADLINE[k]) ? 1 : 0.5; // late meal earns half (matches effectiveMealsLogged)
  }
  return n;
}

function proteinToday(day) {
  let p = 0;
  for (const k of MEAL_KEYS) {
    // Evidence rule: a logged slot with no saved plate earns 0 protein (matches mealSlotMacros).
    if (day.meals && day.meals[k] && day.slotMacros && day.slotMacros[k]) p += day.slotMacros[k].protein || 0;
  }
  const q = day.quickAdded || [];
  for (let i = 0; i < q.length; i++) if (q[i]) p += QUICK_G[i] || 0;
  return p;
}

function nutritionScore(day) {
  // athlete profile branch of profileNutritionScore (general/gain add calorie adherence later).
  const pt = day.proteinTarget > 0 ? day.proteinTarget : PROTEIN_TARGET;
  const proteinFrac = pt > 0 ? Math.min(proteinToday(day), pt) / pt : 0;
  const mealsFrac = clamp(effectiveMeals(day) / 4, 0, 1);
  return Math.min(100, Math.round(proteinFrac * 65 + mealsFrac * 35));
}

function recoveryParts(day) {
  if (day.ciSubmitted) {
    let sum = 0, count = 0;
    for (const key of CI_KEYS) {
      if (!(day.ciConfig && day.ciConfig[key])) continue;
      const raw = day.ci ? day.ci[key] : undefined;
      if (typeof raw !== 'number' || !isFinite(raw)) continue;
      sum += key === 'soreness' ? 10 - raw : raw; // soreness has inverse polarity
      count++;
    }
    if (count > 0) return { score: clamp(Math.round((sum / (count * 10)) * 100), 0, 100), isReal: true };
    return { score: 86, isReal: false };
  }
  if (day.ciLast && withinTrailingWeek(day.ciLast.date, day.date)) {
    return { score: Math.round(day.ciLast.recovery), isReal: true }; // weekly carry
  }
  return { score: 86, isReal: false }; // display fallback; contributes 0
}

function commitmentScore(ans) { return ans === 'yes' ? 100 : ans === 'partial' ? 60 : 0; }
function checkinReal(day) { return !!(day.ciSubmitted || (day.ciLast && withinTrailingWeek(day.ciLast.date, day.date))); }

/** The four sub-scores. `recoveryContribution` is what the total uses (0 unless a real check-in backs it). */
export function computeComponents(day) {
  const rec = recoveryParts(day);
  return {
    nutrition: nutritionScore(day),
    recovery: rec.score,
    recoveryContribution: rec.isReal ? rec.score : 0,
    commitment: commitmentScore(day.dailyCommitment),
    checkin: checkinReal(day) ? 100 : 0,
  };
}

export function scoreFor(day) {
  const w = PROFILE_WEIGHTS[day.scoringProfile] || PROFILE_WEIGHTS.athlete;
  const c = computeComponents(day);
  return clamp(Math.round(w.nutrition * c.nutrition + w.recovery * c.recoveryContribution + w.commitment * c.commitment + w.checkin * c.checkin), 0, 100);
}

export function gradeFor(s) { return s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'F'; }

/* ---------------- evidence ceiling (mirror of the server trigger) ---------------- */
// Keep the client score honest so the server clamp never has to silently lower it.
export function evidenceCeiling(day) {
  const hasNutrition = MEAL_KEYS.some((k) => day.meals && day.meals[k]) ||
    (day.slotMacros && Object.keys(day.slotMacros).length > 0);
  const hasCheckin = checkinReal(day);
  const hasCommitment = day.dailyCommitment === 'yes' || day.dailyCommitment === 'partial' || day.dailyCommitment === 'no';
  return (hasNutrition ? 55 : 0) + (hasCheckin ? 35 : 0) + (hasCommitment ? 15 : 0);
}
export function clampedScore(day) { return Math.min(scoreFor(day), evidenceCeiling(day)); }
