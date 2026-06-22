import { useMemo } from 'react';
import { computeDerived } from '@/core';
import type { Derived } from '@/core';
import { useStore } from './useStore';

export { useStore } from './useStore';
export type { Store } from './useStore';

/** Subscribe to state and recompute all derived values (score, macros, etc.). */
export function useDerived(): Derived {
  const state = useStore();
  return useMemo(() => computeDerived(state), [state]);
}
