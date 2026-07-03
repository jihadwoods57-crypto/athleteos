// OnStandard — Today's Plan tab. Your daily plan-commitment (the one-tap that carries the
// 0.15 score slot), your coach targets, and — engines-on — plan execution. Replaced the old
// static, un-authored task checklist (retired per docs/council/2026-07-02-trust-pass.md).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { weekdayLong, activePlan, mealWindowStatuses, escalation, planAdherence } from '@/core';
import { isEnginesEnabled, isMealPlansEnabled } from '@/lib/features';
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
  const openMeal = useStore((s) => s.openMeal);
  const setMealType = useStore((s) => s.setMealType);

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
      <Txt w="eb" size={28} ls={-0.8} accessibilityRole="header" style={{ marginTop: 1 }}>
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

      {/* Today's meals — the day's structure, so the Plan tab is a real plan and not just
          Home's commitment card repeated (the audit: "nearly empty"). Only when the engine is
          OFF (the beta); with engines ON the "Plan execution" card below is the meal surface. */}
      {!isEnginesEnabled ? (
        <Reveal index={2}>
          <View style={[{ marginTop: 14, backgroundColor: c.card, borderRadius: 20, padding: 18 }, shadow.card]}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
              <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>TODAY&apos;S MEALS</Txt>
              <Txt w="b" size={12} color={c.textTertiary}>
                {windowStatuses.filter((w) => w.state === 'logged').length} of {windowStatuses.length} logged
              </Txt>
            </Row>
            {windowStatuses.map((w) => {
              const chip = w.state === 'logged'
                ? { label: 'Logged', bg: c.successSurface, fg: c.successDeep }
                : w.state === 'missed'
                  ? { label: 'Missed', bg: c.alertSurface, fg: c.alert }
                  : w.state === 'open'
                    ? { label: 'Log now', bg: c.accentSurface, fg: c.accent }
                    : { label: 'Upcoming', bg: c.bg, fg: c.textTertiary };
              return (
                <Pressable
                  key={w.window.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${w.window.label}: ${chip.label}. Log it.`}
                  onPress={() => { haptics.tap(); setMealType(w.window.label as never); openMeal(); }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, minHeight: 44, opacity: pressed ? 0.6 : 1 })}
                >
                  <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <Txt w="eb" size={13} color={w.state === 'logged' ? c.successDeep : c.slate600}>{w.window.label[0]}</Txt>
                  </View>
                  <Txt w="b" size={14} style={{ flex: 1 }}>{w.window.label}</Txt>
                  <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, backgroundColor: chip.bg }}>
                    <Txt w="eb" size={11} color={chip.fg}>{chip.label}</Txt>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Reveal>
      ) : null}

      {/* Meal Plans entry — shown when the Meal Plans feature is on but the accountability
          engine is OFF, so there's a way to open the Coach Plan editor (prescribed meals)
          without the full engine "Plan execution" card. When engines is on, that card below
          already links to the same editor, so this stays hidden to avoid a duplicate entry. */}
      {isMealPlansEnabled && !isEnginesEnabled ? (
        <Reveal index={2}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit coach plan"
            onPress={openPlanEditor}
            style={({ pressed }) => [{ marginTop: 14, backgroundColor: c.card, borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.85 : 1 }, shadow.card]}
          >
            <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={20} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={15} ls={-0.3}>Coach plan</Txt>
              <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 1 }}>Set prescribed meals and targets</Txt>
            </View>
            <Icon name="chevronRight" size={18} color={c.slate300} />
          </Pressable>
        </Reveal>
      ) : null}

      {/* Accountability Engine — plan execution today (meal windows + escalation).
          Gated by the engines master switch (OFF for the prove-the-loop beta). */}
      {isEnginesEnabled ? (
        <Reveal index={3}>
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
