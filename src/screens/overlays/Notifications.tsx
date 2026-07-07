// OnStandard — in-app notification inbox (NEW / EARLIER TODAY).
// Ported 1:1 from the proto master (proto/redesign-2026-07 js/screens/notifications.js +
// css/screens.css .notif rules): each row is a flat card — 42px tinted icon tile (radius 13,
// 19px glyph), an uppercase graded level-tag pill ("NICE WORK" for positive, else the level
// name) above a bold title + secondary body, and a relative timestamp pinned top-right. Only
// critical rows tint their border; urgency is otherwise carried entirely by the tile + tag
// (no unread dot, no count chip, no side stripe — the proto has none). This is a VISUAL port
// only — every store hook / action (the feed source, read/seen/clear logic, routing on tap,
// close) is preserved, and urgency is derived deterministically from each notification's
// existing `kind` (a pure presentation transform, like Squad's posAbbr) — no new data, no
// fabricated notifications.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { notificationFeed } from '@/core';
import type { AppNotification, FeedNotif } from '@/core';
import { useStore, useDerived } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { useColors } from '@/ui/theme';
import type { ColorTheme } from '@/ui/tokens';
import { PressScale, Reveal, Txt, Pressable } from '@/ui/primitives';
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

/** Graded urgency level for a notification — the proto's `n.level` (positive/medium/high/critical).
 *  Maps to a semantic token family in `urgencyPalette`: positive → success (green),
 *  medium → accent (blue), high → warning (amber), critical → alert (red). */
type Urgency = 'positive' | 'medium' | 'high' | 'critical';

/** One urgency's resolved token pair: the tinted surface (icon tile + level-tag pill) and the
 *  foreground (glyph + tag text). Read from the active dark palette, never hardcoded. */
interface UrgencyStyle {
  /** Icon-tile + level-tag background (the proto's `.nic` / `.level-tag` tint). */
  surface: string;
  /** Icon glyph + level-tag text color. */
  fg: string;
}

/** The four graded-urgency palettes, keyed off semantic dark tokens — the RN mirror of the
 *  proto's `.notif.{level} .nic` / `.level-tag.{level}` rules. Amber has no dedicated *Surface
 *  token, so it borrows warnTint (its intended tinted surface). This is the only place
 *  urgency → color is decided; the critical row-border uses alertBorder at the card. */
function urgencyPalette(c: ColorTheme): Record<Urgency, UrgencyStyle> {
  return {
    positive: { surface: c.successSurface, fg: c.success },
    medium: { surface: c.accentSurface, fg: c.accent },
    high: { surface: c.warnTint, fg: c.warningDeep },
    critical: { surface: c.alertSurface, fg: c.alert },
  };
}

/** Derive urgency from a real (backend) notification's `kind` — a pure presentation transform of
 *  the existing field, adds no data. Approvals read positive, join requests are a normal-priority
 *  ask, an explicit "urgent"/"alert" kind escalates to critical, and everything else (nudges, the
 *  default) is a high-priority reminder. */
function realUrgency(kind: string): Urgency {
  if (/approv|accepted|granted|complete/i.test(kind)) return 'positive';
  if (/urgent|alert|critical|expired|overdue/i.test(kind)) return 'critical';
  if (/request|invite|join/i.test(kind)) return 'medium';
  return 'high';
}

/** Derive urgency from a demo/offline feed item's typed `kind`. Wins already read positive
 *  (score/coach note), the two live nudges (meal, hydration) are normal-priority actions, and
 *  a due weekly ritual (check-in) reads high — the same intent the old per-kind styling carried,
 *  now expressed on the shared urgency scale. */
function feedUrgency(kind: FeedNotif['kind']): Urgency {
  switch (kind) {
    case 'score':
    case 'coachNote':
      return 'positive';
    case 'checkin':
      return 'high';
    case 'meal':
    case 'hydration':
      return 'medium';
  }
}

/** A real (backend) notification rendered through the shared NotifCard. Unread rows are
 *  tappable (tap = mark read); read rows are flat. Urgency is derived from its kind. */
function RealNotifCard({ n, onPress }: { n: AppNotification; onPress?: () => void }) {
  return (
    <NotifCard
      icon={KIND_ICON[n.kind] ?? 'bell'}
      urgency={realUrgency(n.kind)}
      title={n.title}
      time={relTime(n.createdAt)}
      text={n.body ?? ''}
      onPress={onPress}
    />
  );
}

/** The proto back-head's subtitle line ("Accountability moments, not spam"), rendered under the
 *  shared Overlay header (which owns the title + back button). */
function HeadSub() {
  const c = useColors();
  return (
    <Txt w="sb" size={12} color={c.textSecondary} style={{ textAlign: 'center', marginTop: -8 }}>
      Accountability moments, not spam
    </Txt>
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
        <HeadSub />
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
              {/* The proto's label is "Earlier today", but real read notifications can be days
                  old (relTime shows "2d") — "EARLIER" keeps the label honest on live data. */}
              <SectionLabel>EARLIER</SectionLabel>
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
  // A coach-note row keeps the person's initials in its tile (real data, no invented glyph);
  // everything else takes the typed icon. Urgency drives the tile TINT for both.
  const styleFor = (kind: FeedNotif['kind']): { icon?: IconName; initials?: boolean } => {
    switch (kind) {
      case 'checkin': return { icon: 'checkin' };
      case 'meal': return { icon: 'camera' };
      case 'score': return { icon: 'trophy' };
      case 'hydration': return { icon: 'drop' };
      case 'coachNote': return { initials: true };
    }
  };
  const newItems = feed.filter((n) => n.section === 'new');
  const earlier = feed.filter((n) => n.section === 'earlier');

  return (
    <Overlay title="Notifications" onClose={s.closeNotif} right={<Pressable accessibilityRole="button" accessibilityLabel="Clear notifications" hitSlop={8} onPress={s.closeNotif}><Txt w="b" size={13} color={c.accent}>Clear</Txt></Pressable>}>
      <HeadSub />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {feed.length === 0 ? (
          <View style={{ marginTop: 48, alignItems: 'center', paddingHorizontal: 24 }}>
            <View style={{ width: 58, height: 58, borderRadius: 17, backgroundColor: c.successSurface, borderWidth: 1, borderColor: c.successBorderSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={26} color={c.success} />
            </View>
            <Txt w="eb" size={17} ls={-0.3} style={{ marginTop: 16, textAlign: 'center' }}>You&apos;re all caught up</Txt>
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
                        urgency={feedUrgency(n.kind)}
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
                <SectionLabel>EARLIER TODAY</SectionLabel>
                <Reveal index={1}>
                <View style={{ gap: 10 }}>
                  {earlier.map((n) => {
                    const st = styleFor(n.kind);
                    return (
                      <NotifCard
                        key={n.key}
                        icon={st.icon}
                        initials={st.initials ? n.initials : undefined}
                        urgency={feedUrgency(n.kind)}
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

/** Section eyebrow ("NEW" / "EARLIER TODAY") — the proto's `.eyebrow`: 11px/800, 0.14em
 *  letterspacing, tertiary, margin 26px 2px 12px. No count chip — the proto has none. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <Txt w="eb" size={11} ls={1.5} color={c.textTertiary} style={{ marginTop: 26, marginBottom: 12, marginHorizontal: 2 }}>
      {children}
    </Txt>
  );
}

/** One notification row — the proto's `.notif` card, verbatim: flat surface card (radius 18,
 *  padding 15/16, hairline border — alert-tinted only when critical, no shadow), a 42px
 *  urgency-tinted tile (radius 13, 19px glyph or the coach's initials), then the level-tag
 *  pill over the title/body column, with the timestamp pinned top-right. */
function NotifCard({
  icon,
  initials,
  urgency,
  title,
  time,
  text,
  onPress,
}: {
  icon?: IconName;
  initials?: string;
  urgency: Urgency;
  title: string;
  time: string;
  text: string;
  onPress?: () => void;
}) {
  const c = useColors();
  const u = urgencyPalette(c)[urgency];
  const boxStyle = {
    flexDirection: 'row' as const,
    gap: 13,
    backgroundColor: c.card,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: urgency === 'critical' ? c.alertBorder : c.border,
  };
  const body = (
    <>
      <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: u.surface, alignItems: 'center', justifyContent: 'center' }}>
        {initials ? <Txt w="b" size={13} color={u.fg}>{initials}</Txt> : <Icon name={icon!} size={19} color={u.fg} />}
      </View>
      <View style={{ flex: 1 }}>
        {/* The graded level tag — positive reads "NICE WORK", the rest name their level. */}
        <View style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: u.surface, marginBottom: 5 }}>
          <Txt w="eb" size={9.5} ls={0.76} color={u.fg}>{urgency === 'positive' ? 'NICE WORK' : urgency.toUpperCase()}</Txt>
        </View>
        <Txt w="eb" size={14.5}>{title}</Txt>
        <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
          {text}
        </Txt>
      </View>
      <Txt w="b" size={11.5} color={c.textTertiary}>
        {time}
      </Txt>
    </>
  );
  // Tappable rows get the press-scale feel; the passive (no-onPress) reminders stay a flat card.
  return onPress ? (
    <PressScale accessibilityLabel={title} onPress={onPress} style={boxStyle}>
      {body}
    </PressScale>
  ) : (
    <View style={boxStyle}>{body}</View>
  );
}
