// OnStandard — Check-In tab. Only coach-enabled questions render; submitting
// writes weight back and feeds the Recovery score.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { bodyImageNote, CHECKIN_QUESTIONS, checkinAttribution, checkinSummary, displayWeight, displayWeightDelta, readinessBand, readinessLabel, readinessScore, supportAudience, trendGeometry, weightProgressTone, weightStepLb, weightUnit, WEIGHT_START, WEIGHT_TARGET } from '@/core';
import { useStore } from '@/store';
import { aiPrefix } from '@/lib/ai';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Btn, Card, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Slider } from '@/ui/Slider';

const CI_KEYS: Record<string, 'ciEnergy' | 'ciRecovery' | 'ciSleep' | 'ciConfidence' | 'ciSoreness' | 'ciMotivation'> = {
  energy: 'ciEnergy',
  recovery: 'ciRecovery',
  sleep: 'ciSleep',
  confidence: 'ciConfidence',
  soreness: 'ciSoreness',
  motivation: 'ciMotivation',
};

// Presentational only: the low↔high anchor words that frame each slider so a "7" reads as
// a felt state, not a bare number. Keyed by the SAME question key as CHECKIN_QUESTIONS — it
// does not touch the data model, the question set, or the score (soreness keeps its natural
// low=good→high=bad wording; the readiness engine already inverts its polarity internally).
const CI_ANCHORS: Record<string, { lo: string; hi: string; scale?: string }> = {
  energy: { lo: 'Drained', hi: 'Energized' },
  recovery: { lo: 'Beat up', hi: 'Fully recovered' },
  sleep: { lo: 'Poor', hi: 'Great', scale: 'Sleep quality' },
  confidence: { lo: 'Shaky', hi: 'Dialed in' },
  soreness: { lo: 'None', hi: 'Very sore' },
  motivation: { lo: 'Flat', hi: 'Fired up' },
};

export function CheckIn() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const s = useStore();
  const pad = { paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 };
  const units = s.units ?? 'imperial';
  const wUnit = weightUnit(units);
  const wStepLb = weightStepLb(units);
  const weightTarget = s.weightTarget ?? WEIGHT_TARGET;

  const isReal = s.athleteName.trim().length > 0;
  // Where the check-in is sent / who tuned it, gated so a real solo athlete is not
  // told it went to (or was tailored by) "Coach Davis"; the demo keeps the showcase.
  const audience = supportAudience({ isReal, supportTeam: s.supportTeam, demo: 'Coach Davis & your parent' });
  const attribution = checkinAttribution({ isReal, supportTeam: s.supportTeam });

  // Real weight trend: the fabricated static SVG below is a showcase rising line with
  // no data source, so a real athlete gets a chart drawn from their OWN logged weights
  // (history + today's current), or an honest empty state until they have two points.
  const wSeries = [...(s.weightHistory ?? []).map((p) => p.weight), s.currentWeight].filter(
    (w): w is number => typeof w === 'number' && Number.isFinite(w),
  );
  const wReal = isReal && wSeries.length >= 2;
  const wLo = Math.min(...wSeries, weightTarget);
  const wHi = Math.max(...wSeries, weightTarget);
  const wPad = Math.max(2, (wHi - wLo) * 0.15);
  const wGeo = wReal
    ? trendGeometry(wSeries, { width: 322, height: 92, padX: 12, padTop: 16, padBottom: 8, min: wLo - wPad, max: wHi + wPad })
    : null;

  if (s.ciStage === 'done') {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={pad} showsVerticalScrollIndicator={false}>
        <Reveal index={0}>
        <View style={{ alignItems: 'center', paddingTop: 24 }}>
          <View style={{ width: 82, height: 82, borderRadius: 41, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center', ...shadow.card }}>
            <Icon name="check" size={38} color={c.successDeep} strokeWidth={2.4} />
          </View>
          <Txt w="eb" size={26} ls={-0.5} accessibilityRole="header" style={{ marginTop: 20 }}>
            Check-In Complete
          </Txt>
          <Row style={{ gap: 6, marginTop: 8 }}>
            <Icon name={audience ? 'send' : 'check'} size={13} color={c.textSecondary} />
            <Txt w="sb" size={14} color={c.textSecondary}>
              {audience ? `Sent to ${audience}` : 'Saved to your record'}
            </Txt>
          </Row>
        </View>
        </Reveal>

        <Reveal index={1}>
        <Card variant="hero" style={{ marginTop: 22, borderRadius: 22 }}>
          <Row style={{ gap: 9, marginBottom: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={17} color={c.accent} />
            </View>
            <Txt w="eb" size={12} color={c.accent} ls={0.4}>
              {aiPrefix}WEEKLY SUMMARY
            </Txt>
          </Row>
          <Txt w="m" size={14} color={c.slate700} style={{ lineHeight: 22 }}>
            {checkinSummary(
              {
                name: s.athleteName,
                energy: s.ciEnergy,
                recovery: s.ciRecovery,
                sleep: s.ciSleep,
                confidence: s.ciConfidence,
                soreness: s.ciSoreness,
                motivation: s.ciMotivation,
                config: s.ciConfig,
              },
              // Reconcile with the training-readiness verdict shown just below so the two
              // never contradict ("strong week" over "train with caution").
              (() => {
                const r = readinessScore({ energy: s.ciEnergy, recovery: s.ciRecovery, sleep: s.ciSleep, soreness: s.ciSoreness });
                return r == null ? undefined : readinessBand(r);
              })(),
            )}
          </Txt>
        </Card>
        </Reveal>

        {(() => {
          // Training readiness from the just-submitted self-report — the strength/performance read
          // the nutrition score can't give. Real data only (this is the athlete's own check-in).
          const r = readinessScore({ energy: s.ciEnergy, recovery: s.ciRecovery, sleep: s.ciSleep, soreness: s.ciSoreness });
          if (r == null) return null;
          const band = readinessBand(r);
          const lbl = readinessLabel(band);
          const tone = band === 'ready' ? c.success : band === 'caution' ? c.warning : c.alert;
          return (
            <Reveal index={2}>
            <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Row style={{ gap: 9 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="bolt" size={17} color={tone} />
                  </View>
                  <Txt w="eb" size={15} ls={-0.2}>
                    {lbl.title}
                  </Txt>
                </Row>
                <View style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: tone }}>
                  <Txt w="eb" num size={13} color={c.white}>
                    {r}
                  </Txt>
                </View>
              </Row>
              <Txt w="m" size={13} color={c.textSecondary} style={{ lineHeight: 19 }}>
                {lbl.how}
              </Txt>
            </Card>
            </Reveal>
          );
        })()}

        <Reveal index={3}>
        <Btn label="Back to Home" variant="secondary" onPress={s.goHome} style={{ marginTop: 16 }} />
        </Reveal>
      </ScrollView>
    );
  }

  const questions = CHECKIN_QUESTIONS.filter((q) => s.ciConfig[q.key]);
  // Live readiness preview from the enabled self-report signals — the outcome the survey
  // is building toward, shown before submit so the number never appears out of nowhere on
  // the done screen. Same pure engine + polarity as the confirmation card; real data only.
  const liveReadiness = readinessScore({
    energy: s.ciConfig.energy ? s.ciEnergy : undefined,
    recovery: s.ciConfig.recovery ? s.ciRecovery : undefined,
    sleep: s.ciConfig.sleep ? s.ciSleep : undefined,
    soreness: s.ciConfig.soreness ? s.ciSoreness : undefined,
  });
  const liveBand = liveReadiness == null ? null : readinessBand(liveReadiness);
  const readyTone = liveBand === 'ready' ? c.success : liveBand === 'caution' ? c.warning : liveBand === 'compromised' ? c.alert : c.accent;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={pad} showsVerticalScrollIndicator={false}>
      <Reveal index={0}>
      <Txt w="sb" size={14} color={c.textSecondary}>
        {isReal ? 'This week' : 'Week 14 · in-season'}
      </Txt>
      <Txt w="eb" size={28} ls={-0.8} accessibilityRole="header" style={{ marginTop: 1 }}>
        Weekly Check-In
      </Txt>
      {/* "~2 min · N questions" — set the expectation before the survey starts. Question
          count follows ciConfig so it never over-promises. */}
      <Row style={{ marginTop: 6, gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
        <Row style={{ gap: 5, alignItems: 'center' }}>
          <Icon name="checkin" size={13} color={c.textTertiary} />
          <Txt w="sb" size={13} color={c.textTertiary}>
            ~2 min
          </Txt>
        </Row>
        <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: c.textTertiary }} />
        <Txt w="sb" size={13} color={c.textTertiary}>
          {questions.length} {questions.length === 1 ? 'question' : 'questions'}
        </Txt>
      </Row>
      {attribution ? (
        <Row style={{ marginTop: 10, alignSelf: 'flex-start', gap: 6, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, backgroundColor: c.accentSurface }}>
          <Icon name="sparkle" size={12} color={c.accent} />
          <Txt w="b" size={12} color={c.accent}>
            {attribution}
          </Txt>
        </Row>
      ) : null}
      </Reveal>

      <Reveal index={1}>
      {/* weight stepper */}
      <Row style={[{ marginTop: 18, backgroundColor: c.card, borderRadius: 20, padding: 18, justifyContent: 'space-between' }, shadow.card]}>
        <View>
          <Txt w="b" size={12} color={c.textTertiary}>
            Current weight
          </Txt>
          <Txt w="eb" num size={28} style={{ marginTop: 4 }}>
            {displayWeight(s.ciWeight, units)}
            <Txt w="sb" size={14} color={c.textTertiary}>
              {' '}
              {wUnit}
            </Txt>
          </Txt>
        </View>
        <Row style={{ gap: 8 }}>
          <BigStep glyph="−" onPress={() => s.wStep(-wStepLb)} />
          <BigStep glyph="+" onPress={() => s.wStep(wStepLb)} />
        </Row>
      </Row>
      {/* body-image safeguard for a minor-facing weight tracker */}
      <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 8, lineHeight: 17, paddingHorizontal: 2 }}>
        {bodyImageNote()}
      </Txt>
      </Reveal>

      <Reveal index={2}>
      {/* weight trend */}
      <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Txt w="eb" size={15} ls={-0.3}>
              Weight Trend
            </Txt>
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }}>
              {isReal ? '' : '8-week build · '}goal {displayWeight(weightTarget, units)} {wUnit}
            </Txt>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt w="eb" num size={22}>
              {displayWeight(s.currentWeight, units)}
              <Txt w="sb" size={12} color={c.textTertiary}>
                {' '}
                {wUnit}
              </Txt>
            </Txt>
            {(() => {
              const gain = displayWeightDelta(s.currentWeight - (s.startWeight ?? WEIGHT_START), units);
              // Color by GOAL, not direction: a weight-loss client's loss is progress, not an alert.
              const tone = weightProgressTone(s.currentWeight - (s.startWeight ?? WEIGHT_START), s.baseGoal);
              const toneColor = tone === 'good' ? c.success : tone === 'bad' ? c.alert : c.textSecondary;
              return (
                <Txt w="b" num size={12} color={toneColor}>
                  {gain >= 0 ? `↑ +${gain}` : `↓ ${gain}`} {wUnit}
                </Txt>
              );
            })()}
          </View>
        </Row>
        {wGeo ? (
          // Real athlete with >=2 logged weights: draw their own trend.
          <Svg viewBox="0 0 322 96" width="100%" height={92} preserveAspectRatio="none" style={{ marginTop: 6 }}>
            <Defs>
              <LinearGradient id="ciw" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={c.accent} stopOpacity="0.16" />
                <Stop offset="1" stopColor={c.accent} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Path d={wGeo.areaPath} fill="url(#ciw)" />
            <Path d={wGeo.linePath} fill="none" stroke={c.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={wGeo.last.x} cy={wGeo.last.y} r={5.5} fill={c.accent} stroke={c.card} strokeWidth={2.5} />
          </Svg>
        ) : isReal ? (
          // Real athlete without enough history yet: honest empty state, no fake line.
          <View style={{ marginTop: 10, paddingVertical: 18, alignItems: 'center' }}>
            <Txt w="sb" size={13} color={c.textTertiary} style={{ textAlign: 'center', lineHeight: 19 }}>
              Your weight trend builds as you log your weekly check-ins.
            </Txt>
          </View>
        ) : (
          // Seeded demo: the showcase trend (unchanged).
          <Svg viewBox="0 0 322 96" width="100%" height={92} preserveAspectRatio="none" style={{ marginTop: 6 }}>
            <Defs>
              <LinearGradient id="ciw" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={c.accent} stopOpacity="0.16" />
                <Stop offset="1" stopColor={c.accent} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Line x1="0" y1="25" x2="322" y2="25" stroke={c.success} strokeWidth="1.5" strokeDasharray="5 5" strokeOpacity="0.5" />
            <SvgText x="4" y="19" fontSize="10" fontWeight="700" fill={c.success}>
              Goal {displayWeight(weightTarget, units)}
            </SvgText>
            <Path d="M12,68 L62,65 L111,61 L161,58 L211,51 L260,48 L310,45 L310,96 L12,96 Z" fill="url(#ciw)" />
            <Path d="M12,68 L62,65 L111,61 L161,58 L211,51 L260,48 L310,45" fill="none" stroke={c.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={310} cy={45} r={5.5} fill={c.accent} stroke={c.card} strokeWidth={2.5} />
          </Svg>
        )}
      </Card>
      </Reveal>

      <Reveal index={3}>
      {/* sliders — only enabled questions. Each row: label + live value, the low↔high scale,
          the slider, and its anchor words, so a calm 1–10 reads as a felt state. */}
      <Card variant="low" style={{ marginTop: 14, borderRadius: 20, gap: 22 }}>
        {questions.map((q) => {
          const key = CI_KEYS[q.key];
          const val = s[key];
          const anchor = CI_ANCHORS[q.key];
          return (
            <View key={q.key}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <Txt w="b" size={15} ls={-0.2}>
                  {anchor?.scale ?? q.label}
                </Txt>
                <View style={{ minWidth: 44, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, backgroundColor: c.accentSurface, alignItems: 'center' }}>
                  <Txt w="eb" num size={13} color={c.accent}>
                    {val}/10
                  </Txt>
                </View>
              </Row>
              <Slider value={val} min={1} max={10} onChange={(v) => s.setCi(key, v)} />
              {anchor ? (
                <Row style={{ justifyContent: 'space-between', marginTop: 7 }}>
                  <Txt w="sb" size={11.5} color={c.textTertiary}>
                    {anchor.lo}
                  </Txt>
                  <Txt w="sb" size={11.5} color={c.textTertiary}>
                    {anchor.hi}
                  </Txt>
                </Row>
              ) : null}
            </View>
          );
        })}
      </Card>
      </Reveal>

      {/* live readiness outcome — where the answers land, shown as it builds so the score on
          the done screen is never a surprise. Real data only (returns null with no signals). */}
      {liveReadiness != null && liveBand != null ? (
        <Reveal index={4}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Row style={{ gap: 10, flex: 1 }}>
              <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bolt" size={19} color={readyTone} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt w="eb" size={11} color={c.textTertiary} ls={0.6}>
                  TRAINING READINESS
                </Txt>
                <Txt w="eb" size={16} ls={-0.3} style={{ marginTop: 2 }}>
                  {readinessLabel(liveBand).title}
                </Txt>
              </View>
            </Row>
            <View style={{ alignItems: 'flex-end' }}>
              <Txt w="eb" num size={30} ls={-0.6} color={readyTone}>
                {liveReadiness}
              </Txt>
              <Txt w="sb" size={11} color={c.textTertiary}>
                / 100
              </Txt>
            </View>
          </Row>
        </Card>
        </Reveal>
      ) : null}

      <Reveal index={5}>
      <Card variant="low" style={{ marginTop: 14, borderRadius: 18, paddingVertical: 17 }}>
        <Txt w="m" size={14} color={c.textTertiary}>
          Notes for your coach <Txt w="m" size={14} color={c.textTertiary} style={{ opacity: 0.7 }}>· optional</Txt>
        </Txt>
      </Card>
      </Reveal>

      <Reveal index={6}>
      <Btn label="Submit Check-In" haptic="success" onPress={s.submitCi} style={{ marginTop: 18 }} />
      {audience ? (
        <Row style={{ gap: 6, justifyContent: 'center', marginTop: 12 }}>
          <Icon name="send" size={12} color={c.textTertiary} />
          <Txt w="sb" size={12} color={c.textTertiary}>
            Goes to {audience}
          </Txt>
        </Row>
      ) : null}
      </Reveal>
    </ScrollView>
  );
}

function BigStep({ glyph, onPress }: { glyph: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? 'Increase weight' : 'Decrease weight'}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}
    >
      <Txt w="b" size={24} color={c.slate700}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
