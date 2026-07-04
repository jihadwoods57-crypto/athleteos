// OnStandard — Trainer mobile view: the Assistant Nutritionist's brief leads (retention
// first — paying clients drift quietly), then the client book, compliance trend, and
// one-tap proof-of-value shares.
import React from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  ORG_COLORS, TRAINER_CLIENTS, buildAssistantBrief, clientResultText, gradeFor, initials,
  rankByRisk, teamWeeklyReport, trainerBookKpis, trainerLens,
} from '@/core';
import { AssistantBriefCard, AssistantKpiStrip, AssistantUpgradeCard, TriageQueue, useAssistantUnlocked } from './AssistantBriefCard';
import { useStore } from '@/store';
import { isBackendLive } from '@/lib/supabase';
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
import { MealReview } from '@/screens/overlays/MealReview';
import { CoachGoalsEditor } from '@/screens/overlays/CoachGoalsEditor';
import { usePendingClients } from './usePendingClients';
import { useLiveRoster } from './useLiveRoster';
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
  // The trainer's REAL clients (approved practice_clients + their day rows). Before
  // this read existed, the approve inbox flipped a real row to active and the client
  // then vanished into a book that could only ever show the 5 demo people.
  const { roster: liveClients, live: clientsLive } = useLiveRoster([], 'practice');
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
  const unlocked = useAssistantUnlocked();
  // The Assistant Nutritionist's brief over THIS book (live clients when connected, the
  // seeded demo book otherwise) — retention-first framing is the trainer role's directive.
  const book = clientsLive && liveClients.length > 0 ? liveClients : TRAINER_CLIENTS;
  const bookLive = clientsLive && liveClients.length > 0;
  const bookScope = bookLive ? ('today' as const) : ('week' as const);
  const bookReport = teamWeeklyReport(book.map((b) => ({ name: b.name, score: b.score, comp: b.comp, dir: b.dir })), bookScope);
  const brief = buildAssistantBrief({ role: 'trainer', roster: book, report: bookReport, scope: bookScope });
  const bookMeta: Record<string, { initials: string; pos: string; comp: number; athleteId?: string }> = Object.fromEntries(
    book.map((b) => [b.name, { initials: b.initials ?? b.name.slice(0, 2).toUpperCase(), pos: ('pos' in b ? (b as { pos?: string }).pos : undefined) ?? ('sport' in b ? (b as { sport?: string }).sport : undefined) ?? '', comp: b.comp, athleteId: 'athleteId' in b ? (b as { athleteId?: string }).athleteId : undefined }]),
  );
  // Proof-of-value share: the retention lever. Live clients only — a demo share would
  // put fabricated numbers in a real client's messages.
  const shareClientResult = async (cl: { name: string; score: number; comp: number; dir: 'up' | 'down' | 'flat' }) => {
    try { await Share.share({ message: clientResultText(cl, bookScope) }); } catch { /* user cancelled */ }
  };

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

          {/* The briefing leads (Assistant Nutritionist, 2026-07-04): retention first —
              a paying client going quiet is how a trainer's book shrinks. Locked accounts
              get the honest upgrade card; metrics demote to the quiet strip either way. */}
          <Reveal index={0}>
          {unlocked ? (
            <>
              <AssistantBriefCard brief={brief} live={bookLive} />
              <TriageQueue brief={brief} rosterMeta={bookMeta} />
            </>
          ) : (
            <AssistantUpgradeCard brief={brief} noun="client" />
          )}
          <AssistantKpiStrip brief={brief} noun="clients" />
          </Reveal>

          <PendingClientsCard />

          {/* Your real clients — the surface an approved client lands on. */}
          {clientsLive && liveClients.length > 0 ? (
            <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: cx.card, ...shadow.card }}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <Txt w="eb" size={12} color={cx.accent} ls={0.7}>YOUR CLIENTS</Txt>
                <Txt w="sb" size={12} color={cx.textTertiary}>{liveClients.length} active</Txt>
              </Row>
              {liveClients.map((cl, i) => {
                const g = gradeFor(cl.score);
                return (
                  <PressScale
                    key={cl.athleteId ?? cl.name}
                    accessibilityLabel={`${cl.name}, score ${cl.score}. View client.`}
                    onPress={() => s.openPerson({ name: cl.name, initials: cl.initials, pos: cl.pos, score: cl.score, comp: cl.comp, athleteId: cl.athleteId })}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: cx.border }}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: cx.bg2, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt w="b" size={12} color={cx.slate600}>{cl.initials}</Txt>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Row style={{ gap: 6 }}>
                        <Txt w="b" size={14}>{cl.name}</Txt>
                        {cl.loggedToday === false ? (
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, backgroundColor: cx.alertSurface }}>
                            <Txt w="b" size={10} color={cx.alert}>Not logged</Txt>
                          </View>
                        ) : null}
                      </Row>
                      <Txt w="m" size={12} color={cx.textTertiary} style={{ marginTop: 2 }}>{cl.comp}% compliant today</Txt>
                    </View>
                    {/* Proof-of-value (retention lever): send the client their real progress
                        note in one tap. Live rows only — never share demo numbers. */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Share ${cl.name}'s progress with them`}
                      hitSlop={8}
                      onPress={() => { haptics.tap(); void shareClientResult(cl); }}
                      style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 10, backgroundColor: cx.accentSurface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
                    >
                      <Icon name="send" size={14} color={cx.accent} />
                    </Pressable>
                    <Txt w="eb" num size={18}>{cl.score}</Txt>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: g.bg }}>
                      <Txt w="eb" size={12} color={g.c}>{g.g}</Txt>
                    </View>
                  </PressScale>
                );
              })}
            </View>
          ) : null}

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

          {/* (The old NEEDS FOLLOW-UP block is retired: the TriageQueue above carries the
              same clients with evidence + a ready message, retention-ranked by the brief.) */}

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

          {/* (The old showcase PRACTICE SUMMARY card is retired: the Assistant
              Nutritionist brief at the top carries the same read, retention-first.) */}
        </ScrollView>
        )}
      </SafeAreaView>

      <RoleTabBar tabs={TRAINER_TABS} active={tab} onChange={s.setTrainerTab} />

      {s.personDetail && <PersonDetail />}
      {s.mealReview && <MealReview />}
      {s.personDetail && s.coachGoalsOpen && <CoachGoalsEditor />}
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

// (Kpi tiles + FollowUp rows retired: the Assistant Nutritionist brief and TriageQueue carry the same jobs.)
