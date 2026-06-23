// AthleteOS — Account overlay (role chrome ☰ → here). Sign out → onboarding.
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useStore } from '@/store';
import { accountRows, APP_VERSION, type AccountRow } from '@/core';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, Toggle, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Overlay } from './Overlay';

const ACCT_BY_ROLE: Record<string, { name: string; role: string; initials: string }> = {
  coach: { name: 'Coach Davis', role: 'Head Coach · Eastside HS', initials: 'CD' },
  parent: { name: 'Sarah Carter', role: 'Parent · linked to Jihad', initials: 'SC' },
  trainer: { name: 'Maya Anders', role: 'Trainer · Apex Performance', initials: 'MA' },
};

export function Account() {
  const s = useStore();
  const acct = ACCT_BY_ROLE[s.role ?? ''] ?? { name: s.athleteName || 'Jihad Carter', role: 'Athlete · Eastside HS', initials: 'JC' };
  const rows = accountRows(s.role);
  // Accordion: at most one disclosure open at a time.
  const [openKey, setOpenKey] = useState<string | null>(null);

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
          {rows.map((row, i) => (
            <DisclosureRow
              key={row.key}
              row={row}
              open={openKey === row.key}
              onToggle={() => setOpenKey((k) => (k === row.key ? null : row.key))}
              border={i < rows.length - 1}
            />
          ))}
        </Card>

        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={s.signOut} style={[{ marginTop: 16, height: 52, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
          <Txt w="b" size={15} color={colors.alert}>
            Sign out
          </Txt>
        </Pressable>
        <Txt w="sb" size={12} color="#CBD5E1" style={{ textAlign: 'center', marginTop: 16 }}>
          AthleteOS · {APP_VERSION}
        </Txt>
      </ScrollView>
    </Overlay>
  );
}

function DisclosureRow({
  row,
  open,
  onToggle,
  border,
}: {
  row: AccountRow;
  open: boolean;
  onToggle: () => void;
  border?: boolean;
}) {
  return (
    <View style={{ borderBottomWidth: border ? 1 : 0, borderBottomColor: colors.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.label}, ${row.hint}`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          haptics.select();
          onToggle();
        }}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Row style={{ justifyContent: 'space-between', paddingVertical: 15 }}>
          <Txt w="b" size={15}>
            {row.label}
          </Txt>
          <Row style={{ gap: 8 }}>
            <Txt w="sb" size={14} color={colors.textSecondary}>
              {row.hint}
            </Txt>
            <Txt w="b" size={15} color={colors.textTertiary} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
              ›
            </Txt>
          </Row>
        </Row>
      </Pressable>
      {open ? (
        <Txt w="m" size={13} color={colors.textSecondary} style={{ lineHeight: 19, paddingBottom: 15, paddingRight: 8 }}>
          {row.detail}
        </Txt>
      ) : null}
    </View>
  );
}
