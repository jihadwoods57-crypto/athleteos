// OnStandard — Trainer mobile view: the Assistant Nutritionist's brief leads (retention
// first — paying clients drift quietly), then the client book, compliance trend, and
// one-tap proof-of-value shares.
import React from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  TRAINER_CLIENTS, buildAssistantBrief, clientResultText, initials,
  rankByRisk, teamWeeklyReport, tierFor, trainerBookKpis, trainerLens, trendInfo,
} from '@/core';
import { AssistantBriefCard, AssistantKpiStrip, AssistantUpgradeCard, TriageQueue, useAssistantUnlocked } from './AssistantBriefCard';
import { useStore } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { tierChip, shadow } from '@/ui/tokens';
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
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Row style={{ gap: 12, flex: 1, minWidth: 0 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Account & settings" hitSlop={6} onPress={s.openAccount} style={[{ width: 44, height: 44, borderRadius: 14, backgroundColor: cx.card, alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
                <Icon name="menu" size={20} color={cx.slate600} />
              </Pressable>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt w="sb" size={13} color={cx.textSecondary}>
                  {orgTitle}
                </Txt>
                <Txt w="eb" size={22} ls={-0.5} style={{ marginTop: 1 }}>
                  {lens.headerTitle}
                </Txt>
                <Row style={{ gap: 7, marginTop: 6 }}>
                  <SampleTag />
                  <Txt w="sb" size={12} color={cx.textTertiary} numberOfLines={1} style={{ flexShrink: 1 }}>
                    Demo book, not your real clients
                  </Txt>
                </Row>
              </View>
            </Row>
            <View style={[{ width: 44, height: 44, borderRadius: 14, backgroundColor: cx.trainer, alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
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

          {/* Your real clients — the surface an approved client lands on. Squad-standard
              rows: tier-colored flag dot on the avatar + a tier score chip so the room's
              state reads in color first. */}
          {clientsLive && liveClients.length > 0 ? (
            <Card variant="low" style={{ marginTop: 14, borderRadius: 20, padding: 18 }}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <Txt w="eb" size={11} color={cx.accent} ls={0.8}>YOUR CLIENTS</Txt>
                <Txt w="sb" size={12} color={cx.textTertiary}>{liveClients.length} active</Txt>
              </Row>
              {liveClients.map((cl, i) => {
                const t = tierFor(cl.score);
                const chip = tierChip[t.short];
                const openThis = () => s.openPerson({ name: cl.name, initials: cl.initials, pos: cl.pos, score: cl.score, comp: cl.comp, athleteId: cl.athleteId });
                // Row is a plain container, NOT a button: the "view client" tap area and the
                // Share button are SIBLINGS. Nesting them (a Pressable inside a Pressable) emits
                // invalid <button> DOM and a hydration error on web (2026-07-04 fix).
                return (
                  <View
                    key={cl.athleteId ?? cl.name}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: cx.hairline }}
                  >
                    <PressScale
                      accessibilityLabel={`${cl.name}, ${t.name}, score ${cl.score}. View client.`}
                      onPress={openThis}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 }}
                    >
                      <View>
                        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: cx.surface2, alignItems: 'center', justifyContent: 'center' }}>
                          <Txt w="b" size={13} color={cx.slate600}>{cl.initials}</Txt>
                        </View>
                        <View style={{ position: 'absolute', bottom: -2, right: -2, width: 13, height: 13, borderRadius: 7, backgroundColor: chip.fg, borderWidth: 2.5, borderColor: cx.card }} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Row style={{ gap: 6 }}>
                          <Txt w="b" size={14.5} numberOfLines={1} style={{ flexShrink: 1 }}>{cl.name}</Txt>
                          {cl.loggedToday === false ? (
                            <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 6, backgroundColor: cx.alertSurface }}>
                              <Txt w="b" size={10} color={cx.alert}>Not logged</Txt>
                            </View>
                          ) : null}
                        </Row>
                        <Row style={{ gap: 6, marginTop: 3 }}>
                          <Txt w="sb" size={11.5} color={chip.fg}>{t.name}</Txt>
                          <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: cx.textTertiary, opacity: 0.5 }} />
                          <Txt w="m" size={12} color={cx.textTertiary}>{cl.comp}% today</Txt>
                        </Row>
                      </View>
                    </PressScale>
                    {/* Proof-of-value (retention lever): send the client their real progress
                        note in one tap. Live rows only — never share demo numbers. */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Share ${cl.name}'s progress with them`}
                      hitSlop={8}
                      onPress={() => { haptics.tap(); void shareClientResult(cl); }}
                      style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 11, backgroundColor: cx.accentSurface, borderWidth: 1, borderColor: cx.accentBorder, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
                    >
                      <Icon name="send" size={14} color={cx.accent} />
                    </Pressable>
                    <PressScale
                      accessibilityLabel={`Open ${cl.name}`}
                      onPress={openThis}
                      style={{ minWidth: 46, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 11, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center' }}
                    >
                      <Txt w="eb" num size={18} color={chip.fg}>{cl.score}</Txt>
                    </PressScale>
                  </View>
                );
              })}
            </Card>
          ) : null}

          {/* book compliance trend */}
          <Reveal index={1}>
          <Card variant="hero" style={{ marginTop: 14, borderRadius: 24, padding: 22 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                <Row style={{ gap: 8, marginBottom: 6 }}>
                  <Txt w="eb" size={11} color={cx.textTertiary} ls={0.8}>
                    COMPLIANCE TREND
                  </Txt>
                  <SampleTag />
                </Row>
                <Txt w="eb" size={16} ls={-0.3}>
                  {lens.complianceTitle}
                </Txt>
                <Txt w="sb" size={13} color={cx.textSecondary} style={{ marginTop: 3 }}>
                  All clients · 8-week average
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt w="eb" num size={26} ls={-0.5}>
                  {kpis.avgCompliance}%
                </Txt>
                <Row style={{ gap: 3, alignItems: 'center', marginTop: 2 }}>
                  <Txt w="b" size={12} color={cx.success}>↑</Txt>
                  <Txt w="b" size={12} color={cx.success}>+6%</Txt>
                </Row>
              </View>
            </Row>
            <Svg viewBox="0 0 322 96" width="100%" height={92} preserveAspectRatio="none" style={{ marginTop: 10 }}>
              <Defs>
                <LinearGradient id="tbc" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={cx.accent} stopOpacity="0.16" />
                  <Stop offset="1" stopColor={cx.accent} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Path d="M12,70 L62,66 L111,68 L161,58 L211,52 L260,46 L310,40 L310,96 L12,96 Z" fill="url(#tbc)" />
              <Path d="M12,70 L62,66 L111,68 L161,58 L211,52 L260,46 L310,40" fill="none" stroke={cx.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={310} cy={40} r={5.5} fill={cx.accent} stroke={cx.card} strokeWidth={2.5} />
            </Svg>
          </Card>
          </Reveal>

          {/* (The old NEEDS FOLLOW-UP block is retired: the TriageQueue above carries the
              same clients with evidence + a ready message, retention-ranked by the brief.) */}

          {/* all clients — the full book, risk-ranked. Squad-standard rows: tier flag dot
              on the avatar, a trend arrow, and a tier-colored score chip. */}
          <Reveal index={3}>
          <Txt w="eb" size={11} color={cx.textTertiary} ls={0.8} style={{ marginTop: 30, marginBottom: 2, marginHorizontal: 4 }}>
            YOUR BOOK
          </Txt>
          <Row style={{ justifyContent: 'space-between', marginBottom: 12, marginHorizontal: 4 }}>
            <Txt w="eb" size={20} ls={-0.5}>
              All Clients
            </Txt>
            <Txt w="b" size={13} color={cx.textTertiary}>
              {kpis.clients} active
            </Txt>
          </Row>
          <View style={{ gap: 9 }}>
            {rankByRisk(TRAINER_CLIENTS).map((c) => {
              const t = tierFor(c.score);
              const chip = tierChip[t.short];
              const tr = trendInfo(c.dir);
              // Trend color from the theme (never trendInfo's baked-in light hex), so the
              // arrow reads correctly on the dark canvas.
              const trColor = c.dir === 'up' ? cx.success : c.dir === 'down' ? cx.alert : cx.textTertiary;
              return (
                <PressScale
                  key={c.name}
                  accessibilityLabel={`${c.name}, ${c.org}, ${t.name}, score ${c.score}. View client.`}
                  onPress={() => s.openPerson({ name: c.name, initials: c.initials, pos: c.sport, score: c.score, org: c.org, comp: c.comp, last: c.last })}
                  style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cx.card, borderRadius: 18, borderWidth: 1, borderColor: cx.hairline, paddingVertical: 13, paddingHorizontal: 14 }, shadow.card]}
                >
                  <View>
                    <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: cx.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt w="b" size={14} color={cx.slate600}>
                        {c.initials}
                      </Txt>
                    </View>
                    <View style={{ position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: chip.fg, borderWidth: 2.5, borderColor: cx.card }} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt w="b" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>
                      {c.name}
                    </Txt>
                    <Row style={{ gap: 7, marginTop: 4 }}>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 7, backgroundColor: cx.surface2, borderWidth: 1, borderColor: cx.hairline }}>
                        <Txt w="b" size={11} color={cx.textSecondary}>
                          {c.org}
                        </Txt>
                      </View>
                      <Txt w="sb" size={12} color={cx.textTertiary}>
                        {c.comp}% · {c.last}
                      </Txt>
                    </Row>
                  </View>
                  <Txt w="eb" size={15} color={trColor} accessibilityLabel={c.dir === 'up' ? 'Trending up' : c.dir === 'down' ? 'Trending down' : 'Trend flat'}>
                    {tr.t}
                  </Txt>
                  <View style={{ minWidth: 46, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 11, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center' }}>
                    <Txt w="eb" num size={18} color={chip.fg}>
                      {c.score}
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
      <Txt w="eb" size={11} color={cx.accent} ls={0.8} upper style={{ marginBottom: 6 }}>{orgTitle}</Txt>
      <Txt w="eb" size={28} ls={-0.8} accessibilityRole="header" style={{ marginBottom: 20 }}>Profile</Txt>
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
    <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <Row style={{ gap: 7, alignItems: 'center' }}>
          <Icon name="squad" size={13} color={c.accent} />
          <Txt w="eb" size={11} color={c.accent} ls={0.8}>CLIENT REQUESTS</Txt>
        </Row>
        <Txt w="sb" size={12} color={c.textTertiary}>{items.length} waiting</Txt>
      </Row>
      {items.map((it, i) => (
        <Row key={`${it.practiceId}:${it.clientId}`} style={{ alignItems: 'center', gap: 10, paddingTop: i === 0 ? 0 : 10, marginTop: i === 0 ? 0 : 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.accentBorder }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="b" size={13} color={c.accent}>{initials(it.clientName || '', 'NC')}</Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="b" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>{it.clientName || 'New client'}</Txt>
            <Txt w="m" size={12} color={c.textSecondary} numberOfLines={1}>wants to join {it.practiceName}</Txt>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Approve ${it.clientName || 'client'}`}
            hitSlop={6}
            onPress={() => { haptics.success(); void approve(it.practiceId, it.clientId); }}
            style={({ pressed }) => ({ paddingVertical: 9, paddingHorizontal: 15, borderRadius: 12, backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 })}
          >
            <Txt w="b" size={13} color={c.white}>Approve</Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Decline ${it.clientName || 'client'}`}
            hitSlop={6}
            onPress={() => { haptics.tap(); void decline(it.practiceId, it.clientId); }}
            style={({ pressed }) => ({ paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.7 : 1 })}
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
