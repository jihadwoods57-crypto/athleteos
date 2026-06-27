// AthleteOS — Account overlay (role chrome ☰ → here). Sign out → onboarding.
import React, { useState } from 'react';
import { Alert, ScrollView, Share, View } from 'react-native';
import { useStore } from '@/store';
import { accountIdentity, accountRows, APP_VERSION, type AccountRow } from '@/core';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, Toggle, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Overlay } from './Overlay';

export function Account() {
  const s = useStore();
  // Identity card derives from real onboarding data per role (the demo keeps the
  // showcase). Account was the last identity surface still hardcoding "Coach
  // Davis" / "Eastside HS" for a real user.
  const acct = accountIdentity({ role: s.role, athleteName: s.athleteName, sport: s.sport, obMeta: s.obMeta });
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

        {/* Your data — GDPR/CCPA portability + Apple-required in-app deletion */}
        <Card elevated style={{ marginTop: 14, borderRadius: 24, paddingVertical: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export my data"
            onPress={async () => {
              haptics.tap();
              try { await Share.share({ message: s.exportMyData() }); } catch { /* user cancelled the share sheet */ }
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Row style={{ justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Txt w="b" size={15}>
                  Export my data
                </Txt>
                <Txt w="m" size={13} color={colors.textTertiary} style={{ marginTop: 2 }}>
                  Download a copy of everything in your account
                </Txt>
              </View>
            </Row>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete account"
            onPress={() => {
              haptics.tap();
              Alert.alert(
                'Delete account',
                'This permanently deletes your account and all of your data. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => { void s.deleteAccount(); } },
                ],
              );
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Row style={{ justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 2 }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Txt w="b" size={15} color={colors.alert}>
                  Delete account
                </Txt>
                <Txt w="m" size={13} color={colors.textTertiary} style={{ marginTop: 2 }}>
                  Permanently erase your account and data
                </Txt>
              </View>
            </Row>
          </Pressable>
        </Card>

        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={s.signOut} style={[{ marginTop: 16, height: 52, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
          <Txt w="b" size={15} color={colors.alert}>
            Sign out
          </Txt>
        </Pressable>
        <Txt w="sb" size={12} color={colors.textSecondary} style={{ textAlign: 'center', marginTop: 16 }}>
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
