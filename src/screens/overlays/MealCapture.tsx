// OnStandard — Meal capture overlay: capture → analyzing (~2.3s) → result.
// Dark-premium redesign: viewfinder-forward capture, branded analyzing interstitial,
// a photo-hero analysis with a components-read checklist + plan-match verdict + the
// satisfying score-move beat. Visual port only — the mealStage state machine and every
// store hook / action (capture, captureLabel, finalizeMeal, addMeal, addScannedLabel,
// setMealType, setMealCaptureMode, mealAnalysis / mealQuestions / mealError, food search,
// label scan, the analyze-meal AI integration) are preserved unchanged.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, ScrollView, TextInput, View } from 'react-native';
import { captureProof, coachGuidance, experienceKind, mealResultFor, overseerNoun, qualityLabel, mealCoaching, mealScoreImpact, medicalDisclaimer, flagIngredients, scaleLabel, labelQuality, labelProvenanceNote, matchUsuals, foodLookupToEditable } from '@/core';
import type { MealLabel, LabelFacts, IngredientFlag, MealResult, MealCaptureMode, MealErrorReason, FoodLookupResult } from '@/core';
import { useStore, useDerived } from '@/store';
import { aiCoachTag } from '@/lib/ai';
import { isEnginesEnabled } from '@/lib/features';
import { isBackendLive } from '@/lib/supabase';
import { searchFoods, isFoodLookupConfigured } from '@/lib/food';
import { ringGradient, shadow, tierChip, MAX_FONT_SCALE } from '@/ui/tokens';
import { Avatar, Btn, Card, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { useColors } from '@/ui/theme';
import { Ring } from '@/ui/Ring';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { isDictationAvailable, startDictation, type DictationHandle } from '@/lib/voice/dictation';
import { Overlay } from './Overlay';
import { LiveCamera } from './LiveCamera';

const MEAL_TYPES: MealLabel[] = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];

export function MealCapture() {
  const c = useColors();
  const s = useStore();
  const isLabel = s.mealCaptureMode === 'label';
  const isSearch = s.mealCaptureMode === 'search';
  // The live in-app camera replaces the tap-to-open placeholder for meal photos during capture.
  const liveCapture = s.mealCaptureMode === 'meal' && s.mealStage === 'capture';
  // The real time-left string for the deadline chip on the photo viewfinder — same honest
  // window model the ProofHeader uses (no fabricated countdown). Photo mode only.
  const nowForVf = new Date();
  const vfDeadline = captureProof({
    mealType: s.mealType,
    nowMin: nowForVf.getHours() * 60 + nowForVf.getMinutes(),
    overseer: null,
    lateMatters: isEnginesEnabled,
  });
  const viewfinderDeadline = vfDeadline.windowLine ? vfDeadline.timeLine : null;
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

        {/* Capture-proof context (2026-07-04): this photo satisfies a REQUIREMENT — name it,
            show its real window + time left, and who sees it land. Photo mode only; the
            search/label paths are utilities, not the proof moment. */}
        {s.mealStage === 'capture' && !isSearch && !isLabel ? <ProofHeader /> : null}

        {isSearch ? (
          <FoodSearch />
        ) : (
          <>
            {/* image slot — LIVE in-app camera for meal photos during capture; otherwise the
                tap-to-open viewfinder (label mode + the analyzing / result stages). */}
            {liveCapture ? (
              <LiveCamera
                onCapture={(b64) => s.capture(false, b64)}
                onFallback={() => s.capture()}
                onPickLibrary={() => s.capture(true)}
              />
            ) : s.mealStage === 'result' || s.mealStage === 'analyzing' ? null : (
              <Viewfinder
                label={isLabel}
                deadline={isLabel ? null : viewfinderDeadline}
                disabled={s.mealStage !== 'capture'}
                onPress={() => {
                  if (s.mealStage !== 'capture') return;
                  haptics.tap();
                  if (isLabel) s.captureLabel();
                  else s.capture();
                }}
              />
            )}

            {s.mealStage === 'capture' && <CaptureControls liveMode={liveCapture} />}
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
 *  label (exact). Three tabs, so labels stay short. Matches the dark segmented control on Squad. */
function ModeToggle({ mode, onPick }: { mode: MealCaptureMode; onPick: (m: MealCaptureMode) => void }) {
  const c = useColors();
  const opts: { key: MealCaptureMode; label: string; icon: 'camera' | 'search' | 'barcode' }[] = [
    { key: 'meal', label: 'Photo', icon: 'camera' },
    { key: 'search', label: 'Search', icon: 'search' },
    { key: 'label', label: 'Label', icon: 'barcode' },
  ];
  return (
    <Row style={{ marginBottom: 16, gap: 5, backgroundColor: c.surface2, borderRadius: 15, padding: 5, borderWidth: 1, borderColor: c.hairline }}>
      {opts.map((o) => {
        const active = mode === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active }}
            onPress={() => { haptics.select(); onPick(o.key); }}
            style={[{ flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 10, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? c.accent : 'transparent' }, active ? shadow.cta : undefined]}
          >
            <Icon name={o.icon} size={15} color={active ? c.white : c.textTertiary} />
            <Txt w="b" size={13} color={active ? c.white : c.textSecondary}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </Row>
  );
}

/**
 * The tap-to-open viewfinder for label mode + the non-live photo path — a faithful port of the
 * proto `.viewfinder`: a taller 3:3.6 framed surface with a soft radial-lit dark interior, big
 * corner brackets, a top-center deadline chip, and a bottom-center LIVE pill (photo mode). A
 * camera viewfinder IS dark — that's correct. Deep-floating (shadow.hero).
 */
function Viewfinder({ label, disabled, deadline, onPress }: { label?: boolean; disabled: boolean; deadline?: string | null; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? 'Scan nutrition label' : 'Capture meal photo'}
      disabled={disabled}
      onPress={onPress}
      style={[
        // proto .viewfinder: aspectRatio 3/3.6, radius 24, radial-lit dark interior.
        // RN has no radial-gradient token, so we layer a soft accent-lit core over the dark base.
        { width: '100%', aspectRatio: 3 / 3.6, borderRadius: 24, overflow: 'hidden', backgroundColor: '#141B29', borderWidth: 1, borderColor: c.hairline },
        shadow.hero,
      ]}
    >
      {/* soft radial "lens light" — the proto's radial-gradient(#2b3548 → #141b29) center glow */}
      <View pointerEvents="none" style={{ position: 'absolute', top: '10%', left: '12%', right: '12%', height: '62%', borderRadius: 999, backgroundColor: '#2B3548', opacity: 0.55 }} />

      {/* top-center deadline chip — amber, glassy (proto .vf-deadline) */}
      {deadline ? (
        <View style={{ position: 'absolute', top: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(7,11,20,0.6)', borderWidth: 1, borderColor: 'rgba(245,165,36,0.4)' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.warningDeep }} />
          <Txt w="eb" size={12} color={c.warningDeep}>{deadline}</Txt>
        </View>
      ) : null}

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 60, height: 60, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={label ? 'barcode' : 'camera'} size={30} color="rgba(255,255,255,0.85)" />
        </View>
        <Txt w="sb" size={13} color="rgba(255,255,255,0.62)" style={{ marginTop: 12, textAlign: 'center', paddingHorizontal: 24 }}>
          {label ? 'Point at the Nutrition Facts panel' : 'Tap to capture · or drop a meal photo'}
        </Txt>
      </View>

      {/* bottom-center LIVE pill (photo mode) — green dot + glow (proto viewfinder LIVE tag) */}
      {label ? null : (
        <View style={{ position: 'absolute', bottom: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(7,11,20,0.6)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)' }}>
          <View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.successDeep }, shadow.ctaGreen]} />
          <Txt w="eb" size={11} color={c.successDeep} ls={0.5}>LIVE</Txt>
        </View>
      )}

      <CornerGuides color="rgba(255,255,255,0.85)" />
    </Pressable>
  );
}

/** The four viewfinder corner brackets — proto .vf-corner: 34px, 3px, outer corners radiused. */
function CornerGuides({ color }: { color: string }) {
  return (
    <>
      {[
        { top: 16, left: 16, borderTopLeftRadius: 10 },
        { top: 16, right: 16, borderTopRightRadius: 10 },
        { bottom: 16, left: 16, borderBottomLeftRadius: 10 },
        { bottom: 16, right: 16, borderBottomRightRadius: 10 },
      ].map((pos, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{ position: 'absolute', width: 34, height: 34, borderColor: color, borderTopWidth: i < 2 ? 3 : 0, borderBottomWidth: i >= 2 ? 3 : 0, borderLeftWidth: i % 2 === 0 ? 3 : 0, borderRightWidth: i % 2 === 1 ? 3 : 0, ...pos }}
        />
      ))}
    </>
  );
}

function CaptureControls({ liveMode }: { liveMode?: boolean }) {
  const c = useColors();
  const s = useStore();
  const isLabel = s.mealCaptureMode === 'label';
  return (
    <View>
      <Txt w="eb" size={11} color={c.textTertiary} ls={0.6} style={{ marginTop: 20, marginBottom: 10 }}>
        WHICH MEAL?
      </Txt>
      <Row style={{ gap: 8 }}>
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
                { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: active ? c.accent : c.card, borderWidth: 1, borderColor: active ? c.accent : c.hairline },
                active ? shadow.cta : null,
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

      {/* Shutter + tools row — hidden in live-camera mode (the LiveCamera has its own shutter
          and gallery button overlaid on the feed); kept for label mode + as the non-live path.
          Gallery + a mode toggle flank the prominent center GREEN shutter (proto .cam-actions). */}
      {liveMode ? null : (
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 28, paddingHorizontal: 24 }}>
          <ToolButton
            icon="gallery"
            label="Pick a photo from your library"
            caption="Gallery"
            onPress={() => {
              haptics.tap();
              if (isLabel) s.captureLabel();
              else s.capture(true);
            }}
          />
          <Shutter
            label={isLabel}
            onPress={() => {
              haptics.tap();
              if (isLabel) s.captureLabel();
              else s.capture();
            }}
          />
          {/* switch to search — balances the row so the shutter stays centered, and keeps a
              second tool reachable (proto: search on the far side) */}
          <ToolButton
            icon="search"
            label="Search a food instead"
            caption="Search"
            onPress={() => { haptics.select(); s.setMealCaptureMode('search'); }}
          />
        </Row>
      )}

      {/* Free-text "describe your meal" only helps the plate estimate (hidden foods, portion, a
          drink off-frame); a label is read verbatim, so it has no place in label mode. */}
      {isLabel ? null : <MealDescInput />}
      <Txt w="m" size={13} color={c.textTertiary} style={{ textAlign: 'center', marginTop: 14, lineHeight: 18 }}>
        {isLabel ? 'Numbers read straight off the label · exact, not estimated' : 'Snap a photo or pick one from your library · works offline'}
      </Txt>
    </View>
  );
}

/** A capture-bar tool tile (gallery / search) with a caption below — proto .cam-side: a 50px
 *  surface tile over an 11px label, flanking the center shutter. */
function ToolButton({ icon, label, caption, onPress }: { icon: 'gallery' | 'search'; label: string; caption: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ alignItems: 'center', gap: 5, width: 56 }}
    >
      <View style={[{ width: 50, height: 50, borderRadius: 16, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center' }]}>
        <Icon name={icon} size={20} color={c.slate700} />
      </View>
      <Txt w="b" size={11} color={c.textSecondary}>{caption}</Txt>
    </Pressable>
  );
}

/**
 * The center capture shutter — a faithful port of the proto `.shutter`: a big GREEN disc
 * (green = c.success) sitting inside a soft green glow ring, with an inner dark-bordered circle
 * holding the camera / barcode glyph in near-black (c.onGreen). Green is the app's "go / log"
 * action color; this is the primary tap of the whole screen.
 */
function Shutter({ label, onPress }: { label?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? 'Scan nutrition label' : 'Capture meal photo'}
      onPress={onPress}
      style={({ pressed }) => [{ alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }] }]}
    >
      {/* soft green glow ring — proto box-shadow: 0 0 0 7px rgba(52,211,153,0.14) */}
      <View pointerEvents="none" style={{ position: 'absolute', width: 92, height: 92, borderRadius: 46, backgroundColor: c.success, opacity: 0.14 }} />
      {/* the green shutter disc + green cast shadow (proto --sh-green) */}
      <View style={[{ width: 78, height: 78, borderRadius: 39, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center' }, shadow.ctaGreen]}>
        {/* inner ring: dark hairline circle holding the glyph */}
        <View style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 3, borderColor: 'rgba(4,20,11,0.35)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={label ? 'barcode' : 'camera'} size={26} color={c.onGreen} />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Analyzing interstitial — a branded, centered "checking meal quality" moment with a calm
 * pulsing brand orb (no fake progress bar). The staged read-out lines are honest about what
 * the model is doing; they dim from the head down so the sequence reads as forward motion.
 */
function Analyzing({ label }: { label?: boolean }) {
  const c = useColors();
  const rows = label
    ? [
        { t: 'Reading the Nutrition Facts', color: c.slate700 },
        { t: 'Parsing ingredients', color: c.textSecondary },
        { t: 'Checking coach flags', color: c.textTertiary },
      ]
    : [
        { t: 'Detecting foods', color: c.slate700 },
        { t: 'Estimating protein & calories', color: c.textSecondary },
        { t: 'Scoring meal quality', color: c.textTertiary },
      ];
  return (
    <View style={{ marginTop: 40, alignItems: 'center' }}>
      <PulseOrb />
      <Txt w="eb" size={20} ls={-0.3} style={{ marginTop: 28, textAlign: 'center' }}>
        {label ? 'Reading label…' : 'Checking meal quality…'}
      </Txt>
      <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 8, textAlign: 'center', lineHeight: 19, paddingHorizontal: 20 }}>
        {label ? 'Pulling the exact numbers off the panel.' : 'Reading your plate the way a nutritionist would.'}
      </Txt>
      <View style={{ marginTop: 26, gap: 14, alignSelf: 'stretch', paddingHorizontal: 30 }}>
        {rows.map((row) => (
          <Row key={row.t} style={{ gap: 11 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
            <Txt w="sb" size={14} color={row.color}>
              {row.t}
            </Txt>
          </Row>
        ))}
      </View>
    </View>
  );
}

/** A calm breathing brand orb — the analyzing "heartbeat". Scales + fades a soft ring around a
 *  sparkle. No progress claim; it just signals the app is thinking. Reduce-motion safe (loop is
 *  a no-op visual when the driver never advances). */
function PulseOrb() {
  const c = useColors();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.08] });
  return (
    <View style={{ width: 108, height: 108, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 108, height: 108, borderRadius: 54, backgroundColor: c.accent, opacity, transform: [{ scale }] }} />
      <View style={{ width: 72, height: 72, borderRadius: 26, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="sparkle" size={30} color={c.accent} />
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
 * AI Nutrition Coach result — the showcase. Photo (or an abstract meal-media block) as a hero
 * with a live quality-ring chip; the detected-food chips; a "components read" checklist derived
 * from the real macros; a plan-match verdict (the honest closest-compliant-swap, or a clean
 * "on plan"); the AI note card; the score-move beat; then the coaching + demoted evidence.
 * Ordered by VALUE, not macros. Should feel like "a nutritionist in your pocket," never a food log.
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
  const photo = s.mealPhoto;

  return (
    <View>
      {/* HERO — the plate itself (real captured photo when we have it, else an abstract
          meal-media block), with the meal name, quality ring chip, and detected-food chips
          right under it. The score story lives in the chip, not a red/green ring. */}
      <Reveal index={0}>
      <Card variant="hero" style={{ marginTop: 16, borderRadius: 24, padding: 0, overflow: 'hidden' }}>
        <View style={{ height: 168, backgroundColor: c.surface2 }}>
          {photo ? (
            <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} resizeMode="cover" style={{ width: '100%', height: '100%' }} accessible accessibilityLabel={`Photo of ${mr.name}`} />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="utensils" size={34} color={c.textTertiary} />
            </View>
          )}
          {/* quality ring chip, floating on the hero */}
          <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(5,8,15,0.72)' }}>
            <Ring size={34} pct={mr.quality} stroke={20} gradient={ringGradient} track="rgba(255,255,255,0.14)">
              <Txt w="eb" num size={12} color={c.white} maxFontSizeMultiplier={MAX_FONT_SCALE}>{mr.quality}</Txt>
            </Ring>
            <Txt w="eb" size={11} color={c.white} ls={0.4}>{q.label}</Txt>
          </View>
        </View>
        <View style={{ padding: 18 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} style={{ marginBottom: 8 }}>DETECTED</Txt>
          <Txt w="eb" size={20} ls={-0.3}>{mr.name}</Txt>
          {/* detected-food chips — proto .foodchip: fully-rounded surface pill with a green dot */}
          <Row style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {mr.detected.map((dt) => (
              <Row key={dt} style={{ gap: 7, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.successDeep }} />
                <Txt w="b" size={12.5} color={c.slate700}>{dt}</Txt>
              </Row>
            ))}
          </Row>
        </View>
      </Card>
      </Reveal>

      {/* COMPONENTS READ — a plate-quality checklist derived from the real macros (protein,
          carb source, portion). Each row is a check or a watch, with a short note. No fabricated
          data: every verdict is computed from mr's own numbers. */}
      <Reveal index={1}>
      <Card variant="low" style={{ marginTop: 12, borderRadius: 20, padding: 18 }}>
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} style={{ marginBottom: 4 }}>
          COMPONENTS READ
        </Txt>
        {componentReads(mr).map((cr, i, arr) => (
          <ComponentRow key={cr.label} read={cr} last={i === arr.length - 1} />
        ))}
      </Card>
      </Reveal>

      {/* PLAN MATCH — the honest verdict box (proto .sidebox). When the AI found a closest-
          compliant swap vs the plan slot's target, that's the miss + the fix (amber); otherwise
          the plate cleared the slot (green, green-bordered). */}
      <Reveal index={2}>
      <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} style={{ marginTop: 16, marginBottom: 4 }}>PLAN MATCH</Txt>
      {mr.substitution ? (
        <View style={{ marginTop: 6, borderRadius: 20, padding: 18, backgroundColor: c.warnTint, borderWidth: 1, borderColor: 'rgba(245,165,36,0.32)' }}>
          <Row style={{ gap: 9, alignItems: 'center' }}>
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="bolt" size={16} color={c.warnText} />
            </View>
            <Txt w="eb" size={13} color={c.warnText} ls={0.2}>Close to your plan</Txt>
          </Row>
          <Txt w="sb" size={14} color={c.slate700} style={{ marginTop: 12, lineHeight: 21 }}>
            {mr.substitution.suggestion}
          </Txt>
          <Row style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {mr.substitution.items.map((it) => (
              <View key={it} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: c.card }}>
                <Txt w="b" size={12} color={c.slate700}>{it}</Txt>
              </View>
            ))}
          </Row>
          <Txt w="eb" num size={13} color={c.warnText} style={{ marginTop: 12 }}>
            {`+${mr.substitution.deltaProtein}g protein · +${mr.substitution.deltaKcal} cal`}
          </Txt>
        </View>
      ) : (
        <Row style={{ marginTop: 6, borderRadius: 20, padding: 18, backgroundColor: c.successSurface, borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={20} color={c.successDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={15} color={c.successText}>On plan for {mealType.toLowerCase()}</Txt>
            <Txt w="m" size={13} color={c.successText} style={{ marginTop: 2, lineHeight: 18, opacity: 0.9 }}>
              This plate hits the target for this slot. Log it and keep the standard.
            </Txt>
          </View>
        </Row>
      )}
      </Reveal>

      {/* "show its work": only when the note contradicted the photo. Non-accusatory, gives an out. */}
      {mr.reconcile ? (
        <Reveal index={3}>
        <Card variant="low" style={{ marginTop: 12, borderRadius: 18, flexDirection: 'row', gap: 12 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
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
        </Card>
        </Reveal>
      ) : null}

      {/* AI NOTE — the OnStandard AI voice, goal-aligned. The showcase coaching beat. */}
      <Reveal index={3}>
      <View style={{ marginTop: 12, borderRadius: 20, padding: 18, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder }}>
        <Row style={{ gap: 10, alignItems: 'center' }}>
          <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={17} color={c.accent} />
          </View>
          <Txt w="eb" size={12} color={c.accent} ls={0.5}>
            {aiCoachTag}
          </Txt>
        </Row>
        <Txt w="sb" size={16} color={c.slate700} style={{ marginTop: 13, lineHeight: 23 }}>
          {heroInsight}
        </Txt>
      </View>
      </Reveal>

      {/* SCORE MOVE — the reward that proves the loop. When logging moves the score, show the
          from → to beat with a +N badge (the satisfying "it moved"); otherwise, honestly, it's
          already counted today. */}
      <Reveal index={4}>
      {impact > 0 ? (
        // proto .score-change: the celebratory green beat — green surface + green hairline,
        // the from→to numbers, and the +N badge. This is the reward that proves the loop.
        <View style={{ marginTop: 12, borderRadius: 20, padding: 18, backgroundColor: c.successSurface, borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)' }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Txt w="eb" size={11} color={c.successText} ls={0.6}>ADD THIS TO YOUR DAY</Txt>
              <Row style={{ gap: 9, alignItems: 'center', marginTop: 8 }}>
                <Txt w="sb" num size={18} color={c.textTertiary}>{derived.athleteScore}</Txt>
                <Icon name="chevronRight" size={16} color={c.successDeep} />
                <Txt w="eb" num size={30} ls={-0.5} color={c.successDeep}>{derived.athleteScore + impact}</Txt>
              </Row>
            </View>
            <View style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 12, backgroundColor: c.card }}>
              <Txt w="eb" num size={16} color={c.successDeep}>+{impact}</Txt>
            </View>
          </Row>
          <Txt w="m" size={13} color={c.successText} style={{ marginTop: 12, lineHeight: 19, opacity: 0.92 }}>
            {coaching.dailyContext}
          </Txt>
        </View>
      ) : (
        <Row style={{ marginTop: 12, borderRadius: 20, padding: 16, backgroundColor: c.surface2, gap: 12, alignItems: 'center' }}>
          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={18} color={c.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={14} color={c.slate700}>Already counted today</Txt>
            <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 1, lineHeight: 18 }}>
              {coaching.dailyContext}
            </Txt>
          </View>
        </Row>
      )}
      </Reveal>

      {/* loop #2 — the coach's voice, carried forward by the AI */}
      {coaching.coachEcho ? (
        <Reveal index={5}>
        <Card variant="low" style={{ marginTop: 12, borderRadius: 18 }}>
          <Row style={{ gap: 10 }}>
            <Avatar initials={guidance.monogram} size={34} bg={c.surface3} color={c.slate700} />
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
      <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 12, paddingHorizontal: 4, lineHeight: 17 }}>
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

      {/* evidence (demoted): estimated macros + why-score */}
      <Reveal index={6}>
      <Card variant="low" style={{ marginTop: 14, borderRadius: 18 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.4}>
            ESTIMATED MACROS
          </Txt>
          {conf ? (
            <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: conf.bg }}>
              <Txt w="eb" size={10} color={conf.fg} ls={0.3}>{conf.label}</Txt>
            </View>
          ) : null}
        </Row>
        <Row style={{ gap: 14 }}>
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

/** One component-read row: a check or a watch icon, the label, and a short computed note. */
type ComponentRead = { label: string; ok: boolean; note: string };
function ComponentRow({ read, last }: { read: ComponentRead; last?: boolean }) {
  const c = useColors();
  return (
    <Row style={{ gap: 12, alignItems: 'center', paddingTop: 13, paddingBottom: last ? 0 : 13, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.hairline }}>
      <View style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: read.ok ? c.successSurface : c.warnTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={read.ok ? 'check' : 'minus'} size={14} color={read.ok ? c.successDeep : c.warnText} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="b" size={14} color={c.text}>{read.label}</Txt>
      </View>
      <Txt w="sb" size={12.5} color={c.textSecondary} style={{ flexShrink: 1, textAlign: 'right', maxWidth: '52%' }}>
        {read.note}
      </Txt>
    </Row>
  );
}

/**
 * Derive the "components read" checklist from the meal's OWN macros — no new data, no model
 * call. Protein density and portion are computed the same way WhyScore explains the number,
 * so the checklist and the score never disagree. Honest by construction: each note states the
 * real figure it read.
 */
function componentReads(mr: MealResult): ComponentRead[] {
  const proteinCal = mr.protein * 4;
  const totalCal = mr.protein * 4 + mr.carbs * 4 + mr.fat * 9;
  const proteinPct = totalCal > 0 ? Math.round((proteinCal / totalCal) * 100) : 0;
  return [
    {
      label: 'Protein',
      ok: mr.protein >= 25,
      note: mr.protein >= 25 ? `${mr.protein}g, solid` : `${mr.protein}g, add more`,
    },
    {
      label: 'Protein density',
      ok: proteinPct >= 25,
      note: `${proteinPct}% of calories`,
    },
    {
      label: 'Carb source',
      ok: mr.carbs > 0,
      note: mr.carbs > 0 ? `~${mr.carbs}g to refuel` : 'none read',
    },
    {
      label: 'Portion',
      ok: mr.kcal >= 300,
      note: mr.kcal >= 300 ? `~${mr.kcal} cal, full plate` : `~${mr.kcal} cal, light`,
    },
  ];
}

function CoachBlock({ tag, icon, text, muted }: { tag: string; icon: 'utensils' | 'bolt'; text: string; muted?: boolean }) {
  const c = useColors();
  return (
    <Card variant="low" style={{ marginTop: 12, borderRadius: 18, flexDirection: 'row', gap: 12 }}>
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
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
    </Card>
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
      <Reveal index={0}>
      <Card variant="hero" style={{ marginTop: 16, borderRadius: 20 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Row style={{ gap: 12, flex: 1, paddingRight: 10 }}>
            <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="barcode" size={22} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={19} ls={-0.3}>{facts.productName?.trim() || 'Scanned food'}</Txt>
              {facts.servingSize ? (
                <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 2 }}>
                  Label serving: {facts.servingSize}
                </Txt>
              ) : null}
            </View>
          </Row>
          <View style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9, backgroundColor: tone.bg }}>
            <Txt w="eb" size={11} color={tone.fg}>{q.label}</Txt>
          </View>
        </Row>
      </Card>
      </Reveal>

      {/* servings stepper */}
      <Reveal index={1}>
      <Card variant="low" style={{ marginTop: 12, borderRadius: 18 }}>
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
      <Reveal index={2}>
      <Card variant="hero" style={{ marginTop: 12, borderRadius: 18 }}>
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.4} style={{ marginBottom: 12 }}>
          YOU ATE · {servingsText.toUpperCase()} · FROM THE LABEL
        </Txt>
        <Row style={{ gap: 14 }}>
          <MacroChip value={`${Math.round(scaled.protein)}g`} label="Protein" color={c.accent} />
          <MacroChip value={`${scaled.calories}`} label="Cal" />
          <MacroChip value={`${Math.round(scaled.carbs)}g`} label="Carbs" />
          <MacroChip value={`${Math.round(scaled.fat)}g`} label="Fat" />
        </Row>
        <View style={{ height: 1, backgroundColor: c.hairline, marginVertical: 14 }} />
        <Row style={{ gap: 14 }}>
          <MacroChip value={`${Math.round(scaled.sugar)}g`} label="Sugar" />
          <MacroChip value={`${scaled.sodium}mg`} label="Sodium" />
        </Row>
      </Card>
      </Reveal>

      {/* ingredient / nutrient flags */}
      {flags.length ? (
        <Reveal index={3}>
        <Card variant="low" style={{ marginTop: 12, borderRadius: 18 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.4} style={{ marginBottom: 12 }}>
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
      style={({ pressed }) => [{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 }]}
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
    neutral: { bg: c.surface2, fg: c.textSecondary },
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
    <View style={[{ marginTop: 18, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, paddingLeft: 15, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }, shadow.card]}>
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
          style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: listening ? c.accent : c.surface2 }}
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
    <View style={{ marginTop: 20 }}>
      <Card variant="low" style={{ borderRadius: 20, padding: 18 }}>
        <Row style={{ gap: 10, alignItems: 'center' }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={17} color={c.accent} />
          </View>
          <Txt w="eb" size={16} ls={-0.3} style={{ flex: 1 }}>Quick questions to nail it</Txt>
        </Row>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 10, lineHeight: 19 }}>
          A photo can miss what's under or off the plate. Answer what you can, or skip.
        </Txt>
      </Card>
      {questions.map((q, i) => (
        <View key={i} style={{ marginTop: 12 }}>
          <Txt w="sb" size={14} color={c.slate700} style={{ marginBottom: 8, lineHeight: 20 }}>{q}</Txt>
          <View style={[{ borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 14 }, shadow.card]}>
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
        style={{ paddingVertical: 14, alignItems: 'center' }}
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
    <View style={{ marginTop: 24 }}>
      <Card variant="low" style={{ borderRadius: 20, padding: 22, alignItems: 'center' }}>
        <View style={{ width: 56, height: 56, borderRadius: 17, backgroundColor: c.warnTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={label ? 'barcode' : 'camera'} size={26} color={c.warnText} />
        </View>
        <Txt w="eb" size={17} ls={-0.3} style={{ marginTop: 14, textAlign: 'center' }}>{title}</Txt>
        <Txt w="m" size={13.5} color={c.textSecondary} style={{ marginTop: 8, textAlign: 'center', lineHeight: 20, paddingHorizontal: 4 }}>
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
      </Card>
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
    <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.hairline }}>
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
      <Txt w="eb" size={11} color={c.textTertiary} ls={0.6} style={{ marginBottom: 10 }}>
        LOG INTO
      </Txt>
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
              style={[{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: active ? c.accent : c.card, borderWidth: 1, borderColor: active ? c.accent : c.hairline }, active ? shadow.cta : undefined]}
            >
              <Txt w="b" size={12} color={active ? c.white : c.textSecondary}>{m}</Txt>
            </Pressable>
          );
        })}
      </Row>

      {/* search box */}
      <Row style={[{ borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, paddingLeft: 14, paddingRight: 6, alignItems: 'center', gap: 8 }, shadow.card]}>
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
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, opacity: pressed ? 0.7 : 1 }, shadow.card]}
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
    <View style={{ marginTop: 20 }}>
      <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} style={{ marginBottom: 10 }}>
        YOUR USUALS · ONE TAP
      </Txt>
      <View style={{ gap: 8 }}>
        {usuals.map((u) => (
          <Pressable
            key={`${u.name}-${u.lastLogged}`}
            accessibilityRole="button"
            accessibilityLabel={`Reuse ${u.name}, about ${u.protein} grams protein`}
            onPress={() => { haptics.select(); s.pickUsual(u); }}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, opacity: pressed ? 0.7 : 1 }, shadow.card]}
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

/**
 * The proof header (2026-07-04): the accountability context above the viewfinder. Which
 * requirement this photo satisfies, the real window it belongs to, how much time is left
 * (urgency in color: open / closing / past), and — when a coach or trainer is really
 * linked — that they see it the moment it lands. Every line derives from the plan-window
 * model and the actual link graph; the late line only threatens the score when late
 * scoring is really collected (engines switch), and nobody is told about a watcher who
 * does not exist.
 */
function ProofHeader() {
  const c = useColors();
  const s = useStore();
  const isReal = s.athleteName.trim().length > 0;
  const kind = experienceKind(s.scoringProfile);
  // Honest audience: only when linked AND the backend really delivers logs to them.
  const overseer =
    isReal && isBackendLive && s.supportTeam.length > 0 ? overseerNoun(kind, s.supportTeam) : null;
  const now = new Date();
  const proof = captureProof({
    mealType: s.mealType,
    nowMin: now.getHours() * 60 + now.getMinutes(),
    overseer,
    lateMatters: isEnginesEnabled,
  });
  if (!proof.windowLine) return null;
  const accent = proof.urgency === 'late' ? c.textTertiary : proof.urgency === 'closing' ? c.warningDeep : c.successDeep;
  const surface = proof.urgency === 'closing' ? c.warnTint : c.surface2;
  return (
    <View style={{ borderRadius: 16, backgroundColor: surface, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Row style={{ gap: 8, alignItems: 'center', flex: 1 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accent }} />
          <Txt w="eb" size={11} color={c.slate700} ls={0.5} style={{ flex: 1 }}>{proof.windowLine}</Txt>
        </Row>
        <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.card }}>
          <Txt w="b" size={12} color={accent}>{proof.timeLine}</Txt>
        </View>
      </Row>
      {proof.seenLine ? (
        <Row style={{ gap: 6, alignItems: 'center', marginTop: 9 }}>
          <Icon name="eye" size={12} color={c.textTertiary} />
          <Txt w="sb" size={11.5} color={c.textTertiary}>{proof.seenLine}</Txt>
        </Row>
      ) : null}
    </View>
  );
}
