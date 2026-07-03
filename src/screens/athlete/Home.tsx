// OnStandard — Athlete Home: score hero, season goal, trend, progress, insight,
// coach guidance, next action, check-in banner.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  streakInfo,
  coachGuidance,
  medicalDisclaimer,
  nextBestAction,
  passStatus,
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
  withinTrailingWeek,
} from '@/core';
import { useStore, useDerived } from '@/store';
import { aiMemoryTag } from '@/lib/ai';
import { isStreakGraceEnabled, isTrustPassEnabled } from '@/lib/features';
import { gradeRing, MAX_FONT_SCALE, shadow, typeScale } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Btn, Card, Input, PressScale, ProgressBar, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Ring } from '@/ui/Ring';

export function Home() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = useDerived();
  // Forward-looking framing: where the score reaches if the day's controllable actions
  // get done, and the checklist to get there. Shown only while actions remain.
  const projection = projectedScore(s);
  // Trust Pass status (pilot, flag-gated) — drives the honest camera-free banner on the commitment.
  const tpStatus = isTrustPassEnabled ? passStatus(s.trustPass, s.dateStamp) : null;
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
  // Real trend geometry: persisted prior-day scores + today's live score as the
  // final point (seed pads the left only while real history is still filling up).
  const series = trendSeries(s.scoreHistory, d.athleteScore);
  const trend = trendSummary(series);
  const dayLabels = recentDayLabels(series.length);
  // Honest trend subtitle: until a real week has accrued, the chart's left is
  // seeded padding — say "Building history · N of 7 days" instead of claiming a
  // full "Past 7 days" the brand-new athlete hasn't lived yet.
  const realDays = realTrendDays(s.scoreHistory);
  const trendCaption = d.isDay0
    ? 'Your first day · this fills in as you log'
    : realDays >= TREND_WINDOW
      ? 'Past 7 days'
      : `Building history · ${realDays} of ${TREND_WINDOW} days`;
  // Day streak: consecutive on-standard days ending today (live score + real history; seeded
  // baseline pads the unknown pre-history like the trend chart). Real athlete: only days actually
  // earned. Seeded demo: pad with the showcase lead. Grace (council 2026-07-02, flag-gated) forgives
  // one recent miss so a single off day doesn't zero a long streak; graceUsed drives a small pip,
  // atRisk lets today's sub-threshold state read honestly instead of a bare 0.
  // Real athletes walk calendar days (a day never opened is a miss); the dateless
  // showcase keeps the positional walk + its seed pad.
  const streakData = streakInfo(s.scoreHistory, d.athleteScore, { seedPad: !isReal, grace: isStreakGraceEnabled, today: isReal ? s.dateStamp : undefined });
  const streak = streakData.days;
  // Plain-English, honest streak label (council Phase 0): reads as accountability, and today's
  // at-risk / day-1 states never present a false chain.
  const streakLabel = streakData.atRisk
    ? 'Streak breaks today — log to keep your standard'
    : `${streak} ${streak === 1 ? 'day' : 'days'} on standard${streakData.graceUsed ? ' (1 grace day used)' : ''}`;

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
  // Goal-aware weight-goal copy: a Lose Fat user's target is BELOW current, so "+6 to go" / "SEASON
  // GOAL" is wrong sports-furniture for them. Performance (incl. the seeded demo) keeps the old text.
  const remainingAbs = Math.abs(remainingDisp);
  const goalEyebrow = s.baseGoal === 'performance' ? 'SEASON GOAL' : 'YOUR GOAL';
  const isMaintainGoal = s.baseGoal === 'maintain';
  const goalRemainText =
    s.baseGoal === 'lose'
      ? remainingAbs < 0.1
        ? 'On target'
        : `${remainingAbs} to lose`
      : s.baseGoal === 'gain'
        ? remainingAbs < 0.1
          ? 'On target'
          : `${remainingAbs} to gain`
        : `${remainingDisp > 0 ? `+${remainingDisp}` : remainingDisp} to go`; // performance / demo

  // Reactive score-hero status line + standing badge (pure-core helper). Tone
  // maps to existing surface/text tokens at this call site — no new tokens.
  const status = heroStatus(s, d);
  const toneSurface =
    status.tone === 'warn' ? c.alertSurface : status.tone === 'positive' ? c.successSurface : c.accentSurface;
  const toneText =
    status.tone === 'warn' ? c.alertDeep : status.tone === 'positive' ? c.successDeep : c.accent;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      {/* header */}
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Txt w="sb" size={14} color={c.textSecondary}>
            {greeting()},
          </Txt>
          <Txt w="eb" size={28} ls={-0.8} accessibilityRole="header" style={{ marginTop: 1 }}>
            {name}
          </Txt>
        </View>
        <Row style={{ gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Notifications" hitSlop={6} onPress={s.openNotif} style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
            <Icon name="bell" size={19} color={c.slate600} />
            {/* The unread-notification dot is showcase only: there is no real
                seen/unseen model, so an always-on dot would fake unread urgency for
                a real athlete. Shown for the seeded demo, hidden for a real user. */}
            {!isReal ? (
              <View style={{ position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: c.alert, borderWidth: 1.5, borderColor: c.card }} />
            ) : null}
          </Pressable>
          <Row
            accessibilityRole="text"
            accessibilityLabel={streakLabel}
            style={[{ gap: 6, backgroundColor: c.card, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 13 }, shadow.card]}
          >
            {/* Flame dims when the streak is at risk today (sub-threshold live score) so a bare "0"
                never reads as a false green; a small dot marks a spent grace day. */}
            <View>
              <Icon name="flame" size={15} color={streakData.atRisk ? c.textTertiary : c.warning} />
              {streakData.graceUsed ? (
                <View style={{ position: 'absolute', top: -2, right: -3, width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent, borderWidth: 1, borderColor: c.card }} />
              ) : null}
            </View>
            <Txt w="eb" size={14} color={streakData.atRisk ? c.textTertiary : c.text} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {streak}
            </Txt>
          </Row>
          <Pressable accessibilityRole="button" accessibilityLabel="Profile" hitSlop={6} onPress={s.goProfile} style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="b" size={14} color={c.white} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {monogram}
            </Txt>
          </Pressable>
        </Row>
      </Row>

      {/* Honest sync state (audit item 12): when the last push to the server failed, say so — an
          athlete logging on a dead connection must not believe their coach can already see today. */}
      {s.syncState === 'error' ? (
        <Row
          accessibilityRole="text"
          accessibilityLabel="Your day hasn't synced. We'll retry when you're back online."
          style={{ gap: 9, alignItems: 'center', backgroundColor: c.alertSurface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 14 }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.alert }} />
          <Txt w="sb" size={12.5} color={c.alertDeep} style={{ flex: 1 }}>
            Not synced — your coach may not see today yet. We’ll retry when you’re back online.
          </Txt>
        </Row>
      ) : null}

      {/* score hero — the one thing this screen is about, so it gets the deep `hero` float
          while everything below sits `low`. That elevation contrast IS the hierarchy. */}
      <Reveal index={0}>
      <Card variant="hero" style={{ marginTop: 20, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 20, padding: 24 }}>
        <Ring size={138} pct={shownScore} stroke={17} gradient={gradeRing[d.grade.g] ?? gradeRing.C} track={c.track}>
          <Txt w="eb" num size={typeScale.display.size} ls={typeScale.display.ls} style={{ lineHeight: typeScale.display.lineHeight }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {shownScore}
          </Txt>
          <View style={{ marginTop: 5, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 7, backgroundColor: d.grade.bg }}>
            <Txt w="eb" size={11} color={d.grade.c} ls={0.4} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              GRADE {d.grade.g}
            </Txt>
          </View>
        </Ring>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={13} color={c.textSecondary}>
            Execution Score
          </Txt>
          <Row style={{ gap: 6, marginTop: 7 }}>
            {d.isDay0 ? (
              // Day 0: no week to compare against, so show a starting-line frame instead of a
              // fabricated "↓58 this week / trending down". Naming the reveal's baseline here
              // keeps the onboarding promise ("your starting point is 49") and today's measured
              // score reading as ONE story: baseline set, now go earn today.
              <Txt w="b" size={13} color={c.accent}>
                {s.startScore != null ? `Starting today · baseline ${s.startScore}` : 'Starting today'}
              </Txt>
            ) : (
              <>
                <Txt w="eb" size={15} color={d.deltaColor}>
                  {d.deltaStr}
                </Txt>
                <Txt w="sb" size={13} color={c.textTertiary}>
                  this week
                </Txt>
              </>
            )}
          </Row>
          <Txt w="sb" size={14} color={c.slate700} style={{ marginTop: 13, lineHeight: 20 }}>
            {status.line}
          </Txt>
          <View style={{ marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, backgroundColor: toneSurface }}>
            <Txt w="b" size={12} color={toneText}>
              {status.standingLabel}
            </Txt>
          </View>
        </View>
      </Card>
      </Reveal>

      {/* daily plan-commitment — the first daily action; carries the 0.15 score slot.
          On its own a one-tap can never reach on-standard (>=80); logging your meals is
          still the only road to a top score. See docs/council/2026-07-02-trust-pass.md. */}
      <Reveal index={1}>
        <Card variant="low" style={{ marginTop: 20, borderRadius: 24, padding: 22 }}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>
            TODAY&apos;S COMMITMENT
          </Txt>
          <Txt w="eb" size={19} ls={-0.4} style={{ marginTop: 6 }}>
            Did you hit your plan today?
          </Txt>
          <Row style={{ gap: 10, marginTop: 16 }}>
            {(['yes', 'partial', 'no'] as const).map((val) => {
              const active = s.dailyCommitment === val;
              const label = val === 'yes' ? 'Yes' : val === 'partial' ? 'Partial' : 'No';
              return (
                <Pressable
                  key={val}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Hit your plan today: ${label}`}
                  onPress={() => {
                    haptics[val === 'no' ? 'tap' : 'success']();
                    s.setDailyCommitment(val);
                  }}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: 14,
                    borderRadius: 14,
                    backgroundColor: active ? c.accent : c.bg,
                    borderWidth: 2,
                    borderColor: active ? c.accent : c.border,
                  }}
                >
                  <Txt w="eb" size={15} color={active ? c.white : c.text}>
                    {label}
                  </Txt>
                </Pressable>
              );
            })}
          </Row>
          <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 12, lineHeight: 17 }}>
            One honest tap keeps your day going. Logging your meals is still how you earn a top score.
          </Txt>
          {tpStatus?.phase === 'active' ? (
            <Row style={{ gap: 8, alignItems: 'center', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border }}>
              <Icon name="sparkle" size={15} color={c.accent} />
              <Txt w="b" size={12} color={c.accent} style={{ flex: 1 }}>
                {tpStatus.isCheckDay
                  ? 'Trust Pass · spot-check today — log your meals'
                  : d.nutritionIsTrustCredited
                    ? 'On standard · Trust Pass (camera-free, credited at your proven level)'
                    : 'Trust Pass active · your tap counts camera-free'}
              </Txt>
            </Row>
          ) : null}
        </Card>
      </Reveal>

      {/* DAILY HQ — lead with the single action that matters right now, not the data */}
      <Reveal index={2}>
        <NextMoveCard />
      </Reveal>

      {/* finish today — projected score + the checklist to reach it */}
      {projection.actions.length > 0 ? (
        <Card variant="low" style={{ marginTop: 12, borderRadius: 24, padding: 22 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>
                FINISH TODAY
              </Txt>
              <Row style={{ gap: 8, alignItems: 'center', marginTop: 6 }}>
                <Txt w="sb" size={15} color={c.textTertiary}>
                  {projection.current}
                </Txt>
                <Icon name="chevronRight" size={16} color={c.textTertiary} />
                <Txt w="eb" size={30} ls={-0.5} color={c.accent}>
                  {projection.projected}
                </Txt>
              </Row>
            </View>
            <View style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, backgroundColor: c.successSurface }}>
              <Txt w="eb" size={15} color={c.successDeep}>
                +{projection.gain}
              </Txt>
            </View>
          </Row>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 12, lineHeight: 19 }}>
            Finish today&apos;s plan and your Execution Score reaches {projection.projected}.
          </Txt>
          <View style={{ marginTop: 12, gap: 10 }}>
            {projection.actions.map((a) => (
              <Row key={a.key} style={{ gap: 11, alignItems: 'center' }}>
                <View style={{ width: 20, height: 20, borderRadius: 7, borderWidth: 2, borderColor: c.accentBorder }} />
                <Txt w="b" size={14} color={c.slate700} style={{ flex: 1 }}>
                  {a.label}
                </Txt>
              </Row>
            ))}
          </View>
        </Card>
      ) : null}

      {/* check-in is an action, so it rides with the top act-now stack */}
      <CheckinBanner />

      {/* ---- YOUR PROGRESS — the look-back, below the act-now stack ---- */}
      <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} style={{ marginTop: 32, marginBottom: 2 }}>
        YOUR PROGRESS
      </Txt>

      {/* what's in this score */}
      <ScoreBreakdownPanel />

      {/* season goal */}
      <Card variant="low" style={{ marginTop: 12, borderRadius: 24, padding: 22 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>
            {goalEyebrow}
          </Txt>
          {/* "38 days left" / "Nov 14" are showcase deadlines with no real data
              source (no season deadline is collected yet). Demo keeps the showcase;
              a real athlete sees no fabricated countdown. */}
          {!isReal ? (
            <Row style={{ gap: 6, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, backgroundColor: c.accentSurface }}>
              <Icon name="checkin" size={12} color={c.accent} />
              <Txt w="eb" size={12} color={c.accent}>
                38 days left
              </Txt>
            </Row>
          ) : null}
        </Row>
        {isMaintainGoal ? (
          // Maintain is a STAY-AT-X goal, not a reach-X goal — so the reach-goal progress bar +
          // "Goal reached / Season weight goal complete" (which fires on day 0 when target == current)
          // is wrong. Show a calm "holding steady" status instead.
          <>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
              <View>
                <Txt w="eb" size={29} ls={-0.9}>
                  {displayWeight(TARGET, units)} {wUnit}
                  <Txt w="b" size={15} color={c.textTertiary}>
                    {' '}
                    maintaining
                  </Txt>
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt w="eb" size={20} color={c.success}>
                  {remainingAbs < 0.5 ? 'On target' : `${remainingAbs} ${wUnit} off`}
                </Txt>
                <Txt w="sb" size={12} color={c.textTertiary}>
                  now {displayWeight(s.currentWeight, units)} {wUnit}
                </Txt>
              </View>
            </Row>
            <View style={{ marginTop: 16, borderRadius: 14, padding: 13, backgroundColor: c.successTint }}>
              <Txt w="m" size={13} color={c.successText} style={{ lineHeight: 19 }}>
                <Txt w="b" size={13} color={c.successText}>Holding steady · </Txt>
                Your goal is to stay around {displayWeight(TARGET, units)} {wUnit}. Log your weekly weigh-ins to keep it honest.
              </Txt>
            </View>
          </>
        ) : (
          <>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
              <View>
                <Txt w="eb" size={29} ls={-0.9}>
                  {displayWeight(TARGET, units)} {wUnit}
                  <Txt w="b" size={15} color={c.textTertiary}>
                    {' '}
                    target
                  </Txt>
                </Txt>
                {!isReal ? (
                  <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }}>
                    by Playoffs · Nov 14
                  </Txt>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt w="eb" size={20} color={c.success}>
                  {goalRemainText}
                </Txt>
                <Txt w="sb" size={12} color={c.textTertiary}>
                  now {displayWeight(s.currentWeight, units)} {wUnit}
                </Txt>
              </View>
            </Row>
            <View style={{ marginTop: 16 }}>
              <ProgressBar pct={goal.pctThere} height={10} />
            </View>
            <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <Txt w="b" size={11} color={c.textTertiary}>
                {displayWeight(START, units)} start
              </Txt>
              <Txt w="b" size={11} color={c.textTertiary}>
                {goal.pctThere}% there
              </Txt>
              <Txt w="b" size={11} color={c.textTertiary}>
                {displayWeight(TARGET, units)} goal
              </Txt>
            </Row>
            <View
              style={{
                marginTop: 14,
                borderRadius: 14,
                padding: 13,
                backgroundColor: goalPhase === 'first-run' ? c.bg2 : c.successTint,
              }}
            >
              <Txt
                w="m"
                size={13}
                color={goalPhase === 'first-run' ? c.textSecondary : c.successText}
                style={{ lineHeight: 19 }}
              >
                <Txt
                  w="b"
                  size={13}
                  color={goalPhase === 'first-run' ? c.textSecondary : c.successText}
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
          </>
        )}
      </Card>

      {/* score trend */}
      <Card variant="low" style={{ marginTop: 12, borderRadius: 24, padding: 22 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <View>
            <Txt w="eb" size={16} ls={-0.3}>
              Score Trend
            </Txt>
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }}>
              {trendCaption}
            </Txt>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt w="eb" size={26} ls={-0.5}>
              {d.athleteScore}
            </Txt>
            {d.isDay0 ? (
              <Txt w="b" size={12} color={c.textTertiary}>
                Building your first week
              </Txt>
            ) : (
              <Txt
                w="b"
                size={12}
                color={trend.dir === 'down' ? c.alert : trend.dir === 'flat' ? c.textTertiary : c.success}
              >
                {trend.label}
              </Txt>
            )}
          </View>
        </Row>
        <TrendChart series={series} flat={d.isDay0} />
        <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
          {dayLabels.map((dn, i) => (
            <Txt key={`${dn}-${i}`} w="sb" size={11} color={c.textTertiary}>
              {dn}
            </Txt>
          ))}
        </Row>
      </Card>

      {/* today's progress */}
      <Card variant="low" style={{ marginTop: 12, borderRadius: 24, padding: 22 }}>
        <Txt w="eb" size={16} ls={-0.3} style={{ marginBottom: 18 }}>
          Today's Progress
        </Txt>
        <ProgressRow label="Protein" meta={`${d.proteinToday} / ${d.proteinTarget}g`} pct={d.proteinPct} color={c.accent} />
        <ProgressRow label="Hydration" meta={`${s.hydrationL} / ${HYDRATION_TARGET} L  +`} metaColor={c.accent} onMeta={s.addWater} pct={d.hydrationPct} color={c.hydration} />
        <ProgressRow
          label="Commitment"
          meta={s.dailyCommitment === 'yes' ? 'Hit your plan' : s.dailyCommitment === 'partial' ? 'Partial day' : s.dailyCommitment === 'no' ? 'Missed' : 'Not answered yet'}
          pct={d.commitmentScore}
          color={c.accent}
        />
        <ProgressRow
          label="Recovery"
          meta={d.recoveryScoreIsReal ? `${d.recoveryScore} / 100` : 'Check-in not submitted'}
          pct={d.recoveryScoreIsReal ? d.recoveryScore : 0}
          color={c.success}
          last
        />
      </Card>

      {/* nutrition entry */}
      {/* performance entry (Nutrition + Check-In now live in the tab bar / their banners) */}
      <Pressable accessibilityRole="button" accessibilityLabel="Performance: log a PR and see your trends" onPress={s.goPerformance} style={[{ marginTop: 12, backgroundColor: c.card, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }, shadow.card]}>
        <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="trophy" size={22} color={c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={15}>
            Performance
          </Txt>
          <Txt w="m" size={13} color={c.textSecondary}>
            Log a PR and see your trends
          </Txt>
        </View>
        <Icon name="chevronRight" size={22} color={c.slate300} />
      </Pressable>


      {/* coach guidance — hidden for a solo real athlete (no coach to quote) */}
      {guidance.show ? (
        <Card variant="low" style={{ marginTop: 12, borderRadius: 24, padding: 20, flexDirection: 'row', gap: 14 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="b" size={13} color={c.white}>
              {guidance.monogram}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Row style={{ gap: 7, flexWrap: 'wrap' }}>
              <Txt w="eb" size={12} ls={0.4}>
                COACH GUIDANCE
              </Txt>
              {guidance.pending ? null : (
                <View style={{ backgroundColor: c.accentSurface, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                  <Txt w="b" size={10} color={c.accent}>
                    {aiMemoryTag}
                  </Txt>
                </View>
              )}
            </Row>
            <Txt w="sb" size={14} color={c.slate700} style={{ marginTop: 6, lineHeight: 20 }}>
              {guidance.note ?? 'Your coach can leave a standing note here, and it stays in front of you every day until it sticks.'}
            </Txt>
          </View>
        </Card>
      ) : s.supportTeam.length === 0 ? (
        <ConnectCoachCard />
      ) : null}

    </ScrollView>
  );
}

/** Shown on Home when a real athlete has no one connected yet: enter a coach/trainer team code
 *  so the accountability has someone watching. Restores the connect step the lean onboarding
 *  moved off the critical path; sits where the coach-guidance card goes once a coach exists. */
/** First-run nudge to link a coach. Opens the two-door Connect overlay (enter a code, or
 *  find your coach by school and request to join). Its caller already gates it to athletes
 *  with no support connection; this also self-hides once dismissed ("Not now"). */
function ConnectCoachCard() {
  const c = useColors();
  const openConnect = useStore((st) => st.openConnect);
  const dismiss = useStore((st) => st.dismissConnectCard);
  const dismissed = useStore((st) => st.connectCardDismissed);
  if (dismissed) return null;
  return (
    <Card variant="low" style={{ marginTop: 12, borderRadius: 24, padding: 20 }}>
      <Row style={{ gap: 11 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="squad" size={20} color={c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={12} color={c.accent} ls={0.4}>CONNECT YOUR COACH</Txt>
          <Txt w="sb" size={14} color={c.slate700} style={{ marginTop: 4, lineHeight: 20 }}>
            Link up so your work counts and they’ve got your back. Enter their code, or find them by school.
          </Txt>
        </View>
      </Row>
      <Row style={{ gap: 10, marginTop: 14 }}>
        <Btn label="Connect" onPress={() => { haptics.tap(); openConnect(); }} style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Not now" hitSlop={6} onPress={() => { haptics.tap(); dismiss(); }} style={{ paddingHorizontal: 16, justifyContent: 'center' }}>
          <Txt w="b" size={14} color={c.textSecondary}>Not now</Txt>
        </Pressable>
      </Row>
    </Card>
  );
}

/** YOUR NEXT MOVE — the single highest-impact action right now (a coach, not a scorekeeper),
 *  derived from real logged data + the hour. Promoted to the top of Daily HQ so Home opens by
 *  telling you what to do, not by showing you numbers. */
function NextMoveCard() {
  const c = useColors();
  const s = useStore();
  const d = useDerived();
  const na = nextBestAction(s, d);
  const onPress =
    na.cta === 'meal' ? s.openMeal
    : na.cta === 'water' ? s.addWater
    : na.cta === 'checkin' ? s.goCheckin
    : na.cta === 'plan' ? s.goTasks
    : undefined;
  const accent = na.done ? c.successDeep : c.accent;
  const tileBg = na.done ? c.successSurface : c.accentSurface;
  const body = (
    <>
      <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: tileBg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={na.done ? 'check' : 'sparkle'} size={22} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="eb" size={11} color={accent} ls={0.5}>
          {na.done ? "TODAY'S MISSION · DONE" : "TODAY'S MISSION"}
        </Txt>
        <Txt w="eb" size={17} ls={-0.3} style={{ marginTop: 3 }}>
          {na.title}
        </Txt>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 19 }}>
          {na.detail}
        </Txt>
        <Txt w="m" size={11} color={c.textTertiary} style={{ marginTop: 8, lineHeight: 15 }}>
          {medicalDisclaimer()}
        </Txt>
      </View>
      {onPress ? <Icon name="chevronRight" size={22} color={c.slate300} /> : null}
    </>
  );
  // The mission leads the screen, so give it the elevated card weight (not the plain tile the
  // old bottom-of-page version used) — it is the primary thing on Daily HQ.
  const boxStyle = [{ marginTop: 14, backgroundColor: c.card, borderRadius: 22, padding: 18, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14 }, shadow.card];
  return onPress ? (
    <PressScale accessibilityLabel={na.title} onPress={onPress} style={boxStyle}>
      {body}
    </PressScale>
  ) : (
    <View style={boxStyle}>{body}</View>
  );
}

/** The weekly check-in is an action, so it rides with the top act-now stack rather than the
 *  look-back cards. Due state is a CTA; completed state is a calm confirmation. */
function CheckinBanner() {
  const c = useColors();
  const s = useStore();
  const isReal = s.athleteName.trim().length > 0;
  const checkinAudience = supportAudience({ isReal, supportTeam: s.supportTeam, demo: 'Coach Davis' });
  // A WEEKLY ritual is due weekly: a real submission this week (the carried ciLast
  // snapshot scoring credits) keeps the calm completed state instead of nagging
  // "DUE" every morning after a Monday check-in. Question count follows ciConfig —
  // the banner promised "6 questions" while the default asks 4.
  const doneThisWeek = s.ciSubmitted || (s.ciLast != null && withinTrailingWeek(s.ciLast.date, s.dateStamp));
  const questionCount = Object.values(s.ciConfig).filter(Boolean).length;
  if (!doneThisWeek) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Weekly check-in due: ${questionCount} questions, about 2 minutes`} onPress={s.goCheckin} style={[{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, shadow.cta]}>
        <View>
          <Txt w="eb" size={11} color="rgba(255,255,255,0.85)" ls={0.7}>
            WEEKLY CHECK-IN DUE
          </Txt>
          <Txt w="b" size={15} color={c.white} style={{ marginTop: 5 }}>
            {questionCount} questions · 2 min
          </Txt>
        </View>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevronRight" size={18} color={c.white} />
        </View>
      </Pressable>
    );
  }
  return (
    <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: c.successTint, borderWidth: 1, borderColor: c.successBorderSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View>
        <Txt w="eb" size={11} color={c.successDeep} ls={0.7}>
          WEEKLY CHECK-IN
        </Txt>
        <Txt w="b" size={15} color={c.successText} style={{ marginTop: 5 }}>
          {checkinAudience ? `Completed · sent to ${checkinAudience}` : 'Completed'}
        </Txt>
      </View>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="check" size={17} color={c.white} />
      </View>
    </View>
  );
}

function ScoreBreakdownPanel() {
  const c = useColors();
  const [open, setOpen] = React.useState(false);
  return (
    <Card variant="low" style={{ marginTop: 12, borderRadius: 20, padding: 18 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="What's in this score?"
        accessibilityState={{ expanded: open }}
        onPress={() => { haptics.tap(); setOpen((v) => !v); }}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Row style={{ gap: 9, flex: 1 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={16} color={c.accent} />
          </View>
          <Txt w="eb" size={15} ls={-0.3}>
            What's in this score?
          </Txt>
        </Row>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chevronRight" size={20} color={c.slate300} />
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
                <Txt w="eb" size={14} color={c.accent}>
                  {w.pct}%
                </Txt>
              </Row>
              <Txt w="m" size={12} color={c.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>
                {w.desc}
              </Txt>
            </View>
          ))}
          <Txt w="m" size={12} color={c.textTertiary} style={{ lineHeight: 17 }}>
            Nutrition counts the most. Recovery and check-in are answers you give yourself. Your weight progress is tracked separately, not folded into this daily score.
          </Txt>
        </View>
      ) : null}
    </Card>
  );
}

function ProgressRow({ label, meta, pct, color, metaColor, onMeta, last }: { label: string; meta: string; pct: number; color: string; metaColor?: string; onMeta?: () => void; last?: boolean }) {
  const c = useColors();
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
          {met ? <Icon name="check" size={13} color={c.successDeep} /> : null}
        </Row>
        <Pressable onPress={onMeta} disabled={!onMeta}>
          <Txt w={onMeta ? 'b' : 'sb'} size={13} color={metaColor ?? c.textSecondary}>
            {meta}
          </Txt>
        </Pressable>
      </Row>
      <ProgressBar pct={pct} height={9} color={met ? c.successDeep : color} />
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

function TrendChart({ series, flat }: { series: number[]; flat: boolean }) {
  const c = useColors();
  const box = DEFAULT_CHART_BOX;
  // Day zero has only today's provisional anchor — the rest of `series` is the seeded
  // pad. Drawing a rising green line off seeded data is the fabricated-trend bug the
  // audit flagged, so with no real history yet (isDay0) we draw a flat, muted baseline
  // with only today's dot: honestly "no trend, this fills in as you log".
  if (flat) {
    const midY = box.height / 2;
    return (
      <Svg viewBox={`0 0 ${box.width} ${box.height}`} width="100%" height={100} preserveAspectRatio="none" style={{ marginTop: 6 }}>
        <Path d={`M0 ${midY} L${box.width} ${midY}`} fill="none" stroke={c.track} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 7" />
        <Circle cx={box.width - 4} cy={midY} r={5.5} fill={c.accent} stroke={c.card} strokeWidth={2.5} />
      </Svg>
    );
  }
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
      <Circle cx={last.x} cy={last.y} r={5.5} fill="#22C55E" stroke={c.card} strokeWidth={2.5} />
    </Svg>
  );
}
