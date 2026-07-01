// OnStandard — shared reduce-motion hook.
// Mirrors the OS "Reduce Motion" accessibility preference and stays live: it
// reads the current value on mount and updates if the user toggles the setting
// while the app is open. Animated surfaces (Ring, ProgressBar, Overlay) gate
// their motion on this so that, with the setting on, values snap to their final
// state instead of animating. On web AccessibilityInfo resolves false (no-op).
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduce(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduce;
}
