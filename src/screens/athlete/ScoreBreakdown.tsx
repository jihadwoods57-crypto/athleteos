// OnStandard — Score Breakdown (redesign 2026-07, faithful port of proto breakdown.js).
// Top → bottom: back header · smaller score ring (210, no glow) · the four-component
// breakdown card (Nutrition 50 / Recovery 25 / Daily commitment 15 / Weekly check-in 10,
// each with earned/possible + accent bar + honest note) · "Not in today's score" weight
// sidebox · reach plan (remaining actions + per-action gains) or the day-done state.
//
// Every number reads off the SAME engine the ring uses: computeDerived (sub-scores) and
// projectedScore (remaining actions + reachable score). Earned per component mirrors the
// athleteScore formula exactly — including recovery contributing 0 until a real check-in
// backs it (never the 86 display fallback, never a fabricated 92). Per-action gains are
// marginal deltas computed BY computeDerived over a single-action-completed state (the
// same idealization rules projection.ts uses), so no "+N pts" is ever invented.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  computeDerived,
  projectedScore,
  tierFor,
  todayStamp,
  SCORE_WEIGHTS,
  type AppState,
  type EditableFood,
  type MealKey,
  type ProjectedAction,
} from '@/core';
import { useStore, useDerived } from '@/store';
import { useColors } from '@/ui/theme';
import { Card, PressScale, ProgressBar, Pressable, Reveal, Row, Txt } from '@/ui/primitives';
import { Ring } from '@/ui/Ring';
import { tierChip, ringGradient, shadow, typeScale, MAX_FONT_SCALE } from '@/ui/tokens';
import { Icon, IconName } from '@/icons';

/** Proto accent classes used on this screen: g green · b blue · p purple. */
type Accent = 'g' | 'b' | 'p';

interface BreakdownRowData {
  key: string;
  name: string;
  weightPct: number;
  earned: number;
  possible: number;
  accent: Accent;
  note: string;
}

interface ReachStep {
  key: string;
  label: string;
  /** Marginal score gain for completing just this action now (computed, never invented). */
  gain: number;
  icon: IconName;
  accent: Accent;
  go: 'meal' | 'plan' | 'checkin';
}

export function ScoreBreakdown() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = useDerived();

  const tier = tierFor(d.athleteScore);
  const projection = projectedScore(s);
  const rows = buildBreakdown(s, d);
  const steps = React.useMemo(() => buildReachSteps(s, projection.current, projection.actions), [s, projection.current, projection.actions]);
  const first = steps.length > 0 ? steps[0] : undefined;

  const weightDone = s.weighInStamp === todayStamp();

  const accentBar: Record<Accent, string> = { g: c.success, b: c.accent, p: c.purple };
  const accentTile: Record<Accent, { bg: string; fg: string }> = {
    g: { bg: c.successSurface, fg: c.success },
    b: { bg: c.accentSurface, fg: c.accentLight },
    p: { bg: c.purple + '22', fg: c.purple },
  };
  const goAction = (go: ReachStep['go']) => (go === 'meal' ? s.openMeal : go === 'plan' ? s.goTasks : s.goCheckin);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + 10, paddingHorizontal: 20, paddingBottom: 130 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ===== 1 · Back header (proto backHead) ===== */}
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
            Score Breakdown
          </Txt>
          <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 1 }}>
            Why you have this score, and how to climb
          </Txt>
        </View>
      </Row>

      {/* ===== 2 · Hero — the smaller score ring (210, gradient band, no glow) ===== */}
      <Reveal index={0}>
        <View style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 10 }}>
          <Ring size={210} pct={d.athleteScore} stroke={14} gradient={ringGradient} track={c.track}>
            <Txt w="b" size={11} color={c.slate600} ls={1.4} upper style={{ marginBottom: 2 }}>
              OnStandard Score
            </Txt>
            <Txt
              w="eb"
              num
              size={typeScale.display.size + 8}
              ls={-2.4}
              style={{ lineHeight: (typeScale.display.size + 8) * 0.98 }}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {d.athleteScore}
            </Txt>
            <Txt w="b" size={13} color={c.textSecondary} style={{ marginTop: -2 }}>
              /100
            </Txt>
            <View
              style={{
                marginTop: 7,
                paddingHorizontal: 12,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: tierChip[tier.short].bg,
                borderWidth: 1,
                borderColor: tierChip[tier.short].border,
              }}
            >
              <Txt w="eb" size={10.5} color={tierChip[tier.short].fg} ls={1.1} upper maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {tier.name}
              </Txt>
            </View>
          </Ring>
        </View>
      </Reveal>

      {/* ===== 3 · The breakdown card (proto .bd-comp) ===== */}
      <Reveal index={1}>
        <Card variant="low" style={{ paddingTop: 4, paddingBottom: 8, paddingHorizontal: 16 }}>
          {rows.map((b, i) => (
            <View
              key={b.key}
              style={{
                paddingVertical: 14,
                paddingHorizontal: 2,
                borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                borderBottomColor: c.divider2,
              }}
            >
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Row style={{ gap: 8, flex: 1, minWidth: 0 }}>
                  <Txt w="eb" size={15} ls={-0.2} numberOfLines={1}>
                    {b.name}
                  </Txt>
                  <View style={{ backgroundColor: c.surface2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                    <Txt w="b" size={11} color={c.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {b.weightPct}% of score
                    </Txt>
                  </View>
                </Row>
                <Txt w="eb" num size={15}>
                  {b.earned}
                  <Txt w="b" num size={15} color={c.textTertiary}>
                    /{b.possible}
                  </Txt>
                </Txt>
              </Row>
              <View style={{ marginTop: 10 }}>
                <ProgressBar pct={Math.round((b.earned / Math.max(1, b.possible)) * 100)} color={accentBar[b.accent]} height={7} track={c.surface3} />
              </View>
              <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 18 }}>
                {b.note}
              </Txt>
            </View>
          ))}
        </Card>
      </Reveal>

      {/* ===== 4 · Weight — tracked separately, never in the daily score ===== */}
      <Reveal index={2}>
        <Eyebrow>Not in today’s score</Eyebrow>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
            paddingVertical: 14,
            paddingHorizontal: 16,
            borderRadius: 15,
            backgroundColor: c.surface2,
            borderWidth: 1,
            borderColor: c.divider2,
          }}
        >
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.warnTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="trophy" size={19} color={c.warningDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={13.5}>Morning Weight</Txt>
            <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
              {weightDone
                ? 'Logged today. It counts toward your season trend, never toward the daily score. '
                : 'Not logged today. It never touches the daily score. '}
              Weight tracks your{' '}
              <Txt w="b" size={12.5} color={c.textSecondary}>
                season goal
              </Txt>
              , so one busy morning never sinks a good day.
            </Txt>
          </View>
        </View>
      </Reveal>

      {/* ===== 5 · Reach plan (while the day is incomplete) or the day-done state ===== */}
      <Reveal index={3}>
        {first ? (
          <>
            <Eyebrow>How to reach {projection.projected}</Eyebrow>
            <Card variant="low" style={{ padding: 16 }}>
              {steps.map((r, i) => (
                <PressScale
                  key={r.key}
                  accessibilityLabel={r.gain > 0 ? `${r.label}, plus ${r.gain} points` : r.label}
                  onPress={goAction(r.go)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 11,
                    borderBottomWidth: i < steps.length - 1 ? 1 : 0,
                    borderBottomColor: c.divider2,
                  }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: accentTile[r.accent].bg, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={r.icon} size={18} color={accentTile[r.accent].fg} />
                  </View>
                  <Txt w="b" size={14.5} style={{ flex: 1 }} numberOfLines={2}>
                    {r.label}
                  </Txt>
                  {r.gain > 0 ? (
                    <Txt w="eb" num size={15} color={c.success}>
                      +{r.gain} pts
                    </Txt>
                  ) : null}
                </PressScale>
              ))}
              <View style={{ paddingTop: 14 }}>
                <PressScale
                  accessibilityLabel={ctaLabel(first.label)}
                  haptic="success"
                  onPress={goAction(first.go)}
                  style={[
                    {
                      height: 48,
                      borderRadius: 17,
                      backgroundColor: first.accent === 'g' ? c.success : first.accent === 'p' ? c.purple : c.accent,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 9,
                      paddingHorizontal: 18,
                    },
                    first.accent === 'g' ? shadow.ctaGreen : shadow.cta,
                  ]}
                >
                  <Icon name={first.accent === 'g' ? 'camera' : first.icon} size={19} color={first.accent === 'g' ? c.onGreen : c.white} />
                  <Txt w="eb" size={15} color={first.accent === 'g' ? c.onGreen : c.white} ls={-0.2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {ctaLabel(first.label)}
                  </Txt>
                </PressScale>
              </View>
            </Card>
          </>
        ) : (
          <>
            <Eyebrow>Day complete</Eyebrow>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 13,
                padding: 16,
                borderRadius: 22,
                backgroundColor: c.successTint,
                borderWidth: 1,
                borderColor: c.successBorderSoft,
              }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={21} color={c.successDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt w="eb" size={15.5}>Every point that was on the table is in.</Txt>
                <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 2, lineHeight: 18 }}>
                  {d.athleteScore} of {projection.projected} possible. This is what OnStandard looks like.
                </Txt>
              </View>
            </View>
          </>
        )}
      </Reveal>
      <View style={{ height: 8 }} />
    </ScrollView>
  );
}

/* ============================================================================
   Data builders — every number resolved from the real engine (no fabrication).
   ============================================================================ */

/** Weight pct for a component, read off SCORE_WEIGHTS so the labels can never
 *  drift from the engine's published mix. */
function weightPct(key: 'nutrition' | 'recovery' | 'commitment' | 'checkin'): number {
  return SCORE_WEIGHTS.find((w) => w.key === key)?.pct ?? 0;
}

/**
 * The four breakdown rows, mirroring computeDerived's athleteScore formula EXACTLY:
 * earned = round(subScore × weight). Recovery uses the same contribution rule as the
 * score (0 until a real check-in backs it — the 86 fallback is display-only and must
 * never appear here as earned points). Notes are honest about the data behind each row.
 */
function buildBreakdown(
  s: ReturnType<typeof useStore.getState>,
  d: ReturnType<typeof useDerived>,
): BreakdownRowData[] {
  // Same rule as computeDerived's recoveryContribution: unsubmitted recovery earns 0.
  const recoverySub = d.recoveryScoreIsReal ? d.recoveryScore : 0;

  const nutritionNote = d.nutritionIsTrustCredited
    ? 'Trust Pass day: credited from your proven photo baseline, never more than your camera earned'
    : d.mealsLoggedCount === 0
      ? 'No meals logged yet. Photo logging is how this part earns'
      : `${d.mealsLoggedCount} of 4 meals logged · ${Math.round(d.proteinToday)}g of ${d.proteinTarget}g protein`;

  const recoveryNote = s.ciSubmitted && d.recoveryScoreIsReal
    ? 'Self-reported from your own check-in answers'
    : d.recoveryScoreIsReal
      ? 'Carried from your check-in earlier this week · self-reported'
      : 'Check-in not submitted yet, so this part counts 0 until it’s in';

  const commitmentNote =
    s.dailyCommitment === 'yes'
      ? 'You confirmed you hit your plan today'
      : s.dailyCommitment === 'partial'
        ? 'You said you partly hit your plan today'
        : s.dailyCommitment === 'no'
          ? 'You said you missed your plan today, so this part earns 0'
          : 'Not answered yet: one tap, did you hit your plan today?';

  const checkinNote = d.checkinScore >= 100 ? 'Submitted this week' : 'Not submitted this week yet';

  const mk = (
    key: 'nutrition' | 'recovery' | 'commitment' | 'checkin',
    name: string,
    sub: number,
    accent: Accent,
    note: string,
  ): BreakdownRowData => {
    const pct = weightPct(key);
    return { key, name, weightPct: pct, earned: Math.round((sub * pct) / 100), possible: pct, accent, note };
  };

  return [
    mk('nutrition', 'Nutrition', d.nutritionScore, 'g', nutritionNote),
    mk('recovery', 'Recovery', recoverySub, 'p', recoveryNote),
    mk('commitment', 'Daily commitment', d.commitmentScore, 'b', commitmentNote),
    mk('checkin', 'Weekly check-in', d.checkinScore, 'g', checkinNote),
  ];
}

/**
 * The state after completing ONE remaining action, using the same idealization rules
 * projection.ts/idealizeDay uses (gap plate of pure protein, punctuality kept, recovery
 * an estimate from current answers). Null when the action can't be modeled alone.
 */
function actionState(s: AppState, key: string): AppState | null {
  if (key.startsWith('meal:')) {
    const k = key.slice(5) as MealKey;
    const meals = { ...s.meals };
    meals[k] = true;
    return { ...s, meals };
  }
  if (key === 'protein') {
    // Macros only count from logged slots, so closing the gap means a protein-only
    // plate in an open slot (logged), or appended to snack when every slot is in —
    // identical to idealizeDay's gap-plate rule.
    const gap = Math.max(0, Math.round(computeDerived(s).proteinGap));
    if (gap <= 0) return null;
    const plate: EditableFood[] = [{ name: 'projected', portion: '', servings: 1, per: { protein: gap, kcal: 0, carbs: 0, fat: 0 } }];
    const slots: MealKey[] = ['breakfast', 'lunch', 'snack', 'dinner'];
    const openSlot = slots.find((k) => !s.meals[k]);
    const mealFoods = { ...s.mealFoods };
    if (openSlot) {
      mealFoods[openSlot] = plate;
      const meals = { ...s.meals };
      meals[openSlot] = true;
      return { ...s, meals, mealFoods };
    }
    mealFoods.snack = [...(mealFoods.snack ?? []), ...plate];
    return { ...s, mealFoods };
  }
  if (key === 'commitment') return { ...s, dailyCommitment: 'yes' };
  if (key === 'checkin') return { ...s, ciSubmitted: true };
  return null;
}

/**
 * Reach-plan rows straight from projectedScore's actions. Each row's "+N pts" is the
 * MARGINAL gain of doing just that action from the current state, computed by
 * computeDerived (the single scoring authority) — the same semantics the proto's
 * reach plan carried. A step whose points arrive through another action (e.g. the
 * protein gap credits through the meal that carries it) simply shows no number.
 */
function buildReachSteps(s: AppState, current: number, actions: ProjectedAction[]): ReachStep[] {
  return actions.map((a) => {
    const next = actionState(s, a.key);
    const gain = next ? Math.max(0, computeDerived(next).athleteScore - current) : 0;
    const go: ReachStep['go'] =
      a.key === 'commitment' ? 'plan' : a.key === 'checkin' ? 'checkin' : 'meal';
    const icon: IconName = go === 'meal' ? 'utensils' : go === 'plan' ? 'check' : 'checkin';
    const accent: Accent = go === 'meal' ? 'g' : go === 'plan' ? 'b' : 'p';
    return { key: a.key, label: a.label, gain, icon, accent, go };
  });
}

/** CTA text: the proto's "Do X now" transform, minus any trailing parenthetical. */
function ctaLabel(label: string): string {
  const base = label.replace(/^Submit /, 'Do ').replace(/\s*\([^)]*\)\s*$/, '');
  return /\bnow$/i.test(base) ? base : `${base} now`;
}

/* ============================================================================
   Presentational pieces (proto markup → RN).
   ============================================================================ */

/** Section eyebrow (proto .eyebrow): tiny, tracked-out, uppercase, tertiary. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <Txt w="eb" size={11} color={c.textTertiary} ls={1.5} upper style={{ marginTop: 26, marginBottom: 12, marginHorizontal: 2 }}>
      {children}
    </Txt>
  );
}
