// AthleteOS — Profile. Identity, targets, read-only "managed by your program"
// visibility panel, connections, settings, sign out.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { athleteSubtitle, computeDerived } from '@/core';
import { useStore } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, Stepper, Toggle, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';

export function Profile() {
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = computeDerived(s);
  const [editingTargets, setEditingTargets] = React.useState(false);

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
          <Txt w="eb" size={24} color="#fff">
            J
          </Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt w="eb" size={20} ls={-0.3}>
            {s.athleteName?.split(' ')[0] || 'Jihad'}
          </Txt>
          <Txt w="sb" size={14} color={colors.textSecondary} style={{ marginTop: 2 }}>
            {athleteSubtitle(s.position)}
          </Txt>
          <View style={{ marginTop: 9, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, backgroundColor: colors.accentSurface }}>
            <Txt w="b" size={12} color={colors.accent}>
              Team code · EAGLES24
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
        ) : (
          <Row style={{ gap: 10 }}>
            <TargetTile value={`${d.proteinTarget}g`} label="PROTEIN" />
            <TargetTile value={d.calTarget.toLocaleString()} label="CALORIES" />
            <TargetTile value="184lb" label="WEIGHT" />
          </Row>
        )}
        <Txt w="eb" size={12} color={colors.textTertiary} ls={0.7} style={{ marginTop: 14 }}>
          WORKING TOWARD
        </Txt>
        <Row style={{ flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {['Performance', 'Scholarship', 'Body composition'].map((g) => (
            <View key={g} style={{ paddingHorizontal: 13, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.accentSurface }}>
              <Txt w="b" size={13} color={colors.accent}>
                {g}
              </Txt>
            </View>
          ))}
        </Row>
      </Card>

      {/* visibility — managed by program (read-only) */}
      <View style={{ marginTop: 14 }}>
        <Txt w="eb" size={16} ls={-0.3} style={{ marginLeft: 4, marginBottom: 12 }}>
          Who can see your data
        </Txt>
        <Card style={{ borderRadius: 18 }}>
          <Row style={{ gap: 9, marginBottom: 8 }}>
            <Icon name="shield" size={16} color={colors.accent} />
            <Txt w="eb" size={14}>
              Managed by your program
            </Txt>
          </Row>
          <Txt w="m" size={13} color={colors.textSecondary} style={{ lineHeight: 19 }}>
            Coach Davis controls who sees your scores — that's the point of accountability. You can't hide a tough week.
          </Txt>
          <View style={{ marginTop: 16, gap: 13 }}>
            <VisRow initials="CD" bg={colors.text} title="Coach Davis" sub="Full profile & history" />
            <VisRow initials="S" bg={colors.warning} title="Sarah (Parent)" sub="Weekly reports & alerts" />
            <VisRow icon="trophy" title="Linebacker room" sub="Position leaderboard" />
          </View>
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
        <Row style={{ justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Txt w="b" size={15}>
            Units
          </Txt>
          <Txt w="sb" size={14} color={colors.textSecondary}>
            Imperial (lb) ›
          </Txt>
        </Row>
        <Row style={{ justifyContent: 'space-between', paddingVertical: 15 }}>
          <Txt w="b" size={15}>
            Help & support
          </Txt>
          <Icon name="chevronRight" size={20} color="#CBD5E1" />
        </Row>
      </Card>

      <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={s.signOut} style={[{ marginTop: 16, height: 52, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
        <Txt w="b" size={15} color={colors.alert}>
          Sign out
        </Txt>
      </Pressable>
      <Txt w="sb" size={12} color="#CBD5E1" style={{ textAlign: 'center', marginTop: 16 }}>
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
