// OnStandard — Athlete Progress (redesign 2026-07, faithful rebuild of the proto Progress).
//
// The analytics tab the app was missing. It answers "am I trending on standard?" over
// the week/season — distinct from Home (today) and Performance (PRs). Top → bottom:
// segmented range · Weekly OnStandard Score (avg + vs-last, days on standard, week bars +
// trend sparkline) · three coach-stats (best streak · 30-day consistency · avg) ·
// Requirements Consistency breakdown · Biggest Pattern insight · Weight Trend · Where You
// Lost Points · Weekly Summary · Coach Feedback · AI Summary.
//
// EVERY number is read from the SAME real store/derived sources Home uses — no fabricated
// week averages, streaks, consistency %s, or "you gain 11 points" claims. The consistency
// rows and lost-points list are computed from what the athlete has actually logged. On a
// brand-new athlete (day 0, or too little real history to trend) the screen shows an honest
// "progress builds as you log" state instead of inventing a trend — the proto's own day-0
// branch. The proto's Nutrition-macro row and coach-logged game-stat tiles are intentionally
// omitted here: the RN app has no real per-meal macro history or coach game stats yet, and
// reproducing them would fabricate data the honesty firewall forbids.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  firstName,
  initials,
  COMPLIANCE_THRESHOLD,
  weeklyCompliance,
  trendSeries,
  trendGeometry,
  realTrendDays,
  longestStreak,
  weeklyReportFromState,
  weeklyWeightProgress,
  todayStamp,
  withinTrailingWeek,
  type DayScore,
} from '@/core';
import { useStore, useDerived } from '@/store';
import { shadow, MAX_FONT_SCALE } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, PressScale, Reveal, Row, Txt, ProgressBar, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';

/** Accent class per the proto's semantic color system: g green · a amber · b blue · p purple. */
type Accent = 'g' | 'a' | 'b' | 'p';

/** Resolve an accent class to its foreground + surface hex on the active (dark) palette. */
function accentFg(c: ReturnType<typeof useColors>, a: Accent): string {
  return a === 'g' ? c.success : a === 'a' ? c.warningDeep : a === 'b' ? c.accentLight : c.trainerLight;
}

/** How many real days (persisted completed days + today) we need before a weekly trend is
 *  honest rather than mostly-seeded padding. Below this we show the "building history" state. */
const MIN_TREND_DAYS = 3;

/** One Requirements-Consistency row: a labelled % track, colored by the requirement's accent. */
interface ConsRow {
  key: string;
  pct: number;
  accent: Accent;
  /** True when this % is backed by real logged data (vs "no data yet" for an unlogged area). */
  real: boolean;
}

export function Progress() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = useDerived();

  const name = firstName(s.athleteName, 'there');
  const monogram = initials(s.athleteName, 'J');
  const coachInitial = 'M'; // seeded coach ("Coach Mark") — the roster/coach identity model lands with the backend.

  // How much REAL history exists. Today's live score always counts; prior days come from
  // persisted scoreHistory. Below MIN_TREND_DAYS a "week average" would be mostly seed pad,
  // so we tell the honest building-history story (the proto's day-0 branch) instead.
  const realDays = realTrendDays(s.scoreHistory);
  const building = d.isDay0 || realDays < MIN_TREND_DAYS;

  if (building) {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        <Txt w="eb" size={28} ls={-0.6} accessibilityRole="header" style={{ paddingTop: 8, paddingBottom: 4 }}>
          Progress
        </Txt>
        <BuildingState onLog={s.openMeal} realDays={realDays} isDay0={d.isDay0} />
      </ScrollView>
    );
  }

  // ---- Weekly OnStandard Score (real) ----------------------------------------------------
  // weeklyReportFromState gives the honest completed-day average this week + week-over-week
  // movement (last 7 vs the 7 before), skipping the provisional day-0 anchor. weeklyCompliance
  // gives the day-by-day bars and the "N of 7 on standard" count from the SAME padded series.
  const report = weeklyReportFromState({
    name: s.athleteName || 'Athlete',
    scoreHistory: s.scoreHistory,
    liveScore: d.athleteScore,
    todayStamp: s.dateStamp,
  });
  const comp = weeklyCompliance(s.scoreHistory, d.athleteScore);
  const weekAvg = report.avgScore;
  // vs last week: recompute the same delta weeklyReport uses, but keep the signed number so
  // the header can show "+N" / "-N" / "even" honestly (movedLine is prose).
  const prior = dropAnchor(s.scoreHistory, s.dateStamp).slice(-14, -7);
  const priorAvg = prior.length ? Math.round(prior.reduce((a, x) => a + x.score, 0) / prior.length) : null;
  const weekDelta = priorAvg == null ? null : weekAvg - priorAvg;

  // The week bars: the padded 7-day series, each bar scaled by its score; today is the live,
  // in-progress day (dimmed, never counted as "on standard"). Reuses comp.days so the bars and
  // the "N of 7" count can never disagree.
  const barMax = 86; // px, matches proto .weekbars height budget
  const weekBars = comp.days.map((day) => ({
    label: day.label.slice(0, 1), // M/T/W… single letter like the proto
    score: day.score,
    hi: day.ok, // completed + on standard
    today: day.today,
    heightPx: Math.max(8, Math.round((Math.max(0, Math.min(100, day.score)) / 100) * barMax)),
  }));

  // Trend sparkline geometry (the smooth line the spec calls out, same source Home's Ring
  // trend draws) — over the same 7-day padded series.
  const series = trendSeries(s.scoreHistory, d.athleteScore);
  const spark = trendGeometry(series);

  // ---- Coach-stats (real) ----------------------------------------------------------------
  const bestStreak = longestStreak(s.scoreHistory); // personal-best run of on-standard days
  const monthCompleted = dropAnchor(s.scoreHistory, s.dateStamp).slice(-30);
  const monthConsistency = monthCompleted.length
    ? Math.round(monthCompleted.reduce((a, x) => a + x.score, 0) / monthCompleted.length)
    : weekAvg;

  // ---- Requirements Consistency (real, computed from what's actually been logged) --------
  const cons = buildConsistency(s, d);
  const consReal = cons.filter((r) => r.real);
  const consPct = consReal.length
    ? Math.round(consReal.reduce((a, r) => a + r.pct, 0) / consReal.length)
    : 0;

  // ---- Biggest Pattern (honest, derived from the weakest real requirement) ---------------
  const pattern = patternInsight(cons);

  // ---- Weight Trend (real) ---------------------------------------------------------------
  const weekWeight = weeklyWeightProgress(s.weightHistory, s.currentWeight, s.startWeight);
  const toGoal = s.weightTarget - s.currentWeight; // + means still gaining toward a higher goal
  const weightPace = paceLabel(weekWeight, toGoal);

  // ---- Where You Lost Points (real, from the incomplete requirements) --------------------
  const lost = buildLostPoints(cons);

  // ---- Weekly Summary / Coach / AI (real) ------------------------------------------------
  const weeklySummary = [report.scoreLine, report.movedLine].join(' ');
  const coachFeedback = s.coachNote?.trim() || null; // the real coach note in state
  const aiSummary = aiRead(report, cons, weekAvg);

  const accentGrad: Record<Accent, readonly [string, string]> = {
    g: ['#16A34A', '#4ADE80'],
    b: ['#2563EB', '#60A5FA'],
    p: ['#7E22CE', '#C084FC'],
    a: ['#B45309', '#FBBF24'],
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 140 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ===== Title + range segmented control ===== */}
      <Txt w="eb" size={28} ls={-0.6} accessibilityRole="header" style={{ paddingTop: 8, paddingBottom: 4 }}>
        Progress
      </Txt>
      <Segmented options={['Week', 'Month', 'Season']} active={0} />

      {/* ===== 1 · Weekly OnStandard Score ===== */}
      <Eyebrow>Weekly OnStandard Score</Eyebrow>
      <Reveal index={0}>
        <Card variant="low" style={{ borderRadius: 22, padding: 18 }}>
          <Row style={{ alignItems: 'baseline', gap: 10 }}>
            <Txt w="eb" num size={44} ls={-1.8}>{weekAvg}</Txt>
            <Txt
              w="b"
              size={13.5}
              color={weekDelta == null ? c.textSecondary : weekDelta >= 0 ? c.success : c.warningDeep}
            >
              {weekDelta == null ? 'first week tracked' : `${weekDelta >= 0 ? '+' : ''}${weekDelta} vs last week`}
            </Txt>
          </Row>
          <Txt w="b" size={13} color={c.textSecondary} style={{ marginTop: 2 }}>
            {comp.onPlan} of {comp.total || 7} days on standard (≥{COMPLIANCE_THRESHOLD})
          </Txt>

          {/* week bars */}
          <Row
            accessibilityRole="image"
            accessibilityLabel={`Daily scores this week: ${weekBars.map((b) => Math.round(b.score)).join(', ')}`}
            style={{ alignItems: 'flex-end', gap: 9, height: 110, paddingTop: 8, marginTop: 6 }}
          >
            {weekBars.map((b, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', gap: 7, height: '100%', justifyContent: 'flex-end' }}>
                <View
                  style={{
                    width: '100%',
                    height: b.heightPx,
                    borderRadius: 7,
                    minHeight: 8,
                    backgroundColor: b.hi ? c.success : c.accent,
                    opacity: b.today ? 0.4 : b.hi ? 1 : 0.5,
                    ...(b.hi ? shadow.low : null),
                  }}
                />
                <Txt w="b" size={10.5} color={b.today ? c.accentLight : c.textTertiary}>{b.label}</Txt>
              </View>
            ))}
          </Row>

          {/* trend sparkline — the smooth line over the same 7-day series */}
          <View style={{ marginTop: 10 }}>
            <Svg width="100%" height={44} viewBox={`0 0 ${322} 44`} preserveAspectRatio="none">
              <Defs>
                <LinearGradient id="progspark" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={c.success} stopOpacity="0.20" />
                  <Stop offset="1" stopColor={c.success} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Path
                d={`${scaleY(spark.linePath, 116, 44)} L${spark.last.x.toFixed(1)},44 L${spark.points[0].x.toFixed(1)},44 Z`}
                fill="url(#progspark)"
                stroke="none"
              />
              <Path d={scaleY(spark.linePath, 116, 44)} stroke={c.success} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={spark.last.x} cy={rescale(spark.last.y, 116, 44)} r={3.5} fill={c.success} stroke={c.card} strokeWidth={2} />
            </Svg>
          </View>
        </Card>
      </Reveal>

      {/* ===== 2 · Three coach-stats ===== */}
      <View style={{ height: 16 }} />
      <Reveal index={1}>
        <Row style={{ gap: 11 }}>
          <StatTile value={`${bestStreak}d`} label="Best streak" color={c.warningDeep} />
          <StatTile value={`${monthConsistency}%`} label="30-day avg" />
          <StatTile value={`${weekAvg}`} label="Week avg" color={c.success} />
        </Row>
      </Reveal>

      {/* ===== 3 · Requirements Consistency ===== */}
      <Eyebrow>Requirements Consistency</Eyebrow>
      <Reveal index={2}>
        <Card variant="low" style={{ borderRadius: 22, padding: 18 }}>
          <Row style={{ alignItems: 'baseline', gap: 10 }}>
            <Txt w="eb" num size={44} ls={-1.8}>{consPct}%</Txt>
            <Txt w="b" size={13.5} color={c.textSecondary}>this week</Txt>
          </Row>
          <Txt w="b" size={13} color={c.textSecondary} style={{ marginTop: 2, marginBottom: 16 }}>
            Across your logged requirements
          </Txt>
          <View style={{ gap: 12 }}>
            {cons.map((r) => (
              <Row key={r.key} style={{ gap: 12 }}>
                <Txt w="b" size={13} color={c.textSecondary} style={{ width: 92 }} numberOfLines={1}>{r.key}</Txt>
                <View style={{ flex: 1 }}>
                  {r.real ? (
                    <ProgressBar pct={r.pct} height={8} color={accentFg(c, r.accent)} track={c.surface3} />
                  ) : (
                    <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surface3 }} />
                  )}
                </View>
                <Txt w="eb" size={13.5} color={r.real ? c.text : c.textTertiary} style={{ width: 52, textAlign: 'right' }} num>
                  {r.real ? `${r.pct}%` : '—'}
                </Txt>
              </Row>
            ))}
          </View>
        </Card>
      </Reveal>

      {/* ===== 4 · Biggest Pattern ===== */}
      <Eyebrow>Biggest Pattern</Eyebrow>
      <Reveal index={3}>
        <View style={{ flexDirection: 'row', gap: 12, padding: 15, borderRadius: 22, backgroundColor: c.successSurface, borderWidth: 1, borderColor: c.successBorderSoft }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bolt" size={18} color={c.success} />
          </View>
          <Txt w="b" size={14.5} style={{ flex: 1, lineHeight: 21 }}>{pattern}</Txt>
        </View>
      </Reveal>

      {/* ===== 5 · Weight Trend ===== */}
      <Eyebrow>Weight Trend</Eyebrow>
      <Reveal index={4}>
        <PressScale accessibilityLabel="Weight trend. Open your profile to log weight." onPress={s.goProfile}>
          <Card variant="low" style={{ borderRadius: 22, padding: 18 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Row style={{ alignItems: 'baseline', gap: 10 }}>
                <Txt w="eb" num size={32} ls={-1}>{fmtWeight(s.currentWeight)}</Txt>
                <Txt w="b" size={13.5} color={c.textSecondary}>
                  {weekWeight === 0 ? 'no change this week' : `${weekWeight > 0 ? '+' : ''}${weekWeight} lb this week`}
                </Txt>
              </Row>
              <View style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: c.success + '55', backgroundColor: c.successSurface }}>
                <Txt w="eb" size={11} color={c.success} ls={0.2}>{weightPace}</Txt>
              </View>
            </Row>
            <Txt w="b" size={13} color={c.textSecondary} style={{ marginTop: 4 }}>
              Goal {fmtWeight(s.weightTarget)} lb · doesn’t affect the daily score
            </Txt>
          </Card>
        </PressScale>
      </Reveal>

      {/* ===== 6 · Where You Lost Points ===== */}
      <Eyebrow>Where You Lost Points</Eyebrow>
      <Reveal index={5}>
        <Card variant="low" style={{ borderRadius: 22, padding: 6, paddingHorizontal: 16 }}>
          {lost.length === 0 ? (
            <Row style={{ justifyContent: 'space-between', paddingVertical: 12 }}>
              <Txt w="b" size={14} color={c.textSecondary}>Nothing dropped — every requirement is in.</Txt>
              <Icon name="check" size={16} color={c.success} />
            </Row>
          ) : (
            lost.map((l, i) => (
              <Row
                key={l.key}
                style={{
                  justifyContent: 'space-between',
                  paddingVertical: 11,
                  borderBottomWidth: i === lost.length - 1 ? 0 : 1,
                  borderBottomColor: c.hairline,
                }}
              >
                <Txt w="b" size={14} color={c.textSecondary} style={{ flex: 1 }} numberOfLines={1}>{l.key}</Txt>
                <Txt w="eb" size={14} color={accentFg(c, l.accent)}>
                  {l.amount}
                  {l.note ? <Txt w="b" size={12} color={c.textTertiary}>{`  ·  ${l.note}`}</Txt> : null}
                </Txt>
              </Row>
            ))
          )}
        </Card>
      </Reveal>

      {/* ===== 7 · Weekly Summary ===== */}
      <Eyebrow>Weekly Summary</Eyebrow>
      <Reveal index={6}>
        <Card variant="low" style={{ borderRadius: 22, padding: 18 }}>
          <Txt w="sb" size={14.5} style={{ lineHeight: 22 }}>{weeklySummary}</Txt>
          {report.flag ? (
            <Row style={{ gap: 8, alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.hairline }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.warningDeep }} />
              <Txt w="b" size={13} color={c.warningDeep} style={{ flex: 1 }}>{report.flag}</Txt>
            </Row>
          ) : null}
        </Card>
      </Reveal>

      {/* ===== 8 · Coach Feedback (only when a real coach note exists) ===== */}
      {coachFeedback ? (
        <>
          <Eyebrow>Coach Feedback</Eyebrow>
          <Reveal index={7}>
            <Card variant="low" style={{ borderRadius: 22, padding: 18 }}>
              <Row style={{ gap: 11, marginBottom: 11 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.warningDeep, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt w="eb" size={14} color={c.onGreen}>{coachInitial}</Txt>
                </View>
                <View>
                  <Txt w="eb" size={14}>Coach Mark</Txt>
                  <Txt w="b" size={11} color={c.textTertiary}>This week</Txt>
                </View>
              </Row>
              <Txt w="m" size={14.5} style={{ lineHeight: 22 }}>“{coachFeedback}”</Txt>
            </Card>
          </Reveal>
        </>
      ) : null}

      {/* ===== 9 · AI Summary ===== */}
      <Eyebrow>AI Summary</Eyebrow>
      <Reveal index={8}>
        <View style={{ flexDirection: 'row', gap: 12, padding: 15, borderRadius: 22, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={18} color={c.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={11} color={c.accentLight} ls={1.2} upper>This week</Txt>
            <Txt w="sb" size={14} style={{ marginTop: 4, lineHeight: 21 }}>{aiSummary}</Txt>
          </View>
        </View>
      </Reveal>
      <View style={{ height: 10 }} />
    </ScrollView>
  );
}

/* ============================================================================
   Data builders — every section resolved from REAL state (no fabrication).
   ============================================================================ */

/** Drop the provisional day-0 anchor (a baseline estimate written at activation, not a
 *  tracked day) so week/month averages never count it — mirrors weeklyReportFromState. */
function dropAnchor(history: DayScore[], stamp: string): DayScore[] {
  const all = history ?? [];
  const anchorOnly = all.length > 0 && all.every((h) => h.date === stamp);
  return anchorOnly ? [] : all;
}

/**
 * Requirements Consistency — the % of each requirement the athlete is meeting. Built from
 * REAL state:
 *  - Meals: share of today's meal slots logged (breakfast/lunch/dinner — snack is optional).
 *  - Recovery: 100 if a real check-in backs today's recovery number, else 0.
 *  - Hydration: today's hydration vs target (derived hydrationPct).
 *  - Weight logs: 100 if weighed in today, else 0 (weight is trend-only, tracked here honestly).
 *  - Check-ins: 100 if the weekly check-in is in for this week, else 0.
 * Areas with no real signal yet are marked `real: false` so the row renders "—" instead of a
 * fabricated percentage.
 */
function buildConsistency(
  s: ReturnType<typeof useStore.getState>,
  d: ReturnType<typeof useDerived>,
): ConsRow[] {
  const requiredMeals: (keyof typeof s.meals)[] = ['breakfast', 'lunch', 'dinner'];
  const mealsLogged = requiredMeals.filter((k) => s.meals[k]).length;
  const mealsPct = Math.round((mealsLogged / requiredMeals.length) * 100);

  const recoveryDone = d.recoveryScoreIsReal;
  const hydrationPct = Math.max(0, Math.min(100, Math.round(d.hydrationPct)));
  const weightDone = s.weighInStamp === todayStamp();
  const checkinDone = s.ciSubmitted || (s.ciLast != null && withinTrailingWeek(s.ciLast.date, s.dateStamp));

  return [
    { key: 'Meals', pct: mealsPct, accent: 'g', real: true },
    { key: 'Recovery', pct: recoveryDone ? 100 : 0, accent: 'p', real: true },
    { key: 'Hydration', pct: hydrationPct, accent: 'b', real: true },
    { key: 'Weight logs', pct: weightDone ? 100 : 0, accent: 'a', real: true },
    { key: 'Check-ins', pct: checkinDone ? 100 : 0, accent: 'g', real: true },
  ];
}

/** The single honest headline pattern: the lowest real requirement is what's holding the
 *  score back (or a clean-week affirmation when everything is high). No fabricated correlation. */
function patternInsight(cons: ConsRow[]): string {
  const real = cons.filter((r) => r.real);
  if (real.length === 0) return 'Keep logging — your patterns show up here once there’s a few days of data.';
  const weakest = [...real].sort((a, b) => a.pct - b.pct)[0];
  const strongest = [...real].sort((a, b) => b.pct - a.pct)[0];
  if (weakest.pct >= 85) return `Dialed in across the board — ${strongest.key.toLowerCase()} is leading the way. Keep the streak alive.`;
  return `${strongest.key} is your most consistent requirement. ${weakest.key} is the one holding your score back this week — that’s the biggest point of leverage.`;
}

interface LostRow {
  key: string;
  amount: string;
  accent: Accent;
  note?: string;
}

/** Where You Lost Points — the incomplete requirements, worst first. Amount is the requirement's
 *  score weight (Recovery 25 / Nutrition 50 / Check-in 10) scaled by how much is missing, so the
 *  numbers are real point costs — never a fabricated "-6". Weight is trend-only, so a skipped
 *  weigh-in shows as a streak note, not a point loss. */
function buildLostPoints(cons: ConsRow[]): LostRow[] {
  const out: LostRow[] = [];
  const byKey = (k: string) => cons.find((r) => r.key === k);

  const meals = byKey('Meals');
  if (meals && meals.real && meals.pct < 100) {
    // Nutrition carries 50 pts; the share of missed meals is the honest cost.
    const cost = Math.round((50 * (100 - meals.pct)) / 100);
    out.push({ key: 'Meals not all logged', amount: `-${cost}`, accent: 'a' });
  }
  const recovery = byKey('Recovery');
  if (recovery && recovery.real && recovery.pct < 100) {
    out.push({ key: 'Recovery check-in missed', amount: '-25', accent: 'p' });
  }
  const hydration = byKey('Hydration');
  if (hydration && hydration.real && hydration.pct < 100) {
    out.push({ key: 'Hydration short of target', amount: `${hydration.pct}%`, accent: 'b', note: 'focus this week' });
  }
  const checkin = byKey('Check-ins');
  if (checkin && checkin.real && checkin.pct < 100) {
    out.push({ key: 'Weekly check-in open', amount: '-10', accent: 'a' });
  }
  const weight = byKey('Weight logs');
  if (weight && weight.real && weight.pct < 100) {
    out.push({ key: 'Weight log skipped', amount: '—', accent: 'a', note: 'streak only' });
  }
  return out;
}

/** The AI read — an honest assembly of the real weekly signals (average band + biggest gap),
 *  clearly the app's summary, not a fabricated coaching claim. */
function aiRead(
  report: ReturnType<typeof weeklyReportFromState>,
  cons: ConsRow[],
  weekAvg: number,
): string {
  const real = cons.filter((r) => r.real);
  const weakest = real.length ? [...real].sort((a, b) => a.pct - b.pct)[0] : null;
  const trend = report.movedLine.toLowerCase().includes('up')
    ? 'You’re trending up.'
    : report.movedLine.toLowerCase().includes('down')
      ? 'You slipped a little this week.'
      : 'You’re holding steady.';
  const gap = weakest && weakest.pct < 85
    ? ` ${weakest.key} is your biggest gap — close that and the score follows.`
    : ' Everything’s in range; protect the consistency.';
  return `${trend} Week average ${weekAvg}.${gap}`;
}

/** "On pace" when the week's weight is moving toward the goal (or already there); "Off pace"
 *  when it's moving away. Weight is a season arc, so this is directional, not a score. */
function paceLabel(weekChange: number, toGoal: number): string {
  if (Math.abs(toGoal) < 0.5) return 'At goal';
  if (weekChange === 0) return 'Holding';
  // toGoal > 0 → need to gain; on pace if the week gained. toGoal < 0 → need to cut.
  const towardGoal = toGoal > 0 ? weekChange > 0 : weekChange < 0;
  return towardGoal ? 'On pace' : 'Off pace';
}

function fmtWeight(w: number): string {
  return (Math.round(w * 10) / 10).toFixed(1);
}

/* ============================================================================
   SVG sparkline helpers — trendGeometry emits paths in a 116-tall box; the
   compact sparkline draws in a 44-tall box, so rescale the y coordinates.
   ============================================================================ */
function rescale(y: number, fromH: number, toH: number): number {
  return +((y / fromH) * toH).toFixed(1);
}

/** Rewrite every "x,y" pair in an SVG path so its y is rescaled from `fromH` to `toH`. */
function scaleY(path: string, fromH: number, toH: number): string {
  return path.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_m, x, y) => `${x},${rescale(parseFloat(y), fromH, toH)}`);
}

/* ============================================================================
   Presentational pieces (proto markup → RN).
   ============================================================================ */

/** Section label (proto `.eyebrow`): 11px extra-bold, wide tracking, uppercase, tertiary. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <Txt w="eb" size={11} color={c.textTertiary} ls={1.4} upper style={{ marginTop: 26, marginBottom: 12, marginHorizontal: 2 }}>
      {children}
    </Txt>
  );
}

/** Range segmented control (proto `.seg`) — visual range switch; Week is the live view. */
function Segmented({ options, active }: { options: string[]; active: number }) {
  const c = useColors();
  const [sel, setSel] = React.useState(active);
  return (
    <Row style={{ gap: 4, padding: 4, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, borderRadius: 999, marginTop: 6 }}>
      {options.map((o, i) => {
        const on = i === sel;
        return (
          <Pressable
            key={o}
            accessibilityRole="tab"
            accessibilityLabel={o}
            accessibilityState={{ selected: on }}
            onPress={() => setSel(i)}
            style={{ flex: 1, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface3 : 'transparent' }}
          >
            <Txt w="b" size={13} color={on ? c.text : c.textSecondary} maxFontSizeMultiplier={MAX_FONT_SCALE}>{o}</Txt>
          </Pressable>
        );
      })}
    </Row>
  );
}

/** One of the three coach-stat tiles (proto `.coach-stat`): big value + uppercase caption. */
function StatTile({ value, label, color }: { value: string; label: string; color?: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 15, paddingHorizontal: 6, borderRadius: 15, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline }}>
      <Txt w="eb" num size={25} ls={-0.6} color={color ?? c.text}>{value}</Txt>
      <Txt w="b" size={10.5} color={c.textTertiary} ls={0.5} upper style={{ marginTop: 3, textAlign: 'center' }}>{label}</Txt>
    </View>
  );
}

/** The honest day-0 / building-history state (proto's `RT.day0` branch): an empty-state card
 *  that points at logging, plus a "what you'll see here" preview box. No fabricated stats. */
function BuildingState({ onLog, realDays, isDay0 }: { onLog: () => void; realDays: number; isDay0: boolean }) {
  const c = useColors();
  return (
    <View>
      <View style={{ marginTop: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: c.hairline, borderRadius: 22, paddingVertical: 24, paddingHorizontal: 18, alignItems: 'center', marginBottom: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 13 }}>
          <Icon name="trophy" size={24} color={c.textTertiary} />
        </View>
        <Txt w="eb" size={16}>Progress builds as you log</Txt>
        <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 19, paddingHorizontal: 8 }}>
          {isDay0
            ? 'After your first few days, trends, streaks, and patterns show up here. Day one is about one thing: log the meals.'
            : `You’ve got ${realDays} day${realDays === 1 ? '' : 's'} of real data. A couple more and your weekly trend, consistency, and biggest pattern unlock here.`}
        </Txt>
        <PressScale
          accessibilityLabel="Log a meal"
          haptic="success"
          onPress={onLog}
          style={[{ marginTop: 14, height: 44, paddingHorizontal: 22, borderRadius: 14, backgroundColor: c.success, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, shadow.ctaGreen]}
        >
          <Icon name="camera" size={17} color={c.onGreen} />
          <Txt w="eb" size={14.5} color={c.onGreen} maxFontSizeMultiplier={MAX_FONT_SCALE}>Log a Meal</Txt>
        </PressScale>
      </View>

      <View style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 15, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'flex-start' }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevronRight" size={17} color={c.accentLight} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={13.5}>What you’ll see here</Txt>
          <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
            Your weekly score trend, requirement consistency, your biggest pattern, weight trend toward the coach target, and where points slipped.
          </Txt>
        </View>
      </View>
    </View>
  );
}
