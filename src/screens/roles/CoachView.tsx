// AthleteOS — Coach mobile view: KPIs, needs-attention, check-in question
// toggles, roster (→ athlete detail), AI team summary.
import React from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHECKIN_QUESTIONS, ROSTER, coachRosterKpis, coachTeamTitle, filterRoster, gradeFor, needsAttention, notLoggedCount, rankByRisk, rosterGroups, teamWeeklyReport, teamWeeklyReportText, trendInfo } from '@/core';
import { useStore, useDerived } from '@/store';
import { aiTeamSummaryTag } from '@/lib/ai';
import { colors, shadow } from '@/ui/tokens';
import { Card, Input, Row, SampleTag, Toggle, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Account } from '@/screens/overlays/Account';
import { Messages } from '@/screens/overlays/Messages';
import { PersonDetail } from '@/screens/overlays/PersonDetail';
import { useLiveRoster } from './useLiveRoster';

export function CoachView() {
  const s = useStore();
  const d = useDerived();
  // Stage D: real roster from fetchLinkedDays when isBackendLive, else the seeded
  // showcase (identical when the flag is off). `live` drops the Sample tag once real.
  const { roster: rosterSource, live: rosterLive } = useLiveRoster(ROSTER);
  const roster = rosterSource.map((r) => (r.you ? { ...r, score: d.athleteScore } : r));
  const kpis = coachRosterKpis(roster);
  const onTrack = roster.length - kpis.alerts;
  // Needs-Attention derives from the SAME live roster (most-at-risk first, with a
  // derived reason), so the list length matches the ALERTS KPI and the live
  // athlete shows up here the moment their own score drops below the line.
  const attention = needsAttention(roster);
  // The header title: the seeded demo keeps "Linebackers · Varsity"; a real coach
  // gets their own onboarding context (school, else sport) so they never see
  // another team's name.
  const teamTitle = coachTeamTitle({ isReal: s.athleteName.trim().length > 0, sport: s.obMeta.sport, school: s.obMeta.school });
  // Team weekly digest (week-over-week standing, best mover, most at risk) — the
  // glanceable program-health read coaches asked for. Shareable as plain text for an AD.
  const teamReport = teamWeeklyReport(roster);
  const shareTeamReport = async () => {
    try { await Share.share({ message: teamWeeklyReportText(teamReport, teamTitle) }); }
    catch { /* user cancelled the share sheet */ }
  };
  const rosterMeta: Record<string, { initials: string; pos: string; comp: number; athleteId?: string }> = Object.fromEntries(
    roster.map((r) => [r.name, { initials: r.initials, pos: r.pos, comp: r.comp, athleteId: r.athleteId }]),
  );
  // Roster-at-scale controls: a real coach with 40+ across position groups needs to
  // segment, search, and see who hasn't logged today, not scroll one long list.
  const groups = rosterGroups(roster);
  const notLogged = notLoggedCount(roster);
  const [query, setQuery] = React.useState('');
  const [group, setGroup] = React.useState<string | null>(null);
  const [notLoggedOnly, setNotLoggedOnly] = React.useState(false);
  const filtered = rankByRisk(filterRoster(roster, { group, query, notLoggedOnly }));
  const filtering = group !== null || query.trim().length > 0 || notLoggedOnly;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <Row style={{ gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Account & settings" hitSlop={6} onPress={s.openAccount} style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
              <Icon name="menu" size={20} color={colors.slate600} />
            </Pressable>
            <View>
              <Txt w="sb" size={13} color={colors.textSecondary}>
                Coach Dashboard
              </Txt>
              <Txt w="eb" size={21} ls={-0.3}>
                {teamTitle}
              </Txt>
              {rosterLive ? null : (
                <Row style={{ gap: 7, marginTop: 5 }}>
                  <SampleTag />
                  <Txt w="sb" size={12} color={colors.textTertiary}>
                    Demo roster, not your real team
                  </Txt>
                </Row>
              )}
            </View>
          </Row>

          <Row style={{ gap: 10, marginTop: 20 }}>
            <Kpi value={`${kpis.avgScore}`} label="TEAM AVG" />
            <Kpi value={`${kpis.compliance}%`} label="COMPLIANCE" color={colors.success} />
            <Kpi value={`${kpis.alerts}`} label="ALERTS" color={colors.alert} />
          </Row>

          <Card elevated style={{ marginTop: 14, borderRadius: 20 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Txt w="eb" size={11} color={colors.textTertiary} ls={0.7}>
                  THIS WEEK
                </Txt>
                <Txt w="eb" size={18} ls={-0.3} style={{ marginTop: 3 }}>
                  {teamReport.headline}
                </Txt>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share team weekly report"
                hitSlop={6}
                onPress={shareTeamReport}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.accentSurface, opacity: pressed ? 0.8 : 1 })}
              >
                <Icon name="send" size={14} color={colors.accent} />
                <Txt w="b" size={12} color={colors.accent}>
                  Share
                </Txt>
              </Pressable>
            </Row>
            <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
              {teamReport.movedLine} {teamReport.onStandard} on standard, {teamReport.onBubble} on the bubble, {teamReport.needsIntervention} need intervention.
            </Txt>
            <Row style={{ gap: 10, marginTop: 14 }}>
              <ReportStat
                label="BEST MOVER"
                name={teamReport.mostImproved?.name ?? 'None yet'}
                score={teamReport.mostImproved?.score}
                color={colors.successDeep}
              />
              <ReportStat
                label="MOST AT RISK"
                name={teamReport.mostAtRisk?.name ?? 'None'}
                score={teamReport.mostAtRisk?.score}
                color={colors.alert}
              />
            </Row>
          </Card>

          {attention.length > 0 ? (
            <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: colors.alertSurface, borderWidth: 1, borderColor: colors.alertBorder }}>
              <Txt w="eb" size={11} color={colors.alert} ls={0.7} style={{ marginBottom: 13 }}>
                NEEDS ATTENTION
              </Txt>
              {attention.map((a, i) => {
                const m = rosterMeta[a.name] ?? { initials: a.name.slice(0, 2).toUpperCase(), pos: '', comp: a.comp };
                return (
                  <AttentionRow
                    key={a.name}
                    initials={m.initials}
                    name={a.name}
                    meta={a.reason}
                    score={a.score}
                    color={a.tone === 'alert' ? colors.alert : colors.warning}
                    nudged={s.nudged.includes(a.name)}
                    onNudge={() => { haptics.success(); s.sendNudge(a.name, { score: a.score, comp: a.comp }); }}
                    onPress={() => s.openPerson({ name: a.name, initials: m.initials, pos: m.pos, score: a.score, comp: m.comp, athleteId: m.athleteId })}
                    last={i === attention.length - 1}
                  />
                );
              })}
            </View>
          ) : (
            <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: colors.successSurface }}>
              <Txt w="eb" size={11} color={colors.successDeep} ls={0.7} style={{ marginBottom: 6 }}>
                NEEDS ATTENTION
              </Txt>
              <Txt w="sb" size={14} color={colors.slate700} style={{ lineHeight: 20 }}>
                Everyone is above the line today. No one needs a nudge right now.
              </Txt>
            </View>
          )}

          <Card elevated style={{ marginTop: 18, borderRadius: 20 }}>
            <Txt w="eb" size={15} ls={-0.3}>
              Weekly check-in questions
            </Txt>
            <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 4, marginBottom: 14, lineHeight: 19 }}>
              Athletes only answer what you turn on. Changes apply to next week's check-in.
            </Txt>
            <View style={{ gap: 13 }}>
              {CHECKIN_QUESTIONS.map((q) => (
                <Row key={q.key} style={{ justifyContent: 'space-between' }}>
                  <Txt w="b" size={14}>
                    {q.label}
                  </Txt>
                  <Toggle on={s.ciConfig[q.key]} onPress={() => s.toggleCiQ(q.key)} label={q.label} />
                </Row>
              ))}
            </View>
          </Card>

          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 22, marginBottom: 12 }}>
            <Txt w="eb" size={12} color={colors.textTertiary} ls={0.7}>
              ROSTER · {filtering ? `${filtered.length} OF ${roster.length}` : `${roster.length} ATHLETES`}
            </Txt>
            {notLogged > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Filter to the ${notLogged} athletes who have not logged today`}
                accessibilityState={{ selected: notLoggedOnly }}
                onPress={() => { haptics.tap(); setNotLoggedOnly((v) => !v); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, backgroundColor: notLoggedOnly ? colors.alert : colors.alertSurface }}
              >
                <Icon name="bell" size={13} color={notLoggedOnly ? '#fff' : colors.alert} />
                <Txt w="b" size={12} color={notLoggedOnly ? '#fff' : colors.alert}>
                  {notLogged} not logged today
                </Txt>
              </Pressable>
            ) : null}
          </Row>

          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search athletes"
            accessibilityLabel="Search athletes by name"
            autoCapitalize="words"
            autoCorrect={false}
            style={{ marginBottom: 10 }}
          />

          {groups.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
              <GroupChip label="All" active={group === null} onPress={() => { haptics.tap(); setGroup(null); }} />
              {groups.map((g) => (
                <GroupChip key={g} label={g} active={group === g} onPress={() => { haptics.tap(); setGroup(group === g ? null : g); }} />
              ))}
            </ScrollView>
          ) : null}

          {filtered.length > 0 ? (
            <View style={{ gap: 8 }}>
              {filtered.map((a) => {
                const g = gradeFor(a.score);
                const tr = trendInfo(a.dir);
                return (
                  <Pressable
                    key={a.name}
                    onPress={() => s.openPerson({ name: a.name, initials: a.initials, pos: a.pos, score: a.score, comp: a.comp, athleteId: a.athleteId })}
                    style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 14 }, shadow.card]}
                  >
                    <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt w="b" size={13} color={colors.slate600}>
                        {a.initials}
                      </Txt>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Row style={{ gap: 6 }}>
                        <Txt w="b" size={14}>
                          {a.name}
                        </Txt>
                        {a.loggedToday === false ? (
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, backgroundColor: colors.alertSurface }}>
                            <Txt w="b" size={10} color={colors.alert}>
                              Not logged
                            </Txt>
                          </View>
                        ) : null}
                      </Row>
                      <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 2 }}>
                        {a.pos} · {a.comp}% compliant
                      </Txt>
                    </View>
                    <Txt w="eb" size={16} color={tr.c}>
                      {tr.t}
                    </Txt>
                    <Txt w="eb" size={20} style={{ width: 32, textAlign: 'right' }}>
                      {a.score}
                    </Txt>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: g.bg }}>
                      <Txt w="eb" size={12} color={g.c}>
                        {g.g}
                      </Txt>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Card style={{ borderRadius: 16, padding: 18, alignItems: 'center' }}>
              <Txt w="sb" size={14} color={colors.textSecondary} style={{ textAlign: 'center', lineHeight: 20 }}>
                {notLoggedOnly
                  ? 'Everyone in this view has logged today.'
                  : `No athletes match${group ? ` in ${group}` : ''}${query.trim() ? ` for "${query.trim()}"` : ''}.`}
              </Txt>
              <Pressable accessibilityRole="button" onPress={() => { haptics.tap(); setQuery(''); setGroup(null); setNotLoggedOnly(false); }} style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, backgroundColor: colors.bg2 }}>
                <Txt w="b" size={13} color={colors.slate700}>
                  Clear filters
                </Txt>
              </Pressable>
            </Card>
          )}

          <Card elevated style={{ marginTop: 18, borderRadius: 20 }}>
            <Row style={{ gap: 9, marginBottom: 12 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="sparkle" size={17} color={colors.accent} />
              </View>
              <Txt w="eb" size={12} color={colors.accent} ls={0.4}>
                {aiTeamSummaryTag}
              </Txt>
              <SampleTag />
            </Row>
            <Txt w="m" size={14} color={colors.slate700} style={{ lineHeight: 22 }}>
              The room is trending up: {onTrack} of {roster.length} athletes are on track this week.{' '}
              {kpis.alerts === 0
                ? 'No one is below the alert line right now, so keep the cadence going.'
                : `${kpis.alerts} ${kpis.alerts === 1 ? 'athlete is' : 'athletes are'} pulling the average down. A quick check-in with them could help before it slips further.`}
            </Txt>
          </Card>
        </ScrollView>
      </SafeAreaView>

      {s.personDetail && <PersonDetail />}
      {s.msgOpen && <Messages />}
      {s.accountOpen && <Account />}
    </View>
  );
}

function Kpi({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <Card style={{ flex: 1, borderRadius: 18, padding: 16 }}>
      <Txt w="eb" size={28} color={color}>
        {value}
      </Txt>
      <Txt w="b" size={11} color={colors.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
    </Card>
  );
}

function ReportStat({ label, name, score, color }: { label: string; name: string; score?: number; color: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 14, padding: 13 }}>
      <Txt w="eb" size={10} color={colors.textTertiary} ls={0.5}>
        {label}
      </Txt>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', marginTop: 5 }}>
        <Txt w="b" size={14} color={colors.slate700} style={{ flex: 1 }} numberOfLines={1}>
          {name}
        </Txt>
        {typeof score === 'number' ? (
          <Txt w="eb" size={16} color={color} style={{ marginLeft: 8 }}>
            {score}
          </Txt>
        ) : null}
      </Row>
    </View>
  );
}

function GroupChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${label}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: active ? colors.accent : '#fff', borderWidth: 1, borderColor: active ? colors.accent : colors.border }}
    >
      <Txt w="b" size={13} color={active ? '#fff' : colors.slate600}>
        {label}
      </Txt>
    </Pressable>
  );
}

function AttentionRow({ initials, name, meta, score, color, nudged, onNudge, onPress, last }: { initials: string; name: string; meta: string; score: number; color: string; nudged: boolean; onNudge: () => void; onPress: () => void; last?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${name}, score ${score}. ${meta}. View athlete.`} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: last ? 0 : 13 }}>
      <Row style={{ gap: 11, flex: 1 }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="b" size={13} color={colors.slate600}>
            {initials}
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={14}>
            {name}
          </Txt>
          <Txt w="m" size={12} color={colors.textTertiary}>
            {meta}
          </Txt>
        </View>
      </Row>
      <Txt w="eb" size={19} color={color} style={{ marginRight: 12 }}>
        {score}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={nudged ? `Nudge sent to ${name}` : `Send a nudge to ${name}`}
        accessibilityState={{ disabled: nudged }}
        disabled={nudged}
        hitSlop={8}
        onPress={onNudge}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, backgroundColor: nudged ? colors.successSurface : colors.accent, opacity: pressed ? 0.85 : 1 })}
      >
        {nudged ? <Icon name="check" size={12} color={colors.successDeep} /> : null}
        <Txt w="b" size={12} color={nudged ? colors.successDeep : '#fff'}>
          {nudged ? 'Nudged' : 'Nudge'}
        </Txt>
      </Pressable>
    </Pressable>
  );
}
