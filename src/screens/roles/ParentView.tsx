// OnStandard — Parent mobile view: score + reassurance, weekly compliance,
// weight + nutrition trends, coach notes, AI parent summary.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { WEIGHT_START, WEIGHT_TARGET, displayWeight, displayWeightDelta, monitoredAthlete, parentDigest, streakInfo, tierFor, weightProgressTone, weightUnit, nutritionTrend, weeklyCompliance, weightSeries, weightTrendGeometry } from '@/core';
import { useStore, useDerived } from '@/store';
import { isStreakGraceEnabled } from '@/lib/features';
import { tierChip, ringGradient, shadow, typeScale, MAX_FONT_SCALE } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Reveal, Row, SampleTag, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Ring } from '@/ui/Ring';
import { Account } from '@/screens/overlays/Account';
import { Plans } from '@/screens/overlays/Plans';
import { OverseerProfile } from '@/screens/overlays/OverseerProfile';
import { RoleTabBar, SettingRow, type RoleTab } from './roleChrome';
import type { ParentTab } from '@/core';

const PARENT_TABS: RoleTab<ParentTab>[] = [
  { key: 'overview', label: 'Home', icon: 'home' },
  { key: 'profile', label: 'Profile', icon: 'user' },
];

export function ParentView() {
  const c = useColors();
  const s = useStore();
  const d = useDerived();
  const tab = s.parentTab;
  // Weekly compliance derived from the SAME real score history the Home trend
  // chart draws, so the parent's view tracks the athlete's actual week instead
  // of a static 6/7 mock. Today is shown in progress; the % is the completed-day mean.
  const week = weeklyCompliance(s.scoreHistory, d.athleteScore);
  // Weight trend drawn from real recorded weights (live currentWeight as the
  // last point), ramping from WEIGHT_START while history is still filling. The
  // dashed goal line tracks the athlete's editable weight target.
  const weightTarget = s.weightTarget ?? WEIGHT_TARGET;
  const startWeight = s.startWeight ?? WEIGHT_START;
  const wt = weightTrendGeometry(weightSeries(s.weightHistory, s.currentWeight, startWeight), weightTarget);
  const units = s.units ?? 'imperial';
  const wUnit = weightUnit(units);
  // Nutrition bars from real per-day nutrition sub-scores; today's live score is
  // the last (accent) bar, the weekly avg headline is the completed-day mean.
  const nutri = nutritionTrend(s.nutritionHistory, d.nutritionScore);
  // The athlete this parent monitors: a real parent typed their child's name in
  // onboarding (obMeta.athleteName); the seeded demo leaves it blank and keeps
  // the showcase athlete "Jihad". So the header, reassurance line, and AI summary
  // never hand a real family the demo name, and the seeded "Coach Davis" note
  // only renders for the showcase (a real parent gets a pending empty state
  // instead of a fabricated coach quote).
  const athlete = monitoredAthlete(s.obMeta.athleteName);
  // Honest weekly read for the parent: the summary derives from the athlete's REAL
  // score band (not a frozen "no action needed"), and carries a coverage line so a
  // partial week is labelled "Building history: N of 7" instead of implying a full
  // week (parent persona finding). completedDays = real recorded days this week.
  const digest = parentDigest({ score: d.athleteScore, completedDays: s.scoreHistory.length, first: athlete.first });
  // Proto parent hero carries "· N-day streak" (coach.js `parent`): the SAME honest streak
  // source the athlete's Home uses. This screen's data cards only render for the seeded
  // showcase (athlete.isDemo), so the streak keeps the showcase seed pad — a real parent
  // never sees it (they get PendingLinkCard, no fabricated chain).
  const streak = streakInfo(s.scoreHistory, d.athleteScore, { seedPad: true, grace: isStreakGraceEnabled }).days;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {tab === 'profile' ? (
          <ParentProfile childFirst={athlete.first} />
        ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Row style={{ gap: 12, flex: 1, minWidth: 0 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Account & settings" hitSlop={6} onPress={s.openAccount} style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
                <Icon name="menu" size={20} color={c.slate600} />
              </Pressable>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt w="eb" size={12} color={c.accent} ls={1} upper>
                  Parent View
                </Txt>
                <Txt w="eb" size={26} ls={-0.6} accessibilityRole="header" style={{ marginTop: 2 }}>
                  This week
                </Txt>
                <Row style={{ gap: 7, marginTop: 6 }}>
                  {athlete.isDemo ? <SampleTag /> : null}
                  <Txt w="sb" size={12} color={c.textTertiary} numberOfLines={1} style={{ flexShrink: 1 }}>
                    {athlete.isDemo ? 'Sample data, not yet linked to your athlete' : `Waiting on ${athlete.first}'s account`}
                  </Txt>
                </Row>
              </View>
            </Row>
            <Row style={[{ gap: 8, backgroundColor: c.card, paddingLeft: 7, paddingRight: 11, paddingVertical: 7, borderRadius: 13, borderWidth: 1, borderColor: c.hairline }, shadow.card]}>
              <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Txt w="b" size={13} color={c.white} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {athlete.monogram}
                </Txt>
              </View>
              <Txt w="b" size={13} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {athlete.first}
              </Txt>
            </Row>
          </Row>

          {/* The four data cards + the "For you" digest below derive from THIS DEVICE's
              local demo state — there is no parent→child data path yet. Rendering them
              about a REAL child by name is fabricated reassurance ("nothing needs you
              this week"), the exact trust break the Human Connection pillar forbids.
              A real parent gets one honest pending card instead; the showcase (no child
              name entered) keeps the full sample dashboard, labeled. */}
          {!athlete.isDemo ? <PendingLinkCard first={athlete.first} monogram={athlete.monogram} /> : null}

          {athlete.isDemo ? (
          <>
          {/* score — the proto parent hero (coach.js `parent`): a CENTERED "Today" card, the
              score carried in the app's signature green→cyan→blue ring + tier chip. The proto's
              "N of M requirements done" is athlete-lane detail this scope withholds, so the
              streak rides next to the honest week delta, with the coverage line under it. */}
          <Reveal index={0}>
          <Card variant="hero" style={{ marginTop: 16, borderRadius: 24, padding: 22, alignItems: 'center' }}>
            <Txt w="b" size={13} color={c.textSecondary} ls={0.2}>
              Today
            </Txt>
            <View style={{ marginTop: 14 }}>
              <Ring size={148} pct={d.athleteScore} stroke={18} gradient={ringGradient} track={c.track}>
                <Txt w="eb" num size={42} ls={-0.8} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {d.athleteScore}
                </Txt>
                {(() => {
                  const t = tierFor(d.athleteScore);
                  return (
                    <View style={{ marginTop: 4, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 8, backgroundColor: tierChip[t.short].bg, borderWidth: 1, borderColor: tierChip[t.short].border }}>
                      <Txt w="eb" size={10.5} color={tierChip[t.short].fg} ls={0.2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {t.name}
                      </Txt>
                    </View>
                  );
                })()}
              </Ring>
            </View>
            <Txt w="b" size={13} color={c.textSecondary} ls={0.2} style={{ marginTop: 14 }}>
              OnStandard Score
            </Txt>
            <Row style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Row style={{ gap: 6, alignItems: 'center', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: c.surface2 }}>
                <Txt w="eb" size={13} color={d.deltaColor}>
                  {d.deltaStr}
                </Txt>
                <Txt w="sb" size={12.5} color={c.textTertiary}>
                  vs last week
                </Txt>
              </Row>
              <Row
                accessibilityRole="text"
                accessibilityLabel={`${streak} day streak`}
                style={{ gap: 6, alignItems: 'center', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: c.surface2 }}
              >
                <Icon name="flame" size={13} color={c.warningDeep} />
                <Txt w="eb" size={13} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {streak}-day streak
                </Txt>
              </Row>
            </Row>
            <Txt w="sb" size={13.5} color={c.slate700} style={{ marginTop: 12, lineHeight: 20, textAlign: 'center' }}>
              {digest.coverage}
            </Txt>
          </Card>
          </Reveal>

          {/* ---- THE WEEK IN DETAIL — the privacy-scoped read a parent is allowed: on-plan
               days, weight trend, and nutrition consistency. No macros, no meal photos. ---- */}
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} style={{ marginTop: 30, marginBottom: 2 }}>
            THE WEEK IN DETAIL
          </Txt>

          {/* weekly compliance */}
          <Reveal index={1}>
          <Card variant="low" style={{ marginTop: 12, borderRadius: 24, padding: 22 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
              <View>
                <Txt w="eb" size={16} ls={-0.3}>
                  Weekly Compliance
                </Txt>
                <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }}>
                  {week.total > 0 ? `${week.onPlan} of ${week.total} days on plan` : 'Building this week — no completed days yet'}
                </Txt>
              </View>
              <Txt w="eb" num size={30} color={week.total > 0 ? c.success : c.textTertiary} ls={-0.5} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {week.total > 0 ? `${week.pct}%` : '—'}
              </Txt>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              {week.days.map((w, i) => (
                <View key={i} style={{ alignItems: 'center', gap: 9 }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      backgroundColor: w.today
                        ? c.accentSurface
                        : w.seeded
                        ? c.track
                        : w.ok
                        ? c.successSurface
                        : c.alertSurface,
                      borderWidth: w.today ? 2 : 1,
                      borderColor: w.today ? c.accent : w.seeded ? c.border : w.ok ? c.successBorderSoft : c.alertBorder,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {w.today ? (
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} />
                    ) : w.seeded ? (
                      // pre-history day the athlete hasn't lived yet — neutral, no verdict
                      <View style={{ width: 6, height: 2, borderRadius: 1, backgroundColor: c.textTertiary, opacity: 0.5 }} />
                    ) : w.ok ? (
                      <Icon name="check" size={15} color={c.successDeep} />
                    ) : (
                      <Icon name="close" size={13} color={c.alertDeep} />
                    )}
                  </View>
                  <Txt w="b" size={11} color={w.today ? c.accent : c.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE} style={w.seeded ? { opacity: 0.5 } : undefined}>
                    {w.label}
                  </Txt>
                </View>
              ))}
            </Row>
          </Card>
          </Reveal>

          {/* weight trend */}
          <Reveal index={2}>
          <Card variant="low" style={{ marginTop: 12, borderRadius: 24, padding: 22 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                <Txt w="eb" size={16} ls={-0.3}>
                  Weight Trend
                </Txt>
                <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }}>
                  8-week build · goal {displayWeight(weightTarget, units)} {wUnit}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt w="eb" num size={26} ls={-0.5} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {displayWeight(s.currentWeight, units)}
                  <Txt w="sb" size={13} color={c.textTertiary}>
                    {' '}
                    {wUnit}
                  </Txt>
                </Txt>
                {(() => {
                  const gain = displayWeightDelta(s.currentWeight - startWeight, units);
                  const tone = weightProgressTone(s.currentWeight - startWeight, s.baseGoal);
                  const toneColor = tone === 'good' ? c.success : tone === 'bad' ? c.alert : c.textSecondary;
                  return (
                    <Txt w="b" size={12} color={toneColor} style={{ marginTop: 2 }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {gain >= 0 ? `↑ +${gain}` : `↓ ${gain}`} {wUnit}
                    </Txt>
                  );
                })()}
              </View>
            </Row>
            <Svg viewBox="0 0 322 134" width="100%" height={120} preserveAspectRatio="none" style={{ marginTop: 12 }}>
              <Defs>
                <LinearGradient id="pwt" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={c.accent} stopOpacity="0.18" />
                  <Stop offset="1" stopColor={c.accent} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Line x1="0" y1={wt.goalY} x2="322" y2={wt.goalY} stroke={c.success} strokeWidth="1.5" strokeDasharray="5 5" strokeOpacity="0.5" />
              <Path d={wt.areaPath} fill="url(#pwt)" />
              <Path d={wt.linePath} fill="none" stroke={c.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={wt.last.x} cy={wt.last.y} r={5.5} fill={c.accent} stroke={c.card} strokeWidth={2.5} />
            </Svg>
          </Card>
          </Reveal>

          {/* nutrition consistency — aggregate % of the daily protein target hit, never the
              raw macros or meal photos the parent view intentionally withholds. */}
          <Reveal index={3}>
          <Card variant="low" style={{ marginTop: 12, borderRadius: 24, padding: 22 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
              <View>
                <Txt w="eb" size={16} ls={-0.3}>
                  Nutrition Trend
                </Txt>
                <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }}>
                  Daily protein target hit
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt w="eb" num size={26} ls={-0.5} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {nutri.avg}%
                </Txt>
                <Txt w="sb" size={12} color={c.textSecondary}>
                  weekly avg
                </Txt>
              </View>
            </Row>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', height: 96 }}>
              {nutri.bars.map((h, i) => {
                const today = i === nutri.bars.length - 1;
                return (
                  <View key={i} style={{ alignItems: 'center', gap: 9, flex: 1 }}>
                    <View style={{ width: 22, height: 82, borderRadius: 7, backgroundColor: c.track, justifyContent: 'flex-end', overflow: 'hidden' }}>
                      <View style={{ width: '100%', height: `${Math.max(0, Math.min(100, h))}%`, borderRadius: 7, backgroundColor: today ? c.accentLight : c.accent }} />
                    </View>
                    <Txt w="b" size={11} color={today ? c.accent : c.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {week.days[i]?.label ?? ''}
                    </Txt>
                  </View>
                );
              })}
            </Row>
          </Card>
          </Reveal>
          </>
          ) : null}

          {/* ---- FROM THE COACH — the human line home, kept honest: a real note when one exists,
               an explicit empty state otherwise (never a fabricated coach quote for a real family). ---- */}
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} style={{ marginTop: 30, marginBottom: 2 }}>
            FROM THE COACH
          </Txt>

          {/* coach notes */}
          <Reveal index={4}>
          <Card variant="low" style={{ marginTop: 12, borderRadius: 24, padding: 22 }}>
            {athlete.isDemo ? (
              <Row style={{ gap: 13, alignItems: 'flex-start' }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt w="b" size={14} color={c.card} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    CD
                  </Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Txt w="b" size={14.5}>
                      Coach Davis
                    </Txt>
                    <Txt w="sb" size={12} color={c.textTertiary}>
                      2 days ago
                    </Txt>
                  </Row>
                  <Txt w="m" size={14} color={c.slate700} style={{ marginTop: 8, lineHeight: 21 }}>
                    Jihad's nutrition has been excellent. He's one of the most consistent in the linebacker room. We're focused on adding sleep to convert this into on-field strength. Great support at home.
                  </Txt>
                </View>
              </Row>
            ) : (
              <Row style={{ gap: 13, alignItems: 'flex-start' }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="user" size={18} color={c.slate600} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt w="b" size={14.5}>
                    No notes yet
                  </Txt>
                  <Txt w="m" size={14} color={c.slate700} style={{ marginTop: 8, lineHeight: 21 }}>
                    When {athlete.first}'s coach leaves a note, it shows up here so you stay in the loop.
                  </Txt>
                </View>
              </Row>
            )}
          </Card>
          </Reveal>

          {/* AI parent summary — demo-only: the digest narrates the local sample score,
              which must never speak about a real child. */}
          {athlete.isDemo ? (
          <Reveal index={5}>
          <View style={{ marginTop: 12, borderRadius: 24, padding: 20, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, flexDirection: 'row', gap: 14 }}>
            <View style={[{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }, shadow.low]}>
              <Icon name="sparkle" size={18} color={c.accent} />
            </View>
            <Txt w="m" size={14} color={c.slate700} style={{ flex: 1, lineHeight: 21 }}>
              <Txt w="b" size={14} color={c.accent}>
                For you ·{' '}
              </Txt>
              {digest.summary}
            </Txt>
          </View>
          </Reveal>
          ) : null}

          {/* Proto sidebox (coach.js `parent`, screens.css .sidebox): the privacy contract,
              stated in-product. Copy adapted honestly to THIS view's real scope (it shows
              score, streak, and the weekly/weight/nutrition trends, so only what it truly
              withholds is claimed): meal photos, macros, and check-in answers stay in the
              athlete's lane. PRESERVE this scoping exactly — never widen it. */}
          <Reveal index={6}>
          <View
            accessibilityRole="text"
            accessibilityLabel={`What parents see. Score, streak, and trends only. Meal photos, macros, and check-in answers stay between ${athlete.first} and their coach.`}
            style={{ marginTop: 14, borderRadius: 15, padding: 15, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shield" size={17} color={c.accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt w="eb" size={13.5} ls={-0.1}>What parents see</Txt>
              <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
                Score, streak, and trends only. Meal photos, macros, and check-in answers stay between {athlete.first} and their coach.
              </Txt>
            </View>
          </View>
          </Reveal>
        </ScrollView>
        )}
      </SafeAreaView>

      <RoleTabBar tabs={PARENT_TABS} active={tab} onChange={s.setParentTab} />

      {s.accountOpen && <Account />}
      {s.plansOpen && <Plans />}
      {s.overseerProfileOpen && <OverseerProfile />}
    </View>
  );
}

/** The honest state for a REAL parent: no fabricated dashboard, one card that says
 *  exactly where things stand and what will appear here. Absence beats theater for
 *  the one persona whose entire pillar is trust. */
function PendingLinkCard({ first, monogram }: { first: string; monogram: string }) {
  const c = useColors();
  return (
    <Card variant="hero" style={{ marginTop: 16, borderRadius: 24, padding: 22 }}>
      <Row style={{ gap: 14, alignItems: 'center' }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="b" size={18} color={c.white} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {monogram}
          </Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt w="eb" size={17} ls={-0.3}>
            {first}'s day isn't linked yet
          </Txt>
          <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }}>
            Nothing on this screen is live data yet
          </Txt>
        </View>
      </Row>
      <Txt w="m" size={14} color={c.slate700} style={{ marginTop: 16, lineHeight: 21 }}>
        Once {first} is on OnStandard and account linking opens up, you'll see their real score,
        logged meals, and weekly trend here — never estimates, never samples. We'll say so the
        moment it's live.
      </Txt>
    </Card>
  );
}

/** Parent Profile tab — identity + settings entry points (parent is a read-only observer). */
function ParentProfile({ childFirst }: { childFirst: string }) {
  const c = useColors();
  const s = useStore();
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
      <Txt w="eb" size={12} color={c.accent} ls={1} upper style={{ marginBottom: 6 }}>Parent</Txt>
      <Txt w="eb" size={28} ls={-0.8} style={{ marginBottom: 20 }}>Profile</Txt>
      <View style={{ gap: 10 }}>
        <SettingRow icon="menu" label="Account & settings" sub="Name, sign out, data export" onPress={s.openAccount} />
        <SettingRow icon="user" label="Profile & alerts" sub={`How you follow ${childFirst} · notifications`} onPress={s.openOverseerProfile} />
      </View>
    </ScrollView>
  );
}
