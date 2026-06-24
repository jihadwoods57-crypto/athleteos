// AthleteOS — Parent mobile view: score + reassurance, weekly compliance,
// weight + nutrition trends, coach notes, AI parent summary.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { WEIGHT_START, WEIGHT_TARGET, displayWeight, displayWeightDelta, monitoredAthlete, weightUnit, nutritionTrend, weeklyCompliance, weightSeries, weightTrendGeometry } from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, SampleTag, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Ring } from '@/ui/Ring';
import { Account } from '@/screens/overlays/Account';

export function ParentView() {
  const s = useStore();
  const d = useDerived();
  // Weekly compliance derived from the SAME real score history the Home trend
  // chart draws, so the parent's view tracks the athlete's actual week instead
  // of a static 6/7 mock. Today is shown in progress; the % is the completed-day mean.
  const week = weeklyCompliance(s.scoreHistory, d.athleteScore);
  // Weight trend drawn from real recorded weights (live currentWeight as the
  // last point), ramping from WEIGHT_START while history is still filling. The
  // dashed goal line tracks the athlete's editable weight target.
  const weightTarget = s.weightTarget ?? WEIGHT_TARGET;
  const startWeight = s.startWeight ?? WEIGHT_START;
  const wt = weightTrendGeometry(weightSeries(s.weightHistory, s.currentWeight, startWeight), weightTarget);
  const units = s.units ?? 'imperial';
  const wUnit = weightUnit(units);
  // Nutrition bars from real per-day nutrition sub-scores; today's live score is
  // the last (accent) bar, the weekly avg headline is the completed-day mean.
  const nutri = nutritionTrend(s.nutritionHistory, d.nutritionScore);
  // The athlete this parent monitors: a real parent typed their child's name in
  // onboarding (obMeta.athleteName); the seeded demo leaves it blank and keeps
  // the showcase athlete "Jihad". So the header, reassurance line, and AI summary
  // never hand a real family the demo name, and the seeded "Coach Davis" note
  // only renders for the showcase (a real parent gets a pending empty state
  // instead of a fabricated coach quote).
  const athlete = monitoredAthlete(s.obMeta.athleteName);

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
                <Row style={{ gap: 7, marginTop: 5 }}>
                  <SampleTag />
                  <Txt w="sb" size={12} color={colors.textTertiary}>
                    Sample data, not yet linked to your athlete
                  </Txt>
                </Row>
              </View>
            </Row>
            <Row style={[{ gap: 7, backgroundColor: '#fff', padding: 7, borderRadius: 13 }, shadow.card]}>
              <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Txt w="b" size={13} color="#fff">
                  {athlete.monogram}
                </Txt>
              </View>
              <Txt w="b" size={13} style={{ paddingRight: 3 }}>
                {athlete.first}
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
                {athlete.first} is on track and building strong habits this week.
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
                  {week.onPlan} of {week.total} days on plan
                </Txt>
              </View>
              <Txt w="eb" size={30} color={colors.success} ls={-0.5}>
                {week.pct}%
              </Txt>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              {week.days.map((w, i) => (
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
                    {w.label}
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
                  8-week build · goal {displayWeight(weightTarget, units)} {wUnit}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt w="eb" size={26} ls={-0.5}>
                  {displayWeight(s.currentWeight, units)}
                  <Txt w="sb" size={13} color={colors.textTertiary}>
                    {' '}
                    {wUnit}
                  </Txt>
                </Txt>
                {(() => {
                  const gain = displayWeightDelta(s.currentWeight - startWeight, units);
                  return (
                    <Txt w="b" size={12} color={gain >= 0 ? colors.success : colors.alert}>
                      {gain >= 0 ? `↑ +${gain}` : `↓ ${gain}`} {wUnit}
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
              <Line x1="0" y1={wt.goalY} x2="322" y2={wt.goalY} stroke="#22C55E" strokeWidth="1.5" strokeDasharray="5 5" strokeOpacity="0.5" />
              <Path d={wt.areaPath} fill="url(#pwt)" />
              <Path d={wt.linePath} fill="none" stroke="#2563EB" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={wt.last.x} cy={wt.last.y} r={5.5} fill="#2563EB" stroke="#fff" strokeWidth={2.5} />
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
                  {nutri.avg}%
                </Txt>
                <Txt w="sb" size={12} color={colors.textSecondary}>
                  weekly avg
                </Txt>
              </View>
            </Row>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', height: 96 }}>
              {nutri.bars.map((h, i) => {
                const today = i === nutri.bars.length - 1;
                return (
                  <View key={i} style={{ alignItems: 'center', gap: 7, flex: 1 }}>
                    <View style={{ width: 22, height: 86, borderRadius: 6, backgroundColor: colors.track, justifyContent: 'flex-end', overflow: 'hidden' }}>
                      <View style={{ width: '100%', height: `${Math.max(0, Math.min(100, h))}%`, borderRadius: 6, backgroundColor: today ? '#93C5FD' : colors.accent }} />
                    </View>
                    <Txt w="b" size={11} color={today ? colors.accent : colors.textTertiary}>
                      {week.days[i]?.label ?? ''}
                    </Txt>
                  </View>
                );
              })}
            </Row>
          </Card>

          {/* coach notes */}
          <Card elevated style={{ marginTop: 14, borderRadius: 24 }}>
            <Txt w="eb" size={16} ls={-0.3} style={{ marginBottom: 16 }}>
              Coach Notes
            </Txt>
            {athlete.isDemo ? (
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
                    Jihad's nutrition has been excellent. He's one of the most consistent in the linebacker room. We're focused on adding sleep to convert this into on-field strength. Great support at home.
                  </Txt>
                </View>
              </Row>
            ) : (
              <Row style={{ gap: 13, alignItems: 'flex-start' }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="user" size={18} color={colors.slate600} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt w="b" size={14}>
                    No notes yet
                  </Txt>
                  <Txt w="m" size={14} color={colors.slate700} style={{ marginTop: 7, lineHeight: 21 }}>
                    When {athlete.first}'s coach leaves a note, it shows up here so you stay in the loop.
                  </Txt>
                </View>
              </Row>
            )}
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
              No action needed this week. {athlete.first} is meeting protein and recovery targets and trending toward the weight goal. You'll get an alert if anything slips.
            </Txt>
          </View>
        </ScrollView>
      </SafeAreaView>

      {s.accountOpen && <Account />}
    </View>
  );
}
