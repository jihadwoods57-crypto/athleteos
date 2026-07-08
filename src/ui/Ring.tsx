// OnStandard — animated SVG progress ring (score hero + macro rings).
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useReduceMotion } from './useReduceMotion';
import { useColors } from './theme';

// react-native-web's Animated forces `collapsable: false` onto every animated
// component's props (a native view-flattening hint). react-native-svg forwards
// unknown props straight to the DOM <circle>, so on web that leaks an invalid
// `collapsable` attribute and trips a noisy React DOM dev warning. Strip it on
// web only; native keeps the raw Circle so its behavior is unchanged.
const RingCircle =
  Platform.OS === 'web'
    ? React.forwardRef<any, any>(({ collapsable, ...rest }, ref) => (
        <Circle ref={ref} {...rest} />
      ))
    : Circle;

const AnimatedCircle = Animated.createAnimatedComponent(RingCircle as typeof Circle);

export function Ring({
  size = 138,
  pct,
  stroke = 17,
  color = '#22C55E',
  track,
  children,
  gradient,
}: {
  size?: number;
  pct: number; // 0–100
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
  gradient?: readonly string[];
}) {
  const c = useColors();
  const trackColor = track ?? c.track;
  const r = (200 - stroke - 11) / 2; // matches viewBox 200, r≈86 for stroke 17
  const radius = 86;
  const circ = 2 * Math.PI * radius; // ≈540
  const clamped = Math.max(0, Math.min(100, pct));
  const anim = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(clamped);
      return;
    }
    Animated.timing(anim, {
      toValue: clamped,
      duration: 1500,
      delay: 150,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();
  }, [clamped, anim, reduceMotion]);

  const dashoffset = anim.interpolate({
    inputRange: [0, 100],
    outputRange: [circ, 0],
  });

  const gradId = `ring-grad-${gradient ? gradient.join('') : color}`.replace(/[^a-zA-Z0-9]/g, '');

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 200 200" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        {gradient && gradient.length > 0 ? (
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              {gradient.map((col, i) => (
                <Stop
                  key={i}
                  offset={gradient.length === 1 ? 1 : i / (gradient.length - 1)}
                  stopColor={col}
                />
              ))}
            </LinearGradient>
          </Defs>
        ) : null}
        <Circle cx={100} cy={100} r={radius} fill="none" stroke={trackColor} strokeWidth={stroke} />
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
