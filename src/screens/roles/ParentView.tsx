// AthleteOS — Parent mobile view: score + reassurance, weekly compliance,
// weight + nutrition trends, coach notes, AI parent summary.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { WEIGHT_START, WEIGHT_TARGET } from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Ring } from '@/ui/Ring';
import { Account } from '@/screens/overlays/Account';

const WEEK = [
  { d: 'M', ok: true },
  { d: 'T', ok: true },
  { d: 'W', ok: false },
  { d: 'T', ok: true },
  { d: 'F', ok: true },
  { d: 'S', ok: true },
  { d: 'S', today: true },
];
const NUTRI_BARS = [86, 100, 72, 100, 90, 94, 79];

export function ParentView() {
  const s = useStore();
  const d = useDerived();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ gap: 12 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Account & settings" hitSlop={6} onPress={s.openAccount} style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
                <Icon name="menu" size={20} color={colors.slate600} />
              </Pressable>
              <View>
                <Txt w="sb" size={13} color={colors.textSecondary}>
                  Parent View
                </Txt>
                <Txt w="eb" size={21} ls={-0.3}>
                  This week
                </Txt>
              </View>
            </Row>
            <Row style={[{ gap: 7, backgroundColor: '#fff', padding: 7, borderRadius: 13 }, shadow.card]}>
              <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Txt w="b" size={13} color="#fff">
                  J
                </Txt>
              </View>
              <Txt w="b" size={13} style={{ paddingRight: 3 }}>
                Jihad
              </Txt>
            </Row>
          </Row>

          {/* score */}
          <Card elevated style={{ marginTop: 18, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <Ring size={104} pct={d.athleteScore} stroke={17} gradient={['#22C55E', '#16A34A']} track="#EFF2F6">
              <Txt w="eb" size={34} ls={-0.5}>
                {d.athleteScore}
              </Txt>
              <Txt w="eb" size={10} color={d.grade.c}>
                GRADE {d.grade.g}
              </Txt>
            </Ring>
            <View style={{ flex: 1 }}>
              <Txt w="b" size={13} color={colors.textSecondary}>
                Athlete Score
              </Txt>
              <Row style={{ gap: 6, marginTop: 6 }}>
                <Txt w="eb" size={15} color={d.deltaColor}>
                  {d.deltaStr}
                </Txt>
                <Txt w="sb" size={13} color={colors.textTertiary}>
                  vs last week
                </Txt>
              </Row>
              <Txt w="sb" size={14} color={colors.slate700} style={{ marginTop: 11, lineHeight: 20 }}>
                Jihad is on track and building strong habits this week.
              </Txt>
            </View>
          </Card>

          {/* weekly compliance */}
          <Card elevated style={{ marginTop: 14, borderRadius: 24 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
              <View>
                <Txt w="eb" size={16} ls={-0.3}>
                  Weekly Compliance
                </Txt>
                <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 3 }}>
                  6 of 7 days on plan
                </Txt>
              </View>
              <Txt w="eb" size={30} color={colors.success} ls={-0.5}>
                86%
              </Txt>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              {WEEK.map((w, i) => (
                <View key={i} style={{ alignItems: 'center', gap: 8 }}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 11,
                      backgroundColor: w.today ? colors.accentSurface : w.ok ? colors.successSurface : '#FEE2E2',
                      borderWidth: w.today ? 2 : 0,
                      borderColor: colors.accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {w.today ? (
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />
                    ) : w.ok ? (
                      <Icon name="check" size={15} color={colors.successDeep} />
                    ) : (
                      <Icon name="close" size={13} color={colors.alertDeep} />
                    )}
                  </View>
                  <Txt w="b" size={11} color={w.today ? colors.accent : colors.textTertiary}>
                    {w.d}
                  </Txt>
                </View>
              ))}
            </Row>
          </Card>

          {/* weight trend */}
          <Card elevated style={{ marginTop: 14, borderRadius: 24 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Txt w="eb" size={16} ls={-0.3}>
                  Weight Trend
                </Txt>
                <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 3 }}>
                  8-week build · goal {s.weightTarget ?? WEIGHT_TARGET} lb
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt w="eb" size={26} ls={-0.5}>
                  {s.currentWeight}
                  <Txt w="sb" size={13} color={colors.textTertiary}>
                    {' '}
                    lb
                  </Txt>
                </Txt>
                {(() => {
                  const gain = Math.round((s.currentWeight - WEIGHT_START) * 10) / 10;
                  return (
                    <Txt w="b" size={12} color={gain >= 0 ? colors.success : colors.alert}>
                      {gain >= 0 ? `↑ +${gain}` : `↓ ${gain}`} lb
                    </Txt>
                  );
                })()}
              </View>
            </Row>
            <Svg viewBox="0 0 322 134" width="100%" height={120} preserveAspectRatio="none" style={{ marginTop: 6 }}>
              <Defs>
                <LinearGradient id="pwt" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#2563EB" stopOpacity="0.18" />
                  <Stop offset="1" stopColor="#2563EB" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Line x1="0" y1="30" x2="322" y2="30" stroke="#22C55E" strokeWidth="1.5" strokeDasharray="5 5" strokeOpacity="0.5" />
              <Path d="M12,95 L55,90 L97,95 L140,85 L182,80 L225,70 L267,65 L310,60 L310,134 L12,134 Z" fill="url(#pwt)" />
              <Path d="M12,95 L55,90 L97,95 L140,85 L182,80 L225,70 L267,65 L310,60" fill="none" stroke="#2563EB" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={310} cy={60} r={5.5} fill="#2563EB" stroke="#fff" strokeWidth={2.5} />
            </Svg>
          </Card>

          {/* nutrition consistency */}
          <Card elevated style={{ marginTop: 14, borderRadius: 24 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
              <View>
                <Txt w="eb" size={16} ls={-0.3}>
                  Nutrition Trend
                </Txt>
                <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 3 }}>
                  Daily protein target hit
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt w="eb" size={26} ls={-0.5}>
                  92%
                </Txt>
                <Txt w="sb" size={12} color={colors.textSecondary}>
                  weekly avg
                </Txt>
              </View>
            </Row>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', height: 96 }}>
              {NUTRI_BARS.map((h, i) => (
                <View key={i} style={{ alignItems: 'center', gap: 7, flex: 1 }}>
                  <View style={{ width: 22, height: 86, borderRadius: 6, backgroundColor: colors.track, justifyContent: 'flex-end', overflow: 'hidden' }}>
                    <View style={{ width: '100%', height: `${h}%`, borderRadius: 6, backgroundColor: i === 6 ? '#93C5FD' : colors.accent }} />
                  </View>
                  <Txt w="b" size={11} color={i === 6 ? colors.accent : colors.textTertiary}>
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}
                  </Txt>
                </View>
              ))}
            </Row>
          </Card>

          {/* coach notes */}
          <Card elevated style={{ marginTop: 14, borderRadius: 24 }}>
            <Txt w="eb" size={16} ls={-0.3} style={{ marginBottom: 16 }}>
              Coach Notes
            </Txt>
            <Row style={{ gap: 13, alignItems: 'flex-start' }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' }}>
                <Txt w="b" size={14} color="#fff">
                  CD
                </Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt w="b" size={14}>
                    Coach Davis
                  </Txt>
                  <Txt w="sb" size={12} color={colors.textTertiary}>
                    2 days ago
                  </Txt>
                </Row>
                <Txt w="m" size={14} color={colors.slate700} style={{ marginTop: 7, lineHeight: 21 }}>
                  Jihad's nutrition has been excellent — he's one of the most consistent in the linebacker room. We're focused on adding sleep to convert this into on-field strength. Great support at home.
                </Txt>
              </View>
            </Row>
          </Card>

          {/* AI parent summary */}
          <View style={{ marginTop: 14, borderRadius: 20, padding: 20, backgroundColor: colors.accentSurface, borderWidth: 1, borderColor: colors.accentBorder, flexDirection: 'row', gap: 13 }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={17} color={colors.accent} />
            </View>
            <Txt w="m" size={14} color={colors.slate700} style={{ flex: 1, lineHeight: 21 }}>
              <Txt w="b" size={14} color={colors.accent}>
                For you ·{' '}
              </Txt>
              No action needed this week. Jihad is meeting his protein and recovery targets and trending toward his weight goal. You'll get an alert if anything slips.
            </Txt>
          </View>
        </ScrollView>
      </SafeAreaView>

      {s.accountOpen && <Account />}
    </View>
  );
}
