// OnStandard — unit system (pure TS, no React/RN imports).
// All body weights are STORED internally in pounds (lb); these helpers convert
// to the athlete's chosen display system at the edge. Weight does not feed the
// score (weightScore is a fixed component), so this is a presentation concern
// only — switching units never moves a score.

export type Units = 'imperial' | 'metric';

/** Exact international avoirdupois pound. */
export const KG_PER_LB = 0.45359237;

export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;

/** The weight unit label for the active system. */
export const weightUnit = (units: Units): 'lb' | 'kg' => (units === 'metric' ? 'kg' : 'lb');

/** Convert an internal lb weight to a whole number in the active unit. Whole
 *  numbers keep the big hero/goal figures clean in either system. */
export const displayWeight = (lb: number, units: Units): number =>
  units === 'metric' ? Math.round(lbToKg(lb)) : Math.round(lb);

/** "184 lb" / "83 kg" — value + unit label in the active system. */
export const formatWeight = (lb: number, units: Units): string =>
  `${displayWeight(lb, units)} ${weightUnit(units)}`;

/** A signed weight delta (gain/loss), in the active unit, to one decimal. The
 *  caller renders the arrow/sign; this returns the magnitude+sign as a number. */
export const displayWeightDelta = (lbDelta: number, units: Units): number => {
  const v = units === 'metric' ? lbToKg(lbDelta) : lbDelta;
  return Math.round(v * 10) / 10;
};

/** The lb step that moves the display by exactly one whole unit in the active
 *  system — so a ± control feels like "+1 lb" or "+1 kg" regardless of internal
 *  storage. Metric returns the lb equivalent of 1 kg. */
export const weightStepLb = (units: Units): number => (units === 'metric' ? kgToLb(1) : 1);
