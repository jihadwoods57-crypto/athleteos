// Hook + imperative reader for runtime feature flags. Prefer useFlag in components (re-renders when
// the flag map changes); use getFlag in non-React code paths.
import { useFlagsStore, DEFAULT_FLAGS } from '@/store/flagsStore';

export { getFlag, DEFAULT_FLAGS } from '@/store/flagsStore';

export function useFlag(name: string): boolean {
  return useFlagsStore((s) => (name in s.map ? s.map[name] : (DEFAULT_FLAGS[name] ?? false)));
}
