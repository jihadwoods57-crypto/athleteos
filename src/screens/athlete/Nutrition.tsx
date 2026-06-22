// AthleteOS — Nutrition. Time-aware coach-set goal, macro rings, protein gap
// quick-adds (add real grams), today's meal log.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { MEALS_LOG, QUICK_FOODS, paceProjection } from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Card, ProgressBar, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';

export function Nutrition() {
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = useDerived();
  const pace = paceProjection(s.weeklyGoalLb);
  const calPct = Math.round((d.kcalToday / d.calTarget) * 100);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      <Txt w="sb" size={14} color={colors.textSecondary}>
        Tuesday · in-season
      </Txt>
      <Txt w="eb" size={28} ls={-0.8} style={{ marginTop: 1 }}>
        Nutrition
      </Txt>

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
            +0.6 lb so far
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
            {d.kcalToday.toLocaleString()} <Txt w="b" size={14} color="#CBD5E1">/ 3,200 cal</Txt>
          </Txt>
        </Row>
        <View style={{ marginBottom: 22 }}>
          <ProgressBar pct={calPct} height={8} />
        </View>
        <Row style={{ justifyContent: 'space-around' }}>
          <MacroRing label="Protein" value={d.proteinToday} target="/180g" pct={d.proteinPct} color={colors.accent} />
          <MacroRing label="Carbs" value={210} target="/300g" pct={70} color={colors.hydration} />
          <MacroRing label="Fat" value={58} target="/80g" pct={73} color="#8B5CF6" />
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
          <Txt w="eb" size={16} ls={-0.3}>
            Today's Meals
          </Txt>
          <Txt w="sb" size={13} color={colors.textSecondary}>
            {d.mealsLoggedCount} of 4 logged
          </Txt>
        </Row>
        <View style={{ gap: 12 }}>
          {MEALS_LOG.map((m) => (
            <Pressable key={m.id} onPress={() => s.openMealDetail(m.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
              <View style={{ width: 48, height: 48, borderRadius: 13, backgroundColor: m.thumb[1] }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt w="b" size={14}>
                  {m.name}
                </Txt>
                <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 2 }}>
                  {m.time} · {m.protein}g protein · {m.kcal} cal
                </Txt>
              </View>
              <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: m.quality >= 90 ? colors.successSurface : colors.accentSurface }}>
                <Txt w="eb" size={12} color={m.quality >= 90 ? colors.successDeep : colors.accent}>
                  {m.quality}
                </Txt>
              </View>
              <Icon name="chevronRight" size={18} color="#CBD5E1" />
            </Pressable>
          ))}

          {!s.meals.dinner ? (
            <Pressable onPress={s.openMeal} style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
              <View style={{ width: 48, height: 48, borderRadius: 13, borderWidth: 2, borderStyle: 'dashed', borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="camera" size={20} color={colors.textTertiary} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt w="b" size={14} color={colors.slate700}>
                  Dinner
                </Txt>
                <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 2 }}>
                  Due by 8:00 PM
                </Txt>
              </View>
              <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 11, backgroundColor: colors.accent }}>
                <Txt w="b" size={13} color="#fff">
                  Log now
                </Txt>
              </View>
            </Pressable>
          ) : (
            <Pressable onPress={() => s.openMealDetail('dinner')} style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
              <View style={{ width: 48, height: 48, borderRadius: 13, backgroundColor: '#EF4444' }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt w="b" size={14}>
                  Chicken, Rice & Broccoli
                </Txt>
                <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 2 }}>
                  Just now · 52g protein · 680 cal
                </Txt>
              </View>
              <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.successSurface }}>
                <Txt w="eb" size={12} color={colors.successDeep}>
                  94
                </Txt>
              </View>
              <Icon name="chevronRight" size={18} color="#CBD5E1" />
            </Pressable>
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
        <Txt w="eb" size={17}>
          {value}
        </Txt>
        <Txt w="b" size={9} color={colors.textTertiary}>
          {target}
        </Txt>
      </View>
      <Txt w="b" size={12} color={colors.slate700}>
        {label}
      </Txt>
    </View>
  );
}
