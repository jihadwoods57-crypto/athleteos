// OnStandard — Coach view: a 5-destination tab shell (Dashboard / Roster / Needs Attention /
// Reports / Profile) mirroring the athlete app. Each destination answers "what should I do
// next"; the Dashboard is the morning briefing (who needs me today). All sections read the one
// platform-owned Execution Score; no per-coach number. The roster is computed once here and
// passed down so useLiveRoster fetches once. See docs/founding/ROLE_EXPERIENCE_ARCHITECTURE.md.
import React from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CHECKIN_QUESTIONS, COACH_ALERT_THRESHOLD, ROSTER, activationStatus, atRiskReason,
  buildAssistantBrief, coachRosterKpis, coachTeamTitle,
  filterRoster, needsAttention, notLoggedCount, nudgeMessageFor, parseRosterTarget,
  rankByRisk, rosterCsv, rosterGroups, rosterGroupStats, teamWeeklyReport, teamWeeklyReportText,
  tierFor, trendInfo, type AssistantBrief,
} from '@/core';
import { AssistantBriefCard, AssistantKpiStrip, AssistantUpgradeCard, TriageQueue, useAssistantUnlocked } from './AssistantBriefCard';
import type { RosterRow, RosterGroupStat, AtRiskInput } from '@/core';
import { useStore, useDerived } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { tierChip, shadow, MAX_FONT_SCALE } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Input, PressScale, Reveal, Row, SampleTag, Toggle, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon, type IconName } from '@/icons';
import { Account } from '@/screens/overlays/Account';
import { Plans } from '@/screens/overlays/Plans';
import { OverseerProfile } from '@/screens/overlays/OverseerProfile';
import { Messages } from '@/screens/overlays/Messages';
import { PersonDetail } from '@/screens/overlays/PersonDetail';
import { MealReview } from '@/screens/overlays/MealReview';
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
  const { roster: rosterSource, live: rosterLive, weekReport } = useLiveRoster(ROSTER);
  const roster = rosterSource.map((r) => (r.you ? { ...r, score: d.athleteScore } : r));
  const kpis = coachRosterKpis(roster);
  const onTrack = roster.length - kpis.alerts;
  const attention = needsAttention(roster);
  const teamTitle = coachTeamTitle({ isReal: s.athleteName.trim().length > 0, sport: s.obMeta.sport, school: s.obMeta.school, orgName: s.orgName });
  // Live with membership: a REAL 7-day report (silent athletes counted) in honest week
  // language. Live without it: today's snapshot in day language. Demo: the seeded week.
  const reportScope = !rosterLive || weekReport ? ('week' as const) : ('today' as const);
  const teamReport = weekReport ?? teamWeeklyReport(roster, reportScope);
  const groups = rosterGroups(roster);
  const groupStats = rosterGroupStats(roster);
  const notLogged = notLoggedCount(roster);
  const rosterMeta: Record<string, { initials: string; pos: string; comp: number; athleteId?: string }> = Object.fromEntries(
    roster.map((r) => [r.name, { initials: r.initials, pos: r.pos, comp: r.comp, athleteId: r.athleteId }]),
  );
  // The Assistant Nutritionist's brief: assembled from the SAME rows/report the dashboard
  // already computed (no new fetches), so the brief can never disagree with the tabs.
  const brief = buildAssistantBrief({ role: 'coach', roster, report: teamReport, scope: reportScope });
  const shareTeamReport = async () => {
    try { await Share.share({ message: teamWeeklyReportText(teamReport, teamTitle, reportScope) }); }
    catch { /* user cancelled the share sheet */ }
  };
  // Reporting add-on (2026-07-04): the spreadsheet-ready roster export a coach drops in
  // front of an AD or a parent meeting. Same rows the dashboard renders, risk-ranked.
  const shareRosterCsv = async () => {
    try { await Share.share({ message: rosterCsv(rankByRisk(roster)), title: `${teamTitle} roster.csv` }); }
    catch { /* user cancelled the share sheet */ }
  };

  const tab = s.coachTab;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'dashboard' && (
          <CoachDashboard
            teamTitle={teamTitle} rosterLive={rosterLive} brief={brief} teamReport={teamReport}
            attention={attention} rosterMeta={rosterMeta} rosterCount={roster.length}
            reportScope={reportScope}
          />
        )}
        {tab === 'roster' && <CoachRoster roster={roster} groups={groups} notLogged={notLogged} />}
        {tab === 'attention' && <CoachAttention attention={attention} rosterMeta={rosterMeta} rosterCount={roster.length} />}
        {tab === 'reports' && <CoachReports teamTitle={teamTitle} teamReport={teamReport} groupStats={groupStats} compliance={kpis.compliance} onShare={shareTeamReport} onExportCsv={shareRosterCsv} roster={roster} reportScope={reportScope} />}
        {tab === 'profile' && <CoachProfile teamTitle={teamTitle} />}
      </View>

      <CoachTabBar />

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

/* ---------------------------------------------------------------- shared scaffolding */
const SCROLL_PAD = { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 104 } as const;

/** Status color bound to the VALUE, not the metric name: 0% compliance is not "green"
 *  just because the tile is labelled COMPLIANCE, and 0 alerts is not "red" (that's good).
 *  A neutral (undefined) result renders in the default text color. */
function kpiTone(c: ReturnType<typeof useColors>, kind: 'compliance' | 'alerts', value: number): string | undefined {
  if (kind === 'compliance') return value >= 70 ? c.successDeep : value >= 40 ? c.warningDeep : c.alert;
  return value > 0 ? c.alert : c.successDeep; // alerts: red only when someone actually needs a look
}

/** The team join-code, shared honestly. A real server code gets a Share button and
 *  "give this to your athletes"; the demo fallback is tagged SAMPLE with a working
 *  Create-my-code retry (onboarding's create_team can fail, e.g. email unconfirmed).
 *  One source of truth reused by the empty Dashboard and the empty Roster. */
function TeamCodeShare() {
  const c = useColors();
  const s = useStore();
  const realCode = !!s.teamCode?.trim();
  const code = s.teamCode?.trim() || 'EAGLES24';
  const share = async () => {
    try { await Share.share({ message: `Join our team on OnStandard — enter team code ${code} after you sign up.` }); }
    catch { /* user cancelled the share sheet */ }
  };
  const retryCreate = () => {
    haptics.tap();
    const meta = s.obMeta ?? {};
    const sport = typeof meta.sport === 'string' ? meta.sport : undefined;
    const school = typeof meta.school === 'string' ? meta.school.trim() : '';
    const orgId = typeof meta.orgId === 'string' && meta.orgId ? meta.orgId : null;
    void s.createTeamLive(school || (sport ? `${sport} team` : 'My Team'), sport, orgId, s.teamDiscoverable);
  };
  return (
    <View style={{ marginTop: 14, alignItems: 'center', gap: 10 }}>
      <View style={{ paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12, backgroundColor: c.accentSurface }}>
        <Txt w="eb" size={24} ls={2} color={c.accent}>{code}</Txt>
      </View>
      {realCode ? (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel="Share team code" onPress={share} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 11, backgroundColor: c.accent }}>
            <Txt w="b" size={13} color={c.white}>Share team code</Txt>
          </Pressable>
          <Txt w="sb" size={12} color={c.textTertiary} style={{ textAlign: 'center' }}>Athletes enter this after they sign up.</Txt>
        </>
      ) : (
        <>
          <Row style={{ gap: 6 }}>
            <SampleTag />
            <Txt w="sb" size={12} color={c.textTertiary} style={{ flexShrink: 1 }}>Sample code, don&apos;t share it. Your real one isn&apos;t ready yet.</Txt>
          </Row>
          {isBackendLive ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Create my team code" onPress={retryCreate} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9, backgroundColor: c.accent }}>
              <Txt w="b" size={13} color={c.white}>Create my team code</Txt>
            </Pressable>
          ) : null}
          {s.authError ? (
            <Txt w="sb" size={12} color={c.alertDeep} style={{ textAlign: 'center' }}>{s.authError}</Txt>
          ) : null}
        </>
      )}
    </View>
  );
}

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
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} upper style={{ marginBottom: 3 }}>{eyebrow}</Txt> : null}
        <Txt w="eb" size={28} ls={-0.8} accessibilityRole="header">{title}</Txt>
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
  const { items, approve, decline, error } = usePendingRequests();
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
            onPress={() => { void approve(it.teamId, it.athleteId).then((ok) => (ok ? haptics.success() : haptics.tap())); }}
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
      {error ? (
        <Txt w="sb" size={12} color={c.alert} style={{ marginTop: 4 }}>
          {error}
        </Txt>
      ) : null}
    </View>
    </Reveal>
  );
}

function CoachDashboard({ teamTitle, rosterLive, brief, teamReport, attention, rosterMeta, rosterCount, reportScope }: {
  teamTitle: string; rosterLive: boolean; brief: AssistantBrief;
  teamReport: ReturnType<typeof teamWeeklyReport>; attention: ReturnType<typeof needsAttention>;
  rosterMeta: Record<string, { initials: string; pos: string; comp: number; athleteId?: string }>;
  rosterCount: number; reportScope: 'week' | 'today';
}) {
  const c = useColors();
  const s = useStore();
  const unlocked = useAssistantUnlocked();
  return (
    <Section>
      <Row style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Account & settings" hitSlop={6} onPress={s.openAccount} style={[{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.hairline }, shadow.card]}>
          <Icon name="menu" size={20} color={c.slate600} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} upper>Coach Dashboard</Txt>
          <Txt w="eb" size={22} ls={-0.5} style={{ marginTop: 2 }}>{teamTitle}</Txt>
          {rosterLive ? null : (
            <Row style={{ gap: 7, marginTop: 5 }}>
              <SampleTag />
              <Txt w="sb" size={12} color={c.textTertiary}>Demo roster, not your real team</Txt>
            </Row>
          )}
        </View>
      </Row>

      {rosterCount === 0 ? (
        // With no athletes, every KPI / trend / "everyone above the line" / "0 of 0 on
        // track" line is nonsense — so the whole dashboard collapses to ONE honest state:
        // share your code. Also re-surfaces the invite the coach may have skipped at setup.
        <Reveal index={0}>
        <Card variant="hero" style={{ marginTop: 20, borderRadius: 20, alignItems: 'center', paddingVertical: 26 }}>
          <View style={{ width: 52, height: 52, borderRadius: 15, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="squad" size={24} color={c.accent} />
          </View>
          <Txt w="eb" size={18} ls={-0.3} style={{ marginTop: 14, textAlign: 'center' }}>No athletes yet</Txt>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 19, paddingHorizontal: 12 }}>
            Share your team code and your dashboard fills in as athletes join and start logging.
          </Txt>
          <TeamCodeShare />
        </Card>
        <PendingRequestsCard />
        </Reveal>
      ) : (
        <>
      {/* The briefing leads (Assistant Nutritionist, 2026-07-04): the assistant already
          reviewed everyone, so the first thing the coach reads is a sentence, not a metric
          grid. Locked accounts (paywall flag on, no entitlement) get the honest upgrade
          card built from the REAL review; metrics demote to a quiet strip either way. */}
      <Reveal index={0}>
      {unlocked ? (
        <>
          <AssistantBriefCard brief={brief} live={rosterLive} />
          <TriageQueue
            brief={brief}
            rosterMeta={rosterMeta}
            viewAllCount={attention.length}
            onViewAll={() => s.setCoachTab('attention')}
          />
        </>
      ) : (
        <AssistantUpgradeCard brief={brief} noun="athlete" />
      )}
      <AssistantKpiStrip brief={brief} noun="athletes" />
      </Reveal>

      <PendingRequestsCard />

      <Reveal index={1}>
      <PressScale accessibilityLabel="Open the full weekly report" haptic="none" onPress={() => { haptics.tap(); s.setCoachTab('reports'); }} style={{ marginTop: 14 }}>
        <Card variant="low" style={{ borderRadius: 20 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.7}>{reportScope === 'today' ? 'TODAY' : 'THIS WEEK'}</Txt>
          <Txt w="eb" size={17} ls={-0.3} style={{ marginTop: 3 }}>{teamReport.headline}</Txt>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
            {teamReport.movedLine} {teamReport.onStandard} on standard, {teamReport.onBubble} on the bubble, {teamReport.needsIntervention} {teamReport.needsIntervention === 1 ? 'needs' : 'need'} intervention.
          </Txt>
          <Row style={{ gap: 6, marginTop: 12, alignItems: 'center' }}>
            <Txt w="b" size={13} color={c.accent}>Full report</Txt>
            <Icon name="chevronRight" size={15} color={c.accent} />
          </Row>
        </Card>
      </PressScale>
      </Reveal>
        </>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- Roster */
/**
 * Team activation (churn build): getting the whole team ON the app IS coach retention —
 * an empty dashboard churns before it ever shows value. The coach states how many
 * athletes should be here (their number, stored in obMeta.rosterTarget); this card tracks
 * the join rate + hands them the share tooling until everyone is on, then retires itself.
 */
function RosterActivation({ joined }: { joined: number }) {
  const c = useColors();
  const s = useStore();
  const targetRaw = s.obMeta.rosterTarget;
  const target = typeof targetRaw === 'number' ? targetRaw : null;
  const status = activationStatus(joined, target);
  const [draft, setDraft] = React.useState('');
  if (!status.show) return null;
  return (
    <Card variant="low" style={{ borderRadius: 18, padding: 16, marginBottom: 12 }}>
      {status.needsTarget ? (
        <>
          <Txt w="eb" size={15} ls={-0.2}>Get your whole team on</Txt>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 19 }}>
            How many athletes should be on this roster? Set it and we track who still needs to join.
          </Txt>
          <Row style={{ gap: 10, marginTop: 12 }}>
            <Input
              value={draft}
              onChangeText={setDraft}
              placeholder="e.g. 40"
              keyboardType="number-pad"
              accessibilityLabel="Expected roster size"
              style={{ flex: 1 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save roster size"
              onPress={() => {
                const n = parseRosterTarget(draft);
                if (n == null) return;
                haptics.tap();
                s.setObMeta('rosterTarget', n);
              }}
              style={({ pressed }) => [{ paddingHorizontal: 18, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 }]}
            >
              <Txt w="b" size={14} color={c.white}>Track</Txt>
            </Pressable>
          </Row>
        </>
      ) : (
        <>
          <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Txt w="eb" size={15} ls={-0.2}>{status.line}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="Change expected roster size" hitSlop={8} onPress={() => { haptics.tap(); s.setObMeta('rosterTarget', 0); }}>
              <Txt w="sb" size={12} color={c.textTertiary}>edit</Txt>
            </Pressable>
          </Row>
          <View style={{ height: 8, borderRadius: 5, backgroundColor: c.track, marginTop: 10, overflow: 'hidden' }}>
            <View style={{ width: `${status.pct}%`, height: 8, borderRadius: 5, backgroundColor: c.accent }} />
          </View>
          <Txt w="m" size={12.5} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 18 }}>
            {status.missing} still to join. Share the code at practice; most teams get everyone on in a week.
          </Txt>
          <TeamCodeShare />
        </>
      )}
    </Card>
  );
}

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
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11, backgroundColor: notLoggedOnly ? c.alert : c.alertSurface, borderWidth: 1, borderColor: notLoggedOnly ? c.alert : c.alertBorder }}>
            <Icon name="bell" size={13} color={notLoggedOnly ? c.white : c.alert} />
            <Txt w="b" size={12} color={notLoggedOnly ? c.white : c.alert}>{notLogged} not logged</Txt>
          </Pressable>
        ) : undefined
      } />
      {roster.length > 0 ? <TeamStatTiles roster={roster} /> : null}
      <RosterActivation joined={roster.length} />
      <Input value={query} onChangeText={setQuery} placeholder="Search athletes" accessibilityLabel="Search athletes by name" autoCapitalize="words" autoCorrect={false} style={{ marginBottom: 10 }} />
      {groups.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
          <GroupChip label="All" active={group === null} onPress={() => { haptics.tap(); setGroup(null); }} />
          {groups.map((g) => <GroupChip key={g} label={g} active={group === g} onPress={() => { haptics.tap(); setGroup(group === g ? null : g); }} />)}
        </ScrollView>
      ) : null}
      {filtered.length > 0 ? (
        <View style={{ gap: 9 }}>
          {filtered.map((a, i) => (
            <RosterRowCard
              key={a.name}
              rank={i + 1}
              row={a}
              onPress={() => s.openPerson({ name: a.name, initials: a.initials, pos: a.pos, score: a.score, comp: a.comp, athleteId: a.athleteId })}
            />
          ))}
        </View>
      ) : (
        <Card style={{ borderRadius: 20, padding: 20, alignItems: 'center' }}>
          <Txt w="sb" size={14} color={c.textSecondary} style={{ textAlign: 'center', lineHeight: 20 }}>
            {roster.length === 0
              ? 'No athletes yet. Share your team code so athletes can join.'
              : notLoggedOnly ? 'Everyone in this view has logged today.' : `No athletes match${group ? ` in ${group}` : ''}${query.trim() ? ` for "${query.trim()}"` : ''}.`}
          </Txt>
          {roster.length === 0 ? (
            <TeamCodeShare />
          ) : (
            <Pressable accessibilityRole="button" onPress={() => { haptics.tap(); setQuery(''); setGroup(null); setNotLoggedOnly(false); }} style={{ marginTop: 12, paddingHorizontal: 15, paddingVertical: 9, borderRadius: 11, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
              <Txt w="b" size={13} color={c.slate700}>Clear filters</Txt>
            </Pressable>
          )}
        </Card>
      )}
    </Section>
  );
}

/**
 * One roster row — the proto's `.roster-row` anatomy (flows.css): risk-ranked numeral,
 * avatar carrying the R/Y/G flag dot, a title line of "Name · POS" (name bold, unit small
 * tertiary, exactly the proto's `.t small`), then the one-line note (`.s`) under it, trend
 * arrow, and the tier-colored score chip on the right. The note line is HONEST: at-risk
 * athletes get the same deterministic at-risk sentence Needs Attention shows; everyone
 * else reads their tier name — never an invented status. (The proto's logs count `.rl`
 * is omitted: RN roster rows carry no real per-day logs fraction to show.)
 * Pure presentation — the tap still opens PersonDetail with the same payload as before.
 */
function RosterRowCard({ rank, row, onPress }: { rank: number; row: RosterRow; onPress: () => void }) {
  const c = useColors();
  const tier = tierFor(row.score);
  const chip = tierChip[tier.short];
  const tr = trendInfo(row.dir);
  const notLogged = row.loggedToday === false;
  // Proto note line ("Hydration short 3 days running"): the deterministic at-risk read
  // where a real signal exists (same threshold + sentence as Needs Attention), else the
  // tier name. Adapted honestly — no fabricated streaks or open-requirement counts.
  const note = row.score < COACH_ALERT_THRESHOLD ? atRiskReason(row) : tier.name;
  return (
    <PressScale
      accessibilityLabel={`${row.name}, ${row.pos}, ${tier.name}, score ${row.score}${notLogged ? ', not logged today' : ''}. View athlete.`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: c.card,
        borderRadius: 18,
        paddingVertical: 13,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: notLogged ? c.alertBorder : c.hairline,
      }}
    >
      {/* risk rank — the roster is risk-ranked, so #1 is who needs the coach most */}
      <Txt w="eb" num size={15} color={c.textTertiary} style={{ width: 22, textAlign: 'center' }}>{rank}</Txt>

      {/* avatar with the R/Y/G flag dot (tier-colored: green OnStandard → red Off Standard) */}
      <View>
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="b" size={14} color={c.slate600}>{row.initials}</Txt>
        </View>
        <View style={{ position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: chip.fg, borderWidth: 2.5, borderColor: c.card }} />
      </View>

      {/* proto .rn — "Name · POS" title line + one-line note under it */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row style={{ gap: 7 }}>
          <Row style={{ gap: 5, flexShrink: 1, minWidth: 0, alignItems: 'baseline' }}>
            <Txt w="eb" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>{row.name}</Txt>
            <Txt w="b" size={12} color={c.textTertiary}>· {row.pos}</Txt>
          </Row>
          {notLogged ? (
            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: c.alertSurface, borderWidth: 1, borderColor: c.alertBorder }}>
              <Txt w="eb" size={10} color={c.alert} ls={0.3}>NOT LOGGED</Txt>
            </View>
          ) : null}
        </Row>
        <Txt w="sb" size={12} color={c.textTertiary} numberOfLines={1} style={{ marginTop: 2 }}>{note}</Txt>
      </View>

      {/* trend arrow */}
      <Txt w="eb" size={15} color={tr.c} accessibilityLabel={row.dir === 'up' ? 'Trending up' : row.dir === 'down' ? 'Trending down' : 'Trend flat'}>{tr.t}</Txt>

      {/* tier-colored score chip (proto .rs, carried in the app's chip idiom) */}
      <View style={{ minWidth: 44, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 11, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center' }}>
        <Txt w="eb" num size={18} color={chip.fg}>{row.score}</Txt>
      </View>
    </PressScale>
  );
}

/* ---------------------------------------------------------------- Needs Attention */
function CoachAttention({ attention, rosterMeta, rosterCount }: { attention: ReturnType<typeof needsAttention>; rosterMeta: Record<string, { initials: string; pos: string; comp: number; athleteId?: string }>; rosterCount: number }) {
  const c = useColors();
  const s = useStore();
  // With no athletes, "Everyone is above the line" is false — there's no one. Say so honestly.
  const empty = rosterCount === 0;
  return (
    <Section>
      <SectionTitle eyebrow={empty ? 'No athletes yet' : attention.length > 0 ? `${attention.length} need a look` : 'All clear'} title="Needs Attention" />
      <Reveal index={0}>
      {empty ? (
        <Card style={{ borderRadius: 20, padding: 22, alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="squad" size={22} color={c.accent} />
          </View>
          <Txt w="eb" size={16} color={c.slate700} style={{ textAlign: 'center' }}>No athletes to watch yet</Txt>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 19 }}>Share your team code — once athletes join, anyone slipping shows up here.</Txt>
          <TeamCodeShare />
        </Card>
      ) : attention.length > 0 ? (
        // Proto "Needs attention" treatment (screens.css .notif.critical): each athlete is
        // their OWN card with a tone-colored bell tile — not one merged red panel.
        <View style={{ gap: 10 }}>
          {attention.map((a) => {
            const m = rosterMeta[a.name] ?? { initials: a.name.slice(0, 2).toUpperCase(), pos: '', comp: a.comp };
            return (
              <AttentionRow
                key={a.name} name={a.name} pos={m.pos} meta={a.reason} score={a.score}
                critical={a.tone === 'alert'} color={a.tone === 'alert' ? c.alert : c.warning} nudged={s.nudged.includes(a.name)}
                onNudge={() => { haptics.success(); s.sendNudge(a.name, { score: a.score, comp: a.comp }, nudgeMessageFor(a), a.athleteId); }}
                onPress={() => s.openPerson({ name: a.name, initials: m.initials, pos: m.pos, score: a.score, comp: m.comp, athleteId: m.athleteId })}
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
function CoachReports({ teamTitle, teamReport, groupStats, compliance, onShare, onExportCsv, roster, reportScope }: {
  teamTitle: string; teamReport: ReturnType<typeof teamWeeklyReport>; groupStats: RosterGroupStat[]; compliance: number; onShare: () => void; onExportCsv: () => void; roster: AtRiskInput[]; reportScope: 'week' | 'today';
}) {
  const c = useColors();
  const unlocked = useAssistantUnlocked();
  return (
    <Section>
      <SectionTitle eyebrow={teamTitle} title="Reports" />

      <Reveal index={0}>
      <Card variant="hero" style={{ borderRadius: 20 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={11} color={c.textTertiary} ls={0.7}>{reportScope === 'today' ? "TODAY'S REPORT" : 'WEEKLY REPORT'}</Txt>
            <Txt w="eb" size={18} ls={-0.3} style={{ marginTop: 3 }}>{teamReport.headline}</Txt>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={reportScope === 'today' ? "Share today's team report" : 'Share team weekly report'} hitSlop={6} onPress={onShare}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: c.accentSurface, opacity: pressed ? 0.8 : 1 })}>
            <Icon name="send" size={14} color={c.accent} />
            <Txt w="b" size={12} color={c.accent}>Share</Txt>
          </Pressable>
        </Row>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
          {teamReport.movedLine} {teamReport.onStandard} on standard, {teamReport.onBubble} on the bubble, {teamReport.needsIntervention} {teamReport.needsIntervention === 1 ? 'needs' : 'need'} intervention.
        </Txt>
        <Row style={{ gap: 10, marginTop: 14 }}>
          <ReportStat label="BEST MOVER" name={teamReport.mostImproved?.name ?? 'None yet'} score={teamReport.mostImproved?.score} color={c.successDeep} />
          <ReportStat label="MOST AT RISK" name={teamReport.mostAtRisk?.name ?? 'None'} score={teamReport.mostAtRisk?.score} color={c.alert} />
        </Row>
        {/* Reporting add-on: spreadsheet-ready roster (name, score, grade, compliance) for
            the AD / parent meeting. Same rows as the dashboard, risk-ranked. Part of the
            Assistant Nutritionist bundle once the paywall flag is on. */}
        {unlocked ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export the roster as a spreadsheet (CSV)"
            onPress={() => { haptics.tap(); onExportCsv(); }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, borderRadius: 12, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, marginTop: 12, opacity: pressed ? 0.8 : 1 })}
          >
            <Icon name="copy" size={15} color={c.slate700} />
            <Txt w="b" size={13} color={c.slate700}>Export roster CSV</Txt>
          </Pressable>
        ) : (
          <AssistantLockedRow label="Report exports" />
        )}
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
          <Txt w="eb" num size={34} ls={-1} color={roster.length === 0 ? c.textTertiary : kpiTone(c, 'compliance', compliance)}>{compliance}%</Txt>
          <Txt w="b" size={12} color={c.textTertiary}>{reportScope === 'today' ? 'of the plan, team-wide today' : 'of the plan, team-wide this week'}</Txt>
        </Row>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>{teamReport.movedLine}</Txt>
      </Card>
      </Reveal>

      <Reveal index={3}>
      <View style={{ marginTop: 14 }}>
        {unlocked ? <CoachCopilot roster={roster} /> : <AssistantLockedRow label="Ask-AI about your roster" />}
      </View>
      </Reveal>
    </Section>
  );
}

/** The quiet locked row for individual assistant surfaces (Ask-AI, exports): names what
 *  is locked and routes to Plans. Honest, never a dead button. */
function AssistantLockedRow({ label }: { label: string }) {
  const c = useColors();
  const s = useStore();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} is part of the Assistant Nutritionist. See plans.`}
      onPress={() => { haptics.tap(); s.openPlans(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, padding: 13, marginTop: 12, opacity: pressed ? 0.8 : 1 })}
    >
      <Icon name="sparkle" size={15} color={c.accent} />
      <Txt w="sb" size={13} color={c.slate700} style={{ flex: 1 }}>
        {label} comes with the Assistant Nutritionist.
      </Txt>
      <Txt w="b" size={12.5} color={c.accent}>Unlock</Txt>
    </Pressable>
  );
}

function GroupStatRow({ stat }: { stat: RosterGroupStat }) {
  const c = useColors();
  const t = tierFor(stat.avgScore);
  const chip = tierChip[t.short];
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <Row style={{ gap: 9, flex: 1, minWidth: 0 }}>
        {/* tier dot — the same status-color idiom as the roster + leaderboard status flags */}
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: chip.fg }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt w="b" size={14} color={c.slate700}>{stat.group}</Txt>
          <Txt w="m" size={12} color={c.textTertiary}>{stat.count} {stat.count === 1 ? 'athlete' : 'athletes'} · {stat.avgCompliance}% compliant</Txt>
        </View>
      </Row>
      <View style={{ minWidth: 44, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 11, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center' }}>
        <Txt w="eb" num size={17} color={chip.fg}>{stat.avgScore}</Txt>
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
      style={{ flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: c.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: c.hairline }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={c.slate600} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="b" size={15}>{label}</Txt>
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>{sub}</Txt>
      </View>
      <Icon name="chevronRight" size={18} color={c.slate300} />
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
    <Pressable accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: active }} onPress={onPress} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 44 }}>
      <Icon name={item.icon} size={22} color={color} />
      <Txt w={active ? 'b' : 'sb'} size={10.5} color={color} maxFontSizeMultiplier={MAX_FONT_SCALE}>{item.label}</Txt>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- small shared bits */
// (The old Kpi tile grid is gone: the Assistant Nutritionist brief leads the dashboard and
// metrics demoted to AssistantKpiStrip — a briefing, not a control panel.)

/**
 * Proto `coach-stats` (flows.css): the three centered team tiles — Team avg / On standard /
 * Need attention. On-standard is green, need-attention red only when someone actually does
 * (0 in red would read as an alarm about nothing). Same rows the list renders — all real.
 */
function TeamStatTiles({ roster }: { roster: RosterRow[] }) {
  const c = useColors();
  const kpis = coachRosterKpis(roster);
  const onStd = roster.length - kpis.alerts;
  return (
    <Row
      accessibilityRole="text"
      accessibilityLabel={`Team average ${kpis.avgScore}. ${onStd} on standard. ${kpis.alerts} need attention.`}
      style={{ gap: 11, marginBottom: 12 }}
    >
      <TeamStat value={String(kpis.avgScore)} label="TEAM AVG" />
      <TeamStat value={String(onStd)} label="ON STANDARD" color={c.success} />
      <TeamStat value={String(kpis.alerts)} label="NEED ATTENTION" color={kpis.alerts > 0 ? c.alert : undefined} />
    </Row>
  );
}

function TeamStat({ value, label, color }: { value: string; label: string; color?: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 15, paddingHorizontal: 6, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline }}>
      <Txt w="eb" num size={24} ls={-0.7} color={color}>{value}</Txt>
      <Txt w="b" size={10.5} color={c.textTertiary} ls={0.5} upper style={{ marginTop: 3 }}>{label}</Txt>
    </View>
  );
}

function ReportStat({ label, name, score, color }: { label: string; name: string; score?: number; color: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface2, borderRadius: 14, padding: 13, borderWidth: 1, borderColor: c.hairline }}>
      <Txt w="eb" size={10} color={c.textTertiary} ls={0.6} upper>{label}</Txt>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
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
      style={[{ paddingHorizontal: 15, paddingVertical: 9, borderRadius: 12, backgroundColor: active ? c.accent : c.card, borderWidth: 1, borderColor: active ? c.accent : c.hairline }, active ? shadow.cta : null]}>
      <Txt w="b" size={13} color={active ? c.white : c.slate700}>{label}</Txt>
    </Pressable>
  );
}

/**
 * One needs-attention card — the proto's `.notif.critical` anatomy: a 42px tone-colored
 * bell tile (`.nic`), "Name · POS" title (`.nt`), the honest at-risk sentence (`.nb`), and
 * the score at the right edge, tone-colored. Critical rows carry the red border the proto
 * gives `.notif.critical`; borderline warnings sit in the plain hairline frame. The nudge
 * stays a SIBLING pressable (not nested), so this remains valid on web too.
 */
function AttentionRow({ name, pos, meta, score, critical, color, nudged, onNudge, onPress }: { name: string; pos: string; meta: string; score: number; critical: boolean; color: string; nudged: boolean; onNudge: () => void; onPress: () => void }) {
  const c = useColors();
  const tier = tierFor(score);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: critical ? c.alertBorder : c.hairline, paddingVertical: 15, paddingHorizontal: 15 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}, ${tier.name}, score ${score}. ${meta}. View athlete.`} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, flex: 1, minWidth: 0 }}>
        {/* proto .nic — tone-colored bell tile (red surface for critical, warn tint for borderline) */}
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: critical ? c.alertSurface : c.warnTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bell" size={19} color={color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Row style={{ gap: 5, alignItems: 'baseline' }}>
            <Txt w="eb" size={14.5} numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Txt>
            {pos ? <Txt w="b" size={12} color={c.textTertiary}>· {pos}</Txt> : null}
          </Row>
          <Txt w="sb" size={12.5} color={c.textSecondary} numberOfLines={2} style={{ marginTop: 3, lineHeight: 17 }}>{meta}</Txt>
        </View>
        {/* score, tone-colored (proto .nw slot) */}
        <Txt w="eb" num size={17} color={color}>{score}</Txt>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={nudged ? `Nudge sent to ${name}` : `Send a nudge to ${name}`} accessibilityState={{ disabled: nudged }} disabled={nudged} hitSlop={8} onPress={onNudge}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: nudged ? c.successSurface : c.accent, opacity: pressed ? 0.85 : 1 })}>
        {nudged ? <Icon name="check" size={12} color={c.successDeep} /> : null}
        <Txt w="b" size={12} color={nudged ? c.successDeep : c.white}>{nudged ? 'Nudged' : 'Nudge'}</Txt>
      </Pressable>
    </View>
  );
}
