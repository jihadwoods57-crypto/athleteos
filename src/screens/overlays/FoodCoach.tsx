// AthleteOS — Restaurant Coach overlay ("what should I eat?"). The Nutrition Intelligence
// Engine, made tangible: pick where you are, the engine recommends a concrete order off
// the real menu, personalized to your goal + what's LEFT in today's plan, under budget.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { RESTAURANTS, recommendOrder, type RecommendedOrder } from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, font, shadow } from '@/ui/tokens';
import { Card, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

const GOAL_LABEL: Record<string, string> = { gain: 'gaining', lose: 'leaning out', maintain: 'maintaining', performance: 'performance' };

export function FoodCoach() {
  const s = useStore();
  const d = useDerived();
  const [restaurantId, setRestaurantId] = React.useState(RESTAURANTS[0].id);
  const [budgetText, setBudgetText] = React.useState('');

  const goal = s.baseGoal;
  const proteinRemaining = Math.max(0, Math.round(d.proteinGap));
  const caloriesRemaining = Math.max(0, Math.round(d.calTarget - d.kcalToday));
  const budget = budgetText.trim() ? Number(budgetText.trim()) : undefined;

  const result = React.useMemo(
    () => recommendOrder({ restaurantId, goal, proteinRemaining, caloriesRemaining, budget: budget && budget > 0 ? budget : undefined }),
    [restaurantId, goal, proteinRemaining, caloriesRemaining, budget],
  );

  return (
    <Overlay title="Restaurant Coach" onClose={s.closeFoodCoach}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Txt w="m" size={14} color={colors.textSecondary} style={{ marginTop: 4, lineHeight: 20 }}>
          You're {GOAL_LABEL[goal] ?? 'on plan'} with {proteinRemaining}g protein and {caloriesRemaining} calories left today. Where are you?
        </Txt>

        {/* restaurant picker */}
        <Row style={{ flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {RESTAURANTS.map((r) => {
            const on = r.id === restaurantId;
            return (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={r.name}
                accessibilityState={{ selected: on }}
                onPress={() => setRestaurantId(r.id)}
                style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1.5, borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.accentSurface : colors.card }}
              >
                <Txt w="b" size={13} color={on ? colors.accent : colors.text}>
                  {r.name}
                </Txt>
              </Pressable>
            );
          })}
        </Row>

        {/* budget */}
        <Row style={{ gap: 10, marginTop: 12, alignItems: 'center' }}>
          <Txt w="b" size={14} color={colors.textSecondary}>
            Budget
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, height: 44, borderRadius: 13, backgroundColor: colors.bg, paddingHorizontal: 14 }}>
            <Txt w="b" size={15} color={colors.textTertiary}>
              $
            </Txt>
            <TextInput
              value={budgetText}
              onChangeText={setBudgetText}
              placeholder="any"
              placeholderTextColor={colors.textTertiary}
              keyboardType="number-pad"
              accessibilityLabel="Budget in dollars"
              style={{ flex: 1, marginLeft: 4, fontFamily: font.m, fontSize: 15, color: colors.text }}
            />
          </View>
        </Row>

        {/* recommended order */}
        <OrderCard title="Recommended order" order={result.primary} highlight />

        {/* alternatives */}
        {result.alternatives.map((a) => (
          <OrderCard key={a.label} title={a.label} order={a.order} />
        ))}

        <Txt w="m" size={11} color={colors.textTertiary} style={{ marginTop: 16, lineHeight: 16 }}>
          Nutrition estimates from a curated menu database; values vary by location and order. Coaching, not medical advice.
        </Txt>
      </ScrollView>
    </Overlay>
  );
}

function OrderCard({ title, order, highlight }: { title: string; order: RecommendedOrder; highlight?: boolean }) {
  if (order.lines.length === 0) return null;
  const t = order.totals;
  return (
    <Card elevated={highlight} style={{ marginTop: 14, borderRadius: 20, borderWidth: highlight ? 1.5 : 0, borderColor: highlight ? colors.accent : undefined }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Txt w="eb" size={highlight ? 16 : 14} ls={-0.3} color={highlight ? colors.accent : colors.text}>
          {title}
        </Txt>
        <Txt w="b" size={13} color={colors.textTertiary}>
          ${t.price.toFixed(2)}
        </Txt>
      </Row>
      <View style={{ gap: 6 }}>
        {order.lines.map((l) => (
          <Row key={l.item.id} style={{ justifyContent: 'space-between' }}>
            <Txt w="m" size={14} color={colors.slate700} style={{ flex: 1 }}>
              {l.item.name}
            </Txt>
            <Txt w="m" size={12} color={colors.textTertiary}>
              {l.item.protein}g · {l.item.calories} cal
            </Txt>
          </Row>
        ))}
      </View>
      <Row style={{ gap: 8, marginTop: 12 }}>
        <Stat value={`${t.protein}g`} label="PROTEIN" />
        <Stat value={`${t.calories}`} label="CALORIES" />
        <Stat value={`${t.carbs}g`} label="CARBS" />
        <Stat value={`${t.fat}g`} label="FAT" />
      </Row>
      {highlight ? (
        <Txt w="m" size={13} color={colors.slate700} style={{ marginTop: 12, lineHeight: 19 }}>
          {order.why}
        </Txt>
      ) : null}
    </Card>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={[{ flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 10 }, shadow.card]}>
      <Txt w="eb" size={16} color={colors.accent}>
        {value}
      </Txt>
      <Txt w="b" size={9} color={colors.textTertiary} style={{ marginTop: 2 }}>
        {label}
      </Txt>
    </View>
  );
}
