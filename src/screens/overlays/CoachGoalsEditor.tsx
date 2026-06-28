// AthleteOS — Coach per-athlete targets & scoring editor (Phase 4). The Constitution
// says the coach owns each athlete's plan (targets + scoring profile) and the AI only
// recommends (Rule #13), but there was no mobile UI for it. Opened from PersonDetail.
//
// The coach sets protein/calorie/weight targets (pushed via the coach_set_goals RPC
// when live) and picks the scoring profile; the science-based recommendation is shown
// as an accept-or-override suggestion. Demo-safe: with the backend off it shows a
// "connect to push" note and never fabricates a write.
import React from 'react';
import { ScrollView, View } from 'react-native';
import {
  clampTarget,
  goalPlanSummary,
  recommendTargets,
  rosterNoun,
  SCORING_PROFILE_OPTIONS,
  TARGET_LIMITS,
  type GoalTargets,
  type ScoringProfile,
} from '@/core';
import { useStore } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, SampleTag, Stepper, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

export function CoachGoalsEditor() {
  const s = useStore();
  const pd = s.personDetail;
  const [profile, setProfile] = React.useState<ScoringProfile>('athlete');
  const rec = recommendTargets(profile);
  const [targets, setTargets] = React.useState<GoalTargets>(rec);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const noun = rosterNoun(s.flow);
  const name = pd?.name ?? 'this athlete';

  if (!pd) return null;

  const step = (kind: keyof GoalTargets, dir: number) =>
    setTargets((t) => ({ ...t, [kind]: clampTarget(kind, t[kind] + dir * TARGET_LIMITS[kind].step) }));

  // Switching the profile re-seeds the recommended targets (the coach can then tweak).
  const pickProfile = (p: ScoringProfile) => { haptics.select(); setProfile(p); setTargets(recommendTargets(p)); setSaved(false); };

  const onSave = async () => {
    if (isBackendLive && pd.athleteId) {
      setBusy(true);
      await s.pushAthleteGoals(pd.athleteId, targets);
      setBusy(false);
    }
    setSaved(true);
    haptics.success();
  };

  const canPush = isBackendLive && !!pd.athleteId;

  return (
    <Overlay title={`${name}'s Plan`} onClose={s.closeCoachGoals}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Txt w="m" size={13} color={colors.textSecondary} style={{ marginBottom: 16, lineHeight: 19 }}>
          You set the plan; the platform scores against it. The suggestion below is the science-based
          starting point — accept it or dial it in.
        </Txt>

        {/* scoring profile */}
        <Txt w="eb" size={12} color={colors.textTertiary} ls={0.5} upper style={{ marginBottom: 10, marginLeft: 2 }}>
          Scoring profile
        </Txt>
        <View style={{ gap: 10 }}>
          {SCORING_PROFILE_OPTIONS.map((o) => {
            const sel = profile === o.key;
            return (
              <Pressable
                key={o.key}
                accessibilityRole="button"
                accessibilityLabel={`${o.label} scoring`}
                accessibilityState={{ selected: sel }}
                onPress={() => pickProfile(o.key)}
                style={({ pressed }) => [{ borderRadius: 16, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: sel ? colors.accentSurface : '#fff', borderWidth: 1.5, borderColor: sel ? colors.accent : colors.border, opacity: pressed ? 0.92 : 1 }, sel ? undefined : shadow.card]}
              >
                <View style={{ flex: 1 }}>
                  <Txt w="b" size={15} color={sel ? colors.accent : colors.text}>{o.label}</Txt>
                  <Txt w="m" size={12} color={colors.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>{o.desc}</Txt>
                </View>
                {sel ? <Icon name="check" size={18} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>

        {/* targets */}
        <Txt w="eb" size={12} color={colors.textTertiary} ls={0.5} upper style={{ marginTop: 22, marginBottom: 10, marginLeft: 2 }}>
          Daily targets
        </Txt>
        <Card style={{ borderRadius: 20, gap: 16 }}>
          <TargetRow label="Protein" unit="g" value={targets.protein} rec={rec.protein} onDec={() => step('protein', -1)} onInc={() => step('protein', 1)} />
          <TargetRow label="Calories" unit="kcal" value={targets.calories} rec={rec.calories} onDec={() => step('calories', -1)} onInc={() => step('calories', 1)} />
          <TargetRow label="Weight goal" unit="lb" value={targets.weight} rec={rec.weight} onDec={() => step('weight', -1)} onInc={() => step('weight', 1)} />
        </Card>

        {/* plan summary */}
        <View style={{ marginTop: 16, borderRadius: 16, padding: 15, backgroundColor: colors.bg2, flexDirection: 'row', gap: 10 }}>
          <Icon name="shield" size={16} color={colors.accent} />
          <Txt w="sb" size={13} color={colors.slate700} style={{ flex: 1, lineHeight: 19 }}>
            {goalPlanSummary(name, targets, profile)}
          </Txt>
        </View>

        {!canPush ? (
          <Row style={{ gap: 7, marginTop: 14 }}>
            <SampleTag />
            <Txt w="sb" size={12} color={colors.textTertiary} style={{ flex: 1, lineHeight: 17 }}>
              Connect your team to push this plan to {name}. Until then it's a draft on this device.
            </Txt>
          </Row>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={canPush ? `Save ${name}'s plan` : 'Save draft'}
          disabled={busy}
          onPress={onSave}
          style={[{ height: 54, borderRadius: 16, backgroundColor: saved ? colors.successSurface : colors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 18 }, shadow.cta]}
        >
          {saved ? <Icon name="check" size={18} color={colors.successDeep} /> : null}
          <Txt w="b" size={15} color={saved ? colors.successDeep : '#fff'}>
            {busy ? 'Saving…' : saved ? (canPush ? 'Plan sent' : 'Draft saved') : canPush ? 'Save & send to athlete' : 'Save draft'}
          </Txt>
        </Pressable>
      </ScrollView>
    </Overlay>
  );
}

function TargetRow({ label, unit, value, rec, onDec, onInc }: { label: string; unit: string; value: number; rec: number; onDec: () => void; onInc: () => void }) {
  const offRec = value !== rec;
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <View style={{ flex: 1 }}>
        <Txt w="b" size={15}>{label}</Txt>
        <Txt w="m" size={12} color={offRec ? colors.textTertiary : colors.success} style={{ marginTop: 2 }}>
          {offRec ? `Recommended ${rec}${unit}` : `Matches recommendation`}
        </Txt>
      </View>
      <Stepper value={`${value}${unit}`} onDec={onDec} onInc={onInc} />
    </Row>
  );
}
