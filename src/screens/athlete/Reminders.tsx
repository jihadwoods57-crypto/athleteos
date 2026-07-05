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
import { useColors } from '@/ui/theme';
import { Card, Row, Txt, Pressable, Toggle, Reveal } from '@/ui/primitives';
import { Icon, type IconName } from '@/icons';

/** Icon per reminder type — a rounded accent tile leads each row (the app's premium row
 *  idiom, shared with Profile's settings). Presentation only; keyed off the existing kind. */
const REMINDER_ICON: Record<ReminderKind, IconName> = {
  protein: 'bolt',
  hydration: 'drop',
  log_dinner: 'utensils',
  checkin: 'checkin',
  weigh_in: 'trophy',
};

export function Reminders() {
  const c = useColors();
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
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Profile" hitSlop={8} onPress={goProfile} style={({ pressed }) => ({ marginLeft: -6, padding: 6, opacity: pressed ? 0.6 : 1 })}>
          <Icon name="chevronLeft" size={24} color={c.text} />
        </Pressable>
        <Txt w="eb" size={28} ls={-0.8} accessibilityRole="header">
          Reminders
        </Txt>
      </Row>
      <Txt w="sb" size={14} color={c.textSecondary} style={{ marginTop: 2, marginLeft: 30 }}>
        Timely nudges to keep your day on track
      </Txt>

      {/* master-state note — honest about when these actually fire */}
      {!notif ? (
        <Reveal index={0}>
        <Card variant="low" style={{ marginTop: 18, borderRadius: 18, flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: c.accentSurface, borderColor: c.accentBorder }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bell" size={17} color={c.accent} />
          </View>
          <Txt w="m" size={13} color={c.textSecondary} style={{ flex: 1, lineHeight: 19, marginTop: 1 }}>
            Notifications are off. Turn them on in Profile to start receiving these reminders. Your choices below are saved either way.
          </Txt>
        </Card>
        </Reveal>
      ) : null}

      {/* section eyebrow */}
      <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} style={{ marginTop: 26, marginLeft: 4, marginBottom: 4 }}>
        YOUR REMINDERS
      </Txt>

      <Reveal index={1}>
      <View style={{ gap: 12 }}>
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

      <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 18, marginHorizontal: 4, lineHeight: 18 }}>
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
  const c = useColors();
  return (
    <Card variant="low" style={{ borderRadius: 20 }}>
      <Row style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <Row style={{ gap: 13, alignItems: 'flex-start', flex: 1 }}>
          {/* Icon tile — accent-filled when this reminder is on, so an enabled row reads
              at a glance; muted surface when off. */}
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: enabled ? c.accent : c.surface2, borderWidth: 1, borderColor: enabled ? c.accent : c.hairline, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={REMINDER_ICON[kind]} size={19} color={enabled ? c.white : c.textTertiary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="b" size={15}>
              {label}
            </Txt>
            <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 2, lineHeight: 18 }}>
              {description}
            </Txt>
          </View>
        </Row>
        <Toggle on={enabled} onPress={onToggle} label={label} />
      </Row>
      {enabled ? (
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.hairline }}>
          <Txt w="sb" size={13} color={c.textSecondary}>
            Reminds at
          </Txt>
          <Row style={{ gap: 6, alignItems: 'center', backgroundColor: c.surface2, borderRadius: 13, padding: 4, borderWidth: 1, borderColor: c.hairline }}>
            <HourBtn glyph="−" accessibilityLabel={`Earlier, ${label}`} onPress={() => onHour(-1)} />
            <Txt w="eb" num size={16} style={{ minWidth: 66, textAlign: 'center' }}>
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
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: c.card,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Txt w="b" size={20} color={c.accent}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
