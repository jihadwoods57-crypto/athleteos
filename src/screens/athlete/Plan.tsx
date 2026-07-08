// OnStandard — Plan tab. Rebuilt to the redesign proto's "Plan" screen
// (proto/redesign-2026-07/js/screens/plan.js): a "Plan" screen-title, the plan
// title + coach line + phase header with a phase-bar, underline sub-tabs
// (Overview / Nutrition / Schedule / Notes), eyebrow section headers, summary
// tiles, a macro-target row, a coach note, and section sideboxes.
//
// FAITHFUL REBUILD TO THE PROTO LAYOUT — every store hook, selector, action, core
// helper, feature gate, and honesty rule is preserved from the prior version and
// wired to REAL data:
//   • the daily plan-commitment one-tap (setDailyCommitment) still carries the 0.15
//     score slot; it opens the Overview so the hero action reads first.
//   • the meal-window schedule stays tappable to log (setMealType + openMeal), and
//     the Coach Plan editor entry (openPlanEditor) is gated exactly as before.
//   • the engines / meal-plans gates and the adherence + escalation math behave
//     identically.
// The proto shows some coach-authored content the RN app does not truly have (an
// invented "week 2 of 6" phase, a swaps list, an AI chat thread). Those are ADAPTED
// honestly: the phase reads from the athlete's real goal, the objective/summary read
// from real targets + the escalation engine, and Nutrition/Notes render the athlete's
// REAL live macro progress + the coach's real standing instructions — never fabricated
// coach copy, macros, or messages. A sub-tab only exists where real data backs it.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  weekdayLong,
  activePlan,
  mealWindowStatuses,
  escalation,
  planAdherence,
  formatWindowTime,
  tierFor,
  displayWeight,
  weightUnit,
  scoringProfileLabel,
  GOAL_LABELS,
} from '@/core';
import { isEnginesEnabled, isMealPlansEnabled } from '@/lib/features';
import { useStore, useDerived } from '@/store';
import { shadow, tierChip } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Reveal, Row, Txt, Pressable, PressScale, ProgressBar } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon, IconName } from '@/icons';

type SubKey = 'overview' | 'nutrition' | 'schedule' | 'notes';

export function Plan() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const d = useDerived();
  const dailyCommitment = useStore((s) => s.dailyCommitment);
  const setDailyCommitment = useStore((s) => s.setDailyCommitment);
  const openMeal = useStore((s) => s.openMeal);
  const setMealType = useStore((s) => s.setMealType);
  const units = useStore((s) => s.units) ?? 'imperial';

  // Coach plan / Accountability Engine (the schedule/editor surfaces are engine-gated below).
  const meals = useStore((s) => s.meals);
  const hydrationL = useStore((s) => s.hydrationL);
  const planInstructions = useStore((s) => s.planInstructions);
  const openPlanEditor = useStore((s) => s.openPlanEditor);
  const proteinTarget = useStore((s) => s.proteinTarget);
  const calTarget = useStore((s) => s.calTarget);
  const weightTarget = useStore((s) => s.weightTarget);
  const currentWeight = useStore((s) => s.currentWeight);
  const primaryGoal = useStore((s) => s.primaryGoal);
  const scoringProfile = useStore((s) => s.scoringProfile);

  const plan = activePlan({ proteinTarget, calTarget, weightTarget, planInstructions });
  const windowStatuses = mealWindowStatuses(plan, meals);
  const adherence = planAdherence(plan, { proteinToday: d.proteinToday, kcalToday: d.kcalToday, hydrationL }, windowStatuses);
  const missedToday = windowStatuses.filter((w) => w.window.required && w.state === 'missed').length;
  const approaching = windowStatuses.find((w) => w.state === 'open' && w.minutesToDeadline >= 0 && w.minutesToDeadline <= 45);
  const esc = escalation({ missedToday, approachingMeal: approaching ? approaching.window.label.toLowerCase() : null, consecutiveDaysMissed: 0 });

  // A coach has authored the plan when standing instructions exist — the honest signal for
  // the "Set by Coach" coach line (until then the sensible defaults apply). No fabricated coach.
  const coachAuthored = planInstructions.length > 0;
  const loggedCount = windowStatuses.filter((w) => w.state === 'logged').length;

  // The proto's phase header ("Lean Mass Phase · Week 2 of 6") is coach-authored content the
  // RN app doesn't have. Read it honestly from the athlete's REAL goal instead of inventing a
  // week counter: the goal label is the phase title, and the scoring profile line explains it.
  const goalLabel = (primaryGoal && GOAL_LABELS[primaryGoal]) || null;
  const profile = scoringProfileLabel(scoringProfile);
  const phaseTitle = goalLabel ? `${goalLabel} plan` : profile.title;

  // Sub-tabs (proto: Overview / Nutrition / Schedule / Notes). Each renders ONLY real screen
  // data. Schedule appears when the accountability engine is on (the meal-window rulebook it
  // powers). Notes appears only when the coach actually wrote standing instructions — so there
  // is never an empty coach-notes shell or a tab with nothing behind it.
  const tabs = React.useMemo(
    () =>
      [
        { key: 'overview' as const, label: 'Overview' },
        { key: 'nutrition' as const, label: 'Nutrition' },
        isEnginesEnabled ? { key: 'schedule' as const, label: 'Schedule' } : null,
        coachAuthored ? { key: 'notes' as const, label: 'Notes' } : null,
      ].filter(Boolean) as { key: SubKey; label: string }[],
    [coachAuthored],
  );
  const [tab, setTab] = React.useState<SubKey>('overview');
  // Guard: if the active tab disappears (instructions cleared / engine off), fall back.
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
      {/* ---- header: "Plan" screen title, then the plan title + coach line + phase-bar ---- */}
      <Txt w="eb" size={28} ls={-0.6} accessibilityRole="header" style={{ paddingVertical: 2 }}>
        Plan
      </Txt>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Txt w="eb" size={16} ls={-0.3}>
            Today&apos;s Game Plan
          </Txt>
          <Row style={{ gap: 6, alignItems: 'center', marginTop: 4 }}>
            <Icon name={coachAuthored ? 'shield' : 'sparkle'} size={13} color={coachAuthored ? c.accent : c.textTertiary} />
            <Txt w="sb" size={12.5} color={coachAuthored ? c.accent : c.textTertiary}>
              {coachAuthored ? 'Set by Coach · updated for today' : 'Your standing plan for today'}
            </Txt>
          </Row>
        </View>
        <StatusPill c={c} label="In-season" short="b" />
      </Row>
      <Txt w="b" size={12} color={c.textTertiary} style={{ marginTop: 8 }}>
        {phaseTitle} · {weekdayLong()}
      </Txt>
      {/* phase-bar: a 6-segment rhythm strip (proto). Fill tracks today's real plan adherence
          so it reads honestly rather than a hardcoded "week 2 of 6". */}
      <Row style={{ gap: 5, marginTop: 10 }}>
        {Array.from({ length: 6 }, (_, i) => {
          const on = i < Math.round((adherence.adherencePct / 100) * 6);
          return <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: on ? c.success : c.surface3 }} />;
        })}
      </Row>

      {/* ---- daily plan-commitment: the one daily action (mirrored from Home). The hero: it
              carries the 0.15 score slot, so it gets the deep float. ---- */}
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

      {/* ---- sub-tabs: underline segmented control (proto .ptabs) ---- */}
      <Reveal index={1}>
        <Row style={{ marginTop: 22, borderBottomWidth: 1, borderBottomColor: c.hairline }}>
          {tabs.map((t) => (
            <SubTab key={t.key} label={t.label} active={tab === t.key} onPress={() => setTab(t.key)} />
          ))}
        </Row>
      </Reveal>

      {tab === 'overview' ? (
        <OverviewTab
          c={c}
          esc={esc}
          plan={plan}
          d={d}
          units={units}
          weightTarget={weightTarget}
          currentWeight={currentWeight}
          goalLabel={goalLabel}
          profile={profile}
          coachAuthored={coachAuthored}
          firstInstruction={planInstructions[0] ?? null}
        />
      ) : null}

      {tab === 'nutrition' ? <NutritionTab c={c} d={d} plan={plan} /> : null}

      {tab === 'schedule' ? (
        <ScheduleTab c={c} windowStatuses={windowStatuses} adherence={adherence} esc={esc} loggedCount={loggedCount} onLog={logMeal} onEdit={openPlanEditor} />
      ) : null}

      {tab === 'notes' ? <NotesTab c={c} instructions={planInstructions} /> : null}

      {/* ---- Meal Plans entry (engine OFF): the only way to open the Coach Plan editor when
              the full engine schedule tab isn't shown. Hidden when engines is on, since the
              Schedule tab already links to the same editor (no duplicate entry). ---- */}
      {isMealPlansEnabled && !isEnginesEnabled ? (
        <Reveal index={2}>
          <PressScale
            accessibilityLabel="Edit coach plan"
            onPress={openPlanEditor}
            style={[{ marginTop: 20, backgroundColor: c.card, borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }, shadow.card]}
          >
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
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
    </ScrollView>
  );
}

type C = ReturnType<typeof useColors>;
type Plan = ReturnType<typeof activePlan>;
type D = ReturnType<typeof useDerived>;
type Esc = ReturnType<typeof escalation>;

/** Underline sub-tab (proto .ptabs .pt): gradient bar under the active tab. */
function SubTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={onPress}
      style={{ paddingTop: 10, paddingBottom: 12, marginRight: 22 }}
    >
      <Txt w="b" size={14.5} color={active ? c.text : c.textTertiary}>
        {label}
      </Txt>
      {active ? (
        <View style={{ position: 'absolute', left: 0, right: 22, bottom: -1, height: 2.5, borderRadius: 2, backgroundColor: c.success }} />
      ) : null}
    </Pressable>
  );
}

/** Section eyebrow header (proto .eyebrow) — uppercase, wide-tracked, optional trailing link. */
function Eyebrow({ children, style }: { children: React.ReactNode; style?: object }) {
  const c = useColors();
  return (
    <Txt w="eb" size={11} color={c.textTertiary} ls={1.4} upper style={{ marginTop: 26, marginBottom: 12, marginLeft: 2, ...(style ?? {}) }}>
      {children}
    </Txt>
  );
}

/** Status pill (proto .status-pill) — tinted per tier class. */
function StatusPill({ c, label, short }: { c: C; label: string; short: 'r' | 'a' | 'b' | 'g' }) {
  const chip = tierChip[short];
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1.5, borderColor: chip.border, backgroundColor: chip.bg }}>
      <Txt w="eb" size={11} color={chip.fg} ls={0.2}>
        {label}
      </Txt>
    </View>
  );
}

/** Semantic requirement-icon tile (proto .req-icon) — tinted square with a colored glyph. */
function ReqIcon({ c, name, tone = 'b', size = 44, glyph = 21 }: { c: C; name: IconName; tone?: 'g' | 'a' | 'b' | 'p'; size?: number; glyph?: number }) {
  const map = {
    g: { bg: c.successSurface, fg: c.success },
    a: { bg: c.warnTint, fg: c.warningDeep },
    b: { bg: c.accentSurface, fg: c.accent },
    p: { bg: c.surface3, fg: c.purple },
  }[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: 14, backgroundColor: map.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={glyph} color={map.fg} />
    </View>
  );
}

/** OVERVIEW — Today's Objective (escalation read) · Plan Summary tiles (real goal + weights) ·
 *  Nutrition Structure (real targets + real meal windows) · Coach Note (real instructions only). */
function OverviewTab({
  c,
  esc,
  plan,
  d,
  units,
  weightTarget,
  currentWeight,
  goalLabel,
  profile,
  coachAuthored,
  firstInstruction,
}: {
  c: C;
  esc: Esc;
  plan: Plan;
  d: D;
  units: 'imperial' | 'metric';
  weightTarget: number;
  currentWeight: number;
  goalLabel: string | null;
  profile: { title: string; how: string };
  coachAuthored: boolean;
  firstInstruction: string | null;
}) {
  const onPlan = esc.level === 0;
  const unit = weightUnit(units);
  // Coach focus is honest: the coach's first standing instruction if authored, else the real
  // scoring lever for this athlete's goal (from scoringProfileLabel) — never an invented focus.
  const focus = coachAuthored && firstInstruction ? firstInstruction : profile.title;
  const water = `${displayWeightUnitless(plan.hydrationL)} L`;

  return (
    <>
      {/* Today's Objective — the plan's read on today, from the escalation engine */}
      <Eyebrow>Today&apos;s Objective</Eyebrow>
      <Reveal index={2}>
        <Card variant="low" style={{ borderRadius: 22, padding: 18, flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
          <ReqIcon c={c} name={onPlan ? 'check' : 'bolt'} tone={onPlan ? 'g' : 'b'} />
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={17} ls={-0.2}>
              {onPlan ? 'On plan today' : 'One move to make'}
            </Txt>
            <Txt w="sb" size={14} color={c.textSecondary} style={{ marginTop: 6, lineHeight: 21 }}>
              {esc.message}
            </Txt>
          </View>
        </Card>
      </Reveal>

      {/* Plan Summary — real goal + target/current weight + coach focus (2x2 tiles) */}
      <Eyebrow>Plan Summary</Eyebrow>
      <Reveal index={3}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <SummaryTile c={c} k="Goal" v={goalLabel ?? profile.title} />
          <SummaryTile c={c} k="Target weight" v={`${displayWeight(weightTarget, units)} ${unit}`} />
          <SummaryTile c={c} k="Current" v={`${displayWeight(currentWeight, units)} ${unit}`} />
          <SummaryTile c={c} k="Coach focus" v={focus} small />
        </View>
      </Reveal>

      {/* Nutrition Structure — real macro targets + the coach's real meal windows w/ real times */}
      <Eyebrow>Nutrition Structure</Eyebrow>
      <Reveal index={4}>
        <Card variant="low" style={{ borderRadius: 22, padding: 18 }}>
          <Row style={{ gap: 10 }}>
            <MacroCell c={c} v={`${plan.proteinTarget}g`} k="Protein" />
            <MacroCell c={c} v={`${d.carbTarget}g`} k="Carbs" />
            <MacroCell c={c} v={`${d.fatTarget}g`} k="Fat" />
            <MacroCell c={c} v={water} k="Water" />
          </Row>
          <View style={{ marginTop: 8 }}>
            {plan.windows.map((w, i) => (
              <Row key={w.key} style={{ justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: i < plan.windows.length - 1 ? 1 : 0, borderBottomColor: c.hairline }}>
                <Txt w="b" size={15}>{w.label}</Txt>
                <Txt w="b" size={13} color={c.textSecondary}>
                  {w.required ? `Closes ${formatWindowTime(w.deadlineMin)}` : 'Optional'}
                </Txt>
              </Row>
            ))}
          </View>
          <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 4 }}>
            Structure only. Live progress lives on Home.
          </Txt>
        </Card>
      </Reveal>

      {/* Coach Note — ONLY the coach's real standing instructions (no fabricated coach copy) */}
      {coachAuthored ? (
        <>
          <Eyebrow>Coach Note</Eyebrow>
          <Reveal index={5}>
            <Card style={{ borderRadius: 22, padding: 18 }}>
              <Row style={{ gap: 11, alignItems: 'center', marginBottom: 12 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="shield" size={19} color={c.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt w="eb" size={14}>From your coach</Txt>
                  <Txt w="b" size={11} color={c.textTertiary} style={{ marginTop: 1 }}>Standing instructions for this plan</Txt>
                </View>
              </Row>
              <View style={{ gap: 10 }}>
                {firstInstruction ? <Txt w="m" size={14.5} color={c.text} style={{ lineHeight: 21 }}>{firstInstruction}</Txt> : null}
              </View>
            </Card>
          </Reveal>
        </>
      ) : null}
      <View style={{ height: 10 }} />
    </>
  );
}

/** NUTRITION — the athlete's REAL live macro progress against the plan's targets. The proto's
 *  static "Build Your Plate" + "Approved Swaps" are coach-authored content the RN app doesn't
 *  have, so they're omitted (never invented); the hydration rule reads from the real plan. */
function NutritionTab({ c, d, plan }: { c: C; d: D; plan: Plan }) {
  return (
    <>
      <Eyebrow>Macro Targets</Eyebrow>
      <Reveal index={2}>
        <Row style={{ gap: 10 }}>
          <MacroCell c={c} v={`${plan.proteinTarget}g`} k="Protein" />
          <MacroCell c={c} v={`${d.carbTarget}g`} k="Carbs" />
          <MacroCell c={c} v={`${d.fatTarget}g`} k="Fat" />
          <MacroCell c={c} v={`${plan.calorieTarget.toLocaleString()}`} k="Calories" />
        </Row>
      </Reveal>

      <Eyebrow>Today&apos;s Progress</Eyebrow>
      <Reveal index={3}>
        <Card variant="low" style={{ borderRadius: 22, padding: 18 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Txt w="eb" size={16} ls={-0.3}>Against your targets</Txt>
            <Txt w="eb" num size={14}>
              {d.kcalToday.toLocaleString()} <Txt w="sb" num size={12} color={c.textSecondary}>/ {d.calTarget.toLocaleString()} cal</Txt>
            </Txt>
          </Row>
          <View style={{ gap: 13, marginTop: 16 }}>
            <MacroProgress c={c} label="Protein" today={d.proteinToday} target={d.proteinTarget} pct={d.proteinPct} color={c.accent} />
            <MacroProgress c={c} label="Carbs" today={d.carbsToday} target={d.carbTarget} pct={d.carbPct} color={c.hydration} />
            <MacroProgress c={c} label="Fat" today={d.fatToday} target={d.fatTarget} pct={d.fatPct} color={c.purple} />
          </View>
        </Card>
      </Reveal>

      <Eyebrow>Hydration</Eyebrow>
      <Reveal index={4}>
        <Card variant="low" style={{ borderRadius: 22, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.surface3, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="drop" size={18} color={c.hydration} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={13.5}>{displayWeightUnitless(plan.hydrationL)} L daily is the standard</Txt>
            <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
              Get water in before practice, and drink with every meal. Track it as you go on Home.
            </Txt>
          </View>
        </Card>
      </Reveal>
      <View style={{ height: 10 }} />
    </>
  );
}

/** SCHEDULE — the requirement / meal-window rulebook (proto .bd-row list): each row shows the
 *  window, its real deadline, a proof + impact chip, and is tappable to LOG (setMealType +
 *  openMeal). Real WindowStatus data; the "where you execute" sidebox closes it. */
function ScheduleTab({
  c,
  windowStatuses,
  adherence,
  esc,
  loggedCount,
  onLog,
  onEdit,
}: {
  c: C;
  windowStatuses: ReturnType<typeof mealWindowStatuses>;
  adherence: ReturnType<typeof planAdherence>;
  esc: Esc;
  loggedCount: number;
  onLog: (label: string) => void;
  onEdit: () => void;
}) {
  return (
    <>
      <Row style={{ marginTop: 26, marginBottom: 12, marginHorizontal: 2, justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt w="eb" size={11} color={c.textTertiary} ls={1.4} upper>The rules, tap one to log</Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit coach plan" onPress={onEdit} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Txt w="b" size={13} color={c.accent}>Edit</Txt>
        </Pressable>
      </Row>

      <Reveal index={2}>
        <Card variant="low" style={{ borderRadius: 22, paddingVertical: 6, paddingHorizontal: 16 }}>
          {windowStatuses.map((w, i) => {
            const st = execState(w.state, c);
            const tone: 'g' | 'a' | 'b' | 'p' = w.state === 'logged' ? 'g' : w.state === 'missed' ? 'a' : w.state === 'open' ? 'b' : 'p';
            return (
              <PressScale
                key={w.window.key}
                accessibilityLabel={`${w.window.label}, ${w.window.required ? 'required' : 'optional'}, closes ${formatWindowTime(w.window.deadlineMin)}, ${st.tag}. Tap to log.`}
                onPress={() => onLog(w.window.label)}
                style={{ paddingVertical: 14, borderBottomWidth: i < windowStatuses.length - 1 ? 1 : 0, borderBottomColor: c.hairline }}
              >
                <Row style={{ gap: 12, alignItems: 'center' }}>
                  <ReqIcon c={c} name="utensils" tone={tone} size={40} glyph={19} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Row style={{ gap: 6, alignItems: 'center' }}>
                      <Txt w="eb" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>{w.window.label}</Txt>
                      {!w.window.required ? <Txt w="b" size={12} color={c.textTertiary}>· optional</Txt> : null}
                    </Row>
                    <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 2 }}>
                      Required daily · Closes {formatWindowTime(w.window.deadlineMin)}
                    </Txt>
                  </View>
                  <Icon name="chevronRight" size={16} color={c.textTertiary} />
                </Row>
                <Row style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <WeightChip c={c} label="Photo proof" />
                  <WeightChip c={c} label={st.tag} tone={st.fg} />
                </Row>
              </PressScale>
            );
          })}
        </Card>
      </Reveal>

      {/* live objective line (escalation) so the rulebook reflects today's real state */}
      <Reveal index={3}>
        <View style={{ marginTop: 12, borderRadius: 14, padding: 13, backgroundColor: esc.level > 0 ? (esc.tone === 'reminder' ? c.surface2 : c.warnTint) : c.successTint }}>
          <Txt w="m" size={13} color={esc.level > 0 ? (esc.tone === 'reminder' ? c.slate700 : c.warnText) : c.successText} style={{ lineHeight: 19 }}>
            {esc.message} · {loggedCount} of {windowStatuses.length} logged · {adherence.adherencePct}% adherence
          </Txt>
        </View>
      </Reveal>

      {/* "Where you complete these" sidebox (proto) */}
      <Reveal index={4}>
        <Card variant="low" style={{ marginTop: 12, borderRadius: 15, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={18} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={13.5}>Where you complete these</Txt>
            <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
              This tab is the rulebook. You execute from Home — every window shows up there on its day.
            </Txt>
          </View>
        </Card>
      </Reveal>
      <View style={{ height: 10 }} />
    </>
  );
}

/** NOTES — the coach's real standing instructions (proto's thread, adapted to the real data:
 *  the RN Plan has instructions, not an AI chat). Tab only exists when instructions exist. */
function NotesTab({ c, instructions }: { c: C; instructions: string[] }) {
  return (
    <>
      <Eyebrow>Plan instructions from your coach</Eyebrow>
      <Reveal index={2}>
        <Card variant="low" style={{ borderRadius: 22, padding: 18 }}>
          <Row style={{ gap: 11, alignItems: 'center', marginBottom: 14 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shield" size={19} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={12} color={c.textTertiary} ls={0.6}>FROM YOUR COACH</Txt>
              <Txt w="eb" size={16} ls={-0.3} style={{ marginTop: 2 }}>Standing instructions</Txt>
            </View>
          </Row>
          <View style={{ gap: 10 }}>
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
      <View style={{ height: 10 }} />
    </>
  );
}

/** Summary tile (proto .tile) — 2-up grid cell with uppercase key + tight value. */
function SummaryTile({ c, k, v, small }: { c: C; k: string; v: string; small?: boolean }) {
  return (
    <View style={{ width: '47.5%', flexGrow: 1, paddingVertical: 15, paddingHorizontal: 16, borderRadius: 15, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
      <Txt w="b" size={11} color={c.textTertiary} ls={0.3} upper>{k}</Txt>
      <Txt w="eb" size={small ? 14.5 : 20} ls={-0.4} style={{ marginTop: 5, lineHeight: small ? 19 : 24 }}>{v}</Txt>
    </View>
  );
}

/** Macro cell (proto .macro) — centered value + uppercase label in a tinted tile. */
function MacroCell({ c, v, k }: { c: C; v: string; k: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, borderRadius: 15, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
      <Txt w="eb" num size={19} ls={-0.4} numberOfLines={1}>{v}</Txt>
      <Txt w="b" size={11} color={c.textTertiary} ls={0.4} upper style={{ marginTop: 3 }}>{k}</Txt>
    </View>
  );
}

/** Impact/proof chip (proto .bd-weight). */
function WeightChip({ c, label, tone }: { c: C; label: string; tone?: string }) {
  return (
    <View style={{ backgroundColor: c.surface2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
      <Txt w="b" size={11} color={tone ?? c.textTertiary}>{label}</Txt>
    </View>
  );
}

/** Live macro progress row (real derived data). */
function MacroProgress({ c, label, today, target, pct, color }: { c: C; label: string; today: number; target: number; pct: number; color: string }) {
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

/** State color + short tag for a meal window (reuses the tier/status token families). */
function execState(state: string, c: C): { fg: string; tag: string } {
  switch (state) {
    case 'logged':
      return { fg: c.successDeep, tag: 'Logged' };
    case 'missed':
      return { fg: c.alert, tag: 'Missed' };
    case 'open':
      return { fg: c.accent, tag: 'Log now' };
    default:
      return { fg: c.textTertiary, tag: 'Upcoming' };
  }
}

/** Format a liter value without a trailing ".0" (e.g. 3.8 -> "3.8", 4 -> "4"). */
function displayWeightUnitless(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
