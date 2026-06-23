// AthleteOS — Meal capture overlay: capture → analyzing (~2.3s) → result.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, ScrollView, View } from 'react-native';
import { mealResultFor, qualityLabel } from '@/core';
import type { MealLabel } from '@/core';
import { useStore } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Btn, Card, Row, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

const MEAL_TYPES: MealLabel[] = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];

export function MealCapture() {
  const s = useStore();
  const header = s.mealStage === 'result' ? 'Analysis' : s.mealStage === 'analyzing' ? 'Analyzing' : 'Log a Meal';

  return (
    <Overlay title={header} onClose={s.closeMeal} closeIcon="close">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* image slot */}
        <View style={[{ width: '100%', aspectRatio: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: '#E2E8F0' }, shadow.elevated]}>
          <ImageSlot analyzing={s.mealStage === 'analyzing'} />
          {[
            { top: 14, left: 14 },
            { top: 14, right: 14 },
            { bottom: 14, left: 14 },
            { bottom: 14, right: 14 },
          ].map((pos, i) => (
            <View key={i} style={{ position: 'absolute', width: 26, height: 26, borderColor: '#fff', opacity: 0.9, borderTopWidth: i < 2 ? 3 : 0, borderBottomWidth: i >= 2 ? 3 : 0, borderLeftWidth: i % 2 === 0 ? 3 : 0, borderRightWidth: i % 2 === 1 ? 3 : 0, ...pos }} />
          ))}
        </View>

        {s.mealStage === 'capture' && <CaptureControls />}
        {s.mealStage === 'analyzing' && <Analyzing />}
        {s.mealStage === 'result' && <Result mealType={s.mealType} onAdd={s.addMeal} />}
      </ScrollView>
    </Overlay>
  );
}

function ImageSlot({ analyzing }: { analyzing: boolean }) {
  const scan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!analyzing) return;
    const loop = Animated.loop(
      Animated.timing(scan, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [analyzing, scan]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="camera" size={40} color="#94A3B8" />
      <Txt w="sb" size={13} color="#94A3B8" style={{ marginTop: 10 }}>
        Tap to capture · or drop a meal photo
      </Txt>
      {analyzing ? (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(37,99,235,0.12)' }} />
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: 3,
              backgroundColor: colors.accent,
              transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [0, 320] }) }],
            }}
          />
        </>
      ) : null}
    </View>
  );
}

function CaptureControls() {
  const s = useStore();
  return (
    <View>
      <Row style={{ gap: 8, marginTop: 18 }}>
        {MEAL_TYPES.map((m) => {
          const active = s.mealType === m;
          return (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityLabel={`Meal type: ${m}`}
              accessibilityState={{ selected: active }}
              onPress={() => {
                haptics.select();
                s.setMealType(m);
              }}
              style={[
                { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: active ? colors.accent : '#fff' },
                active ? undefined : shadow.card,
              ]}
            >
              <Txt w="b" size={13} color={active ? '#fff' : colors.textSecondary}>
                {m}
              </Txt>
            </Pressable>
          );
        })}
      </Row>

      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 28, paddingHorizontal: 20 }}>
        <View style={[{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
          <Icon name="gallery" size={20} color={colors.textSecondary} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Capture meal photo"
          onPress={() => {
            haptics.tap();
            s.capture();
          }}
          style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: colors.accent, padding: 5 }}
        >
          <View style={{ flex: 1, borderRadius: 30, backgroundColor: colors.accent }} />
        </Pressable>
        <View style={[{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
          <Txt w="eb" size={13} color={colors.textSecondary}>
            ×4
          </Txt>
        </View>
      </Row>

      <View style={[{ marginTop: 18, height: 50, borderRadius: 13, backgroundColor: '#fff', justifyContent: 'center', paddingHorizontal: 15 }, shadow.card]}>
        <Txt w="m" size={14} color={s.mealDesc ? colors.text : colors.textTertiary}>
          {s.mealDesc || 'Describe your meal for better accuracy (optional)'}
        </Txt>
      </View>
      <Txt w="m" size={13} color={colors.textTertiary} style={{ textAlign: 'center', marginTop: 14 }}>
        One tap · batch up to 4 meals · works offline
      </Txt>
    </View>
  );
}

function Analyzing() {
  return (
    <View style={{ marginTop: 26 }}>
      <Row style={{ gap: 11, justifyContent: 'center' }}>
        <Spinner />
        <Txt w="eb" size={17}>
          Analyzing meal…
        </Txt>
      </Row>
      <View style={{ marginTop: 22, gap: 13, alignItems: 'center' }}>
        {[
          { t: 'Detecting foods', c: colors.slate700 },
          { t: 'Estimating protein & calories', c: colors.textSecondary },
          { t: 'Scoring meal quality', c: colors.textTertiary },
        ].map((row) => (
          <Row key={row.t} style={{ gap: 10 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent }} />
            <Txt w="sb" size={14} color={row.c}>
              {row.t}
            </Txt>
          </Row>
        ))}
      </View>
    </View>
  );
}

function Spinner() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  return (
    <Animated.View
      style={{
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2.5,
        borderColor: colors.accentBorder,
        borderTopColor: colors.accent,
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
      }}
    />
  );
}

function Result({ mealType, onAdd }: { mealType: MealLabel; onAdd: () => void }) {
  const mr = mealResultFor(mealType);
  const q = qualityLabel(mr.quality);
  // Map the pure tone token-name to the badge color pair. (No warningSurface token
  // exists in tokens.ts; amber-50 #FEF3C7 mirrors the alert/accent surface lightness.)
  const tone = {
    success: { bg: colors.successSurface, fg: colors.successDeep },
    accent: { bg: colors.accentSurface, fg: colors.accent },
    warning: { bg: '#FEF3C7', fg: colors.warningDeep },
  }[q.tone];
  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginTop: 18 }}>
        <Txt w="eb" size={20} ls={-0.3} style={{ flex: 1 }}>
          {mr.name}
        </Txt>
        <View style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9, backgroundColor: tone.bg }}>
          <Txt w="eb" size={11} color={tone.fg}>
            {mr.quality} · {q.label}
          </Txt>
        </View>
      </Row>
      <Row style={{ gap: 8, marginTop: 16 }}>
        <MacroTile value={`${mr.protein}g`} label="PROTEIN" color={colors.accent} />
        <MacroTile value={`${mr.kcal}`} label="CALORIES" />
        <MacroTile value={`${mr.carbs}g`} label="CARBS" />
        <MacroTile value={`${mr.fat}g`} label="FAT" />
      </Row>
      <Card style={{ marginTop: 14, borderRadius: 18 }}>
        <Txt w="eb" size={12} color={colors.textTertiary} ls={0.4} style={{ marginBottom: 11 }}>
          FOODS DETECTED
        </Txt>
        <Row style={{ flexWrap: 'wrap', gap: 8 }}>
          {mr.detected.map((dt) => (
            <View key={dt} style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.bg2 }}>
              <Txt w="b" size={13} color={colors.slate700}>
                {dt}
              </Txt>
            </View>
          ))}
        </Row>
      </Card>
      <View style={{ marginTop: 14, borderRadius: 18, padding: 18, backgroundColor: colors.accentSurface, borderWidth: 1, borderColor: colors.accentBorder, flexDirection: 'row', gap: 13 }}>
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={17} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="m" size={14} color={colors.slate700} style={{ lineHeight: 20 }}>
            <Txt w="b" size={14} color={colors.accent}>
              Coach AI ·{' '}
            </Txt>
            {mr.note}
          </Txt>
          <View style={{ marginTop: 11, gap: 7 }}>
            <WhyNext tag="WHY" color={colors.successDeep} text="High protein density, whole-food ingredients, and solid training-window timing." />
            <WhyNext tag="NEXT" color={colors.warningDeep} text="Add a fruit or extra veg for micronutrients to push past 95." />
          </View>
        </View>
      </View>
      <Btn label="Add to Log" haptic="success" onPress={onAdd} style={{ marginTop: 18 }} />
    </View>
  );
}

function MacroTile({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={[{ flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 14 }, shadow.card]}>
      <Txt w="eb" size={22} color={color}>
        {value}
      </Txt>
      <Txt w="b" size={11} color={colors.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
    </View>
  );
}

function WhyNext({ tag, color, text }: { tag: string; color: string; text: string }) {
  return (
    <Row style={{ gap: 8, alignItems: 'flex-start' }}>
      <Txt w="eb" size={12} color={color} style={{ marginTop: 1 }}>
        {tag}
      </Txt>
      <Txt w="m" size={13} color={colors.slate600} style={{ flex: 1 }}>
        {text}
      </Txt>
    </Row>
  );
}
