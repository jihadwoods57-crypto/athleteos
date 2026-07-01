// OnStandard — shared UI primitives.
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  PressableProps,
  ScrollView,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  TextStyle,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font, MAX_FONT_SCALE, radius, shadow, space } from './tokens';
import { haptics } from './haptics';
import { useReduceMotion } from './useReduceMotion';

type Weight = keyof typeof font;

export function Txt({
  w = 'sb',
  size = 14,
  color = colors.text,
  ls,
  upper,
  style,
  children,
  ...rest
}: TextProps & {
  w?: Weight;
  size?: number;
  color?: string;
  ls?: number;
  upper?: boolean;
}) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: font[w],
          fontSize: size,
          color,
          letterSpacing: ls,
          textTransform: upper ? 'uppercase' : undefined,
        } as TextStyle,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Card({
  style,
  children,
  elevated,
  ...rest
}: ViewProps & { elevated?: boolean }) {
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.card,
          padding: space.card,
        },
        elevated ? shadow.elevated : shadow.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({ style, children, ...rest }: ViewProps) {
  return (
    <View {...rest} style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>
      {children}
    </View>
  );
}

export function Btn({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  haptic = 'tap',
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  /** Tactile intent fired on press (native only). Use 'success' on goal-completing CTAs. */
  haptic?: 'tap' | 'success' | 'none';
  style?: StyleProp<ViewStyle>;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      onPress={() => {
        if (haptic !== 'none') haptics[haptic]();
        onPress?.();
      }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          height: 58,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: primary ? colors.accent : colors.card,
          opacity: disabled ? 0.5 : pressed ? 0.92 : 1,
        },
        primary ? shadow.cta : shadow.card,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? '#fff' : colors.accent} />
      ) : (
        <Txt w="b" size={16} color={primary ? '#fff' : colors.slate700} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {label}
        </Txt>
      )}
    </Pressable>
  );
}

export function Pill({
  children,
  bg = colors.bg2,
  color = colors.text,
  style,
}: {
  children: React.ReactNode;
  bg?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        { backgroundColor: bg, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start' },
        style,
      ]}
    >
      {typeof children === 'string' ? (
        <Txt w="b" size={12} color={color} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {children}
        </Txt>
      ) : (
        children
      )}
    </View>
  );
}

/**
 * Unmistakable "Sample" marker for seeded/demo values that are not yet sourced
 * from a real athlete, roster, or measurement. Keeps the showcase visible (per
 * design) while making clear the number is illustrative, not live data. Amber
 * surface + deep-amber text reuse the existing grade-C tokens (no new tokens).
 */
export function SampleTag({ label = 'Sample', style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      accessible
      accessibilityLabel="Sample data, not live"
      style={[
        { backgroundColor: '#FEF3C7', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start' },
        style,
      ]}
    >
      <Txt w="eb" size={10} color="#B45309" ls={0.4} upper maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </Txt>
    </View>
  );
}

/** Selectable chip (filled when active). */
export function Chip({
  label,
  active,
  onPress,
  style,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={() => {
        haptics.select();
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          paddingHorizontal: 17,
          paddingVertical: 11,
          borderRadius: 12,
          backgroundColor: active ? colors.accent : colors.card,
          opacity: pressed ? 0.9 : 1,
        },
        active ? undefined : shadow.card,
        style,
      ]}
    >
      <Txt w="b" size={14} color={active ? '#fff' : colors.slate700}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** ± stepper tile used in baseline + check-in weight. */
export function Stepper({
  value,
  onDec,
  onInc,
  label,
  unit,
}: {
  value: string;
  onDec: () => void;
  onInc: () => void;
  label?: string;
  unit?: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      {label ? (
        <Txt w="eb" size={11} color={colors.textTertiary} ls={0.6} upper style={{ marginBottom: 8 }}>
          {label}
        </Txt>
      ) : null}
      <Row style={{ justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius.tile, padding: 10, ...shadow.card }}>
        <StepBtn glyph="−" onPress={onDec} />
        <View style={{ alignItems: 'center' }}>
          <Txt w="eb" size={22} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {value}
          </Txt>
          {unit ? (
            <Txt w="sb" size={10} color={colors.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {unit}
            </Txt>
          ) : null}
        </View>
        <StepBtn glyph="+" onPress={onInc} />
      </Row>
    </View>
  );
}

function StepBtn({ glyph, onPress }: { glyph: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? 'Increase' : 'Decrease'}
      hitSlop={6}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: colors.bg2,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Txt w="b" size={22} color={colors.accent} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {glyph}
      </Txt>
    </Pressable>
  );
}

/** Pill toggle switch. */
export function Toggle({ on, onPress, label }: { on: boolean; onPress: () => void; label?: string }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      hitSlop={{ top: 9, bottom: 9 }}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={{
        width: 46,
        height: 28,
        borderRadius: 14,
        backgroundColor: on ? colors.accent : '#CBD5E1',
        padding: 3,
        alignItems: on ? 'flex-end' : 'flex-start',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', ...shadow.card }} />
    </Pressable>
  );
}

/** Horizontal progress bar (track + fill). */
export function ProgressBar({
  pct,
  color = colors.accent,
  height = 8,
  track = colors.track,
}: {
  pct: number;
  color?: string;
  height?: number;
  track?: string;
}) {
  const w = Math.max(0, Math.min(100, pct));
  const anim = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(w);
      return;
    }
    Animated.timing(anim, {
      toValue: w,
      duration: 450,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();
  }, [w, anim, reduceMotion]);

  const fillWidth = anim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View style={{ width: fillWidth, height, borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

export function Avatar({
  initials,
  size = 44,
  bg = colors.bg2,
  color = colors.slate600,
}: {
  initials: string;
  size?: number;
  bg?: string;
  color?: string;
}) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt w="eb" size={size * 0.36} color={color} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {initials}
      </Txt>
    </View>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.textTertiary}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...props}
      style={[
        {
          height: 54,
          borderRadius: 16,
          backgroundColor: colors.card,
          paddingHorizontal: 16,
          fontFamily: font.sb,
          fontSize: 15,
          color: colors.text,
          ...shadow.card,
        },
        props.style,
      ]}
    />
  );
}

/** Safe-area screen wrapper with the app canvas background. */
export function Screen({ children, style, bg = colors.bg }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; bg?: string }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top']}>
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </SafeAreaView>
  );
}

/** Scrollable content body with standard screen padding. */
export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ padding: space.screen, paddingBottom: 40 }, style]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export { Pressable };
export type { PressableProps };
