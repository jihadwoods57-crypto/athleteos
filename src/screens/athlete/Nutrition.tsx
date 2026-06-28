// AthleteOS — Nutrition. Time-aware coach-set goal, macro rings, protein gap
// quick-adds (add real grams), today's meal log.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { mealRowsFor, QUICK_FOODS, paceProjection, weekdayLong, weeklyWeightProgress, WEIGHT_START } from '@/core';
import { isEnginesEnabled } from '@/lib/features';
import { useStore, useDerived } from '@/store';
import { colors, MAX_FONT_SCALE, shadow } from '@/ui/tokens';
import { Card, ProgressBar, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';

export function Nutrition() {
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = useDerived();
  // A real athlete's weekly weight progress comes from their actual recorded
  // weight (so a brand-new athlete reads 0.0, matching Home's "0 gained"); the
  // seeded demo keeps the showcase via paceProjection's default.
  const isReal = s.athleteName.trim().length > 0;
  const weeklyProgress = isReal
    ? weeklyWeightProgress(s.weightHistory, s.currentWeight, s.startWeight ?? WEIGHT_START)
    : undefined;
  const pace = paceProjection(s.weeklyGoalLb, weeklyProgress);
  const calPct = Math.round((d.kcalToday / d.calTarget) * 100);
  const rows = mealRowsFor(s);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      <Txt w="sb" size={14} color={colors.textSecondary}>
        {weekdayLong()} · in-season
      </Txt>
      <Txt w="eb" size={28} ls={-0.8} style={{ marginTop: 1 }}>
        Nutrition
      </Txt>

      {/* Restaurant Coach entry — "what should I eat?" before you order.
          Gated by the engines master switch (OFF for the prove-the-loop beta). */}
      {isEnginesEnabled ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restaurant Coach: what should I eat"
          onPress={s.openFoodCoach}
          style={[{ marginTop: 16, borderRadius: 20, padding: 16, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', gap: 13 }, shadow.cta]}
        >
          <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={15} color="#fff">
              What should I eat?
            </Txt>
            <Txt w="m" size={13} color="rgba(255,255,255,0.85)" style={{ marginTop: 1 }}>
              Tell the coach where you are — get the best order for your goal
            </Txt>
          </View>
          <Icon name="chevronRight" size={22} color="rgba(255,255,255,0.7)" />
        </Pressable>
      ) : null}

      {/* weekly goal (coach-set) */}
      <Card elevated style={{ marginTop: 18, borderRadius: 24 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="eb" size={12} color={colors.textTertiary} ls={0.7}>
            THIS WEEK'S GOAL
          </Txt>
          <Row style={{ gap: 6, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, backgroundColor: '#FEF3C7' }}>
            <Icon name="checkin" size={12} color={colors.warningDeep} />
            <Txt w="eb" size={12} color={colors.warningDeep}>
              {pace.daysLeft} days left
            </Txt>
          </Row>
        </Row>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
          <View>
            <Txt w="eb" size={29} ls={-0.9}>
              Gain {s.weeklyGoalLb.toFixed(1)} lb
            </Txt>
            <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 3 }}>
              by Sunday · ≈{pace.surplus} cal/day surplus
            </Txt>
          </View>
          <Row style={{ gap: 7, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.bg2 }}>
            <Icon name="shield" size={13} color={colors.textSecondary} />
            <Txt w="b" size={12} color={colors.textSecondary}>
              Coach-set
            </Txt>
          </Row>
        </Row>
        <View style={{ marginTop: 16 }}>
          <ProgressBar pct={pace.goalPct} height={10} />
        </View>
        <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <Txt w="b" size={13} color={colors.slate700}>
            {pace.progressLb >= 0 ? '+' : ''}{pace.progressLb.toFixed(1)} lb so far
          </Txt>
          <Txt w="eb" size={13} color={pace.onPace ? colors.successDeep : colors.warningDeep}>
            {pace.paceLabel}
          </Txt>
        </Row>
        <View style={{ marginTop: 14, borderRadius: 14, padding: 13, backgroundColor: colors.accentSurface }}>
          <Txt w="m" size={13} color={colors.slate700} style={{ lineHeight: 19 }}>
            <Txt w="b" size={13} color={colors.accent}>
              Pace ·{' '}
            </Txt>
            {pace.paceAi}
          </Txt>
        </View>
      </Card>

      {/* macros */}
      <Card elevated style={{ marginTop: 14, borderRadius: 24 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
          <Txt w="eb" size={16} ls={-0.3}>
            Macros
          </Txt>
          <Txt w="b" size={14}>
            {d.kcalToday.toLocaleString()} <Txt w="b" size={14} color={colors.textSecondary}>/ {d.calTarget.toLocaleString()} cal</Txt>
          </Txt>
        </Row>
        <View style={{ marginBottom: 22 }}>
          <ProgressBar pct={calPct} height={8} />
        </View>
        <Row style={{ justifyContent: 'space-around' }}>
          <MacroRing label="Protein" value={d.proteinToday} target={`/${d.proteinTarget}g`} pct={d.proteinPct} color={colors.accent} />
          <MacroRing label="Carbs" value={d.carbsToday} target={`/${d.carbTarget}g`} pct={d.carbPct} color={colors.hydration} />
          <MacroRing label="Fat" value={d.fatToday} target={`/${d.fatTarget}g`} pct={d.fatPct} color="#8B5CF6" />
        </Row>
      </Card>

      {/* protein gap quick-adds */}
      <Card elevated style={{ marginTop: 14, borderRadius: 24 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="eb" size={16} ls={-0.3}>
            Protein gap
          </Txt>
          <Txt w="eb" size={15} color={colors.accent}>
            {d.proteinGap}g to go
          </Txt>
        </Row>
        <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 6 }}>
          Quick wins to max today's nutrition score before dinner.
        </Txt>
        <View style={{ gap: 9, marginTop: 14 }}>
          {QUICK_FOODS.map((f, i) => {
            const added = s.quickAdded[i];
            return (
              <Pressable
                key={f.n}
                onPress={() => s.toggleQuick(i)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 15,
                  paddingVertical: 13,
                  borderRadius: 14,
                  backgroundColor: added ? '#ECFDF5' : colors.bg,
                  borderWidth: 1.5,
                  borderColor: added ? '#A7F3D0' : 'transparent',
                }}
              >
                <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: added ? colors.success : colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                  {added ? <Icon name="check" size={13} color="#fff" /> : <Icon name="plus" size={16} color={colors.accent} />}
                </View>
                <Txt w="b" size={14} style={{ flex: 1 }}>
                  {f.n}
                </Txt>
                <Txt w="eb" size={14} color={added ? colors.successDeep : colors.accent}>
                  +{f.g}g
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* today's meals */}
      <Card elevated style={{ marginTop: 14, borderRadius: 24 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="eb" size={16} ls={-0.3}>
              Today's Meals
            </Txt>
            <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 2 }}>
              {d.mealsLoggedCount} of 4 logged
            </Txt>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View meal history"
            onPress={s.openMealHistory}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Txt w="b" size={13} color={colors.accent}>
              History
            </Txt>
            <Icon name="chevronRight" size={15} color={colors.accent} />
          </Pressable>
        </Row>
        <View style={{ gap: 12 }}>
          {rows.map((row) =>
            row.logged ? (
              <Pressable key={row.key} onPress={() => s.openMealDetail(row.detailId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
                <View style={{ width: 48, height: 48, borderRadius: 13, backgroundColor: row.thumb }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt w="b" size={14}>
                    {row.name}
                  </Txt>
                  <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 2 }}>
                    {row.protein}g protein · {row.kcal} cal
                  </Txt>
                </View>
                <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: row.quality >= 90 ? colors.successSurface : colors.accentSurface }}>
                  <Txt w="eb" size={12} color={row.quality >= 90 ? colors.successDeep : colors.accent}>
                    {row.quality}
                  </Txt>
                </View>
                <Icon name="chevronRight" size={18} color="#CBD5E1" />
              </Pressable>
            ) : (
              <Pressable
                key={row.key}
                onPress={() => {
                  s.setMealType(row.label);
                  s.openMeal();
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}
              >
                <View style={{ width: 48, height: 48, borderRadius: 13, borderWidth: 2, borderStyle: 'dashed', borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="camera" size={20} color={colors.textTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt w="b" size={14} color={colors.slate700}>
                    {row.label}
                  </Txt>
                  <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 2 }}>
                    {row.dueTime}
                  </Txt>
                </View>
                <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 11, backgroundColor: colors.accent }}>
                  <Txt w="b" size={13} color="#fff">
                    Log now
                  </Txt>
                </View>
              </Pressable>
            ),
          )}
        </View>
      </Card>
    </ScrollView>
  );
}

function MacroRing({ label, value, target, pct, color }: { label: string; value: number; target: string; pct: number; color: string }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <View style={{ alignItems: 'center', gap: 9 }}>
      <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={84} height={84} viewBox="0 0 100 100" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={50} cy={50} r={r} fill="none" stroke="#EFF2F6" strokeWidth={9} />
          <Circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
        </Svg>
        <Txt w="eb" size={17} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {value}
        </Txt>
        <Txt w="b" size={9} color={colors.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {target}
        </Txt>
      </View>
      <Txt w="b" size={12} color={colors.slate700}>
        {label}
      </Txt>
    </View>
  );
}
