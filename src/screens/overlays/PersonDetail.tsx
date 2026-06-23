// AthleteOS — Athlete/Client detail overlay (from coach/trainer roster rows).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { displayWeightDelta, gradeFor, personBreakdown, weightUnit } from '@/core';
import { useStore } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Card, ProgressBar, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Ring } from '@/ui/Ring';
import { Overlay } from './Overlay';

export function PersonDetail() {
  const s = useStore();
  const pd = s.personDetail;
  if (!pd) return null;
  const grade = gradeFor(pd.score);
  const bd = personBreakdown(pd.score);
  const units = s.units ?? 'imperial';

  return (
    <Overlay title="Athlete Profile" onClose={s.closePerson}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Card elevated style={{ borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <Ring size={96} pct={pd.score} stroke={17} gradient={['#22C55E', '#16A34A']} track="#EFF2F6">
            <Txt w="eb" size={30} ls={-0.5}>
              {pd.score}
            </Txt>
            <Txt w="eb" size={9} color={grade.c}>
              GRADE {grade.g}
            </Txt>
          </Ring>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="eb" size={20} ls={-0.3}>
              {pd.name}
            </Txt>
            <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 2 }}>
              {pd.pos} · {pd.org ?? 'Eastside HS'}
            </Txt>
            <View style={{ marginTop: 9, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.accentSurface }}>
              <Txt w="b" size={12} color={colors.accent}>
                Last active · Today
              </Txt>
            </View>
          </View>
        </Card>

        <Row style={{ gap: 10, marginTop: 14 }}>
          <StatTile value={`${pd.comp ?? pd.score}%`} label="COMPLIANCE" color={colors.success} />
          <StatTile value="12" label="DAY STREAK" />
          <StatTile value={`+${displayWeightDelta(7, units)}${weightUnit(units)}`} label="WEIGHT Δ" />
        </Row>

        <Card style={{ marginTop: 14, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 16 }}>
            Score Breakdown
          </Txt>
          <View style={{ gap: 12 }}>
            <BreakdownRow label="Nutrition" pct={bd.nutrition} />
            <BreakdownRow label="Recovery" pct={bd.recovery} accent />
            <BreakdownRow label="Tasks" pct={bd.tasks} />
            <BreakdownRow label="Check-in" pct={bd.checkin} />
          </View>
        </Card>

        <Card style={{ marginTop: 14, borderRadius: 20 }}>
          <Row style={{ gap: 9, marginBottom: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={17} color={colors.accent} />
            </View>
            <Txt w="eb" size={12} color={colors.accent} ls={0.4}>
              AI SUMMARY
            </Txt>
          </Row>
          <Txt w="m" size={14} color={colors.slate700} style={{ lineHeight: 22 }}>
            {pd.score >= 85
              ? `${pd.name} is one of your most consistent — nutrition is locked in and the streak is alive. Watch recovery; a small sleep gain would push this to an A+.`
              : pd.score >= 75
              ? `${pd.name} is holding steady — nutrition and tasks are solid. Recovery is the gap; a sleep nudge would move the grade.`
              : `${pd.name} needs attention — recovery and check-in are slipping and it's dragging the score down. A 1-on-1 this week would help reset the routine.`}
          </Txt>
        </Card>

        <Row style={{ gap: 10, marginTop: 18 }}>
          <Pressable onPress={s.openMsg} style={[{ flex: 1, height: 54, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, shadow.cta]}>
            <Txt w="b" size={15} color="#fff">
              Message
            </Txt>
          </Pressable>
          <View style={[{ flex: 1, height: 54, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
            <Txt w="b" size={15} color={colors.slate700}>
              Adjust goals
            </Txt>
          </View>
        </Row>
      </ScrollView>
    </Overlay>
  );
}

function StatTile({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={[{ flex: 1, backgroundColor: '#fff', borderRadius: 18, padding: 16 }, shadow.card]}>
      <Txt w="eb" size={24} color={color}>
        {value}
      </Txt>
      <Txt w="b" size={11} color={colors.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
    </View>
  );
}

function BreakdownRow({ label, pct, accent }: { label: string; pct: number; accent?: boolean }) {
  return (
    <Row style={{ gap: 11 }}>
      <Txt w="sb" size={13} style={{ width: 78 }}>
        {label}
      </Txt>
      <View style={{ flex: 1 }}>
        <ProgressBar pct={pct} height={8} color={accent ? colors.accent : colors.success} />
      </View>
      <Txt w="eb" size={13} style={{ width: 26, textAlign: 'right' }}>
        {pct}
      </Txt>
    </Row>
  );
}
