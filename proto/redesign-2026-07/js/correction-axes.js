/* OnStandard: the correction axes, out of the boot graph.

   UI-dead since 2026-09-02, when the "Correct the analysis" chip panel left the meal screen and
   the chat became the athlete's only correction surface. It still has tests, and a future panel
   may want it back, so it lives here, lazily, instead of in meal-intel.js, which is eager: every
   byte in meal-intel is parsed before the first screen paints (tools/boot-closure-ratchet.mjs). */
import { estimateConfidence } from './meal-intel.js';

/* ================================================================================
   CORRECTION AXES (2026-08-14) — which dimension of a read is still genuinely
   open, and in what order to ask about it.

   The panel used to render all five dimensions expanded at once: five rows,
   nineteen chips, and a free-text field. An athlete arrives here with ONE thing
   to fix ("it was cooked in oil"), at 10pm, after practice. Nineteen options is
   a wall, not a tool.

   This does NOT rank on model confidence. There is no per-axis confidence to
   rank on: estimateConfidence returns one band for the whole plate, so treating
   it as "which axis is shakiest" would be inventing a signal. It ranks on facts
   we actually hold — what was detected, what the athlete already said in the
   note, and what they have already corrected. An axis they have answered is
   closed. An axis the photo could not have seen (a drink that was never in
   frame) outranks one it could.
   ================================================================================ */
const AXIS_DEFS = [
  { kind: 'cooking', label: 'Cooking', opts: [['Oil', 'oil'], ['Butter', 'butter'], ['Neither', 'neither']] },
  { kind: 'portion', label: 'Portion', opts: [['About half', 'half'], ['A bit less', 'three-quarters'], ['Larger', 'larger'], ['Double', 'double']] },
  { kind: 'sauce', label: 'Sauce', opts: [['Creamy', 'creamy'], ['Sweet / glaze', 'sweet'], ['None', 'none']] },
  { kind: 'drink', label: 'Drink', opts: [['Water', 'water'], ['Milk', 'milk'], ['Juice', 'juice'], ['Soda', 'soda'], ['Sports drink', 'sports drink']] },
  { kind: 'side', label: 'I also had', opts: [['Fruit', 'fruit'], ['Vegetables', 'vegetables'], ['Bread / roll', 'bread']] },
];

/** Correction dimensions, most-likely-open first. Each carries its own chips and
 *  whether the athlete has already answered it. Order is stable for equal ranks. */
export function correctionAxes(meta) {
  const m = meta || {};
  const done = new Set((Array.isArray(m.corrections) ? m.corrections : [])
    .map((c) => c && c.kind).filter(Boolean));
  const noteTxt = `${m.userNote || ''} ${m.note || ''}`.toLowerCase();
  const foods = Array.isArray(m.detectedRich) ? m.detectedRich : [];
  const names = foods.map((d) => String((d && d.name) || '')).join(' ').toLowerCase();
  // Same protein vocabulary followUpQuestion uses: a plate with a cooked protein is the
  // one where added fat actually moves the number.
  const hasProtein = /salmon|chicken|beef|steak|fish|pork|shrimp|egg|turkey/.test(names);
  const hasBeverage = foods.some((d) => d && d.kind === 'beverage')
    || /water|milk|juice|soda|shake|smoothie|coffee|tea/.test(names);
  const saidCooking = /oil|butter|grill|bake|fried|air.?fry|steam|boil|raw|dry/.test(noteTxt);
  const saidSauce = /sauce|dressing|glaze|gravy|mayo|ketchup|syrup/.test(noteTxt);
  const lowConf = estimateConfidence(m.source, foods) === 'low';

  const rank = (kind) => {
    if (done.has(kind)) return -1;                        // answered: sinks, never leads
    if (kind === 'cooking') return saidCooking ? 0 : hasProtein ? 3 : 1;
    if (kind === 'portion') return lowConf ? 3 : 2;       // depth is what a photo cannot measure
    if (kind === 'sauce') return saidSauce ? 0 : hasProtein ? 2 : 1;
    if (kind === 'drink') return hasBeverage ? 0 : 2;     // never in frame is a real blind spot
    if (kind === 'side') return 1;                        // a photo can never rule this out
    return 0;
  };
  return AXIS_DEFS
    .map((a, i) => ({ ...a, answered: done.has(a.kind), rank: rank(a.kind), order: i }))
    .sort((a, b) => (b.rank - a.rank) || (a.order - b.order));
}
