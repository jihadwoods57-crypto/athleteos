// OnStandard — in-app notification inbox (NEW / EARLIER).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { notificationCopy } from '@/core';
import type { AppNotification } from '@/core';
import { useStore, useDerived } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { PressScale, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon, IconName } from '@/icons';
import { Overlay } from './Overlay';

/** Short relative time for a notification's created_at ("now" / "12m" / "3h" / "2d"). */
function relTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const KIND_ICON: Record<string, IconName> = { join_request: 'squad', join_approved: 'trophy', nudge: 'bell' };

/** A real (backend) notification rendered through the shared NotifCard. Unread rows are
 *  tappable (tap = mark read); read rows are flat. */
function RealNotifCard({ n, onPress }: { n: AppNotification; onPress?: () => void }) {
  const c = useColors();
  return (
    <NotifCard
      icon={KIND_ICON[n.kind] ?? 'bell'}
      accent={n.readAt ? undefined : c.accent}
      title={n.title}
      time={relTime(n.createdAt)}
      text={n.body ?? ''}
      onPress={onPress}
    />
  );
}

export function Notifications() {
  const c = useColors();
  const s = useStore();
  const d = useDerived();
  React.useEffect(() => { void s.fetchNotifications(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (fn: () => void) => () => {
    s.closeNotif();
    fn();
  };

  // Live backend with real notifications → show the actual feed; otherwise the seeded demo.
  if (isBackendLive && s.notifications.length > 0) {
    const unread = s.notifications.filter((n) => !n.readAt);
    const earlier = s.notifications.filter((n) => n.readAt);
    return (
      <Overlay
        title="Notifications"
        onClose={s.closeNotif}
        right={
          unread.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Mark all read" hitSlop={8} onPress={() => void s.markAllNotificationsRead()}>
              <Txt w="b" size={13} color={c.accent}>Mark all read</Txt>
            </Pressable>
          ) : undefined
        }
      >
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {unread.length > 0 ? (
            <>
              <SectionLabel>NEW</SectionLabel>
              <View style={{ gap: 10 }}>
                {unread.map((n) => (
                  <RealNotifCard key={n.id} n={n} onPress={() => void s.markNotificationRead(n.id)} />
                ))}
              </View>
            </>
          ) : null}
          {earlier.length > 0 ? (
            <>
              <SectionLabel style={{ marginTop: unread.length > 0 ? 20 : 0 }}>EARLIER</SectionLabel>
              <View style={{ gap: 10 }}>
                {earlier.map((n) => (
                  <RealNotifCard key={n.id} n={n} />
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      </Overlay>
    );
  }

  // Gate the inbox copy so a real athlete is never told a coach, parent, or
  // position room they don't have is waiting on / ranking / praising them. The
  // seeded demo keeps the exact showcase strings.
  const copy = notificationCopy({
    isReal: s.athleteName.trim().length > 0,
    supportTeam: s.supportTeam,
    athleteScore: d.athleteScore,
  });

  return (
    <Overlay title="Notifications" onClose={s.closeNotif} right={<Pressable accessibilityRole="button" accessibilityLabel="Clear notifications" hitSlop={8} onPress={s.closeNotif}><Txt w="b" size={13} color={c.accent}>Clear</Txt></Pressable>}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <SectionLabel>NEW</SectionLabel>
        <Reveal index={0}>
        <View style={{ gap: 10 }}>
          <NotifCard icon="checkin" accent={c.accent} title="Weekly check-in due" time="2m" text={copy.checkin} onPress={go(s.goCheckin)} />
          <NotifCard icon="camera" accent={c.accent} title="Time to log dinner" time="18m" text={`You're ${d.proteinGap}g of protein from your target. One more meal does it.`} onPress={go(s.openMeal)} />
          <NotifCard icon="trophy" accent={c.success} iconBg={c.successSurface} iconColor={c.successDeep} title="Score update" time="1h" text={copy.score} onPress={go(s.goSquad)} />
        </View>
        </Reveal>

        <SectionLabel style={{ marginTop: 20 }}>EARLIER</SectionLabel>
        <Reveal index={1}>
        <View style={{ gap: 10 }}>
          {copy.coachNote ? (
            <NotifCard initials={copy.coachNote.initials} title={copy.coachNote.title} time="4h" text={copy.coachNote.text} />
          ) : null}
          <NotifCard icon="drop" accent={c.hydration} iconColor={c.hydration} title="Hydration reminder" time="6h" text="You're behind on water. Knock out 500ml before practice." />
        </View>
        </Reveal>
      </ScrollView>
    </Overlay>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: any }) {
  const c = useColors();
  return (
    <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} style={[{ marginVertical: 10, marginLeft: 4 }, style]}>
      {children}
    </Txt>
  );
}

function NotifCard({ icon, initials, accent, iconBg, iconColor, title, time, text, onPress }: { icon?: IconName; initials?: string; accent?: string; iconBg?: string; iconColor?: string; title: string; time: string; text: string; onPress?: () => void }) {
  const c = useColors();
  const boxStyle = { flexDirection: 'row' as const, gap: 13, backgroundColor: c.card, borderRadius: 16, padding: 15, borderLeftWidth: accent && onPress ? 3 : 0, borderLeftColor: accent };
  const body = (
    <>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: initials ? c.text : iconBg ?? c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
        {initials ? <Txt w="b" size={13} color={c.white}>{initials}</Txt> : <Icon name={icon!} size={19} color={iconColor ?? c.accent} />}
      </View>
      <View style={{ flex: 1 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="b" size={14}>
            {title}
          </Txt>
          <Txt w="sb" num size={11} color={c.textTertiary}>
            {time}
          </Txt>
        </Row>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 2, lineHeight: 18 }}>
          {text}
        </Txt>
      </View>
    </>
  );
  // Tappable rows get the press-scale feel; the passive (no-onPress) reminders stay a flat card.
  return onPress ? (
    <PressScale accessibilityLabel={title} onPress={onPress} style={[boxStyle, shadow.card]}>
      {body}
    </PressScale>
  ) : (
    <View style={[boxStyle, shadow.card]}>{body}</View>
  );
}
