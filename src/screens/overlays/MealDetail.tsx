// AthleteOS — Meal Detail: hero, macros, foods, quality breakdown, 3-way chat.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { MEALS_LOG } from '@/core';
import type { LoggedMeal } from '@/core';
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
              {meal.quality}
            </Txt>
            <Txt w="eb" size={10} color={colors.textTertiary}>
              QUALITY
            </Txt>
          </View>
        </Row>

        <Row style={{ gap: 8, marginTop: 16 }}>
          <Tile value={`${meal.protein}g`} label="PROTEIN" color={colors.accent} />
          <Tile value={`${meal.kcal}`} label="CALORIES" />
          <Tile value={`${meal.carbs}g`} label="CARBS" />
          <Tile value={`${meal.fat}g`} label="FAT" />
        </Row>

        <Card style={{ marginTop: 14, borderRadius: 20 }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <Txt w="eb" size={15} ls={-0.3}>
              Foods
            </Txt>
            <Txt w="b" size={13} color={colors.accent}>
              Re-analyze
            </Txt>
          </Row>
          <View style={{ gap: 14 }}>
            {meal.foods.map((f) => (
              <Row key={f.n} style={{ gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Txt w="b" size={14}>
                    {f.n}
                  </Txt>
                  <Txt w="m" size={12} color={colors.textTertiary}>
                    {f.p}
                  </Txt>
                </View>
                <Row style={{ gap: 10 }}>
                  <Step glyph="−" />
                  <Step glyph="+" />
                </Row>
              </Row>
            ))}
          </View>
        </Card>

        <Card style={{ marginTop: 14, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 16 }}>
            Quality Breakdown
          </Txt>
          <View style={{ gap: 13 }}>
            {meal.sub.map((x) => (
              <Row key={x.l} style={{ gap: 12 }}>
                <Txt w="sb" size={13} style={{ width: 118 }}>
                  {x.l}
                </Txt>
                <View style={{ flex: 1 }}>
                  <ProgressBar pct={x.s} height={7} color={x.s >= 90 ? colors.success : colors.accent} />
                </View>
                <Txt w="eb" size={13} style={{ width: 26, textAlign: 'right' }}>
                  {x.s}
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
        <Pressable onPress={sendChat} style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
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

function Step({ glyph }: { glyph: string }) {
  return (
    <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
      <Txt w="b" size={17} color={colors.slate600}>
        {glyph}
      </Txt>
    </View>
  );
}
