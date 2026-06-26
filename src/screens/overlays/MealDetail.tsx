// AthleteOS — Meal Detail: hero, macros, foods, quality breakdown, 3-way chat.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { MEALS_LOG, macroComposition, mealMacros, mealQuality, stepServings, toEditableFoods, searchFoods, addFood, removeFood } from '@/core';
import type { EditableFood, LoggedMeal, FoodItem } from '@/core';
import { useStore } from '@/store';
import { colors, font, shadow } from '@/ui/tokens';
import { Btn, Card, ProgressBar, Row, Txt, Pressable } from '@/ui/primitives';
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

export function MealDetail() {
  const s = useStore();
  const meal = MEALS_LOG.find((m) => m.id === s.selectedMeal) ?? DINNER;

  // Editable estimate: each food carries a numeric share of the meal, so adjusting
  // a portion recomputes macros + quality + composition live (the persona fix for
  // the dead steppers). Re-seed when the opened meal changes.
  const [foods, setFoods] = React.useState<EditableFood[]>(() => toEditableFoods(meal));
  React.useEffect(() => { setFoods(toEditableFoods(meal)); }, [s.selectedMeal]); // eslint-disable-line react-hooks/exhaustive-deps
  const macros = mealMacros(foods);
  const quality = mealQuality(macros);
  const comp = macroComposition(macros);
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
        <View style={[{ width: '100%', height: 150, borderRadius: 20, backgroundColor: meal.thumb[1] }, shadow.card]} />

        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 16 }}>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={20} ls={-0.3}>
              {meal.name}
            </Txt>
            <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 3 }}>
              {meal.time}
            </Txt>
          </View>
          <View style={{ alignItems: 'center', marginLeft: 14 }}>
            <Txt w="eb" size={26} color={colors.successDeep} ls={-0.5}>
              {quality}
            </Txt>
            <Txt w="eb" size={10} color={colors.textTertiary}>
              QUALITY
            </Txt>
          </View>
        </Row>

        <Row style={{ gap: 8, marginTop: 16 }}>
          <Tile value={`~${macros.protein}g`} label="PROTEIN" color={colors.accent} />
          <Tile value={`~${macros.kcal}`} label="CALORIES" />
          <Tile value={`~${macros.carbs}g`} label="CARBS" />
          <Tile value={`~${macros.fat}g`} label="FAT" />
        </Row>
        <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 10, lineHeight: 17 }}>
          {edited
            ? 'Updated from your portions. This is an adjustable estimate, not a weighed value.'
            : 'Estimated from your meal photo, not weighed. Adjust any portion below to correct it.'}
        </Txt>

        <Card style={{ marginTop: 14, borderRadius: 20 }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <Txt w="eb" size={15} ls={-0.3}>
              Foods
            </Txt>
            <Txt w="b" size={12} color={colors.textTertiary}>
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
                  <Txt w="m" size={12} color={colors.textTertiary}>
                    {f.portion}
                    {f.servings !== 1 ? `  ·  ×${f.servings}` : ''}
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
                    <Icon name="close" size={13} color={colors.textTertiary} />
                  </Pressable>
                </Row>
              </Row>
            ))}
            {foods.length === 0 ? (
              <Txt w="m" size={13} color={colors.textTertiary} style={{ lineHeight: 18 }}>
                No foods yet. Search below to add one.
              </Txt>
            ) : null}
          </View>

          <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: colors.bg2, paddingTop: 14 }}>
            <Txt w="eb" size={13} ls={-0.2} style={{ marginBottom: 8 }}>
              Add a food
            </Txt>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search foods (chicken, rice, banana…)"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Search foods to add"
              autoCorrect={false}
              style={{ height: 44, borderRadius: 13, backgroundColor: colors.bg, paddingHorizontal: 14, fontFamily: font.m, fontSize: 14, color: colors.text }}
            />
            {results.length > 0 ? (
              <View style={{ gap: 8, marginTop: 10 }}>
                {results.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${r.name}, ${r.serving}`}
                    onPress={() => onAdd(r)}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.bg, opacity: pressed ? 0.6 : 1 })}
                  >
                    <View style={{ flex: 1 }}>
                      <Txt w="b" size={13}>
                        {r.name}
                      </Txt>
                      <Txt w="m" size={11} color={colors.textTertiary} style={{ marginTop: 2 }}>
                        {r.serving} · {r.per.protein}g protein · {r.per.kcal} kcal
                      </Txt>
                    </View>
                    <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="plus" size={14} color={colors.accent} />
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : query.trim().length > 0 ? (
              <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 10 }}>
                No match in the food list. A fuller database lands with the backend.
              </Txt>
            ) : null}
          </View>
        </Card>

        <Card style={{ marginTop: 14, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 4 }}>
            Calorie composition
          </Txt>
          <Txt w="m" size={12} color={colors.textTertiary} style={{ marginBottom: 16, lineHeight: 17 }}>
            Where this meal's calories come from, recalculated from your portions.
          </Txt>
          <View style={{ gap: 13 }}>
            {comp.map((x) => (
              <Row key={x.label} style={{ gap: 12 }}>
                <Txt w="sb" size={13} style={{ width: 78 }}>
                  {x.label}
                </Txt>
                <View style={{ flex: 1 }}>
                  <ProgressBar pct={x.pct} height={7} color={x.label === 'Protein' ? colors.accent : colors.success} />
                </View>
                <Txt w="eb" size={13} style={{ width: 38, textAlign: 'right' }}>
                  {x.pct}%
                </Txt>
              </Row>
            ))}
          </View>
        </Card>

        <View style={{ marginTop: 14, borderRadius: 18, padding: 18, backgroundColor: colors.accentSurface, borderWidth: 1, borderColor: colors.accentBorder, flexDirection: 'row', gap: 13 }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={17} color={colors.accent} />
          </View>
          <Txt w="m" size={14} color={colors.slate700} style={{ flex: 1, lineHeight: 20 }}>
            <Txt w="b" size={14} color={colors.accent}>
              Coach AI ·{' '}
            </Txt>
            {meal.note}
          </Txt>
        </View>

        <Chat />

        <Btn label="Save Changes" onPress={s.closeMealDetail} style={{ marginTop: 18 }} />
      </ScrollView>
    </Overlay>
  );
}

function Chat() {
  const mealChat = useStore((s) => s.mealChat);
  const chatDraft = useStore((s) => s.chatDraft);
  const setChatDraft = useStore((s) => s.setChatDraft);
  const sendChat = useStore((s) => s.sendChat);

  const nameFor = (who: string) => (who === 'ai' ? 'Coach AI' : who === 'coach' ? 'Coach Davis' : 'You');
  const isMe = (who: string) => who === 'athlete';

  return (
    <Card style={{ marginTop: 14, borderRadius: 20 }}>
      <Row style={{ gap: 8, marginBottom: 14 }}>
        <Txt w="eb" size={15} ls={-0.3}>
          Discuss this meal
        </Txt>
        <View style={{ backgroundColor: colors.accentSurface, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
          <Txt w="b" size={10} color={colors.accent}>
            YOU · AI · COACH
          </Txt>
        </View>
      </Row>
      <View style={{ gap: 12 }}>
        {mealChat.map((m, i) => {
          const me = isMe(m.who);
          const bubbleBg = m.who === 'athlete' ? colors.accent : m.who === 'coach' ? colors.text : '#fff';
          const textColor = m.who === 'ai' ? colors.slate700 : '#fff';
          return (
            <View key={i} style={{ alignItems: me ? 'flex-end' : 'flex-start', gap: 4 }}>
              <Txt w="eb" size={10} color={colors.textTertiary}>
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
      <Row style={{ gap: 8, marginTop: 14 }}>
        <TextInput
          value={chatDraft}
          onChangeText={setChatDraft}
          placeholder="Add a note for your coach…"
          placeholderTextColor={colors.textTertiary}
          style={{ flex: 1, height: 46, borderRadius: 13, backgroundColor: colors.bg, paddingHorizontal: 14, fontFamily: font.m, fontSize: 14, color: colors.text }}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send message" onPress={sendChat} style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="send" size={18} color="#fff" />
        </Pressable>
      </Row>
    </Card>
  );
}

function Tile({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={[{ flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 13 }, shadow.card]}>
      <Txt w="eb" size={20} color={color}>
        {value}
      </Txt>
      <Txt w="b" size={10} color={colors.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
    </View>
  );
}

function Step({ glyph, label, onPress }: { glyph: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 9, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Txt w="b" size={17} color={colors.slate600}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
