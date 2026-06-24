// AthleteOS — Profile. Identity, targets, read-only "managed by your program"
// visibility panel, connections, settings, sign out.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { athleteSubtitle, computeDerived, displayWeight, firstName, GOAL_LABELS, initials, supportVisibilityRows, trainingCadence, weightStepLb, weightUnit, WEIGHT_TARGET } from '@/core';
import { useStore } from '@/store';
import { colors, MAX_FONT_SCALE, shadow } from '@/ui/tokens';
import { Card, Row, Stepper, Toggle, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';

/** Avatar initial + color per support-team role for the visibility rows. */
const VIS_INITIALS: Record<string, string> = { coach: 'C', trainer: 'T', nutritionist: 'N', parent: 'P' };
const VIS_COLORS: Record<string, string> = { coach: colors.text, trainer: colors.trainer, nutritionist: colors.success, parent: colors.warning };

export function Profile() {
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = computeDerived(s);
  const units = s.units ?? 'imperial';
  const wStepLb = weightStepLb(units);
  const weightTarget = s.weightTarget ?? WEIGHT_TARGET;
  const [editingTargets, setEditingTargets] = React.useState(false);

  // Real athlete (completed the new onboarding, so a name is set) vs the seeded
  // demo (athleteName ''). For a real athlete every identity surface derives from
  // their own onboarding answers; the demo keeps the Jihad / Eastside / Coach
  // Davis showcase so it is unchanged.
  const isReal = s.athleteName.trim().length > 0;
  const goalLabel = s.primaryGoal ? GOAL_LABELS[s.primaryGoal] : null;
  const idChip = isReal
    ? s.inviteCode.trim()
      ? `Team code · ${s.inviteCode.trim()}`
      : goalLabel
        ? `Goal · ${goalLabel}`
        : 'Solo athlete'
    : 'Team code · EAGLES24';
  const workingToward = isReal
    ? goalLabel
      ? [goalLabel]
      : []
    : ['Performance', 'Scholarship', 'Body composition'];
  // Surface the onboarding training-cadence answer (otherwise collected but never
  // shown). Null for the seeded demo, so its identity card is unchanged.
  const cadence = trainingCadence(s.trainingFreq);
  const visRows = supportVisibilityRows(s.supportTeam);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      <Txt w="sb" size={14} color={colors.textSecondary}>
        Account
      </Txt>
      <Txt w="eb" size={28} ls={-0.8} style={{ marginTop: 1 }}>
        Profile
      </Txt>

      {/* identity */}
      <Card elevated style={{ marginTop: 18, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="eb" size={24} color="#fff" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {initials(s.athleteName, 'J')}
          </Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt w="eb" size={20} ls={-0.3}>
            {firstName(s.athleteName, 'Jihad')}
          </Txt>
          <Txt w="sb" size={14} color={colors.textSecondary} style={{ marginTop: 2 }}>
            {athleteSubtitle(s.position, s.sport)}
          </Txt>
          {cadence ? (
            <Row style={{ gap: 5, marginTop: 4 }}>
              <Icon name="bolt" size={13} color={colors.textTertiary} />
              <Txt w="m" size={13} color={colors.textTertiary}>
                {cadence}
              </Txt>
            </Row>
          ) : null}
          <View style={{ marginTop: 9, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, backgroundColor: colors.accentSurface }}>
            <Txt w="b" size={12} color={colors.accent}>
              {idChip}
            </Txt>
          </View>
        </View>
      </Card>

      {/* targets */}
      <Card elevated style={{ marginTop: 14, borderRadius: 24 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <Txt w="eb" size={16} ls={-0.3}>
            Your Targets
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editingTargets ? 'Done editing targets' : 'Edit nutrition targets'}
            hitSlop={10}
            onPress={() => setEditingTargets((e) => !e)}
          >
            <Txt w="b" size={13} color={colors.accent}>
              {editingTargets ? 'Done' : 'Edit'}
            </Txt>
          </Pressable>
        </Row>
        {editingTargets ? (
          <View style={{ gap: 12 }}>
            <Row style={{ gap: 10, alignItems: 'flex-start' }}>
              <Stepper
                label="Protein"
                unit="g / day"
                value={`${d.proteinTarget}g`}
                onDec={() => s.adjustProteinTarget(-10)}
                onInc={() => s.adjustProteinTarget(10)}
              />
              <Stepper
                label="Calories"
                unit="kcal / day"
                value={d.calTarget.toLocaleString()}
                onDec={() => s.adjustCalTarget(-50)}
                onInc={() => s.adjustCalTarget(50)}
              />
            </Row>
            <Stepper
              label="Weight"
              unit={`${weightUnit(units)} season goal`}
              value={`${displayWeight(weightTarget, units)}`}
              onDec={() => s.adjustWeightTarget(-wStepLb)}
              onInc={() => s.adjustWeightTarget(wStepLb)}
            />
          </View>
        ) : (
          <Row style={{ gap: 10 }}>
            <TargetTile value={`${d.proteinTarget}g`} label="PROTEIN" />
            <TargetTile value={d.calTarget.toLocaleString()} label="CALORIES" />
            <TargetTile value={`${displayWeight(weightTarget, units)}${weightUnit(units)}`} label="WEIGHT" />
          </Row>
        )}
        {workingToward.length > 0 ? (
          <>
            <Txt w="eb" size={12} color={colors.textTertiary} ls={0.7} style={{ marginTop: 14 }}>
              WORKING TOWARD
            </Txt>
            <Row style={{ flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {workingToward.map((g) => (
                <View key={g} style={{ paddingHorizontal: 13, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.accentSurface }}>
                  <Txt w="b" size={13} color={colors.accent}>
                    {g}
                  </Txt>
                </View>
              ))}
            </Row>
          </>
        ) : null}
      </Card>

      {/* visibility — derived from the athlete's chosen support team (read-only) */}
      <View style={{ marginTop: 14 }}>
        <Txt w="eb" size={16} ls={-0.3} style={{ marginLeft: 4, marginBottom: 12 }}>
          Who can see your data
        </Txt>
        <Card style={{ borderRadius: 18 }}>
          {isReal ? (
            visRows.length > 0 ? (
              <>
                <Row style={{ gap: 9, marginBottom: 8 }}>
                  <Icon name="shield" size={16} color={colors.accent} />
                  <Txt w="eb" size={14}>
                    Your accountability circle
                  </Txt>
                </Row>
                <Txt w="m" size={13} color={colors.textSecondary} style={{ lineHeight: 19 }}>
                  These people see your scores. Accountability works when the right people are watching, so you can't hide a tough week.
                </Txt>
                <View style={{ marginTop: 16, gap: 13 }}>
                  {visRows.map((r) => (
                    <VisRow key={r.key} initials={VIS_INITIALS[r.key] ?? r.title[0]} bg={VIS_COLORS[r.key] ?? colors.text} title={r.title} sub={r.sub} />
                  ))}
                </View>
              </>
            ) : (
              <>
                <Row style={{ gap: 9, marginBottom: 8 }}>
                  <Icon name="shield" size={16} color={colors.accent} />
                  <Txt w="eb" size={14}>
                    Just you, for now
                  </Txt>
                </Row>
                <Txt w="m" size={13} color={colors.textSecondary} style={{ lineHeight: 19 }}>
                  No one else is connected yet. Add a coach, trainer, or parent from your support team and they'll see your weekly progress, so the accountability has someone to answer to.
                </Txt>
              </>
            )
          ) : (
            <>
              <Row style={{ gap: 9, marginBottom: 8 }}>
                <Icon name="shield" size={16} color={colors.accent} />
                <Txt w="eb" size={14}>
                  Managed by your program
                </Txt>
              </Row>
              <Txt w="m" size={13} color={colors.textSecondary} style={{ lineHeight: 19 }}>
                Coach Davis controls who sees your scores, and that's the point of accountability. You can't hide a tough week.
              </Txt>
              <View style={{ marginTop: 16, gap: 13 }}>
                <VisRow initials="CD" bg={colors.text} title="Coach Davis" sub="Full profile & history" />
                <VisRow initials="S" bg={colors.warning} title="Sarah (Parent)" sub="Weekly reports & alerts" />
                <VisRow icon="trophy" title="Linebacker room" sub="Position leaderboard" />
              </View>
            </>
          )}
        </Card>
      </View>

      {/* settings */}
      <Card elevated style={{ marginTop: 14, borderRadius: 24, paddingVertical: 8 }}>
        <Row style={{ justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View>
            <Txt w="b" size={15}>
              Notifications
            </Txt>
            <Txt w="m" size={13} color={colors.textTertiary}>
              Meal, hydration & check-in reminders
            </Txt>
          </View>
          <Toggle on={s.notif} onPress={s.toggleNotif} label="Notifications" />
        </Row>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Units: ${units === 'metric' ? 'Metric, kilograms' : 'Imperial, pounds'}. Tap to switch.`}
          onPress={s.toggleUnits}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Row style={{ justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Txt w="b" size={15}>
              Units
            </Txt>
            <Txt w="sb" size={14} color={colors.accent}>
              {units === 'metric' ? 'Metric (kg)' : 'Imperial (lb)'}
            </Txt>
          </Row>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Help and support"
          onPress={s.openAccount}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Row style={{ justifyContent: 'space-between', paddingVertical: 15 }}>
            <Txt w="b" size={15}>
              Help & support
            </Txt>
            <Icon name="chevronRight" size={20} color="#CBD5E1" />
          </Row>
        </Pressable>
      </Card>

      <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={s.signOut} style={[{ marginTop: 16, height: 52, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
        <Txt w="b" size={15} color={colors.alert}>
          Sign out
        </Txt>
      </Pressable>
      <Txt w="sb" size={12} color={colors.textSecondary} style={{ textAlign: 'center', marginTop: 16 }}>
        AthleteOS · v1.0
      </Txt>
    </ScrollView>
  );
}

function TargetTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 16, padding: 14 }}>
      <Txt w="eb" size={22}>
        {value}
      </Txt>
      <Txt w="b" size={11} color={colors.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
    </View>
  );
}

function VisRow({ initials, bg, icon, title, sub }: { initials?: string; bg?: string; icon?: any; title: string; sub: string }) {
  return (
    <Row style={{ gap: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: icon ? colors.accentSurface : bg, alignItems: 'center', justifyContent: 'center' }}>
        {icon ? <Icon name={icon} size={18} color={colors.accent} /> : <Txt w="b" size={12} color="#fff">{initials}</Txt>}
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="b" size={14}>
          {title}
        </Txt>
        <Txt w="m" size={12} color={colors.textTertiary}>
          {sub}
        </Txt>
      </View>
      <Txt w="b" size={12} color={colors.success}>
        On
      </Txt>
    </Row>
  );
}
