// OnStandard — in-app notification inbox (NEW / EARLIER).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { notificationFeed } from '@/core';
import type { AppNotification, FeedNotif } from '@/core';
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

  // The inbox feed is built honestly: the seeded demo keeps its showcase, but a real
  // athlete sees only reminders that are true right now, stamped "Now"/"Today" — never
  // a fabricated "6h ago" on a fresh account. Actions map back to the store here.
  const feed = notificationFeed({
    isReal: s.athleteName.trim().length > 0,
    supportTeam: s.supportTeam,
    athleteScore: d.athleteScore,
    checkinSubmitted: s.ciSubmitted,
    proteinGap: d.proteinGap,
  });
  const actionFor = (a: FeedNotif['action']) =>
    a === 'checkin' ? go(s.goCheckin) : a === 'meal' ? go(s.openMeal) : a === 'squad' ? go(s.goSquad) : undefined;
  const styleFor = (kind: FeedNotif['kind']): { icon?: IconName; initials?: boolean; accent: string; iconBg?: string; iconColor?: string } => {
    switch (kind) {
      case 'checkin': return { icon: 'checkin', accent: c.accent };
      case 'meal': return { icon: 'camera', accent: c.accent };
      case 'score': return { icon: 'trophy', accent: c.success, iconBg: c.successSurface, iconColor: c.successDeep };
      case 'hydration': return { icon: 'drop', accent: c.hydration, iconColor: c.hydration };
      case 'coachNote': return { initials: true, accent: c.accent };
    }
  };
  const newItems = feed.filter((n) => n.section === 'new');
  const earlier = feed.filter((n) => n.section === 'earlier');

  return (
    <Overlay title="Notifications" onClose={s.closeNotif} right={<Pressable accessibilityRole="button" accessibilityLabel="Clear notifications" hitSlop={8} onPress={s.closeNotif}><Txt w="b" size={13} color={c.accent}>Clear</Txt></Pressable>}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {feed.length === 0 ? (
          <View style={{ marginTop: 40, alignItems: 'center', paddingHorizontal: 24 }}>
            <View style={{ width: 52, height: 52, borderRadius: 15, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={24} color={c.successDeep} />
            </View>
            <Txt w="eb" size={16} style={{ marginTop: 14, textAlign: 'center' }}>You&apos;re all caught up</Txt>
            <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 19 }}>
              No reminders right now. We&apos;ll nudge you when your check-in or next meal is due.
            </Txt>
          </View>
        ) : (
          <>
            {newItems.length > 0 ? (
              <>
                <SectionLabel>NEW</SectionLabel>
                <Reveal index={0}>
                <View style={{ gap: 10 }}>
                  {newItems.map((n) => {
                    const st = styleFor(n.kind);
                    return (
                      <NotifCard
                        key={n.key}
                        icon={st.icon}
                        initials={st.initials ? n.initials : undefined}
                        accent={st.accent}
                        iconBg={st.iconBg}
                        iconColor={st.iconColor}
                        title={n.title}
                        time={n.time}
                        text={n.text}
                        onPress={actionFor(n.action)}
                      />
                    );
                  })}
                </View>
                </Reveal>
              </>
            ) : null}
            {earlier.length > 0 ? (
              <>
                <SectionLabel style={{ marginTop: newItems.length > 0 ? 20 : 0 }}>EARLIER</SectionLabel>
                <Reveal index={1}>
                <View style={{ gap: 10 }}>
                  {earlier.map((n) => {
                    const st = styleFor(n.kind);
                    return (
                      <NotifCard
                        key={n.key}
                        icon={st.icon}
                        initials={st.initials ? n.initials : undefined}
                        accent={st.accent}
                        iconBg={st.iconBg}
                        iconColor={st.iconColor}
                        title={n.title}
                        time={n.time}
                        text={n.text}
                        onPress={actionFor(n.action)}
                      />
                    );
                  })}
                </View>
                </Reveal>
              </>
            ) : null}
          </>
        )}
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
