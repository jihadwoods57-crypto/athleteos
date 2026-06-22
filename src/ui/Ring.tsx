// AthleteOS — animated SVG progress ring (score hero + macro rings).
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function Ring({
  size = 138,
  pct,
  stroke = 17,
  color = '#22C55E',
  track = '#E5EDFB',
  children,
  gradient,
}: {
  size?: number;
  pct: number; // 0–100
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
  gradient?: [string, string];
}) {
  const r = (200 - stroke - 11) / 2; // matches viewBox 200, r≈86 for stroke 17
  const radius = 86;
  const circ = 2 * Math.PI * radius; // ≈540
  const clamped = Math.max(0, Math.min(100, pct));
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: clamped,
      duration: 1500,
      delay: 150,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();
  }, [clamped, anim]);

  const dashoffset = anim.interpolate({
    inputRange: [0, 100],
    outputRange: [circ, 0],
  });

  const gradId = `ring-grad-${gradient ? gradient.join('') : color}`.replace(/[^a-zA-Z0-9]/g, '');

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 200 200" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        {gradient ? (
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={gradient[0]} />
              <Stop offset="1" stopColor={gradient[1]} />
            </LinearGradient>
          </Defs>
        ) : null}
        <Circle cx={100} cy={100} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        <AnimatedCircle
          cx={100}
          cy={100}
          r={radius}
          fill="none"
          stroke={gradient ? `url(#${gradId})` : color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dashoffset}
        />
      </Svg>
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}
