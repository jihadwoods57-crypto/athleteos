// AthleteOS — Coach / Trainer / Parent self-profile (Phase 2). The audit found these
// roles had no way to edit their own identity after onboarding — only the athlete
// had a Profile. This overlay (entry: the Account identity card) lets an overseer
// edit their display name + org/team name, with the shared notifications + units
// controls and a read-only roster/join-code summary. Name persists to the profiles
// row when live (pushProfile); org name is local-display until a backend column
// exists (see accounts-and-settings spec). Demo-safe: edits update the live
// dashboard title immediately.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { accountIdentity, enabledAlertCount, OVERSEER_ALERT_DEFS, rosterNoun, ROSTER, TRAINER_CLIENTS } from '@/core';
import { useStore } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { colors, shadow } from '@/ui/tokens';
import { Card, Input, Row, SampleTag, Toggle, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

export function OverseerProfile() {
  const s = useStore();
  const acct = accountIdentity({ role: s.role, athleteName: s.athleteName, sport: s.sport, obMeta: s.obMeta, orgName: s.orgName });
  const isCoach = s.flow === 'coach';
  const isTrainer = s.flow === 'trainer';
  const isParent = s.flow === 'parent';
  // The org field's label + placeholder speak the role's own language.
  const orgLabel = isCoach ? 'Team or school' : isTrainer ? 'Practice or gym' : 'Organization';
  const orgPlaceholder = isCoach ? 'e.g. Eastside High School' : isTrainer ? 'e.g. Apex Performance' : 'Optional';
  // Real roster/book count when live; the seeded showcase counts otherwise.
  const count = isCoach ? ROSTER.length : isTrainer ? TRAINER_CLIENTS.length : 1;
  const noun = rosterNoun(s.flow);

  return (
    <Overlay title="Your Profile" onClose={s.closeOverseerProfile}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* identity preview */}
        <Card elevated style={{ borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ width: 56, height: 56, borderRadius: 17, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="eb" size={20} color="#fff">{acct.initials}</Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="eb" size={18} ls={-0.3}>{acct.name}</Txt>
            <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 2 }}>{acct.role}</Txt>
          </View>
        </Card>

        {/* editable identity */}
        <Card style={{ marginTop: 14, borderRadius: 20, gap: 14 }}>
          <View>
            <Txt w="eb" size={11} color={colors.textTertiary} ls={0.5} upper style={{ marginBottom: 8 }}>
              Your name
            </Txt>
            <Input value={s.athleteName} onChangeText={s.setDisplayName} placeholder="Full name" autoCapitalize="words" accessibilityLabel="Your name" />
          </View>
          {!isParent ? (
            <View>
              <Txt w="eb" size={11} color={colors.textTertiary} ls={0.5} upper style={{ marginBottom: 8 }}>
                {orgLabel}
              </Txt>
              <Input value={s.orgName} onChangeText={s.setOrgName} placeholder={orgPlaceholder} autoCapitalize="words" accessibilityLabel={orgLabel} />
              <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 6 }}>
                Shown as your dashboard title.
              </Txt>
            </View>
          ) : null}
        </Card>

        {/* roster / join code summary (read-only) */}
        {!isParent ? (
          <Card style={{ marginTop: 14, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="squad" size={19} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="b" size={14}>{count} {count === 1 ? noun.toLowerCase() : `${noun.toLowerCase()}s`}</Txt>
              <Row style={{ gap: 6, marginTop: 2 }}>
                <Txt w="m" size={12} color={colors.textTertiary}>Join code · {s.teamCode || 'EAGLES24'}</Txt>
                {isBackendLive ? null : <SampleTag />}
              </Row>
            </View>
            <Icon name="copy" size={18} color={colors.textTertiary} />
          </Card>
        ) : null}

        {/* shared preferences */}
        <Card style={{ marginTop: 14, borderRadius: 20, paddingVertical: 6 }}>
          <Row style={{ justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Txt w="b" size={15}>Notifications</Txt>
              <Txt w="m" size={13} color={colors.textTertiary} style={{ marginTop: 2 }}>
                {s.notif ? 'Alerts & reminders on' : 'All alerts paused'}
              </Txt>
            </View>
            <Toggle on={s.notif} onPress={s.toggleNotif} label="Notifications" />
          </Row>
          <Pressable accessibilityRole="button" accessibilityLabel="Toggle units" onPress={s.toggleUnits} style={({ pressed }) => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, opacity: pressed ? 0.7 : 1 })}>
            <Txt w="b" size={15}>Units</Txt>
            <Row style={{ gap: 6 }}>
              <Txt w="sb" size={14} color={colors.textSecondary}>{s.units === 'metric' ? 'Metric (kg)' : 'Imperial (lb)'}</Txt>
              <Icon name="chevronRight" size={17} color={colors.textTertiary} />
            </Row>
          </Pressable>
        </Card>

        {/* per-event alert preferences */}
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 10, marginLeft: 2 }}>
          <Txt w="eb" size={12} color={colors.textTertiary} ls={0.5} upper>
            Alerts you receive
          </Txt>
          <Txt w="b" size={12} color={colors.textTertiary}>
            {enabledAlertCount(s.overseerAlerts)} of {OVERSEER_ALERT_DEFS.length} on
          </Txt>
        </Row>
        {!s.notif ? (
          <Txt w="m" size={12} color={colors.textTertiary} style={{ marginBottom: 10, marginLeft: 2, lineHeight: 17 }}>
            Notifications are off, so none of these fire. Turn them on above. Your choices below are saved either way.
          </Txt>
        ) : null}
        <Card style={{ borderRadius: 20, paddingVertical: 4 }}>
          {OVERSEER_ALERT_DEFS.map((d, i) => (
            <Row key={d.key} style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: i < OVERSEER_ALERT_DEFS.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Txt w="b" size={14}>{d.label}</Txt>
                <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 2, lineHeight: 17 }}>{d.desc}</Txt>
              </View>
              <Toggle on={s.overseerAlerts[d.key]} onPress={() => s.toggleOverseerAlert(d.key)} label={d.label} />
            </Row>
          ))}
        </Card>

        {/* sync status — honest about what leaves the device */}
        <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 16, paddingHorizontal: 4, lineHeight: 17 }}>
          {isBackendLive
            ? 'Your name syncs to your account. Changes apply across your devices.'
            : 'Saved on this device. Your profile syncs to your account once your team is connected.'}
        </Txt>

        <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={s.closeOverseerProfile} style={[{ height: 54, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 18 }, shadow.cta]}>
          <Txt w="b" size={15} color="#fff">Done</Txt>
        </Pressable>
      </ScrollView>
    </Overlay>
  );
}
