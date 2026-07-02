// OnStandard — Coach view: a 5-destination tab shell (Dashboard / Roster / Needs Attention /
// Reports / Profile) mirroring the athlete app. Each destination answers "what should I do
// next"; the Dashboard is the morning briefing (who needs me today). All sections read the one
// platform-owned Execution Score; no per-coach number. The roster is computed once here and
// passed down so useLiveRoster fetches once. See docs/founding/ROLE_EXPERIENCE_ARCHITECTURE.md.
import React from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CHECKIN_QUESTIONS, ROSTER, coachRosterKpis, coachTeamTitle, filterRoster, gradeFor, needsAttention,
  notLoggedCount, rankByRisk, rosterGroups, rosterGroupStats, teamWeeklyReport, teamWeeklyReportText, trendInfo,
} from '@/core';
import type { RosterRow, RosterGroupStat, AtRiskInput } from '@/core';
import { useStore, useDerived } from '@/store';
import { aiTeamSummaryTag } from '@/lib/ai';
import { shadow, MAX_FONT_SCALE } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Input, PressScale, Reveal, Row, SampleTag, Toggle, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon, type IconName } from '@/icons';
import { Account } from '@/screens/overlays/Account';
import { Plans } from '@/screens/overlays/Plans';
import { OverseerProfile } from '@/screens/overlays/OverseerProfile';
import { Messages } from '@/screens/overlays/Messages';
import { PersonDetail } from '@/screens/overlays/PersonDetail';
import { CoachGoalsEditor } from '@/screens/overlays/CoachGoalsEditor';
import { useLiveRoster } from './useLiveRoster';
import { usePendingRequests } from './usePendingRequests';
import { CoachCopilot } from './CoachCopilot';

const COACH_TABS: { tab: 'dashboard' | 'roster' | 'attention' | 'reports' | 'profile'; label: string; icon: IconName }[] = [
  { tab: 'dashboard', label: 'Dashboard', icon: 'home' },
  { tab: 'roster', label: 'Roster', icon: 'squad' },
  { tab: 'attention', label: 'Attention', icon: 'bell' },
  { tab: 'reports', label: 'Reports', icon: 'plan' },
  { tab: 'profile', label: 'Profile', icon: 'user' },
];

export function CoachView() {
  const c = useColors();
  const s = useStore();
  const d = useDerived();
  // Real roster from fetchLinkedDays when isBackendLive, else the seeded showcase (identical
  // when off). Computed ONCE here; sections receive it so the live fetch runs only once.
  const { roster: rosterSource, live: rosterLive } = useLiveRoster(ROSTER);
  const roster = rosterSource.map((r) => (r.you ? { ...r, score: d.athleteScore } : r));
  const kpis = coachRosterKpis(roster);
  const onTrack = roster.length - kpis.alerts;
  const attention = needsAttention(roster);
  const teamTitle = coachTeamTitle({ isReal: s.athleteName.trim().length > 0, sport: s.obMeta.sport, school: s.obMeta.school, orgName: s.orgName });
  const teamReport = teamWeeklyReport(roster);
  const groups = rosterGroups(roster);
  const groupStats = rosterGroupStats(roster);
  const notLogged = notLoggedCount(roster);
  const rosterMeta: Record<string, { initials: string; pos: string; comp: number; athleteId?: string }> = Object.fromEntries(
    roster.map((r) => [r.name, { initials: r.initials, pos: r.pos, comp: r.comp, athleteId: r.athleteId }]),
  );
  const shareTeamReport = async () => {
    try { await Share.share({ message: teamWeeklyReportText(teamReport, teamTitle) }); }
    catch { /* user cancelled the share sheet */ }
  };

  const tab = s.coachTab;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'dashboard' && (
          <CoachDashboard
            teamTitle={teamTitle} rosterLive={rosterLive} kpis={kpis} teamReport={teamReport}
            attention={attention} rosterMeta={rosterMeta} onTrack={onTrack} rosterCount={roster.length}
          />
        )}
        {tab === 'roster' && <CoachRoster roster={roster} groups={groups} notLogged={notLogged} />}
        {tab === 'attention' && <CoachAttention attention={attention} rosterMeta={rosterMeta} />}
        {tab === 'reports' && <CoachReports teamTitle={teamTitle} teamReport={teamReport} groupStats={groupStats} compliance={kpis.compliance} onShare={shareTeamReport} roster={roster} />}
        {tab === 'profile' && <CoachProfile teamTitle={teamTitle} />}
      </View>

      <CoachTabBar />

      {s.personDetail && <PersonDetail />}
      {s.personDetail && s.coachGoalsOpen && <CoachGoalsEditor />}
      {s.msgOpen && <Messages />}
      {s.accountOpen && <Account />}
      {s.plansOpen && <Plans />}
      {s.overseerProfileOpen && <OverseerProfile />}
    </View>
  );
}

/* ---------------------------------------------------------------- shared scaffolding */
const SCROLL_PAD = { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 104 } as const;

function Section({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={SCROLL_PAD} showsVerticalScrollIndicator={false}>{children}</ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: React.ReactNode }) {
  const c = useColors();
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Txt w="sb" size={13} color={c.textSecondary}>{eyebrow}</Txt> : null}
        <Txt w="eb" size={26} ls={-0.5}>{title}</Txt>
      </View>
      {right}
    </Row>
  );
}

/* ---------------------------------------------------------------- Dashboard (briefing) */
/** Athlete-initiated join requests waiting on the coach (athlete-first "find my coach").
 *  Renders nothing when the inbox is empty (incl. the whole demo build, where the hook
 *  returns []). Approve flips the request to active; the athlete then joins the roster. */
function PendingRequestsCard() {
  const c = useColors();
  const { items, approve, decline } = usePendingRequests();
  if (items.length === 0) return null;
  return (
    <Reveal index={0}>
    <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.border }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <Txt w="eb" size={11} color={c.accent} ls={0.7}>JOIN REQUESTS</Txt>
        <Txt w="sb" size={12} color={c.textTertiary}>{items.length} waiting</Txt>
      </Row>
      {items.map((it) => (
        <Row key={`${it.teamId}:${it.athleteId}`} style={{ alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <Txt w="b" size={15}>{it.athleteName || 'New athlete'}</Txt>
            <Txt w="m" size={12} color={c.textSecondary}>{[it.position, `wants to join ${it.teamName}`].filter(Boolean).join(' · ')}</Txt>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Approve ${it.athleteName || 'athlete'}`}
            hitSlop={6}
            onPress={() => { haptics.success(); void approve(it.teamId, it.athleteId); }}
            style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 11, backgroundColor: c.accent }}
          >
            <Txt w="b" size={13} color={c.white}>Approve</Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Decline ${it.athleteName || 'athlete'}`}
            hitSlop={6}
            onPress={() => { haptics.tap(); void decline(it.teamId, it.athleteId); }}
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

function CoachDashboard({ teamTitle, rosterLive, kpis, teamReport, attention, rosterMeta, onTrack, rosterCount }: {
  teamTitle: string; rosterLive: boolean; kpis: { avgScore: number; compliance: number; alerts: number };
  teamReport: ReturnType<typeof teamWeeklyReport>; attention: ReturnType<typeof needsAttention>;
  rosterMeta: Record<string, { initials: string; pos: string; comp: number; athleteId?: string }>;
  onTrack: number; rosterCount: number;
}) {
  const c = useColors();
  const s = useStore();
  const preview = attention.slice(0, 3);
  return (
    <Section>
      <Row style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Account & settings" hitSlop={6} onPress={s.openAccount} style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
          <Icon name="menu" size={20} color={c.slate600} />
        </Pressable>
        <View>
          <Txt w="sb" size={13} color={c.textSecondary}>Coach Dashboard</Txt>
          <Txt w="eb" size={21} ls={-0.3}>{teamTitle}</Txt>
          {rosterLive ? null : (
            <Row style={{ gap: 7, marginTop: 5 }}>
              <SampleTag />
              <Txt w="sb" size={12} color={c.textTertiary}>Demo roster, not your real team</Txt>
            </Row>
          )}
        </View>
      </Row>

      <Reveal index={0}>
      <Row style={{ gap: 10, marginTop: 20 }}>
        <Kpi value={`${kpis.avgScore}`} label="TEAM AVG" />
        <Kpi value={`${kpis.compliance}%`} label="COMPLIANCE" color={c.success} />
        <Kpi value={`${kpis.alerts}`} label="ALERTS" color={c.alert} />
      </Row>
      </Reveal>

      <PendingRequestsCard />

      <Reveal index={1}>
      <PressScale accessibilityLabel="Open the full weekly report" haptic="none" onPress={() => { haptics.tap(); s.setCoachTab('reports'); }} style={{ marginTop: 14 }}>
        <Card variant="hero" style={{ borderRadius: 20 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.7}>THIS WEEK</Txt>
          <Txt w="eb" size={18} ls={-0.3} style={{ marginTop: 3 }}>{teamReport.headline}</Txt>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
            {teamReport.movedLine} {teamReport.onStandard} on standard, {teamReport.onBubble} on the bubble, {teamReport.needsIntervention} need intervention.
          </Txt>
          <Row style={{ gap: 6, marginTop: 12, alignItems: 'center' }}>
            <Txt w="b" size={13} color={c.accent}>Full report</Txt>
            <Icon name="chevronRight" size={15} color={c.accent} />
          </Row>
        </Card>
      </PressScale>
      </Reveal>

      <Reveal index={2}>
      {preview.length > 0 ? (
        <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: c.alertSurface, borderWidth: 1, borderColor: c.alertBorder }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 13 }}>
            <Txt w="eb" size={11} color={c.alert} ls={0.7}>NEEDS ATTENTION</Txt>
            {attention.length > preview.length ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`View all ${attention.length} who need attention`} hitSlop={6} onPress={() => { haptics.tap(); s.setCoachTab('attention'); }}>
                <Txt w="b" size={12} color={c.alert}>View all {attention.length}</Txt>
              </Pressable>
            ) : null}
          </Row>
          {preview.map((a, i) => {
            const m = rosterMeta[a.name] ?? { initials: a.name.slice(0, 2).toUpperCase(), pos: '', comp: a.comp };
            return (
              <AttentionRow
                key={a.name} initials={m.initials} name={a.name} meta={a.reason} score={a.score}
                color={a.tone === 'alert' ? c.alert : c.warning} nudged={s.nudged.includes(a.name)}
                onNudge={() => { haptics.success(); s.sendNudge(a.name, { score: a.score, comp: a.comp }); }}
                onPress={() => s.openPerson({ name: a.name, initials: m.initials, pos: m.pos, score: a.score, comp: m.comp, athleteId: m.athleteId })}
                last={i === preview.length - 1}
              />
            );
          })}
        </View>
      ) : (
        <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: c.successSurface }}>
          <Txt w="eb" size={11} color={c.successDeep} ls={0.7} style={{ marginBottom: 6 }}>NEEDS ATTENTION</Txt>
          <Txt w="sb" size={14} color={c.slate700} style={{ lineHeight: 20 }}>Everyone is above the line today. No one needs a nudge right now.</Txt>
        </View>
      )}
      </Reveal>

      <Reveal index={3}>
      <Card variant="low" style={{ marginTop: 18, borderRadius: 20 }}>
        <Row style={{ gap: 9, marginBottom: 12 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={17} color={c.accent} />
          </View>
          <Txt w="eb" size={12} color={c.accent} ls={0.4}>{aiTeamSummaryTag}</Txt>
          <SampleTag />
        </Row>
        <Txt w="m" size={14} color={c.slate700} style={{ lineHeight: 22 }}>
          The room is trending up: {onTrack} of {rosterCount} athletes are on track this week.{' '}
          {kpis.alerts === 0
            ? 'No one is below the alert line right now, so keep the cadence going.'
            : `${kpis.alerts} ${kpis.alerts === 1 ? 'athlete is' : 'athletes are'} pulling the average down. A quick check-in could help before it slips further.`}
        </Txt>
      </Card>
      </Reveal>
    </Section>
  );
}

/* ---------------------------------------------------------------- Roster */
function CoachRoster({ roster, groups, notLogged }: { roster: RosterRow[]; groups: string[]; notLogged: number }) {
  const c = useColors();
  const s = useStore();
  const [query, setQuery] = React.useState('');
  const [group, setGroup] = React.useState<string | null>(null);
  const [notLoggedOnly, setNotLoggedOnly] = React.useState(false);
  const filtered = rankByRisk(filterRoster(roster, { group, query, notLoggedOnly }));
  const filtering = group !== null || query.trim().length > 0 || notLoggedOnly;
  return (
    <Section>
      <SectionTitle eyebrow={filtering ? `${filtered.length} of ${roster.length}` : `${roster.length} athletes`} title="Roster" right={
        notLogged > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Filter to the ${notLogged} athletes who have not logged today`} accessibilityState={{ selected: notLoggedOnly }} onPress={() => { haptics.tap(); setNotLoggedOnly((v) => !v); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, backgroundColor: notLoggedOnly ? c.alert : c.alertSurface }}>
            <Icon name="bell" size={13} color={notLoggedOnly ? c.white : c.alert} />
            <Txt w="b" size={12} color={notLoggedOnly ? c.white : c.alert}>{notLogged} not logged</Txt>
          </Pressable>
        ) : undefined
      } />
      <Input value={query} onChangeText={setQuery} placeholder="Search athletes" accessibilityLabel="Search athletes by name" autoCapitalize="words" autoCorrect={false} style={{ marginBottom: 10 }} />
      {groups.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
          <GroupChip label="All" active={group === null} onPress={() => { haptics.tap(); setGroup(null); }} />
          {groups.map((g) => <GroupChip key={g} label={g} active={group === g} onPress={() => { haptics.tap(); setGroup(group === g ? null : g); }} />)}
        </ScrollView>
      ) : null}
      {filtered.length > 0 ? (
        <View style={{ gap: 8 }}>
          {filtered.map((a) => {
            const g = gradeFor(a.score);
            const tr = trendInfo(a.dir);
            return (
              <PressScale key={a.name} accessibilityLabel={`${a.name}, score ${a.score}. View athlete.`} onPress={() => s.openPerson({ name: a.name, initials: a.initials, pos: a.pos, score: a.score, comp: a.comp, athleteId: a.athleteId })}
                style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderRadius: 16, padding: 14 }, shadow.card]}>
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt w="b" size={13} color={c.slate600}>{a.initials}</Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Row style={{ gap: 6 }}>
                    <Txt w="b" size={14}>{a.name}</Txt>
                    {a.loggedToday === false ? (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, backgroundColor: c.alertSurface }}>
                        <Txt w="b" size={10} color={c.alert}>Not logged</Txt>
                      </View>
                    ) : null}
                  </Row>
                  <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 2 }}>{a.pos} · {a.comp}% compliant</Txt>
                </View>
                <Txt w="eb" size={16} color={tr.c}>{tr.t}</Txt>
                <Txt w="eb" num size={20} style={{ width: 32, textAlign: 'right' }}>{a.score}</Txt>
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: g.bg }}>
                  <Txt w="eb" size={12} color={g.c}>{g.g}</Txt>
                </View>
              </PressScale>
            );
          })}
        </View>
      ) : (
        <Card style={{ borderRadius: 16, padding: 18, alignItems: 'center' }}>
          <Txt w="sb" size={14} color={c.textSecondary} style={{ textAlign: 'center', lineHeight: 20 }}>
            {roster.length === 0
              ? 'No athletes yet. Share your team code so athletes can join.'
              : notLoggedOnly ? 'Everyone in this view has logged today.' : `No athletes match${group ? ` in ${group}` : ''}${query.trim() ? ` for "${query.trim()}"` : ''}.`}
          </Txt>
          {roster.length === 0 ? (
            (() => {
              // Surface the join code as the obvious next action for a new coach (instead of sending
              // them to dig through Account). Honest: when offline there is no real code yet, so it is
              // labelled a demo code rather than a working one the coach might share and have fail.
              const code = s.teamCode?.trim() || 'EAGLES24';
              const isDemoCode = !s.teamCode?.trim();
              return (
                <View style={{ marginTop: 14, alignItems: 'center', gap: 9 }}>
                  <View style={{ paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12, backgroundColor: c.accentSurface }}>
                    <Txt w="eb" size={24} ls={2} color={c.accent}>{code}</Txt>
                  </View>
                  {isDemoCode ? (
                    <Row style={{ gap: 6 }}>
                      <SampleTag />
                      <Txt w="sb" size={12} color={c.textTertiary}>Demo code — your real one is created when your team goes live</Txt>
                    </Row>
                  ) : null}
                </View>
              );
            })()
          ) : (
            <Pressable accessibilityRole="button" onPress={() => { haptics.tap(); setQuery(''); setGroup(null); setNotLoggedOnly(false); }} style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, backgroundColor: c.bg2 }}>
              <Txt w="b" size={13} color={c.slate700}>Clear filters</Txt>
            </Pressable>
          )}
        </Card>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- Needs Attention */
function CoachAttention({ attention, rosterMeta }: { attention: ReturnType<typeof needsAttention>; rosterMeta: Record<string, { initials: string; pos: string; comp: number; athleteId?: string }> }) {
  const c = useColors();
  const s = useStore();
  return (
    <Section>
      <SectionTitle eyebrow={attention.length > 0 ? `${attention.length} need a look` : 'All clear'} title="Needs Attention" />
      <Reveal index={0}>
      {attention.length > 0 ? (
        <View style={{ borderRadius: 20, padding: 18, backgroundColor: c.alertSurface, borderWidth: 1, borderColor: c.alertBorder }}>
          {attention.map((a, i) => {
            const m = rosterMeta[a.name] ?? { initials: a.name.slice(0, 2).toUpperCase(), pos: '', comp: a.comp };
            return (
              <AttentionRow
                key={a.name} initials={m.initials} name={a.name} meta={a.reason} score={a.score}
                color={a.tone === 'alert' ? c.alert : c.warning} nudged={s.nudged.includes(a.name)}
                onNudge={() => { haptics.success(); s.sendNudge(a.name, { score: a.score, comp: a.comp }); }}
                onPress={() => s.openPerson({ name: a.name, initials: m.initials, pos: m.pos, score: a.score, comp: m.comp, athleteId: m.athleteId })}
                last={i === attention.length - 1}
              />
            );
          })}
        </View>
      ) : (
        <View style={{ borderRadius: 20, padding: 22, backgroundColor: c.successSurface, alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="check" size={22} color={c.successDeep} />
          </View>
          <Txt w="eb" size={16} color={c.slate700} style={{ textAlign: 'center' }}>Everyone is above the line</Txt>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 19 }}>No one needs a nudge right now. Check back after today's logging.</Txt>
        </View>
      )}
      </Reveal>
    </Section>
  );
}

/* ---------------------------------------------------------------- Reports */
function CoachReports({ teamTitle, teamReport, groupStats, compliance, onShare, roster }: {
  teamTitle: string; teamReport: ReturnType<typeof teamWeeklyReport>; groupStats: RosterGroupStat[]; compliance: number; onShare: () => void; roster: AtRiskInput[];
}) {
  const c = useColors();
  return (
    <Section>
      <SectionTitle eyebrow={teamTitle} title="Reports" />

      <Reveal index={0}>
      <Card variant="hero" style={{ borderRadius: 20 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={11} color={c.textTertiary} ls={0.7}>WEEKLY REPORT</Txt>
            <Txt w="eb" size={18} ls={-0.3} style={{ marginTop: 3 }}>{teamReport.headline}</Txt>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Share team weekly report" hitSlop={6} onPress={onShare}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: c.accentSurface, opacity: pressed ? 0.8 : 1 })}>
            <Icon name="send" size={14} color={c.accent} />
            <Txt w="b" size={12} color={c.accent}>Share</Txt>
          </Pressable>
        </Row>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
          {teamReport.movedLine} {teamReport.onStandard} on standard, {teamReport.onBubble} on the bubble, {teamReport.needsIntervention} need intervention.
        </Txt>
        <Row style={{ gap: 10, marginTop: 14 }}>
          <ReportStat label="BEST MOVER" name={teamReport.mostImproved?.name ?? 'None yet'} score={teamReport.mostImproved?.score} color={c.successDeep} />
          <ReportStat label="MOST AT RISK" name={teamReport.mostAtRisk?.name ?? 'None'} score={teamReport.mostAtRisk?.score} color={c.alert} />
        </Row>
      </Card>
      </Reveal>

      {groupStats.length > 0 ? (
        <Reveal index={1}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 4 }}>Position groups</Txt>
          <Txt w="m" size={12} color={c.textSecondary} style={{ marginBottom: 14 }}>Average Execution Score and compliance by group.</Txt>
          <View style={{ gap: 12 }}>
            {groupStats.map((g) => <GroupStatRow key={g.group} stat={g} />)}
          </View>
        </Card>
        </Reveal>
      ) : null}

      <Reveal index={2}>
      <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
        <Txt w="eb" size={15} ls={-0.3}>Compliance</Txt>
        <Row style={{ alignItems: 'baseline', gap: 8, marginTop: 10 }}>
          <Txt w="eb" num size={34} ls={-1} color={c.successDeep}>{compliance}%</Txt>
          <Txt w="b" size={12} color={c.textTertiary}>of the plan, team-wide this week</Txt>
        </Row>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>{teamReport.movedLine}</Txt>
      </Card>
      </Reveal>

      <Reveal index={3}>
      <View style={{ marginTop: 14 }}>
        <CoachCopilot roster={roster} />
      </View>
      </Reveal>
    </Section>
  );
}

function GroupStatRow({ stat }: { stat: RosterGroupStat }) {
  const c = useColors();
  const g = gradeFor(stat.avgScore);
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <View style={{ flex: 1 }}>
        <Txt w="b" size={14} color={c.slate700}>{stat.group}</Txt>
        <Txt w="m" size={12} color={c.textTertiary}>{stat.count} {stat.count === 1 ? 'athlete' : 'athletes'} · {stat.avgCompliance}% compliant</Txt>
      </View>
      <Txt w="eb" num size={20} style={{ width: 34, textAlign: 'right' }}>{stat.avgScore}</Txt>
      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: g.bg, marginLeft: 10 }}>
        <Txt w="eb" size={12} color={g.c}>{g.g}</Txt>
      </View>
    </Row>
  );
}

/* ---------------------------------------------------------------- Profile / Admin */
function CoachProfile({ teamTitle }: { teamTitle: string }) {
  const c = useColors();
  const s = useStore();
  return (
    <Section>
      <SectionTitle eyebrow={teamTitle} title="Profile" />
      <Reveal index={0}>
      <View style={{ gap: 10 }}>
        <SettingRow icon="menu" label="Account & settings" sub="Name, sign out, data export" onPress={s.openAccount} />
        <SettingRow icon="user" label="Team & org name" sub="What athletes and parents see" onPress={s.openOverseerProfile} />
        <SettingRow icon="send" label="Messages" sub="Your athlete threads" onPress={s.openMsg} />
      </View>
      </Reveal>

      <Reveal index={1}>
      <Card variant="low" style={{ marginTop: 18, borderRadius: 20 }}>
        <Txt w="eb" size={15} ls={-0.3}>Weekly check-in questions</Txt>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 4, marginBottom: 14, lineHeight: 19 }}>
          Athletes only answer what you turn on. Changes apply to next week's check-in.
        </Txt>
        <View style={{ gap: 13 }}>
          {CHECKIN_QUESTIONS.map((q) => (
            <Row key={q.key} style={{ justifyContent: 'space-between' }}>
              <Txt w="b" size={14}>{q.label}</Txt>
              <Toggle on={s.ciConfig[q.key]} onPress={() => s.toggleCiQ(q.key)} label={q.label} />
            </Row>
          ))}
        </View>
      </Card>
      </Reveal>
    </Section>
  );
}

function SettingRow({ icon, label, sub, onPress }: { icon: IconName; label: string; sub: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { haptics.tap(); onPress(); }}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: c.card, borderRadius: 16, padding: 16 }, shadow.card]}>
      <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={c.slate600} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="b" size={15}>{label}</Txt>
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>{sub}</Txt>
      </View>
      <Icon name="chevronRight" size={18} color="#CBD5E1" />
    </Pressable>
  );
}

/* ---------------------------------------------------------------- tab bar */
function CoachTabBar() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const tab = useStore((st) => st.coachTab);
  const setCoachTab = useStore((st) => st.setCoachTab);
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 10), paddingTop: 10, backgroundColor: c.card, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: c.border }}>
      {COACH_TABS.map((t) => (
        <CoachTabItem key={t.tab} item={t} active={tab === t.tab} onPress={() => { haptics.tap(); setCoachTab(t.tab); }} />
      ))}
    </View>
  );
}

function CoachTabItem({ item, active, onPress }: { item: { label: string; icon: IconName }; active: boolean; onPress: () => void }) {
  const c = useColors();
  const color = active ? c.accent : c.textTertiary;
  return (
    <Pressable accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: active }} onPress={onPress} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Icon name={item.icon} size={22} color={color} />
      <Txt w={active ? 'b' : 'sb'} size={10.5} color={color} maxFontSizeMultiplier={MAX_FONT_SCALE}>{item.label}</Txt>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- small shared bits */
function Kpi({ value, label, color }: { value: string; label: string; color?: string }) {
  const c = useColors();
  return (
    <Card style={{ flex: 1, borderRadius: 18, padding: 16 }}>
      <Txt w="eb" num size={28} color={color}>{value}</Txt>
      <Txt w="b" size={11} color={c.textTertiary} style={{ marginTop: 3 }}>{label}</Txt>
    </Card>
  );
}

function ReportStat({ label, name, score, color }: { label: string; name: string; score?: number; color: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 14, padding: 13 }}>
      <Txt w="eb" size={10} color={c.textTertiary} ls={0.5}>{label}</Txt>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', marginTop: 5 }}>
        <Txt w="b" size={14} color={c.slate700} style={{ flex: 1 }} numberOfLines={1}>{name}</Txt>
        {typeof score === 'number' ? <Txt w="eb" num size={16} color={color} style={{ marginLeft: 8 }}>{score}</Txt> : null}
      </Row>
    </View>
  );
}

function GroupChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Show ${label}`} accessibilityState={{ selected: active }} onPress={onPress}
      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: active ? c.accent : c.card, borderWidth: 1, borderColor: active ? c.accent : c.border }}>
      <Txt w="b" size={13} color={active ? c.white : c.slate600}>{label}</Txt>
    </Pressable>
  );
}

function AttentionRow({ initials, name, meta, score, color, nudged, onNudge, onPress, last }: { initials: string; name: string; meta: string; score: number; color: string; nudged: boolean; onNudge: () => void; onPress: () => void; last?: boolean }) {
  // The person tap and the nudge are SIBLING pressables (not nested), so this is valid on web too.
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: last ? 0 : 13 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}, score ${score}. ${meta}. View athlete.`} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1 }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="b" size={13} color={c.slate600}>{initials}</Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={14}>{name}</Txt>
          <Txt w="m" size={12} color={c.textTertiary}>{meta}</Txt>
        </View>
        <Txt w="eb" num size={19} color={color} style={{ marginRight: 12 }}>{score}</Txt>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={nudged ? `Nudge sent to ${name}` : `Send a nudge to ${name}`} accessibilityState={{ disabled: nudged }} disabled={nudged} hitSlop={8} onPress={onNudge}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, backgroundColor: nudged ? c.successSurface : c.accent, opacity: pressed ? 0.85 : 1 })}>
        {nudged ? <Icon name="check" size={12} color={c.successDeep} /> : null}
        <Txt w="b" size={12} color={nudged ? c.successDeep : c.white}>{nudged ? 'Nudged' : 'Nudge'}</Txt>
      </Pressable>
    </View>
  );
}
