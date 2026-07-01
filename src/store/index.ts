import { useMemo } from 'react';
import { computeDerived, nutritionMemoryFromState } from '@/core';
import type { Derived, NutritionMemoryView } from '@/core';
import { useStore } from './useStore';

export { useStore } from './useStore';
export type { Store } from './useStore';

/** Subscribe to state and recompute all derived values (score, macros, etc.). */
export function useDerived(): Derived {
  const state = useStore();
  return useMemo(() => computeDerived(state), [state]);
}

/** The Nutrition Memory view-model: ranked longitudinal insights from logged history
 *  (real when there's enough, the tagged sample seed otherwise). */
export function useNutritionMemory(): NutritionMemoryView {
  const mealHistory = useStore((s) => s.mealHistory);
  const nutritionHistory = useStore((s) => s.nutritionHistory);
  const weightHistory = useStore((s) => s.weightHistory);
  const proteinTarget = useStore((s) => s.proteinTarget);
  const weightTarget = useStore((s) => s.weightTarget);
  return useMemo(
    () => nutritionMemoryFromState({ mealHistory, nutritionHistory, weightHistory, proteinTarget, weightTarget }),
    [mealHistory, nutritionHistory, weightHistory, proteinTarget, weightTarget],
  );
}
