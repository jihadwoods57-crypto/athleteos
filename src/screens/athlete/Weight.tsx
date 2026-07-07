// OnStandard — Morning Weight: the proto's weight screen (proto/redesign-2026-07/js/
// screens/weight.js) ported onto REAL store state. Layout follows the proto exactly:
// back header, the big current number + tap-to-adjust stepper, the "Season goal" trend
// card (gradient sparkline + CURRENT / THIS WEEK / TARGET), the "doesn't touch today's
// score" sidebox, and the green log CTA. Every value is live:
//   · big number   = local draft seeded from s.currentWeight, stepped by weightStepLb
//   · trend        = last TREND_WINDOW-1 recorded weightHistory points + live currentWeight
//                    (no history → an honest "logs build your trend" empty state; the
//                    ParentView ramp-padding is deliberately NOT used here)
//   · last logged  = s.weighInStamp; delta = weeklyWeightProgress over real history
//   · pace pill    = seasonGoalPhase guards the claim (no pace claim on day 0),
//                    weightProgressTone colors by GOAL, not direction
//   · CTA          = the store's real logWeight(lb) action, then home (proto data-then)
// Honesty deltas from the demo proto: no fabricated "Required Mon/Wed/Fri" schedule, no
// fake photo-proof row (no weight-proof path exists in core), no "(late)" overdue state,
// and "coach target" reads "your target" (the target is athlete-editable, not coach-set).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  displayWeight,
  displayWeightDelta,
  seasonGoalPhase,
  seasonGoalProgress,
  todayStamp,
  trendGeometry,
  TREND_WINDOW,
  WEIGHT_START,
  WEIGHT_TARGET,
  weightProgressTone,
  weightStepLb,
  weightUnit,
  weeklyWeightProgress,
  type ChartBox,
} from '@/core';
import { useStore } from '@/store';
import { MAX_FONT_SCALE, radius, shadow, tierChip, typeScale } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Btn, Card, Pressable, Reveal, Row, Txt } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-07-04" → "Jul 4", parsed by parts (never new Date(iso) — that shifts to UTC). */
function fmtStamp(stamp: string): string {
  const [y, m, d] = stamp.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return stamp;
  return `${MONTHS[m - 1]} ${d}`;
}

/** Proto sparkline box: 300×70, 6px x-pad, line lives between y=14 and y=60. */
const SPARK_W = 300;
const SPARK_H = 70;

export function Weight() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const s = useStore();

  const units = s.units ?? 'imperial';
  const wUnit = weightUnit(units);
  const stepLb = weightStepLb(units); // ± moves exactly one whole display unit
  const start = s.startWeight ?? WEIGHT_START;
  const target = s.weightTarget ?? WEIGHT_TARGET;
  const current = Number.isFinite(s.currentWeight) ? s.currentWeight : start;

  // The stepper adjusts a LOCAL draft (the proto's mount() does the same on the display
  // value); nothing is written until the CTA calls the store's real logWeight action.
  const [draft, setDraft] = React.useState(current);
  const step = (d: number) => {
    haptics.select();
    setDraft((v) => Math.max(60, Math.min(500, v + d))); // mirror logWeight's clamp
  };

  const loggedToday = s.weighInStamp === todayStamp();
  const headSub = loggedToday
    ? 'Logged today · season trend, not scored'
    : s.weighInStamp
      ? `Last logged ${fmtStamp(s.weighInStamp)} · season trend, not scored`
      : 'Season trend, not scored · your first log starts it';

  // Trend series: the same window the "this week" delta reads, so the line and the
  // number describe the same days. Live currentWeight is always the last point.
  const past = s.weightHistory.slice(-(TREND_WINDOW - 1)).map((h) => h.weight);
  const series = [...past, current];
  const hasTrend = past.length > 0;
  const spark = (() => {
    if (!hasTrend) return null;
    const lo = Math.min(...series);
    const hi = Math.max(...series);
    const padY = Math.max(0.5, (hi - lo) * 0.12);
    const box: ChartBox = { width: SPARK_W, height: SPARK_H, padX: 6, padTop: 14, padBottom: 10, min: lo - padY, max: hi + padY };
    return trendGeometry(series, box);
  })();

  // Pace pill: no pace claim until there's data to project from (seasonGoalPhase),
  // then tone-by-goal (a cut athlete's loss is "On pace", never an alarm).
  const prog = seasonGoalProgress(current, start, target);
  const phase = seasonGoalPhase({ pctThere: prog.pctThere, currentWeight: current, start, weightHistoryLen: s.weightHistory.length });
  const seasonTone = weightProgressTone(current - start, s.baseGoal);
  const pill =
    phase === 'reached'
      ? { label: 'Goal reached', fg: tierChip.g.fg, bg: tierChip.g.bg, border: tierChip.g.border }
      : phase === 'first-run'
        ? { label: 'No trend yet', fg: c.textTertiary, bg: c.surface2, border: c.hairline }
        : seasonTone === 'good'
          ? { label: 'On pace', fg: tierChip.g.fg, bg: tierChip.g.bg, border: tierChip.g.border }
          : seasonTone === 'bad'
            ? { label: 'Off pace', fg: tierChip.a.fg, bg: tierChip.a.bg, border: tierChip.a.border }
            : { label: 'Tracking', fg: tierChip.b.fg, bg: tierChip.b.bg, border: tierChip.b.border };

  // This week's movement, from recorded history only (day 0 honestly reads 0.0).
  const weekLb = weeklyWeightProgress(s.weightHistory, current, start);
  const weekDisp = displayWeightDelta(weekLb, units);
  const weekTone = weightProgressTone(weekLb, s.baseGoal);
  const weekColor = weekTone === 'good' ? c.success : weekTone === 'bad' ? c.alert : c.text;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 140 }}
      showsVerticalScrollIndicator={false}
    >
      {/* back header (proto backHead) */}
      <Row style={{ gap: 14, paddingBottom: 14 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
          hitSlop={6}
          onPress={s.goHome}
          style={[
            { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center' },
            shadow.card,
          ]}
        >
          <Icon name="chevronLeft" size={20} color={c.text} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt w="eb" size={20} ls={-0.5} accessibilityRole="header">
            Morning Weight
          </Txt>
          <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 1 }} numberOfLines={1}>
            {headSub}
          </Txt>
        </View>
      </Row>

      {/* the big number + stepper (proto .weight-display / .stepper) */}
      <Reveal index={0}>
        <Card style={{ paddingTop: 8, paddingHorizontal: 18, paddingBottom: 20 }}>
          <View style={{ alignItems: 'center', paddingTop: 22, paddingBottom: 8 }}>
            <Txt
              w="eb"
              num
              size={76}
              ls={-3.8}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              accessibilityLabel={`${displayWeight(draft, units)} ${wUnit}`}
              style={{ lineHeight: 80 }}
            >
              {displayWeight(draft, units)}
              <Txt w="b" size={17} color={c.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {' '}
                {wUnit}
              </Txt>
            </Txt>
          </View>
          <Row style={{ justifyContent: 'center', gap: 22, marginTop: 14 }}>
            <StepBtn glyph="−" label="Decrease weight" onPress={() => step(-stepLb)} />
            <Txt w="b" size={12} color={c.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              tap to adjust
            </Txt>
            <StepBtn glyph="+" label="Increase weight" onPress={() => step(stepLb)} />
          </Row>
        </Card>
      </Reveal>

      {/* season goal (proto eyebrow + trend card) */}
      <Txt w="eb" size={typeScale.overline.size} ls={typeScale.overline.ls} upper color={c.textTertiary} style={{ marginTop: 26, marginBottom: 12, marginLeft: 2 }}>
        Season goal
      </Txt>
      <Reveal index={1}>
        <Card variant="low" style={{ padding: 18 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
              <Txt w="b" size={14} color={c.textSecondary}>
                Trend toward your target
              </Txt>
              <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 2 }}>
                Started {displayWeight(start, units)} {wUnit}
              </Txt>
            </View>
            <View style={{ backgroundColor: pill.bg, borderWidth: 1, borderColor: pill.border, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Txt w="b" size={12} color={pill.fg} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {pill.label}
              </Txt>
            </View>
          </Row>

          {spark ? (
            <Svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width="100%" height={74} preserveAspectRatio="none" style={{ marginTop: 8 }}>
              <Defs>
                <LinearGradient id="weightTrendGrad" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={c.accent} stopOpacity="0.4" />
                  <Stop offset="1" stopColor={c.success} stopOpacity="1" />
                </LinearGradient>
              </Defs>
              <Path d={spark.linePath} fill="none" stroke="url(#weightTrendGrad)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={spark.last.x} cy={spark.last.y} r={8.5} fill={c.success} opacity={0.25} />
              <Circle cx={spark.last.x} cy={spark.last.y} r={4.5} fill={c.success} />
            </Svg>
          ) : (
            <View style={{ height: 74, marginTop: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radius.tile, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
              <Txt w="b" size={13}>
                Your logs build this trend
              </Txt>
              <Txt w="sb" size={11.5} color={c.textTertiary} style={{ marginTop: 3, textAlign: 'center', paddingHorizontal: 18 }}>
                Each morning weight adds a point — the line starts with your next log.
              </Txt>
            </View>
          )}

          <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <View>
              <Txt w="b" size={11} color={c.textTertiary} upper ls={0.4}>
                Current
              </Txt>
              <Txt w="eb" num size={17} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {displayWeight(current, units)} {wUnit}
              </Txt>
            </View>
            <View>
              <Txt w="b" size={11} color={c.textTertiary} upper ls={0.4}>
                This week
              </Txt>
              <Txt w="eb" num size={17} color={weekColor} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {weekDisp > 0 ? '+' : ''}
                {weekDisp} {wUnit}
              </Txt>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Txt w="b" size={11} color={c.textTertiary} upper ls={0.4}>
                Target
              </Txt>
              <Txt w="eb" num size={17} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {displayWeight(target, units)} {wUnit}
              </Txt>
            </View>
          </Row>
        </Card>
      </Reveal>

      {/* honest framing (proto .sidebox): weight is a season trend, not a scored daily */}
      <Reveal index={2}>
        <Row style={{ marginTop: 14, gap: 12, alignItems: 'flex-start', padding: 15, borderRadius: radius.tile, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
          <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={18} color={c.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="eb" size={13.5}>
              Doesn't touch today's score
            </Txt>
            <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
              Weight tracks your season goal, not your daily execution. Logging it keeps your trend real.
            </Txt>
          </View>
        </Row>
      </Reveal>

      {/* log CTA — the store's real logWeight action, then home (proto data-then="home") */}
      <Reveal index={3}>
        <Btn
          label={loggedToday ? 'Update Weight · trend only' : 'Log Weight · trend only'}
          haptic="success"
          onPress={() => {
            s.logWeight(draft);
            s.goHome();
          }}
          style={{ marginTop: 18 }}
        />
      </Reveal>
    </ScrollView>
  );
}

/** Proto .sbtn: a 52px round ± control. */
function StepBtn({ glyph, label, onPress }: { glyph: string; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center' }}
    >
      <Txt w="b" size={24} color={c.text} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
