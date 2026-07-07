// OnStandard — Account overlay (role chrome ☰ → here). Sign out → onboarding.
import React, { useState } from 'react';
import { Alert, ScrollView, Share, View } from 'react-native';
import { useStore } from '@/store';
import {
  accountIdentity, accountRows, APP_VERSION, isPro,
  type AccountRow,
} from '@/core';
import { db, isBackendLive } from '@/lib/supabase';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Row, Toggle, Txt, Pressable, PressScale, Reveal } from '@/ui/primitives';
import { Icon, IconName } from '@/icons';
import { haptics } from '@/ui/haptics';
import { buildLine } from '@/lib/buildInfo';
import { Overlay } from './Overlay';

/** Section eyebrow — the proto's `.eyebrow`: 11/800, 0.14em tracking, uppercase, text-3. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <Txt w="eb" size={11} upper color={c.textTertiary} ls={1.5} style={{ marginLeft: 2, marginBottom: 12 }}>
      {children}
    </Txt>
  );
}

/** The proto's `.lic` icon tile that leads each settings row: 38×38, radius 11, elevated
 *  surface-2 with a quiet text-2 glyph (alert rows keep the red treatment). Presentation only. */
function SettingIcon({ name, tone = 'default' }: { name: IconName; tone?: 'default' | 'alert' }) {
  const c = useColors();
  const bg = tone === 'alert' ? c.alertSurface : c.surface2;
  const fg = tone === 'alert' ? c.alert : c.textSecondary;
  return (
    <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={17} color={fg} />
    </View>
  );
}

export function Account() {
  const c = useColors();
  const s = useStore();
  // Identity card derives from real onboarding data per role (the demo keeps the
  // showcase). Account was the last identity surface still hardcoding "Coach
  // Davis" / "Eastside HS" for a real user.
  const acct = accountIdentity({ role: s.role, athleteName: s.athleteName, sport: s.sport, obMeta: s.obMeta, orgName: s.orgName });
  const rows = accountRows(s.role, s.entitlement);
  // Accordion: at most one disclosure open at a time.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Coach/trainer/parent edit their own name + org here (athletes have the Profile
  // tab). The identity card becomes a tappable entry to the self-profile editor.
  const overseer = s.flow === 'coach' || s.flow === 'trainer' || s.flow === 'parent';

  // Icon per disclosure row — presentation only; keys are the fixed AccountRow set.
  const rowIcon: Record<AccountRow['key'], IconName> = {
    team: 'squad',
    plan: 'bolt',
    help: 'user',
    legal: 'shield',
  };

  const identityCard = (
    <>
      <View style={{ width: 62, height: 62, borderRadius: 19, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.accentBorderStrong }}>
        <Txt w="eb" size={22} color={c.white}>
          {acct.initials}
        </Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt w="eb" size={20} ls={-0.4} numberOfLines={1}>
          {acct.name}
        </Txt>
        <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3 }} numberOfLines={1}>
          {acct.role}
        </Txt>
      </View>
      {overseer ? <Icon name="chevronRight" size={20} color={c.textTertiary} /> : null}
    </>
  );

  return (
    <Overlay title="Account" onClose={s.closeAccount}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 44 }} showsVerticalScrollIndicator={false}>
        {/* identity — the overlay's one hero: avatar, name, role line (tappable for overseers) */}
        <Reveal index={0}>
        {overseer ? (
          <PressScale accessibilityLabel="Edit your profile" onPress={s.openOverseerProfile} style={[{ borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: c.card, padding: 20 }, shadow.hero]}>
            {identityCard}
          </PressScale>
        ) : (
          <Card variant="hero" style={{ borderRadius: 24, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {identityCard}
          </Card>
        )}
        </Reveal>

        {/* PREFERENCES — notifications toggle + the role-tailored account disclosures */}
        <Reveal index={1}>
        <View style={{ marginTop: 26 }}>
          <Eyebrow>PREFERENCES</Eyebrow>
          <Card variant="low" style={{ borderRadius: 22, paddingVertical: 6, paddingHorizontal: 16 }}>
            {/* Notifications — proto `.lrow`: icon tile + title/sub + control, soft divider. */}
            <Row style={{ justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: c.divider2 }}>
              <Row style={{ gap: 13, alignItems: 'center', flex: 1, paddingRight: 12 }}>
                <SettingIcon name="bell" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt w="b" size={15}>
                    Notifications
                  </Txt>
                  <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>
                    {s.notif ? 'Alerts & reminders on' : 'All alerts paused'}
                  </Txt>
                </View>
              </Row>
              <Toggle on={s.notif} onPress={s.toggleNotif} label="Notifications" />
            </Row>
            {rows.map((row, i) => (
              <DisclosureRow
                key={row.key}
                row={row}
                icon={rowIcon[row.key]}
                open={openKey === row.key}
                onToggle={() => setOpenKey((k) => (k === row.key ? null : row.key))}
                border={i < rows.length - 1}
              />
            ))}
          </Card>
        </View>
        </Reveal>

        {/* PLAN — opens the compliant checkout (price, auto-renewal, trial, cancel). */}
        <Reveal index={2}>
        <View style={{ marginTop: 24 }}>
          <Eyebrow>PLAN</Eyebrow>
          <PressScale
            accessibilityLabel={isPro(s.entitlement) ? 'Manage your plan' : 'See plans'}
            onPress={s.openPlans}
            style={[{ borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline }, shadow.card]}
          >
            <SettingIcon name="bolt" />
            <View style={{ flex: 1 }}>
              <Txt w="b" size={15}>{isPro(s.entitlement) ? 'Manage your plan' : 'See plans'}</Txt>
              <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>
                {isPro(s.entitlement) ? 'Billing, seats & cancellation' : 'Pricing, trials & what’s included'}
              </Txt>
            </View>
            <Icon name="chevronRight" size={18} color={c.textTertiary} />
          </PressScale>

        </View>
        </Reveal>

        {/* YOUR DATA — GDPR/CCPA portability + Apple-required in-app deletion */}
        <Reveal index={3}>
        <View style={{ marginTop: 24 }}>
          <Eyebrow>YOUR DATA</Eyebrow>
          <Card variant="low" style={{ borderRadius: 22, paddingVertical: 6, paddingHorizontal: 16 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export my data"
              onPress={async () => {
                haptics.tap();
                try { await Share.share({ message: s.exportMyData() }); } catch { /* user cancelled the share sheet */ }
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Row style={{ justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: c.divider2 }}>
                <Row style={{ gap: 13, alignItems: 'center', flex: 1, paddingRight: 12 }}>
                  <SettingIcon name="send" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt w="b" size={15}>
                      Export my data
                    </Txt>
                    <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>
                      Download a copy of everything in your account
                    </Txt>
                  </View>
                </Row>
                <Icon name="chevronRight" size={18} color={c.textTertiary} />
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
              <Row style={{ justifyContent: 'space-between', paddingVertical: 15 }}>
                <Row style={{ gap: 13, alignItems: 'center', flex: 1, paddingRight: 12 }}>
                  <SettingIcon name="close" tone="alert" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt w="b" size={15} color={c.alert}>
                      Delete account
                    </Txt>
                    <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>
                      Permanently erase your account and data
                    </Txt>
                  </View>
                </Row>
              </Row>
            </Pressable>
          </Card>
        </View>
        </Reveal>

        {/* Sign out — destructive, framed with the alert hairline (Profile idiom). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={() => {
            haptics.tap();
            // Sign-out resets local state to the fresh install. For a user whose data
            // exists ONLY on this device (no consent to sync — including minors with an
            // unverified guardian), that is an irreversible erase of their whole record.
            // Delete-account confirms; a one-tap sign-out must too, with honest stakes.
            const localOnly = !s.userId || !s.realDataConsent;
            Alert.alert(
              'Sign out',
              localOnly
                ? 'Signing out clears the data stored on this device. Your history here is not backed up anywhere — it will be gone.'
                : 'Signing out clears this device. Your synced history stays safe in your account.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => s.signOut() },
              ],
            );
          }}
          style={({ pressed }) => [{ marginTop: 26, height: 54, borderRadius: 16, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.alertBorder, opacity: pressed ? 0.7 : 1 }, shadow.card]}
        >
          <Txt w="b" size={15} color={c.alert}>
            Sign out
          </Txt>
        </Pressable>
        {/* Version + build stamp. The second line is the exact commit this binary
            was built from (+ its OTA channel) — so you can confirm at a glance
            that your phone is running the newest code, not a stale build. */}
        <View style={{ marginTop: 16, alignItems: 'center', gap: 3 }}>
          <Txt w="sb" size={12} color={c.textSecondary}>
            OnStandard · {APP_VERSION}
          </Txt>
          <Txt w="m" size={11} color={c.textTertiary}>
            {buildLine()}
          </Txt>
        </View>
      </ScrollView>
    </Overlay>
  );
}

function DisclosureRow({
  row,
  icon,
  open,
  onToggle,
  border,
}: {
  row: AccountRow;
  icon: IconName;
  open: boolean;
  onToggle: () => void;
  border?: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ borderBottomWidth: border ? 1 : 0, borderBottomColor: c.divider2 }}>
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
          <Row style={{ gap: 13, alignItems: 'center', flex: 1, paddingRight: 10 }}>
            <SettingIcon name={icon} />
            <Txt w="b" size={15}>
              {row.label}
            </Txt>
          </Row>
          <Row style={{ gap: 8 }}>
            <Txt w="b" size={13} color={c.textSecondary}>
              {row.hint}
            </Txt>
            <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
              <Icon name="chevronRight" size={16} color={c.textTertiary} />
            </View>
          </Row>
        </Row>
      </Pressable>
      {open ? (
        <Txt w="m" size={13} color={c.textSecondary} style={{ lineHeight: 19, paddingBottom: 15, paddingLeft: 51, paddingRight: 8 }}>
          {row.detail}
        </Txt>
      ) : null}
    </View>
  );
}
