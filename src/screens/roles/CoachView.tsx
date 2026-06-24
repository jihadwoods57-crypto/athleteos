// AthleteOS — Coach mobile view: KPIs, needs-attention, check-in question
// toggles, roster (→ athlete detail), AI team summary.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHECKIN_QUESTIONS, ROSTER, coachRosterKpis, gradeFor, needsAttention, rankByRisk, trendInfo } from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, Toggle, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Account } from '@/screens/overlays/Account';
import { Messages } from '@/screens/overlays/Messages';
import { PersonDetail } from '@/screens/overlays/PersonDetail';

export function CoachView() {
  const s = useStore();
  const d = useDerived();
  const roster = ROSTER.map((r) => (r.you ? { ...r, score: d.athleteScore } : r));
  const kpis = coachRosterKpis(roster);
  const onTrack = roster.length - kpis.alerts;
  // Needs-Attention derives from the SAME live roster (most-at-risk first, with a
  // derived reason), so the list length matches the ALERTS KPI and the live
  // athlete shows up here the moment their own score drops below the line.
  const attention = needsAttention(roster);
  const rosterMeta: Record<string, { initials: string; pos: string; comp: number }> = Object.fromEntries(
    roster.map((r) => [r.name, { initials: r.initials, pos: r.pos, comp: r.comp }]),
  );

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
                Linebackers · Varsity
              </Txt>
            </View>
          </Row>

          <Row style={{ gap: 10, marginTop: 20 }}>
            <Kpi value={`${kpis.avgScore}`} label="TEAM AVG" />
            <Kpi value={`${kpis.compliance}%`} label="COMPLIANCE" color={colors.success} />
            <Kpi value={`${kpis.alerts}`} label="ALERTS" color={colors.alert} />
          </Row>

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
                    onNudge={() => { haptics.success(); s.sendNudge(a.name); }}
                    onPress={() => s.openPerson({ name: a.name, initials: m.initials, pos: m.pos, score: a.score, comp: m.comp })}
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

          <Txt w="eb" size={12} color={colors.textTertiary} ls={0.7} style={{ marginTop: 22, marginBottom: 12 }}>
            ROSTER · {roster.length} ATHLETES
          </Txt>
          <View style={{ gap: 8 }}>
            {rankByRisk(roster).map((a) => {
              const g = gradeFor(a.score);
              const tr = trendInfo(a.dir);
              return (
                <Pressable
                  key={a.name}
                  onPress={() => s.openPerson({ name: a.name, initials: a.initials, pos: a.pos, score: a.score, comp: a.comp })}
                  style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 14 }, shadow.card]}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
                    <Txt w="b" size={13} color={colors.slate600}>
                      {a.initials}
                    </Txt>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt w="b" size={14}>
                      {a.name}
                    </Txt>
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

          <Card elevated style={{ marginTop: 18, borderRadius: 20 }}>
            <Row style={{ gap: 9, marginBottom: 12 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="sparkle" size={17} color={colors.accent} />
              </View>
              <Txt w="eb" size={12} color={colors.accent} ls={0.4}>
                AI TEAM SUMMARY
              </Txt>
            </Row>
            <Txt w="m" size={14} color={colors.slate700} style={{ lineHeight: 22 }}>
              The room is trending up: {onTrack} of {roster.length} athletes are on track this week.{' '}
              {kpis.alerts === 0
                ? 'No one is below the alert line right now, so keep the cadence going.'
                : `${kpis.alerts} ${kpis.alerts === 1 ? 'athlete is' : 'athletes are'} pulling the average down with recovery and check-in gaps, not nutrition. Recommend a 1-on-1 before Friday.`}
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
