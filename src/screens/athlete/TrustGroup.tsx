// OnStandard — History · Streak · Trust Pass detail (redesign 2026-07, faithful port of
// proto/redesign-2026-07/js/screens/trust.js: `history`, `streak`, `trust`).
//
// Every number reads off REAL state — no fabrication:
//   History : s.scoreHistory (persisted [date,score]) + tierFor per day; today is the live
//             d.athleteScore. The proto's per-day meal photo strips are NOT cheaply real here
//             (s.mealHistory only hydrates inside the MealHistory overlay's live fetch), so
//             day rows honestly show score + tier only, with a link into the real Meal
//             History overlay for the photo trail.
//   Streak  : streakInfo(s.scoreHistory, d.athleteScore, {seedPad,grace,today}) — the exact
//             call Home makes — plus longestStreak / daysOnStandard from core. The proto's
//             hard-coded Sun–Fri strip becomes a real calendar walk (showcase falls back to
//             the same weeklyCompliance series the trend chart draws).
//   Trust   : passStatus(s.trustPass, s.dateStamp) + passEligibility + the real trailing-10
//             median (trailingEarnedNutritionMedian over s.nutritionHistory). Flag-off / no
//             pass reads an honest "not active / not earned" state — never a fake pass.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import {
  COMPLIANCE_THRESHOLD,
  GRACE_WINDOW,
  daysOnStandard,
  longestStreak,
  passEligibility,
  passStatus,
  shiftStamp,
  streakInfo,
  tierFor,
  trailingEarnedNutritionMedian,
  weeklyCompliance,
  type DayScore,
  type MealKey,
} from '@/core';
import { useStore, useDerived } from '@/store';
import { isStreakGraceEnabled, isTrustPassEnabled } from '@/lib/features';
import { MAX_FONT_SCALE, shadow, tierChip, typeScale } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, PressScale, Pressable, Reveal, Row, Txt } from '@/ui/primitives';
import { Icon, type IconName } from '@/icons';

/* ============================================================================
   Shared pieces (proto backHead / eyebrow / .lrow / .btn.ghost / .state-demo).
   ============================================================================ */

/** Proto `backHead(title, sub)`: round back chip + title + subtitle. Back → Home. */
function BackHead({ title, sub }: { title: string; sub: string }) {
  const c = useColors();
  const s = useStore();
  return (
    <Row style={{ gap: 14, paddingTop: 6, paddingBottom: 14 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Home"
        hitSlop={6}
        onPress={s.goHome}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 999,
          backgroundColor: c.card,
          borderWidth: 1,
          borderColor: c.hairline,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="chevronLeft" size={20} color={c.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Txt w="eb" size={20} ls={-0.4} accessibilityRole="header">
          {title}
        </Txt>
        <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 1 }}>
          {sub}
        </Txt>
      </View>
    </Row>
  );
}

/** Proto `.eyebrow` — tracked, muted section label. */
function Eyebrow({ children, style }: { children: React.ReactNode; style?: object }) {
  const c = useColors();
  return (
    <Txt w="eb" size={11} color={c.textTertiary} ls={1.3} upper style={[{ marginTop: 22, marginBottom: 10, marginHorizontal: 2 }, style]}>
      {children}
    </Txt>
  );
}

/** Proto `.lrow` — icon tile + title + sub, non-tappable rule/explainer row. */
function LRow({ icon, tileBg, tileFg, title, sub, last }: { icon: IconName; tileBg: string; tileFg: string; title: string; sub: string; last?: boolean }) {
  const c = useColors();
  return (
    <View>
      <Row style={{ gap: 13, paddingVertical: 13, alignItems: 'flex-start' }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: tileBg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={17} color={tileFg} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={14} ls={-0.2}>{title}</Txt>
          <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>{sub}</Txt>
        </View>
      </Row>
      {!last ? <View style={{ height: 1, backgroundColor: c.hairline, marginLeft: 51 }} /> : null}
    </View>
  );
}

/** Proto `.btn.ghost` — bordered quiet button (Back Home). */
function GhostBtn({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 54,
        borderRadius: 16,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.hairline,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Txt w="b" size={15} maxFontSizeMultiplier={MAX_FONT_SCALE}>{label}</Txt>
    </Pressable>
  );
}

/** Proto `.state-demo` — centered honest empty state. */
function EmptyState({ icon, title, sub }: { icon: IconName; title: string; sub: string }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', paddingTop: 46, paddingHorizontal: 24 }}>
      <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={26} color={c.textTertiary} />
      </View>
      <Txt w="eb" size={17} ls={-0.3} style={{ marginTop: 16, textAlign: 'center' }}>
        {title}
      </Txt>
      <Txt w="m" size={13.5} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
        {sub}
      </Txt>
    </View>
  );
}

/** Detail-screen scroll shell (same insets/padding as ScoreBreakdown). */
function Shell({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + 10, paddingHorizontal: 20, paddingBottom: 130 }}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse a YYYY-MM-DD stamp into a local Date (null on a dateless legacy entry). */
function parseStamp(stamp: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp ?? '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "Thursday · Jul 3" (proto history day header), or a safe fallback for legacy entries. */
function dayLabel(stamp: string): string {
  const d = parseStamp(stamp);
  if (!d) return 'Earlier';
  return `${DAY_NAMES[d.getDay()]} · ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/* ============================================================================
   HISTORY — 30-day daily breakdown (proto trust.js `history`).
   ============================================================================ */

const HISTORY_WINDOW = 30;
const MAIN_MEALS: MealKey[] = ['breakfast', 'lunch', 'dinner'];

export function History() {
  const c = useColors();
  const s = useStore();
  const d = useDerived();

  const todayTier = tierFor(d.athleteScore);
  const todayChip = tierChip[todayTier.short];
  const mealsLogged = MAIN_MEALS.filter((k) => s.meals[k]).length;
  const todayName = (() => {
    const dt = parseStamp(s.dateStamp);
    return dt ? DAY_NAMES[dt.getDay()] : 'Today';
  })();

  // Real persisted days, newest first, excluding today's (in-progress) anchor entry.
  const past: DayScore[] = (s.scoreHistory ?? [])
    .filter((h) => h.date !== s.dateStamp)
    .slice(-HISTORY_WINDOW)
    .reverse();

  return (
    <Shell>
      <BackHead title="History" sub={`Your record, day by day · last ${HISTORY_WINDOW} days`} />

      {/* Today — live score, honest "in progress" framing. */}
      <Reveal index={0}>
        <Card variant="low" style={{ borderRadius: 20, padding: 16 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={12} color={c.textTertiary} ls={0.8} upper>
                Today · {todayName}
              </Txt>
              <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 5, lineHeight: 17 }}>
                {mealsLogged} of {MAIN_MEALS.length} meals logged · finishes at midnight
              </Txt>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Txt w="eb" num size={22} ls={-0.6} color={todayChip.fg} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {d.athleteScore}
              </Txt>
              <View style={{ marginTop: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: todayChip.bg, borderWidth: 1, borderColor: todayChip.border }}>
                <Txt w="eb" size={10} color={todayChip.fg} ls={0.8} upper maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {todayTier.name}
                </Txt>
              </View>
            </View>
          </Row>
        </Card>
      </Reveal>

      {/* Past days — score + tier per real recorded day (no fake meal thumbnails: the RN
          store has no cheap per-day meal source here; photos live in Meal History). */}
      {past.length > 0 ? (
        <Reveal index={1}>
          <Eyebrow>Completed days</Eyebrow>
          <Card variant="low" style={{ borderRadius: 20, paddingVertical: 4, paddingHorizontal: 16 }}>
            {past.map((h, i) => {
              const tier = tierFor(h.score);
              const chip = tierChip[tier.short];
              return (
                <View key={h.date || `legacy-${i}`}>
                  {i > 0 ? <View style={{ height: 1, backgroundColor: c.hairline }} /> : null}
                  <Row style={{ justifyContent: 'space-between', paddingVertical: 13 }}>
                    <View style={{ flex: 1 }}>
                      <Txt w="eb" size={14} ls={-0.2}>{dayLabel(h.date)}</Txt>
                      <Txt w="sb" size={11.5} color={h.score >= COMPLIANCE_THRESHOLD ? c.success : c.warning} style={{ marginTop: 2 }}>
                        {h.score >= COMPLIANCE_THRESHOLD ? 'On standard' : 'Below the bar'}
                      </Txt>
                    </View>
                    <Row style={{ gap: 9 }}>
                      <Txt w="eb" num size={17} ls={-0.4} color={chip.fg} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {h.score}
                      </Txt>
                      <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border }}>
                        <Txt w="eb" size={10} color={chip.fg} ls={0.8} upper maxFontSizeMultiplier={MAX_FONT_SCALE}>
                          {tier.name}
                        </Txt>
                      </View>
                    </Row>
                  </Row>
                </View>
              );
            })}
          </Card>
        </Reveal>
      ) : (
        <Reveal index={1}>
          <EmptyState
            icon="flame"
            title="Your record builds as you log"
            sub="Every completed day lands here with its score and tier. Finish today and it becomes the first entry."
          />
        </Reveal>
      )}

      {/* The proof trail — the real photo history lives in the Meal History overlay. */}
      <Reveal index={2}>
        <Eyebrow>The proof trail</Eyebrow>
        <PressScale
          accessibilityLabel="Open Meal History"
          onPress={s.openMealHistory}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={19} color={c.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={14}>Meal photos</Txt>
            <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 2 }}>
              The photo proof behind each day, meal by meal
            </Txt>
          </View>
          <Icon name="chevronRight" size={18} color={c.textTertiary} />
        </PressScale>
      </Reveal>

      <View style={{ height: 18 }} />
      <GhostBtn label="Back Home" onPress={s.goHome} />
    </Shell>
  );
}

/* ============================================================================
   STREAK — the honest streak, grace visible (proto trust.js `streak`).
   ============================================================================ */

interface WeekCell {
  label: string;
  score: number | null;
  on: boolean;
  today: boolean;
}

/** The last 7 calendar days ending today. Real athletes walk real dates (an absent day
 *  reads as a miss); the seeded showcase reuses the same weeklyCompliance series the
 *  trend chart draws, so the strip never disagrees with the chart. */
function buildWeek(history: DayScore[], liveScore: number, isReal: boolean, todayIso: string): WeekCell[] {
  if (!isReal) {
    return weeklyCompliance(history, liveScore).days.map((day) => ({
      label: day.label,
      score: day.score,
      on: day.today ? day.score >= COMPLIANCE_THRESHOLD : day.ok,
      today: day.today,
    }));
  }
  const byDate = new Map<string, number>();
  for (const h of history) if (typeof h.score === 'number' && Number.isFinite(h.score)) byDate.set(h.date, h.score);
  const out: WeekCell[] = [];
  for (let back = 6; back >= 0; back--) {
    const stamp = back === 0 ? todayIso : shiftStamp(todayIso, -back);
    const dt = parseStamp(stamp);
    const score = back === 0 ? liveScore : byDate.get(stamp) ?? null;
    out.push({
      label: dt ? DAY_SHORT[dt.getDay()] : '—',
      score,
      on: score != null && score >= COMPLIANCE_THRESHOLD,
      today: back === 0,
    });
  }
  return out;
}

export function Streak() {
  const c = useColors();
  const s = useStore();
  const d = useDerived();
  const isReal = s.athleteName.trim().length > 0;

  // The exact streak call Home makes — one source of truth for the number.
  const streak = streakInfo(s.scoreHistory, d.athleteScore, {
    seedPad: !isReal,
    grace: isStreakGraceEnabled,
    today: isReal ? s.dateStamp : undefined,
  });

  const week = buildWeek(s.scoreHistory ?? [], d.athleteScore, isReal, s.dateStamp);
  const completed = (s.scoreHistory ?? []).filter((h) => h.date !== s.dateStamp);
  const best = Math.max(longestStreak(completed), streak.days);
  const onStd = daysOnStandard(completed);
  const consistency = completed.length > 0 ? Math.round((onStd / completed.length) * 100) : null;

  const subtitle = streak.atRisk
    ? 'At risk — today is below the bar'
    : `${streak.days} day${streak.days === 1 ? '' : 's'} on standard${isStreakGraceEnabled ? (streak.graceUsed ? ' · grace used' : ' · grace intact') : ''}`;

  return (
    <Shell>
      <BackHead title="Streak" sub={subtitle} />

      {/* Hero — flame + the big number (proto's centered card). */}
      <Reveal index={0}>
        <Card variant="hero" style={{ borderRadius: 24, paddingVertical: 26, alignItems: 'center' }}>
          <Row style={{ gap: 10 }}>
            <Icon name="flame" size={26} color={streak.atRisk ? c.textTertiary : c.warning} />
            <Txt w="eb" num size={typeScale.display.size + 4} ls={-2} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ lineHeight: (typeScale.display.size + 4) * 1.02 }}>
              {streak.days}
            </Txt>
          </Row>
          <Txt w="b" size={13} color={c.textSecondary} style={{ marginTop: 4 }}>
            days at {COMPLIANCE_THRESHOLD} or better
          </Txt>
          {streak.atRisk ? (
            <Txt w="sb" size={12.5} color={c.warning} style={{ marginTop: 10, textAlign: 'center', paddingHorizontal: 12, lineHeight: 18 }}>
              Today is below {COMPLIANCE_THRESHOLD}. Finish tonight’s requirements or this ends honestly.
            </Txt>
          ) : (
            <Txt w="sb" size={12.5} color={c.success} style={{ marginTop: 10, textAlign: 'center', paddingHorizontal: 12, lineHeight: 18 }}>
              Today is above the bar. Day {streak.days + 1} locks at midnight.
            </Txt>
          )}
        </Card>
      </Reveal>

      {/* This week — real calendar days; a blank cell is an honest absence. */}
      <Reveal index={1}>
        <Eyebrow>This week</Eyebrow>
        <Card variant="low" style={{ borderRadius: 20, padding: 16 }}>
          <Row style={{ gap: 8 }}>
            {week.map((x, i) => (
              <View key={`${x.label}-${i}`} style={{ flex: 1, alignItems: 'center' }}>
                <View
                  style={[
                    {
                      alignSelf: 'stretch',
                      height: 52,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1,
                      backgroundColor: x.score == null ? c.surface2 : x.on ? c.successSurface : c.warnTint,
                      borderColor: x.score == null ? c.hairline : x.on ? c.successBorderSoft : c.warning + '55',
                    },
                    x.today && x.on ? shadow.low : null,
                  ]}
                >
                  <Txt w="eb" num size={14} color={x.score == null ? c.textTertiary : x.on ? c.success : c.warning} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {x.score == null ? '—' : x.score}
                  </Txt>
                </View>
                <Txt w="b" size={10.5} color={c.textTertiary} style={{ marginTop: 6 }}>
                  {x.label}{x.today ? ' · now' : ''}
                </Txt>
              </View>
            ))}
          </Row>
          <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 14, lineHeight: 18 }}>
            {isReal
              ? 'Green days cleared the bar. A dash is a day with no record — absence counts as a miss.'
              : 'Sample week shown until your own days accrue. Your real record replaces this as you log.'}
          </Txt>
        </Card>
      </Reveal>

      {/* The record — best streak + consistency from real retained history. */}
      <Reveal index={2}>
        <Eyebrow>Your record</Eyebrow>
        <Row style={{ gap: 12 }}>
          <Card variant="low" style={{ flex: 1, borderRadius: 18, padding: 15 }}>
            <Txt w="eb" size={10.5} color={c.textTertiary} ls={0.8} upper>Best streak</Txt>
            <Txt w="eb" num size={24} ls={-0.7} style={{ marginTop: 5 }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {best}
            </Txt>
            <Txt w="sb" size={11.5} color={c.textSecondary} style={{ marginTop: 2 }}>
              day{best === 1 ? '' : 's'} · personal best
            </Txt>
          </Card>
          <Card variant="low" style={{ flex: 1, borderRadius: 18, padding: 15 }}>
            <Txt w="eb" size={10.5} color={c.textTertiary} ls={0.8} upper>Consistency</Txt>
            <Txt w="eb" num size={24} ls={-0.7} color={consistency != null && consistency >= 80 ? c.success : c.text} style={{ marginTop: 5 }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {consistency != null ? `${consistency}%` : '—'}
            </Txt>
            <Txt w="sb" size={11.5} color={c.textSecondary} style={{ marginTop: 2 }}>
              {consistency != null ? `${onStd} of ${completed.length} recorded days` : 'builds as you log'}
            </Txt>
          </Card>
        </Row>
      </Reveal>

      {/* The rules — honest mechanics, grace shown only when it's actually on. */}
      <Reveal index={3}>
        <Eyebrow>The rules</Eyebrow>
        <Card variant="low" style={{ borderRadius: 20, paddingVertical: 4, paddingHorizontal: 16 }}>
          <LRow
            icon="bolt"
            tileBg={c.successSurface}
            tileFg={c.success}
            title={`${COMPLIANCE_THRESHOLD} is the bar`}
            sub={`On standard means ${COMPLIANCE_THRESHOLD}+. Not close, not almost.`}
          />
          <LRow
            icon="shield"
            tileBg={c.accentSurface}
            tileFg={c.accentLight}
            title={isStreakGraceEnabled ? `One grace per ${GRACE_WINDOW} days` : 'No grace days'}
            sub={
              isStreakGraceEnabled
                ? streak.graceUsed
                  ? 'One rough day inside a week is forgiven, bridged, never counted. Yours is used — it frees up as the window rolls.'
                  : 'One rough day inside a week is forgiven, bridged, never counted. Yours is unused.'
                : 'The first miss ends the streak. It restarts the next on-standard day.'
            }
          />
          <LRow
            icon="plan"
            tileBg={c.warnTint}
            tileFg={c.warning}
            title="Absent days count as misses"
            sub="Not opening the app isn’t a loophole. The calendar is the judge."
            last
          />
        </Card>
      </Reveal>

      <View style={{ height: 18 }} />
      <GhostBtn label="Back Home" onPress={s.goHome} />
    </Shell>
  );
}

/* ============================================================================
   TRUST PASS DETAIL — the earned camera-free reward, rules visible
   (proto trust.js `trust`).
   ============================================================================ */

// Mirrors src/core/trustPass.ts (CHECK_EVERY / DECAY_START_DAY / DECAY_PER_DAY are
// module-private there; these render the SAME curve passStatus scores with).
const SPOT_CHECK_EVERY = 5;
const DECAY_START_DAY = 10;
const DECAY_PER_DAY = 0.05;
const PASS_MIN_DAYS = 7;

export function TrustDetail() {
  const c = useColors();
  const s = useStore();
  const isReal = s.athleteName.trim().length > 0;

  const tp = isTrustPassEnabled ? passStatus(s.trustPass, s.dateStamp) : null;
  const pass = s.trustPass;

  // ---- Not running / not earned / expired: the honest inactive states ----
  if (!isTrustPassEnabled) {
    return (
      <Shell>
        <BackHead title="Trust Pass" sub="Not active" />
        <EmptyState
          icon="shield"
          title="Trust Pass isn’t on for your team yet"
          sub="When your coach turns it on, consistent photo-proven days can earn you camera-free days — credited from your own real history, never invented."
        />
        <View style={{ height: 26 }} />
        <GhostBtn label="Back Home" onPress={s.goHome} />
      </Shell>
    );
  }

  if (!pass || !tp || tp.phase !== 'active') {
    const elig = passEligibility(s.scoreHistory ?? []);
    const pct = Math.min(100, Math.round((elig.onStandardDays / PASS_MIN_DAYS) * 100));
    return (
      <Shell>
        <BackHead title="Trust Pass" sub={tp?.phase === 'expired' ? 'Your last pass ended' : 'Not earned yet'} />
        <EmptyState
          icon="shield"
          title={`Earn it with ${PASS_MIN_DAYS} on-standard days`}
          sub="Show the pattern with photos first. Then your coach can grant camera-free days credited from your real history."
        />
        <Reveal index={1}>
          <Card variant="low" style={{ borderRadius: 20, padding: 16, marginTop: 26 }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <Txt w="eb" size={12} color={c.textSecondary} ls={0.8} upper>Your progress</Txt>
              <Txt w="eb" num size={12} color={elig.eligible ? c.success : c.textSecondary}>
                {Math.min(elig.onStandardDays, PASS_MIN_DAYS)} of {PASS_MIN_DAYS} days
              </Txt>
            </Row>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surface3, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', borderRadius: 4, backgroundColor: elig.eligible ? c.success : c.purple }} />
            </View>
            <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 10, lineHeight: 17 }}>
              {elig.eligible
                ? 'You’ve shown the pattern. Granting a pass is your coach’s call — ask about it.'
                : `Every day at ${COMPLIANCE_THRESHOLD}+ with photo proof counts toward it.`}
            </Txt>
          </Card>
        </Reveal>
        <View style={{ height: 18 }} />
        <GhostBtn label="Back Home" onPress={s.goHome} />
      </Shell>
    );
  }

  // ---- Active pass ----
  const day = tp.dayIndex + 1; // human day number
  const len = pass.lengthDays;
  const median = trailingEarnedNutritionMedian(s.nutritionHistory ?? []);
  const nextCheckRaw = (Math.floor(tp.dayIndex / SPOT_CHECK_EVERY) + 1) * SPOT_CHECK_EVERY;
  const nextCheck = nextCheckRaw < len ? nextCheckRaw + 1 : null; // day number of the next spot-check
  const grantedBy = isReal ? 'your coach' : 'Coach Davis';

  // Decay curve geometry — same math as core: full credit through DECAY_START_DAY, then
  // DECAY_PER_DAY off per camera-free day. Drawn across the real pass length.
  const span = Math.max(1, len - 1);
  const pts = Array.from({ length: len }, (_, i) => {
    const dd = i + 1;
    const pct = dd <= DECAY_START_DAY ? 1 : Math.max(0, 1 - (dd - DECAY_START_DAY) * DECAY_PER_DAY);
    return [16 + (i / span) * 268, 74 - pct * 54] as const;
  });
  const curvePath = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const youX = 16 + (tp.dayIndex / span) * 268;

  return (
    <Shell>
      <BackHead title="Trust Pass" sub={`Day ${day} of ${len} · camera-free, honestly`} />

      {/* Active card — purple-bordered, shield, day grid (proto section.card.pad). */}
      <Reveal index={0}>
        <View style={[{ borderRadius: 22, padding: 18, backgroundColor: c.card, borderWidth: 1, borderColor: c.purple + '55' }, shadow.card]}>
          <Row style={{ gap: 14 }}>
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: c.purple + '22', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shield" size={26} color={c.purple} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={17} ls={-0.3}>Active · earned, not given</Txt>
              <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
                Granted by {grantedBy} after {PASS_MIN_DAYS} on-standard days with photo proof.
              </Txt>
            </View>
          </Row>

          {/* pass-days grid: done through today, spot-check cells marked. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
            {Array.from({ length: len }, (_, i) => {
              const dd = i + 1;
              const isCheck = dd % SPOT_CHECK_EVERY === 0 && dd < len;
              const done = dd <= day;
              return (
                <View
                  key={dd}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: done ? c.purple + '2E' : isCheck ? c.warnTint : c.surface2,
                    borderWidth: 1,
                    borderColor: done ? c.purple + '66' : isCheck ? c.warning + '55' : c.hairline,
                  }}
                >
                  <Txt w="eb" num size={12} color={done ? c.purple : isCheck ? c.warning : c.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {dd}
                  </Txt>
                </View>
              );
            })}
          </View>
          <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <Txt w="b" size={10.5} color={c.textTertiary} ls={0.5} upper>Day {day} · credited</Txt>
            <Txt w="b" size={10.5} color={c.warning} ls={0.5} upper>Every {SPOT_CHECK_EVERY}th day · camera check</Txt>
          </Row>
        </View>
      </Reveal>

      {/* Spot-check today — the camera comes back (honest banner, real flag). */}
      {tp.isCheckDay ? (
        <Reveal index={1}>
          <Row style={{ gap: 13, marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: c.warnTint, borderWidth: 1, borderColor: c.warning + '55' }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.warning + '22', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="camera" size={19} color={c.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={14}>Spot-check today</Txt>
              <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>
                The camera comes back for today — log your meals with photos to keep the pass.
              </Txt>
            </View>
          </Row>
        </Reveal>
      ) : null}

      {/* How today gets credited — the three real mechanics. */}
      <Reveal index={2}>
        <Eyebrow>How today gets credited</Eyebrow>
        <Card variant="low" style={{ borderRadius: 20, paddingVertical: 4, paddingHorizontal: 16 }}>
          <LRow
            icon="trophy"
            tileBg={c.purple + '22'}
            tileFg={c.purple}
            title={median != null ? `Your trailing-10 median: ${median}` : 'Your trailing-10 median'}
            sub={
              median != null
                ? 'Credit comes from your last 10 real photo-earned days. One hero plate can’t inflate it.'
                : 'Credit comes from your last 10 real photo-earned days — none on record yet, so there’s nothing to credit until you log with photos.'
            }
          />
          <LRow
            icon="check"
            tileBg={c.successSurface}
            tileFg={c.success}
            title="Your answer scales it"
            sub="Yes = full credit · Partial = 60% · No = zero. Honesty is the input."
          />
          <LRow
            icon="camera"
            tileBg={c.warnTint}
            tileFg={c.warning}
            title={`Spot-check every ${SPOT_CHECK_EVERY}th day`}
            sub={
              tp.isCheckDay
                ? 'Today is a check day — the camera is back.'
                : nextCheck != null
                  ? `On check days the camera comes back. Next check: day ${nextCheck}.`
                  : 'No spot-checks left in this pass.'
            }
            last
          />
        </Card>
      </Reveal>

      {/* Decay curve — credit bleeds after day 10 (same math passStatus applies). */}
      <Reveal index={3}>
        <Eyebrow>Credit decays if it goes stale</Eyebrow>
        <Card variant="low" style={{ borderRadius: 20, padding: 16 }}>
          <Svg width="100%" height={92} viewBox="0 0 300 84">
            <Path d={curvePath} fill="none" stroke={c.purple} strokeWidth={2.5} strokeLinecap="round" />
            <Line x1={youX} y1={14} x2={youX} y2={76} stroke={c.purple + '66'} strokeWidth={1.5} strokeDasharray="3 3" />
            <SvgText x={youX} y={10} fill={c.purple} fontSize={9} fontWeight="800" textAnchor={youX > 250 ? 'end' : youX < 40 ? 'start' : 'middle'}>
              {`YOU · DAY ${day}`}
            </SvgText>
            <SvgText x={16} y={83} fill={c.textTertiary} fontSize={8.5} fontWeight="700">
              DAY 1
            </SvgText>
            <SvgText x={284} y={83} fill={c.textTertiary} fontSize={8.5} fontWeight="700" textAnchor="end">
              {`DAY ${len}`}
            </SvgText>
          </Svg>
          <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 18 }}>
            {tp.decayPct < 1
              ? `Credit is at ${Math.round(tp.decayPct * 100)}% today — it bleeds about ${Math.round(DECAY_PER_DAY * 100)}% a day past day ${DECAY_START_DAY}. Fresh photos reset the baseline.`
              : `Full credit through day ${DECAY_START_DAY}, then it bleeds about ${Math.round(DECAY_PER_DAY * 100)}% a day. Fresh photos reset the baseline.`}
          </Txt>
        </Card>
      </Reveal>

      {/* Coach note — showcase flavor only; a real athlete has no stored coach quote. */}
      {!isReal ? (
        <Reveal index={4}>
          <View style={{ marginTop: 22, padding: 16, borderRadius: 20, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
            <Row style={{ gap: 11, marginBottom: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.warning, alignItems: 'center', justifyContent: 'center' }}>
                <Txt w="eb" size={13} color={c.onGreen}>CD</Txt>
              </View>
              <View>
                <Txt w="eb" size={13.5}>Coach Davis</Txt>
                <Txt w="sb" size={11.5} color={c.textTertiary}>On granting it</Txt>
              </View>
            </Row>
            <Txt w="m" size={13.5} color={c.textSecondary} style={{ lineHeight: 20 }}>
              “You showed me the pattern. I don’t need a photo of every plate to know who you are. Don’t make me take it back.”
            </Txt>
          </View>
        </Reveal>
      ) : null}

      <View style={{ height: 18 }} />
      <GhostBtn label="Back Home" onPress={s.goHome} />
    </Shell>
  );
}
