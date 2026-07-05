// OnStandard — Today's Game Plan tab. Your daily plan-commitment (the one-tap that carries the
// 0.15 score slot), your coach targets, and — engines-on — plan execution. Replaced the old
// static, un-authored task checklist (retired per docs/council/2026-07-02-trust-pass.md).
//
// Dark-premium redesign: this is a VISUAL port only. Every store hook, selector, action, core
// helper, feature gate, and copy string is preserved from the prior version — the daily
// commitment set, meal-log entry (setMealType + openMeal), the coach-plan editor entry
// (openPlanEditor), the engines/meal-plans gating, and the exact adherence/escalation math all
// behave identically. The proto's "Today's Game Plan" composition organizes the SAME data into
// premium sub-tabs (Overview / Schedule / Notes) — a tab only exists where real screen data
// backs it (no fabricated coach, macros, windows, or AI summaries).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { weekdayLong, activePlan, mealWindowStatuses, escalation, planAdherence, formatWindowTime, tierFor } from '@/core';
import { isEnginesEnabled, isMealPlansEnabled } from '@/lib/features';
import { useStore, useDerived } from '@/store';
import { shadow, tierChip } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Reveal, Row, Txt, Pressable, PressScale, ProgressBar } from '@/ui/primitives';
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

  // A coach has authored the plan when standing instructions exist — the honest signal for the
  // "Set by Coach" header subtitle (until then the sensible defaults apply). No fabricated coach.
  const coachAuthored = planInstructions.length > 0;

  const loggedCount = windowStatuses.filter((w) => w.state === 'logged').length;

  // Sub-tab structure (proto "Today's Game Plan"): each tab renders ONLY data this screen
  // already has. Overview = objective + targets + macro/window summary; Schedule = the
  // meal-window rows with real times + state; Notes = the coach's standing instructions.
  // Notes only exists when the coach actually wrote instructions — otherwise no empty tab.
  const tabs = React.useMemo(
    () =>
      [
        { key: 'overview' as const, label: 'Overview' },
        { key: 'schedule' as const, label: 'Schedule' },
        coachAuthored ? { key: 'notes' as const, label: 'Notes' } : null,
      ].filter(Boolean) as { key: 'overview' | 'schedule' | 'notes'; label: string }[],
    [coachAuthored],
  );
  const [tab, setTab] = React.useState<'overview' | 'schedule' | 'notes'>('overview');
  // Guard: if Notes disappears (instructions cleared), fall back to Overview.
  React.useEffect(() => {
    if (!tabs.some((t) => t.key === tab)) setTab('overview');
  }, [tabs, tab]);

  const logMeal = (label: string) => {
    haptics.tap();
    setMealType(label as never);
    openMeal();
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      {/* header — "Today's Game Plan", with the honest coach-authored subtitle */}
      <Txt w="sb" size={14} color={c.textSecondary}>
        {weekdayLong()} · in-season
      </Txt>
      <Txt w="eb" size={28} ls={-0.8} accessibilityRole="header" style={{ marginTop: 1 }}>
        Today&apos;s Game Plan
      </Txt>
      <Row style={{ gap: 7, alignItems: 'center', marginTop: 5 }}>
        <Icon name={coachAuthored ? 'shield' : 'sparkle'} size={13} color={coachAuthored ? c.accent : c.textTertiary} />
        <Txt w="sb" size={13} color={coachAuthored ? c.accent : c.textTertiary}>
          {coachAuthored ? 'Set by Coach · updated for today' : 'Your standing plan for today'}
        </Txt>
      </Row>

      {/* daily plan-commitment — the one daily action (mirrored from Home). The hero of the
          screen: it carries the 0.15 score slot, so it gets the deep float. */}
      <Reveal index={0}>
        <Card variant="hero" style={{ marginTop: 20, borderRadius: 24, padding: 22 }}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>
            TODAY&apos;S COMMITMENT
          </Txt>
          <Txt w="eb" size={19} ls={-0.4} style={{ marginTop: 6 }}>
            Did you hit your plan today?
          </Txt>
          <Row style={{ gap: 10, marginTop: 16 }}>
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
                    paddingVertical: 14,
                    borderRadius: 14,
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
        </Card>
      </Reveal>

      {/* sub-tab selector — segmented control (matches Squad's scope control) */}
      <Reveal index={1}>
        <Row style={{ marginTop: 20, gap: 5, backgroundColor: c.surface2, borderRadius: 15, padding: 5, borderWidth: 1, borderColor: c.hairline }}>
          {tabs.map((t) => (
            <SubTab key={t.key} label={t.label} active={tab === t.key} onPress={() => setTab(t.key)} />
          ))}
        </Row>
      </Reveal>

      {tab === 'overview' ? (
        <OverviewTab
          c={c}
          esc={esc}
          proteinTarget={proteinTarget}
          calTarget={calTarget}
          weightTarget={weightTarget}
          d={d}
          windowStatuses={windowStatuses}
          loggedCount={loggedCount}
        />
      ) : null}

      {tab === 'schedule' ? (
        <ScheduleTab c={c} windowStatuses={windowStatuses} loggedCount={loggedCount} onLog={logMeal} />
      ) : null}

      {tab === 'notes' ? <NotesTab c={c} instructions={planInstructions} /> : null}

      {/* ---- engine-gated surfaces (unchanged logic, dark-premium presentation) ---- */}

      {/* Meal Plans entry — shown when Meal Plans is on but the accountability engine is OFF,
          so there's a way to open the Coach Plan editor (prescribed meals) without the full
          engine "Plan execution" card. When engines is on, that card below already links to
          the same editor, so this stays hidden to avoid a duplicate entry. */}
      {isMealPlansEnabled && !isEnginesEnabled ? (
        <Reveal index={2}>
          <PressScale
            accessibilityLabel="Edit coach plan"
            onPress={openPlanEditor}
            style={[{ marginTop: 14, backgroundColor: c.card, borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }, shadow.card]}
          >
            <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={20} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={15} ls={-0.3}>Coach plan</Txt>
              <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 1 }}>Set prescribed meals and targets</Txt>
            </View>
            <Icon name="chevronRight" size={18} color={c.slate300} />
          </PressScale>
        </Reveal>
      ) : null}

      {/* Accountability Engine — plan execution today (meal windows + escalation).
          Gated by the engines master switch (OFF for the prove-the-loop beta). */}
      {isEnginesEnabled ? (
        <Reveal index={3}>
          <Card variant="low" style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Edit coach plan" onPress={openPlanEditor} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}>
                <Txt w="eb" size={16} ls={-0.3}>
                  Plan execution
                </Txt>
                <Icon name="settings" size={14} color={c.textTertiary} />
              </Pressable>
              {(() => {
                const chip = tierChip[tierFor(adherence.adherencePct).short];
                return (
                  <View style={{ minWidth: 52, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center' }}>
                    <Txt w="eb" num size={15} color={chip.fg}>
                      {adherence.adherencePct}%
                    </Txt>
                  </View>
                );
              })()}
            </Row>
            <Row style={{ gap: 8, marginTop: 14 }}>
              {windowStatuses.map((w) => {
                const st = execState(w.state, c);
                return (
                  <View key={w.window.key} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 13, backgroundColor: c.bg, borderWidth: 1, borderColor: c.hairline }}>
                    <Txt w="eb" size={15} color={st.fg}>
                      {w.window.label[0]}
                    </Txt>
                    <Txt w="b" size={9} color={c.textTertiary} style={{ marginTop: 3 }} ls={0.3}>
                      {st.tag}
                    </Txt>
                  </View>
                );
              })}
            </Row>
            <View style={{ marginTop: 14, borderRadius: 14, padding: 13, backgroundColor: esc.level > 0 ? (esc.tone === 'reminder' ? c.surface2 : c.warnTint) : c.successTint }}>
              <Txt w="m" size={13} color={esc.level > 0 ? (esc.tone === 'reminder' ? c.slate700 : c.warnText) : c.successText} style={{ lineHeight: 19 }}>
                {esc.message}
              </Txt>
            </View>
            {planInstructions.length > 0 ? (
              <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.hairline, gap: 9 }}>
                <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} upper>
                  Coach instructions
                </Txt>
                {planInstructions.map((ins) => (
                  <Row key={ins} style={{ gap: 9, alignItems: 'center' }}>
                    <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="check" size={12} color={c.accent} />
                    </View>
                    <Txt w="b" size={13} color={c.slate700} style={{ flex: 1 }}>
                      {ins}
                    </Txt>
                  </Row>
                ))}
              </View>
            ) : null}
          </Card>
        </Reveal>
      ) : null}
    </ScrollView>
  );
}

type C = ReturnType<typeof useColors>;

/** Segmented sub-tab pill (matches Squad's Seg treatment). */
function SubTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={onPress}
      style={[
        { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center', backgroundColor: active ? c.accent : 'transparent' },
        active ? shadow.cta : null,
      ]}
    >
      <Txt w="b" size={13} color={active ? c.white : c.textSecondary}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** State color + short tag for a meal window in the execution grid — reuses the tier/status
 *  token families the rest of the app draws from (no new tokens). */
function execState(state: string, c: C): { fg: string; tag: string } {
  switch (state) {
    case 'logged':
      return { fg: c.successDeep, tag: 'IN' };
    case 'missed':
      return { fg: c.alert, tag: 'MISSED' };
    case 'open':
      return { fg: c.warningDeep, tag: 'OPEN' };
    default:
      return { fg: c.textTertiary, tag: 'SOON' };
  }
}

/** State chip (label + tokens) for a meal window row in Overview/Schedule. */
function windowChip(state: string, c: C): { label: string; bg: string; fg: string } {
  switch (state) {
    case 'logged':
      return { label: 'Logged', bg: c.successSurface, fg: c.successDeep };
    case 'missed':
      return { label: 'Missed', bg: c.alertSurface, fg: c.alert };
    case 'open':
      return { label: 'Log now', bg: c.accentSurface, fg: c.accent };
    default:
      return { label: 'Upcoming', bg: c.bg2, fg: c.textSecondary };
  }
}

/** OVERVIEW — the objective (escalation read), the goal/target summary tiles, the macro
 *  targets, and a compact meal-window summary. All values are real screen data. */
function OverviewTab({
  c,
  esc,
  proteinTarget,
  calTarget,
  weightTarget,
  d,
  windowStatuses,
  loggedCount,
}: {
  c: C;
  esc: ReturnType<typeof escalation>;
  proteinTarget: number;
  calTarget: number;
  weightTarget: number;
  d: ReturnType<typeof useDerived>;
  windowStatuses: ReturnType<typeof mealWindowStatuses>;
  loggedCount: number;
}) {
  const onPlan = esc.level === 0;
  return (
    <>
      {/* objective — the plan's read on today, from the same escalation engine */}
      <Reveal index={2}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
          <Row style={{ gap: 13, alignItems: 'flex-start' }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: onPlan ? c.successSurface : c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={onPlan ? 'check' : 'sparkle'} size={21} color={onPlan ? c.successDeep : c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={11} color={c.textTertiary} ls={0.6}>
                TODAY&apos;S OBJECTIVE
              </Txt>
              <Txt w="m" size={14} color={c.slate700} style={{ marginTop: 5, lineHeight: 20 }}>
                {esc.message}
              </Txt>
            </View>
          </Row>
        </Card>
      </Reveal>

      {/* target summary tiles — protein / calories / goal weight */}
      <Reveal index={3}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>
            YOUR TARGETS
          </Txt>
          <Row style={{ gap: 10, marginTop: 14 }}>
            <TargetTile c={c} value={`${proteinTarget}g`} label="Protein" />
            <TargetTile c={c} value={`${calTarget.toLocaleString()}`} label="Calories" />
            <TargetTile c={c} value={`${weightTarget}`} label="Goal weight" />
          </Row>
        </Card>
      </Reveal>

      {/* macro targets — the plan's full macro breakdown against today's progress. Every
          number is already-derived (computeDerived); nothing is invented here. */}
      <Reveal index={4}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Txt w="eb" size={16} ls={-0.3}>
              Macro targets
            </Txt>
            <Txt w="eb" num size={14}>
              {d.kcalToday.toLocaleString()} <Txt w="sb" num size={12} color={c.textSecondary}>/ {d.calTarget.toLocaleString()} cal</Txt>
            </Txt>
          </Row>
          <View style={{ gap: 13, marginTop: 16 }}>
            <MacroTargetRow c={c} label="Protein" today={d.proteinToday} target={d.proteinTarget} pct={d.proteinPct} color={c.accent} />
            <MacroTargetRow c={c} label="Carbs" today={d.carbsToday} target={d.carbTarget} pct={d.carbPct} color={c.hydration} />
            <MacroTargetRow c={c} label="Fat" today={d.fatToday} target={d.fatTarget} pct={d.fatPct} color={c.purple} />
          </View>
        </Card>
      </Reveal>

      {/* meal windows summary — read-only glance; the Schedule tab is where they're logged */}
      <Reveal index={5}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
            <Txt w="eb" size={16} ls={-0.3}>Meal windows</Txt>
            <Txt w="b" size={12} color={c.textTertiary}>
              {loggedCount} of {windowStatuses.length} logged
            </Txt>
          </Row>
          <Row style={{ gap: 8 }}>
            {windowStatuses.map((w) => {
              const st = execState(w.state, c);
              return (
                <View key={w.window.key} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 13, backgroundColor: c.bg, borderWidth: 1, borderColor: c.hairline }}>
                  <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Txt w="eb" size={14} color={st.fg}>{w.window.label[0]}</Txt>
                  </View>
                  <Txt w="b" size={9} color={c.textTertiary} style={{ marginTop: 6 }} ls={0.3}>
                    {st.tag}
                  </Txt>
                </View>
              );
            })}
          </Row>
        </Card>
      </Reveal>
    </>
  );
}

/** SCHEDULE — the requirement / meal-window rows with real deadline times + state, tappable
 *  to log (preserves setMealType + openMeal). The engine-off meal surface, restyled. */
function ScheduleTab({
  c,
  windowStatuses,
  loggedCount,
  onLog,
}: {
  c: C;
  windowStatuses: ReturnType<typeof mealWindowStatuses>;
  loggedCount: number;
  onLog: (label: string) => void;
}) {
  return (
    <Reveal index={2}>
      <Card variant="low" style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
          <Txt w="eb" size={16} ls={-0.3}>Today&apos;s schedule</Txt>
          <Txt w="b" size={12} color={c.textTertiary}>
            {loggedCount} of {windowStatuses.length} logged
          </Txt>
        </Row>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 4 }}>
          Each window and when it closes. Tap to log the meal.
        </Txt>
        <View style={{ gap: 10, marginTop: 16 }}>
          {windowStatuses.map((w) => {
            const chip = windowChip(w.state, c);
            const st = execState(w.state, c);
            return (
              <PressScale
                key={w.window.key}
                accessibilityLabel={`${w.window.label}, ${w.window.required ? 'required' : 'optional'}, closes ${formatWindowTime(w.window.deadlineMin)}: ${chip.label}. Log it.`}
                onPress={() => onLog(w.window.label)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, paddingHorizontal: 13, borderRadius: 16, backgroundColor: c.bg, borderWidth: 1, borderColor: c.hairline }}
              >
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt w="eb" size={16} color={st.fg}>{w.window.label[0]}</Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Row style={{ gap: 7, alignItems: 'center' }}>
                    <Txt w="b" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>{w.window.label}</Txt>
                    {w.window.required ? (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, backgroundColor: c.surface2 }}>
                        <Txt w="eb" size={9} color={c.textTertiary} ls={0.3}>REQUIRED</Txt>
                      </View>
                    ) : null}
                  </Row>
                  <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 3 }}>
                    Closes {formatWindowTime(w.window.deadlineMin)}
                  </Txt>
                </View>
                <View style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 10, backgroundColor: chip.bg }}>
                  <Txt w="eb" size={11} color={chip.fg}>{chip.label}</Txt>
                </View>
              </PressScale>
            );
          })}
        </View>
      </Card>
    </Reveal>
  );
}

/** NOTES — the coach's standing instructions. Only rendered when instructions exist (the tab
 *  itself is hidden otherwise), so there is never an empty "coach notes" shell. */
function NotesTab({ c, instructions }: { c: C; instructions: string[] }) {
  return (
    <Reveal index={2}>
      <Card variant="low" style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
        <Row style={{ gap: 11, alignItems: 'center', marginBottom: 4 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={19} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={12} color={c.textTertiary} ls={0.6}>FROM YOUR COACH</Txt>
            <Txt w="eb" size={16} ls={-0.3} style={{ marginTop: 2 }}>Standing instructions</Txt>
          </View>
        </Row>
        <View style={{ gap: 10, marginTop: 12 }}>
          {instructions.map((ins) => (
            <Row key={ins} style={{ gap: 11, alignItems: 'center', backgroundColor: c.bg, borderRadius: 14, borderWidth: 1, borderColor: c.hairline, paddingVertical: 12, paddingHorizontal: 13 }}>
              <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={13} color={c.accent} />
              </View>
              <Txt w="b" size={14} color={c.slate700} style={{ flex: 1 }}>
                {ins}
              </Txt>
            </Row>
          ))}
        </View>
      </Card>
    </Reveal>
  );
}

function TargetTile({ c, value, label }: { c: C; value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: c.bg, borderWidth: 1, borderColor: c.hairline }}>
      <Txt w="eb" num size={19} color={c.accent}>
        {value}
      </Txt>
      <Txt w="b" size={11} color={c.textTertiary} style={{ marginTop: 4 }}>
        {label}
      </Txt>
    </View>
  );
}

function MacroTargetRow({ c, label, today, target, pct, color }: { c: C; label: string; today: number; target: number; pct: number; color: string }) {
  const met = pct >= 100;
  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: 7 }}>
        <Row style={{ gap: 5, alignItems: 'center' }}>
          <Txt w="b" size={14} color={c.slate700}>{label}</Txt>
          {met ? <Icon name="check" size={12} color={c.successDeep} /> : null}
        </Row>
        <Txt w="sb" num size={12} color={met ? c.successDeep : c.textSecondary}>
          {today}g / {target}g
        </Txt>
      </Row>
      <ProgressBar pct={pct} height={8} color={met ? c.successDeep : color} />
    </View>
  );
}
