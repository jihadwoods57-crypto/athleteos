// OnStandard — Starting Point Score reveal. Cinematic but in-system: the ring
// draws, the number counts up to the score, the tier chip fades in. Reduce-motion aware.
// This is the activation MOMENT — it gets the same premium ring + tier language as the
// Home hero, plus a soft accent glow behind the ring so the reveal reads as a reward.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { tierFor } from '@/core';
import { ringGradient, tierChip, MAX_FONT_SCALE } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Ring } from '@/ui/Ring';
import { Reveal, Txt } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { useReduceMotion } from '@/ui/useReduceMotion';

export function ScoreReveal({ score, bumped }: { score: number; bumped?: boolean }) {
  const c = useColors();
  const reduceMotion = useReduceMotion();
  const [shown, setShown] = useState(reduceMotion ? score : 0);
  const gradeAnim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  // The premium ring is constant (green→cyan→blue energy); the TIER chip carries the
  // status color, so a low starting baseline reads as a start to climb from — never a
  // red "fail" ring. The daily Home score keeps the full A–F grade; this is a baseline.
  const tier = tierFor(score);
  const chip = tierChip[tier.short];

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
          the haptic are the drama; a card behind a circular ring only gilds it. A soft
          accent halo sits behind it and fades in with the grade, so the number lands with
          a glow instead of on bare canvas. */}
      <Reveal index={0}>
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: 300,
            height: 300,
            borderRadius: 150,
            backgroundColor: c.accentSurface,
            opacity: gradeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }),
            transform: [{ scale: gradeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
          }}
        />
        <Ring size={232} pct={score} stroke={20} gradient={ringGradient} track={c.track}>
          <Txt w="eb" num size={68} ls={-2} color={c.text} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {shown}
          </Txt>
          <Animated.View
            style={{
              opacity: gradeAnim,
              transform: [{ translateY: gradeAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
              marginTop: 8,
            }}
          >
            <View style={{ backgroundColor: chip.bg, borderColor: chip.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 }}>
              <Txt w="eb" size={13} color={chip.fg} ls={0.4} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {tier.name}
              </Txt>
            </View>
          </Animated.View>
          <Animated.View style={{ opacity: gradeAnim, marginTop: 6 }}>
            <Txt w="b" size={11} color={c.textTertiary} ls={0.7} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              STARTING POINT
            </Txt>
          </Animated.View>
        </Ring>
      </View>
      </Reveal>
      {bumped ? (
        <View style={{ marginTop: 18, backgroundColor: c.successSurface, borderColor: c.successBorderSoft, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Txt w="eb" size={13} color={c.successDeep} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            ↑ +3 from your first meal
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
