// OnStandard — Meal Detail: photo-hero, macros, foods, quality read, 3-way chat.
// Dark-premium redesign: a media-forward hero with a floating quality RING chip, a
// tier-colored score, dark macro tiles, the editable foods list, a calorie-composition
// card, the plan-note sidebox, the OnStandard AI note card, and the coach/AI/athlete
// thread. Visual port only — every store hook / action (the meal being viewed,
// saveMeal/edit wiring, food search + add/remove, portion steppers, the AI note, the
// comment thread, close) is preserved unchanged.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { MEALS_LOG, macroComposition, mealMacros, mealQuality, stepServings, toEditableFoods, searchFoods, addFood, removeFood, resolvePortion, medicalDisclaimer, activePlan, planMealNote, formatWindowTime, tierFor } from '@/core';
import { isEnginesEnabled } from '@/lib/features';
import { aiCoachName, isAiConfigured } from '@/lib/ai';
import type { EditableFood, LoggedMeal, FoodItem, MealKey } from '@/core';
import { useStore } from '@/store';
import { font, shadow, tierChip, ringGradient, typeScale, MAX_FONT_SCALE } from '@/ui/tokens';
import { Btn, Card, ProgressBar, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { useColors } from '@/ui/theme';
import { Ring } from '@/ui/Ring';
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
  // The codebase-wide honesty gate: a real user (onboarded name) never sees the
  // showcase's canned name/time/note/chat — only what they actually logged.
  const isReal = s.athleteName.trim() !== '';
  const savedPlate = s.mealFoods[mealKey];
  const slotLabel = mealKey.charAt(0).toUpperCase() + mealKey.slice(1);
  const realTitle = savedPlate?.length
    ? savedPlate.length === 1 ? savedPlate[0].name : `${savedPlate[0].name} + ${savedPlate.length - 1} more`
    : slotLabel;
  const title = isReal ? realTitle : meal.name;
  const loggedMin = s.mealLoggedAt[mealKey];
  const timeLabel = isReal ? (typeof loggedMin === 'number' ? `Logged ${formatWindowTime(loggedMin)}` : 'Logged today') : meal.time;
  // The model's actual coaching for this slot — or nothing. Never the canned note.
  const coachNote = isReal ? s.mealNotes[mealKey] ?? null : meal.note;

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
  // Score status color: the tier the quality falls in (Off / Building / Locked In /
  // OnStandard) drives the number + chip — never a fixed green — so the read matches Home.
  const tier = tierFor(quality);
  const chip = tierChip[tier.short];
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
        {/* HERO — a dark meal-media block (a viewfinder-dark surface, not a flat light
            swatch), with the decorative brand-hue gradient bar as an accent and the live
            quality RING chip floating top-right. The status lives in the ring + tier chip,
            never a red/green block. (`meal.thumb` is a decorative brand-hex pair; it reads
            fine as a thin accent on the dark surface.) */}
        <Reveal index={0}>
          <Card variant="hero" style={{ marginTop: 4, borderRadius: 24, padding: 0, overflow: 'hidden' }}>
            <View style={{ height: 150, backgroundColor: c.surface2 }}>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="utensils" size={34} color={c.textTertiary} />
              </View>
              {/* decorative brand-hue accent bar along the base */}
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: meal.thumb[1], opacity: 0.9 }} />
              {/* quality ring chip, floating on the hero */}
              <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(5,8,15,0.72)' }}>
                <Ring size={34} pct={quality} stroke={20} gradient={ringGradient} track="rgba(255,255,255,0.14)">
                  <Txt w="eb" num size={12} color={c.white} maxFontSizeMultiplier={MAX_FONT_SCALE}>{quality}</Txt>
                </Ring>
                <Txt w="eb" size={11} color={c.white} ls={0.4}>QUALITY</Txt>
              </View>
            </View>
          </Card>
        </Reveal>

        {/* meta line — meal name + time on the left; the tier-colored score chip on the right */}
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 16 }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Txt w="eb" size={20} ls={-0.3}>
              {title}
            </Txt>
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }}>
              {timeLabel}
            </Txt>
          </View>
          <View style={{ alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border }}>
            <Txt w="eb" num size={24} color={chip.fg} ls={-0.5} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {quality}
            </Txt>
            <Txt w="eb" size={10} color={chip.fg} ls={0.3} style={{ opacity: 0.85 }}>
              {tier.name.toUpperCase()}
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

          <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: c.hairline, paddingTop: 14 }}>
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
              style={{ height: 44, borderRadius: 13, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 14, fontFamily: font.m, fontSize: 14, color: c.text }}
            />
            {results.length > 0 ? (
              <View style={{ gap: 8, marginTop: 10 }}>
                {results.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${r.name}, ${r.serving}`}
                    onPress={() => onAdd(r)}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, opacity: pressed ? 0.6 : 1 })}
                  >
                    <View style={{ flex: 1 }}>
                      <Txt w="b" size={13}>
                        {r.name}
                      </Txt>
                      <Txt w="m" size={11} color={c.textTertiary} style={{ marginTop: 2 }}>
                        {r.serving} · {r.per.protein}g protein · {r.per.kcal} kcal
                      </Txt>
                    </View>
                    <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
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

        {/* The coach-voice note: the model's REAL analysis note when one exists; the
            showcase keeps its canned note; a real user with no AI note gets nothing —
            we never fabricate coaching over a plate the model didn't see. */}
        {coachNote ? (
          <Reveal index={3}>
          <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, flexDirection: 'row', gap: 13 }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={17} color={c.accent} />
            </View>
            <Txt w="m" size={14} color={c.slate700} style={{ flex: 1, lineHeight: 20 }}>
              <Txt w="b" size={14} color={c.accent}>
                {aiCoachName} ·{' '}
              </Txt>
              {coachNote}
            </Txt>
          </View>
          </Reveal>
        ) : null}

        {/* Accountability Engine — how this meal measures against the athlete's plan.
            Gated by the engines master switch (OFF for the prove-the-loop beta). */}
        {isEnginesEnabled ? (
          <View style={{ marginTop: 12, borderRadius: 20, padding: 16, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, flexDirection: 'row', gap: 12 }}>
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

        {/* The 3-way chat is showcase-only: it renders a seeded "Coach Davis" thread and a
            composer whose messages are never delivered. A real user never sees a fabricated
            coach conversation — the card is hidden until real messaging ships. */}
        {isReal ? null : <Chat />}

        {/* learn=true: this is the genuine plate-correction site, so a removed food can teach a
            (confirmed) dislike — the write half of the AI memory flywheel. */}
        <Btn label="Save Changes" onPress={() => s.saveMeal(mealKey, foods, true)} style={{ marginTop: 18 }} />
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
        <View style={{ backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
          <Txt w="b" size={10} color={c.accent}>
            {isAiConfigured ? 'YOU · AI · COACH' : 'YOU · COACH'}
          </Txt>
        </View>
      </Row>
      <View style={{ gap: 12 }}>
        {mealChat.map((m, i) => {
          const me = isMe(m.who);
          // Dark bubbles: my messages ride the accent; the coach gets an elevated slate
          // surface; the AI a plain card — each legible on the dark canvas (never the old
          // near-white `c.text` bubble that hid its white text on dark).
          const bubbleBg = m.who === 'athlete' ? c.accent : m.who === 'coach' ? c.surface3 : c.card;
          const textColor = m.who === 'athlete' ? c.white : c.slate700;
          return (
            <View key={i} style={{ alignItems: me ? 'flex-end' : 'flex-start', gap: 4 }}>
              <Txt w="eb" size={10} color={c.textTertiary}>
                {nameFor(m.who)}
              </Txt>
              <View style={[{ maxWidth: '84%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16, backgroundColor: bubbleBg }, m.who === 'ai' ? { borderWidth: 1, borderColor: c.hairline } : undefined]}>
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
          style={{ flex: 1, height: 46, borderRadius: 13, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 14, fontFamily: font.m, fontSize: 14, color: c.text }}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send message" onPress={sendChat} style={[{ width: 46, height: 46, borderRadius: 13, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }, shadow.cta]}>
          <Icon name="send" size={18} color={c.white} />
        </Pressable>
      </Row>
    </Card>
  );
}

function Tile({ value, label, color }: { value: string; label: string; color?: string }) {
  const c = useColors();
  return (
    <View style={[{ flex: 1, backgroundColor: c.card, borderRadius: 16, padding: 13, borderWidth: 1, borderColor: c.hairline }, shadow.card]}>
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
      style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 9, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Txt w="b" size={17} color={c.slate600}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
