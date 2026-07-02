// OnStandard — Today's Plan tab. Your daily plan-commitment (the one-tap that carries the
// 0.15 score slot), your coach targets, and — engines-on — plan execution. Replaced the old
// static, un-authored task checklist (retired per docs/council/2026-07-02-trust-pass.md).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { weekdayLong, activePlan, mealWindowStatuses, escalation, planAdherence } from '@/core';
import { isEnginesEnabled } from '@/lib/features';
import { useStore, useDerived } from '@/store';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';

export function Plan() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const d = useDerived();
  const dailyCommitment = useStore((s) => s.dailyCommitment);
  const setDailyCommitment = useStore((s) => s.setDailyCommitment);

  // Coach plan / Accountability Engine (the execution card is engine-gated below).
  const meals = useStore((s) => s.meals);
  const hydrationL = useStore((s) => s.hydrationL);
  const planInstructions = useStore((s) => s.planInstructions);
  const openPlanEditor = useStore((s) => s.openPlanEditor);
  const proteinTarget = useStore((s) => s.proteinTarget);
  const calTarget = useStore((s) => s.calTarget);
  const weightTarget = useStore((s) => s.weightTarget);
  const plan = activePlan({ proteinTarget, calTarget, weightTarget, planInstructions });
  const windowStatuses = mealWindowStatuses(plan, meals);
  const adherence = planAdherence(plan, { proteinToday: d.proteinToday, kcalToday: d.kcalToday, hydrationL }, windowStatuses);
  const missedToday = windowStatuses.filter((w) => w.window.required && w.state === 'missed').length;
  const approaching = windowStatuses.find((w) => w.state === 'open' && w.minutesToDeadline >= 0 && w.minutesToDeadline <= 45);
  const esc = escalation({ missedToday, approachingMeal: approaching ? approaching.window.label.toLowerCase() : null, consecutiveDaysMissed: 0 });
  const stateColor: Record<string, string> = {
    logged: c.successDeep,
    missed: c.alert,
    open: c.warningDeep,
    upcoming: c.textTertiary,
  };

  const targets: [string, string][] = [
    ['Protein', `${proteinTarget}g`],
    ['Calories', `${calTarget}`],
    ['Goal weight', `${weightTarget}`],
  ];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      <Txt w="sb" size={14} color={c.textSecondary}>
        {weekdayLong()} · in-season
      </Txt>
      <Txt w="eb" size={28} ls={-0.8} style={{ marginTop: 1 }}>
        Today&apos;s Plan
      </Txt>

      {/* daily plan-commitment — the one daily action (mirrored from Home) */}
      <Reveal index={0}>
        <View style={[{ marginTop: 18, backgroundColor: c.card, borderRadius: 20, padding: 18 }, shadow.card]}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>
            TODAY&apos;S COMMITMENT
          </Txt>
          <Txt w="eb" size={18} ls={-0.4} style={{ marginTop: 6 }}>
            Did you hit your plan today?
          </Txt>
          <Row style={{ gap: 10, marginTop: 14 }}>
            {(['yes', 'partial', 'no'] as const).map((val) => {
              const active = dailyCommitment === val;
              const label = val === 'yes' ? 'Yes' : val === 'partial' ? 'Partial' : 'No';
              return (
                <Pressable
                  key={val}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Hit your plan today: ${label}`}
                  onPress={() => {
                    haptics[val === 'no' ? 'tap' : 'success']();
                    setDailyCommitment(val);
                  }}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: 13,
                    borderRadius: 13,
                    backgroundColor: active ? c.accent : c.bg,
                    borderWidth: 2,
                    borderColor: active ? c.accent : c.border,
                  }}
                >
                  <Txt w="eb" size={15} color={active ? c.white : c.text}>
                    {label}
                  </Txt>
                </Pressable>
              );
            })}
          </Row>
          <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 12, lineHeight: 17 }}>
            One honest tap. Logging your meals is still how you earn a top score.
          </Txt>
        </View>
      </Reveal>

      {/* coach targets — always visible, engines on or off */}
      <Reveal index={1}>
        <View style={[{ marginTop: 14, backgroundColor: c.card, borderRadius: 20, padding: 18 }, shadow.card]}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>
            YOUR TARGETS
          </Txt>
          <Row style={{ gap: 10, marginTop: 12 }}>
            {targets.map(([label, value]) => (
              <View key={label} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: c.bg }}>
                <Txt w="eb" num size={18} color={c.accent}>
                  {value}
                </Txt>
                <Txt w="b" size={11} color={c.textTertiary} style={{ marginTop: 3 }}>
                  {label}
                </Txt>
              </View>
            ))}
          </Row>
        </View>
      </Reveal>

      {/* Accountability Engine — plan execution today (meal windows + escalation).
          Gated by the engines master switch (OFF for the prove-the-loop beta). */}
      {isEnginesEnabled ? (
        <Reveal index={2}>
          <View style={[{ marginTop: 14, backgroundColor: c.card, borderRadius: 20, padding: 18 }, shadow.card]}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Edit coach plan" onPress={openPlanEditor} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}>
                <Txt w="eb" size={15} ls={-0.3}>
                  Plan execution
                </Txt>
                <Icon name="settings" size={14} color={c.textTertiary} />
              </Pressable>
              <Txt w="eb" num size={15} color={adherence.adherencePct >= 80 ? c.successDeep : adherence.adherencePct >= 50 ? c.warningDeep : c.alert}>
                {adherence.adherencePct}%
              </Txt>
            </Row>
            <Row style={{ gap: 8, marginTop: 12 }}>
              {windowStatuses.map((w) => (
                <View key={w.window.key} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: c.bg }}>
                  <Txt w="eb" size={14} color={stateColor[w.state]}>
                    {w.window.label[0]}
                  </Txt>
                  <Txt w="b" size={9} color={c.textTertiary} style={{ marginTop: 2 }}>
                    {w.state === 'logged' ? 'IN' : w.state === 'missed' ? 'MISSED' : w.state === 'open' ? 'OPEN' : 'SOON'}
                  </Txt>
                </View>
              ))}
            </Row>
            {esc.level > 0 ? (
              <Txt w="m" size={13} color={esc.tone === 'reminder' ? c.slate700 : c.warningDeep} style={{ marginTop: 12, lineHeight: 19 }}>
                {esc.message}
              </Txt>
            ) : (
              <Txt w="m" size={13} color={c.successDeep} style={{ marginTop: 12, lineHeight: 19 }}>
                {esc.message}
              </Txt>
            )}
            {planInstructions.length > 0 ? (
              <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.border, gap: 7 }}>
                <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} upper>
                  Coach instructions
                </Txt>
                {planInstructions.map((ins) => (
                  <Row key={ins} style={{ gap: 8, alignItems: 'center' }}>
                    <Icon name="check" size={13} color={c.accent} />
                    <Txt w="b" size={13} color={c.slate700} style={{ flex: 1 }}>
                      {ins}
                    </Txt>
                  </Row>
                ))}
              </View>
            ) : null}
          </View>
        </Reveal>
      ) : null}
    </ScrollView>
  );
}
