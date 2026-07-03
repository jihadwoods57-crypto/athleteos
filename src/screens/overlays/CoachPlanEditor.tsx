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
import { font } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Btn, Card, Reveal, Row, Txt, Pressable, Toggle } from '@/ui/primitives';
import { Icon } from '@/icons';
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
        <Card variant="low" style={{ marginTop: 16, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 12 }}>
            Daily targets
          </Txt>
          <TargetRow label="Protein" value={`${plan.proteinTarget} g`} onDown={() => s.adjustProteinTarget(-5)} onUp={() => s.adjustProteinTarget(5)} />
          <TargetRow label="Calories" value={`${plan.calorieTarget}`} onDown={() => s.adjustCalTarget(-50)} onUp={() => s.adjustCalTarget(50)} last />
        </Card>
        </Reveal>

        {/* meal windows */}
        <Reveal index={1}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 12 }}>
            Meal windows
          </Txt>
          <View style={{ gap: 10 }}>
            {plan.windows.map((w) => (
              <Row key={w.key} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
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
                <Txt w="m" size={13} color={c.textSecondary}>
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
        <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 4 }}>
            Standing instructions
          </Txt>
          <Txt w="m" size={13} color={c.textTertiary} style={{ marginBottom: 12, lineHeight: 18 }}>
            Coaching rules the athlete sees every day.
          </Txt>

          <View style={{ gap: 8 }}>
            {s.planInstructions.map((ins, i) => (
              <Row key={ins} style={{ justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.bg, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13 }}>
                <Row style={{ gap: 9, alignItems: 'center', flex: 1 }}>
                  <Icon name="check" size={14} color={c.accent} />
                  <Txt w="b" size={14} color={c.slate700} style={{ flex: 1 }}>
                    {ins}
                  </Txt>
                </Row>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${ins}`} hitSlop={8} onPress={() => s.removePlanInstruction(i)}>
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
              style={{ flex: 1, height: 46, borderRadius: 13, backgroundColor: c.bg, paddingHorizontal: 14, fontFamily: font.m, fontSize: 14, color: c.text }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Add instruction" onPress={() => add(draft)} disabled={draft.trim().length === 0} style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: draft.trim() ? c.accent : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" size={18} color={draft.trim() ? c.white : c.textTertiary} />
            </Pressable>
          </Row>

          <Row style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {SUGGESTIONS.filter((sug) => !s.planInstructions.includes(sug)).map((sug) => (
              <Pressable key={sug} accessibilityRole="button" accessibilityLabel={`Add ${sug}`} onPress={() => add(sug)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 11, borderWidth: 1, borderColor: c.accentBorder, backgroundColor: c.accentSurface }}>
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
        <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Txt w="eb" size={15} ls={-0.3}>
              Prescribed meals
            </Txt>
            <Icon name="sparkle" size={16} color={c.accent} />
          </Row>
          <Txt w="m" size={13} color={c.textTertiary} style={{ marginBottom: 12, lineHeight: 18 }}>
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

function TargetRow({ label, value, onDown, onUp, last }: { label: string; value: string; onDown: () => void; onUp: () => void; last?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, marginBottom: last ? 0 : 6 }}>
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
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 11, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Txt w="b" size={18} color={c.slate600}>
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

  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 14, padding: 13 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt w="eb" size={14}>
          {label}
        </Txt>
        <Txt w="m" size={12} color={c.textSecondary}>
          {slot.macros.protein}g · {slot.macros.kcal} cal
        </Txt>
      </Row>

      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <Txt w="b" size={12} color={c.textTertiary}>
          {slot.mode === 'pinned' ? 'Pinned meal' : 'Open — pick from options'}
        </Txt>
        <Toggle on={slot.mode === 'pinned'} onPress={onToggleMode} label={`${label} pinned`} />
      </Row>

      {names.length > 0 ? (
        <View style={{ marginTop: 8, gap: 3 }}>
          {names.map((n) => (
            <Txt key={n} w="m" size={13} color={c.slate700}>
              {n}
            </Txt>
          ))}
        </View>
      ) : (
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 8 }}>
          {slot.mode === 'pinned' ? 'No meal pinned yet.' : 'No options yet.'}
        </Txt>
      )}

      {slot.restaurantAlts.length > 0 ? (
        <View style={{ marginTop: 10 }}>
          <Txt w="eb" size={10} color={c.textTertiary} ls={0.4} upper>
            Traveling?
          </Txt>
          <View style={{ marginTop: 3, gap: 3 }}>
            {slot.restaurantAlts.map((alt) => (
              <Txt key={alt.name} w="m" size={13} color={c.slate700}>
                {alt.name}
              </Txt>
            ))}
          </View>
        </View>
      ) : null}

      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <Txt w="b" size={12} color={c.textTertiary}>
          Photo required
        </Txt>
        <Toggle on={slot.photoRequired} onPress={onTogglePhoto} label={`${label} photo required`} />
      </Row>

      <TextInput
        value={slot.note ?? ''}
        onChangeText={onNoteChange}
        placeholder="Note for this meal…"
        placeholderTextColor={c.textTertiary}
        accessibilityLabel={`${label} note`}
        style={{ marginTop: 10, height: 42, borderRadius: 11, backgroundColor: c.card, paddingHorizontal: 12, fontFamily: font.m, fontSize: 13, color: c.text }}
      />
    </View>
  );
}
