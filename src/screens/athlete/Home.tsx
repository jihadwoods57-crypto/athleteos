// OnStandard — Athlete Home (redesign 2026-07, faithful rebuild of the proto Home).
// Top → bottom: app head · score-ring hero (tap → breakdown) · next-action green CTA ·
// Trust Pass · Today's Requirements card · Recent Activity h-scroll · Finish Today card.
// Every value reads off the SAME real store/derived sources the old Home used — no
// fabricated meal scores, streaks, or trends. Where the proto shows data the RN app does
// not have (per-meal "Scored 95", meal photos), the row adapts honestly.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  firstName,
  greeting,
  initials,
  heroStatus,
  streakInfo,
  projectedScore,
  nextBestAction,
  passStatus,
  withinTrailingWeek,
  todayStamp,
  SCORE_WEIGHTS,
  type MealKey,
} from '@/core';
import { useStore, useDerived } from '@/store';
import { isStreakGraceEnabled, isTrustPassEnabled } from '@/lib/features';
import { ringGradient, tierChip, MAX_FONT_SCALE, shadow, typeScale } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, PressScale, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon, IconName } from '@/icons';
import { Ring } from '@/ui/Ring';

/** Accent class per the proto's semantic color system: g green · a amber · b blue · p purple. */
type Accent = 'g' | 'a' | 'b' | 'p';

/** One Today's-Requirements row, fully resolved from real state. */
interface Req {
  id: string;
  title: string;
  icon: IconName;
  accent: Accent;
  status: string;
  statusColor: Accent;
  sub: string;
  subColor: Accent;
  meta: string;
  done: boolean;
  missed?: boolean;
  onPress?: () => void;
}

export function Home() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = useDerived();

  // A real athlete has set their name; the unnamed seeded state is the demo showcase.
  // Gates showcase-only strings with no real data source (an unread-notification dot).
  const isReal = s.athleteName.trim().length > 0;
  const name = firstName(s.athleteName, 'Jihad');
  const monogram = initials(s.athleteName, 'J');

  // Reward moment: the hero number + ring count up to the new value after a log.
  const shownScore = useCountUp(d.athleteScore);
  const status = heroStatus(s, d);

  // Day streak (same honest source as before): real athletes walk calendar days; the
  // dateless showcase keeps its seed pad. atRisk reads today's sub-threshold state honestly.
  const streakData = streakInfo(s.scoreHistory, d.athleteScore, {
    seedPad: !isReal,
    grace: isStreakGraceEnabled,
    today: isReal ? s.dateStamp : undefined,
  });
  const streak = streakData.days;

  // Forward-looking projection: current score, where it reaches if today's controllable
  // actions get done, and the checklist. Drives the hero-foot count + Finish Today card.
  const projection = projectedScore(s);
  const na = nextBestAction(s, d);

  // Trust Pass (flag-gated) — the honest camera-free banner.
  const tpStatus = isTrustPassEnabled ? passStatus(s.trustPass, s.dateStamp) : null;

  // ---- Today's Requirements, resolved from real logging state ----
  const reqs = buildRequirements(s, d);
  const metCount = reqs.filter((r) => r.done).length;
  const reqTotal = reqs.length;
  // "N requirements remaining to reach {possible}" — remaining = the pending SCORED rows
  // (weight is trend-only, so it never blocks the standard). possible = projected score.
  const remaining = reqs.filter((r) => !r.done && r.id !== 'weight').length;
  const possible = projection.projected;

  // ---- Recent Activity, from real logged meals + hydration + recovery ----
  const activity = buildActivity(s, d);

  // In-screen score breakdown (the hero "tap → score-breakdown"): RN has no separate
  // breakdown route, so tapping the hero expands the weights panel below it.
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + 10, paddingHorizontal: 20, paddingBottom: 130 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ===== 1 · App head ===== */}
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 8 }}>
        <View>
          <Txt w="sb" size={15} color={c.textSecondary} ls={0.1}>
            {greeting()},
          </Txt>
          <Txt w="eb" size={27} ls={-0.5} accessibilityRole="header" style={{ marginTop: 2 }}>
            {name}
          </Txt>
        </View>
        <Row style={{ gap: 10, marginTop: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            hitSlop={6}
            onPress={s.openNotif}
            style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="bell" size={20} color={c.text} />
            {/* Unread dot is showcase only: no real seen/unseen model, so an always-on dot
                would fake unread urgency for a real athlete. */}
            {!isReal ? (
              <View style={{ position: 'absolute', top: 8, right: 9, minWidth: 8, height: 8, borderRadius: 4, backgroundColor: c.alert, borderWidth: 2, borderColor: c.card }} />
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profile"
            hitSlop={6}
            onPress={s.goProfile}
            style={[{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }, shadow.cta]}
          >
            <Txt w="eb" size={15} color={c.white} ls={-0.2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {monogram}
            </Txt>
          </Pressable>
        </Row>
      </Row>

      {/* Honest sync state: when the last push to the server failed, say so. */}
      {s.syncState === 'error' ? (
        <Row style={{ gap: 9, alignItems: 'center', backgroundColor: c.alertSurface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.alert }} />
          <Txt w="sb" size={12.5} color={c.alertDeep} style={{ flex: 1 }}>
            Not synced — your coach may not see today yet. We’ll retry when you’re back online.
          </Txt>
        </Row>
      ) : null}

      {/* ===== 2 · Hero — the uncontained score ring, tap → breakdown ===== */}
      <Reveal index={0}>
        <PressScale
          accessibilityLabel="OnStandard score. Tap for the breakdown."
          haptic="tap"
          onPress={() => setBreakdownOpen((v) => !v)}
          style={{ paddingTop: 6, paddingBottom: 4 }}
        >
          <View style={{ alignItems: 'center' }}>
            <Ring size={236} pct={shownScore} stroke={20} gradient={ringGradient} track={c.track}>
              <Txt w="b" size={12} color={c.slate600} ls={1.6} upper style={{ marginBottom: 2 }}>
                OnStandard Score
              </Txt>
              <Txt
                w="eb"
                num
                size={typeScale.display.size + 20}
                ls={-3}
                style={{ lineHeight: (typeScale.display.size + 20) * 0.98 }}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {shownScore}
              </Txt>
              <Txt w="b" size={14} color={c.textSecondary} style={{ marginTop: -2 }}>
                /100
              </Txt>
              <View style={{ marginTop: 8, paddingHorizontal: 13, paddingVertical: 5, borderRadius: 999, backgroundColor: tierChip[d.tier.short].bg, borderWidth: 1, borderColor: tierChip[d.tier.short].border }}>
                <Txt w="eb" size={11} color={tierChip[d.tier.short].fg} ls={1.2} upper maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {d.tier.name}
                </Txt>
              </View>
              {!d.isDay0 && d.scoreDelta > 0 ? (
                <Row style={{ gap: 5, alignItems: 'center', marginTop: 10 }}>
                  <Icon name="chevronRight" size={13} color={c.success} strokeWidth={2.6} />
                  <Txt w="b" size={13} color={c.success}>
                    +{d.scoreDelta} pts
                  </Txt>
                  <Txt w="sb" size={13} color={c.textSecondary}>
                    vs yesterday
                  </Txt>
                </Row>
              ) : d.isDay0 ? (
                <Txt w="b" size={13} color={c.textSecondary} style={{ marginTop: 10 }}>
                  {s.startScore != null ? `Baseline ${s.startScore}` : 'Starting today'}
                </Txt>
              ) : null}
              {/* Streak pill — flame dims when at risk so a bare 0 never reads as a false green. */}
              <Row
                accessibilityRole="text"
                accessibilityLabel={streakData.atRisk ? 'Streak breaks today — log to keep your standard' : `${streak} day streak`}
                style={{ gap: 7, alignItems: 'center', marginTop: 12, paddingVertical: 8, paddingLeft: 13, paddingRight: 16, borderRadius: 999, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}
              >
                <Icon name="flame" size={14} color={streakData.atRisk ? c.textTertiary : c.warningDeep} />
                <Txt w="eb" size={13} color={streakData.atRisk ? c.textTertiary : c.text} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {streak} day{streak === 1 ? '' : 's'} streak
                </Txt>
              </Row>
            </Ring>
          </View>

          {/* hero-foot: requirements remaining to reach {possible}, or day-complete standard line. */}
          <Txt w="sb" size={15} color={c.textSecondary} style={{ marginTop: 14, textAlign: 'center', lineHeight: 21 }}>
            {remaining === 0 ? (
              <>
                Day complete at <Txt w="eb" size={15} color={c.success}>{d.athleteScore}</Txt>. That’s the standard.
              </>
            ) : (
              <>
                <Txt w="eb" size={15} color={c.success}>{remaining} requirement{remaining === 1 ? '' : 's'}</Txt> remaining to reach{' '}
                <Txt w="eb" size={15} color={c.success}>{possible}</Txt>.
              </>
            )}
          </Txt>
        </PressScale>
      </Reveal>

      {/* Score breakdown — revealed when the hero is tapped (the proto's score-breakdown route). */}
      {breakdownOpen ? (
        <Card variant="low" style={{ marginTop: 12, borderRadius: 20, padding: 18 }}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} upper style={{ marginBottom: 14 }}>
            What’s in this score
          </Txt>
          <View style={{ gap: 13 }}>
            {SCORE_WEIGHTS.map((w) => (
              <View key={w.key}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt w="b" size={14}>{w.label}</Txt>
                  <Txt w="eb" size={14} color={c.accent}>{w.pct}%</Txt>
                </Row>
                <Txt w="m" size={12} color={c.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>
                  {w.desc}
                </Txt>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {/* ===== 3 · Next action — the big green CTA (or the done state) ===== */}
      <View style={{ marginTop: 16 }}>
        {na.done ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, borderRadius: 22, backgroundColor: c.successTint, borderWidth: 1, borderColor: c.successBorderSoft }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={22} color={c.successDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={15.5}>You’re OnStandard. Nothing left today.</Txt>
              <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>
                Every requirement is in. Day {streak + 1} of your streak locks at midnight.
              </Txt>
            </View>
          </View>
        ) : (
          <GreenCta
            label={na.title}
            gain={ctaGain(na.key, projection)}
            icon={na.cta === 'checkin' ? 'checkin' : na.cta === 'water' ? 'drop' : 'camera'}
            onPress={
              na.cta === 'meal' ? s.openMeal
              : na.cta === 'water' ? s.addWater
              : na.cta === 'checkin' ? s.goCheckin
              : na.cta === 'plan' ? s.goTasks
              : undefined
            }
          />
        )}
      </View>

      {/* ===== 4 · Trust Pass (only while active) ===== */}
      {tpStatus?.phase === 'active' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, marginTop: 14, backgroundColor: c.trainer + '22', borderWidth: 1, borderColor: c.trainer + '55' }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.trainer + '22', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={20} color={c.trainerLight} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={14}>Trust Pass · day {tpStatus.dayIndex + 1} of {s.trustPass?.lengthDays ?? 0}</Txt>
            <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>
              {tpStatus.isCheckDay
                ? 'Spot-check today — log your meals with a photo.'
                : 'On standard, camera-free today. Credited from your proven baseline.'}
            </Txt>
          </View>
        </View>
      ) : null}

      {/* ===== 5 · Today's Requirements ===== */}
      <Card variant="low" style={{ marginTop: 14, borderRadius: 22, padding: 0, overflow: 'hidden' }}>
        <Txt w="eb" size={12} color={c.textSecondary} ls={1.1} upper style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 4 }}>
          Today’s Requirements
        </Txt>
        {reqs.map((r, i) => (
          <ReqRow key={r.id} req={r} first={i === 0} />
        ))}
        <View style={{ height: 8 }} />
      </Card>

      {/* ===== 6 · Recent Activity ===== */}
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 26, marginBottom: 12, paddingHorizontal: 2 }}>
        <Txt w="eb" size={11} color={c.textTertiary} ls={1.5} upper>
          Recent Activity
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="View all activity" hitSlop={6} onPress={s.goPerformance}>
          <Txt w="b" size={13} color={c.accentLight}>View all</Txt>
        </Pressable>
      </Row>
      {activity.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -20 }}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 4 }}
        >
          {activity.map((a) => (
            <ActCard key={a.key} act={a} onPress={a.onPress} />
          ))}
        </ScrollView>
      ) : (
        <View style={{ borderWidth: 1, borderColor: c.hairline, borderStyle: 'dashed', borderRadius: 22, padding: 22, alignItems: 'center' }}>
          <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="camera" size={24} color={c.textTertiary} />
          </View>
          <Txt w="eb" size={15}>No logs yet</Txt>
          <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 5, textAlign: 'center', lineHeight: 18 }}>
            Your proof trail builds here as you log. Take a photo to begin today’s standard.
          </Txt>
        </View>
      )}

      {/* ===== 7 · Finish Today ===== */}
      <Card variant="low" style={{ marginTop: 20, borderRadius: 22, padding: 16 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <Row style={{ gap: 9, alignItems: 'center' }}>
            <Icon name="trophy" size={17} color={c.textSecondary} />
            <Txt w="eb" size={12} color={c.textSecondary} ls={1.3} upper>Finish Today</Txt>
          </Row>
          <Txt w="eb" size={12} color={c.textSecondary}>{metCount} of {reqTotal} in</Txt>
        </Row>

        {/* segment bars — filled = met */}
        <Row style={{ gap: 6, marginBottom: 14 }}>
          {reqs.map((r) => (
            <View
              key={r.id}
              style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: r.done ? c.success : c.surface3 }}
            />
          ))}
        </Row>

        {/* score bridge: current → possible with a fill + note */}
        <Row style={{ gap: 12, alignItems: 'center' }}>
          <Txt w="eb" num size={30} ls={-0.9}>{projection.current}</Txt>
          <View style={{ flex: 1 }}>
            <View style={{ height: 7, borderRadius: 4, backgroundColor: c.surface3, overflow: 'hidden' }}>
              <View style={{ width: `${Math.round((projection.current / Math.max(1, possible)) * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: c.success }} />
            </View>
            <Txt w="b" size={10.5} color={c.textTertiary} style={{ marginTop: 6, textAlign: 'center' }}>
              {remaining === 0 ? 'everything is in' : `+${Math.max(0, possible - projection.current)} still on the table`}
            </Txt>
          </View>
          <Txt w="eb" num size={30} ls={-0.9} color={c.success}>{possible}</Txt>
        </Row>

        {/* next biggest move(s) */}
        {!na.done ? (
          <View style={{ marginTop: 14, gap: 8 }}>
            <FinishMove
              icon={na.cta === 'checkin' ? 'checkin' : na.cta === 'water' ? 'drop' : 'utensils'}
              accent={na.cta === 'checkin' ? 'p' : na.cta === 'water' ? 'b' : 'g'}
              title={na.title}
              sub="next biggest move"
              value={ctaGain(na.key, projection) != null ? `+${ctaGain(na.key, projection)}` : 'now'}
              onPress={
                na.cta === 'meal' ? s.openMeal
                : na.cta === 'water' ? s.addWater
                : na.cta === 'checkin' ? s.goCheckin
                : na.cta === 'plan' ? s.goTasks
                : undefined
              }
            />
            {/* Recovery is the highest-risk night habit — surface it while it's still open. */}
            {!d.recoveryScoreIsReal && na.cta !== 'checkin' ? (
              <FinishMove
                icon="checkin"
                accent="a"
                title="Recovery check-in"
                sub="highest risk · keeps the streak"
                value="tonight"
                valueColor={c.warningDeep}
                onPress={s.goCheckin}
              />
            ) : null}
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: c.successTint, borderWidth: 1, borderColor: c.successBorderSoft }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={19} color={c.successDeep} />
            </View>
            <Txt w="eb" size={15}>Done at {d.athleteScore}. That’s the standard.</Txt>
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

/* ============================================================================
   Data builders — every row/card resolved from REAL state (no fabrication).
   ============================================================================ */

/** Build Today's Requirements from real logging state. Meals/weight/recovery/weekly each
 *  carry a done/pending/meta derived from what the athlete has actually done today. */
function buildRequirements(
  s: ReturnType<typeof useStore.getState>,
  d: ReturnType<typeof useDerived>,
): Req[] {
  const mealRow = (key: MealKey, title: string, dueHint: string): Req => {
    const done = s.meals[key];
    return {
      id: key,
      title,
      icon: key === 'breakfast' ? 'utensils' : 'utensils',
      accent: done ? 'g' : 'a',
      status: done ? 'Logged' : 'Open',
      statusColor: done ? 'g' : 'a',
      sub: done ? 'Photo logged' : dueHint,
      subColor: done ? 'g' : 'a',
      meta: done ? 'Logged' : '+ pts',
      done,
      onPress: s.openMeal,
    };
  };

  const weightDone = s.weighInStamp === todayStamp();
  const recoveryDone = d.recoveryScoreIsReal;
  const weeklyDone = s.ciSubmitted || (s.ciLast != null && withinTrailingWeek(s.ciLast.date, s.dateStamp));

  return [
    mealRow('breakfast', 'Breakfast', 'Photo proof'),
    mealRow('lunch', 'Lunch', 'Photo proof'),
    mealRow('dinner', 'Dinner', 'Photo proof'),
    {
      id: 'weight',
      title: 'Morning Weight',
      icon: 'trophy',
      accent: weightDone ? 'g' : 'a',
      status: weightDone ? 'Logged' : 'Optional',
      statusColor: weightDone ? 'g' : 'a',
      sub: weightDone ? 'Logged today' : 'Tracks your season trend',
      subColor: weightDone ? 'g' : 'a',
      // Weight is deliberately OUT of the daily score (season-goal arc) — say so honestly.
      meta: weightDone ? 'Trend only' : 'Not scored',
      done: weightDone,
      onPress: s.goProfile,
    },
    {
      id: 'recovery',
      title: 'Recovery Check-In',
      icon: 'checkin',
      accent: recoveryDone ? 'g' : 'p',
      status: recoveryDone ? 'Done' : 'Before bed',
      statusColor: recoveryDone ? 'g' : 'p',
      sub: recoveryDone ? 'Submitted tonight' : 'Sleep, soreness, energy',
      subColor: recoveryDone ? 'g' : 'p',
      // Recovery IS scored, and its number is real — show it when submitted (no fake score).
      meta: recoveryDone ? `Scored ${d.recoveryScore}` : '+ pts',
      done: recoveryDone,
      onPress: s.goCheckin,
    },
    {
      id: 'weekly',
      title: 'Weekly Check-In',
      icon: 'checkin',
      accent: weeklyDone ? 'g' : 'b',
      status: weeklyDone ? 'Done' : 'This week',
      statusColor: weeklyDone ? 'g' : 'b',
      sub: weeklyDone ? 'Submitted this week' : 'Form + weight, ~2 min',
      subColor: weeklyDone ? 'g' : 'b',
      meta: weeklyDone ? 'Complete' : '+ pts',
      done: weeklyDone,
      missed: false,
      onPress: s.goCheckin,
    },
  ];
}

interface Act {
  key: string;
  time: string;
  type: string;
  value: string;
  vClass: Accent | 'muted';
  icon: IconName;
  dim?: boolean;
  onPress?: () => void;
}

/** Recent Activity from real logged meals + hydration + recovery. RN has no meal photos,
 *  so each card uses an icon/gradient media tile (honest — nothing fabricated). */
function buildActivity(
  s: ReturnType<typeof useStore.getState>,
  d: ReturnType<typeof useDerived>,
): Act[] {
  const out: Act[] = [];
  const mealTypes: { key: MealKey; label: string }[] = [
    { key: 'breakfast', label: 'Breakfast' },
    { key: 'lunch', label: 'Lunch' },
    { key: 'dinner', label: 'Dinner' },
  ];
  for (const m of mealTypes) {
    if (s.meals[m.key]) {
      out.push({ key: m.key, time: 'Today', type: m.label, value: 'Logged', vClass: 'g', icon: 'utensils', onPress: () => s.openMealDetail(m.key) });
    }
  }
  if (s.hydrationL > 0) {
    out.push({ key: 'hydration', time: 'Today', type: 'Hydration', value: `${s.hydrationL} L`, vClass: 'b', icon: 'drop' });
  }
  out.push(
    d.recoveryScoreIsReal
      ? { key: 'recovery', time: 'Tonight', type: 'Recovery Check-In', value: `${d.recoveryScore}`, vClass: 'g', icon: 'checkin', onPress: s.goCheckin }
      : { key: 'recovery', time: 'Tonight', type: 'Recovery Check-In', value: 'Upcoming', vClass: 'muted', icon: 'checkin', dim: true, onPress: s.goCheckin },
  );
  return out;
}

/** The point gain to show on the next-action CTA / finish move, read off the projection. */
function ctaGain(key: string, projection: ReturnType<typeof projectedScore>): number | null {
  // The projection's total gain is the honest upside for finishing the day; show it on the
  // single next action so the "+N pts" is real (never a fabricated per-item number).
  return projection.gain > 0 ? projection.gain : null;
}

/* ============================================================================
   Presentational pieces (proto markup → RN).
   ============================================================================ */

const ACCENT_SURFACE: Record<Accent, (c: ReturnType<typeof useColors>) => string> = {
  g: (c) => c.successSurface,
  a: (c) => c.warnTint,
  b: (c) => c.accentSurface,
  p: (c) => c.trainer + '22',
};
const ACCENT_FG: Record<Accent, (c: ReturnType<typeof useColors>) => string> = {
  g: (c) => c.success,
  a: (c) => c.warningDeep,
  b: (c) => c.accentLight,
  p: (c) => c.trainerLight,
};

/** The green next-action button (proto `.btn.green` in `.next-cta`). Near-black text on green. */
function GreenCta({ label, gain, icon, onPress }: { label: string; gain: number | null; icon: IconName; onPress?: () => void }) {
  const c = useColors();
  return (
    <PressScale
      accessibilityLabel={`${label}${gain ? `, plus ${gain} points` : ''}`}
      haptic="success"
      onPress={onPress}
      style={[{ height: 58, borderRadius: 17, backgroundColor: c.success, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 }, shadow.ctaGreen]}
    >
      <Icon name={icon} size={20} color={c.onGreen} />
      <Txt w="eb" size={16.5} color={c.onGreen} ls={-0.2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}{gain ? ` · +${gain} pts` : ''}
      </Txt>
    </PressScale>
  );
}

/** One Today's-Requirements row: icon tile (with corner status badge) · title + sub ·
 *  status pill + meta · chevron. Done rows read green. */
function ReqRow({ req, first }: { req: Req; first: boolean }) {
  const c = useColors();
  const tileBg = ACCENT_SURFACE[req.accent](c);
  const fg = ACCENT_FG[req.accent](c);
  const statusFg = ACCENT_FG[req.statusColor](c);
  const subFg = req.subColor === 'g' ? c.success : req.subColor === 'a' ? c.warningDeep : req.subColor === 'b' ? c.accentLight : c.trainerLight;
  const metaColor = req.done ? c.success : req.missed ? c.textTertiary : fg;

  const body = (
    <>
      {/* icon tile with corner status badge */}
      <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: tileBg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={req.icon} size={20} color={fg} />
        <View style={{ position: 'absolute', top: -5, left: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: req.done ? c.success : c.card, borderWidth: 2, borderColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={req.done ? 'check' : 'checkin'} size={req.done ? 10 : 9} color={req.done ? c.onGreen : fg} strokeWidth={2.6} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt w="eb" size={15} ls={-0.2} numberOfLines={1}>{req.title}</Txt>
        <Txt w="sb" size={12.5} color={subFg} numberOfLines={1} style={{ marginTop: 2 }}>{req.sub}</Txt>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1.5, borderColor: statusFg + '66', backgroundColor: req.statusColor === 'g' ? c.successSurface : 'transparent' }}>
          <Txt w="eb" size={11} color={statusFg} ls={0.2}>{req.status}</Txt>
        </View>
        <Txt w="eb" size={13} color={metaColor}>{req.meta}</Txt>
      </View>
      <Icon name="chevronRight" size={18} color={c.textTertiary} />
    </>
  );

  const rowInner = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 };
  if (req.done) {
    // Done row: green wash + border, its own inset (proto `.req-row.done`).
    return (
      <PressScale accessibilityLabel={`${req.title}, ${req.status}`} onPress={req.onPress} style={[rowInner, { marginHorizontal: 6, marginVertical: 2, paddingVertical: 13, paddingLeft: 11, paddingRight: 13, borderRadius: 16, backgroundColor: c.successSurface, borderWidth: 1, borderColor: c.successBorderSoft }]}>
        {body}
      </PressScale>
    );
  }
  return (
    <View>
      {/* hairline divider between consecutive pending rows */}
      {!first ? <View style={{ height: 1, backgroundColor: c.hairline, marginLeft: 66, marginRight: 12 }} /> : null}
      <PressScale accessibilityLabel={`${req.title}, ${req.status}`} onPress={req.onPress} style={[rowInner, { marginHorizontal: 6, paddingVertical: 14, paddingLeft: 12, paddingRight: 14, borderRadius: 16 }]}>
        {body}
      </PressScale>
    </View>
  );
}

/** One Recent Activity card (proto `.act-card`): time · media tile · type · value. */
function ActCard({ act, onPress }: { act: Act; onPress?: () => void }) {
  const c = useColors();
  const valueColor = act.vClass === 'g' ? c.success : act.vClass === 'b' ? c.accentLight : c.textTertiary;
  const mediaFg = act.icon === 'drop' ? c.cyan : act.dim ? c.trainerLight : c.success;
  const body = (
    <View style={{ width: 158, borderRadius: 20, overflow: 'hidden', backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline }}>
      <Txt w="b" size={11.5} color={c.textTertiary} style={{ paddingHorizontal: 14, paddingTop: 12 }}>{act.time}</Txt>
      <View style={{ height: 104, marginHorizontal: 10, marginTop: 10, borderRadius: 14, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Icon name={act.icon} size={34} color={mediaFg} />
        {act.dim ? <View style={{ position: 'absolute', inset: 0, backgroundColor: '#070B1488' }} /> : null}
      </View>
      <View style={{ padding: 14, paddingTop: 11 }}>
        <Txt w="b" size={13} color={c.textSecondary} numberOfLines={1}>{act.type}</Txt>
        <Txt w="eb" size={act.vClass === 'muted' ? 14 : 20} ls={-0.3} color={valueColor} style={{ marginTop: 2 }} numberOfLines={1}>
          {act.value}
        </Txt>
      </View>
    </View>
  );
  return onPress ? (
    <PressScale accessibilityLabel={`${act.type}: ${act.value}`} onPress={onPress}>{body}</PressScale>
  ) : (
    body
  );
}

/** One Finish-Today "next move" row (proto `.fmove`). */
function FinishMove({ icon, accent, title, sub, value, valueColor, onPress }: { icon: IconName; accent: Accent; title: string; sub: string; value: string; valueColor?: string; onPress?: () => void }) {
  const c = useColors();
  const tileBg = ACCENT_SURFACE[accent](c);
  const fg = ACCENT_FG[accent](c);
  return (
    <PressScale
      accessibilityLabel={`${title}, ${sub}`}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11, borderRadius: 15, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: tileBg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="eb" size={14.5} numberOfLines={1}>{title}</Txt>
        <Txt w="sb" size={11.5} color={c.textTertiary} style={{ marginTop: 1 }}>{sub}</Txt>
      </View>
      <Txt w="eb" size={15} color={valueColor ?? c.success}>{value}</Txt>
    </PressScale>
  );
}

/* ============================================================================
   Count-up: animate a number toward `target` (snaps on mount; counts on change).
   ============================================================================ */
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
