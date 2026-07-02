// OnStandard — Bulk assign (Wave 2). Generate ONE meal plan and assign it to many clients at
// once; each client gets an independent copy the coach can tweak afterward from PersonDetail.
// Local-first (writes athletePlans); the backend seam syncs on save when live. Gated by
// isMealPlansEnabled at the mount points.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { activePlan, athleteKey, type EngineGoal, type PlanSlot } from '@/core';
import { generatePlan } from '@/lib/ai/planGenerate';
import { isMealPlanSyncConfigured, saveMealPlan, assignPlan } from '@/lib/mealPlans';
import { useStore } from '@/store';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Btn, Card, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

/** BaseGoal -> EngineGoal for the plan split ('performance' rides 'maintain'). */
function planGoalFor(baseGoal: 'gain' | 'lose' | 'maintain' | 'performance'): EngineGoal {
  return baseGoal === 'performance' ? 'maintain' : baseGoal;
}

export function BulkAssign({ clients }: { clients: { name: string; athleteId?: string }[] }) {
  const c = useColors();
  const s = useStore();
  const [slots, setSlots] = React.useState<PlanSlot[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [generating, setGenerating] = React.useState(false);
  const [assigned, setAssigned] = React.useState(0);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      setSlots(await generatePlan({ plan: activePlan(s), goal: planGoalFor(s.baseGoal) }));
    } finally {
      setGenerating(false);
    }
  };

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const assign = () => {
    const keys = [...selected];
    s.assignPlanToManyAthletes(keys, slots);
    setAssigned(keys.length);
    // Best-effort backend sync (inert unless the backend is live + migration applied). The local
    // athletePlans write above is the source of truth; this only mirrors it upward.
    if (isMealPlanSyncConfigured) {
      const ids = clients.filter((cl) => cl.athleteId && selected.has(athleteKey(cl))).map((cl) => cl.athleteId as string);
      void saveMealPlan({ name: 'Team plan', slots }).then((res) => {
        if (res && ids.length) void assignPlan(res.id, ids);
      });
    }
  };

  const canAssign = slots.length > 0 && selected.size > 0;

  return (
    <Overlay title="Assign a plan" onClose={s.closeBulkAssign}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Txt w="m" size={14} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 20 }}>
          Generate one plan, then assign it to as many clients as you like. Each client gets their own copy you can tweak afterward.
        </Txt>

        {/* step 1 — the plan */}
        <Reveal index={0}>
        <Card variant="low" style={{ marginTop: 16, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 10 }}>
            1 · The plan
          </Txt>
          <Btn
            label={generating ? 'Generating…' : slots.length ? 'Regenerate plan' : 'Generate plan'}
            loading={generating}
            onPress={generate}
            variant="secondary"
          />
          {slots.length > 0 ? (
            <View style={{ gap: 8, marginTop: 12 }}>
              {slots.map((slot) => (
                <Row key={slot.key} style={{ justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.bg, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 13 }}>
                  <Txt w="b" size={14} style={{ textTransform: 'capitalize' }}>
                    {slot.key}
                  </Txt>
                  <Txt w="m" size={12} color={c.textSecondary}>
                    {slot.macros.protein}g · {slot.macros.kcal} cal
                  </Txt>
                </Row>
              ))}
            </View>
          ) : (
            <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 10, lineHeight: 18 }}>
              Tap Generate plan to draft one for every meal window.
            </Txt>
          )}
        </Card>
        </Reveal>

        {/* step 2 — the clients */}
        <Reveal index={1}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Txt w="eb" size={15} ls={-0.3}>
              2 · Assign to
            </Txt>
            <Txt w="b" size={13} color={c.accent}>
              {selected.size} selected
            </Txt>
          </Row>
          <View style={{ gap: 8 }}>
            {clients.map((cl) => {
              const key = athleteKey(cl);
              const on = selected.has(key);
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${on ? 'Unselect' : 'Select'} ${cl.name}`}
                  onPress={() => { toggle(key); setAssigned(0); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: on ? c.accentSurface : c.bg, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 13, borderWidth: 1.5, borderColor: on ? c.accentBorder : 'transparent' }}
                >
                  <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: on ? c.accent : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Icon name="check" size={13} color={c.white} /> : null}
                  </View>
                  <Txt w="b" size={14} style={{ flex: 1 }}>
                    {cl.name}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </Card>
        </Reveal>

        {assigned > 0 ? (
          <Row style={{ gap: 8, alignItems: 'center', marginTop: 16, backgroundColor: c.successSurface, borderRadius: 14, padding: 14 }}>
            <Icon name="check" size={16} color={c.successDeep} />
            <Txt w="b" size={13} color={c.successDeep} style={{ flex: 1 }}>
              Assigned to {assigned} client{assigned === 1 ? '' : 's'}. Open any client to fine-tune their copy.
            </Txt>
          </Row>
        ) : null}

        <Btn
          label={`Assign to ${selected.size} client${selected.size === 1 ? '' : 's'}`}
          haptic="success"
          disabled={!canAssign}
          onPress={assign}
          style={[{ marginTop: 18 }, shadow.cta]}
        />
      </ScrollView>
    </Overlay>
  );
}
