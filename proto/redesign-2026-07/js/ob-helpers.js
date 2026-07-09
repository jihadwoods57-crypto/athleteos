/* Pure onboarding helpers — no DOM, no state, no imports. Unit-tested from
   src/core/obHelpers.test.ts (same proto-ESM import pattern as scoreParity). */

export const TOS_VERSION = '2026-07-09';

/** Validate MM/DD/YYYY parts into 'YYYY-MM-DD', or null. Real calendar dates only. */
export function dobFromParts(mm, dd, yyyy) {
  const m = parseInt(mm, 10), d = parseInt(dd, 10), y = parseInt(yyyy, 10);
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) return null;
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Whole-year age on todayISO. Both args 'YYYY-MM-DD'. Null-safe. */
export function ageOn(dobISO, todayISO) {
  if (!dobISO || !todayISO) return null;
  const [y, m, d] = dobISO.split('-').map(Number);
  const [ty, tm, td] = todayISO.split('-').map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return age;
}

/** 3-band strength: floor is 8 chars; +1 for 3+ character classes; +1 for 12+ length. */
export function passwordStrength(pw) {
  const p = pw || '';
  if (p.length < 8) return { ok: false, score: 0, label: 'Too short' };
  let variety = 0;
  if (/[a-z]/.test(p)) variety++;
  if (/[A-Z]/.test(p)) variety++;
  if (/[0-9]/.test(p)) variety++;
  if (/[^A-Za-z0-9]/.test(p)) variety++;
  const score = 1 + (variety >= 3 ? 1 : 0) + (p.length >= 12 ? 1 : 0);
  return { ok: true, score, label: ['Too short', 'Weak', 'Good', 'Strong'][score] };
}

/* Goal → emphasis copy. Athlete goals (gain/lose/maintain/perform) + client goals
   (build/health). Unknown goals fall back to maintain — never a blank standard. */
const GOAL_EMPHASIS = {
  gain:     'Protein first — every meal moves the calorie floor.',
  lose:     'Hydration and honest portions carry this. Keep protein high.',
  maintain: 'Consistency over everything. Same standard, every day.',
  perform:  'Fuel training, then recover hard — the check-ins are where you win.',
  build:    'Protein first — never under-fueled, every meal counts.',
  health:   'Small meals logged honestly. Consistency is the whole game.',
};
const MEAL_WORD = { 2: 'Two', 3: 'Three', 4: 'Four' };

/** The solo standard for a goal: requirement rows + focus line. `profile` relabels the
    component weights ('athlete' 50/25/15/10 · 'general' 55/20/15/10) — labels only; the
    scoring engine itself is untouched (DECISION-MEMO D3). */
export function standardForGoal(goal, mealsPerDay, profile = 'athlete') {
  const meals = Math.min(4, Math.max(2, Math.round(mealsPerDay || 3)));
  const W = profile === 'general'
    ? { n: 55, r: 20, c: 15, w: 10 }
    : { n: 50, r: 25, c: 15, w: 10 };
  return {
    meals,
    focus: GOAL_EMPHASIS[goal] || GOAL_EMPHASIS.maintain,
    rows: [
      ['utensils', `${MEAL_WORD[meals]} meals, photo proof`, `Nutrition · ${W.n}% of your score`],
      ['moon', 'Recovery check-in before bed', `Recovery · ${W.r}%`],
      ['check', 'One honest commitment tap', `Commitment · ${W.c}%`],
      ['clipboard', 'Weekly check-in on Sundays', `Check-in · ${W.w}%`],
      ['scale', 'Weight Mon / Wed / Fri', 'Season trend · not scored'],
    ],
  };
}
