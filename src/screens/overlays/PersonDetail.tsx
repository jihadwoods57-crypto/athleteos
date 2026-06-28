// AthleteOS — Athlete/Client detail overlay (from coach/trainer roster rows).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { displayWeightDelta, findNudge, gradeFor, nudgeOutcome, nudgeTrail, personBreakdown, rosterNoun, scoreLanguage, weightUnit } from '@/core';
import { useStore } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { aiPrefix } from '@/lib/ai';
import { colors, shadow } from '@/ui/tokens';
import { Card, Input, ProgressBar, Row, SampleTag, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
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
  const nudged = s.nudged.includes(pd.name);
  // Once nudged, the honest "did anything move since" read: compares the
  // athlete's live compliance against the baseline captured at send-time. For
  // the static demo this reads "no change yet, follow up" rather than faking a
  // response; it lights up the instant real compliance data moves.
  const nudgeRec = findNudge(s.nudgeLog, pd.name);
  const outcome = nudgeRec ? nudgeOutcome(nudgeRec, pd.comp ?? pd.score) : null;
  // Optional note the coach attaches to the nudge — the documentation trail (and
  // the message that rides to the athlete once the backend is live).
  const [note, setNote] = React.useState('');
  // Title in the opener's own noun: a trainer/nutritionist sees "Client
  // Profile", a coach sees "Athlete Profile" (the overlay is shared).
  const noun = rosterNoun(s.flow);
  // The plain-language read of the score, so the status word always matches the
  // number (spec: "on standard" / "on the bubble" / "needs intervention").
  const status = scoreLanguage(pd.score);
  const statusColor = pd.score >= 85 ? colors.successDeep : pd.score >= 70 ? colors.warningDeep : colors.alert;
  const statusBg = pd.score >= 85 ? colors.successSurface : pd.score >= 70 ? '#FEF3C7' : colors.alertSurface;
  // Honest "last active": the trainer book carries real recency; otherwise the
  // roster is current-day, so it reads Today.
  const lastActive = pd.last ?? 'Today';

  return (
    <Overlay title={`${noun} Profile`} onClose={s.closePerson}>
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
              {[pd.pos, pd.org ?? (isBackendLive ? null : 'Eastside HS')].filter(Boolean).join(' · ')}
            </Txt>
            <View style={{ marginTop: 9, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: statusBg }}>
              <Txt w="b" size={12} color={statusColor}>
                {status}
              </Txt>
            </View>
            <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 6 }}>
              Last active · {lastActive}
            </Txt>
          </View>
        </Card>

        {/* COMPLIANCE is real (derived from the roster). DAY STREAK + WEIGHT Δ are sample
            showcase values, the same for every athlete, so they are shown ONLY in the demo
            and hidden once the backend is live — a real coach never sees fabricated stats. */}
        <Row style={{ gap: 10, marginTop: 14 }}>
          <StatTile value={`${pd.comp ?? pd.score}%`} label="COMPLIANCE" color={colors.success} />
          {isBackendLive ? null : (
            <>
              <StatTile value="12" label="DAY STREAK" />
              <StatTile value={`+${displayWeightDelta(7, units)}${weightUnit(units)}`} label="WEIGHT Δ" />
            </>
          )}
        </Row>
        {isBackendLive ? null : (
          <Row style={{ gap: 7, marginTop: 10 }}>
            <SampleTag />
            <Txt w="sb" size={12} color={colors.textTertiary} style={{ flex: 1 }}>
              Day streak and weight change are sample values, the same for every athlete
            </Txt>
          </Row>
        )}

        {pd.perf ? (
          <Card style={{ marginTop: 14, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="trophy" size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt w="eb" size={11} color={colors.textTertiary} ls={0.6}>
                PERFORMANCE
              </Txt>
              <Txt w="b" size={14} color={colors.slate700} style={{ marginTop: 2 }}>
                {pd.perf}
              </Txt>
            </View>
          </Card>
        ) : null}

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
              {aiPrefix}SUMMARY
            </Txt>
            <SampleTag />
          </Row>
          <Txt w="m" size={14} color={colors.slate700} style={{ lineHeight: 22 }}>
            {pd.score >= 85
              ? `${pd.name} is one of your most consistent. Nutrition is locked in and the streak is alive. Watch recovery; a small sleep gain would push this to an A+.`
              : pd.score >= 75
              ? `${pd.name} is holding steady. Nutrition and tasks are solid. Recovery is the gap; a sleep nudge would move the grade.`
              : `${pd.name} needs attention. The score is below the line. A check-in could help reset the routine.`}
          </Txt>
        </Card>

        {!nudged ? (
          <Input
            value={note}
            onChangeText={setNote}
            placeholder={`Add a note for ${pd.name} (optional)`}
            accessibilityLabel={`Note to attach to the nudge for ${pd.name}`}
            multiline
            maxLength={240}
            style={{ marginTop: 18, height: 78, paddingTop: 14, textAlignVertical: 'top' }}
          />
        ) : null}

        <Row style={{ gap: 10, marginTop: nudged ? 18 : 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Message ${pd.name}`} onPress={s.openMsg} style={[{ flex: 1, height: 54, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, shadow.cta]}>
            <Txt w="b" size={15} color="#fff">
              Message
            </Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nudged ? `Nudge sent to ${pd.name}` : note.trim() ? `Send a nudge with your note to ${pd.name}` : `Send a nudge to ${pd.name}`}
            accessibilityState={{ disabled: nudged }}
            disabled={nudged}
            onPress={() => { haptics.success(); s.sendNudge(pd.name, { score: pd.score, comp: pd.comp ?? pd.score }, note); }}
            style={({ pressed }) => [{ flex: 1, height: 54, borderRadius: 16, backgroundColor: nudged ? colors.successSurface : '#fff', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, opacity: pressed ? 0.8 : 1 }, shadow.card]}
          >
            {nudged ? <Icon name="check" size={17} color={colors.successDeep} /> : null}
            <Txt w="b" size={15} color={nudged ? colors.successDeep : colors.slate700}>
              {nudged ? 'Nudged' : note.trim() ? 'Send nudge + note' : 'Send nudge'}
            </Txt>
          </Pressable>
        </Row>

        {nudgeRec ? (
          <View
            accessibilityRole="text"
            accessibilityLabel={`Nudge record: ${nudgeTrail(nudgeRec)}`}
            style={{ marginTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.bg2 }}
          >
            <Icon name="check" size={15} color={colors.successDeep} />
            <Txt w="sb" size={13} color={colors.slate700} style={{ flex: 1, lineHeight: 19 }}>
              {nudgeTrail(nudgeRec)}
            </Txt>
          </View>
        ) : null}

        {outcome ? (
          <View
            accessibilityRole="text"
            accessibilityLabel={`Nudge follow-up: ${outcome.label}`}
            style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: outcome.improved ? colors.successSurface : colors.accentSurface }}
          >
            <Icon name={outcome.improved ? 'bolt' : 'bell'} size={15} color={outcome.improved ? colors.successDeep : colors.accent} />
            <Txt w="sb" size={13} color={outcome.improved ? colors.successDeep : colors.slate700} style={{ flex: 1 }}>
              {outcome.label}
            </Txt>
          </View>
        ) : null}
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
