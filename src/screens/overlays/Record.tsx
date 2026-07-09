// OnStandard — the athlete's Record surface.
//
// Home for two premium proofs that the 2026-07-07 Profile slim-down deliberately moved OFF Profile:
//   * Discipline Record — the recruiting-side card (real logged history only; a recruiter reading it
//     knows it wasn't self-typed). Refuses to render below RECORD_MIN_DAYS — a short history reads as
//     a short history, never a fabricated one.
//   * Deep Dive — the paid weekly AI analysis. Its weekly cap + paywall live server-side; this screen
//     just reports the honest state (already used this week / needs a plan / sign in) instead of a spinner.
import React, { useState } from 'react';
import { ScrollView, Share, View, ActivityIndicator } from 'react-native';
import { useStore, useDerived } from '@/store';
import {
  disciplineRecord,
  disciplineRecordText,
  buildDeepDivePayload,
  deepDiveReady,
  streakInfo,
  weeklyCompliance,
  type DeepDiveResult,
} from '@/core';
import { runDeepDive, type DeepDiveFailure } from '@/lib/ai/deepDive';
import { isStreakGraceEnabled } from '@/lib/features';
import { shadow, MAX_FONT_SCALE } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, PressScale, Row, Txt } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

/** Honest, human copy for each server-side unavailable reason — never a bare error. */
function deepDiveUnavailableCopy(reason: DeepDiveFailure): { title: string; body: string } {
  switch (reason) {
    case 'weekly_used':
      return { title: 'This week’s dive is done', body: 'Deep Dive runs once a week so it always reads a full week of real data. Check back next week.' };
    case 'requires_plan':
      return { title: 'Deep Dive is an Individual Plus feature', body: 'Upgrade in Account → Plan to unlock your weekly AI analysis.' };
    case 'sign_in_required':
      return { title: 'Sign in to run a Deep Dive', body: 'Your dive reads your real synced history, so it needs you signed in.' };
    case 'not_configured':
      return { title: 'Deep Dive isn’t available yet', body: 'This build isn’t connected to the analysis service.' };
    default:
      return { title: 'That didn’t go through', body: 'Something interrupted the analysis. Give it another try in a moment.' };
  }
}

export function Record() {
  const s = useStore();
  const d = useDerived();
  const c = useColors();

  const record = disciplineRecord(s.scoreHistory ?? [], d.athleteScore, s.weightHistory ?? []);
  const name = s.athleteName?.trim() || 'Athlete';

  // ---- Deep Dive run state (idle → loading → result | unavailable) ----
  const [diving, setDiving] = useState(false);
  const [dive, setDive] = useState<DeepDiveResult | null>(null);
  const [diveError, setDiveError] = useState<DeepDiveFailure | null>(null);
  const canDive = deepDiveReady(s.scoreHistory ?? []);

  async function onDeepDive() {
    if (diving) return;
    setDiving(true);
    setDiveError(null);
    const streak = streakInfo(s.scoreHistory ?? [], d.athleteScore, {
      grace: isStreakGraceEnabled,
      today: s.dateStamp,
    });
    const compliancePct = weeklyCompliance(s.scoreHistory ?? [], d.athleteScore).pct;
    const payload = buildDeepDivePayload({
      baseGoal: s.baseGoal,
      scoreHistory: s.scoreHistory ?? [],
      nutritionHistory: s.nutritionHistory ?? [],
      weightHistory: s.weightHistory ?? [],
      liveScore: d.athleteScore,
      proteinToday: d.proteinToday,
      proteinTarget: d.proteinTarget,
      kcalToday: d.kcalToday,
      calTarget: d.calTarget,
      streakDays: streak.days,
      compliancePct,
    });
    const res = await runDeepDive(payload);
    if (res.kind === 'result') {
      setDive(res.result);
    } else {
      setDiveError(res.reason);
    }
    setDiving(false);
  }

  async function onShare() {
    if (!record) return;
    try {
      await Share.share({ message: disciplineRecordText(record, name) });
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <Overlay title="Your Record" onClose={s.closeRecord}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        {/* ─────────── Discipline Record ─────────── */}
        <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} style={{ marginTop: 8, marginBottom: 10 }}>
          DISCIPLINE RECORD
        </Txt>

        {record ? (
          <Card variant="low" style={{ borderRadius: 24, padding: 22 }}>
            <Txt w="eb" size={19} ls={-0.4}>
              {name}
            </Txt>
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 2 }}>
              On record since {record.since} · {record.daysLogged} logged days
            </Txt>

            <Row style={{ marginTop: 18, gap: 12 }}>
              <Stat label="On standard" value={`${record.onStandardPct}%`} c={c} />
              <Stat label="Avg score" value={`${record.avgScore}`} c={c} />
            </Row>
            <Row style={{ marginTop: 12, gap: 12 }}>
              <Stat label="Longest streak" value={`${record.longestStreak}d`} c={c} />
              <Stat label="Current" value={`${record.currentStreak}d`} c={c} />
            </Row>

            <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 18, lineHeight: 17 }}>
              {record.integrityLine}
            </Txt>

            <PressScale
              accessibilityLabel="Share your Discipline Record"
              haptic="tap"
              onPress={onShare}
              style={[{ marginTop: 16, height: 54, borderRadius: 16, backgroundColor: c.success, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }, shadow.ctaGreen]}
            >
              <Icon name="send" size={19} color={c.onGreen} />
              <Txt w="eb" size={16} color={c.onGreen} ls={-0.2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Share your record
              </Txt>
            </PressScale>
          </Card>
        ) : (
          <Card variant="low" style={{ borderRadius: 24, padding: 22 }}>
            <Txt w="eb" size={16} ls={-0.3}>
              Your record is still building
            </Txt>
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 6, lineHeight: 19 }}>
              A shareable Discipline Record unlocks after a week of real logged days, so what a recruiter
              reads is earned — never a three-day card that impresses nobody. Keep logging.
            </Txt>
          </Card>
        )}

        {/* ─────────── Deep Dive ─────────── */}
        <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} style={{ marginTop: 30, marginBottom: 10 }}>
          DEEP DIVE
        </Txt>

        {dive ? (
          <Card variant="low" style={{ borderRadius: 24, padding: 22 }}>
            <Txt w="eb" size={18} ls={-0.3}>
              {dive.headline}
            </Txt>
            {dive.sections.map((sec, i) => (
              <View key={i} style={{ marginTop: 16 }}>
                <Txt w="eb" size={13.5} color={c.accent} ls={0.2}>
                  {sec.title}
                </Txt>
                <Txt w="m" size={13.5} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 20 }}>
                  {sec.body}
                </Txt>
              </View>
            ))}
            <View style={{ marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: c.accentSurface }}>
              <Txt w="eb" size={12} color={c.accent} ls={0.4}>
                THIS WEEK’S FOCUS
              </Txt>
              <Txt w="sb" size={14} style={{ marginTop: 4, lineHeight: 20 }}>
                {dive.focus}
              </Txt>
            </View>
          </Card>
        ) : diveError ? (
          <Card variant="low" style={{ borderRadius: 24, padding: 22 }}>
            {(() => {
              const copy = deepDiveUnavailableCopy(diveError);
              return (
                <>
                  <Txt w="eb" size={16} ls={-0.3}>
                    {copy.title}
                  </Txt>
                  <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 6, lineHeight: 19 }}>
                    {copy.body}
                  </Txt>
                  {diveError === 'error' ? (
                    <PressScale accessibilityLabel="Try the Deep Dive again" haptic="tap" onPress={onDeepDive} style={{ marginTop: 14 }}>
                      <Txt w="eb" size={14} color={c.accent}>
                        Try again
                      </Txt>
                    </PressScale>
                  ) : null}
                </>
              );
            })()}
          </Card>
        ) : (
          <Card variant="low" style={{ borderRadius: 24, padding: 22 }}>
            <Txt w="eb" size={16} ls={-0.3}>
              Your week, read closely
            </Txt>
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 6, lineHeight: 19 }}>
              A once-a-week AI pass over your real scores, nutrition, and weight — what’s working, what’s
              slipping, and the one thing to focus on next.
            </Txt>
            <PressScale
              accessibilityLabel="Run this week's Deep Dive"
              haptic="tap"
              onPress={canDive ? onDeepDive : undefined}
              style={[
                { marginTop: 16, height: 54, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: canDive ? c.accent : c.track },
                canDive ? shadow.card : null,
              ]}
            >
              {diving ? (
                <ActivityIndicator color={canDive ? c.onGreen : c.textTertiary} />
              ) : (
                <Txt w="eb" size={16} color={canDive ? c.onGreen : c.textTertiary} ls={-0.2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {canDive ? 'Run this week’s Deep Dive' : 'Log a week to unlock'}
                </Txt>
              )}
            </PressScale>
          </Card>
        )}
      </ScrollView>
    </Overlay>
  );
}

/** One stat tile in the Discipline Record card. */
function Stat({ label, value, c }: { label: string; value: string; c: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flex: 1, borderRadius: 16, padding: 14, backgroundColor: c.bg }}>
      <Txt w="eb" num size={22} ls={-0.5} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {value}
      </Txt>
      <Txt w="sb" size={11.5} color={c.textTertiary} style={{ marginTop: 2 }}>
        {label}
      </Txt>
    </View>
  );
}
