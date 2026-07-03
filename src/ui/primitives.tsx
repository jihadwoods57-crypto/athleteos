// OnStandard — shared UI primitives. Every component reads the active palette via
// useColors() so light/dark swaps at render time. Default color props are OPTIONAL and
// resolved inside (a default param would capture the static light palette and never theme).
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
import { font, MAX_FONT_SCALE, radius, shadow, space } from './tokens';
import { useColors } from './theme';
import { haptics } from './haptics';
import { useReduceMotion } from './useReduceMotion';

type Weight = keyof typeof font;

export function Txt({
  w = 'sb',
  size = 14,
  color,
  ls,
  upper,
  num,
  style,
  children,
  ...rest
}: TextProps & {
  w?: Weight;
  size?: number;
  color?: string;
  ls?: number;
  upper?: boolean;
  /** Tabular (fixed-width) figures. Use on any number that changes so it never jitters. */
  num?: boolean;
}) {
  const c = useColors();
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: font[w],
          fontSize: size,
          color: color ?? c.text,
          letterSpacing: ls,
          textTransform: upper ? 'uppercase' : undefined,
          fontVariant: num ? (['tabular-nums'] as TextStyle['fontVariant']) : undefined,
        } as TextStyle,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * Surface card. Pick an elevation deliberately — premium depth is the CONTRAST between
 * levels, so a screen has at most ONE `hero`:
 *   hero  — the one thing the screen is about (score, the reveal). Deep soft float.
 *   card  — standard content card (default).
 *   low   — secondary / look-back content. Sits closer to the canvas.
 *   flush — grouped content that should NOT float: tinted surface, no shadow.
 * `elevated` is kept for back-compat (maps to the `elevated` shadow).
 */
export function Card({
  style,
  children,
  elevated,
  variant,
  ...rest
}: ViewProps & { elevated?: boolean; variant?: 'hero' | 'card' | 'low' | 'flush' }) {
  const c = useColors();
  // "Push it harder" hierarchy that survives web's muted shadows: the hero floats
  // (deep shadow, borderless) while secondary cards sit FLAT inside a hairline frame.
  const framed = variant === 'low' || variant === 'flush';
  const sh =
    variant === 'hero' ? shadow.hero
    : framed ? null
    : elevated ? shadow.elevated
    : shadow.card;
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: variant === 'flush' ? c.bg2 : c.card,
          borderRadius: radius.card,
          padding: space.card,
        },
        framed ? { borderWidth: 1, borderColor: c.hairline } : null,
        sh,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Tappable surface with a subtle press-scale (0.98) — the tactile "premium in the hand"
 * feel. Wrap a pressable card/tile with this instead of a bare Pressable. Spring, no
 * bounce; respects reduce-motion. Put the box + shadow styles in `style`.
 */
export function PressScale({
  onPress,
  children,
  style,
  disabled,
  haptic = 'tap',
  scaleTo = 0.98,
  accessibilityLabel,
  accessibilityRole = 'button',
  hitSlop,
}: {
  onPress?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  haptic?: 'tap' | 'select' | 'success' | 'none';
  scaleTo?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
  hitSlop?: PressableProps['hitSlop'];
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  const to = (v: number) => {
    if (reduce) return;
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  };
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      onPress={() => {
        if (haptic !== 'none') haptics[haptic]?.();
        onPress?.();
      }}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * Mount entrance: fade + rise. Wrap each card in a screen's stack with an increasing
 * `index` for a gentle stagger as the screen loads. Ease-out cubic, no bounce; respects
 * reduce-motion (renders instantly).
 */
export function Reveal({
  children,
  index = 0,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const p = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) {
      p.setValue(1);
      return;
    }
    const id = setTimeout(() => {
      Animated.timing(p, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, Math.min(index, 8) * 55);
    return () => clearTimeout(id);
  }, [p, index, reduce]);
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return <Animated.View style={[{ opacity: p, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
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
  const c = useColors();
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
          backgroundColor: primary ? c.accent : c.card,
          opacity: disabled ? 0.5 : pressed ? 0.92 : 1,
        },
        primary ? shadow.cta : shadow.card,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? c.white : c.accent} />
      ) : (
        <Txt w="b" size={16} color={primary ? c.white : c.slate700} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {label}
        </Txt>
      )}
    </Pressable>
  );
}

export function Pill({
  children,
  bg,
  color,
  style,
}: {
  children: React.ReactNode;
  bg?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View
      style={[
        { backgroundColor: bg ?? c.bg2, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start' },
        style,
      ]}
    >
      {typeof children === 'string' ? (
        <Txt w="b" size={12} color={color ?? c.text} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {children}
        </Txt>
      ) : (
        children
      )}
    </View>
  );
}

/**
 * Unmistakable "Sample" marker for seeded/demo values that are not yet sourced from a real
 * athlete, roster, or measurement. Amber surface + deep-amber text via the warn tokens.
 */
export function SampleTag({ label = 'Sample', style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel="Sample data, not live"
      style={[
        { backgroundColor: c.warnTint, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start' },
        style,
      ]}
    >
      <Txt w="eb" size={10} color={c.warnText} ls={0.4} upper maxFontSizeMultiplier={MAX_FONT_SCALE}>
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
  const c = useColors();
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
          backgroundColor: active ? c.accent : c.card,
          opacity: pressed ? 0.9 : 1,
        },
        active ? undefined : shadow.card,
        style,
      ]}
    >
      <Txt w="b" size={14} color={active ? c.white : c.slate700}>
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
  onSet,
}: {
  value: string;
  onDec: () => void;
  onInc: () => void;
  label?: string;
  unit?: string;
  /** When provided, the value is tappable to type an exact number (commits on blur/submit),
   *  so a large change isn't dozens of taps. Omit to keep a pure +/- stepper. */
  onSet?: (n: number) => void;
}) {
  const c = useColors();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const commit = () => {
    setEditing(false);
    const n = parseFloat(draft);
    if (Number.isFinite(n) && onSet) onSet(n);
  };
  const beginEdit = () => {
    if (!onSet) return;
    setDraft(value.replace(/[^0-9.]/g, ''));
    setEditing(true);
  };
  return (
    <View style={{ flex: 1 }}>
      {label ? (
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.6} upper style={{ marginBottom: 8 }}>
          {label}
        </Txt>
      ) : null}
      <Row style={{ justifyContent: 'space-between', backgroundColor: c.card, borderRadius: radius.tile, padding: 10, minHeight: 64, ...shadow.card }}>
        <StepBtn glyph="−" onPress={onDec} />
        <Pressable
          accessibilityRole={onSet ? 'button' : undefined}
          accessibilityLabel={onSet ? `${label ?? 'value'}, tap to type` : undefined}
          onPress={beginEdit}
          hitSlop={8}
          style={{ alignItems: 'center', flex: 1 }}
        >
          {editing ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onBlur={commit}
              onSubmitEditing={commit}
              keyboardType="numeric"
              autoFocus
              selectTextOnFocus
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={{ fontFamily: font.eb, fontSize: 22, color: c.text, textAlign: 'center', minWidth: 60, padding: 0 }}
            />
          ) : (
            <Txt w="eb" size={22} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {value}
            </Txt>
          )}
          {unit ? (
            <Txt w="sb" size={10} color={c.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {unit}
            </Txt>
          ) : null}
        </Pressable>
        <StepBtn glyph="+" onPress={onInc} />
      </Row>
    </View>
  );
}

function StepBtn({ glyph, onPress }: { glyph: string; onPress: () => void }) {
  const c = useColors();
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
        backgroundColor: c.bg2,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Txt w="b" size={22} color={c.accent} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {glyph}
      </Txt>
    </Pressable>
  );
}

/** Pill toggle switch. */
export function Toggle({ on, onPress, label }: { on: boolean; onPress: () => void; label?: string }) {
  const c = useColors();
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
        backgroundColor: on ? c.accent : c.slate300,
        padding: 3,
        alignItems: on ? 'flex-end' : 'flex-start',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.white, ...shadow.card }} />
    </Pressable>
  );
}

/** Horizontal progress bar (track + fill). */
export function ProgressBar({
  pct,
  color,
  height = 8,
  track,
}: {
  pct: number;
  color?: string;
  height?: number;
  track?: string;
}) {
  const c = useColors();
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
    <View style={{ height, borderRadius: height, backgroundColor: track ?? c.track, overflow: 'hidden' }}>
      <Animated.View style={{ width: fillWidth, height, borderRadius: height, backgroundColor: color ?? c.accent }} />
    </View>
  );
}

export function Avatar({
  initials,
  size = 44,
  bg,
  color,
}: {
  initials: string;
  size?: number;
  bg?: string;
  color?: string;
}) {
  const c = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg ?? c.bg2, alignItems: 'center', justifyContent: 'center' }}>
      <Txt w="eb" size={size * 0.36} color={color ?? c.slate600} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {initials}
      </Txt>
    </View>
  );
}

export function Input(props: TextInputProps) {
  const c = useColors();
  return (
    <TextInput
      placeholderTextColor={c.textTertiary}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...props}
      style={[
        {
          height: 54,
          borderRadius: 16,
          backgroundColor: c.card,
          paddingHorizontal: 16,
          fontFamily: font.sb,
          fontSize: 15,
          color: c.text,
          ...shadow.card,
        },
        props.style,
      ]}
    />
  );
}

/** Safe-area screen wrapper with the app canvas background. */
export function Screen({ children, style, bg }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; bg?: string }) {
  const c = useColors();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg ?? c.bg }} edges={['top']}>
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
