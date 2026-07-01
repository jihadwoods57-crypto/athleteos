// OnStandard — Reminders settings (P3). Toggle each reminder on/off and set the
// local hour it fires. Reads/writes the persisted `reminderSettings`; the actual
// local-notification scheduling is a device seam (src/lib/notify), gated by
// isNotifyAvailable + the master `notif` flag, so this screen configures the
// schedule rather than firing anything itself.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { REMINDER_DEFS, formatReminderHour, type ReminderKind } from '@/core';
import { useStore } from '@/store';
import { colors } from '@/ui/tokens';
import { Card, Row, Txt, Pressable, Toggle, Reveal } from '@/ui/primitives';
import { Icon } from '@/icons';

export function Reminders() {
  const insets = useSafeAreaInsets();
  const notif = useStore((s) => s.notif);
  const reminderSettings = useStore((s) => s.reminderSettings);
  const toggleReminder = useStore((s) => s.toggleReminder);
  const setReminderHour = useStore((s) => s.setReminderHour);
  const goProfile = useStore((s) => s.goProfile);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 140 }}
      showsVerticalScrollIndicator={false}
    >
      {/* header */}
      <Row style={{ gap: 6, alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Profile" hitSlop={8} onPress={goProfile} style={{ marginLeft: -6, padding: 6 }}>
          <Icon name="chevronLeft" size={24} color={colors.text} />
        </Pressable>
        <Txt w="eb" size={28} ls={-0.8}>
          Reminders
        </Txt>
      </Row>
      <Txt w="sb" size={14} color={colors.textSecondary} style={{ marginTop: 2, marginLeft: 30 }}>
        Timely nudges to keep your day on track
      </Txt>

      {/* master-state note — honest about when these actually fire */}
      {!notif ? (
        <Reveal index={0}>
        <Card variant="low" style={{ marginTop: 18, borderRadius: 18, flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.accentSurface }}>
          <Icon name="bell" size={18} color={colors.accent} />
          <Txt w="m" size={13} color={colors.textSecondary} style={{ flex: 1, lineHeight: 19 }}>
            Notifications are off. Turn them on in Profile to start receiving these reminders. Your choices below are saved either way.
          </Txt>
        </Card>
        </Reveal>
      ) : null}

      <Reveal index={1}>
      <View style={{ marginTop: 18, gap: 12 }}>
        {REMINDER_DEFS.map((def) => {
          const set = reminderSettings[def.kind];
          return (
            <ReminderRow
              key={def.kind}
              kind={def.kind}
              label={def.label}
              description={def.description}
              enabled={set.enabled}
              hour={set.hour}
              onToggle={() => toggleReminder(def.kind)}
              onHour={(d) => setReminderHour(def.kind, set.hour + d)}
            />
          );
        })}
      </View>
      </Reveal>

      <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 18, marginHorizontal: 4, lineHeight: 18 }}>
        Reminders fire on this device at the times you set. Conditional reminders
        (protein, hydration, dinner, check-in) only fire if you're still behind when
        the time comes, so an on-track day stays quiet.
      </Txt>
    </ScrollView>
  );
}

function ReminderRow({
  kind,
  label,
  description,
  enabled,
  hour,
  onToggle,
  onHour,
}: {
  kind: ReminderKind;
  label: string;
  description: string;
  enabled: boolean;
  hour: number;
  onToggle: () => void;
  onHour: (delta: number) => void;
}) {
  return (
    <Card variant="low" style={{ borderRadius: 20 }}>
      <Row style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={15}>
            {label}
          </Txt>
          <Txt w="m" size={13} color={colors.textTertiary} style={{ marginTop: 2, lineHeight: 18 }}>
            {description}
          </Txt>
        </View>
        <Toggle on={enabled} onPress={onToggle} label={label} />
      </Row>
      {enabled ? (
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Txt w="sb" size={13} color={colors.textSecondary}>
            Reminds at
          </Txt>
          <Row style={{ gap: 12, alignItems: 'center' }}>
            <HourBtn glyph="−" accessibilityLabel={`Earlier, ${label}`} onPress={() => onHour(-1)} />
            <Txt w="eb" num size={18} style={{ minWidth: 64, textAlign: 'center' }}>
              {formatReminderHour(hour)}
            </Txt>
            <HourBtn glyph="+" accessibilityLabel={`Later, ${label}`} onPress={() => onHour(1)} />
          </Row>
        </Row>
      ) : null}
    </Card>
  );
}

function HourBtn({ glyph, accessibilityLabel, onPress }: { glyph: string; accessibilityLabel: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 11,
        backgroundColor: colors.bg2,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Txt w="b" size={20} color={colors.accent}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
