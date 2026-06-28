// AthleteOS — Restaurant Coach overlay ("what should I eat?"). The Nutrition Intelligence
// Engine, made tangible: pick where you are, the engine recommends a concrete order off
// the real menu, personalized to your goal + what's LEFT in today's plan, under budget.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { RESTAURANTS, recommendOrder, genericMealGuidance, type RecommendedOrder, type GenericGuidance } from '@/core';
import type { EditableFood, MealKey } from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, font, shadow } from '@/ui/tokens';
import { Btn, Card, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

const GOAL_LABEL: Record<string, string> = { gain: 'gaining', lose: 'leaning out', maintain: 'maintaining', performance: 'performance' };
const SLOTS: MealKey[] = ['breakfast', 'lunch', 'snack', 'dinner'];
/** Sentinel restaurant id for the off-menu fallback ("I'm somewhere else"). */
const ELSEWHERE = 'elsewhere';

export function FoodCoach() {
  const s = useStore();
  const [openAlt, setOpenAlt] = React.useState<string | null>(null);

  // "Use this order" logs the recommended order's foods into the next unlogged meal slot,
  // so a recommendation flows straight into the day's plan + score.
  const useOrder = (order: RecommendedOrder) => {
    const foods: EditableFood[] = order.lines.map((l) => ({
      name: l.item.name,
      portion: l.item.servingSize,
      servings: 1,
      per: { protein: l.item.protein, kcal: l.item.calories, carbs: l.item.carbs, fat: l.item.fat },
    }));
    const slot = SLOTS.find((k) => !s.meals[k]) ?? 'dinner';
    s.saveMeal(slot, foods);
    s.closeFoodCoach();
  };
  const d = useDerived();
  const [restaurantId, setRestaurantId] = React.useState(RESTAURANTS[0].id);
  const [budgetText, setBudgetText] = React.useState('');

  const goal = s.baseGoal;
  const proteinRemaining = Math.max(0, Math.round(d.proteinGap));
  const caloriesRemaining = Math.max(0, Math.round(d.calTarget - d.kcalToday));
  const budget = budgetText.trim() ? Number(budgetText.trim()) : undefined;

  const elsewhere = restaurantId === ELSEWHERE;
  const result = React.useMemo(
    () => recommendOrder({ restaurantId, goal, proteinRemaining, caloriesRemaining, budget: budget && budget > 0 ? budget : undefined }),
    [restaurantId, goal, proteinRemaining, caloriesRemaining, budget],
  );
  const guidance = React.useMemo(
    () => genericMealGuidance({ goal, proteinRemaining, caloriesRemaining }),
    [goal, proteinRemaining, caloriesRemaining],
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Somewhere else"
            accessibilityState={{ selected: elsewhere }}
            onPress={() => setRestaurantId(elsewhere ? RESTAURANTS[0].id : ELSEWHERE)}
            style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: elsewhere ? colors.accent : colors.border, backgroundColor: elsewhere ? colors.accentSurface : colors.card }}
          >
            <Txt w="b" size={13} color={elsewhere ? colors.accent : colors.textSecondary}>
              Somewhere else
            </Txt>
          </Pressable>
        </Row>

        {/* budget — only meaningful when ordering off a real menu */}
        {!elsewhere ? (
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
        ) : null}

        {elsewhere ? (
          /* off-menu fallback — goal-aware "build your plate" guidance, then log it */
          <GuidanceCard
            guidance={guidance}
            onLog={() => { s.closeFoodCoach(); s.openMeal(); }}
          />
        ) : (
          <>
            {/* recommended order — owns the visual weight */}
            <OrderCard order={result.primary} onUse={() => useOrder(result.primary)} />

            {/* alternatives — scannable one-line rows that expand on tap */}
            {result.alternatives.length > 0 ? (
              <Txt w="eb" size={12} color={colors.textTertiary} ls={0.6} upper style={{ marginTop: 22, marginBottom: 4 }}>
                Other options
              </Txt>
            ) : null}
            {result.alternatives.map((a) => (
              <AltRow
                key={a.label}
                label={a.label}
                order={a.order}
                expanded={openAlt === a.label}
                onToggle={() => setOpenAlt((k) => (k === a.label ? null : a.label))}
                onUse={() => useOrder(a.order)}
              />
            ))}
          </>
        )}

        <Txt w="m" size={11} color={colors.textTertiary} style={{ marginTop: 18, lineHeight: 16 }}>
          {elsewhere
            ? 'General guidance from your remaining targets — adjust to what they actually serve. Coaching, not medical advice.'
            : 'Nutrition estimates from a curated menu database; values vary by location and order. Coaching, not medical advice.'}
        </Txt>
      </ScrollView>
    </Overlay>
  );
}

function GuidanceCard({ guidance, onLog }: { guidance: GenericGuidance; onLog: () => void }) {
  return (
    <Card elevated style={{ marginTop: 16, borderRadius: 20, borderWidth: 1.5, borderColor: colors.accent }}>
      <Row style={{ gap: 9, marginBottom: 10 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={16} color={colors.accent} />
        </View>
        <Txt w="eb" size={16} ls={-0.3} color={colors.accent} style={{ flex: 1 }}>
          Build your plate
        </Txt>
      </Row>
      <Txt w="sb" size={14} color={colors.slate700} style={{ lineHeight: 20 }}>
        {guidance.headline}
      </Txt>

      <Row style={{ gap: 8, marginTop: 12 }}>
        <Stat value={`${guidance.proteinTarget}g`} label="PROTEIN TARGET" />
        {guidance.calorieCeiling ? <Stat value={`≤${guidance.calorieCeiling}`} label="CALORIES" /> : null}
      </Row>

      <View style={{ marginTop: 14, gap: 8 }}>
        {guidance.pick.map((p) => (
          <Row key={p} style={{ gap: 9, alignItems: 'flex-start' }}>
            <Icon name="check" size={15} color={colors.successDeep} />
            <Txt w="m" size={13} color={colors.slate700} style={{ flex: 1, lineHeight: 19 }}>
              {p}
            </Txt>
          </Row>
        ))}
        {guidance.skip.map((sk) => (
          <Row key={sk} style={{ gap: 9, alignItems: 'flex-start' }}>
            <Icon name="close" size={15} color={colors.textTertiary} />
            <Txt w="m" size={13} color={colors.textSecondary} style={{ flex: 1, lineHeight: 19 }}>
              {sk}
            </Txt>
          </Row>
        ))}
      </View>

      <Btn label="Log what you ate" haptic="success" onPress={onLog} style={{ marginTop: 16 }} />
    </Card>
  );
}

function OrderCard({ order, onUse }: { order: RecommendedOrder; onUse: () => void }) {
  if (order.lines.length === 0) return null;
  const t = order.totals;
  return (
    <Card elevated style={{ marginTop: 16, borderRadius: 20, borderWidth: 1.5, borderColor: colors.accent }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Txt w="eb" size={16} ls={-0.3} color={colors.accent}>
          Recommended order
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
      <Txt w="m" size={13} color={colors.slate700} style={{ marginTop: 12, lineHeight: 19 }}>
        {order.why}
      </Txt>
      <Btn label="Use this order" haptic="success" onPress={onUse} style={{ marginTop: 14 }} />
    </Card>
  );
}

function AltRow({ label, order, expanded, onToggle, onUse }: { label: string; order: RecommendedOrder; expanded: boolean; onToggle: () => void; onUse: () => void }) {
  if (order.lines.length === 0) return null;
  const t = order.totals;
  return (
    <View style={[{ marginTop: 10, backgroundColor: '#fff', borderRadius: 16, padding: 14 }, shadow.card]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} option`} accessibilityState={{ expanded }} onPress={onToggle} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt w="b" size={14} style={{ flex: 1 }}>
            {label}
          </Txt>
          <Txt w="m" size={12} color={colors.textTertiary} style={{ marginRight: 8 }}>
            {t.protein}g · {t.calories}cal · ${t.price.toFixed(2)}
          </Txt>
          <Icon name={expanded ? 'minus' : 'chevronRight'} size={18} color="#CBD5E1" />
        </Row>
      </Pressable>
      {expanded ? (
        <View style={{ marginTop: 10, gap: 5 }}>
          {order.lines.map((l) => (
            <Row key={l.item.id} style={{ justifyContent: 'space-between' }}>
              <Txt w="m" size={13} color={colors.slate700} style={{ flex: 1 }}>
                {l.item.name}
              </Txt>
              <Txt w="m" size={11} color={colors.textTertiary}>
                {l.item.protein}g · {l.item.calories} cal
              </Txt>
            </Row>
          ))}
          <Btn label="Use this order" onPress={onUse} style={{ marginTop: 10 }} />
        </View>
      ) : null}
    </View>
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
