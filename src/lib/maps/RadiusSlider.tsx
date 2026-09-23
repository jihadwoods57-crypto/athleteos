/* The bubble-size slider: 100 m to 1 km in 25 m steps, a haptic tick on every step, and a real
   adjustable control for VoiceOver (swipe up / down moves one step). The track is the whole touch
   target, 44 pt tall, and the thumb never intercepts the touch, so a press anywhere on the track
   jumps there and a drag from anywhere continues from the finger. */
import React from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { select } from '../../ui/haptics';
import {
  fractionFromRadius, metersLabel, radiusFromFraction, snappedChanged, RADIUS_MAX, RADIUS_MIN, RADIUS_STEP,
} from './radius';
import type { PickerTheme } from './theme';

type Props = {
  value: number;
  onChange: (m: number) => void;
  /** The finger lifted: the picker re-fits the camera if the bubble outgrew the screen. */
  onRelease?: (m: number) => void;
  theme: PickerTheme;
};

const THUMB = 28;

export function RadiusSlider({ value, onChange, onRelease, theme: t }: Props) {
  const width = React.useRef(0);
  const [w, setW] = React.useState(0);
  const startX = React.useRef(0);
  const last = React.useRef<number | null>(value);
  // PanResponder is created once; read the latest callbacks through a ref.
  const cb = React.useRef({ onChange, onRelease });
  cb.current = { onChange, onRelease };
  last.current = value;

  const setFromX = React.useCallback((x: number) => {
    if (width.current <= 0) return;
    const m = radiusFromFraction((x - THUMB / 2) / (width.current - THUMB));
    if (snappedChanged(last.current, m)) {
      last.current = m;
      select();
      cb.current.onChange(m);
    }
  }, []);

  const pan = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // The Modal must not steal the drag halfway through (iOS swipe-to-dismiss, a parent scroll).
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { startX.current = e.nativeEvent.locationX; setFromX(startX.current); },
    onPanResponderMove: (_e, g) => setFromX(startX.current + g.dx),
    onPanResponderRelease: () => cb.current.onRelease?.(last.current ?? RADIUS_MIN),
    onPanResponderTerminate: () => cb.current.onRelease?.(last.current ?? RADIUS_MIN),
    // Created once: a new responder mid-drag would drop the gesture's running dx.
  }), [setFromX]);

  const onLayout = (e: LayoutChangeEvent) => {
    width.current = e.nativeEvent.layout.width;
    setW(width.current);
  };

  const step = (dir: 1 | -1) => {
    const m = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, value + dir * RADIUS_STEP));
    if (m !== value) { select(); onChange(m); onRelease?.(m); }
  };

  const left = fractionFromRadius(value) * Math.max(0, w - THUMB);

  return (
    <View
      onLayout={onLayout}
      {...pan.panHandlers}
      style={styles.hit}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Bubble size"
      accessibilityHint="Swipe up or down to change it by 25 metres."
      accessibilityValue={{ min: RADIUS_MIN, max: RADIUS_MAX, now: value, text: metersLabel(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: t.well, borderColor: t.line }]}>
        <View style={[styles.fill, { width: left + THUMB / 2, backgroundColor: t.blue }]} />
      </View>
      <View
        pointerEvents="none"
        style={[styles.thumb, { left, borderColor: t.blue, shadowColor: '#000' }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 44, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  fill: { height: '100%', borderRadius: 3 },
  thumb: {
    position: 'absolute', top: (44 - THUMB) / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF', borderWidth: 2,
    shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
});
