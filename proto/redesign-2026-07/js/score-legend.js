/* The legend behind "Score colors explained" (screens/score-explained.js).
 *
 * Founder 2026-09-09, after Cal AI's "Ring colors explained": one page that says what each ring
 * colour and each meal band MEANS. The page must never be able to disagree with the product, so
 * every range and label here is derived from score-band.js (the one tier ladder, the one pair
 * of meal floors) and meal-intel's qualityBand (the one band vocabulary). Nothing in this file
 * is a number typed by hand.
 *
 * Dependency-free apart from those two leaf modules, so it can be unit-tested in node with no
 * DOM and imported from any screen without closing a module cycle. */
import { TIERS, TIER_COLOR, tierRange, MEAL_QUALITY_GOOD, MEAL_QUALITY_OK, ON_STANDARD } from './score-band.js';
import { qualityBand } from './meal-intel.js';

/* What each tier means, in the athlete's words. Keyed by tier NAME so a reordered ladder still
   pairs the right sentence with the right tier; a tier with no sentence gets an empty one rather
   than a wrong one. */
const TIER_MEANING = {
  'OnStandard': 'Everything landed. This is the standard, met.',
  'Locked In': 'On standard. The day counts toward your streak.',
  'Building': 'Close. One more on-time meal or the check-in usually gets you there.',
  'Off Standard': 'Most of the day is still open. Log what you eat and it climbs.',
};

/** The daily-score legend, top tier first: `{ name, cls, color, range, meaning }` per tier,
 *  plus one trailing "not started" row for the ring that has nothing to draw yet. */
export function dailyLegend() {
  const rows = TIERS.map((t, i) => ({
    name: t.name,
    cls: t.cls,
    tone: t.cls,
    color: TIER_COLOR[t.cls],
    range: tierRange(i),
    meaning: TIER_MEANING[t.name] || '',
  }));
  rows.push({
    name: 'Not started',
    cls: 'muted',
    tone: 'muted',
    color: 'var(--text-3)',
    range: '',
    meaning: 'Nothing logged yet today. The ring draws with your first meal.',
    dashed: true,
  });
  return rows;
}

/* The meal bands, read off qualityBand at each floor so the labels are the ones the meal
   thread prints. Ranges come from the two floors; 100 stands alone as its own row because it
   is the one score that celebrates. */
export function mealLegend() {
  const band = (s) => qualityBand(s);
  return [
    { ...band(100), tone: 'g', color: 'var(--green-bright)', range: '100', meaning: 'Every point on the plate. The chip bursts once, for this meal.' },
    { ...band(MEAL_QUALITY_GOOD), tone: 'g', color: 'var(--green-bright)', range: `${MEAL_QUALITY_GOOD}–99`, meaning: 'Protein on target, the plate in balance, logged in its window.' },
    { ...band(MEAL_QUALITY_OK), tone: 'a', color: 'var(--amber-bright)', range: `${MEAL_QUALITY_OK}–${MEAL_QUALITY_GOOD - 1}`, meaning: 'Something is short. The ✓/✕ rows under the score say what.' },
    { ...band(0), tone: 'r', color: 'var(--red-bright)', range: `0–${MEAL_QUALITY_OK - 1}`, meaning: 'Light on protein, or heavy on one thing, or well past its window.' },
  ];
}

/** The one line that says where "on standard" begins, for copy that needs the number. */
export const ON_STANDARD_LINE = ON_STANDARD;
