// OnStandard — Account overlay (role chrome ☰ → here). Sign out → onboarding.
import React, { useState } from 'react';
import { Alert, ScrollView, Share, View } from 'react-native';
import { useStore } from '@/store';
import {
  accountIdentity, accountRows, APP_VERSION, isPro,
  generateReferralCode, referralShareMessage, referralSummary,
  type AccountRow,
} from '@/core';
import { db, isBackendLive } from '@/lib/supabase';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Row, Toggle, Txt, Pressable, PressScale, Reveal } from '@/ui/primitives';
import { Icon } from '@/icons';
import { haptics } from '@/ui/haptics';
import { Overlay } from './Overlay';

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

  const identityCard = (
    <>
      <View style={{ width: 60, height: 60, borderRadius: 18, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Txt w="eb" size={21} color={c.white}>
          {acct.initials}
        </Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt w="eb" size={19} ls={-0.3}>
          {acct.name}
        </Txt>
        <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 2 }}>
          {acct.role}
        </Txt>
      </View>
      {overseer ? <Icon name="chevronRight" size={20} color={c.textTertiary} /> : null}
    </>
  );

  return (
    <Overlay title="Account" onClose={s.closeAccount}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Reveal index={0}>
        {overseer ? (
          <PressScale accessibilityLabel="Edit your profile" onPress={s.openOverseerProfile} style={[{ borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: c.card, padding: 18 }, shadow.elevated]}>
            {identityCard}
          </PressScale>
        ) : (
          <Card variant="hero" style={{ borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {identityCard}
          </Card>
        )}
        </Reveal>

        <Reveal index={1}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 24, paddingVertical: 8 }}>
          <Row style={{ justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: c.border }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Txt w="b" size={15}>
                Notifications
              </Txt>
              <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 2 }}>
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
        </Reveal>

        {/* Plans / billing — opens the compliant checkout (price, auto-renewal, trial, cancel). */}
        <Reveal index={2}>
        <PressScale
          accessibilityLabel={isPro(s.entitlement) ? 'Manage your plan' : 'See plans'}
          onPress={s.openPlans}
          style={[{ marginTop: 14, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card }, shadow.card]}
        >
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bolt" size={18} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="b" size={15}>{isPro(s.entitlement) ? 'Manage your plan' : 'See plans'}</Txt>
            <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>
              {isPro(s.entitlement) ? 'Billing, seats & cancellation' : 'Pricing, trials & what’s included'}
            </Txt>
          </View>
          <Icon name="chevronRight" size={18} color={c.textTertiary} />
        </PressScale>
        </Reveal>

        {/* Referral loop — give a month, get a month. */}
        <Reveal index={3}>
          <ReferralCard />
        </Reveal>

        {/* Your data — GDPR/CCPA portability + Apple-required in-app deletion */}
        <Reveal index={3}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 24, paddingVertical: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export my data"
            onPress={async () => {
              haptics.tap();
              try { await Share.share({ message: s.exportMyData() }); } catch { /* user cancelled the share sheet */ }
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Row style={{ justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Txt w="b" size={15}>
                  Export my data
                </Txt>
                <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 2 }}>
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
                <Txt w="b" size={15} color={c.alert}>
                  Delete account
                </Txt>
                <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 2 }}>
                  Permanently erase your account and data
                </Txt>
              </View>
            </Row>
          </Pressable>
        </Card>
        </Reveal>

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
          style={[{ marginTop: 16, height: 52, borderRadius: 16, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }, shadow.card]}
        >
          <Txt w="b" size={15} color={c.alert}>
            Sign out
          </Txt>
        </Pressable>
        <Txt w="sb" size={12} color={c.textSecondary} style={{ textAlign: 'center', marginTop: 16 }}>
          OnStandard · {APP_VERSION}
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
  const c = useColors();
  return (
    <View style={{ borderBottomWidth: border ? 1 : 0, borderBottomColor: c.border }}>
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
            <Txt w="sb" size={14} color={c.textSecondary}>
              {row.hint}
            </Txt>
            <Txt w="b" size={15} color={c.textTertiary} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
              ›
            </Txt>
          </Row>
        </Row>
      </Pressable>
      {open ? (
        <Txt w="m" size={13} color={c.textSecondary} style={{ lineHeight: 19, paddingBottom: 15, paddingRight: 8 }}>
          {row.detail}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * Referral loop — give a month, get a month. The card lazily ensures the signed-in user
 * owns a share code (created client-side, unique-checked by the db), shows the honest
 * earned/pending summary from the server-written redemptions, and shares the code via the
 * native sheet. Preview accounts (no backend / not signed in) see honest launch copy —
 * never a fake code.
 */
function ReferralCard() {
  const c = useColors();
  const s = useStore();
  const live = isBackendLive && !!s.userId;
  const [code, setCode] = useState<string | null>(null);
  const [line, setLine] = useState<string>('Share your code. When someone subscribes with it, you both get a free month.');

  React.useEffect(() => {
    if (!live || !s.userId) return;
    const uid = s.userId;
    let cancelled = false;
    (async () => {
      try {
        // Ensure a code exists (one retry on the astronomically-unlikely collision).
        let row = await db.fetchReferralCode(uid);
        if (!row) {
          for (let attempt = 0; attempt < 2 && !row; attempt++) {
            try {
              await db.createReferralCode(uid, generateReferralCode());
              row = await db.fetchReferralCode(uid);
            } catch { /* collision or transient error — retry once, else stay pending */ }
          }
        }
        if (!cancelled && row) setCode(row.code);
        const redemptions = await db.fetchReferralRedemptions(uid);
        if (!cancelled) setLine(referralSummary(redemptions).line);
      } catch { /* offline — keep the default line, card still explains the program */ }
    })();
    return () => { cancelled = true; };
  }, [live, s.userId]);

  const onShare = async () => {
    haptics.tap();
    if (!code) return;
    try { await Share.share({ message: referralShareMessage(code) }); } catch { /* user cancelled */ }
  };

  return (
    <Card variant="low" style={{ marginTop: 14, borderRadius: 20, padding: 16 }}>
      <Row style={{ gap: 12, alignItems: 'center' }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="squad" size={18} color={c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={15}>Refer & earn</Txt>
          <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1, lineHeight: 17 }}>{line}</Txt>
        </View>
      </Row>
      {live && code ? (
        <Row style={{ gap: 10, marginTop: 12 }}>
          <View style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="eb" num size={17} ls={2}>{code}</Txt>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share your referral code"
            onPress={onShare}
            style={({ pressed }) => [{ paddingHorizontal: 18, height: 46, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 }]}
          >
            <Txt w="b" size={14} color={c.white}>Share</Txt>
          </Pressable>
        </Row>
      ) : (
        <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 10, lineHeight: 17 }}>
          {live ? 'Setting up your code…' : 'Referral codes go live with the public launch.'}
        </Txt>
      )}
    </Card>
  );
}
