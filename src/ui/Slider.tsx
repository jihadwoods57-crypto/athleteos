// AthleteOS — minimal 1–10 slider (drag or tap), accent-colored.
import React, { useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, View } from 'react-native';
import { colors, shadow } from './tokens';

export function Slider({
  value,
  min = 1,
  max = 10,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const setFromX = (x: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const ratio = Math.max(0, Math.min(1, x / w));
    const v = Math.round(min + ratio * (max - min));
    onChange(v);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  const pct = (value - min) / (max - min);

  return (
    <View onLayout={onLayout} {...pan.panHandlers} style={{ height: 28, justifyContent: 'center' }} hitSlop={{ top: 10, bottom: 10 }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.track }}>
        <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
      </View>
      <View
        style={[
          {
            position: 'absolute',
            left: Math.max(0, pct * width - 11),
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: '#fff',
          },
          shadow.card,
        ]}
      />
    </View>
  );
}
