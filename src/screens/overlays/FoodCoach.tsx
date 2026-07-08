// OnStandard — Restaurant Coach overlay ("what should I eat?"). The Nutrition Intelligence
// Engine, made tangible: pick where you are, the engine recommends a concrete order off
// the real menu, personalized to your goal + what's LEFT in today's plan, under budget.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { RESTAURANTS, recommendOrder, genericMealGuidance, avoidFoodsFromFacts, type RecommendedOrder, type RecommendResult, type GenericGuidance } from '@/core';
import type { EditableFood, MealKey } from '@/core';
import { aiRestaurantCoachTag, isAiConfigured, rephraseOrders } from '@/lib/ai';
import { fetchMemoryFacts } from '@/lib/ai/memory';
import { useStore, useDerived } from '@/store';
import { font, shadow } from '@/ui/tokens';
import { Btn, Card, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { useColors } from '@/ui/theme';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

const GOAL_LABEL: Record<string, string> = { gain: 'gaining', lose: 'leaning out', maintain: 'maintaining', performance: 'performance' };
const SLOTS: MealKey[] = ['breakfast', 'lunch', 'snack', 'dinner'];
/** Sentinel restaurant id for the off-menu fallback ("I'm somewhere else"). */
const ELSEWHERE = 'elsewhere';

export function FoodCoach() {
  const c = useColors();
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
  // The athlete's CONFIRMED avoid foods (allergies/dislikes) — the hard filter the
  // recommender honors. Fail-safe empty on any error; recompute when the overlay opens.
  const [avoid, setAvoid] = React.useState<string[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    fetchMemoryFacts('active')
      .then((facts) => { if (!cancelled) setAvoid(avoidFoodsFromFacts(facts)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const deterministic = React.useMemo(
    () => recommendOrder({ restaurantId, goal, proteinRemaining, caloriesRemaining, budget: budget && budget > 0 ? budget : undefined, avoid }),
    [restaurantId, goal, proteinRemaining, caloriesRemaining, budget, avoid],
  );
  // The deterministic recommendation renders instantly (ground truth). When a model is configured,
  // the explanations are reworded in a warmer voice and swapped in when they land; the core guard
  // keeps every macro/price exactly the engine's. byAI flips the label only when a rewrite lands.
  const { display: result, byAI } = useRephrasedOrders(deterministic);
  const guidance = React.useMemo(
    () => genericMealGuidance({ goal, proteinRemaining, caloriesRemaining }),
    [goal, proteinRemaining, caloriesRemaining],
  );

  return (
    <Overlay title="Restaurant Coach" onClose={s.closeFoodCoach}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* intro — icon-tiled premium header with the live remaining-plan read */}
        <Reveal index={0}>
        <Card variant="hero" style={{ marginTop: 4, borderRadius: 22, padding: 18, flexDirection: 'row', gap: 13, alignItems: 'flex-start' }}>
          <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="utensils" size={20} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={11} color={c.accent} ls={0.5}>WHAT SHOULD I EAT?</Txt>
            <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 19 }}>
              You're {GOAL_LABEL[goal] ?? 'on plan'} with {proteinRemaining}g protein and {caloriesRemaining} calories left today. Where are you?
            </Txt>
          </View>
        </Card>
        </Reveal>

        {/* restaurant picker */}
        <Txt w="eb" size={12} color={c.textTertiary} ls={0.6} upper style={{ marginTop: 22, marginBottom: 10, marginLeft: 4 }}>
          Where are you?
        </Txt>
        <Row style={{ flexWrap: 'wrap', gap: 8 }}>
          {RESTAURANTS.map((r) => {
            const on = r.id === restaurantId;
            return (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={r.name}
                accessibilityState={{ selected: on }}
                onPress={() => setRestaurantId(r.id)}
                style={({ pressed }) => [{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 13, borderWidth: 1.5, borderColor: on ? c.accent : c.hairline, backgroundColor: on ? c.accentSurface : c.card, opacity: pressed ? 0.85 : 1 }, on ? null : shadow.card]}
              >
                <Txt w="b" size={13} color={on ? c.accent : c.text}>
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
            style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 13, borderWidth: 1.5, borderStyle: 'dashed', borderColor: elsewhere ? c.accent : c.slate300, backgroundColor: elsewhere ? c.accentSurface : c.surface2, opacity: pressed ? 0.85 : 1 })}
          >
            <Txt w="b" size={13} color={elsewhere ? c.accent : c.textSecondary}>
              Somewhere else
            </Txt>
          </Pressable>
        </Row>

        {/* budget — only meaningful when ordering off a real menu */}
        {!elsewhere ? (
          <Row style={{ gap: 10, marginTop: 14, alignItems: 'center' }}>
            <Txt w="eb" size={12} color={c.textTertiary} ls={0.6} upper>
              Budget
            </Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, height: 46, borderRadius: 13, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 14 }}>
              <Txt w="b" size={15} color={c.textTertiary}>
                $
              </Txt>
              <TextInput
                value={budgetText}
                onChangeText={setBudgetText}
                placeholder="any"
                placeholderTextColor={c.textTertiary}
                keyboardType="number-pad"
                accessibilityLabel="Budget in dollars"
                style={{ flex: 1, marginLeft: 4, fontFamily: font.m, fontSize: 15, color: c.text }}
              />
            </View>
          </Row>
        ) : null}

        {elsewhere ? (
          /* off-menu fallback — goal-aware "build your plate" guidance, then log it */
          <Reveal index={1}>
            <GuidanceCard
              guidance={guidance}
              onLog={() => { s.closeFoodCoach(); s.openMeal(); }}
            />
          </Reveal>
        ) : (
          <>
            {/* recommended order — owns the visual weight */}
            <Reveal index={1}>
              <OrderCard order={result.primary} byAI={byAI} onUse={() => useOrder(result.primary)} />
            </Reveal>

            {/* alternatives — scannable one-line rows that expand on tap */}
            {result.alternatives.length > 0 ? (
              <Txt w="eb" size={12} color={c.textTertiary} ls={0.6} upper style={{ marginTop: 22, marginBottom: 4 }}>
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

        <Txt w="m" size={11} color={c.textTertiary} style={{ marginTop: 18, lineHeight: 16 }}>
          {elsewhere
            ? 'General guidance from your remaining targets — adjust to what they actually serve. Coaching, not medical advice.'
            : 'Nutrition estimates from a curated menu database; values vary by location and order. Coaching, not medical advice.'}
        </Txt>
      </ScrollView>
    </Overlay>
  );
}

function GuidanceCard({ guidance, onLog }: { guidance: GenericGuidance; onLog: () => void }) {
  const c = useColors();
  return (
    <Card variant="hero" style={{ marginTop: 16, borderRadius: 22, borderWidth: 1.5, borderColor: c.accent }}>
      <Row style={{ gap: 10, marginBottom: 12 }}>
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={17} color={c.accent} />
        </View>
        <Txt w="eb" size={16} ls={-0.3} color={c.accent} style={{ flex: 1 }}>
          Build your plate
        </Txt>
      </Row>
      <Txt w="sb" size={14} color={c.slate700} style={{ lineHeight: 20 }}>
        {guidance.headline}
      </Txt>

      <Row style={{ gap: 8, marginTop: 12 }}>
        <Stat value={`${guidance.proteinTarget}g`} label="PROTEIN TARGET" />
        {guidance.calorieCeiling ? <Stat value={`≤${guidance.calorieCeiling}`} label="CALORIES" /> : null}
      </Row>

      <View style={{ marginTop: 14, gap: 10, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 14, padding: 13 }}>
        {guidance.pick.map((p) => (
          <Row key={p} style={{ gap: 10, alignItems: 'flex-start' }}>
            <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <Icon name="check" size={13} color={c.successDeep} />
            </View>
            <Txt w="m" size={13} color={c.slate700} style={{ flex: 1, lineHeight: 19 }}>
              {p}
            </Txt>
          </Row>
        ))}
        {guidance.skip.map((sk) => (
          <Row key={sk} style={{ gap: 10, alignItems: 'flex-start' }}>
            <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <Icon name="close" size={13} color={c.textTertiary} />
            </View>
            <Txt w="m" size={13} color={c.textSecondary} style={{ flex: 1, lineHeight: 19 }}>
              {sk}
            </Txt>
          </Row>
        ))}
      </View>

      <Btn label="Log what you ate" haptic="success" onPress={onLog} style={{ marginTop: 16 }} />
    </Card>
  );
}

function OrderCard({ order, byAI, onUse }: { order: RecommendedOrder; byAI: boolean; onUse: () => void }) {
  const c = useColors();
  if (order.lines.length === 0) return null;
  const t = order.totals;
  return (
    <Card variant="hero" style={{ marginTop: 16, borderRadius: 22, borderWidth: 1.5, borderColor: c.accent }}>
      {/* Provenance chip: only when the AI actually reworded the explanation (byAI). Otherwise the
          card is the deterministic coach recommendation and shows no AI badge. */}
      {byAI ? (
        <Row style={{ gap: 6, marginBottom: 10, alignSelf: 'flex-start', backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 }}>
          <Icon name="sparkle" size={13} color={c.accent} />
          <Txt w="eb" size={11} color={c.accent} ls={0.6}>{aiRestaurantCoachTag}</Txt>
        </Row>
      ) : null}
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <Row style={{ gap: 10, alignItems: 'center', flex: 1 }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={17} color={c.accent} />
          </View>
          <Txt w="eb" size={16} ls={-0.3} color={c.accent}>
            Recommended order
          </Txt>
        </Row>
        <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
          <Txt w="eb" num size={13} color={c.slate700}>
            ${t.price.toFixed(2)}
          </Txt>
        </View>
      </Row>
      <View style={{ gap: 8, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 14, padding: 13 }}>
        {order.lines.map((l) => (
          <Row key={l.item.id} style={{ justifyContent: 'space-between' }}>
            <Txt w="sb" size={14} color={c.slate700} style={{ flex: 1, paddingRight: 10 }}>
              {l.item.name}
            </Txt>
            <Txt w="m" num size={12} color={c.textTertiary}>
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
      <Txt w="m" size={13} color={c.slate700} style={{ marginTop: 12, lineHeight: 19 }}>
        {order.why}
      </Txt>
      <Btn label="Use this order" haptic="success" onPress={onUse} style={{ marginTop: 14 }} />
    </Card>
  );
}

function AltRow({ label, order, expanded, onToggle, onUse }: { label: string; order: RecommendedOrder; expanded: boolean; onToggle: () => void; onUse: () => void }) {
  const c = useColors();
  if (order.lines.length === 0) return null;
  const t = order.totals;
  return (
    <View style={[{ marginTop: 10, backgroundColor: c.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: expanded ? c.accentBorder : c.hairline }, shadow.card]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} option`} accessibilityState={{ expanded }} onPress={onToggle} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt w="b" size={14} style={{ flex: 1 }}>
            {label}
          </Txt>
          <Txt w="m" num size={12} color={c.textTertiary} style={{ marginRight: 8 }}>
            {t.protein}g · {t.calories}cal · ${t.price.toFixed(2)}
          </Txt>
          <View style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}>
            <Icon name="chevronRight" size={18} color={c.slate300} />
          </View>
        </Row>
      </Pressable>
      {expanded ? (
        <View style={{ marginTop: 12 }}>
          <View style={{ gap: 6, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 12, padding: 12 }}>
            {order.lines.map((l) => (
              <Row key={l.item.id} style={{ justifyContent: 'space-between' }}>
                <Txt w="sb" size={13} color={c.slate700} style={{ flex: 1, paddingRight: 10 }}>
                  {l.item.name}
                </Txt>
                <Txt w="m" num size={11} color={c.textTertiary}>
                  {l.item.protein}g · {l.item.calories} cal
                </Txt>
              </Row>
            ))}
          </View>
          <Btn label="Use this order" onPress={onUse} style={{ marginTop: 10 }} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Returns the recommendation to render plus whether AI actually warmed it. The deterministic
 * recommendation shows immediately; AI-warmed explanations replace it once they resolve (when a
 * model is configured) and pass the number guard. `byAI` is true only when a rewrite genuinely
 * landed (the seam returns the SAME result object when nothing safely warms). Race-guarded; a
 * literal no-op when AI is unconfigured, so today it just returns the engine's recommendation.
 */
function useRephrasedOrders(result: RecommendResult): { display: RecommendResult; byAI: boolean } {
  const [warmed, setWarmed] = React.useState<RecommendResult | null>(null);

  React.useEffect(() => {
    setWarmed(null); // new deterministic input -> show ground truth, drop any prior warmed prose
    if (!isAiConfigured) return;
    let active = true;
    void rephraseOrders(result).then((next) => {
      // Apply only if still current AND the model genuinely reworded something (changed reference).
      if (active && next !== result) setWarmed(next);
    });
    return () => {
      active = false;
    };
  }, [result]);

  return { display: warmed ?? result, byAI: warmed !== null };
}

function Stat({ value, label }: { value: string; label: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 13, padding: 11 }}>
      <Txt w="eb" num size={16} color={c.accent}>
        {value}
      </Txt>
      <Txt w="b" size={9} color={c.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
    </View>
  );
}
