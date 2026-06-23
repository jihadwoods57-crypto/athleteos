// AthleteOS — Account overlay (role chrome ☰ → here). Sign out → onboarding.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useStore } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, Toggle, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

const ACCT_BY_ROLE: Record<string, { name: string; role: string; initials: string }> = {
  coach: { name: 'Coach Davis', role: 'Head Coach · Eastside HS', initials: 'CD' },
  parent: { name: 'Sarah Carter', role: 'Parent · linked to Jihad', initials: 'SC' },
  trainer: { name: 'Maya Anders', role: 'Trainer · Apex Performance', initials: 'MA' },
};

export function Account() {
  const s = useStore();
  const acct = ACCT_BY_ROLE[s.role ?? ''] ?? { name: s.athleteName || 'Jihad Carter', role: 'Athlete · Eastside HS', initials: 'JC' };

  return (
    <Overlay title="Account" onClose={s.closeAccount}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Card elevated style={{ borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ width: 60, height: 60, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="eb" size={21} color="#fff">
              {acct.initials}
            </Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="eb" size={19} ls={-0.3}>
              {acct.name}
            </Txt>
            <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 2 }}>
              {acct.role}
            </Txt>
          </View>
        </Card>

        <Card elevated style={{ marginTop: 14, borderRadius: 24, paddingVertical: 8 }}>
          <Row style={{ justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Txt w="b" size={15}>
                Notifications
              </Txt>
              <Txt w="m" size={13} color={colors.textTertiary} style={{ marginTop: 2 }}>
                {s.notif ? 'Alerts & reminders on' : 'All alerts paused'}
              </Txt>
            </View>
            <Toggle on={s.notif} onPress={s.toggleNotif} label="Notifications" />
          </Row>
          <SettingRow label="Team & roster" value="Manage ›" border />
          <SettingRow label="Billing & plan" value="›" border />
          <SettingRow label="Help & support" value="›" />
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
    </Overlay>
  );
}

function SettingRow({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: border ? 1 : 0, borderBottomColor: colors.border }}>
      <Txt w="b" size={15}>
        {label}
      </Txt>
      <Txt w="sb" size={14} color={colors.textSecondary}>
        {value}
      </Txt>
    </Row>
  );
}
