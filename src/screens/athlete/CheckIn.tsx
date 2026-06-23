// AthleteOS — Check-In tab. Only coach-enabled questions render; submitting
// writes weight back and feeds the Recovery score.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { CHECKIN_QUESTIONS, displayWeight, displayWeightDelta, weightStepLb, weightUnit, WEIGHT_START, WEIGHT_TARGET } from '@/core';
import { useStore } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Btn, Card, Row, Txt, Pressable } from '@/ui/primitives';
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

export function CheckIn() {
  const insets = useSafeAreaInsets();
  const s = useStore();
  const pad = { paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 };
  const units = s.units ?? 'imperial';
  const wUnit = weightUnit(units);
  const wStepLb = weightStepLb(units);
  const weightTarget = s.weightTarget ?? WEIGHT_TARGET;

  if (s.ciStage === 'done') {
    const name = s.athleteName?.split(' ')[0] || 'Jihad';
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={pad} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', paddingTop: 24 }}>
          <View style={{ width: 82, height: 82, borderRadius: 41, backgroundColor: colors.successSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={38} color={colors.successDeep} strokeWidth={2.4} />
          </View>
          <Txt w="eb" size={26} ls={-0.5} style={{ marginTop: 20 }}>
            Check-In Complete
          </Txt>
          <Txt w="sb" size={14} color={colors.textSecondary} style={{ marginTop: 8 }}>
            Sent to Coach Davis & your parent
          </Txt>
        </View>
        <Card elevated style={{ marginTop: 22, borderRadius: 20 }}>
          <Row style={{ gap: 9, marginBottom: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={17} color={colors.accent} />
            </View>
            <Txt w="eb" size={12} color={colors.accent} ls={0.4}>
              AI WEEKLY SUMMARY
            </Txt>
          </Row>
          <Txt w="m" size={14} color={colors.slate700} style={{ lineHeight: 22 }}>
            Strong week, {name}. Energy and confidence are up, and your nutrition is locked in. Recovery dipped slightly — prioritize sleep and you'll convert this into an A next week.
          </Txt>
        </Card>
        <Btn label="Back to Home" variant="secondary" onPress={s.goHome} style={{ marginTop: 16 }} />
      </ScrollView>
    );
  }

  const questions = CHECKIN_QUESTIONS.filter((q) => s.ciConfig[q.key]);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={pad} showsVerticalScrollIndicator={false}>
      <Txt w="sb" size={14} color={colors.textSecondary}>
        Week 14 · in-season
      </Txt>
      <Txt w="eb" size={28} ls={-0.8} style={{ marginTop: 1 }}>
        Weekly Check-In
      </Txt>
      <Row style={{ marginTop: 8, alignSelf: 'flex-start', gap: 6, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, backgroundColor: colors.accentSurface }}>
        <Icon name="sparkle" size={12} color={colors.accent} />
        <Txt w="b" size={12} color={colors.accent}>
          Tailored by Coach Davis
        </Txt>
      </Row>

      {/* weight stepper */}
      <Row style={[{ marginTop: 18, backgroundColor: '#fff', borderRadius: 20, padding: 18, justifyContent: 'space-between' }, shadow.card]}>
        <View>
          <Txt w="b" size={12} color={colors.textTertiary}>
            Current weight
          </Txt>
          <Txt w="eb" size={28} style={{ marginTop: 4 }}>
            {displayWeight(s.ciWeight, units)}
            <Txt w="sb" size={14} color={colors.textTertiary}>
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

      {/* weight trend */}
      <Card style={{ marginTop: 14, borderRadius: 20 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Txt w="eb" size={15} ls={-0.3}>
              Weight Trend
            </Txt>
            <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 3 }}>
              8-week build · goal {displayWeight(weightTarget, units)} {wUnit}
            </Txt>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt w="eb" size={22}>
              {displayWeight(s.currentWeight, units)}
              <Txt w="sb" size={12} color={colors.textTertiary}>
                {' '}
                {wUnit}
              </Txt>
            </Txt>
            {(() => {
              const gain = displayWeightDelta(s.currentWeight - WEIGHT_START, units);
              return (
                <Txt w="b" size={12} color={gain >= 0 ? colors.success : colors.alert}>
                  {gain >= 0 ? `↑ +${gain}` : `↓ ${gain}`} {wUnit}
                </Txt>
              );
            })()}
          </View>
        </Row>
        <Svg viewBox="0 0 322 96" width="100%" height={92} preserveAspectRatio="none" style={{ marginTop: 6 }}>
          <Defs>
            <LinearGradient id="ciw" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#2563EB" stopOpacity="0.16" />
              <Stop offset="1" stopColor="#2563EB" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Line x1="0" y1="25" x2="322" y2="25" stroke="#22C55E" strokeWidth="1.5" strokeDasharray="5 5" strokeOpacity="0.5" />
          <SvgText x="4" y="19" fontSize="10" fontWeight="700" fill="#22C55E">
            Goal {displayWeight(weightTarget, units)}
          </SvgText>
          <Path d="M12,68 L62,65 L111,61 L161,58 L211,51 L260,48 L310,45 L310,96 L12,96 Z" fill="url(#ciw)" />
          <Path d="M12,68 L62,65 L111,61 L161,58 L211,51 L260,48 L310,45" fill="none" stroke="#2563EB" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={310} cy={45} r={5.5} fill="#2563EB" stroke="#fff" strokeWidth={2.5} />
        </Svg>
      </Card>

      {/* sliders — only enabled questions */}
      <Card style={{ marginTop: 14, borderRadius: 20, gap: 20 }}>
        {questions.map((q) => {
          const key = CI_KEYS[q.key];
          const val = s[key];
          return (
            <View key={q.key}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 11 }}>
                <Txt w="b" size={14}>
                  {q.label}
                </Txt>
                <Txt w="eb" size={14} color={colors.accent}>
                  {val}/10
                </Txt>
              </Row>
              <Slider value={val} min={1} max={10} onChange={(v) => s.setCi(key, v)} />
            </View>
          );
        })}
      </Card>

      <Card style={{ marginTop: 14, borderRadius: 18, paddingVertical: 17 }}>
        <Txt w="m" size={14} color={colors.textTertiary}>
          Notes for your coach <Txt w="m" size={14} color={colors.textTertiary} style={{ opacity: 0.7 }}>— optional</Txt>
        </Txt>
      </Card>

      <Btn label="Submit Check-In" haptic="success" onPress={s.submitCi} style={{ marginTop: 18 }} />
    </ScrollView>
  );
}

function BigStep({ glyph, onPress }: { glyph: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? 'Increase weight' : 'Decrease weight'}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' }}
    >
      <Txt w="b" size={24} color={colors.slate700}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
