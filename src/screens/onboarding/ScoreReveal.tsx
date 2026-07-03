// OnStandard — Starting Point Score reveal. Cinematic but in-system: the ring
// draws, the number counts up to the score, the grade fades in. Reduce-motion aware.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { type ColorTheme } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Ring } from '@/ui/Ring';
import { Reveal, Txt } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { useReduceMotion } from '@/ui/useReduceMotion';

/** Ring + number color by band for the STARTING baseline (a start to climb from, not a
 *  verdict) — so the lowest band reads amber "room to grow", never alarm-red "fail". The
 *  daily Home score keeps the full A–F grade; this reveal is a baseline, not a report card. */
function bandColor(score: number, c: ColorTheme): string {
  if (score >= 80) return c.success;
  if (score >= 70) return c.accent;
  return c.warning;
}

export function ScoreReveal({ score, bumped }: { score: number; bumped?: boolean }) {
  const c = useColors();
  const reduceMotion = useReduceMotion();
  const [shown, setShown] = useState(reduceMotion ? score : 0);
  const gradeAnim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const color = bandColor(score, c);

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
      {/* The ring stands alone on open canvas — for a reveal, isolation + the count-up +
          the haptic are the drama; a card behind a circular ring only gilds it. */}
      <Reveal index={0}>
      <Ring size={232} pct={score} stroke={20} color={color} track={c.track}>
        <Txt w="eb" num size={68} ls={-2} color={c.text}>
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
            <Txt w="eb" size={13} color={c.white} ls={0.5}>
              STARTING POINT
            </Txt>
          </View>
        </Animated.View>
      </Ring>
      </Reveal>
      {bumped ? (
        <View style={{ marginTop: 18, backgroundColor: c.successSurface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Txt w="eb" size={13} color={c.successDeep}>
            ↑ +3 from your first meal
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
