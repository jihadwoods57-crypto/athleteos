// OnStandard — in-app notification inbox (NEW / EARLIER).
// Dark-premium redesign: graded-urgency notification center. Each row carries a tinted
// icon tile + status dot in its urgency color (positive→success, medium→accent,
// high→warning, critical→alert), a bold title, a secondary body line, and a relative
// timestamp; tapping routes to the source. This is a VISUAL port only — every store hook /
// action (the feed source, read/seen/clear logic, routing on tap, close) is preserved, and
// urgency is derived deterministically from each notification's existing `kind` (a pure
// presentation transform, like Squad's posAbbr) — no new data, no fabricated notifications.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { notificationFeed } from '@/core';
import type { AppNotification, FeedNotif } from '@/core';
import { useStore, useDerived } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { shadow, typeScale } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import type { ColorTheme } from '@/ui/tokens';
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

/** Graded urgency level for a notification. Maps to a semantic token family in `urgencyPalette`:
 *  positive → success (green), medium → accent (blue), high → warning (amber), critical → alert (red). */
type Urgency = 'positive' | 'medium' | 'high' | 'critical';

/** One urgency's resolved token set: the tinted-tile surface + icon color, and the unread
 *  accent (row border tint + status dot). Read from the active dark palette, never hardcoded. */
interface UrgencyStyle {
  /** Icon-tile background. */
  surface: string;
  /** Icon glyph + status-dot color. */
  fg: string;
  /** Unread row border tint. */
  border: string;
}

/** The four graded-urgency palettes, keyed off semantic dark tokens. Amber has no dedicated
 *  *Surface token, so it borrows warnTint (its intended tinted surface); alert/success/accent
 *  each use their own Surface + Border. This is the only place urgency → color is decided. */
function urgencyPalette(c: ColorTheme): Record<Urgency, UrgencyStyle> {
  return {
    positive: { surface: c.successSurface, fg: c.success, border: c.successBorderSoft },
    medium: { surface: c.accentSurface, fg: c.accent, border: c.accentBorder },
    high: { surface: c.warnTint, fg: c.warningDeep, border: c.warnText },
    critical: { surface: c.alertSurface, fg: c.alert, border: c.alertBorder },
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
      unread={!n.readAt}
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
              <SectionLabel count={unread.length}>NEW</SectionLabel>
              <View style={{ gap: 10 }}>
                {unread.map((n) => (
                  <RealNotifCard key={n.id} n={n} onPress={() => void s.markNotificationRead(n.id)} />
                ))}
              </View>
            </>
          ) : null}
          {earlier.length > 0 ? (
            <>
              <SectionLabel style={{ marginTop: unread.length > 0 ? 22 : 0 }}>EARLIER</SectionLabel>
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
  // A coach-note row keeps its human-monogram tile (a person, not a status glyph); everything
  // else takes the typed icon. Urgency (below) drives the tile TINT for both.
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
                <SectionLabel count={newItems.length}>NEW</SectionLabel>
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
                        unread
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
                <SectionLabel style={{ marginTop: newItems.length > 0 ? 22 : 0 }}>EARLIER</SectionLabel>
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
                        unread={false}
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

/** Section header ("NEW" / "EARLIER"), with an optional count chip on the left group so the
 *  unread total reads at a glance — the premium touch the flat label lacked. */
function SectionLabel({ children, count, style }: { children: React.ReactNode; count?: number; style?: any }) {
  const c = useColors();
  return (
    <Row style={[{ gap: 8, alignItems: 'center', marginVertical: 12, marginLeft: 4 }, style]}>
      <Txt w="eb" size={typeScale.overline.size} color={c.textTertiary} ls={typeScale.overline.ls}>
        {children}
      </Txt>
      {count && count > 0 ? (
        <View style={{ minWidth: 20, paddingHorizontal: 6, height: 18, borderRadius: 9, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="eb" num size={10.5} color={c.accent}>{count}</Txt>
        </View>
      ) : null}
    </Row>
  );
}

function NotifCard({
  icon,
  initials,
  urgency,
  unread,
  title,
  time,
  text,
  onPress,
}: {
  icon?: IconName;
  initials?: string;
  urgency: Urgency;
  unread: boolean;
  title: string;
  time: string;
  text: string;
  onPress?: () => void;
}) {
  const c = useColors();
  const u = urgencyPalette(c)[urgency];
  // No side-stripe (a project design-law ban) — the urgency is carried by the tinted icon tile
  // and, on unread rows, a matching status dot + a tinted row border. A coach-note tile keeps
  // the solid-text monogram treatment (a person), so its glyph stays readable on the tile.
  const boxStyle = {
    flexDirection: 'row' as const,
    gap: 13,
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 15,
    borderWidth: 1,
    borderColor: unread ? u.border : c.border,
  };
  const tileBg = initials ? c.text : u.surface;
  const glyph = initials ? c.white : u.fg;
  const body = (
    <>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: tileBg, alignItems: 'center', justifyContent: 'center' }}>
        {initials ? <Txt w="b" size={13} color={glyph}>{initials}</Txt> : <Icon name={icon!} size={19} color={glyph} />}
      </View>
      <View style={{ flex: 1 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Row style={{ gap: 7, alignItems: 'center', flex: 1 }}>
            {/* Unread status dot in the row's graded-urgency color. */}
            {unread ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: u.fg }} /> : null}
            <Txt w="b" size={14} style={{ flexShrink: 1 }}>
              {title}
            </Txt>
          </Row>
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
