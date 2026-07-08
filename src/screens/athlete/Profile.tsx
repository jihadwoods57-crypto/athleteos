// OnStandard — Profile. Faithful rebuild of the redesign proto's Profile screen
// (proto/redesign-2026-07/js/screens/profile.js) on real RN data.
//
// Proto section order, reproduced here: identity header → Trust Pass banner (when
// active) → Coach Connection → Squad (leaderboard folded INTO Profile, coach-scoped)
// → Accountability → Health & safety → Settings. Every store hook / action / piece of
// copy is preserved (the WHO-CAN-SEE-YOUR-DATA
// sharing panel, Trust Pass, the Appearance/theme toggle, Units, Notifications, Account, sign out,
// delete). Where the proto shows data the RN app has no honest source for (a school
// field, a wearable/allergies/injury store, a partner/streak/history nav), it is rendered
// from the real equivalent or omitted — never fabricated.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { athleteSubtitle, buildLeaderboard, computeDerived, firstName, GOAL_LABELS, initials, medalColor, passEligibility, passStatus, squadView, supportVisibilityRows, tierFor, trendInfo, trendSeries, trendSummary } from '@/core';
import { isTrustPassEnabled } from '@/lib/features';
import { isBackendLive } from '@/lib/supabase';
import { useStore } from '@/store';
import { MAX_FONT_SCALE, shadow, tierChip } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Row, SampleTag, Toggle, Txt, Pressable, Reveal } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';

/** Avatar initial per support-team role for the visibility rows. */
const VIS_INITIALS: Record<string, string> = { coach: 'C', trainer: 'T', nutritionist: 'N', parent: 'P' };

export function Profile() {
  const c = useColors();
  // Avatar color per support-team role — built from the active palette (a hook can't
  // run at module scope, so this moved inside the component).
  const VIS_COLORS: Record<string, string> = { coach: c.text, trainer: c.trainer, nutritionist: c.success, parent: c.warning };
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = computeDerived(s);
  // Trust Pass (pilot, flag-gated): status of any active pass + eligibility toward earning one.
  const tpStatus = passStatus(s.trustPass, s.dateStamp);
  const tpElig = passEligibility(s.scoreHistory ?? []);
  const tpDaysLeft = s.trustPass && tpStatus?.phase === 'active' ? s.trustPass.lengthDays - tpStatus.dayIndex : 0;
  const units = s.units ?? 'imperial';

  // Real athlete (completed the new onboarding, so a name is set) vs the seeded
  // demo (athleteName ''). For a real athlete every identity surface derives from
  // their own onboarding answers; the demo keeps the Jihad / Eastside / Coach
  // Davis showcase so it is unchanged.
  const isReal = s.athleteName.trim().length > 0;
  const goalLabel = s.primaryGoal ? GOAL_LABELS[s.primaryGoal] : null;
  const idChip = isReal
    ? s.inviteCode.trim()
      ? `Team code · ${s.inviteCode.trim()}`
      : goalLabel
        ? `Goal · ${goalLabel}`
        : 'Solo athlete'
    : 'Team code · EAGLES24';
  const workingToward = isReal
    ? goalLabel
      ? [goalLabel]
      : []
    : ['Performance', 'Scholarship', 'Body composition'];
  const visRows = supportVisibilityRows(s.supportTeam);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      <Txt w="sb" size={14} color={c.textSecondary}>
        Account
      </Txt>
      <Txt w="eb" size={28} ls={-0.8} accessibilityRole="header" style={{ marginTop: 1 }}>
        Profile
      </Txt>

      {/* IDENTITY — the screen's one hero (proto .id-card): avatar, name, sport · position,
          the id line, and an Edit affordance. RN has no separate edit-profile screen, so
          Edit opens the Account overlay (where identity/plan/data actually live). */}
      <Reveal index={0}>
      <Card variant="hero" style={{ marginTop: 18, borderRadius: 26, padding: 22, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ width: 66, height: 66, borderRadius: 21, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.accentBorderStrong }}>
          <Txt w="eb" size={25} color={c.white} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {initials(s.athleteName, 'J')}
          </Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt w="eb" size={21} ls={-0.4} numberOfLines={1}>
            {firstName(s.athleteName, 'Jihad')}
          </Txt>
          <Txt w="sb" size={14} color={c.textSecondary} style={{ marginTop: 3 }} numberOfLines={1}>
            {athleteSubtitle(s.position, s.sport, isReal)}
          </Txt>
          <View style={{ marginTop: 11, alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 9, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder }}>
            <Txt w="b" size={12} color={c.accent}>
              {idChip}
            </Txt>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          hitSlop={8}
          onPress={s.openAccount}
          style={({ pressed }) => ({ paddingHorizontal: 15, height: 38, borderRadius: 12, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <Txt w="b" size={13} color={c.slate700}>
            Edit
          </Txt>
        </Pressable>
      </Card>
      </Reveal>

      {/* Trust Pass banner (pilot, flag-gated) — proto's .trust banner when a pass is
          active. All real Trust-Pass logic is preserved below; this ACTIVE banner mirrors
          the proto shape, and the earn/end controls live in the full card further down. */}
      {isTrustPassEnabled && tpStatus?.phase === 'active' ? (
        <Reveal index={0}>
          <Row style={{ marginTop: 12, gap: 13, alignItems: 'center', padding: 15, borderRadius: 18, backgroundColor: c.trainer + '22', borderWidth: 1, borderColor: c.trainer + '55' }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.trainer + '22', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shield" size={20} color={c.trainerLight} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={14}>
                Trust Pass active · day {tpStatus.dayIndex + 1} of {s.trustPass?.lengthDays ?? 0}
              </Txt>
              <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>
                {tpStatus.isCheckDay
                  ? 'Spot-check today — log your meals to keep your pass.'
                  : 'Earned with on-standard days. Credited at your proven level.'}
              </Txt>
            </View>
          </Row>
        </Reveal>
      ) : null}

      {/* Old-version cards (Discipline Record, Deep Dive, weekly digest, AI memory,
          Targets) removed 2026-07-07: the 8124 prototype is the master and its Profile
          carries identity → coach connection → squad → accountability → settings only. */}

      {/* ── COACH CONNECTION (proto eyebrow + .lrow card) ─────────────────────────
          The RN equivalent of the proto's coach row is the athlete's support team.
          The demo shows the Coach Davis showcase; a real athlete sees their connected
          people (or an honest "connect" state), then a row to enter another coach code. */}
      <Reveal index={3}>
      <SectionLabel>COACH CONNECTION</SectionLabel>
      <Card variant="low" style={{ borderRadius: 22, paddingVertical: 2 }}>
        {isReal ? (
          visRows.length > 0 ? (
            visRows.map((r, i) => (
              <ConnRow
                key={r.key}
                first={i === 0}
                initials={VIS_INITIALS[r.key] ?? r.title[0]}
                bg={VIS_COLORS[r.key] ?? c.text}
                title={r.title}
                sub={r.sub}
                pill="Connected"
              />
            ))
          ) : (
            <LinkRow
              first
              icon="squad"
              title="No coach connected"
              sub="Join a coach or trainer group to get a plan and be seen"
              onPress={() => s.openConnect()}
            />
          )
        ) : (
          <ConnRow first initials="CD" bg={c.warning} title="Coach Davis" sub="Central Catholic · tap to message" pill="Connected" onPress={s.openConnect} />
        )}
        <LinkRow
          icon="user"
          title="Enter coach code"
          sub="Join another coach or trainer group"
          onPress={() => s.openConnect()}
        />
      </Card>
      </Reveal>

      {/* ── SQUAD (proto folds the leaderboard INTO Profile) ──────────────────────
          Coach-controlled scope + a top roster preview with tier-colored score chips.
          Real data: buildLeaderboard (demo showcase) / squadView (a real athlete with
          no connected peers gets the honest solo state instead of fabricated teammates). */}
      <Reveal index={3}>
        <SquadFold isReal={isReal} athleteScore={d.athleteScore} />
      </Reveal>

      {/* ── ACCOUNTABILITY (proto eyebrow + .lrow card) ───────────────────────────
          Only rows with a REAL RN destination — no dead proto rows (streak/history/
          partner have no nav here). Notifications opens Reminders; the sharing panel and
          Discipline Record open the surfaces that own them. */}
      <Reveal index={4}>
      <SectionLabel>ACCOUNTABILITY</SectionLabel>
      <Card variant="low" style={{ borderRadius: 22, paddingVertical: 2 }}>
        <LinkRow
          first
          icon="bell"
          title="Notifications"
          sub="Protein, hydration, dinner & check-in reminders"
          onPress={s.goReminders}
          trailing={<Toggle on={s.notif} onPress={s.toggleNotif} label="Notifications" />}
        />
        <LinkRow
          icon="squad"
          title="Who can see your data"
          sub={s.sharingPaused ? 'Paused — nothing leaves this device' : 'Your accountability circle, by role'}
          onPress={s.openAccount}
        />
      </Card>
      </Reveal>

      {/* WHO CAN SEE YOUR DATA — the full sharing/visibility panel (derived from the
          athlete's chosen support team, read-only). Preserved in full: the per-viewer
          rows, remove, and the pause-all toggle with its honest status line. */}
      <Reveal index={4}>
      <View style={{ marginTop: 26 }}>
        <SectionLabel style={{ marginTop: 0 }}>WHO CAN SEE YOUR DATA</SectionLabel>
        <Card variant="low" style={{ borderRadius: 22 }}>
          {isReal ? (
            visRows.length > 0 ? (
              <>
                <Row style={{ gap: 9, marginBottom: 8 }}>
                  <Icon name="shield" size={16} color={c.accent} />
                  <Txt w="eb" size={14}>
                    Your accountability circle
                  </Txt>
                </Row>
                <Txt w="m" size={13} color={c.textSecondary} style={{ lineHeight: 19 }}>
                  These people see your scores. Accountability works when the right people are watching, so you can't hide a tough week.
                </Txt>
                <View style={{ marginTop: 16, gap: 13, opacity: s.sharingPaused ? 0.45 : 1 }}>
                  {visRows.map((r) => (
                    <VisRow
                      key={r.key}
                      initials={VIS_INITIALS[r.key] ?? r.title[0]}
                      bg={VIS_COLORS[r.key] ?? c.text}
                      title={r.title}
                      sub={r.sub}
                      onRemove={() => s.removeViewer(r.key)}
                    />
                  ))}
                </View>
                {/* Pause-all + the honest status line: while paused nothing leaves the device. */}
                <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: c.border }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Txt w="b" size={14}>Pause all sharing</Txt>
                    <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 2, lineHeight: 17 }}>
                      {s.sharingPaused ? 'Paused — your data stays on this device.' : 'Stop sharing with everyone, anytime.'}
                    </Txt>
                  </View>
                  <Toggle on={s.sharingPaused} onPress={s.togglePauseSharing} label="Pause all sharing" />
                </Row>
              </>
            ) : (
              <>
                <Row style={{ gap: 9, marginBottom: 8 }}>
                  <Icon name="shield" size={16} color={c.accent} />
                  <Txt w="eb" size={14}>
                    Just you, for now
                  </Txt>
                </Row>
                <Txt w="m" size={13} color={c.textSecondary} style={{ lineHeight: 19 }}>
                  No one else is connected yet. Add a coach, trainer, or parent from your support team and they'll see your weekly progress, so the accountability has someone to answer to.
                </Txt>
              </>
            )
          ) : (
            <>
              <Row style={{ gap: 9, marginBottom: 8 }}>
                <Icon name="shield" size={16} color={c.accent} />
                <Txt w="eb" size={14}>
                  Managed by your program
                </Txt>
              </Row>
              <Txt w="m" size={13} color={c.textSecondary} style={{ lineHeight: 19 }}>
                Coach Davis controls who sees your scores, and that's the point of accountability. You can't hide a tough week.
              </Txt>
              <View style={{ marginTop: 16, gap: 13 }}>
                <VisRow initials="CD" bg={c.text} title="Coach Davis" sub="Full profile & history" />
                <VisRow initials="S" bg={c.warning} title="Sarah (Parent)" sub="Weekly reports & alerts" />
                <VisRow icon="trophy" title="Linebacker room" sub="Position leaderboard" />
              </View>
            </>
          )}
        </Card>
      </View>
      </Reveal>

      {/* Trust Pass (pilot, flag-gated) — an earned camera-free reward. Coach-granted at
          go-live; this pilot self-grant still requires real on-standard days (earned trust). */}
      {isTrustPassEnabled ? (
        <Reveal index={4}>
          <Card variant="low" style={{ marginTop: 14, borderRadius: 24, padding: 20 }}>
            <Row style={{ gap: 10, alignItems: 'center' }}>
              <Icon name="sparkle" size={18} color={c.accent} />
              <Txt w="eb" size={16} ls={-0.3}>
                Trust Pass
              </Txt>
            </Row>
            {tpStatus?.phase === 'active' ? (
              <>
                <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 10, lineHeight: 19 }}>
                  {tpStatus.isCheckDay
                    ? 'Spot-check today — log your meals to keep your pass.'
                    : `Camera-free. ${tpDaysLeft} day${tpDaysLeft === 1 ? '' : 's'} left — one honest tap counts as a real day at your proven level.`}
                </Txt>
                {/* Live, the pass is coach-granted and server-held: a local "end" would
                    just resync on the next hydrate. The pilot (backend off) keeps it. */}
                {isBackendLive ? (
                  <Txt w="m" size={11} color={c.textTertiary} style={{ marginTop: 8 }}>
                    Granted by your coach. Ask them to end it early.
                  </Txt>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="End trust pass"
                    onPress={() => {
                      haptics.tap();
                      s.endTrustPass();
                    }}
                    style={({ pressed }) => ({ marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.6 : 1 })}
                  >
                    <Txt w="eb" size={14} color={c.textSecondary}>
                      End pass
                    </Txt>
                  </Pressable>
                )}
              </>
            ) : (
              <>
                <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 10, lineHeight: 19 }}>
                  Earn a camera-free stretch by staying on standard. {tpElig.onStandardDays} of 7 on-standard days.
                </Txt>
                {/* The card's own copy says the coach unlocks this — live, only the coach
                    can (server RPC). A self-serve grant button contradicting that copy was
                    the exact gaming vector the council's structural locks forbid. */}
                {isBackendLive ? null : (
                  <Pressable
                    disabled={!tpElig.eligible}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !tpElig.eligible }}
                    accessibilityLabel="Start a 10-day trust pass"
                    onPress={() => {
                      haptics.success();
                      s.grantTrustPass(10);
                    }}
                    style={({ pressed }) => ({ marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, backgroundColor: tpElig.eligible ? c.accent : c.bg, borderWidth: tpElig.eligible ? 0 : 1, borderColor: c.border, opacity: pressed ? 0.7 : tpElig.eligible ? 1 : 0.6 })}
                  >
                    <Txt w="eb" size={14} color={tpElig.eligible ? c.white : c.textTertiary}>
                      Start 10-day pass
                    </Txt>
                  </Pressable>
                )}
                <Txt w="m" size={11} color={c.textTertiary} style={{ marginTop: 8 }}>
                  Your coach unlocks this once you&apos;ve earned it.
                </Txt>
              </>
            )}
          </Card>
        </Reveal>
      ) : null}

      {/* ── SETTINGS (proto eyebrow + .lrow card) ─────────────────────────────────
          Notifications toggle lives up in Accountability; here: Appearance (theme),
          Units, and the Account overlay entry that owns Plan & billing, Privacy, Terms,
          Export my data, and Delete account. The theme toggle is preserved verbatim. */}
      <Reveal index={5}>
      <SectionLabel>SETTINGS</SectionLabel>
      <Card variant="low" style={{ borderRadius: 22, paddingVertical: 4 }}>
        {/* Units — tap the row to flip imperial/metric; the value doubles as the affordance. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Units: ${units === 'metric' ? 'Metric, kilograms' : 'Imperial, pounds'}. Tap to switch.`}
          onPress={s.toggleUnits}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Row style={{ justifyContent: 'space-between', paddingVertical: 14, paddingRight: 2, borderBottomWidth: 1, borderBottomColor: c.hairline }}>
            <Row style={{ gap: 13, alignItems: 'center', flex: 1 }}>
              <SettingIcon name="bolt" />
              <Txt w="b" size={15}>
                Units & preferences
              </Txt>
            </Row>
            <Txt w="sb" size={14} color={c.accent}>
              {units === 'metric' ? 'Metric (kg)' : 'Imperial (lb)'}
            </Txt>
          </Row>
        </Pressable>

        {/* Appearance — the theme mode control (Light / Dark / System). Segmented control matches
            the app's premium selector idiom; active state still reads s.themeMode. */}
        <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.hairline }}>
          <Row style={{ gap: 13, alignItems: 'center' }}>
            <SettingIcon name="settings" />
            <Txt w="b" size={15}>
              Appearance
            </Txt>
          </Row>
          <Row style={{ marginTop: 13, backgroundColor: c.surface2, borderRadius: 13, padding: 4, borderWidth: 1, borderColor: c.hairline }}>
            {(['light', 'dark', 'auto'] as const).map((key) => {
              const label = key === 'auto' ? 'System' : key === 'dark' ? 'Dark' : 'Light';
              const active = s.themeMode === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={`Appearance: ${label}`}
                  accessibilityState={{ selected: active }}
                  hitSlop={{ top: 8, bottom: 8 }}
                  onPress={() => {
                    haptics.select();
                    s.setThemeMode(key);
                  }}
                  style={[{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: active ? c.accent : 'transparent' }, active ? shadow.cta : null]}
                >
                  <Txt w="b" size={13} color={active ? c.white : c.textSecondary}>
                    {label}
                  </Txt>
                </Pressable>
              );
            })}
          </Row>
        </View>

        {/* Plan & billing / Privacy / Terms / Export / Delete all live in the Account
            overlay — one entry, honest subtitle. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account: plan, billing, privacy and your data"
          onPress={s.openAccount}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Row style={{ justifyContent: 'space-between', paddingVertical: 14, paddingRight: 2 }}>
            <Row style={{ gap: 13, alignItems: 'center', flex: 1 }}>
              <SettingIcon name="user" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt w="b" size={15}>
                  Plan, privacy & your data
                </Txt>
                <Txt w="m" size={12.5} color={c.textTertiary} style={{ marginTop: 1 }}>
                  Billing, privacy, export & delete account
                </Txt>
              </View>
            </Row>
            <Icon name="chevronRight" size={20} color={c.slate300} />
          </Row>
        </Pressable>
      </Card>
      </Reveal>

      <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={s.signOut} style={({ pressed }) => [{ marginTop: 14, height: 54, borderRadius: 16, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.alertBorder, opacity: pressed ? 0.7 : 1 }, shadow.card]}>
        <Txt w="b" size={15} color={c.alert}>
          Sign out
        </Txt>
      </Pressable>
      <Txt w="sb" size={12} color={c.textSecondary} style={{ textAlign: 'center', marginTop: 16 }}>
        OnStandard · v1.0
      </Txt>
    </ScrollView>
  );
}

/** Proto .eyebrow — the uppercase section label above each card group. */
function SectionLabel({ children, style }: { children: React.ReactNode; style?: object }) {
  const c = useColors();
  return (
    <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} style={[{ marginTop: 26, marginLeft: 4, marginBottom: 10 }, style]}>
      {children}
    </Txt>
  );
}

function TargetTile({ value, label }: { value: string; label: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, padding: 14 }}>
      <Txt w="eb" num size={22}>
        {value}
      </Txt>
      <Txt w="b" size={11} color={c.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
    </View>
  );
}

/** Rounded accent-surface icon tile that leads each settings row — the app's premium row
 *  idiom (same tile used across Home / Account). Presentation only. */
function SettingIcon({ name }: { name: React.ComponentProps<typeof Icon>['name'] }) {
  const c = useColors();
  return (
    <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={17} color={c.accent} />
    </View>
  );
}

/**
 * Proto .lrow — a tappable list row (icon tile · title/sub · chevron), for the Coach
 * Connection and Accountability groups. `trailing` overrides the chevron (e.g. a toggle).
 */
function LinkRow({
  icon,
  title,
  sub,
  onPress,
  trailing,
  first,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  title: string;
  sub?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  first?: boolean;
}) {
  const c = useColors();
  const body = (
    <Row style={{ gap: 13, alignItems: 'center', flex: 1 }}>
      <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={c.textSecondary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt w="b" size={15}>
          {title}
        </Txt>
        {sub ? (
          <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1 }} numberOfLines={2}>
            {sub}
          </Txt>
        ) : null}
      </View>
    </Row>
  );
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 15, paddingRight: 2, borderTopWidth: first ? 0 : 1, borderTopColor: c.hairline }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        hitSlop={6}
        style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
      >
        {body}
      </Pressable>
      {trailing ?? <Icon name="chevronRight" size={17} color={c.slate300} />}
    </Row>
  );
}

/** Proto coach-connection row — an initialed avatar tile + a status pill (or chevron). */
function ConnRow({
  initials,
  bg,
  title,
  sub,
  pill,
  onPress,
  first,
}: {
  initials: string;
  bg: string;
  title: string;
  sub: string;
  pill?: string;
  onPress?: () => void;
  first?: boolean;
}) {
  const c = useColors();
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 14, paddingRight: 2, borderTopWidth: first ? 0 : 1, borderTopColor: c.hairline }}>
      <Pressable
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={onPress ? `${title}. ${sub}` : `${title}, ${sub}`}
        onPress={onPress}
        disabled={!onPress}
        hitSlop={6}
        style={({ pressed }) => ({ flex: 1, opacity: pressed && onPress ? 0.6 : 1 })}
      >
        <Row style={{ gap: 12, alignItems: 'center', flex: 1 }}>
          <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="eb" size={14} color={c.white}>
              {initials}
            </Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="b" size={15} numberOfLines={1}>
              {title}
            </Txt>
            <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1 }} numberOfLines={1}>
              {sub}
            </Txt>
          </View>
        </Row>
      </Pressable>
      {pill ? (
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1.5, borderColor: c.successBorderSoft, backgroundColor: c.successSurface }}>
          <Txt w="eb" size={11} color={c.success} ls={0.2}>
            {pill}
          </Txt>
        </View>
      ) : (
        <Icon name="chevronRight" size={17} color={c.slate300} />
      )}
    </Row>
  );
}

function VisRow({ initials, bg, icon, title, sub, onRemove }: { initials?: string; bg?: string; icon?: any; title: string; sub: string; onRemove?: () => void }) {
  const c = useColors();
  return (
    <Row style={{ gap: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: icon ? c.accentSurface : bg, alignItems: 'center', justifyContent: 'center' }}>
        {icon ? <Icon name={icon} size={18} color={c.accent} /> : <Txt w="b" size={12} color={c.white}>{initials}</Txt>}
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="b" size={14}>
          {title}
        </Txt>
        <Txt w="m" size={12} color={c.textTertiary}>
          {sub}
        </Txt>
      </View>
      {onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${title}`} hitSlop={8} onPress={() => { haptics.tap(); onRemove(); }} style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: c.bg2, opacity: pressed ? 0.6 : 1 })}>
          <Txt w="b" size={12} color={c.alert}>Remove</Txt>
        </Pressable>
      ) : (
        <Txt w="b" size={12} color={c.success}>
          On
        </Txt>
      )}
    </Row>
  );
}

/**
 * SQUAD, folded into Profile (proto: the leaderboard lives inside Profile).
 * Coach-controlled scope + a compact top roster preview with tier-colored score chips,
 * plus a link out to the full Squad tab. Real data only:
 *  - demo (athleteName '') → buildLeaderboard(mode) showcase board;
 *  - real athlete with no connected peers → the honest solo state from squadView.
 */
function SquadFold({ isReal, athleteScore }: { isReal: boolean; athleteScore: number }) {
  const c = useColors();
  const squadMode = useStore((st) => st.squadMode);
  const setSquadMode = useStore((st) => st.setSquadMode);
  const scoreHistory = useStore((st) => st.scoreHistory);
  const athleteName = useStore((st) => st.athleteName);
  const goSquad = useStore((st) => st.goSquad);
  // The you-row arrow follows the same real score history the Home trend draws.
  const youDir = trendSummary(trendSeries(scoreHistory, athleteScore)).dir;
  const youIdentity = isReal ? { name: athleteName, initials: initials(athleteName, 'J') } : undefined;
  const view = squadView({ isReal });

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 26, marginLeft: 4, marginRight: 4, marginBottom: 10 }}>
        <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>
          SQUAD
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="Open the full leaderboard" hitSlop={8} onPress={goSquad}>
          <Txt w="b" size={13} color={c.accent}>
            Open
          </Txt>
        </Pressable>
      </Row>

      {view.kind === 'solo' ? (
        // Honest empty-peer state — a real athlete with no connected squad. No fabricated
        // teammates; their own week keeps tracking, and there's a real way out.
        <Card variant="low" style={{ borderRadius: 22, padding: 20, alignItems: 'center' }}>
          <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="squad" size={22} color={c.textTertiary} />
          </View>
          <Txt w="eb" size={15} ls={-0.2} style={{ marginTop: 12, textAlign: 'center' }}>
            {view.empty?.title ?? 'No squad connected yet'}
          </Txt>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 19 }}>
            {view.empty?.body ?? 'When your team joins OnStandard, your leaderboard shows up here.'}
          </Txt>
        </Card>
      ) : (
        <>
          {/* Coach-controlled scope segmented control (Team / Position). */}
          <Row style={{ gap: 5, backgroundColor: c.surface2, borderRadius: 15, padding: 5, borderWidth: 1, borderColor: c.hairline }}>
            <SquadSeg label="Whole team" active={squadMode === 'team'} onPress={() => setSquadMode('team')} />
            <SquadSeg label="Position room" active={squadMode === 'position'} onPress={() => setSquadMode('position')} />
          </Row>
          <SquadBoard mode={squadMode} athleteScore={athleteScore} youDir={youDir} youIdentity={youIdentity} onOpen={goSquad} />
        </>
      )}
    </View>
  );
}

function SquadBoard({
  mode,
  athleteScore,
  youDir,
  youIdentity,
  onOpen,
}: {
  mode: 'team' | 'position';
  athleteScore: number;
  youDir: ReturnType<typeof trendSummary>['dir'];
  youIdentity: { name: string; initials: string } | undefined;
  onOpen: () => void;
}) {
  const c = useColors();
  const board = buildLeaderboard(mode, athleteScore, youDir, youIdentity);
  const preview = board.slice(0, 4);
  const scopeLabel = mode === 'team' ? 'Whole team' : 'Position room';

  return (
    <Card variant="low" style={{ marginTop: 12, borderRadius: 22, paddingVertical: 4, paddingHorizontal: 4 }}>
      <Row style={{ gap: 7, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
        <SampleTag />
        <Txt w="sb" size={12} color={c.textTertiary}>
          {scopeLabel} · set by your coach
        </Txt>
      </Row>
      {preview.map((r) => {
        const tier = tierFor(r.score);
        const chip = tierChip[tier.short];
        const tr = trendInfo(r.dir);
        return (
          <Row
            key={`${r.rank}-${r.name}`}
            accessibilityRole="text"
            accessibilityLabel={`Rank ${r.rank}, ${r.name}${r.you ? ' (you)' : ''}, ${tier.name}, score ${r.score}`}
            style={{
              gap: 12,
              alignItems: 'center',
              paddingVertical: 11,
              paddingHorizontal: 10,
              marginHorizontal: 4,
              borderRadius: 14,
              backgroundColor: r.you ? c.accentSurface : 'transparent',
              borderWidth: r.you ? 1 : 0,
              borderColor: r.you ? c.accentBorderStrong : 'transparent',
            }}
          >
            <Txt w="eb" num size={14} color={r.rank <= 3 ? medalColor(r.rank) : c.textTertiary} style={{ width: 20, textAlign: 'center' }}>
              {r.rank}
            </Txt>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Row style={{ gap: 6 }}>
                <Txt w="b" size={14.5} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {r.name}
                </Txt>
                {r.you ? (
                  <View style={{ backgroundColor: c.accent, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5 }}>
                    <Txt w="eb" size={9} color={c.white} ls={0.3}>
                      YOU
                    </Txt>
                  </View>
                ) : null}
              </Row>
              <Txt w="sb" size={11} color={c.textTertiary} style={{ marginTop: 1 }}>
                {r.pos}
              </Txt>
            </View>
            <Txt w="eb" size={14} color={tr.c} accessibilityElementsHidden importantForAccessibility="no">
              {tr.t}
            </Txt>
            <View style={{ minWidth: 40, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center' }}>
              <Txt w="eb" num size={16} color={chip.fg}>
                {r.score}
              </Txt>
            </View>
          </Row>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="See the full leaderboard"
        onPress={onOpen}
        style={({ pressed }) => ({ paddingVertical: 12, alignItems: 'center', opacity: pressed ? 0.6 : 1 })}
      >
        <Txt w="b" size={13} color={c.accent}>
          See full leaderboard
        </Txt>
      </Pressable>
    </Card>
  );
}

function SquadSeg({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={() => { haptics.select(); onPress(); }}
      style={[{ flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center', backgroundColor: active ? c.accent : 'transparent' }, active ? shadow.cta : null]}
    >
      <Txt w="b" size={13} color={active ? c.white : c.textSecondary}>
        {label}
      </Txt>
    </Pressable>
  );
}
