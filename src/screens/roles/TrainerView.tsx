// OnStandard — Trainer mobile view: multi-org client book, KPIs, book-compliance
// trend, needs-follow-up nudges, AI practice summary.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { ORG_COLORS, TRAINER_CLIENTS, gradeFor, initials, needsAttention, rankByRisk, trainerBookKpis, trainerLens } from '@/core';
import { useStore } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { aiPrefix } from '@/lib/ai';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, PressScale, Reveal, Row, SampleTag, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Account } from '@/screens/overlays/Account';
import { Plans } from '@/screens/overlays/Plans';
import { OverseerProfile } from '@/screens/overlays/OverseerProfile';
import { Messages } from '@/screens/overlays/Messages';
import { PersonDetail } from '@/screens/overlays/PersonDetail';
import { CoachGoalsEditor } from '@/screens/overlays/CoachGoalsEditor';
import { CoachPlanEditor } from '@/screens/overlays/CoachPlanEditor';
import { isMealPlansEnabled } from '@/lib/features';
import { usePendingClients } from './usePendingClients';
import { RoleTabBar, SettingRow, type RoleTab } from './roleChrome';
import type { TrainerTab } from '@/core';

const TRAINER_TABS: RoleTab<TrainerTab>[] = [
  { key: 'dashboard', label: 'Clients', icon: 'squad' },
  { key: 'profile', label: 'Profile', icon: 'user' },
];

export function TrainerView() {
  const cx = useColors();
  const s = useStore();
  const tab = s.trainerTab;
  const kpis = trainerBookKpis(TRAINER_CLIENTS);
  // Needs-Follow-Up derives from the same book the FOLLOW-UPS KPI counts, so the
  // badge count always equals the rows shown and only REAL clients can appear
  // (the old list hand-named a client who was not in the book at all).
  const followUps = needsAttention(TRAINER_CLIENTS);
  // Header identity: the seeded demo keeps the showcase gym + "MA"; a real trainer
  // gets a neutral practice label (no business name is collected) and their own
  // initials, so neither leaks another trainer's brand.
  const isReal = s.athleteName.trim().length > 0;
  // A nutritionist rides this same dashboard but through a nutrition lens (header,
  // compliance card, and empty state), consistent with the Account "nutrition
  // clients" copy; a personal trainer keeps the generic book framing.
  // A real personal trainer's onboarding clientType (weight-loss / muscle-gain /
  // general) re-frames the header so a non-athlete book reads first-class, not
  // sport-coded; the seeded demo and an athlete/hybrid book keep the neutral framing.
  const lens = trainerLens(s.role, isReal, s.obMeta.clientType, s.orgName);
  const orgTitle = lens.orgTitle;
  const monogram = initials(s.athleteName, 'MA');
  const clientByName: Record<string, (typeof TRAINER_CLIENTS)[number]> = Object.fromEntries(
    TRAINER_CLIENTS.map((c) => [c.name, c]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: cx.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {tab === 'profile' ? (
          <TrainerProfile orgTitle={orgTitle} />
        ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ gap: 12 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Account & settings" hitSlop={6} onPress={s.openAccount} style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: cx.card, alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
                <Icon name="menu" size={20} color={cx.slate600} />
              </Pressable>
              <View>
                <Txt w="sb" size={13} color={cx.textSecondary}>
                  {orgTitle}
                </Txt>
                <Txt w="eb" size={21} ls={-0.3}>
                  {lens.headerTitle}
                </Txt>
                <Row style={{ gap: 7, marginTop: 5 }}>
                  <SampleTag />
                  <Txt w="sb" size={12} color={cx.textTertiary}>
                    Demo book, not your real clients
                  </Txt>
                </Row>
              </View>
            </Row>
            <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: cx.trainer, alignItems: 'center', justifyContent: 'center' }}>
              <Txt w="b" size={15} color={cx.white}>
                {monogram}
              </Txt>
            </View>
          </Row>

          {/* RETENTION is a showcase sample with no real source yet, so it shows only in the
              demo and is hidden once the backend is live (no fabricated metric for a real trainer). */}
          <Reveal index={0}>
          <Row style={{ gap: 10, marginTop: 20 }}>
            <Kpi value={String(kpis.clients)} label="CLIENTS" />
            <Kpi value={`${kpis.avgCompliance}%`} label="AVG COMPLY" />
            {isBackendLive ? null : <Kpi value="92%" label="RETENTION" color={cx.success} sample />}
          </Row>
          </Reveal>

          <PendingClientsCard />

          {/* book compliance trend */}
          <Reveal index={1}>
          <Card variant="hero" style={{ marginTop: 14, borderRadius: 20 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Row style={{ gap: 8 }}>
                  <Txt w="eb" size={15} ls={-0.3}>
                    {lens.complianceTitle}
                  </Txt>
                  <SampleTag />
                </Row>
                <Txt w="sb" size={13} color={cx.textSecondary} style={{ marginTop: 3 }}>
                  All clients · 8-week average
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt w="eb" num size={22}>
                  {kpis.avgCompliance}%
                </Txt>
                <Txt w="b" size={12} color={cx.success}>
                  ↑ +6%
                </Txt>
              </View>
            </Row>
            <Svg viewBox="0 0 322 96" width="100%" height={92} preserveAspectRatio="none" style={{ marginTop: 6 }}>
              <Defs>
                <LinearGradient id="tbc" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#2563EB" stopOpacity="0.16" />
                  <Stop offset="1" stopColor="#2563EB" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Path d="M12,70 L62,66 L111,68 L161,58 L211,52 L260,46 L310,40 L310,96 L12,96 Z" fill="url(#tbc)" />
              <Path d="M12,70 L62,66 L111,68 L161,58 L211,52 L260,46 L310,40" fill="none" stroke="#2563EB" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={310} cy={40} r={5.5} fill="#2563EB" stroke={cx.card} strokeWidth={2.5} />
            </Svg>
          </Card>
          </Reveal>

          {/* needs follow-up */}
          <Reveal index={2}>
          {followUps.length > 0 ? (
            <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: cx.alertSurface, borderWidth: 1, borderColor: cx.alertBorder }}>
              <Row style={{ gap: 8, marginBottom: 13 }}>
                <Txt w="eb" size={12} color={cx.alertDeep} ls={0.7}>
                  NEEDS FOLLOW-UP
                </Txt>
                <View style={{ backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                  <Txt w="eb" size={11} color={cx.alertDeep}>
                    {followUps.length}
                  </Txt>
                </View>
              </Row>
              {followUps.map((a, i) => {
                const c = clientByName[a.name];
                const org = (c && ORG_COLORS[c.org]) ?? ORG_COLORS.Independent;
                return (
                  <FollowUp
                    key={a.name}
                    initials={c?.initials ?? a.name.slice(0, 2).toUpperCase()}
                    iconBg={org.bg}
                    iconColor={org.c}
                    name={a.name}
                    meta={a.reason}
                    score={a.score}
                    color={a.tone === 'alert' ? cx.alert : cx.warning}
                    nudged={s.nudged.includes(a.name)}
                    onNudge={() => { haptics.success(); s.sendNudge(a.name, { score: a.score, comp: a.comp }); }}
                    onView={() => s.openPerson({ name: a.name, initials: c?.initials ?? a.name.slice(0, 2).toUpperCase(), pos: c?.sport ?? '', org: c?.org, score: a.score, comp: a.comp, last: c?.last })}
                    last={i === followUps.length - 1}
                  />
                );
              })}
            </View>
          ) : (
            <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: cx.successSurface }}>
              <Txt w="eb" size={12} color={cx.successDeep} ls={0.7} style={{ marginBottom: 6 }}>
                NEEDS FOLLOW-UP
              </Txt>
              <Txt w="sb" size={14} color={cx.slate700} style={{ lineHeight: 20 }}>
                {lens.allClearLine}
              </Txt>
            </View>
          )}
          </Reveal>

          {/* all clients */}
          <Reveal index={3}>
          <Row style={{ justifyContent: 'space-between', marginTop: 22, marginBottom: 12, marginHorizontal: 4 }}>
            <Txt w="eb" size={16} ls={-0.3}>
              All Clients
            </Txt>
            <Txt w="b" size={13} color={cx.textTertiary}>
              {kpis.clients} active
            </Txt>
          </Row>
          <View style={{ gap: 8 }}>
            {rankByRisk(TRAINER_CLIENTS).map((c) => {
              const g = gradeFor(c.score);
              const org = ORG_COLORS[c.org] ?? ORG_COLORS.Independent;
              return (
                <PressScale
                  key={c.name}
                  accessibilityLabel={`${c.name}, score ${c.score}. View client.`}
                  onPress={() => s.openPerson({ name: c.name, initials: c.initials, pos: c.sport, score: c.score, org: c.org, comp: c.comp, last: c.last })}
                  style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cx.card, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14 }, shadow.card]}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: cx.bg2, alignItems: 'center', justifyContent: 'center' }}>
                    <Txt w="b" size={13} color={cx.slate600}>
                      {c.initials}
                    </Txt>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt w="b" size={14}>
                      {c.name}
                    </Txt>
                    <Row style={{ gap: 7, marginTop: 4 }}>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 7, backgroundColor: org.bg }}>
                        <Txt w="b" size={11} color={org.c}>
                          {c.org}
                        </Txt>
                      </View>
                      <Txt w="sb" size={12} color={cx.textTertiary}>
                        {c.comp}% · {c.last}
                      </Txt>
                    </Row>
                  </View>
                  <Txt w="eb" num size={18} style={{ width: 30, textAlign: 'right' }}>
                    {c.score}
                  </Txt>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: g.bg }}>
                    <Txt w="eb" size={12} color={g.c}>
                      {g.g}
                    </Txt>
                  </View>
                </PressScale>
              );
            })}
          </View>
          </Reveal>

          <Reveal index={4}>
          <Card variant="low" style={{ marginTop: 16, borderRadius: 20 }}>
            <Row style={{ gap: 9, marginBottom: 12 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: cx.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="sparkle" size={17} color={cx.accent} />
              </View>
              <Txt w="eb" size={12} color={cx.accent} ls={0.4}>
                {aiPrefix}PRACTICE SUMMARY
              </Txt>
              <SampleTag />
            </Row>
            <Txt w="m" size={14} color={cx.slate700} style={{ lineHeight: 22 }}>
              Your book is healthy: {kpis.avgCompliance}% average compliance.{' '}
              {followUps.length === 0
                ? 'No clients are at risk right now, so keep the momentum with the steady ones.'
                : `${followUps.length === 1 ? '1 client is a retention risk' : `${followUps.length} clients are retention risks`}: ${followUps.map((a) => a.name).join(', ')}. Reaching out today is the move before they drift.`}
            </Txt>
          </Card>
          </Reveal>
        </ScrollView>
        )}
      </SafeAreaView>

      <RoleTabBar tabs={TRAINER_TABS} active={tab} onChange={s.setTrainerTab} />

      {s.personDetail && <PersonDetail />}
      {s.personDetail && s.coachGoalsOpen && <CoachGoalsEditor />}
      {isMealPlansEnabled && s.planEditorOpen && <CoachPlanEditor />}
      {s.msgOpen && <Messages />}
      {s.accountOpen && <Account />}
      {s.plansOpen && <Plans />}
      {s.overseerProfileOpen && <OverseerProfile />}
    </View>
  );
}

/** Trainer Profile tab — mirrors the coach profile: identity + settings entry points. */
function TrainerProfile({ orgTitle }: { orgTitle: string }) {
  const cx = useColors();
  const s = useStore();
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
      <Txt w="eb" size={12} color={cx.accent} ls={1} upper style={{ marginBottom: 6 }}>{orgTitle}</Txt>
      <Txt w="eb" size={28} ls={-0.8} style={{ marginBottom: 20 }}>Profile</Txt>
      <View style={{ gap: 10 }}>
        <SettingRow icon="menu" label="Account & settings" sub="Name, sign out, data export" onPress={s.openAccount} />
        <SettingRow icon="user" label="Practice & join code" sub="What clients see · edit your code" onPress={s.openOverseerProfile} />
        <SettingRow icon="send" label="Messages" sub="Your client threads" onPress={s.openMsg} />
      </View>
    </ScrollView>
  );
}

/** Client-initiated join requests waiting on the trainer (client-first, mirror of the
 *  coach inbox). Renders nothing when empty (incl. the whole demo build). Approve flips
 *  the request to active; the client then appears in the book. */
function PendingClientsCard() {
  const c = useColors();
  const { items, approve, decline } = usePendingClients();
  if (items.length === 0) return null;
  return (
    <Reveal index={0}>
    <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.border }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <Txt w="eb" size={11} color={c.accent} ls={0.7}>CLIENT REQUESTS</Txt>
        <Txt w="sb" size={12} color={c.textTertiary}>{items.length} waiting</Txt>
      </Row>
      {items.map((it) => (
        <Row key={`${it.practiceId}:${it.clientId}`} style={{ alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <Txt w="b" size={15}>{it.clientName || 'New client'}</Txt>
            <Txt w="m" size={12} color={c.textSecondary}>wants to join {it.practiceName}</Txt>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Approve ${it.clientName || 'client'}`}
            hitSlop={6}
            onPress={() => { haptics.success(); void approve(it.practiceId, it.clientId); }}
            style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 11, backgroundColor: c.accent }}
          >
            <Txt w="b" size={13} color={c.white}>Approve</Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Decline ${it.clientName || 'client'}`}
            hitSlop={6}
            onPress={() => { haptics.tap(); void decline(it.practiceId, it.clientId); }}
            style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
          >
            <Txt w="b" size={13} color={c.textSecondary}>Decline</Txt>
          </Pressable>
        </Row>
      ))}
    </View>
    </Reveal>
  );
}

function Kpi({ value, label, color, sample }: { value: string; label: string; color?: string; sample?: boolean }) {
  const cx = useColors();
  return (
    <Card style={{ flex: 1, borderRadius: 18, padding: 16 }}>
      <Txt w="eb" num size={28} color={color}>
        {value}
      </Txt>
      <Txt w="b" size={11} color={cx.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
      {sample ? <SampleTag style={{ marginTop: 7 }} /> : null}
    </Card>
  );
}

function FollowUp({ initials, iconBg, iconColor, name, meta, score, color, nudged, onNudge, onView, last }: { initials: string; iconBg?: string; iconColor?: string; name: string; meta: string; score: number; color: string; nudged: boolean; onNudge: () => void; onView: () => void; last?: boolean }) {
  const cx = useColors();
  return (
    <View style={{ backgroundColor: cx.card, borderRadius: 14, padding: 14, marginBottom: last ? 0 : 10 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: 11, flex: 1 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: iconBg ?? cx.bg2, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="b" size={12} color={iconColor ?? cx.slate600}>
              {initials}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="b" size={14}>
              {name}
            </Txt>
            <Txt w="sb" size={12} color={cx.alertDeep}>
              {meta}
            </Txt>
          </View>
        </Row>
        <Txt w="eb" num size={18} color={color}>
          {score}
        </Txt>
      </Row>
      <Row style={{ gap: 8, marginTop: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={nudged ? `Nudge sent to ${name}` : `Send a nudge to ${name}`}
          accessibilityState={{ disabled: nudged }}
          disabled={nudged}
          onPress={onNudge}
          style={({ pressed }) => ({ flex: 1, height: 34, borderRadius: 9, backgroundColor: nudged ? cx.successSurface : cx.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, opacity: pressed ? 0.85 : 1 })}
        >
          {nudged ? <Icon name="check" size={14} color={cx.successDeep} /> : null}
          <Txt w="b" size={12} color={nudged ? cx.successDeep : cx.white}>
            {nudged ? 'Nudged' : 'Send nudge'}
          </Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${name}`}
          onPress={() => { haptics.tap(); onView(); }}
          style={({ pressed }) => ({ flex: 1, height: 34, borderRadius: 9, backgroundColor: cx.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
        >
          <Txt w="b" size={12} color={cx.slate700}>
            View
          </Txt>
        </Pressable>
      </Row>
    </View>
  );
}
