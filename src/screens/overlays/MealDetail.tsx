// OnStandard — Meal Detail: hero, macros, foods, quality breakdown, 3-way chat.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { MEALS_LOG, macroComposition, mealMacros, mealQuality, stepServings, toEditableFoods, searchFoods, addFood, removeFood, resolvePortion, medicalDisclaimer, activePlan, planMealNote } from '@/core';
import { isEnginesEnabled } from '@/lib/features';
import { aiCoachName, isAiConfigured } from '@/lib/ai';
import type { EditableFood, LoggedMeal, FoodItem, MealKey } from '@/core';
import { useStore } from '@/store';
import { font, shadow } from '@/ui/tokens';
import { Btn, Card, ProgressBar, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { useColors } from '@/ui/theme';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

const DINNER: LoggedMeal = {
  id: 'dinner',
  name: 'Chicken, Rice & Broccoli',
  time: 'Just now',
  quality: 94,
  kcal: 680,
  protein: 52,
  carbs: 64,
  fat: 18,
  thumb: ['#FCA5A5', '#EF4444'],
  foods: [
    { n: 'Grilled chicken', p: '7 oz' },
    { n: 'Brown rice', p: '1 cup' },
    { n: 'Broccoli', p: '1.5 cups' },
    { n: 'Olive oil', p: '1 tbsp' },
  ],
  sub: [
    { l: 'Protein density', s: 96 },
    { l: 'Whole foods', s: 94 },
    { l: 'Macro balance', s: 90 },
    { l: 'Meal timing', s: 92 },
  ],
  note: 'Excellent protein hit for dinner. Add a piece of fruit and this is a perfect plate.',
};

// The detail overlay is opened with a slot's detailId (b/l/s/dinner); map it back
// to the MealKey so edits save into — and seed from — that slot's day state.
const DETAIL_TO_KEY: Record<string, MealKey> = { b: 'breakfast', l: 'lunch', s: 'snack', dinner: 'dinner' };

export function MealDetail() {
  const c = useColors();
  const s = useStore();
  const meal = MEALS_LOG.find((m) => m.id === s.selectedMeal) ?? DINNER;
  const mealKey: MealKey = DETAIL_TO_KEY[s.selectedMeal ?? ''] ?? 'dinner';

  // Editable estimate: each food carries a numeric share of the meal, so adjusting
  // a portion recomputes macros + quality + composition live (the persona fix for
  // the dead steppers). Seed from the SAVED plate for this slot when one exists,
  // else the photo estimate; re-seed when the opened meal changes.
  const seedFoods = () => s.mealFoods[mealKey] ?? toEditableFoods(meal);
  const [foods, setFoods] = React.useState<EditableFood[]>(seedFoods);
  React.useEffect(() => { setFoods(seedFoods()); }, [s.selectedMeal]); // eslint-disable-line react-hooks/exhaustive-deps
  const macros = mealMacros(foods);
  const quality = mealQuality(macros);
  const comp = macroComposition(macros);
  // Accountability Engine: plan-RELATIVE, goal-aware coaching for THIS meal vs the
  // athlete's plan (not generic advice). The same plate reads differently per goal.
  const planNote = planMealNote(activePlan(s), mealKey, { protein: macros.protein, calories: macros.kcal }, s.baseGoal);
  const [query, setQuery] = React.useState('');
  const results = React.useMemo(() => searchFoods(query, 6), [query]);
  const added = foods.length !== toEditableFoods(meal).length;
  const edited = foods.some((f) => f.servings !== 1) || added;
  const adjust = (i: number, delta: number) =>
    setFoods((prev) => prev.map((f, j) => (j === i ? { ...f, servings: stepServings(f.servings, delta) } : f)));
  const onAdd = (item: FoodItem) => {
    setFoods((prev) => addFood(prev, item));
    setQuery('');
  };
  const onRemove = (i: number) => setFoods((prev) => removeFood(prev, i));

  return (
    <Overlay title="Meal Detail" onClose={s.closeMealDetail}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Reveal index={0}>
          <View style={[{ width: '100%', height: 150, borderRadius: 20, backgroundColor: meal.thumb[1] }, shadow.card]} />
        </Reveal>

        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 16 }}>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={20} ls={-0.3}>
              {meal.name}
            </Txt>
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }}>
              {meal.time}
            </Txt>
          </View>
          <View style={{ alignItems: 'center', marginLeft: 14 }}>
            <Txt w="eb" num size={26} color={c.successDeep} ls={-0.5}>
              {quality}
            </Txt>
            <Txt w="eb" size={10} color={c.textTertiary}>
              QUALITY
            </Txt>
          </View>
        </Row>

        <Row style={{ gap: 8, marginTop: 16 }}>
          <Tile value={`~${macros.protein}g`} label="PROTEIN" color={c.accent} />
          <Tile value={`~${macros.kcal}`} label="CALORIES" />
          <Tile value={`~${macros.carbs}g`} label="CARBS" />
          <Tile value={`~${macros.fat}g`} label="FAT" />
        </Row>
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 10, lineHeight: 17 }}>
          {edited
            ? 'Updated from your portions. This is an adjustable estimate, not a weighed value.'
            : 'Estimated from your meal photo, not weighed. Adjust any portion below to correct it.'}
        </Txt>

        <Reveal index={1}>
        <Card variant="hero" style={{ marginTop: 14, borderRadius: 20 }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <Txt w="eb" size={15} ls={-0.3}>
              Foods
            </Txt>
            <Txt w="b" size={12} color={c.textTertiary}>
              Estimated
            </Txt>
          </Row>
          <View style={{ gap: 14 }}>
            {foods.map((f, i) => (
              <Row key={f.name} style={{ gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Txt w="b" size={14}>
                    {f.name}
                  </Txt>
                  <Txt w="m" size={12} color={c.textTertiary}>
                    {f.servings !== 1
                      ? `${resolvePortion(f.portion, f.servings) ?? f.portion}  ·  ×${f.servings}`
                      : f.portion}
                  </Txt>
                </View>
                <Row style={{ gap: 10, alignItems: 'center' }}>
                  <Step glyph="−" label={`Less ${f.name}`} onPress={() => adjust(i, -0.5)} />
                  <Step glyph="+" label={`More ${f.name}`} onPress={() => adjust(i, 0.5)} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${f.name}`}
                    hitSlop={6}
                    onPress={() => onRemove(i)}
                    style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
                  >
                    <Icon name="close" size={13} color={c.textTertiary} />
                  </Pressable>
                </Row>
              </Row>
            ))}
            {foods.length === 0 ? (
              <Txt w="m" size={13} color={c.textTertiary} style={{ lineHeight: 18 }}>
                No foods yet. Search below to add one.
              </Txt>
            ) : null}
          </View>

          <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: c.bg2, paddingTop: 14 }}>
            <Txt w="eb" size={13} ls={-0.2} style={{ marginBottom: 8 }}>
              Add a food
            </Txt>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search foods (chicken, rice, banana…)"
              placeholderTextColor={c.textTertiary}
              accessibilityLabel="Search foods to add"
              autoCorrect={false}
              style={{ height: 44, borderRadius: 13, backgroundColor: c.bg, paddingHorizontal: 14, fontFamily: font.m, fontSize: 14, color: c.text }}
            />
            {results.length > 0 ? (
              <View style={{ gap: 8, marginTop: 10 }}>
                {results.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${r.name}, ${r.serving}`}
                    onPress={() => onAdd(r)}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.bg, opacity: pressed ? 0.6 : 1 })}
                  >
                    <View style={{ flex: 1 }}>
                      <Txt w="b" size={13}>
                        {r.name}
                      </Txt>
                      <Txt w="m" size={11} color={c.textTertiary} style={{ marginTop: 2 }}>
                        {r.serving} · {r.per.protein}g protein · {r.per.kcal} kcal
                      </Txt>
                    </View>
                    <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="plus" size={14} color={c.accent} />
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : query.trim().length > 0 ? (
              <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 10 }}>
                No match in the food list. A fuller database lands with the backend.
              </Txt>
            ) : null}
          </View>
        </Card>
        </Reveal>

        <Reveal index={2}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 4 }}>
            Calorie composition
          </Txt>
          <Txt w="m" size={12} color={c.textTertiary} style={{ marginBottom: 16, lineHeight: 17 }}>
            Where this meal's calories come from, recalculated from your portions.
          </Txt>
          <View style={{ gap: 13 }}>
            {comp.map((x) => (
              <Row key={x.label} style={{ gap: 12 }}>
                <Txt w="sb" size={13} style={{ width: 78 }}>
                  {x.label}
                </Txt>
                <View style={{ flex: 1 }}>
                  <ProgressBar pct={x.pct} height={7} color={x.label === 'Protein' ? c.accent : c.success} />
                </View>
                <Txt w="eb" num size={13} style={{ width: 38, textAlign: 'right' }}>
                  {x.pct}%
                </Txt>
              </Row>
            ))}
          </View>
        </Card>
        </Reveal>

        <Reveal index={3}>
        <View style={{ marginTop: 14, borderRadius: 18, padding: 18, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, flexDirection: 'row', gap: 13 }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={17} color={c.accent} />
          </View>
          <Txt w="m" size={14} color={c.slate700} style={{ flex: 1, lineHeight: 20 }}>
            <Txt w="b" size={14} color={c.accent}>
              {aiCoachName} ·{' '}
            </Txt>
            {meal.note}
          </Txt>
        </View>
        </Reveal>

        {/* Accountability Engine — how this meal measures against the athlete's plan.
            Gated by the engines master switch (OFF for the prove-the-loop beta). */}
        {isEnginesEnabled ? (
          <View style={{ marginTop: 12, borderRadius: 18, padding: 16, backgroundColor: c.bg2, flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={16} color={c.successDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={11} color={c.textTertiary} ls={0.4} upper>
                Plan check
              </Txt>
              <Txt w="m" size={14} color={c.slate700} style={{ marginTop: 3, lineHeight: 20 }}>
                {planNote}
              </Txt>
            </View>
          </View>
        ) : null}

        <Chat />

        <Btn label="Save Changes" onPress={() => s.saveMeal(mealKey, foods)} style={{ marginTop: 18 }} />
      </ScrollView>
    </Overlay>
  );
}

function Chat() {
  const c = useColors();
  const mealChat = useStore((s) => s.mealChat);
  const chatDraft = useStore((s) => s.chatDraft);
  const setChatDraft = useStore((s) => s.setChatDraft);
  const sendChat = useStore((s) => s.sendChat);

  const nameFor = (who: string) => (who === 'ai' ? aiCoachName : who === 'coach' ? 'Coach Davis' : 'You');
  const isMe = (who: string) => who === 'athlete';

  return (
    <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
      <Row style={{ gap: 8, marginBottom: 14 }}>
        <Txt w="eb" size={15} ls={-0.3}>
          Discuss this meal
        </Txt>
        <View style={{ backgroundColor: c.accentSurface, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
          <Txt w="b" size={10} color={c.accent}>
            {isAiConfigured ? 'YOU · AI · COACH' : 'YOU · COACH'}
          </Txt>
        </View>
      </Row>
      <View style={{ gap: 12 }}>
        {mealChat.map((m, i) => {
          const me = isMe(m.who);
          const bubbleBg = m.who === 'athlete' ? c.accent : m.who === 'coach' ? c.text : c.card;
          const textColor = m.who === 'ai' ? c.slate700 : c.white;
          return (
            <View key={i} style={{ alignItems: me ? 'flex-end' : 'flex-start', gap: 4 }}>
              <Txt w="eb" size={10} color={c.textTertiary}>
                {nameFor(m.who)}
              </Txt>
              <View style={[{ maxWidth: '84%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16, backgroundColor: bubbleBg }, m.who === 'ai' ? shadow.card : undefined]}>
                <Txt w="m" size={13} color={textColor} style={{ lineHeight: 19 }}>
                  {m.text}
                </Txt>
              </View>
            </View>
          );
        })}
      </View>
      <Txt w="m" size={11} color={c.textTertiary} style={{ marginTop: 12, lineHeight: 15 }}>
        {medicalDisclaimer()}
      </Txt>
      <Row style={{ gap: 8, marginTop: 14 }}>
        <TextInput
          value={chatDraft}
          onChangeText={setChatDraft}
          placeholder="Add a note for your coach…"
          placeholderTextColor={c.textTertiary}
          style={{ flex: 1, height: 46, borderRadius: 13, backgroundColor: c.bg, paddingHorizontal: 14, fontFamily: font.m, fontSize: 14, color: c.text }}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send message" onPress={sendChat} style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="send" size={18} color={c.white} />
        </Pressable>
      </Row>
    </Card>
  );
}

function Tile({ value, label, color }: { value: string; label: string; color?: string }) {
  const c = useColors();
  return (
    <View style={[{ flex: 1, backgroundColor: c.card, borderRadius: 16, padding: 13 }, shadow.card]}>
      <Txt w="eb" num size={20} color={color}>
        {value}
      </Txt>
      <Txt w="b" size={10} color={c.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
    </View>
  );
}

function Step({ glyph, label, onPress }: { glyph: string; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 9, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Txt w="b" size={17} color={c.slate600}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
