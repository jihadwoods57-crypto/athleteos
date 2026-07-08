// OnStandard — Recovery Check-In (redesign 2026-07, faithful build of the proto's
// proto/redesign-2026-07/js/screens/recovery.js: the quick slider form + the calm
// confirm state).
//
// The proto's "recovery check-in" IS the app's existing check-in instrument — this
// screen is the proto's presentation layered over the REAL machinery, never a
// parallel one:
//   · questions   = CHECKIN_QUESTIONS filtered by the coach-enabled s.ciConfig
//   · sliders     = the shipped 1–10 @/ui/Slider bound to s.setCi (same as CheckIn)
//   · submit      = the real s.submitCi() (scoring/rollover untouched)
//   · every number (score, +N pts, scored recovery) reads off computeDerived /
//     projectedScore — the proto's hardcoded "+6" is replaced by the honest
//     projected gain of submitting the check-in right now.
// Anchor words follow the proto where the question maps (Sleep quality Poor↔Great,
// Energy Low↔High); soreness keeps its REAL polarity (lo None → hi Very sore, the
// engine inverts it internally), so the proto's chip-goodness High↔None wording is
// deliberately not copied — the slider must stay honest to the stored value.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CHECKIN_QUESTIONS,
  PROFILE_WEIGHTS,
  computeDerived,
  projectedScore,
  resolveProfile,
  streakInfo,
  supportAudience,
  tierFor,
  withinTrailingWeek,
} from '@/core';
import { useStore, useDerived } from '@/store';
import { isStreakGraceEnabled } from '@/lib/features';
import { shadow, typeScale, MAX_FONT_SCALE, tierChip } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Btn, Card, PressScale, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { Slider } from '@/ui/Slider';
import { Icon } from '@/icons';

type CiKey = 'ciEnergy' | 'ciRecovery' | 'ciSleep' | 'ciConfidence' | 'ciSoreness' | 'ciMotivation';

/** Question key -> store slider field (same map CheckIn.tsx uses). */
const CI_KEYS: Record<string, CiKey> = {
  energy: 'ciEnergy',
  recovery: 'ciRecovery',
  sleep: 'ciSleep',
  confidence: 'ciConfidence',
  soreness: 'ciSoreness',
  motivation: 'ciMotivation',
};

/** Low↔high anchor words per question — proto wording where the proto has the same
 *  question, honest wording elsewhere. Presentational only; never touches the data. */
const CI_ANCHORS: Record<string, { lo: string; hi: string; scale?: string }> = {
  sleep: { lo: 'Poor', hi: 'Great', scale: 'Sleep quality' }, // proto
  energy: { lo: 'Low', hi: 'High' }, // proto
  // Real polarity (10 = very sore); scoring contributes (10 − value) internally.
  soreness: { lo: 'None', hi: 'Very sore' },
  recovery: { lo: 'Beat up', hi: 'Fully recovered' },
  confidence: { lo: 'Shaky', hi: 'Dialed in' },
  motivation: { lo: 'Flat', hi: 'Fired up' },
};

/** Sentence-case the supportAudience string ("your coach" → "Your coach"). */
function cap(t: string): string {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export function Recovery() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const s = useStore();
  const d = useDerived();

  // Captured the moment before submitCi ran, so the confirm state can show the real
  // score move (from → to) without touching the store. Null until submitted here.
  const [fromScore, setFromScore] = React.useState<number | null>(null);

  // The honest projected effect of submitting the check-in right now: the same pure
  // engine run over "this state, check-in submitted" (recovery from the CURRENT
  // slider answers + the weekly check-in slot). Never a hardcoded "+6".
  const afterScore = React.useMemo(() => computeDerived({ ...s, ciSubmitted: true }).athleteScore, [s]);
  const gain = Math.max(0, afterScore - d.athleteScore);

  // "Refreshes Recovery (25% of score)" — the pct comes from the account's REAL
  // scoring profile (a trainer's general client weighs recovery differently).
  const recoveryPct = Math.round(PROFILE_WEIGHTS[resolveProfile(s.scoringProfile)].recovery * 100);

  const isReal = s.athleteName.trim().length > 0;
  // Who sees the check-in — gated so a real solo athlete is never told a fake coach saw it.
  const audience = supportAudience({ isReal, supportTeam: s.supportTeam, demo: 'Coach Davis' });

  // Already backed by a real submission this week (mirrors CheckIn's done stage +
  // Home's weekly-carry logic) — show the calm submitted state, not the form.
  const submittedThisWeek =
    s.ciStage === 'done' || s.ciSubmitted || (s.ciLast != null && withinTrailingWeek(s.ciLast.date, s.dateStamp));

  const pad = { paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 130 };

  // ---- Confirm state (just submitted from this screen) ----
  if (fromScore != null) {
    return <RecoveryConfirm from={fromScore} pad={pad} audience={audience} isReal={isReal} />;
  }

  // ---- Calm already-done state (proto's RT.recoveryDone branch) ----
  if (submittedThisWeek) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={pad} showsVerticalScrollIndicator={false}>
        <Reveal index={0}>
          <BackHead
            title="Recovery Check-In"
            sub={s.ciSubmitted ? 'Done for tonight' : 'Done for this week'}
            onBack={s.goHome}
          />
        </Reveal>
        <Reveal index={1}>
          <View
            style={{
              marginTop: 8,
              borderWidth: 1,
              borderColor: c.successBorderSoft,
              borderRadius: 22,
              paddingVertical: 22,
              paddingHorizontal: 18,
              alignItems: 'center',
            }}
          >
            <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center', marginBottom: 13 }}>
              <Icon name="check" size={24} color={c.success} />
            </View>
            <Txt w="eb" size={15.5}>
              {s.ciSubmitted ? 'Submitted tonight' : 'Submitted this week'}
            </Txt>
            <Txt w="sb" size={13} color={c.textSecondary} style={{ marginTop: 5, lineHeight: 19, textAlign: 'center' }}>
              {d.recoveryScoreIsReal ? `Recovery counted · scored ${d.recoveryScore}. ` : ''}
              {audience ? `${cap(audience)} can see your readiness before tomorrow's practice.` : 'Saved to your record.'}
            </Txt>
            <View style={{ marginTop: 14, alignSelf: 'stretch' }}>
              <GhostBtn label="Back Home" onPress={s.goHome} />
            </View>
          </View>
        </Reveal>
      </ScrollView>
    );
  }

  // ---- The quick slider form ----
  const questions = CHECKIN_QUESTIONS.filter((q) => s.ciConfig[q.key]);

  const onSubmit = () => {
    setFromScore(d.athleteScore);
    s.submitCi();
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={pad} showsVerticalScrollIndicator={false}>
      <Reveal index={0}>
        <BackHead
          title="Recovery Check-In"
          sub={`Before bed · Refreshes Recovery (${recoveryPct}% of score)`}
          onBack={s.goHome}
        />
        {/* quick-info line: "20 seconds" · question count · the honest +N pts */}
        <Row style={{ gap: 7, flexWrap: 'wrap', marginTop: 2 }}>
          <Row style={{ gap: 5 }}>
            <Icon name="checkin" size={13} color={c.textTertiary} />
            <Txt w="sb" size={13} color={c.textTertiary}>
              20 seconds
            </Txt>
          </Row>
          <Dot />
          <Txt w="sb" size={13} color={c.textTertiary}>
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </Txt>
          {gain > 0 ? (
            <>
              <Dot />
              <Txt w="b" size={13} color={c.purple}>
                +{gain} pts tonight
              </Txt>
            </>
          ) : null}
        </Row>
      </Reveal>

      <Reveal index={1}>
        {/* slider rows — only coach-enabled questions (proto .rec-field list) */}
        <Card variant="low" style={{ marginTop: 16, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 18 }}>
          {questions.length === 0 ? (
            <View style={{ paddingVertical: 18 }}>
              <Txt w="sb" size={13} color={c.textTertiary} style={{ textAlign: 'center', lineHeight: 19 }}>
                Your coach has every check-in question turned off. Submitting still counts your check-in for the week.
              </Txt>
            </View>
          ) : (
            questions.map((q, i) => {
              const key = CI_KEYS[q.key];
              const val = s[key];
              const anchor = CI_ANCHORS[q.key];
              return (
                <View
                  key={q.key}
                  style={{
                    paddingTop: 15,
                    paddingBottom: 13,
                    borderBottomWidth: i === questions.length - 1 ? 0 : 1,
                    borderBottomColor: c.divider2,
                  }}
                >
                  <Row style={{ justifyContent: 'space-between', marginBottom: 3 }}>
                    <Txt w="eb" size={15} ls={-0.2}>
                      {anchor?.scale ?? q.label}
                    </Txt>
                    <View style={{ minWidth: 44, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, backgroundColor: c.purple + '26', alignItems: 'center' }}>
                      <Txt w="eb" num size={13} color={c.purple} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {val}/10
                      </Txt>
                    </View>
                  </Row>
                  <Slider value={val} min={1} max={10} onChange={(v) => s.setCi(key, v)} />
                  {anchor ? (
                    <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
                      <Txt w="b" size={11} color={c.textTertiary}>
                        {anchor.lo}
                      </Txt>
                      <Txt w="b" size={11} color={c.textTertiary}>
                        {anchor.hi}
                      </Txt>
                    </Row>
                  ) : null}
                </View>
              );
            })
          )}
        </Card>
        {/* the honest fine print: this signal is self-reported */}
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 8, paddingHorizontal: 2, lineHeight: 17 }}>
          Answers are self-reported. What you enter here becomes your Recovery score, so keep it honest.
        </Txt>
      </Reveal>

      {audience ? (
        <Reveal index={2}>
          {/* note row — display-only, matching the shipped CheckIn (no notes machinery
              exists yet, so no fake input that would silently drop what's typed) */}
          <Row style={{ marginTop: 14, borderWidth: 1, borderColor: c.hairline, borderRadius: 15, paddingVertical: 13, paddingHorizontal: 15, gap: 13 }}>
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plan" size={17} color={c.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="b" size={15}>
                Notes for {audience}
              </Txt>
              <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>
                Optional
              </Txt>
            </View>
          </Row>
        </Reveal>
      ) : null}

      <Reveal index={3}>
        {/* sidebox: what tonight is worth, from the real projection */}
        <Row style={{ marginTop: 14, padding: 15, borderRadius: 15, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.divider2, gap: 12, alignItems: 'flex-start' }}>
          <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: c.purple + '26', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="checkin" size={18} color={c.purple} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={13.5}>
              {gain > 0 ? `Worth +${gain} tonight → ${afterScore}` : `Refreshes Recovery (${recoveryPct}% of your score)`}
            </Txt>
            <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
              Takes 20 seconds. {audience ? `${cap(audience)} sees your readiness before tomorrow's practice.` : 'Saved to your record.'}
            </Txt>
          </View>
        </Row>
      </Reveal>

      <Reveal index={4}>
        {/* submit CTA — purple, recovery's semantic color (proto's p-accent button) */}
        <PressScale
          accessibilityLabel="Submit Check-In"
          haptic="success"
          onPress={onSubmit}
          style={[
            { marginTop: 18, height: 58, borderRadius: 18, backgroundColor: c.purple, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
            { ...shadow.ctaGreen, shadowColor: c.purple },
          ]}
        >
          <Icon name="check" size={19} color={c.white} strokeWidth={2.4} />
          <Txt w="eb" size={16} color={c.white} ls={-0.2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Submit Check-In
          </Txt>
        </PressScale>
        <Txt w="sb" size={12} color={c.textTertiary} style={{ textAlign: 'center', marginTop: 12 }}>
          {audience ? `${cap(audience)} can see your update` : 'Saved to your record'}
        </Txt>
      </Reveal>
    </ScrollView>
  );
}

/* ============================================================================
   Confirm state — proto recovery-confirm over real derived values.
   ============================================================================ */

function RecoveryConfirm({
  from,
  pad,
  audience,
  isReal,
}: {
  from: number;
  pad: { paddingTop: number; paddingHorizontal: number; paddingBottom: number };
  audience: string;
  isReal: boolean;
}) {
  const c = useColors();
  const s = useStore();
  const d = useDerived();

  // The move is real: `from` was captured just before submitCi, `to` is the live score.
  const to = d.athleteScore;
  const gain = to - from;
  const shown = useRiseTo(from, to);
  const toTier = tierFor(to);
  const promoted = gain > 0 && tierFor(from).name !== toTier.name;
  const chip = tierChip[toTier.short];

  // Day-complete check straight off the projection (its actions include everything
  // still controllable today; empty = every requirement is in).
  const dayDone = projectedScore(s).actions.length === 0;

  // Streak the same honest way Home reads it (today counts live once on standard).
  const streak = streakInfo(s.scoreHistory, d.athleteScore, {
    seedPad: !isReal,
    grace: isStreakGraceEnabled,
    today: isReal ? s.dateStamp : undefined,
  });

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={pad} showsVerticalScrollIndicator={false}>
      <Reveal index={0}>
        <View style={{ alignItems: 'center', paddingTop: 26 }}>
          {/* big check: halo + purple core ('checkin' is the app's recovery icon; no moon glyph) */}
          <View style={{ width: 108, height: 108, borderRadius: 54, backgroundColor: c.purple + '24', alignItems: 'center', justifyContent: 'center' }}>
            <View
              style={[
                { width: 76, height: 76, borderRadius: 38, backgroundColor: c.purple, alignItems: 'center', justifyContent: 'center' },
                { ...shadow.ctaGreen, shadowColor: c.purple },
              ]}
            >
              <Icon name="checkin" size={32} color={c.white} strokeWidth={2.2} />
            </View>
          </View>
          <Txt w="eb" size={26} ls={typeScale.title.ls} accessibilityRole="header" style={{ marginTop: 18 }}>
            Check-In Submitted
          </Txt>
          <Txt w="sb" size={13.5} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center' }}>
            Recovery refreshed{audience ? ` · ${cap(audience)} can see your readiness` : ' · Saved to your record'}
          </Txt>
        </View>
      </Reveal>

      <Reveal index={1}>
        <View style={{ alignItems: 'center' }}>
          {/* score move: from → to (counts up like the proto) */}
          <Row style={{ gap: 16, marginTop: 22, marginBottom: 4 }}>
            <Txt w="eb" num size={40} ls={-1.2} color={c.textTertiary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {from}
            </Txt>
            <Icon name="chevronRight" size={26} color={c.textTertiary} />
            <Txt w="eb" num size={56} ls={-2.2} color={gain >= 0 ? c.success : c.warningDeep} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {shown}
            </Txt>
          </Row>
          <Txt w="sb" size={13.5} color={c.textSecondary}>
            OnStandard Score · {gain > 0 ? `+${gain} pts` : gain < 0 ? `${gain} pts` : 'no change tonight'}
          </Txt>

          {promoted ? (
            <>
              <View style={{ marginTop: 16, paddingHorizontal: 18, paddingVertical: 7, borderRadius: 999, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border }}>
                <Txt w="eb" size={12.5} color={chip.fg} ls={1.4} upper maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {toTier.name}
                </Txt>
              </View>
              {toTier.short === 'g' && streak.days > 0 ? (
                <Txt w="sb" size={13.5} color={c.textSecondary} style={{ marginTop: 10, textAlign: 'center' }}>
                  You finished the day on standard. Day {streak.days} locks at midnight.
                </Txt>
              ) : null}
            </>
          ) : null}
        </View>
      </Reveal>

      {dayDone ? (
        <Reveal index={2}>
          {/* proto .day-done: every requirement is in */}
          <Row style={{ marginTop: 20, padding: 16, borderRadius: 22, backgroundColor: c.successTint, borderWidth: 1, borderColor: c.successBorderSoft, gap: 13 }}>
            <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={21} color={c.successDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="eb" size={15.5}>
                Every requirement is in.
              </Txt>
              <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 2 }}>
                This is what OnStandard looks like. Same again tomorrow.
              </Txt>
            </View>
          </Row>
        </Reveal>
      ) : null}

      <Reveal index={3}>
        <View style={{ height: 22 }} />
        <Btn label="Back Home" onPress={s.goHome} />
        <View style={{ height: 10 }} />
        <GhostBtn label="See the week" onPress={() => s.setTab('progress')} />
      </Reveal>
    </ScrollView>
  );
}

/* ============================================================================
   Presentational pieces (proto markup → RN).
   ============================================================================ */

/** Proto `.back-head`: bordered 40px back tile + title/sub column. Back → goHome. */
function BackHead({ title, sub, onBack }: { title: string; sub?: string; onBack: () => void }) {
  const c = useColors();
  return (
    <Row style={{ gap: 14, paddingTop: 6, paddingBottom: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Home"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 14,
          backgroundColor: c.card,
          borderWidth: 1,
          borderColor: c.hairline,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon name="chevronLeft" size={20} color={c.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Txt w="eb" size={20} ls={-0.5} accessibilityRole="header">
          {title}
        </Txt>
        {sub ? (
          <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 1 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
    </Row>
  );
}

/** Proto `.btn.ghost.sm`: flat surface button with a hairline border. */
function GhostBtn({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 48,
        borderRadius: 18,
        backgroundColor: c.bg2,
        borderWidth: 1,
        borderColor: c.hairline,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Txt w="b" size={15} color={c.text} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** The tiny dot separator in the quick-info line. */
function Dot() {
  const c = useColors();
  return <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: c.textTertiary }} />;
}

/** Count from `from` up to `to` with the proto's cubic ease-out (~860ms). */
function useRiseTo(from: number, to: number, steps = 24, intervalMs = 36): number {
  const [val, setVal] = React.useState(from);
  React.useEffect(() => {
    if (from === to) {
      setVal(to);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      const eased = 1 - Math.pow(1 - i / steps, 3);
      setVal(i >= steps ? to : Math.round(from + (to - from) * eased));
      if (i >= steps) clearInterval(id);
    }, intervalMs);
    return () => clearInterval(id);
  }, [from, to, steps, intervalMs]);
  return val;
}
