// OnStandard — Coach Plan editor. Sets the plan BOTH engines read (Accountability +
// Nutrition): macro targets, the expected meal-window schedule, and standing coach
// instructions. Local today; syncs to the linked athlete when the backend lands.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { activePlan, avoidFoodsFromFacts, formatWindowTime, isMinor } from '@/core';
import type { EngineGoal, MealKey, PlanSlot } from '@/core';
import { useStore } from '@/store';
import { generatePlan } from '@/lib/ai/planGenerate';
import { fetchMemoryFacts } from '@/lib/ai/memory';
import { isMealPlansEnabled } from '@/lib/features';
import { font, shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Btn, Card, Reveal, Row, Txt, Pressable, Toggle } from '@/ui/primitives';
import { Icon, IconName } from '@/icons';
import { Overlay } from './Overlay';

const SUGGESTIONS = ['Pre-bed protein shake', 'No sugary drinks', 'Protein with every meal', 'Log each meal within 30 min'];

const SLOT_LABEL: Record<MealKey, string> = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };

/** BaseGoal -> EngineGoal for the plan split: 'performance' rides 'maintain' (no dedicated split). */
function planGoalFor(baseGoal: 'gain' | 'lose' | 'maintain' | 'performance'): EngineGoal {
  return baseGoal === 'performance' ? 'maintain' : baseGoal;
}

export function CoachPlanEditor() {
  const c = useColors();
  const s = useStore();
  const plan = activePlan(s);
  const [draft, setDraft] = React.useState('');
  const [generating, setGenerating] = React.useState(false);

  const add = (text: string) => {
    s.addPlanInstruction(text);
    setDraft('');
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const goal = planGoalFor(s.baseGoal);
      // The draft passes the deterministic safety gate: age drives the calorie
      // floor; confirmed allergies/dislikes are excluded (model told + enforced).
      const avoid = avoidFoodsFromFacts(await fetchMemoryFacts('active').catch(() => []));
      const result = await generatePlan({ plan: activePlan(s), goal, isMinor: isMinor(s.baseAge), avoid });
      s.setPlanSlots(result);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Overlay title="Coach Plan" onClose={s.closePlanEditor}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Txt w="m" size={14} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 20 }}>
          The plan the athlete is held to. Every meal and the Execution Score are measured against this.
        </Txt>

        {/* targets */}
        <Reveal index={0}>
        <Card variant="low" style={{ marginTop: 18, borderRadius: 22, padding: 18 }}>
          <SectionHead icon="bolt" eyebrow="DAILY TARGETS" title="What they're held to" />
          <View style={{ marginTop: 16 }}>
            <TargetRow label="Protein" value={`${plan.proteinTarget} g`} onDown={() => s.adjustProteinTarget(-5)} onUp={() => s.adjustProteinTarget(5)} />
            <TargetRow label="Calories" value={`${plan.calorieTarget}`} onDown={() => s.adjustCalTarget(-50)} onUp={() => s.adjustCalTarget(50)} last />
          </View>
        </Card>
        </Reveal>

        {/* meal windows */}
        <Reveal index={1}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 22, padding: 18 }}>
          <SectionHead icon="checkin" eyebrow="MEAL WINDOWS" title="When each meal is due" />
          <View style={{ gap: 10, marginTop: 16 }}>
            {plan.windows.map((w) => (
              <Row key={w.key} style={{ justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 }}>
                <Row style={{ gap: 8, alignItems: 'center' }}>
                  <Txt w="b" size={14}>
                    {w.label}
                  </Txt>
                  {w.required ? null : (
                    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: c.bg2 }}>
                      <Txt w="b" size={10} color={c.textTertiary}>
                        OPTIONAL
                      </Txt>
                    </View>
                  )}
                </Row>
                <Txt w="sb" num size={13} color={c.slate700}>
                  {formatWindowTime(w.openMin)} – {formatWindowTime(w.deadlineMin)}
                </Txt>
              </Row>
            ))}
          </View>
          <Txt w="m" size={11} color={c.textTertiary} style={{ marginTop: 12, lineHeight: 16 }}>
            Custom window times arrive with the coach backend; these are the default schedule.
          </Txt>
        </Card>
        </Reveal>

        {/* standing instructions */}
        <Reveal index={2}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 22, padding: 18 }}>
          <SectionHead icon="shield" eyebrow="STANDING INSTRUCTIONS" title="Rules they see every day" />

          <View style={{ gap: 8, marginTop: 16 }}>
            {s.planInstructions.map((ins, i) => (
              <Row key={ins} style={{ justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 13, paddingVertical: 11, paddingHorizontal: 13 }}>
                <Row style={{ gap: 10, alignItems: 'center', flex: 1 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={13} color={c.accent} />
                  </View>
                  <Txt w="b" size={14} color={c.slate700} style={{ flex: 1 }}>
                    {ins}
                  </Txt>
                </Row>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${ins}`} hitSlop={8} onPress={() => s.removePlanInstruction(i)} style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                  <Icon name="close" size={14} color={c.textTertiary} />
                </Pressable>
              </Row>
            ))}
            {s.planInstructions.length === 0 ? (
              <Txt w="m" size={13} color={c.textTertiary} style={{ lineHeight: 18 }}>
                No standing instructions yet. Add one below or tap a suggestion.
              </Txt>
            ) : null}
          </View>

          <Row style={{ gap: 8, marginTop: 12 }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add an instruction…"
              placeholderTextColor={c.textTertiary}
              accessibilityLabel="New instruction"
              onSubmitEditing={() => add(draft)}
              style={{ flex: 1, height: 46, borderRadius: 13, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 14, fontFamily: font.m, fontSize: 14, color: c.text }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Add instruction" onPress={() => add(draft)} disabled={draft.trim().length === 0} style={[{ width: 46, height: 46, borderRadius: 13, backgroundColor: draft.trim() ? c.accent : c.surface2, borderWidth: draft.trim() ? 0 : 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center' }, draft.trim() ? shadow.cta : null]}>
              <Icon name="plus" size={18} color={draft.trim() ? c.white : c.textTertiary} />
            </Pressable>
          </Row>

          <Row style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {SUGGESTIONS.filter((sug) => !s.planInstructions.includes(sug)).map((sug) => (
              <Pressable key={sug} accessibilityRole="button" accessibilityLabel={`Add ${sug}`} onPress={() => add(sug)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 11, borderWidth: 1, borderColor: c.accentBorder, backgroundColor: c.accentSurface, opacity: pressed ? 0.7 : 1 })}>
                <Icon name="plus" size={12} color={c.accent} />
                <Txt w="b" size={12} color={c.accent}>
                  {sug}
                </Txt>
              </Pressable>
            ))}
          </Row>
        </Card>
        </Reveal>

        {/* prescribed meals */}
        {isMealPlansEnabled ? (
        <Reveal index={3}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 22, padding: 18 }}>
          <SectionHead icon="sparkle" eyebrow="PRESCRIBED MEALS" title="Pin the plate, or leave it open" />
          <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 12, marginBottom: 14, lineHeight: 18 }}>
            Generate a starting plan, then pin exact meals or leave a window open to the macros.
          </Txt>

          <Btn
            label={generating ? 'Generating…' : 'Generate plan'}
            loading={generating}
            onPress={generate}
            variant="secondary"
          />

          {s.planSlots.length > 0 ? (
            <View style={{ gap: 10, marginTop: 14 }}>
              {s.planSlots.map((slot) => (
                <SlotRow key={slot.key} slot={slot} onToggleMode={() => s.togglePlanSlotMode(slot.key)} onTogglePhoto={() => s.updatePlanSlot(slot.key, { photoRequired: !slot.photoRequired })} onNoteChange={(note) => s.updatePlanSlot(slot.key, { note })} />
              ))}
            </View>
          ) : (
            <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 4, lineHeight: 18 }}>
              No prescribed meals yet. Tap Generate plan to seed one for each window.
            </Txt>
          )}
        </Card>
        </Reveal>
        ) : null}

        <Btn label="Done" haptic="success" onPress={s.closePlanEditor} style={{ marginTop: 18 }} />
      </ScrollView>
    </Overlay>
  );
}

/** Section header: accent icon-tile + eyebrow + title — the app's card-header idiom. */
function SectionHead({ icon, eyebrow, title }: { icon: IconName; eyebrow: string; title: string }) {
  const c = useColors();
  return (
    <Row style={{ gap: 12, alignItems: 'center' }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={c.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.6}>
          {eyebrow}
        </Txt>
        <Txt w="eb" size={15} ls={-0.3} style={{ marginTop: 2 }}>
          {title}
        </Txt>
      </View>
    </Row>
  );
}

function TargetRow({ label, value, onDown, onUp, last }: { label: string; value: string; onDown: () => void; onUp: () => void; last?: boolean }) {
  const c = useColors();
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, marginBottom: last ? 0 : 10 }}>
      <Txt w="b" size={14}>
        {label}
      </Txt>
      <Row style={{ gap: 12, alignItems: 'center' }}>
        <Step glyph="−" label={`Lower ${label}`} onPress={onDown} />
        <Txt w="eb" num size={15} style={{ minWidth: 64, textAlign: 'center' }}>
          {value}
        </Txt>
        <Step glyph="+" label={`Raise ${label}`} onPress={onUp} />
      </Row>
    </Row>
  );
}

function Step({ glyph, label, onPress }: { glyph: string; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 11, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Txt w="b" size={18} color={c.accent}>
        {glyph}
      </Txt>
    </Pressable>
  );
}

function SlotRow({
  slot,
  onToggleMode,
  onTogglePhoto,
  onNoteChange,
}: {
  slot: PlanSlot;
  onToggleMode: () => void;
  onTogglePhoto: () => void;
  onNoteChange: (note: string) => void;
}) {
  const c = useColors();
  const label = SLOT_LABEL[slot.key];
  const names = slot.mode === 'pinned' ? (slot.pinnedMeal ? [slot.pinnedMeal.name] : []) : slot.options.map((o) => o.name);
  const pinned = slot.mode === 'pinned';

  return (
    <View style={{ backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 16, padding: 14 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Row style={{ gap: 9, alignItems: 'center' }}>
          <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="utensils" size={14} color={c.accent} />
          </View>
          <Txt w="eb" size={14}>
            {label}
          </Txt>
        </Row>
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline }}>
          <Txt w="b" num size={12} color={c.slate700}>
            {slot.macros.protein}g · {slot.macros.kcal} cal
          </Txt>
        </View>
      </Row>

      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.hairline }}>
        <Row style={{ gap: 8, alignItems: 'center', flex: 1, paddingRight: 12 }}>
          <Icon name={pinned ? 'shield' : 'utensils'} size={14} color={pinned ? c.accent : c.textTertiary} />
          <Txt w="b" size={12} color={pinned ? c.accent : c.textTertiary}>
            {pinned ? 'Pinned meal' : 'Open — pick from options'}
          </Txt>
        </Row>
        <Toggle on={pinned} onPress={onToggleMode} label={`${label} pinned`} />
      </Row>

      {names.length > 0 ? (
        <View style={{ marginTop: 10, gap: 4 }}>
          {names.map((n) => (
            <Row key={n} style={{ gap: 8, alignItems: 'center' }}>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.accent }} />
              <Txt w="m" size={13} color={c.slate700} style={{ flex: 1 }}>
                {n}
              </Txt>
            </Row>
          ))}
        </View>
      ) : (
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 10 }}>
          {pinned ? 'No meal pinned yet.' : 'No options yet.'}
        </Txt>
      )}

      {slot.restaurantAlts.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          <Txt w="eb" size={10} color={c.textTertiary} ls={0.4} upper>
            Traveling?
          </Txt>
          <View style={{ marginTop: 4, gap: 4 }}>
            {slot.restaurantAlts.map((alt) => (
              <Row key={alt.name} style={{ gap: 8, alignItems: 'center' }}>
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.textTertiary }} />
                <Txt w="m" size={13} color={c.slate700} style={{ flex: 1 }}>
                  {alt.name}
                </Txt>
              </Row>
            ))}
          </View>
        </View>
      ) : null}

      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.hairline }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="camera" size={14} color={c.textTertiary} />
          <Txt w="b" size={12} color={c.textTertiary}>
            Photo required
          </Txt>
        </Row>
        <Toggle on={slot.photoRequired} onPress={onTogglePhoto} label={`${label} photo required`} />
      </Row>

      <TextInput
        value={slot.note ?? ''}
        onChangeText={onNoteChange}
        placeholder="Note for this meal…"
        placeholderTextColor={c.textTertiary}
        accessibilityLabel={`${label} note`}
        style={{ marginTop: 12, height: 42, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 12, fontFamily: font.m, fontSize: 13, color: c.text }}
      />
    </View>
  );
}
