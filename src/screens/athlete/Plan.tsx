// OnStandard — Plan (Tasks) tab. Toggling a task updates the Athlete Score.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { taskVisibilityNote, weekdayLong, activePlan, mealWindowStatuses, escalation, planAdherence } from '@/core';
import { isEnginesEnabled } from '@/lib/features';
import { useStore, useDerived } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { ProgressBar, Row, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';

export function Plan() {
  const insets = useSafeAreaInsets();
  const tasks = useStore((s) => s.tasks);
  const toggleTask = useStore((s) => s.toggleTask);
  const athleteName = useStore((s) => s.athleteName);
  const supportTeam = useStore((s) => s.supportTeam);
  const d = useDerived();
  const left = d.tasksTotal - d.tasksDone;
  const visibilityNote = taskVisibilityNote({ isReal: athleteName.trim().length > 0, supportTeam });

  // Accountability Engine: today's execution against the coach plan.
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
    logged: colors.successDeep,
    missed: colors.alert,
    open: colors.warningDeep,
    upcoming: colors.textTertiary,
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      <Txt w="sb" size={14} color={colors.textSecondary}>
        {weekdayLong()} · in-season
      </Txt>
      <Txt w="eb" size={28} ls={-0.8} style={{ marginTop: 1 }}>
        Today's Plan
      </Txt>

      <Row style={[{ marginTop: 18, gap: 16, backgroundColor: '#fff', borderRadius: 20, padding: 18 }, shadow.card]}>
        <Txt w="eb" size={30}>
          <Txt w="eb" size={30} color={colors.accent}>
            {d.tasksDone}
          </Txt>
          <Txt w="eb" size={30} color="#CBD5E1">
            /{d.tasksTotal}
          </Txt>
        </Txt>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={14} style={{ marginBottom: 8 }}>
            {left === 0 ? 'All done, nice work' : `${left} task${left === 1 ? '' : 's'} left today`}
          </Txt>
          <ProgressBar pct={d.tasksScore} height={9} />
        </View>
      </Row>

      {/* Accountability Engine — plan execution today (meal windows + escalation).
          Gated by the engines master switch (OFF for the prove-the-loop beta); the core
          task list + count below stay visible either way. */}
      {isEnginesEnabled ? (
        <View style={[{ marginTop: 14, backgroundColor: '#fff', borderRadius: 20, padding: 18 }, shadow.card]}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Edit coach plan" onPress={openPlanEditor} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}>
              <Txt w="eb" size={15} ls={-0.3}>
                Plan execution
              </Txt>
              <Icon name="settings" size={14} color={colors.textTertiary} />
            </Pressable>
            <Txt w="eb" size={15} color={adherence.adherencePct >= 80 ? colors.successDeep : adherence.adherencePct >= 50 ? colors.warningDeep : colors.alert}>
              {adherence.adherencePct}%
            </Txt>
          </Row>
          <Row style={{ gap: 8, marginTop: 12 }}>
            {windowStatuses.map((w) => (
              <View key={w.window.key} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: colors.bg }}>
                <Txt w="eb" size={14} color={stateColor[w.state]}>
                  {w.window.label[0]}
                </Txt>
                <Txt w="b" size={9} color={colors.textTertiary} style={{ marginTop: 2 }}>
                  {w.state === 'logged' ? 'IN' : w.state === 'missed' ? 'MISSED' : w.state === 'open' ? 'OPEN' : 'SOON'}
                </Txt>
              </View>
            ))}
          </Row>
          {esc.level > 0 ? (
            <Txt w="m" size={13} color={esc.tone === 'reminder' ? colors.slate700 : colors.warningDeep} style={{ marginTop: 12, lineHeight: 19 }}>
              {esc.message}
            </Txt>
          ) : (
            <Txt w="m" size={13} color={colors.successDeep} style={{ marginTop: 12, lineHeight: 19 }}>
              {esc.message}
            </Txt>
          )}
          {planInstructions.length > 0 ? (
            <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border, gap: 7 }}>
              <Txt w="eb" size={11} color={colors.textTertiary} ls={0.5} upper>
                Coach instructions
              </Txt>
              {planInstructions.map((ins) => (
                <Row key={ins} style={{ gap: 8, alignItems: 'center' }}>
                  <Icon name="check" size={13} color={colors.accent} />
                  <Txt w="b" size={13} color={colors.slate700} style={{ flex: 1 }}>
                    {ins}
                  </Txt>
                </Row>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ marginTop: 18, gap: 10 }}>
        {tasks.map((t) => (
          <View key={t.id}>
            {t.group ? (
              <Txt w="eb" size={12} color={colors.textTertiary} ls={0.7} style={{ marginTop: 12, marginBottom: 8 }}>
                {t.group}
              </Txt>
            ) : null}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: t.done }}
              accessibilityLabel={`${t.title}${t.done ? ', completed' : ''}`}
              onPress={() => {
                haptics[t.done ? 'tap' : 'success']();
                toggleTask(t.id);
              }}
              style={[{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 16, padding: 16 }, shadow.card]}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 9,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: t.done ? colors.accent : '#fff',
                  borderWidth: 2,
                  borderColor: t.done ? colors.accent : '#CBD5E1',
                }}
              >
                {t.done ? <Icon name="check" size={14} color="#fff" /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Txt w="b" size={15} color={t.done ? colors.textTertiary : colors.text} style={{ textDecorationLine: t.done ? 'line-through' : 'none' }}>
                  {t.title}
                </Txt>
                <Txt w="m" size={13} color={colors.textTertiary} style={{ marginTop: 2 }}>
                  {t.meta}
                </Txt>
              </View>
            </Pressable>
          </View>
        ))}
      </View>

      <Txt w="m" size={13} color={colors.textTertiary} style={{ marginTop: 18, textAlign: 'center', lineHeight: 19, paddingHorizontal: 16 }}>
        {visibilityNote}
      </Txt>
    </ScrollView>
  );
}
