// AthleteOS — Athlete Home: score hero, season goal, trend, progress, insight,
// coach guidance, next action, check-in banner.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  currentStreak,
  coachGuidance,
  medicalDisclaimer,
  nextBestAction,
  projectedScore,
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
import { aiMemoryTag } from '@/lib/ai';
import { colors, gradeRing, MAX_FONT_SCALE, shadow, typeScale } from '@/ui/tokens';
import { Card, ProgressBar, Row, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Ring } from '@/ui/Ring';

export function Home() {
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = useDerived();
  // Forward-looking framing: where the score reaches if the day's controllable actions
  // get done, and the checklist to get there. Shown only while actions remain.
  const projection = projectedScore(s);
  // Reward moment: when the score changes (e.g. after logging a meal), the hero number +
  // ring count up to the new value instead of snapping — the satisfying "it moved" beat.
  const shownScore = useCountUp(d.athleteScore);
  const name = firstName(s.athleteName, 'Jihad');
  const monogram = initials(s.athleteName, 'J');
  // A real athlete has set their name; the unnamed seeded state is the demo showcase.
  // Used to gate showcase-only strings that have no real data source (a season
  // deadline, an unread-notification dot) so a real user never sees fabricated data.
  const isReal = s.athleteName.trim().length > 0;
  // Human-coach guidance, gated so a brand-new real athlete with no coach never
  // sees the seeded demo's "Coach Davis" note (the demo showcase is unchanged).
  const guidance = coachGuidance({
    isReal,
    supportTeam: s.supportTeam,
    coachNote: s.coachNote,
  });
  // Where a completed check-in is sent, gated so a real solo athlete (no coach)
  // is not told it went to "Coach Davis"; the demo keeps the showcase recipient.
  const checkinAudience = supportAudience({ isReal, supportTeam: s.supportTeam, demo: 'Coach Davis' });

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
  // Real athlete: only days actually earned. Seeded demo: pad with the showcase lead.
  const streak = currentStreak(s.scoreHistory, d.athleteScore, undefined, !isReal);

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
            {/* The unread-notification dot is showcase only: there is no real
                seen/unseen model, so an always-on dot would fake unread urgency for
                a real athlete. Shown for the seeded demo, hidden for a real user. */}
            {!isReal ? (
              <View style={{ position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.alert, borderWidth: 1.5, borderColor: '#fff' }} />
            ) : null}
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
        <Ring size={138} pct={shownScore} stroke={17} gradient={gradeRing[d.grade.g] ?? gradeRing.C} track="#EFF2F6">
          <Txt w="eb" size={typeScale.display.size} ls={typeScale.display.ls} style={{ lineHeight: typeScale.display.lineHeight }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {shownScore}
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

      {/* finish today — projected score + the checklist to reach it */}
      {projection.actions.length > 0 ? (
        <Card elevated style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Txt w="eb" size={12} color={colors.textTertiary} ls={0.7}>
                FINISH TODAY
              </Txt>
              <Row style={{ gap: 8, alignItems: 'center', marginTop: 6 }}>
                <Txt w="sb" size={15} color={colors.textTertiary}>
                  {projection.current}
                </Txt>
                <Icon name="chevronRight" size={16} color={colors.textTertiary} />
                <Txt w="eb" size={30} ls={-0.5} color={colors.accent}>
                  {projection.projected}
                </Txt>
              </Row>
            </View>
            <View style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, backgroundColor: colors.successSurface }}>
              <Txt w="eb" size={15} color={colors.successDeep}>
                +{projection.gain}
              </Txt>
            </View>
          </Row>
          <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 12, lineHeight: 19 }}>
            Finish today&apos;s plan and your Development Score reaches {projection.projected}.
          </Txt>
          <View style={{ marginTop: 12, gap: 10 }}>
            {projection.actions.map((a) => (
              <Row key={a.key} style={{ gap: 11, alignItems: 'center' }}>
                <View style={{ width: 20, height: 20, borderRadius: 7, borderWidth: 2, borderColor: colors.accentBorder }} />
                <Txt w="b" size={14} color={colors.slate700} style={{ flex: 1 }}>
                  {a.label}
                </Txt>
              </Row>
            ))}
          </View>
        </Card>
      ) : null}

      {/* what's in this score */}
      <ScoreBreakdownPanel />

      {/* season goal */}
      <Card elevated style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="eb" size={12} color={colors.textTertiary} ls={0.7}>
            SEASON GOAL
          </Txt>
          {/* "38 days left" / "Nov 14" are showcase deadlines with no real data
              source (no season deadline is collected yet). Demo keeps the showcase;
              a real athlete sees no fabricated countdown. */}
          {!isReal ? (
            <Row style={{ gap: 6, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, backgroundColor: colors.accentSurface }}>
              <Icon name="checkin" size={12} color={colors.accent} />
              <Txt w="eb" size={12} color={colors.accent}>
                38 days left
              </Txt>
            </Row>
          ) : null}
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
            {!isReal ? (
              <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 3 }}>
                by Playoffs · Nov 14
              </Txt>
            ) : null}
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
                : isReal
                ? `At your current pace you'll reach ${displayWeight(TARGET, units)} ${wUnit}.`
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
      {/* performance entry (Nutrition + Check-In now live in the tab bar / their banners) */}
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
                    {aiMemoryTag}
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

      {/* your next move — the single highest-impact action right now, forward-looking
          (a coach, not a scorekeeper). Derived from real logged data + the hour. */}
      {(() => {
        const na = nextBestAction(s, d);
        const onPress =
          na.cta === 'meal' ? s.openMeal
          : na.cta === 'water' ? s.addWater
          : na.cta === 'checkin' ? s.goCheckin
          : na.cta === 'plan' ? s.goTasks
          : undefined;
        const accent = na.done ? colors.successDeep : colors.accent;
        const tileBg = na.done ? colors.successSurface : colors.accentSurface;
        const body = (
          <>
            <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: tileBg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={na.done ? 'check' : 'sparkle'} size={20} color={accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={11} color={accent} ls={0.4}>
                YOUR NEXT MOVE
              </Txt>
              <Txt w="b" size={15} style={{ marginTop: 3 }}>
                {na.title}
              </Txt>
              <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
                {na.detail}
              </Txt>
              <Txt w="m" size={11} color={colors.textTertiary} style={{ marginTop: 8, lineHeight: 15 }}>
                {medicalDisclaimer()}
              </Txt>
            </View>
            {onPress ? <Icon name="chevronRight" size={22} color="#CBD5E1" /> : null}
          </>
        );
        const boxStyle = [{ marginTop: 14, backgroundColor: '#fff', borderRadius: 20, padding: 16, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14 }, shadow.card];
        return onPress ? (
          <Pressable accessibilityRole="button" accessibilityLabel={na.title} onPress={onPress} style={boxStyle}>
            {body}
          </Pressable>
        ) : (
          <View style={boxStyle}>{body}</View>
        );
      })()}

      {/* check-in banner */}
      {!s.ciSubmitted ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Weekly check-in due: 6 questions, about 2 minutes" onPress={s.goCheckin} style={[{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, shadow.cta]}>
          <View>
            <Txt w="eb" size={11} color="rgba(255,255,255,0.85)" ls={0.7}>
              WEEKLY CHECK-IN DUE
            </Txt>
            <Txt w="b" size={15} color="#fff" style={{ marginTop: 5 }}>
              6 questions · 2 min
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
  // Semantic color: a met target (>=100%) turns the bar + a check green, so "done" reads
  // at a glance instead of only from the numbers.
  const met = pct >= 100;
  return (
    <View style={{ marginBottom: last ? 0 : 17 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <Row style={{ gap: 5, alignItems: 'center' }}>
          <Txt w="b" size={14}>
            {label}
          </Txt>
          {met ? <Icon name="check" size={13} color={colors.successDeep} /> : null}
        </Row>
        <Pressable onPress={onMeta} disabled={!onMeta}>
          <Txt w={onMeta ? 'b' : 'sb'} size={13} color={metaColor ?? colors.textSecondary}>
            {meta}
          </Txt>
        </Pressable>
      </Row>
      <ProgressBar pct={pct} height={9} color={met ? colors.successDeep : color} />
    </View>
  );
}

/** Animate a number toward `target` in small steps (no Animated/Date — resume-safe and
 *  cheap). Snaps on first mount; counts up only when the value actually changes, so the
 *  hero score "moves" right after a log instead of jumping. */
function useCountUp(target: number, steps = 18, intervalMs = 28): number {
  const [val, setVal] = React.useState(target);
  const prev = React.useRef(target);
  React.useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setVal(i >= steps ? target : Math.round(from + (target - from) * (i / steps)));
      if (i >= steps) clearInterval(id);
    }, intervalMs);
    return () => clearInterval(id);
  }, [target, steps, intervalMs]);
  return val;
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
