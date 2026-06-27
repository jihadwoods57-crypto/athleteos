// AthleteOS — Athlete Home: score hero, season goal, trend, progress, insight,
// coach guidance, next action, check-in banner.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  aiInsight,
  currentStreak,
  coachGuidance,
  DEFAULT_CHART_BOX,
  displayWeight,
  firstName,
  greeting,
  initials,
  displayWeightDelta,
  heroStatus,
  HYDRATION_TARGET,
  realTrendDays,
  recentDayLabels,
  SCORE_WEIGHTS,
  seasonGoalProgress,
  seasonGoalPhase,
  supportAudience,
  weightUnit,
  WEIGHT_START,
  WEIGHT_TARGET,
  TREND_WINDOW,
  trendGeometry,
  trendSeries,
  trendSummary,
} from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, MAX_FONT_SCALE, shadow } from '@/ui/tokens';
import { Card, ProgressBar, Row, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Ring } from '@/ui/Ring';

export function Home() {
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = useDerived();
  const name = firstName(s.athleteName, 'Jihad');
  const monogram = initials(s.athleteName, 'J');
  // Human-coach guidance, gated so a brand-new real athlete with no coach never
  // sees the seeded demo's "Coach Davis" note (the demo showcase is unchanged).
  const guidance = coachGuidance({
    isReal: s.athleteName.trim().length > 0,
    supportTeam: s.supportTeam,
    coachNote: s.coachNote,
  });
  // Where a completed check-in is sent, gated so a real solo athlete (no coach)
  // is not told it went to "Coach Davis"; the demo keeps the showcase recipient.
  const checkinAudience = supportAudience({ isReal: s.athleteName.trim().length > 0, supportTeam: s.supportTeam, demo: 'Coach Davis' });

  // Real trend geometry: persisted prior-day scores + today's live score as the
  // final point (seed pads the left only while real history is still filling up).
  const series = trendSeries(s.scoreHistory, d.athleteScore);
  const trend = trendSummary(series);
  const dayLabels = recentDayLabels(series.length);
  // Honest trend subtitle: until a real week has accrued, the chart's left is
  // seeded padding — say "Building history · N of 7 days" instead of claiming a
  // full "Past 7 days" the brand-new athlete hasn't lived yet.
  const realDays = realTrendDays(s.scoreHistory);
  const trendCaption =
    realDays >= TREND_WINDOW ? 'Past 7 days' : `Building history · ${realDays} of ${TREND_WINDOW} days`;
  // Day streak: consecutive on-plan days ending today (live score + real
  // history; seeded baseline pads the unknown pre-history like the trend chart).
  const streak = currentStreak(s.scoreHistory, d.athleteScore);

  // Season weight goal — per-athlete start anchor (their onboarding weight, or the
  // demo's WEIGHT_START), athlete-editable target, live weight.
  const START = s.startWeight ?? WEIGHT_START;
  const TARGET = s.weightTarget ?? WEIGHT_TARGET;
  const goal = seasonGoalProgress(s.currentWeight, START, TARGET);
  // Honesty gate: don't claim "On track, you'll reach X by Nov 7" before any real
  // weight movement exists (a day-0 athlete still sits at their start anchor).
  const goalPhase = seasonGoalPhase({
    pctThere: goal.pctThere,
    currentWeight: s.currentWeight,
    start: START,
    weightHistoryLen: (s.weightHistory ?? []).length,
  });
  const units = s.units ?? 'imperial';
  const wUnit = weightUnit(units);
  const remainingDisp = displayWeightDelta(goal.remaining, units);

  // Reactive score-hero status line + standing badge (pure-core helper). Tone
  // maps to existing surface/text tokens at this call site — no new tokens.
  const status = heroStatus(s, d);
  const toneSurface =
    status.tone === 'warn' ? colors.alertSurface : status.tone === 'positive' ? colors.successSurface : colors.accentSurface;
  const toneText =
    status.tone === 'warn' ? colors.alertDeep : status.tone === 'positive' ? colors.successDeep : colors.accent;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      {/* header */}
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Txt w="sb" size={14} color={colors.textSecondary}>
            {greeting()},
          </Txt>
          <Txt w="eb" size={28} ls={-0.8} style={{ marginTop: 1 }}>
            {name}
          </Txt>
        </View>
        <Row style={{ gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Notifications" hitSlop={6} onPress={s.openNotif} style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
            <Icon name="bell" size={19} color={colors.slate600} />
            <View style={{ position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.alert, borderWidth: 1.5, borderColor: '#fff' }} />
          </Pressable>
          <Row
            accessibilityRole="text"
            accessibilityLabel={`${streak} day streak`}
            style={[{ gap: 6, backgroundColor: '#fff', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 13 }, shadow.card]}
          >
            <Icon name="flame" size={15} color={colors.warning} />
            <Txt w="eb" size={14} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {streak}
            </Txt>
          </Row>
          <Pressable accessibilityRole="button" accessibilityLabel="Profile" hitSlop={6} onPress={s.goProfile} style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="b" size={14} color="#fff" maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {monogram}
            </Txt>
          </Pressable>
        </Row>
      </Row>

      {/* score hero */}
      <Card elevated style={{ marginTop: 18, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 20, padding: 24 }}>
        <Ring size={138} pct={d.athleteScore} stroke={17} gradient={['#22C55E', '#16A34A']} track="#EFF2F6">
          <Txt w="eb" size={48} ls={-2} style={{ lineHeight: 50 }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {d.athleteScore}
          </Txt>
          <View style={{ marginTop: 5, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 7, backgroundColor: d.grade.bg }}>
            <Txt w="eb" size={11} color={d.grade.c} ls={0.4} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              GRADE {d.grade.g}
            </Txt>
          </View>
        </Ring>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={13} color={colors.textSecondary}>
            Development Score
          </Txt>
          <Row style={{ gap: 6, marginTop: 7 }}>
            <Txt w="eb" size={15} color={d.deltaColor}>
              {d.deltaStr}
            </Txt>
            <Txt w="sb" size={13} color={colors.textTertiary}>
              this week
            </Txt>
          </Row>
          <Txt w="sb" size={14} color={colors.slate700} style={{ marginTop: 13, lineHeight: 20 }}>
            {status.line}
          </Txt>
          <View style={{ marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, backgroundColor: toneSurface }}>
            <Txt w="b" size={12} color={toneText}>
              {status.standingLabel}
            </Txt>
          </View>
        </View>
      </Card>

      {/* what's in this score */}
      <ScoreBreakdownPanel />

      {/* season goal */}
      <Card elevated style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="eb" size={12} color={colors.textTertiary} ls={0.7}>
            SEASON GOAL
          </Txt>
          <Row style={{ gap: 6, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, backgroundColor: colors.accentSurface }}>
            <Icon name="checkin" size={12} color={colors.accent} />
            <Txt w="eb" size={12} color={colors.accent}>
              38 days left
            </Txt>
          </Row>
        </Row>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
          <View>
            <Txt w="eb" size={29} ls={-0.9}>
              {displayWeight(TARGET, units)} {wUnit}
              <Txt w="b" size={15} color={colors.textTertiary}>
                {' '}
                target
              </Txt>
            </Txt>
            <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 3 }}>
              by Playoffs · Nov 14
            </Txt>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt w="eb" size={20} color={colors.success}>
              {remainingDisp > 0 ? `+${remainingDisp}` : remainingDisp} to go
            </Txt>
            <Txt w="sb" size={12} color={colors.textTertiary}>
              now {displayWeight(s.currentWeight, units)} {wUnit}
            </Txt>
          </View>
        </Row>
        <View style={{ marginTop: 16 }}>
          <ProgressBar pct={goal.pctThere} height={10} />
        </View>
        <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
          <Txt w="b" size={11} color={colors.textTertiary}>
            {displayWeight(START, units)} start
          </Txt>
          <Txt w="b" size={11} color={colors.textTertiary}>
            {goal.pctThere}% there
          </Txt>
          <Txt w="b" size={11} color={colors.textTertiary}>
            {displayWeight(TARGET, units)} goal
          </Txt>
        </Row>
        <View
          style={{
            marginTop: 14,
            borderRadius: 14,
            padding: 13,
            backgroundColor: goalPhase === 'first-run' ? '#F1F5F9' : '#ECFDF5',
          }}
        >
          <Txt
            w="m"
            size={13}
            color={goalPhase === 'first-run' ? colors.textSecondary : '#065F46'}
            style={{ lineHeight: 19 }}
          >
            <Txt
              w="b"
              size={13}
              color={goalPhase === 'first-run' ? colors.textSecondary : '#065F46'}
            >
              {goalPhase === 'reached' ? 'Goal reached ·' : goalPhase === 'first-run' ? 'Just getting started ·' : 'On track ·'}{' '}
            </Txt>
            {goalPhase === 'reached'
              ? `You hit ${displayWeight(TARGET, units)} ${wUnit}. Season weight goal complete.`
              : goalPhase === 'first-run'
                ? 'Log your check-ins and weight to see your pace toward the season goal.'
                : `At your current pace you'll reach ${displayWeight(TARGET, units)} ${wUnit} by Nov 7, a week ahead of playoffs.`}
          </Txt>
        </View>
      </Card>

      {/* score trend */}
      <Card elevated style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <View>
            <Txt w="eb" size={16} ls={-0.3}>
              Score Trend
            </Txt>
            <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 3 }}>
              {trendCaption}
            </Txt>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt w="eb" size={26} ls={-0.5}>
              {d.athleteScore}
            </Txt>
            <Txt
              w="b"
              size={12}
              color={trend.dir === 'down' ? colors.alert : trend.dir === 'flat' ? colors.textTertiary : colors.success}
            >
              {trend.label}
            </Txt>
          </View>
        </Row>
        <TrendChart series={series} />
        <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
          {dayLabels.map((dn, i) => (
            <Txt key={`${dn}-${i}`} w="sb" size={11} color={colors.textTertiary}>
              {dn}
            </Txt>
          ))}
        </Row>
      </Card>

      {/* today's progress */}
      <Card elevated style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
        <Txt w="eb" size={16} ls={-0.3} style={{ marginBottom: 18 }}>
          Today's Progress
        </Txt>
        <ProgressRow label="Protein" meta={`${d.proteinToday} / ${d.proteinTarget}g`} pct={d.proteinPct} color={colors.accent} />
        <ProgressRow label="Hydration" meta={`${s.hydrationL} / ${HYDRATION_TARGET} L  +`} metaColor={colors.accent} onMeta={s.addWater} pct={d.hydrationPct} color={colors.hydration} />
        <ProgressRow label="Tasks" meta={`${d.tasksDone} / ${d.tasksTotal} done`} pct={d.tasksScore} color={colors.accent} />
        <ProgressRow label="Recovery" meta={`${d.recoveryScore} / 100`} pct={d.recoveryScore} color={colors.success} last />
      </Card>

      {/* nutrition entry */}
      <Pressable accessibilityRole="button" accessibilityLabel="Nutrition: see today's meals, protein, and fuel" onPress={s.goNutrition} style={[{ marginTop: 14, backgroundColor: '#fff', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }, shadow.card]}>
        <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="flame" size={22} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={15}>
            Nutrition
          </Txt>
          <Txt w="m" size={13} color={colors.textSecondary}>
            See today's meals, protein, and fuel
          </Txt>
        </View>
        <Icon name="chevronRight" size={22} color="#CBD5E1" />
      </Pressable>

      {/* performance entry */}
      <Pressable accessibilityRole="button" accessibilityLabel="Performance: log a PR and see your trends" onPress={s.goPerformance} style={[{ marginTop: 12, backgroundColor: '#fff', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }, shadow.card]}>
        <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="trophy" size={22} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={15}>
            Performance
          </Txt>
          <Txt w="m" size={13} color={colors.textSecondary}>
            Log a PR and see your trends
          </Txt>
        </View>
        <Icon name="chevronRight" size={22} color="#CBD5E1" />
      </Pressable>

      {/* AI insight */}
      <Card elevated style={{ marginTop: 14, borderRadius: 24, padding: 20, flexDirection: 'row', gap: 14 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={12} color={colors.accent} ls={0.4}>
            AI INSIGHT
          </Txt>
          <Txt w="sb" size={14} color={colors.slate700} style={{ marginTop: 5, lineHeight: 20 }}>
            {aiInsight(s, d)}
          </Txt>
        </View>
      </Card>

      {/* coach guidance — hidden for a solo real athlete (no coach to quote) */}
      {guidance.show ? (
        <Card elevated style={{ marginTop: 14, borderRadius: 24, padding: 20, flexDirection: 'row', gap: 14 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="b" size={13} color="#fff">
              {guidance.monogram}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Row style={{ gap: 7, flexWrap: 'wrap' }}>
              <Txt w="eb" size={12} ls={0.4}>
                COACH GUIDANCE
              </Txt>
              {guidance.pending ? null : (
                <View style={{ backgroundColor: colors.accentSurface, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                  <Txt w="b" size={10} color={colors.accent}>
                    Remembered by AI
                  </Txt>
                </View>
              )}
            </Row>
            <Txt w="sb" size={14} color={colors.slate700} style={{ marginTop: 6, lineHeight: 20 }}>
              {guidance.note ?? 'Your coach can leave a standing note here. The AI keeps it in front of you every day until it sticks.'}
            </Txt>
          </View>
        </Card>
      ) : null}

      {/* next action */}
      {!s.meals.dinner ? (
        <Pressable onPress={s.openMeal} style={[{ marginTop: 14, backgroundColor: '#fff', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }, shadow.card]}>
          <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="b" size={15}>
              Log dinner
            </Txt>
            <Txt w="m" size={13} color={colors.textSecondary}>
              Due by 8:00 PM · last meal of the day
            </Txt>
          </View>
          <Icon name="chevronRight" size={22} color="#CBD5E1" />
        </Pressable>
      ) : (
        <View style={[{ marginTop: 14, backgroundColor: '#fff', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }, shadow.card]}>
          <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: colors.successSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={20} color={colors.successDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="b" size={15}>
              Dinner logged
            </Txt>
            <Txt w="m" size={13} color={colors.textSecondary}>
              All meals in · day complete
            </Txt>
          </View>
          <Txt w="eb" size={13} color={colors.successDeep}>
            +5 pts
          </Txt>
        </View>
      )}

      {/* check-in banner */}
      {!s.ciSubmitted ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Weekly check-in due: 6 questions, about 2 minutes" onPress={s.goCheckin} style={[{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, shadow.cta]}>
          <View>
            <Txt w="eb" size={11} color="rgba(255,255,255,0.85)" ls={0.7}>
              WEEKLY CHECK-IN DUE
            </Txt>
            <Txt w="b" size={15} color="#fff" style={{ marginTop: 5 }}>
              6 questions · 2 min · 2 days left
            </Txt>
          </View>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevronRight" size={18} color="#fff" />
          </View>
        </Pressable>
      ) : (
        <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Txt w="eb" size={11} color="#059669" ls={0.7}>
              WEEKLY CHECK-IN
            </Txt>
            <Txt w="b" size={15} color="#065F46" style={{ marginTop: 5 }}>
              {checkinAudience ? `Completed · sent to ${checkinAudience}` : 'Completed'}
            </Txt>
          </View>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={17} color="#fff" />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function ScoreBreakdownPanel() {
  const [open, setOpen] = React.useState(false);
  return (
    <Card elevated style={{ marginTop: 14, borderRadius: 20, padding: 18 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="What's in this score?"
        accessibilityState={{ expanded: open }}
        onPress={() => { haptics.tap(); setOpen((v) => !v); }}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Row style={{ gap: 9, flex: 1 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={16} color={colors.accent} />
          </View>
          <Txt w="eb" size={15} ls={-0.3}>
            What's in this score?
          </Txt>
        </Row>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chevronRight" size={20} color="#CBD5E1" />
        </View>
      </Pressable>
      {open ? (
        <View style={{ marginTop: 16, gap: 13 }}>
          {SCORE_WEIGHTS.map((w) => (
            <View key={w.key}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt w="b" size={14}>
                  {w.label}
                </Txt>
                <Txt w="eb" size={14} color={colors.accent}>
                  {w.pct}%
                </Txt>
              </Row>
              <Txt w="m" size={12} color={colors.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>
                {w.desc}
              </Txt>
            </View>
          ))}
          <Txt w="m" size={12} color={colors.textTertiary} style={{ lineHeight: 17 }}>
            Nutrition counts the most. Recovery and check-in are answers you give yourself. Your weight progress is tracked separately, not folded into this daily score.
          </Txt>
        </View>
      ) : null}
    </Card>
  );
}

function ProgressRow({ label, meta, pct, color, metaColor, onMeta, last }: { label: string; meta: string; pct: number; color: string; metaColor?: string; onMeta?: () => void; last?: boolean }) {
  return (
    <View style={{ marginBottom: last ? 0 : 17 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <Txt w="b" size={14}>
          {label}
        </Txt>
        <Pressable onPress={onMeta} disabled={!onMeta}>
          <Txt w={onMeta ? 'b' : 'sb'} size={13} color={metaColor ?? colors.textSecondary}>
            {meta}
          </Txt>
        </Pressable>
      </Row>
      <ProgressBar pct={pct} height={9} color={color} />
    </View>
  );
}

function TrendChart({ series }: { series: number[] }) {
  const box = DEFAULT_CHART_BOX;
  const { linePath, areaPath, last } = trendGeometry(series, box);
  return (
    <Svg viewBox={`0 0 ${box.width} ${box.height}`} width="100%" height={100} preserveAspectRatio="none" style={{ marginTop: 6 }}>
      <Defs>
        <LinearGradient id="trend" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#22C55E" stopOpacity="0.18" />
          <Stop offset="1" stopColor="#22C55E" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d={areaPath} fill="url(#trend)" />
      <Path d={linePath} fill="none" stroke="#22C55E" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={last.x} cy={last.y} r={5.5} fill="#22C55E" stroke="#fff" strokeWidth={2.5} />
    </Svg>
  );
}
