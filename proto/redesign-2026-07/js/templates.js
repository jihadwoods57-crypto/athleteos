// proto/redesign-2026-07/js/templates.js
//
// Seven seed requirement templates (Slice C, 0074). These are DRAFTS — a coach browses
// them and, when one fits, applies it through the standards editor (which turns the
// template's `items` into a saved requirement set via setTeamRequirements). Nothing in
// this module talks to Supabase or the DOM: it is pure, standalone data construction so
// it can be unit-tested without the screen graph. No clock calls — output is deterministic.
//
// Item shapes mirror itemsFromKnobs() in js/screens/coach.js exactly (same field names,
// same id conventions) but are built inline here rather than imported, because that module
// drags in DOM-coupled screen code this file must not depend on.

export const TEMPLATE_KINDS = [
  'game_week', 'off_season', 'travel', 'recovery', 'weight_gain', 'weight_loss', 'injured',
];

const LABELS = {
  game_week: 'Game week',
  off_season: 'Off-season',
  travel: 'Travel',
  recovery: 'Recovery',
  weight_gain: 'Weight gain',
  weight_loss: 'Weight loss',
  injured: 'Injured',
};

export function templateLabel(kind) {
  return LABELS[kind] || 'Custom';
}

// 4-meal day is Breakfast / Lunch / Dinner / Snack (founder call) — keep in step with coach.js.
const MEAL_NAMES = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Meal 5', 'Meal 6'];
const STANDARD_MEAL_WINDOWS = [{ open: 420, due: 570 }, { open: 720, due: 840 }, { open: 1080, due: 1230 }];
const TRAVEL_MEAL_WINDOWS = [{ open: 480, due: 630 }, { open: 780, due: 900 }, { open: 1140, due: 1290 }];
const LIFT_DAYS = { 1: [2], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };

function mealItems(windows, extraWindows) {
  const wins = extraWindows ? windows.concat(extraWindows) : windows;
  return wins.map((w, i) => ({
    id: `meal-${i + 1}`,
    title: MEAL_NAMES[i] || `Meal ${i + 1}`,
    kind: 'meal',
    proof: 'photo',
    freq: { type: 'daily' },
    window: { ...w },
  }));
}

function liftItem(daysPerWeek) {
  return {
    id: 'lift', title: 'Lift session', kind: 'lift', proof: 'check',
    freq: { type: 'days', days: LIFT_DAYS[daysPerWeek], label: `${daysPerWeek}× / week` },
    window: { due: 1230, label: 'After training' },
  };
}

function weighItem(mode) {
  return {
    id: 'weight', title: 'Morning Weight', kind: 'weigh', proof: 'scale',
    freq: mode === 'daily' ? { type: 'daily' } : { type: 'days', days: [1, 3, 5], label: 'Mon / Wed / Fri' },
    window: { due: 540 },
  };
}

function hydrationItem(oz) {
  return {
    id: 'hydration', title: `Hydration · ${oz} oz`, kind: 'hydration', proof: 'counter',
    freq: { type: 'daily' }, window: { due: 1290 }, required: false, target: oz,
  };
}

function recoveryItem() {
  return { id: 'recovery', title: 'Recovery Check-In', kind: 'recovery', proof: 'form', freq: { type: 'daily' }, window: { due: 1410, label: 'Before bed' } };
}

function checkinItem() {
  return { id: 'weekly', title: 'Weekly Check-In', kind: 'checkin', proof: 'form', freq: { type: 'weekly', day: 0, label: 'Sundays' }, window: { due: 1260 } };
}

// Built once at module load. seedTemplates() below always hands back deep copies of this,
// so a caller mutating a returned seed can never corrupt what the next caller receives.
const SEEDS = [
  { name: 'Game week', kind: 'game_week', items: [
    ...mealItems(STANDARD_MEAL_WINDOWS),
    liftItem(3),
    weighItem('mwf'),
    hydrationItem(120),
    recoveryItem(),
    checkinItem(),
  ] },
  { name: 'Off-season', kind: 'off_season', items: [
    ...mealItems(STANDARD_MEAL_WINDOWS),
    liftItem(4),
    weighItem('mwf'),
    hydrationItem(120),
    recoveryItem(),
    checkinItem(),
  ] },
  { name: 'Travel', kind: 'travel', items: [
    ...mealItems(TRAVEL_MEAL_WINDOWS),
    hydrationItem(120),
    recoveryItem(),
  ] },
  { name: 'Recovery', kind: 'recovery', items: [
    ...mealItems(STANDARD_MEAL_WINDOWS),
    liftItem(1),
    weighItem('mwf'),
    hydrationItem(150),
    recoveryItem(),
    checkinItem(),
  ] },
  { name: 'Weight gain', kind: 'weight_gain', items: [
    ...mealItems(STANDARD_MEAL_WINDOWS, [{ due: 1290 }, { due: 1350 }]),
    liftItem(4),
    weighItem('daily'),
    hydrationItem(150),
    recoveryItem(),
    checkinItem(),
  ] },
  { name: 'Weight loss', kind: 'weight_loss', items: [
    ...mealItems(STANDARD_MEAL_WINDOWS),
    liftItem(4),
    weighItem('daily'),
    hydrationItem(120),
    recoveryItem(),
    checkinItem(),
  ] },
  { name: 'Injured', kind: 'injured', items: [
    ...mealItems(STANDARD_MEAL_WINDOWS),
    weighItem('daily'),
    hydrationItem(120),
    recoveryItem(),
    checkinItem(),
  ] },
];

function cloneItem(it) {
  const copy = { ...it };
  if (it.freq) copy.freq = { ...it.freq, days: it.freq.days ? [...it.freq.days] : undefined };
  if (it.window) copy.window = { ...it.window };
  return copy;
}

/** Seven seed requirement-set drafts, one per standard template kind. Pure — same
    output every call — and each call returns fresh deep copies so a caller can freely
    edit a seed (renaming meals, tweaking windows) before applying it without affecting
    any other seed or a later call. */
export function seedTemplates() {
  return SEEDS.map(t => ({ name: t.name, kind: t.kind, items: t.items.map(cloneItem) }));
}
