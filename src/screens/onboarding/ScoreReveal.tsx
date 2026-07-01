// OnStandard — Starting Point Score reveal. Cinematic but in-system: the ring
// draws, the number counts up to the score, the grade fades in. Reduce-motion aware.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { gradeWithSuffix } from '@/core';
import { colors } from '@/ui/tokens';
import { Ring } from '@/ui/Ring';
import { Txt } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { useReduceMotion } from '@/ui/useReduceMotion';

/** Ring + number color by score band (motivating, not alarming). */
function bandColor(score: number): string {
  if (score >= 80) return colors.success;
  if (score >= 70) return colors.accent;
  if (score >= 60) return colors.warning;
  return colors.alert;
}

export function ScoreReveal({ score, bumped }: { score: number; bumped?: boolean }) {
  const reduceMotion = useReduceMotion();
  const [shown, setShown] = useState(reduceMotion ? score : 0);
  const gradeAnim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const color = bandColor(score);
  const grade = gradeWithSuffix(score);

  useEffect(() => {
    if (reduceMotion) {
      setShown(score);
      gradeAnim.setValue(1);
      haptics.success(); // the reveal still lands with a punch, even without motion
      return;
    }
    // Count the number up roughly in step with the 1.5s ring draw.
    const driver = new Animated.Value(0);
    const id = driver.addListener(({ value }) => setShown(Math.round(value)));
    Animated.timing(driver, {
      toValue: score,
      duration: 1500,
      delay: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) haptics.success(); // physical punch the instant the number settles on the score
    });
    Animated.timing(gradeAnim, {
      toValue: 1,
      duration: 400,
      delay: 1450,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    return () => {
      driver.removeListener(id);
      driver.stopAnimation();
    };
  }, [score, reduceMotion, gradeAnim]);

  return (
    <View style={{ alignItems: 'center' }}>
      <Ring size={232} pct={score} stroke={20} color={color} track="#E8EEF6">
        <Txt w="eb" size={68} ls={-2} color={colors.text}>
          {shown}
        </Txt>
        <Animated.View
          style={{
            opacity: gradeAnim,
            transform: [{ translateY: gradeAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
            marginTop: 2,
          }}
        >
          <View style={{ backgroundColor: color, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 5 }}>
            <Txt w="eb" size={15} color="#fff" ls={0.3}>
              GRADE {grade}
            </Txt>
          </View>
        </Animated.View>
      </Ring>
      {bumped ? (
        <View style={{ marginTop: 18, backgroundColor: colors.successSurface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Txt w="eb" size={13} color={colors.successDeep}>
            ↑ +3 from your first meal
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
