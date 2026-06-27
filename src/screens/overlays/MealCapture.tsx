// AthleteOS — Meal capture overlay: capture → analyzing (~2.3s) → result.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, ScrollView, View } from 'react-native';
import { coachGuidance, mealResultFor, qualityLabel, mealCoaching, mealScoreImpact, medicalDisclaimer } from '@/core';
import type { MealLabel } from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Avatar, Btn, Card, Row, Txt, Pressable } from '@/ui/primitives';
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

/**
 * AI Nutrition Coach — the showcase. Ordered by VALUE, not macros: coaching insight
 * (goal-aligned) -> score impact -> daily context -> the coach's carried-forward note
 * (loop #2) -> next step -> education -> weekly context -> detected/macros (demoted).
 * Should feel like "a nutritionist in your pocket," never a food log.
 */
function Result({ mealType, onAdd }: { mealType: MealLabel; onAdd: () => void }) {
  const s = useStore();
  const derived = useDerived();
  // Prefer the real AI analysis (Claude vision) when present; else the deterministic result.
  const mr = s.mealAnalysis ?? mealResultFor(mealType);
  const q = qualityLabel(mr.quality);
  const tone = {
    success: { bg: colors.successSurface, fg: colors.successDeep },
    accent: { bg: colors.accentSurface, fg: colors.accent },
    warning: { bg: '#FEF3C7', fg: colors.warningDeep },
  }[q.tone];
  // Gate the carried-forward coach note: only a real standing directive (the
  // seeded demo, or a future real note) drives the "your coach, carried forward"
  // card. A brand-new real athlete with no coach gets no fabricated quote.
  const guidance = coachGuidance({
    isReal: s.athleteName.trim().length > 0,
    supportTeam: s.supportTeam,
    coachNote: s.coachNote,
  });
  const coaching = mealCoaching(mealType, s.primaryGoal, derived, s.scoreHistory.length, guidance.note);
  const impact = mealScoreImpact(s, mealType);
  // When a real AI analysis is present, its note IS the coaching (goal-aware, from the
  // photo); otherwise use the deterministic goal-aligned insight.
  const heroInsight = s.mealAnalysis?.note ?? coaching.insight;

  return (
    <View>
      {/* header: meal + quality (evidence, compact) */}
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

      {/* HERO — goal-aligned coaching insight */}
      <View style={{ marginTop: 16, borderRadius: 20, padding: 18, backgroundColor: colors.accentSurface, borderWidth: 1, borderColor: colors.accentBorder }}>
        <Row style={{ gap: 9 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={16} color={colors.accent} />
          </View>
          <Txt w="eb" size={12} color={colors.accent} ls={0.6}>
            AI NUTRITION COACH
          </Txt>
        </Row>
        <Txt w="sb" size={16} color={colors.slate700} style={{ marginTop: 12, lineHeight: 23 }}>
          {heroInsight}
        </Txt>
      </View>

      {/* score impact — the reward that proves the loop */}
      <View style={{ marginTop: 12, borderRadius: 18, padding: 16, backgroundColor: impact > 0 ? colors.successSurface : colors.bg2, flexDirection: 'row', alignItems: 'center', gap: 13 }}>
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="eb" size={20} color={impact > 0 ? colors.successDeep : colors.textTertiary}>
            {impact > 0 ? `+${impact}` : '✓'}
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={15} color={impact > 0 ? colors.successDeep : colors.slate700}>
            {impact > 0 ? `+${impact} to today's score` : 'Already counted today'}
          </Txt>
          <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 1 }}>
            {coaching.dailyContext}
          </Txt>
        </View>
      </View>

      {/* loop #2 — the coach's voice, carried forward by the AI */}
      {coaching.coachEcho ? (
        <Card style={{ marginTop: 12, borderRadius: 18 }}>
          <Row style={{ gap: 10 }}>
            <Avatar initials={guidance.monogram} size={34} bg={colors.text} color="#fff" />
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={11} color={colors.textTertiary} ls={0.5}>
                YOUR COACH · CARRIED FORWARD
              </Txt>
              <Txt w="sb" size={14} color={colors.slate700} style={{ marginTop: 4, lineHeight: 20 }}>
                {`"${guidance.note}"`}
              </Txt>
            </View>
          </Row>
          <Txt w="sb" size={13} color={colors.accent} style={{ marginTop: 10, lineHeight: 19 }}>
            {coaching.coachEcho}
          </Txt>
        </Card>
      ) : null}

      {/* next step + education */}
      <CoachBlock tag="DO THIS NEXT" icon="utensils" text={coaching.nextStep} />
      <CoachBlock tag="WHY IT MATTERS" icon="bolt" text={coaching.education} muted />

      {/* scope: this is optional education, not a prescription (keeps the AI honest
          about what it is and protects against reading as clinical advice) */}
      <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 10, paddingHorizontal: 4, lineHeight: 17 }}>
        {coaching.scope}
      </Txt>
      {/* persistent medical-safety disclaimer (Tier 1.5): nutrition education, not
          medical advice — present on every AI coaching surface */}
      <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 6, paddingHorizontal: 4, lineHeight: 17 }}>
        {medicalDisclaimer()}
      </Txt>

      {/* weekly context, when earned */}
      {coaching.weeklyContext ? (
        <Row style={{ gap: 9, marginTop: 12, paddingHorizontal: 4 }}>
          <Icon name="trophy" size={16} color={colors.warningDeep} />
          <Txt w="sb" size={13} color={colors.slate600} style={{ flex: 1, lineHeight: 19 }}>
            {coaching.weeklyContext}
          </Txt>
        </Row>
      ) : null}

      {/* evidence (demoted): detected foods + macros */}
      <Card style={{ marginTop: 14, borderRadius: 18 }}>
        <Txt w="eb" size={11} color={colors.textTertiary} ls={0.4} style={{ marginBottom: 11 }}>
          DETECTED · ESTIMATED
        </Txt>
        <Row style={{ flexWrap: 'wrap', gap: 7 }}>
          {mr.detected.map((dt) => (
            <View key={dt} style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9, backgroundColor: colors.bg2 }}>
              <Txt w="b" size={12} color={colors.slate700}>
                {dt}
              </Txt>
            </View>
          ))}
        </Row>
        <Row style={{ gap: 14, marginTop: 14 }}>
          <MacroChip value={`~${mr.protein}g`} label="Protein" color={colors.accent} />
          <MacroChip value={`~${mr.kcal}`} label="Cal" />
          <MacroChip value={`~${mr.carbs}g`} label="Carbs" />
          <MacroChip value={`~${mr.fat}g`} label="Fat" />
        </Row>
        <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 12, lineHeight: 17 }}>
          Estimated from your photo, not weighed. Portions may vary, so treat these as a guide.
        </Txt>
      </Card>

      <Btn label="Add to Log" haptic="success" onPress={onAdd} style={{ marginTop: 18 }} />
    </View>
  );
}

function CoachBlock({ tag, icon, text, muted }: { tag: string; icon: 'utensils' | 'bolt'; text: string; muted?: boolean }) {
  return (
    <View style={[{ marginTop: 12, borderRadius: 18, padding: 16, flexDirection: 'row', gap: 12, backgroundColor: colors.card }, shadow.card]}>
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={muted ? colors.textSecondary : colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="eb" size={11} color={colors.textTertiary} ls={0.5} style={{ marginBottom: 4 }}>
          {tag}
        </Txt>
        <Txt w="sb" size={14} color={colors.slate700} style={{ lineHeight: 20 }}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

function MacroChip({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View>
      <Txt w="eb" size={17} color={color}>
        {value}
      </Txt>
      <Txt w="sb" size={11} color={colors.textTertiary} style={{ marginTop: 1 }}>
        {label}
      </Txt>
    </View>
  );
}
