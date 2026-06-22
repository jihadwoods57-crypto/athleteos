// AthleteOS — onboarding baseline AI recommendation (pure, recomputes live).
// Ported verbatim from the prototype's baseline block.
import type { BaseGoal } from './types';

export interface BaselineRec {
  recProtein: number;
  recCal: number;
  recCalStr: string;
  recChange: string;
  recChangeColor: string;
}

const CAL_DELTA: Record<BaseGoal, number> = {
  gain: 500,
  lose: -500,
  maintain: 0,
  performance: 250,
};

const CHANGE_LABEL: Record<BaseGoal, string> = {
  gain: '+6 lb',
  lose: '−8 lb',
  maintain: 'Hold',
  performance: '+3 lb',
};

/** Recompute the AI recommendation from weight (lb) + goal. */
export function baselineRec(weightLb: number, goal: BaseGoal): BaselineRec {
  const recProtein = Math.round(weightLb * (goal === 'lose' ? 1.1 : 1.0));
  const recCal = Math.round(weightLb * 15 + (CAL_DELTA[goal] ?? 0));
  return {
    recProtein,
    recCal,
    recCalStr: recCal.toLocaleString(),
    recChange: CHANGE_LABEL[goal],
    recChangeColor: goal === 'lose' ? '#2563EB' : '#22C55E',
  };
}

/** Inches → feet'inches" display. */
export function formatHeight(totalInches: number): string {
  const ft = Math.floor(totalInches / 12);
  const inch = totalInches % 12;
  return `${ft}'${inch}"`;
}
