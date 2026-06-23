// AthleteOS — Coach mobile view: KPIs, needs-attention, check-in question
// toggles, roster (→ athlete detail), AI team summary.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHECKIN_QUESTIONS, ROSTER, gradeFor, trendInfo } from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, Toggle, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Account } from '@/screens/overlays/Account';
import { Messages } from '@/screens/overlays/Messages';
import { PersonDetail } from '@/screens/overlays/PersonDetail';

export function CoachView() {
  const s = useStore();
  const d = useDerived();
  const roster = ROSTER.map((r) => (r.you ? { ...r, score: d.athleteScore } : r));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <Row style={{ gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Account & settings" onPress={s.openAccount} style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
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
            <Kpi value="84" label="TEAM AVG" />
            <Kpi value="88%" label="COMPLIANCE" color={colors.success} />
            <Kpi value="2" label="ALERTS" color={colors.alert} />
          </Row>

          <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: colors.alertSurface, borderWidth: 1, borderColor: colors.alertBorder }}>
            <Txt w="eb" size={11} color={colors.alert} ls={0.7} style={{ marginBottom: 13 }}>
              NEEDS ATTENTION
            </Txt>
            <AttentionRow initials="AS" name="A. Silva" meta="Missed 3 meals · recovery dropping" score={79} color={colors.warning} onPress={() => s.openPerson({ name: 'Andre Silva', initials: 'AS', pos: 'Linebacker', score: 79 })} />
            <AttentionRow initials="MC" name="M. Cole" meta="No check-in · 58% compliance" score={68} color={colors.alert} onPress={() => s.openPerson({ name: 'Marcus Cole', initials: 'MC', pos: 'Linebacker', score: 68 })} last />
          </View>

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
            ROSTER · 6 ATHLETES
          </Txt>
          <View style={{ gap: 8 }}>
            {roster.map((a) => {
              const g = gradeFor(a.score);
              const tr = trendInfo(a.dir);
              return (
                <Pressable
                  key={a.name}
                  onPress={() => s.openPerson({ name: a.name, initials: a.initials, pos: 'Linebacker', score: a.score })}
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
              The room is trending up — 4 of 6 logged every meal this week. Silva and Cole are pulling the average down; both show recovery and check-in gaps, not nutrition. Recommend a 1-on-1 before Friday.
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

function AttentionRow({ initials, name, meta, score, color, onPress, last }: { initials: string; name: string; meta: string; score: number; color: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: last ? 0 : 13 }}>
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
      <Txt w="eb" size={19} color={color}>
        {score}
      </Txt>
    </Pressable>
  );
}
