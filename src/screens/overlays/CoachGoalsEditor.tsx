// OnStandard — Coach per-athlete targets & scoring editor (Phase 4). The Constitution
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
import { db, isBackendLive } from '@/lib/supabase';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Reveal, Row, SampleTag, Stepper, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

export function CoachGoalsEditor() {
  const c = useColors();
  const s = useStore();
  const pd = s.personDetail;
  const [profile, setProfile] = React.useState<ScoringProfile>('athlete');
  const rec = recommendTargets(profile);
  const [targets, setTargets] = React.useState<GoalTargets>(rec);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const noun = rosterNoun(s.flow);
  const name = pd?.name ?? 'this athlete';
  const athleteId = pd?.athleteId;
  const canPush = isBackendLive && !!athleteId;

  // Load the athlete's CURRENT plan on open so the editor never silently re-seeds
  // recommendation defaults over targets the coach already set (reopening used to
  // show 155g to a coach who saved 180g last week — one honest-looking "Save & send"
  // then overwrote their own plan). Soft-fail: the recommendation seed stands.
  React.useEffect(() => {
    if (!isBackendLive || !athleteId) return;
    let cancelled = false;
    db.fetchAthleteProfile(athleteId)
      .then((row) => {
        if (cancelled) return;
        const t = row?.targets as (Partial<GoalTargets> & { profile?: string }) | null;
        if (t && typeof t.protein === 'number' && typeof t.calories === 'number' && typeof t.weight === 'number') {
          const knownProfile = SCORING_PROFILE_OPTIONS.find((o) => o.key === t.profile)?.key;
          if (knownProfile) setProfile(knownProfile);
          setTargets({ protein: t.protein, calories: t.calories, weight: t.weight });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  if (!pd) return null;

  const step = (kind: keyof GoalTargets, dir: number) =>
    setTargets((t) => ({ ...t, [kind]: clampTarget(kind, t[kind] + dir * TARGET_LIMITS[kind].step) }));

  // Switching the profile re-seeds the recommended targets (the coach can then tweak).
  const pickProfile = (p: ScoringProfile) => { haptics.select(); setProfile(p); setTargets(recommendTargets(p)); setSaved(false); };

  const onSave = async () => {
    setError(null);
    if (canPush) {
      setBusy(true);
      const ok = await s.pushAthleteGoals(athleteId!, targets, profile);
      setBusy(false);
      if (!ok) {
        // The plan is the one thing the coach owns; a silent write failure means the
        // athlete keeps stale targets while the coach believes they changed them.
        haptics.tap();
        setError("Couldn't send the plan. Check your connection and try again — nothing was changed yet.");
        return;
      }
    }
    setSaved(true);
    haptics.success();
  };

  return (
    <Overlay title={`${name}'s Plan`} onClose={s.closeCoachGoals}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* intro — icon-tiled premium header framing the coach's ownership */}
        <Reveal index={0}>
        <Card variant="hero" style={{ marginTop: 4, borderRadius: 22, padding: 18, flexDirection: 'row', gap: 13, alignItems: 'flex-start' }}>
          <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={20} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={11} color={c.accent} ls={0.5}>YOU OWN THE PLAN</Txt>
            <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 19 }}>
              You set the plan; the platform scores against it. The suggestion below is the science-based
              starting point — accept it or dial it in.
            </Txt>
          </View>
        </Card>
        </Reveal>

        {/* scoring profile */}
        <Txt w="eb" size={12} color={c.textTertiary} ls={0.6} upper style={{ marginTop: 22, marginBottom: 10, marginLeft: 4 }}>
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
                style={({ pressed }) => [{ borderRadius: 18, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: sel ? c.accentSurface : c.card, borderWidth: 1.5, borderColor: sel ? c.accent : c.hairline, opacity: pressed ? 0.92 : 1 }, sel ? undefined : shadow.card]}
              >
                <View style={{ flex: 1 }}>
                  <Txt w="b" size={15} color={sel ? c.accent : c.text}>{o.label}</Txt>
                  <Txt w="m" size={12} color={c.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>{o.desc}</Txt>
                </View>
                {sel ? (
                  <View style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={15} color={c.white} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* targets */}
        <Txt w="eb" size={12} color={c.textTertiary} ls={0.6} upper style={{ marginTop: 24, marginBottom: 10, marginLeft: 4 }}>
          Daily targets
        </Txt>
        <Reveal index={1}>
        <Card variant="low" style={{ borderRadius: 22, paddingVertical: 6, paddingHorizontal: 16 }}>
          <TargetRow label="Protein" unit="g" value={targets.protein} rec={rec.protein} onDec={() => step('protein', -1)} onInc={() => step('protein', 1)} />
          <TargetRow label="Calories" unit="kcal" value={targets.calories} rec={rec.calories} onDec={() => step('calories', -1)} onInc={() => step('calories', 1)} />
          <TargetRow label="Weight goal" unit="lb" value={targets.weight} rec={rec.weight} onDec={() => step('weight', -1)} onInc={() => step('weight', 1)} last />
        </Card>
        </Reveal>

        {/* plan summary */}
        <View style={{ marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={16} color={c.accent} />
          </View>
          <Txt w="sb" size={13} color={c.slate700} style={{ flex: 1, lineHeight: 19 }}>
            {goalPlanSummary(name, targets, profile)}
          </Txt>
        </View>

        {!canPush ? (
          <Row style={{ gap: 9, marginTop: 14, alignItems: 'flex-start', backgroundColor: c.warnTint, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 }}>
            <SampleTag style={{ marginTop: 1 }} />
            <Txt w="sb" size={12} color={c.warnText} style={{ flex: 1, lineHeight: 17 }}>
              Connect your team to push this plan to {name}. Until then it's a draft on this device.
            </Txt>
          </Row>
        ) : null}

        {error ? (
          <Row style={{ gap: 9, marginTop: 14, alignItems: 'flex-start', backgroundColor: c.alertSurface, borderWidth: 1, borderColor: c.alertBorder, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.alert, marginTop: 5 }} />
            <Txt w="sb" size={13} color={c.alertDeep} style={{ flex: 1, lineHeight: 18 }}>
              {error}
            </Txt>
          </Row>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={canPush ? `Save ${name}'s plan` : 'Save draft'}
          disabled={busy}
          onPress={onSave}
          style={[{ height: 54, borderRadius: 16, backgroundColor: saved ? c.successSurface : c.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 18 }, shadow.cta]}
        >
          {saved ? <Icon name="check" size={18} color={c.successDeep} /> : null}
          <Txt w="b" size={15} color={saved ? c.successDeep : c.white}>
            {busy ? 'Saving…' : saved ? (canPush ? 'Plan sent' : 'Draft saved') : canPush ? 'Save & send to athlete' : 'Save draft'}
          </Txt>
        </Pressable>
      </ScrollView>
    </Overlay>
  );
}

/**
 * Proto target-editor row (coach-plan `.lrow`): label + honest recommendation read on the
 * left, stepper on the right — hairline-divided rows in ONE section, not boxed sub-cards.
 */
function TargetRow({ label, unit, value, rec, onDec, onInc, last }: { label: string; unit: string; value: number; rec: number; onDec: () => void; onInc: () => void; last?: boolean }) {
  const c = useColors();
  const offRec = value !== rec;
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 2, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.hairline }}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Txt w="b" size={15}>{label}</Txt>
        <Row style={{ gap: 5, alignItems: 'center', marginTop: 3 }}>
          {offRec ? null : <Icon name="check" size={12} color={c.success} />}
          <Txt w="m" num size={12} color={offRec ? c.textTertiary : c.success}>
            {offRec ? `Recommended ${rec}${unit}` : `Matches recommendation`}
          </Txt>
        </Row>
      </View>
      <Stepper value={`${value}${unit}`} onDec={onDec} onInc={onInc} />
    </Row>
  );
}
