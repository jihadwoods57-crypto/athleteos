// OnStandard — Meal capture overlay: capture → analyzing (~2.3s) → result.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, TextInput, View } from 'react-native';
import { coachGuidance, mealResultFor, qualityLabel, mealCoaching, mealScoreImpact, medicalDisclaimer, flagIngredients, scaleLabel, labelQuality, labelProvenanceNote, matchUsuals, foodLookupToEditable } from '@/core';
import type { MealLabel, LabelFacts, IngredientFlag, MealResult, MealCaptureMode, MealErrorReason, FoodLookupResult } from '@/core';
import { useStore, useDerived } from '@/store';
import { aiCoachTag } from '@/lib/ai';
import { searchFoods, isFoodLookupConfigured } from '@/lib/food';
import { shadow } from '@/ui/tokens';
import { Avatar, Btn, Card, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { useColors } from '@/ui/theme';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { isDictationAvailable, startDictation, type DictationHandle } from '@/lib/voice/dictation';
import { Overlay } from './Overlay';

const MEAL_TYPES: MealLabel[] = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];

export function MealCapture() {
  const c = useColors();
  const s = useStore();
  const isLabel = s.mealCaptureMode === 'label';
  const isSearch = s.mealCaptureMode === 'search';
  const header =
    s.mealStage === 'result'
      ? isLabel ? 'Label' : 'Analysis'
      : s.mealStage === 'analyzing'
        ? isLabel ? 'Reading label' : 'Analyzing'
        : s.mealStage === 'questions'
          ? 'Almost there'
          : s.mealStage === 'unavailable'
            ? "Couldn't analyze"
            : isSearch ? 'Search a Food' : isLabel ? 'Scan a Label' : 'Log a Meal';

  return (
    <Overlay title={header} onClose={s.closeMeal} closeIcon="close">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {s.mealStage === 'capture' ? <ModeToggle mode={s.mealCaptureMode} onPick={s.setMealCaptureMode} /> : null}

        {isSearch ? (
          <FoodSearch />
        ) : (
          <>
            {/* image slot — tappable during capture to open the camera (or scan a label) */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isLabel ? 'Scan nutrition label' : 'Capture meal photo'}
              disabled={s.mealStage !== 'capture'}
              onPress={() => {
                if (s.mealStage !== 'capture') return;
                haptics.tap();
                if (isLabel) s.captureLabel();
                else s.capture();
              }}
              style={[{ width: '100%', aspectRatio: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: c.track }, shadow.elevated]}
            >
              <ImageSlot analyzing={s.mealStage === 'analyzing'} label={isLabel} />
              {[
                { top: 14, left: 14 },
                { top: 14, right: 14 },
                { bottom: 14, left: 14 },
                { bottom: 14, right: 14 },
              ].map((pos, i) => (
                <View key={i} style={{ position: 'absolute', width: 26, height: 26, borderColor: c.white, opacity: 0.9, borderTopWidth: i < 2 ? 3 : 0, borderBottomWidth: i >= 2 ? 3 : 0, borderLeftWidth: i % 2 === 0 ? 3 : 0, borderRightWidth: i % 2 === 1 ? 3 : 0, ...pos }} />
              ))}
            </Pressable>

            {s.mealStage === 'capture' && <CaptureControls />}
            {s.mealStage === 'analyzing' && <Analyzing label={isLabel} />}
            {s.mealStage === 'questions' && <Questions />}
            {s.mealStage === 'result' && (isLabel
              ? <LabelResult facts={s.labelFacts} servings={s.labelServings} onServings={s.setLabelServings} onAdd={s.addScannedLabel} />
              : <Result mealType={s.mealType} onAdd={s.addMeal} />)}
            {s.mealStage === 'unavailable' && (
              <Unavailable
                reason={s.mealError}
                label={isLabel}
                onRetry={() => { haptics.tap(); if (isLabel) s.captureLabel(); else s.capture(); }}
                onManual={() => { haptics.select(); s.setMealCaptureMode('search'); }}
              />
            )}
          </>
        )}
      </ScrollView>
    </Overlay>
  );
}

/** Segmented toggle: photograph a plate (estimate), search a food by name (exact), or scan a
 *  label (exact). Three tabs, so labels stay short. */
function ModeToggle({ mode, onPick }: { mode: MealCaptureMode; onPick: (m: MealCaptureMode) => void }) {
  const c = useColors();
  const opts: { key: MealCaptureMode; label: string; icon: 'camera' | 'search' | 'barcode' }[] = [
    { key: 'meal', label: 'Photo', icon: 'camera' },
    { key: 'search', label: 'Search', icon: 'search' },
    { key: 'label', label: 'Label', icon: 'barcode' },
  ];
  return (
    <Row style={[{ padding: 4, borderRadius: 14, backgroundColor: c.bg2, marginBottom: 16, gap: 4 }]}>
      {opts.map((o) => {
        const active = mode === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active }}
            onPress={() => { haptics.select(); onPick(o.key); }}
            style={[{ flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 10, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? c.card : 'transparent' }, active ? shadow.card : undefined]}
          >
            <Icon name={o.icon} size={15} color={active ? c.accent : c.textTertiary} />
            <Txt w="b" size={13} color={active ? c.text : c.textTertiary}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </Row>
  );
}

function ImageSlot({ analyzing, label }: { analyzing: boolean; label?: boolean }) {
  const c = useColors();
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
      <Icon name={label ? 'barcode' : 'camera'} size={40} color="#94A3B8" />
      <Txt w="sb" size={13} color="#94A3B8" style={{ marginTop: 10 }}>
        {label ? 'Point at the Nutrition Facts panel' : 'Tap to capture · or drop a meal photo'}
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
              backgroundColor: c.accent,
              transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [0, 320] }) }],
            }}
          />
        </>
      ) : null}
    </View>
  );
}

function CaptureControls() {
  const c = useColors();
  const s = useStore();
  const isLabel = s.mealCaptureMode === 'label';
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
                { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: active ? c.accent : c.card },
                active ? undefined : shadow.card,
              ]}
            >
              <Txt w="b" size={13} color={active ? c.white : c.textSecondary}>
                {m}
              </Txt>
            </Pressable>
          );
        })}
      </Row>

      {isLabel ? null : <Usuals />}

      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 28, paddingHorizontal: 20 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pick a photo from your library"
          onPress={() => {
            haptics.tap();
            if (isLabel) s.captureLabel();
            else s.capture(true);
          }}
          style={[{ width: 48, height: 48, borderRadius: 14, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }, shadow.card]}
        >
          <Icon name="gallery" size={20} color={c.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isLabel ? 'Scan nutrition label' : 'Capture meal photo'}
          onPress={() => {
            haptics.tap();
            if (isLabel) s.captureLabel();
            else s.capture();
          }}
          style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: c.accent, padding: 5 }}
        >
          <View style={{ flex: 1, borderRadius: 30, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            {isLabel ? <Icon name="barcode" size={26} color={c.white} /> : null}
          </View>
        </Pressable>
        {/* balances the row so the shutter stays centered (was a dead "×4" label) */}
        <View style={{ width: 48, height: 48 }} />
      </Row>

      {/* Free-text "describe your meal" only helps the plate estimate (hidden foods, portion, a
          drink off-frame); a label is read verbatim, so it has no place in label mode. */}
      {isLabel ? null : <MealDescInput />}
      <Txt w="m" size={13} color={c.textTertiary} style={{ textAlign: 'center', marginTop: 14 }}>
        {isLabel ? 'Numbers read straight off the label · exact, not estimated' : 'Snap a photo or pick one from your library · works offline'}
      </Txt>
    </View>
  );
}

function Analyzing({ label }: { label?: boolean }) {
  const c = useColors();
  const rows = label
    ? [
        { t: 'Reading the Nutrition Facts', c: c.slate700 },
        { t: 'Parsing ingredients', c: c.textSecondary },
        { t: 'Checking coach flags', c: c.textTertiary },
      ]
    : [
        { t: 'Detecting foods', c: c.slate700 },
        { t: 'Estimating protein & calories', c: c.textSecondary },
        { t: 'Scoring meal quality', c: c.textTertiary },
      ];
  return (
    <View style={{ marginTop: 26 }}>
      <Row style={{ gap: 11, justifyContent: 'center' }}>
        <Spinner />
        <Txt w="eb" size={17}>
          {label ? 'Reading label…' : 'Analyzing meal…'}
        </Txt>
      </Row>
      <View style={{ marginTop: 22, gap: 13, alignItems: 'center' }}>
        {rows.map((row) => (
          <Row key={row.t} style={{ gap: 10 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.accent }} />
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
  const c = useColors();
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
        borderColor: c.accentBorder,
        borderTopColor: c.accent,
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
  const c = useColors();
  const s = useStore();
  const derived = useDerived();
  // Prefer the real AI analysis (Claude vision) when present; else the deterministic result.
  const mr = s.mealAnalysis ?? mealResultFor(mealType);
  const q = qualityLabel(mr.quality);
  const conf = confidenceMeta(mr.confidence, c);
  const tone = {
    success: { bg: c.successSurface, fg: c.successDeep },
    accent: { bg: c.accentSurface, fg: c.accent },
    warning: { bg: c.warnTint, fg: c.warnText },
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
          <Txt w="eb" num size={11} color={tone.fg}>
            {mr.quality} · {q.label}
          </Txt>
        </View>
      </Row>

      {/* HERO — goal-aligned coaching insight */}
      <Reveal index={0}>
      <View style={{ marginTop: 16, borderRadius: 20, padding: 18, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder }}>
        <Row style={{ gap: 9 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={16} color={c.accent} />
          </View>
          <Txt w="eb" size={12} color={c.accent} ls={0.6}>
            {aiCoachTag}
          </Txt>
        </Row>
        <Txt w="sb" size={16} color={c.slate700} style={{ marginTop: 12, lineHeight: 23 }}>
          {heroInsight}
        </Txt>
      </View>
      </Reveal>

      {/* "show its work": only when the note contradicted the photo. Non-accusatory, gives an out. */}
      {mr.reconcile ? (
        <Reveal index={1}>
        <View style={{ marginTop: 12, borderRadius: 18, padding: 16, flexDirection: 'row', gap: 12, backgroundColor: c.bg2 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={16} color={c.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} style={{ marginBottom: 4 }}>
              WHAT I COUNTED
            </Txt>
            <Txt w="sb" size={14} color={c.slate700} style={{ lineHeight: 20 }}>
              {mr.reconcile}
            </Txt>
          </View>
        </View>
        </Reveal>
      ) : null}

      {/* closest compliant swap vs the plan slot target — supportive, never "bad meal" */}
      {mr.substitution ? (
        <Reveal index={1}>
        <View style={{ marginTop: 12, borderRadius: 18, padding: 16, flexDirection: 'row', gap: 12, backgroundColor: c.bg2 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={16} color={c.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} style={{ marginBottom: 4 }}>
              CLOSEST COMPLIANT SWAP
            </Txt>
            <Txt w="sb" size={14} color={c.slate700} style={{ lineHeight: 20 }}>
              {mr.substitution.suggestion}
            </Txt>
            <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 4 }}>
              {mr.substitution.items.join(', ')}
            </Txt>
            <Txt w="eb" num size={13} color={c.textSecondary} style={{ marginTop: 4 }}>
              {`+${mr.substitution.deltaProtein}g · +${mr.substitution.deltaKcal} cal`}
            </Txt>
          </View>
        </View>
        </Reveal>
      ) : null}

      {/* score impact — the reward that proves the loop */}
      <Reveal index={1}>
      <View style={{ marginTop: 12, borderRadius: 18, padding: 16, backgroundColor: impact > 0 ? c.successSurface : c.bg2, flexDirection: 'row', alignItems: 'center', gap: 13 }}>
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="eb" num size={20} color={impact > 0 ? c.successDeep : c.textTertiary}>
            {impact > 0 ? `+${impact}` : '✓'}
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="eb" num size={15} color={impact > 0 ? c.successDeep : c.slate700}>
            {impact > 0 ? `+${impact} to today's score` : 'Already counted today'}
          </Txt>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 1 }}>
            {coaching.dailyContext}
          </Txt>
        </View>
      </View>
      </Reveal>

      {/* loop #2 — the coach's voice, carried forward by the AI */}
      {coaching.coachEcho ? (
        <Reveal index={2}>
        <Card variant="low" style={{ marginTop: 12, borderRadius: 18 }}>
          <Row style={{ gap: 10 }}>
            <Avatar initials={guidance.monogram} size={34} bg={c.text} color={c.white} />
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={11} color={c.textTertiary} ls={0.5}>
                YOUR COACH · CARRIED FORWARD
              </Txt>
              <Txt w="sb" size={14} color={c.slate700} style={{ marginTop: 4, lineHeight: 20 }}>
                {`"${guidance.note}"`}
              </Txt>
            </View>
          </Row>
          <Txt w="sb" size={13} color={c.accent} style={{ marginTop: 10, lineHeight: 19 }}>
            {coaching.coachEcho}
          </Txt>
        </Card>
        </Reveal>
      ) : null}

      {/* next step + education */}
      <CoachBlock tag="DO THIS NEXT" icon="utensils" text={coaching.nextStep} />
      <CoachBlock tag="WHY IT MATTERS" icon="bolt" text={coaching.education} muted />

      {/* scope: this is optional education, not a prescription (keeps the AI honest
          about what it is and protects against reading as clinical advice) */}
      <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 10, paddingHorizontal: 4, lineHeight: 17 }}>
        {coaching.scope}
      </Txt>
      {/* persistent medical-safety disclaimer (Tier 1.5): nutrition education, not
          medical advice — present on every AI coaching surface */}
      <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 6, paddingHorizontal: 4, lineHeight: 17 }}>
        {medicalDisclaimer()}
      </Txt>

      {/* weekly context, when earned */}
      {coaching.weeklyContext ? (
        <Row style={{ gap: 9, marginTop: 12, paddingHorizontal: 4 }}>
          <Icon name="trophy" size={16} color={c.warningDeep} />
          <Txt w="sb" size={13} color={c.slate600} style={{ flex: 1, lineHeight: 19 }}>
            {coaching.weeklyContext}
          </Txt>
        </Row>
      ) : null}

      {/* evidence (demoted): detected foods + macros */}
      <Reveal index={3}>
      <Card variant="low" style={{ marginTop: 14, borderRadius: 18 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 11 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.4}>
            DETECTED · ESTIMATED
          </Txt>
          {conf ? (
            <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: conf.bg }}>
              <Txt w="eb" size={10} color={conf.fg} ls={0.3}>{conf.label}</Txt>
            </View>
          ) : null}
        </Row>
        <Row style={{ flexWrap: 'wrap', gap: 7 }}>
          {mr.detected.map((dt) => (
            <View key={dt} style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9, backgroundColor: c.bg2 }}>
              <Txt w="b" size={12} color={c.slate700}>
                {dt}
              </Txt>
            </View>
          ))}
        </Row>
        <Row style={{ gap: 14, marginTop: 14 }}>
          <MacroChip value={`~${mr.protein}g`} label="Protein" color={c.accent} />
          <MacroChip value={`~${mr.kcal}`} label="Cal" />
          <MacroChip value={`~${mr.carbs}g`} label="Carbs" />
          <MacroChip value={`~${mr.fat}g`} label="Fat" />
        </Row>
        <WhyScore mr={mr} />
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 12, lineHeight: 17 }}>
          Estimated from your photo, not weighed. Portions may vary, so treat these as a guide.
        </Txt>
      </Card>
      </Reveal>

      <Btn label="Add to Log" haptic="success" onPress={onAdd} style={{ marginTop: 18 }} />
    </View>
  );
}

function CoachBlock({ tag, icon, text, muted }: { tag: string; icon: 'utensils' | 'bolt'; text: string; muted?: boolean }) {
  const c = useColors();
  return (
    <View style={[{ marginTop: 12, borderRadius: 18, padding: 16, flexDirection: 'row', gap: 12, backgroundColor: c.card }, shadow.card]}>
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={muted ? c.textSecondary : c.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} style={{ marginBottom: 4 }}>
          {tag}
        </Txt>
        <Txt w="sb" size={14} color={c.slate700} style={{ lineHeight: 20 }}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

function MacroChip({ value, label, color }: { value: string; label: string; color?: string }) {
  const c = useColors();
  return (
    <View>
      <Txt w="eb" num size={17} color={color}>
        {value}
      </Txt>
      <Txt w="sb" size={11} color={c.textTertiary} style={{ marginTop: 1 }}>
        {label}
      </Txt>
    </View>
  );
}

/**
 * Label-scan result: the EXACT macros off the Nutrition Facts panel, scaled by servings,
 * plus the coach-style quality read and ingredient flags. No "~" on the macros — they're
 * read, not estimated (the honesty stance: facts exact, judgment humble).
 */
function LabelResult({
  facts,
  servings,
  onServings,
  onAdd,
}: {
  facts: LabelFacts | null;
  servings: number;
  onServings: (n: number) => void;
  onAdd: () => void;
}) {
  const c = useColors();
  if (!facts) return null;
  const flags = flagIngredients(facts);
  const scaled = scaleLabel(facts, servings);
  const q = qualityLabel(labelQuality(facts, flags));
  const tone = {
    success: { bg: c.successSurface, fg: c.successDeep },
    accent: { bg: c.accentSurface, fg: c.accent },
    warning: { bg: c.warnTint, fg: c.warnText },
  }[q.tone];
  const servingsText = scaled.servings === 1 ? '1 serving' : `${scaled.servings} servings`;

  return (
    <View>
      {/* product + quality read */}
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 18 }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Txt w="eb" size={20} ls={-0.3}>{facts.productName?.trim() || 'Scanned food'}</Txt>
          {facts.servingSize ? (
            <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 2 }}>
              Label serving: {facts.servingSize}
            </Txt>
          ) : null}
        </View>
        <View style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9, backgroundColor: tone.bg }}>
          <Txt w="eb" size={11} color={tone.fg}>{q.label}</Txt>
        </View>
      </Row>

      {/* servings stepper */}
      <Reveal index={0}>
      <Card variant="low" style={{ marginTop: 16, borderRadius: 18 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Txt w="b" size={15}>How many did you eat?</Txt>
            <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 2 }}>
              In servings of {facts.servingSize?.trim() || 'the label size'}
            </Txt>
          </View>
          <Row style={{ gap: 14, alignItems: 'center' }}>
            <StepBtn icon="minus" label="Fewer servings" onPress={() => onServings(servings - 0.5)} />
            <Txt w="eb" num size={20} style={{ minWidth: 42, textAlign: 'center' }}>{servingsText.split(' ')[0]}</Txt>
            <StepBtn icon="plus" label="More servings" onPress={() => onServings(servings + 0.5)} />
          </Row>
        </Row>
      </Card>
      </Reveal>

      {/* the exact macros that get logged */}
      <Reveal index={1}>
      <Card variant="hero" style={{ marginTop: 12, borderRadius: 18 }}>
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.4} style={{ marginBottom: 11 }}>
          YOU ATE · {servingsText.toUpperCase()} · FROM THE LABEL
        </Txt>
        <Row style={{ gap: 14 }}>
          <MacroChip value={`${Math.round(scaled.protein)}g`} label="Protein" color={c.accent} />
          <MacroChip value={`${scaled.calories}`} label="Cal" />
          <MacroChip value={`${Math.round(scaled.carbs)}g`} label="Carbs" />
          <MacroChip value={`${Math.round(scaled.fat)}g`} label="Fat" />
        </Row>
        <Row style={{ gap: 14, marginTop: 14 }}>
          <MacroChip value={`${Math.round(scaled.sugar)}g`} label="Sugar" />
          <MacroChip value={`${scaled.sodium}mg`} label="Sodium" />
        </Row>
      </Card>
      </Reveal>

      {/* ingredient / nutrient flags */}
      {flags.length ? (
        <Reveal index={2}>
        <Card variant="low" style={{ marginTop: 12, borderRadius: 18 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.4} style={{ marginBottom: 11 }}>
            FLAGGED · YOUR COACH'S LIST
          </Txt>
          <Row style={{ flexWrap: 'wrap', gap: 7 }}>
            {flags.map((f) => <FlagChip key={f.key} flag={f} />)}
          </Row>
        </Card>
        </Reveal>
      ) : null}

      {/* ingredients, verbatim */}
      {facts.ingredients?.length ? (
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 12, paddingHorizontal: 4, lineHeight: 18 }}>
          Ingredients: {facts.ingredients.join(', ')}.
        </Txt>
      ) : null}

      {/* honesty: facts exact, judgment humble */}
      <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 8, paddingHorizontal: 4, lineHeight: 17 }}>
        {labelProvenanceNote()}
      </Txt>

      <Btn label="Add to Log" haptic="success" onPress={onAdd} style={{ marginTop: 18 }} />
    </View>
  );
}

function StepBtn({ icon, label, onPress }: { icon: 'plus' | 'minus'; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => { haptics.tap(); onPress(); }}
      style={({ pressed }) => [{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={18} color={c.accent} />
    </Pressable>
  );
}

function FlagChip({ flag }: { flag: IngredientFlag }) {
  const c = useColors();
  const tone = {
    warning: { bg: c.warnTint, fg: c.warnText },
    accent: { bg: c.accentSurface, fg: c.accent },
    neutral: { bg: c.bg2, fg: c.textSecondary },
  }[flag.tone];
  return (
    <View style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9, backgroundColor: tone.bg }}>
      <Txt w="b" size={12} color={tone.fg}>{flag.label}</Txt>
    </View>
  );
}

/** Editable meal description + a mic to dictate it. The words feed the estimate (hidden foods,
 *  portion, an off-frame drink); the mic hides on platforms where dictation isn't available. */
function MealDescInput() {
  const c = useColors();
  const s = useStore();
  const [listening, setListening] = useState(false);
  const handleRef = useRef<DictationHandle | null>(null);
  const stop = () => {
    handleRef.current?.stop();
    handleRef.current = null;
    setListening(false);
  };
  useEffect(() => stop, []); // release the recognizer if the overlay unmounts mid-listen
  const toggle = () => {
    if (listening) { stop(); return; }
    haptics.tap();
    setListening(true);
    handleRef.current = startDictation({
      onText: (t) => s.setMealDesc(t),
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
  };
  return (
    <View style={[{ marginTop: 18, borderRadius: 13, backgroundColor: c.card, paddingLeft: 15, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }, shadow.card]}>
      <TextInput
        value={s.mealDesc}
        onChangeText={s.setMealDesc}
        placeholder="Describe it: hidden foods, portion, a drink (optional)"
        placeholderTextColor={c.textTertiary}
        multiline
        style={{ flex: 1, minHeight: 44, paddingVertical: 11, fontSize: 14, color: c.text }}
        accessibilityLabel="Describe your meal"
      />
      {isDictationAvailable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={listening ? 'Stop dictation' : 'Dictate your description'}
          accessibilityState={{ selected: listening }}
          onPress={toggle}
          hitSlop={8}
          style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: listening ? c.accent : c.bg2 }}
        >
          <Icon name="mic" size={18} color={listening ? c.white : c.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Clarifying-questions sub-stage: the AI asked 1-3 short questions (hidden/off-frame food first,
 * then portion, then prep) whose answers materially change the macros. The athlete answers or
 * skips; either way finalizeMeal makes the second call (which never claims another daily slot).
 */
function Questions() {
  const c = useColors();
  const s = useStore();
  const questions = s.mealQuestions;
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''));
  useEffect(() => { setAnswers(questions.map(() => '')); }, [questions]);
  const finalize = (a: string[]) => { haptics.tap(); s.finalizeMeal(a); };
  return (
    <View style={{ marginTop: 22 }}>
      <Row style={{ gap: 9, alignItems: 'center' }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={16} color={c.accent} />
        </View>
        <Txt w="eb" size={16} style={{ flex: 1 }}>Quick questions to nail it</Txt>
      </Row>
      <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
        A photo can miss what's under or off the plate. Answer what you can, or skip.
      </Txt>
      {questions.map((q, i) => (
        <View key={i} style={{ marginTop: 16 }}>
          <Txt w="sb" size={14} color={c.slate700} style={{ marginBottom: 7, lineHeight: 20 }}>{q}</Txt>
          <View style={[{ borderRadius: 13, backgroundColor: c.card, paddingHorizontal: 14 }, shadow.card]}>
            <TextInput
              value={answers[i] ?? ''}
              onChangeText={(t) => setAnswers((prev) => prev.map((v, j) => (j === i ? t : v)))}
              placeholder="Your answer"
              placeholderTextColor={c.textTertiary}
              multiline
              style={{ minHeight: 44, paddingVertical: 12, fontSize: 14, color: c.text }}
              accessibilityLabel={`Answer for: ${q}`}
            />
          </View>
        </View>
      ))}
      <Btn label="Get my analysis" haptic="success" onPress={() => finalize(answers)} style={{ marginTop: 20 }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip questions and estimate anyway"
        onPress={() => finalize(questions.map(() => ''))}
        style={{ paddingVertical: 12, alignItems: 'center' }}
      >
        <Txt w="sb" size={13} color={c.textTertiary}>Skip and estimate anyway</Txt>
      </Pressable>
    </View>
  );
}

/**
 * Honest "couldn't analyze" state (audit 2026-07-02, item 5). Shown when a CONFIGURED model was
 * asked and could not answer — instead of the old behavior of silently logging a canned plate /
 * sample label as if it read the athlete's real photo. We never guess macros here: the athlete
 * retries, or switches to Search to log the food with exact numbers. Their log still counts.
 */
function Unavailable({ reason, label, onRetry, onManual }: { reason: MealErrorReason | null; label: boolean; onRetry: () => void; onManual: () => void }) {
  const c = useColors();
  const rateLimited = reason === 'rate_limited';
  // Blocked (consent gate / no endpoint) is a state retrying can't change, so those
  // variants drop the retry CTA and make Search the way to log.
  const blocked = reason === 'consent' || reason === 'not_configured';
  const title = rateLimited
    ? "You've hit today's limit"
    : reason === 'consent'
      ? 'Photo analysis is locked for now'
      : reason === 'not_configured'
        ? "Photo analysis isn't on yet"
        : label ? "Couldn't read that label" : "Couldn't analyze that photo";
  const body = rateLimited
    ? "You've used all of today's AI analyses. Your log still counts — search the food to add it exactly, or try the photo again tomorrow."
    : reason === 'consent'
      ? 'Photos only leave your device once data sharing is approved on your account. Until then, search the food to log it exactly — it counts the same.'
      : reason === 'not_configured'
        ? "This build doesn't have photo analysis connected. Search the food to log it exactly — we won't guess your macros."
        : label
          ? "We couldn't read the Nutrition Facts this time. Try the scan again, or search the food to log it exactly. We won't guess the numbers."
          : "We couldn't analyze this one. Try the photo again, or search the food to log it exactly. We won't guess your macros.";
  return (
    <View style={{ marginTop: 26, alignItems: 'center' }}>
      <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: c.warnTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={label ? 'barcode' : 'camera'} size={24} color={c.warnText} />
      </View>
      <Txt w="eb" size={17} style={{ marginTop: 14, textAlign: 'center' }}>{title}</Txt>
      <Txt w="m" size={13.5} color={c.textSecondary} style={{ marginTop: 8, textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 }}>
        {body}
      </Txt>
      {/* No retry CTA when rate-limited or blocked — retrying can't change the outcome; Search is the way to log now. */}
      {rateLimited || blocked ? null : (
        <Btn label={label ? 'Scan again' : 'Retake photo'} onPress={onRetry} style={{ marginTop: 20, alignSelf: 'stretch' }} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search a food to log it exactly"
        onPress={onManual}
        style={{ paddingVertical: 14, alignItems: 'center' }}
      >
        <Txt w="sb" size={13.5} color={c.accent}>Search a food instead</Txt>
      </Pressable>
    </View>
  );
}

/** Tap-to-open explanation of what drives the quality score (protein density). Deterministic,
 *  computed from the shown macros; no extra model call. */
function WhyScore({ mr }: { mr: MealResult }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const proteinCal = mr.protein * 4;
  const totalCal = mr.protein * 4 + mr.carbs * 4 + mr.fat * 9;
  const pct = totalCal > 0 ? Math.round((proteinCal / totalCal) * 100) : 0;
  return (
    <View style={{ marginTop: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Why this score"
        accessibilityState={{ expanded: open }}
        onPress={() => { haptics.select(); setOpen((o) => !o); }}
        hitSlop={6}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        <Icon name={open ? 'minus' : 'plus'} size={14} color={c.accent} />
        <Txt w="b" size={12} color={c.accent}>Why this score</Txt>
      </Pressable>
      {open ? (
        <Txt w="m" size={12} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 18 }}>
          {`Quality tracks protein density: how much of the meal's energy comes from protein. This plate is about ${pct}% protein calories (${proteinCal} of ${totalCal}). More protein per calorie scores higher for an athlete building or holding muscle.`}
        </Txt>
      ) : null}
    </View>
  );
}

/** Map the grounder's confidence to a small badge (label + tone). Null when unknown (fallback). */
function confidenceMeta(
  confidence: MealResult['confidence'],
  c: ReturnType<typeof useColors>,
): { label: string; bg: string; fg: string } | null {
  if (confidence === 'high') return { label: 'HIGH CONFIDENCE', bg: c.successSurface, fg: c.successDeep };
  if (confidence === 'medium') return { label: 'ESTIMATED', bg: c.accentSurface, fg: c.accent };
  if (confidence === 'low') return { label: 'ROUGH ESTIMATE', bg: c.warnTint, fg: c.warnText };
  return null;
}

/**
 * Search a food by name (USDA FoodData Central) and pick EXACT macros from a ranked list — no
 * photo, no model call, no daily slot. "chicken breast" alone can't tell deli from raw, so we
 * surface the top matches and let the athlete pick theirs; picking logs the exact macros to the
 * selected slot via the normal saveMeal path. Fail-soft: no connection / no match -> a helpful note.
 */
function FoodSearch() {
  const c = useColors();
  const s = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodLookupResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  // A dead network is not "no matches" — the two states get different, honest copy.
  const [failed, setFailed] = useState(false);

  const run = async () => {
    const q = query.trim();
    if (!q || loading) return;
    haptics.tap();
    setLoading(true);
    setFailed(false);
    try {
      setResults(await searchFoods(q));
    } catch {
      setResults(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };
  const pick = (r: FoodLookupResult) => {
    haptics.success();
    s.addSearchedFood(foodLookupToEditable(r));
  };

  return (
    <View>
      {/* which slot the picked food logs into */}
      <Row style={{ gap: 8, marginBottom: 16 }}>
        {MEAL_TYPES.map((m) => {
          const active = s.mealType === m;
          return (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityLabel={`Meal type: ${m}`}
              accessibilityState={{ selected: active }}
              onPress={() => { haptics.select(); s.setMealType(m); }}
              style={[{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: active ? c.accent : c.card }, active ? undefined : shadow.card]}
            >
              <Txt w="b" size={12} color={active ? c.white : c.textSecondary}>{m}</Txt>
            </Pressable>
          );
        })}
      </Row>

      {/* search box */}
      <Row style={[{ borderRadius: 13, backgroundColor: c.card, paddingLeft: 14, paddingRight: 6, alignItems: 'center', gap: 8 }, shadow.card]}>
        <Icon name="search" size={18} color={c.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={run}
          returnKeyType="search"
          placeholder="Search a food, e.g. chicken breast"
          placeholderTextColor={c.textTertiary}
          autoCapitalize="none"
          style={{ flex: 1, minHeight: 46, paddingVertical: 11, fontSize: 15, color: c.text }}
          accessibilityLabel="Search a food by name"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search"
          onPress={run}
          hitSlop={8}
          style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent }}
        >
          {loading ? <Spinner /> : <Icon name="chevronRight" size={18} color={c.white} />}
        </Pressable>
      </Row>

      {!isFoodLookupConfigured ? (
        <SearchNote text="Food search needs a connection. Snap a photo or scan a label instead." />
      ) : loading ? (
        <SearchNote text="Searching the USDA database…" />
      ) : failed ? (
        <SearchNote text="Couldn't reach the food database — that's on the connection, not your search. Try again, or scan the label." />
      ) : results === null ? (
        <SearchNote text="Type a food and search. Numbers come straight from the USDA database — exact, not a photo estimate." />
      ) : results.length === 0 ? (
        <SearchNote text={`No matches for "${query.trim()}". Try a simpler name, or scan the label.`} />
      ) : (
        <View style={{ marginTop: 18, gap: 8 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.5}>TAP YOUR FOOD · EXACT MACROS</Txt>
          {results.map((r, i) => <ResultRow key={`${r.name}-${i}`} result={r} onPick={() => pick(r)} />)}
          <Txt w="m" size={11} color={c.textTertiary} style={{ marginTop: 6, lineHeight: 16 }}>
            {results[0]?.source === 'off' ? 'Data: Open Food Facts (ODbL)' : 'Data: USDA FoodData Central (CC0)'}
          </Txt>
        </View>
      )}
    </View>
  );
}

/** One search hit: name + per-serving macros (scaled from per-100g), tap to log. */
function ResultRow({ result, onPick }: { result: FoodLookupResult; onPick: () => void }) {
  const c = useColors();
  const f = foodLookupToEditable(result);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Log ${f.name}, about ${f.per.protein} grams protein`}
      onPress={onPick}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }, shadow.card]}
    >
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="utensils" size={15} color={c.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="b" size={14} color={c.text} numberOfLines={2}>{f.name}</Txt>
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>
          {`${f.portion} · ${f.per.protein}g protein · ${f.per.kcal} cal`}
        </Txt>
      </View>
      <Icon name="plus" size={16} color={c.accent} />
    </Pressable>
  );
}

function SearchNote({ text }: { text: string }) {
  const c = useColors();
  return (
    <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 18, paddingHorizontal: 4, lineHeight: 19, textAlign: 'center' }}>
      {text}
    </Txt>
  );
}

/** "Your usuals": one-tap reuse of the athlete's own repeat meals for this slot. Reusing a usual
 *  logs its CONFIRMED macros with no photo, no model call, and no daily-cap slot. Shows nothing
 *  when there's no repeat history (offline, or a brand-new athlete). */
function Usuals() {
  const c = useColors();
  const s = useStore();
  const usuals = matchUsuals(s.mealHistory ?? [], s.mealType, 3);
  if (usuals.length === 0) return null;
  return (
    <View style={{ marginTop: 16 }}>
      <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} style={{ marginBottom: 8 }}>
        YOUR USUALS · ONE TAP
      </Txt>
      <View style={{ gap: 8 }}>
        {usuals.map((u) => (
          <Pressable
            key={`${u.name}-${u.lastLogged}`}
            accessibilityRole="button"
            accessibilityLabel={`Reuse ${u.name}, about ${u.protein} grams protein`}
            onPress={() => { haptics.select(); s.pickUsual(u); }}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }, shadow.card]}
          >
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={15} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="b" size={14} color={c.text}>{u.name}</Txt>
              <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>
                {`~${u.protein}g protein · ~${u.kcal} cal · logged ${u.count}x`}
              </Txt>
            </View>
            <Icon name="chevronRight" size={16} color={c.textTertiary} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
