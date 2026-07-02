// OnStandard — Nutrition. Time-aware coach-set goal, macro rings, protein gap
// quick-adds (add real grams), today's meal log.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { mealRowsFor, QUICK_FOODS, SNACK_PRESETS, paceProjection, weekdayLong, weeklyWeightProgress, WEIGHT_START } from '@/core';
import { isEnginesEnabled } from '@/lib/features';
import { useStore, useDerived, useNutritionMemory } from '@/store';
import { MAX_FONT_SCALE, shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, ProgressBar, Reveal, Row, SampleTag, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';

export function Nutrition() {
  const c = useColors();
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
      <Txt w="sb" size={14} color={c.textSecondary}>
        {weekdayLong()} · in-season
      </Txt>
      <Txt w="eb" size={28} ls={-0.8} style={{ marginTop: 1 }}>
        Nutrition
      </Txt>

      <Reveal index={0}>
        <MemoryEntry />
      </Reveal>

      {/* Restaurant Coach entry — "what should I eat?" before you order.
          Gated by the engines master switch (OFF for the prove-the-loop beta). */}
      {isEnginesEnabled ? (
        <Reveal index={1}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restaurant Coach: what should I eat"
          onPress={s.openFoodCoach}
          style={[{ marginTop: 16, borderRadius: 20, padding: 16, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', gap: 13 }, shadow.cta]}
        >
          <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={20} color={c.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={15} color={c.white}>
              What should I eat?
            </Txt>
            <Txt w="m" size={13} color="rgba(255,255,255,0.85)" style={{ marginTop: 1 }}>
              Tell the coach where you are — get the best order for your goal
            </Txt>
          </View>
          <Icon name="chevronRight" size={22} color="rgba(255,255,255,0.7)" />
        </Pressable>
        </Reveal>
      ) : null}

      {/* weekly goal (coach-set) */}
      <Reveal index={2}>
      <Card variant="hero" style={{ marginTop: 18, borderRadius: 24 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>
            THIS WEEK'S GOAL
          </Txt>
          <Row style={{ gap: 6, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, backgroundColor: c.warnTint }}>
            <Icon name="checkin" size={12} color={c.warningDeep} />
            <Txt w="eb" num size={12} color={c.warningDeep}>
              {pace.daysLeft} days left
            </Txt>
          </Row>
        </Row>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
          <View>
            <Txt w="eb" num size={29} ls={-0.9}>
              Gain {s.weeklyGoalLb.toFixed(1)} lb
            </Txt>
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }}>
              by Sunday · ≈{pace.surplus} cal/day surplus
            </Txt>
          </View>
          <Row style={{ gap: 7, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: c.bg2 }}>
            <Icon name="shield" size={13} color={c.textSecondary} />
            <Txt w="b" size={12} color={c.textSecondary}>
              Coach-set
            </Txt>
          </Row>
        </Row>
        <View style={{ marginTop: 16 }}>
          <ProgressBar pct={pace.goalPct} height={10} />
        </View>
        <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <Txt w="b" num size={13} color={c.slate700}>
            {pace.progressLb >= 0 ? '+' : ''}{pace.progressLb.toFixed(1)} lb so far
          </Txt>
          <Txt w="eb" size={13} color={pace.onPace ? c.successDeep : c.warningDeep}>
            {pace.paceLabel}
          </Txt>
        </Row>
        <View style={{ marginTop: 14, borderRadius: 14, padding: 13, backgroundColor: c.accentSurface }}>
          <Txt w="m" size={13} color={c.slate700} style={{ lineHeight: 19 }}>
            <Txt w="b" size={13} color={c.accent}>
              Pace ·{' '}
            </Txt>
            {pace.paceAi}
          </Txt>
        </View>
      </Card>
      </Reveal>

      {/* macros */}
      <Reveal index={3}>
      <Card variant="low" style={{ marginTop: 14, borderRadius: 24 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
          <Txt w="eb" size={16} ls={-0.3}>
            Macros
          </Txt>
          <Txt w="b" num size={14}>
            {d.kcalToday.toLocaleString()} <Txt w="b" num size={14} color={c.textSecondary}>/ {d.calTarget.toLocaleString()} cal</Txt>
          </Txt>
        </Row>
        <View style={{ marginBottom: 22 }}>
          <ProgressBar pct={calPct} height={8} />
        </View>
        <Row style={{ justifyContent: 'space-around' }}>
          <MacroRing label="Protein" value={d.proteinToday} target={`/${d.proteinTarget}g`} pct={d.proteinPct} color={c.accent} />
          <MacroRing label="Carbs" value={d.carbsToday} target={`/${d.carbTarget}g`} pct={d.carbPct} color={c.hydration} />
          <MacroRing label="Fat" value={d.fatToday} target={`/${d.fatTarget}g`} pct={d.fatPct} color="#8B5CF6" />
        </Row>
      </Card>
      </Reveal>

      {/* protein gap quick-adds */}
      <Reveal index={4}>
      <Card variant="low" style={{ marginTop: 14, borderRadius: 24 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="eb" size={16} ls={-0.3}>
            Protein gap
          </Txt>
          <Txt w="eb" num size={15} color={c.accent}>
            {d.proteinGap}g to go
          </Txt>
        </Row>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 6 }}>
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
                  backgroundColor: added ? c.successTint : c.bg,
                  borderWidth: 1.5,
                  borderColor: added ? c.successBorderSoft : 'transparent',
                }}
              >
                <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: added ? c.success : c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                  {added ? <Icon name="check" size={13} color={c.white} /> : <Icon name="plus" size={16} color={c.accent} />}
                </View>
                <Txt w="b" size={14} style={{ flex: 1 }}>
                  {f.n}
                </Txt>
                <Txt w="eb" num size={14} color={added ? c.successDeep : c.accent}>
                  +{f.g}g
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </Card>
      </Reveal>

      {/* snacks & shakes — one-tap between-meal logging (persists + scores like a meal) */}
      <Reveal index={5}>
      <Card variant="low" style={{ marginTop: 14, borderRadius: 24 }}>
        <Txt w="eb" size={16} ls={-0.3}>Snacks & shakes</Txt>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 6 }}>
          Tap to log between-meal fuel. It counts toward your day, just like a meal.
        </Txt>
        <Row style={{ flexWrap: 'wrap', gap: 9, marginTop: 14 }}>
          {SNACK_PRESETS.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Log ${p.name}, ${p.per.protein} grams protein`}
              onPress={() => s.addSnack(p)}
              style={({ pressed }) => [{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 13,
                paddingVertical: 10,
                borderRadius: 13,
                backgroundColor: c.bg,
                borderWidth: 1.5,
                borderColor: c.accentBorder,
                opacity: pressed ? 0.6 : 1,
              }]}
            >
              <Icon name={p.kind === 'shake' ? 'drop' : 'plus'} size={14} color={c.accent} />
              <Txt w="b" size={13}>{p.name}</Txt>
              <Txt w="eb" num size={12} color={c.accent}>+{p.per.protein}g</Txt>
            </Pressable>
          ))}
        </Row>
      </Card>
      </Reveal>

      {/* today's meals */}
      <Reveal index={5}>
      <Card variant="low" style={{ marginTop: 14, borderRadius: 24 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="eb" size={16} ls={-0.3}>
              Today's Meals
            </Txt>
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 2 }}>
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
            <Txt w="b" size={13} color={c.accent}>
              History
            </Txt>
            <Icon name="chevronRight" size={15} color={c.accent} />
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
                  <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 2 }}>
                    {row.protein}g protein · {row.kcal} cal
                  </Txt>
                </View>
                <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: row.quality >= 90 ? c.successSurface : c.accentSurface }}>
                  <Txt w="eb" num size={12} color={row.quality >= 90 ? c.successDeep : c.accent}>
                    {row.quality}
                  </Txt>
                </View>
                <Icon name="chevronRight" size={18} color={c.slate300} />
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
                <View style={{ width: 48, height: 48, borderRadius: 13, borderWidth: 2, borderStyle: 'dashed', borderColor: c.slate300, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="camera" size={20} color={c.textTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt w="b" size={14} color={c.slate700}>
                    {row.label}
                  </Txt>
                  <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 2 }}>
                    {row.dueTime}
                  </Txt>
                </View>
                <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 11, backgroundColor: c.accent }}>
                  <Txt w="b" size={13} color={c.white}>
                    Log now
                  </Txt>
                </View>
              </Pressable>
            ),
          )}
        </View>
      </Card>
      </Reveal>
    </ScrollView>
  );
}

function MacroRing({ label, value, target, pct, color }: { label: string; value: number; target: string; pct: number; color: string }) {
  const c = useColors();
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <View style={{ alignItems: 'center', gap: 9 }}>
      <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={84} height={84} viewBox="0 0 100 100" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={50} cy={50} r={r} fill="none" stroke={c.track} strokeWidth={9} />
          <Circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
        </Svg>
        <Txt w="eb" num size={17} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {value}
        </Txt>
        <Txt w="b" size={9} color={c.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {target}
        </Txt>
      </View>
      <Txt w="b" size={12} color={c.slate700}>
        {label}
      </Txt>
    </View>
  );
}

/**
 * Nutrition Memory entry — teases the top remembered insight and opens the full surface.
 * The differentiator in one tap: "this app remembers how you eat." Uses the same engine
 * the overlay does, so the teaser headline always matches what's inside.
 */
function MemoryEntry() {
  const c = useColors();
  const open = useStore((s) => s.openNutritionMemory);
  const { insights, sampled } = useNutritionMemory();
  const top = insights[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Nutrition Memory"
      onPress={open}
      style={({ pressed }) => [{ marginTop: 16, borderRadius: 20, padding: 16, backgroundColor: c.card, flexDirection: 'row', alignItems: 'center', gap: 13, opacity: pressed ? 0.85 : 1 }, shadow.card]}
    >
      <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="sparkle" size={20} color={c.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row style={{ gap: 7, alignItems: 'center' }}>
          <Txt w="eb" size={15} ls={-0.2}>Nutrition Memory</Txt>
          {sampled ? <SampleTag /> : null}
        </Row>
        <Txt w="m" size={12} color={c.textTertiary} numberOfLines={1} style={{ marginTop: 2 }}>
          {top ? top.headline : 'What OnStandard remembers about how you eat'}
        </Txt>
      </View>
      {top?.metric ? (
        <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, backgroundColor: c.accentSurface }}>
          <Txt w="eb" size={13} color={c.accent}>{top.metric}</Txt>
        </View>
      ) : (
        <Icon name="chevronRight" size={18} color={c.slate300} />
      )}
    </Pressable>
  );
}
