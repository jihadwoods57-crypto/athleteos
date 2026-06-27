// AthleteOS — Coach Plan editor. Sets the plan BOTH engines read (Accountability +
// Nutrition): macro targets, the expected meal-window schedule, and standing coach
// instructions. Local today; syncs to the linked athlete when the backend lands.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { activePlan, formatWindowTime } from '@/core';
import { useStore } from '@/store';
import { colors, font } from '@/ui/tokens';
import { Btn, Card, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

const SUGGESTIONS = ['Pre-bed protein shake', 'No sugary drinks', 'Protein with every meal', 'Log each meal within 30 min'];

export function CoachPlanEditor() {
  const s = useStore();
  const plan = activePlan(s);
  const [draft, setDraft] = React.useState('');

  const add = (text: string) => {
    s.addPlanInstruction(text);
    setDraft('');
  };

  return (
    <Overlay title="Coach Plan" onClose={s.closePlanEditor}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Txt w="m" size={14} color={colors.textSecondary} style={{ marginTop: 4, lineHeight: 20 }}>
          The plan the athlete is held to. Every meal and the Development Score are measured against this.
        </Txt>

        {/* targets */}
        <Card elevated style={{ marginTop: 16, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 12 }}>
            Daily targets
          </Txt>
          <TargetRow label="Protein" value={`${plan.proteinTarget} g`} onDown={() => s.adjustProteinTarget(-5)} onUp={() => s.adjustProteinTarget(5)} />
          <TargetRow label="Calories" value={`${plan.calorieTarget}`} onDown={() => s.adjustCalTarget(-50)} onUp={() => s.adjustCalTarget(50)} last />
        </Card>

        {/* meal windows */}
        <Card elevated style={{ marginTop: 14, borderRadius: 20 }}>
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
                    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.bg2 }}>
                      <Txt w="b" size={10} color={colors.textTertiary}>
                        OPTIONAL
                      </Txt>
                    </View>
                  )}
                </Row>
                <Txt w="m" size={13} color={colors.textSecondary}>
                  {formatWindowTime(w.openMin)} – {formatWindowTime(w.deadlineMin)}
                </Txt>
              </Row>
            ))}
          </View>
          <Txt w="m" size={11} color={colors.textTertiary} style={{ marginTop: 12, lineHeight: 16 }}>
            Custom window times arrive with the coach backend; these are the default schedule.
          </Txt>
        </Card>

        {/* standing instructions */}
        <Card elevated style={{ marginTop: 14, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 4 }}>
            Standing instructions
          </Txt>
          <Txt w="m" size={13} color={colors.textTertiary} style={{ marginBottom: 12, lineHeight: 18 }}>
            Coaching rules the athlete sees every day.
          </Txt>

          <View style={{ gap: 8 }}>
            {s.planInstructions.map((ins, i) => (
              <Row key={ins} style={{ justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.bg, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13 }}>
                <Row style={{ gap: 9, alignItems: 'center', flex: 1 }}>
                  <Icon name="check" size={14} color={colors.accent} />
                  <Txt w="b" size={14} color={colors.slate700} style={{ flex: 1 }}>
                    {ins}
                  </Txt>
                </Row>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${ins}`} hitSlop={8} onPress={() => s.removePlanInstruction(i)}>
                  <Icon name="close" size={14} color={colors.textTertiary} />
                </Pressable>
              </Row>
            ))}
            {s.planInstructions.length === 0 ? (
              <Txt w="m" size={13} color={colors.textTertiary} style={{ lineHeight: 18 }}>
                No standing instructions yet. Add one below or tap a suggestion.
              </Txt>
            ) : null}
          </View>

          <Row style={{ gap: 8, marginTop: 12 }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add an instruction…"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="New instruction"
              onSubmitEditing={() => add(draft)}
              style={{ flex: 1, height: 46, borderRadius: 13, backgroundColor: colors.bg, paddingHorizontal: 14, fontFamily: font.m, fontSize: 14, color: colors.text }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Add instruction" onPress={() => add(draft)} disabled={draft.trim().length === 0} style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: draft.trim() ? colors.accent : colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" size={18} color={draft.trim() ? '#fff' : colors.textTertiary} />
            </Pressable>
          </Row>

          <Row style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {SUGGESTIONS.filter((sug) => !s.planInstructions.includes(sug)).map((sug) => (
              <Pressable key={sug} accessibilityRole="button" accessibilityLabel={`Add ${sug}`} onPress={() => add(sug)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 11, borderWidth: 1, borderColor: colors.accentBorder, backgroundColor: colors.accentSurface }}>
                <Icon name="plus" size={12} color={colors.accent} />
                <Txt w="b" size={12} color={colors.accent}>
                  {sug}
                </Txt>
              </Pressable>
            ))}
          </Row>
        </Card>

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
        <Txt w="eb" size={15} style={{ minWidth: 64, textAlign: 'center' }}>
          {value}
        </Txt>
        <Step glyph="+" label={`Raise ${label}`} onPress={onUp} />
      </Row>
    </Row>
  );
}

function Step({ glyph, label, onPress }: { glyph: string; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 11, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Txt w="b" size={18} color={colors.slate600}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
