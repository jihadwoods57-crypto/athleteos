// OnStandard — Athlete/Client detail overlay (from coach/trainer roster rows).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { athleteKey, coachMealPatterns, displayWeightDelta, findNudge, gradeFor, groupMealsByDay, nudgeOutcome, nudgeTrail, personBreakdown, rosterNoun, scoreLanguage, todayStamp, daysAgoStamp, weightUnit, type MealHistoryDay, type StoredMeal } from '@/core';
import { isMealPlansEnabled } from '@/lib/features';
import { useStore } from '@/store';
import { db, isBackendLive } from '@/lib/supabase';
import { aiPrefix } from '@/lib/ai';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Input, PressScale, ProgressBar, Reveal, Row, SampleTag, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Ring } from '@/ui/Ring';
import { Overlay } from './Overlay';
import { MealCardItem } from './MealCardItem';
import { AthleteProfileView } from '@/screens/roles/AthleteProfileView';

const RECENT_MEAL_DAYS = 14;

export function PersonDetail() {
  const c = useColors();
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
  const statusColor = pd.score >= 85 ? c.successDeep : pd.score >= 70 ? c.warningDeep : c.alert;
  const statusBg = pd.score >= 85 ? c.successSurface : pd.score >= 70 ? '#FEF3C7' : c.alertSurface;
  // Honest "last active": the trainer book carries real recency; otherwise the
  // roster is current-day, so it reads Today.
  const lastActive = pd.last ?? 'Today';

  return (
    <Overlay title={`${noun} Profile`} onClose={s.closePerson}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Reveal index={0}>
        <Card variant="hero" style={{ borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <Ring size={96} pct={pd.score} stroke={17} gradient={['#22C55E', '#16A34A']} track={c.track}>
            <Txt w="eb" num size={30} ls={-0.5}>
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
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 2 }}>
              {[pd.pos, pd.org ?? (isBackendLive ? null : 'Eastside HS')].filter(Boolean).join(' · ')}
            </Txt>
            <View style={{ marginTop: 9, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: statusBg }}>
              <Txt w="b" size={12} color={statusColor}>
                {status}
              </Txt>
            </View>
            <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 6 }}>
              Last active · {lastActive}
            </Txt>
          </View>
        </Card>
        </Reveal>

        {/* COMPLIANCE is real (derived from the roster). DAY STREAK + WEIGHT Δ are sample
            showcase values, the same for every athlete, so they are shown ONLY in the demo
            and hidden once the backend is live — a real coach never sees fabricated stats. */}
        <Row style={{ gap: 10, marginTop: 14 }}>
          <StatTile value={`${pd.comp ?? pd.score}%`} label="COMPLIANCE" color={c.success} />
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
            <Txt w="sb" size={12} color={c.textTertiary} style={{ flex: 1 }}>
              Day streak and weight change are sample values, the same for every athlete
            </Txt>
          </Row>
        )}

        {pd.perf ? (
          <Card variant="low" style={{ marginTop: 14, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="trophy" size={18} color={c.accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt w="eb" size={11} color={c.textTertiary} ls={0.6}>
                PERFORMANCE
              </Txt>
              <Txt w="b" size={14} color={c.slate700} style={{ marginTop: 2 }}>
                {pd.perf}
              </Txt>
            </View>
          </Card>
        ) : null}

        <Reveal index={1}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
          <Txt w="eb" size={15} ls={-0.3} style={{ marginBottom: 16 }}>
            Score Breakdown
          </Txt>
          <View style={{ gap: 12 }}>
            <BreakdownRow label="Nutrition" pct={bd.nutrition} />
            <BreakdownRow label="Recovery" pct={bd.recovery} accent />
            <BreakdownRow label="Commitment" pct={bd.commitment} />
            <BreakdownRow label="Check-in" pct={bd.checkin} />
          </View>
        </Card>
        </Reveal>

        {/* Coach owns the plan (Constitution Rule #13): set this athlete's targets +
            scoring profile. Shown to the overseer flows that open this overlay. */}
        {s.flow === 'coach' || s.flow === 'trainer' ? (
          <PressScale
            accessibilityLabel={`Set ${pd.name}'s targets and scoring`}
            onPress={s.openCoachGoals}
            style={[{ marginTop: 14, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card }, shadow.card]}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shield" size={18} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="b" size={15}>Targets &amp; scoring</Txt>
              <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>
                Set {pd.name.split(/\s+/)[0]}'s protein, calories &amp; scoring profile
              </Txt>
            </View>
            <Icon name="chevronRight" size={18} color={c.textTertiary} />
          </PressScale>
        ) : null}

        {/* Meal Plans (Wave 2) — author this client's prescribed meals. Opens the plan
            editor scoped to this athlete. Gated by isMealPlansEnabled. */}
        {isMealPlansEnabled && (s.flow === 'coach' || s.flow === 'trainer') ? (
          <PressScale
            accessibilityLabel={`Prescribe meals for ${pd.name}`}
            onPress={() => s.openAthletePlanEditor(athleteKey(pd), pd.name)}
            style={[{ marginTop: 14, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card }, shadow.card]}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={18} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="b" size={15}>Meal plan</Txt>
              <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>
                Prescribe {pd.name.split(/\s+/)[0]}'s meals for each window
              </Txt>
            </View>
            <Icon name="chevronRight" size={18} color={c.textTertiary} />
          </PressScale>
        ) : null}

        <RecentMeals athleteId={pd.athleteId} name={pd.name} />

        {pd.athleteId ? <AthleteProfileView athleteId={pd.athleteId} recentScores={[pd.score]} /> : null}

        <Reveal index={2}>
        <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
          <Row style={{ gap: 9, marginBottom: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={17} color={c.accent} />
            </View>
            <Txt w="eb" size={12} color={c.accent} ls={0.4}>
              {aiPrefix}SUMMARY
            </Txt>
            <SampleTag />
          </Row>
          <Txt w="m" size={14} color={c.slate700} style={{ lineHeight: 22 }}>
            {pd.score >= 85
              ? `${pd.name} is one of your most consistent. Nutrition is locked in and the streak is alive. Watch recovery; a small sleep gain would push this to an A+.`
              : pd.score >= 75
              ? `${pd.name} is holding steady. Nutrition and tasks are solid. Recovery is the gap; a sleep nudge would move the grade.`
              : `${pd.name} needs attention. The score is below the line. A check-in could help reset the routine.`}
          </Txt>
        </Card>
        </Reveal>

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
          <Pressable accessibilityRole="button" accessibilityLabel={`Message ${pd.name}`} onPress={s.openMsg} style={[{ flex: 1, height: 54, borderRadius: 16, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }, shadow.cta]}>
            <Txt w="b" size={15} color={c.white}>
              Message
            </Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nudged ? `Nudge sent to ${pd.name}` : note.trim() ? `Send a nudge with your note to ${pd.name}` : `Send a nudge to ${pd.name}`}
            accessibilityState={{ disabled: nudged }}
            disabled={nudged}
            onPress={() => { haptics.success(); s.sendNudge(pd.name, { score: pd.score, comp: pd.comp ?? pd.score }, note, pd.athleteId); }}
            style={({ pressed }) => [{ flex: 1, height: 54, borderRadius: 16, backgroundColor: nudged ? c.successSurface : c.card, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, opacity: pressed ? 0.8 : 1 }, shadow.card]}
          >
            {nudged ? <Icon name="check" size={17} color={c.successDeep} /> : null}
            <Txt w="b" size={15} color={nudged ? c.successDeep : c.slate700}>
              {nudged ? 'Nudged' : note.trim() ? 'Send nudge + note' : 'Send nudge'}
            </Txt>
          </Pressable>
        </Row>

        {nudgeRec ? (
          <View
            accessibilityRole="text"
            accessibilityLabel={`Nudge record: ${nudgeTrail(nudgeRec)}`}
            style={{ marginTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: c.bg2 }}
          >
            <Icon name="check" size={15} color={c.successDeep} />
            <Txt w="sb" size={13} color={c.slate700} style={{ flex: 1, lineHeight: 19 }}>
              {nudgeTrail(nudgeRec)}
            </Txt>
          </View>
        ) : null}

        {outcome ? (
          <View
            accessibilityRole="text"
            accessibilityLabel={`Nudge follow-up: ${outcome.label}`}
            style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: outcome.improved ? c.successSurface : c.accentSurface }}
          >
            <Icon name={outcome.improved ? 'bolt' : 'bell'} size={15} color={outcome.improved ? c.successDeep : c.accent} />
            <Txt w="sb" size={13} color={outcome.improved ? c.successDeep : c.slate700} style={{ flex: 1 }}>
              {outcome.label}
            </Txt>
          </View>
        ) : null}
      </ScrollView>
    </Overlay>
  );
}

/**
 * Coach/trainer meal history (Part C): the linked athlete's recent stored meals,
 * read via fetchRecentMeals (RLS scopes it to athletes the opener is linked to).
 * Only renders real data — on the demo roster (no athleteId) or with the backend
 * off it shows the honest not-connected state, never fabricated food, matching the
 * DAY-STREAK / WEIGHT-Δ sample handling elsewhere in this overlay.
 */
function RecentMeals({ athleteId, name }: { athleteId?: string; name: string }) {
  const c = useColors();
  const live = isBackendLive && !!athleteId;
  const [meals, setMeals] = React.useState<StoredMeal[] | null>(null);
  React.useEffect(() => {
    if (!live || !athleteId) return;
    let cancelled = false;
    db.fetchRecentMeals(athleteId, daysAgoStamp(RECENT_MEAL_DAYS))
      .then((rows) => {
        if (!cancelled) setMeals(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [live, athleteId]);

  const days: MealHistoryDay[] = meals ? groupMealsByDay(meals, todayStamp()) : [];
  // Soft, deterministic coaching patterns over this athlete's recent meals (description-vs-photo
  // bias, logging completeness). Only surfaces once a real pattern has formed — never per-incident.
  const patterns = live && meals ? coachMealPatterns(meals) : [];
  const firstName = name.split(/\s+/)[0] || name;

  return (
    <Card variant="low" style={{ marginTop: 14, borderRadius: 20 }}>
      <Row style={{ gap: 9, marginBottom: 12 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="utensils" size={16} color={c.accent} />
        </View>
        <Txt w="eb" size={15} ls={-0.3} style={{ flex: 1 }}>
          Recent Meals
        </Txt>
        {live ? null : <SampleTag />}
      </Row>

      {patterns.length > 0 ? (
        <View style={{ gap: 8, marginBottom: 14 }}>
          {patterns.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: c.warnTint }}>
              <Icon name="bell" size={15} color={c.warnText} />
              <View style={{ flex: 1 }}>
                <Txt w="eb" size={13} color={c.warnText}>{p.headline}</Txt>
                <Txt w="m" size={12} color={c.slate700} style={{ marginTop: 2, lineHeight: 17 }}>{p.detail}</Txt>
              </View>
              {p.metric ? <Txt w="eb" size={12} color={c.warnText}>{p.metric}</Txt> : null}
            </View>
          ))}
        </View>
      ) : null}

      {!live ? (
        <Txt w="sb" size={13} color={c.textTertiary} style={{ lineHeight: 19 }}>
          {firstName}’s logged meals — photo, macros, and quality — appear here once your team is connected to the backend.
        </Txt>
      ) : days.length === 0 ? (
        <Txt w="sb" size={13} color={c.textTertiary} style={{ lineHeight: 19 }}>
          No meals logged in the last {RECENT_MEAL_DAYS} days.
        </Txt>
      ) : (
        <View style={{ gap: 16 }}>
          {days.map((day) => (
            <View key={day.dateKey} style={{ gap: 12 }}>
              <Txt w="eb" size={11} color={c.textTertiary} ls={0.5}>
                {day.dayLabel.toUpperCase()}
              </Txt>
              {day.cards.map((meal) => (
                <MealCardItem key={meal.id} card={meal} />
              ))}
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

function StatTile({ value, label, color }: { value: string; label: string; color?: string }) {
  const c = useColors();
  return (
    <View style={[{ flex: 1, backgroundColor: c.card, borderRadius: 18, padding: 16 }, shadow.card]}>
      <Txt w="eb" num size={24} color={color}>
        {value}
      </Txt>
      <Txt w="b" size={11} color={c.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
    </View>
  );
}

function BreakdownRow({ label, pct, accent }: { label: string; pct: number; accent?: boolean }) {
  const c = useColors();
  return (
    <Row style={{ gap: 11 }}>
      <Txt w="sb" size={13} style={{ width: 78 }}>
        {label}
      </Txt>
      <View style={{ flex: 1 }}>
        <ProgressBar pct={pct} height={8} color={accent ? c.accent : c.success} />
      </View>
      <Txt w="eb" num size={13} style={{ width: 26, textAlign: 'right' }}>
        {pct}
      </Txt>
    </Row>
  );
}
