// AthleteOS — activation-first onboarding. The goal is the first moment of value
// (Starting Point Score -> first meal -> AI coaching), not account setup. One question
// per screen, tap-first, in-system premium. 7 roles personalize onto the 4 dashboards.
// See docs/specs/2026-06-23-onboarding-redesign.md.
import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import {
  formatHeight,
  flowForRole,
  GOAL_GROUPS,
  POSITION_MAP,
  PROTEIN_FREQ,
  ROLE_DEFS,
  SPORTS,
  TRAIN_FREQ,
  SUPPORT_OPTIONS,
} from '@/core';
import type { Role } from '@/core';
import { useStore } from '@/store';
import type { Store } from '@/store';
import { colors } from '@/ui/tokens';
import { Btn, Card, Input, ProgressBar, Row, Stepper, Txt, Pressable } from '@/ui/primitives';
import { Slider } from '@/ui/Slider';
import { haptics } from '@/ui/haptics';
import { Icon, type IconName } from '@/icons';
import { LogoMark } from '@/brand/Logo';
import { ROLE_FLOWS, type GenStep } from './flows';
import { ScoreReveal } from './ScoreReveal';

/* ------------------------------------------------------------------ shared shell */
function StepShell({
  progress,
  onBack,
  eyebrow,
  title,
  sub,
  children,
  footer,
}: {
  progress: number | null;
  onBack?: () => void;
  eyebrow?: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: 60, paddingHorizontal: 24 }}>
        <Row style={{ gap: 14, height: 40 }}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              onPress={() => {
                haptics.tap();
                onBack();
              }}
              style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 13, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
            >
              <Icon name="chevronLeft" size={22} color={colors.slate600} />
            </Pressable>
          ) : (
            <View style={{ width: 40, height: 40 }} />
          )}
          {progress != null ? (
            <View style={{ flex: 1 }}>
              <ProgressBar pct={progress * 100} height={6} />
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}
        </Row>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 22, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {eyebrow ? (
          <Txt w="eb" size={12} color={colors.accent} ls={1} upper style={{ marginBottom: 10 }}>
            {eyebrow}
          </Txt>
        ) : null}
        <Txt w="eb" size={28} ls={-0.8} style={{ lineHeight: 32 }}>
          {title}
        </Txt>
        {sub ? (
          <Txt w="m" size={15} color={colors.textSecondary} style={{ marginTop: 8, lineHeight: 21 }}>
            {sub}
          </Txt>
        ) : null}
        <View style={{ marginTop: 24 }}>{children}</View>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingBottom: 34, paddingTop: 6 }}>{footer}</View>
    </View>
  );
}

/** Big tappable option row — the primary answer affordance. */
function OptionRow({ label, selected, onPress, sub }: { label: string; selected: boolean; onPress: () => void; sub?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => ({
        backgroundColor: selected ? colors.accentSurface : colors.card,
        borderWidth: 1.5,
        borderColor: selected ? colors.accent : colors.border,
        borderRadius: 16,
        paddingVertical: 17,
        paddingHorizontal: 18,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <Txt w="b" size={16} color={selected ? colors.accent : colors.text}>
          {label}
        </Txt>
        {sub ? (
          <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 2 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? colors.accent : '#CBD5E1', backgroundColor: selected ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <Icon name="check" size={13} color="#fff" /> : null}
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ welcome */
function Welcome() {
  const { athleteName, setName, obNext, startSignin } = useStore();
  const ready = athleteName.trim().length > 1;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingTop: 76, paddingHorizontal: 26, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <Row style={{ gap: 10 }}>
          <LogoMark size={30} />
          <Txt w="eb" size={20} ls={-0.4}>
            Athlete<Txt w="eb" size={20} color={colors.accent}>OS</Txt>
          </Txt>
        </Row>
        <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 28 }}>
          <Txt w="eb" size={38} ls={-1.4} style={{ lineHeight: 42 }}>
            Let's build your{'\n'}nutrition routine.
          </Txt>
          <Txt w="m" size={16} color={colors.textSecondary} style={{ marginTop: 14, lineHeight: 23 }}>
            A few quick questions, your Starting Point Score, and your first AI coaching moment. Under five minutes.
          </Txt>
          <Txt w="eb" size={12} color={colors.textTertiary} ls={0.8} upper style={{ marginTop: 32, marginBottom: 9 }}>
            First, what should we call you?
          </Txt>
          <Input value={athleteName} onChangeText={setName} placeholder="First name" autoCapitalize="words" returnKeyType="done" />
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 26, paddingBottom: 34, gap: 14 }}>
        <Btn label="Get started" disabled={!ready} onPress={obNext} />
        <Pressable accessibilityRole="button" accessibilityLabel="Sign in" hitSlop={8} onPress={() => { haptics.tap(); startSignin(); }} style={({ pressed }) => ({ alignSelf: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Txt w="b" size={14} color={colors.textSecondary}>
            Already have an account? <Txt w="b" size={14} color={colors.accent}>Sign in</Txt>
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

function SignIn() {
  const { exitSignin, signinDone } = useStore();
  return (
    <StepShell
      progress={null}
      onBack={exitSignin}
      title="Welcome back"
      sub="Pick up right where you left off."
      footer={<Btn label="Sign in" onPress={signinDone} />}
    >
      <View style={{ gap: 12 }}>
        <Input placeholder="Email address" autoCapitalize="none" keyboardType="email-address" />
        <Input placeholder="Password" secureTextEntry />
      </View>
    </StepShell>
  );
}

/* ------------------------------------------------------------------ role picker */
function RolePicker() {
  const { role, setRole, obNext, obBack } = useStore();
  return (
    <StepShell
      progress={null}
      onBack={obBack}
      eyebrow="Who are you?"
      title="How will you use AthleteOS?"
      sub="We tailor everything to this: your plan, your dashboard, your language."
      footer={<Btn label="Continue" disabled={!role} onPress={obNext} />}
    >
      {ROLE_DEFS.map((r) => {
        const selected = role === r.key;
        return (
          <Pressable
            key={r.key}
            accessibilityRole="button"
            accessibilityLabel={r.title}
            accessibilityState={{ selected }}
            onPress={() => {
              haptics.select();
              setRole(r.key);
            }}
            style={({ pressed }) => ({
              backgroundColor: selected ? colors.accentSurface : colors.card,
              borderWidth: 1.5,
              borderColor: selected ? colors.accent : colors.border,
              borderRadius: 16,
              padding: 15,
              marginBottom: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              opacity: pressed ? 0.92 : 1,
            })}
          >
            <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: selected ? colors.accent : colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={r.icon as IconName} size={21} color={selected ? '#fff' : colors.slate600} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="b" size={16} color={selected ? colors.accent : colors.text}>
                {r.title}
              </Txt>
              <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 1 }}>
                {r.sub}
              </Txt>
            </View>
          </Pressable>
        );
      })}
    </StepShell>
  );
}

/* ------------------------------------------------------------------ athlete flow */
const ATHLETE_KEYS = [
  'goal', 'sport', 'position', 'profile', 'frequency', 'support',
  'b_conf', 'b_protein', 'b_consistency', 'b_meals', 'b_water', 'b_sleep',
  'score', 'challenge',
] as const;

function AthleteFlow() {
  const s = useStore();
  const idx = s.obStep - 2;
  const key = ATHLETE_KEYS[idx] ?? 'challenge';
  const progress = (idx + 1) / ATHLETE_KEYS.length;

  // Compute the Starting Point Score the moment we land on the reveal.
  useEffect(() => {
    if (key === 'score' && s.startScore == null) s.commitStartingScore();
  }, [key, s.startScore]); // eslint-disable-line react-hooks/exhaustive-deps

  const cont = (canContinue: boolean, label = 'Continue') => (
    <Btn label={label} disabled={!canContinue} onPress={s.obNext} />
  );

  switch (key) {
    case 'goal':
      return (
        <StepShell progress={progress} onBack={s.obBack} eyebrow="Your plan" title="What's your #1 goal right now?" sub="This shapes every piece of AI coaching you'll get." footer={cont(!!s.primaryGoal)}>
          {GOAL_GROUPS.map((g) => (
            <View key={g.group} style={{ marginBottom: 18 }}>
              <Txt w="eb" size={12} color={colors.textTertiary} ls={0.6} upper style={{ marginBottom: 10 }}>
                {g.group}
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
                {g.options.map((o) => {
                  const sel = s.primaryGoal === o.key;
                  return (
                    <Pressable
                      key={o.key}
                      accessibilityRole="button"
                      accessibilityLabel={o.label}
                      accessibilityState={{ selected: sel }}
                      onPress={() => { haptics.select(); s.setPrimaryGoal(o.key); }}
                      style={({ pressed }) => ({ backgroundColor: sel ? colors.accent : colors.card, borderWidth: 1.5, borderColor: sel ? colors.accent : colors.border, borderRadius: 13, paddingVertical: 12, paddingHorizontal: 15, opacity: pressed ? 0.9 : 1 })}
                    >
                      <Txt w="b" size={14} color={sel ? '#fff' : colors.slate700}>
                        {o.label}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </StepShell>
      );

    case 'sport':
      return (
        <StepShell progress={progress} onBack={s.obBack} title="What sport do you play?" footer={cont(!!s.sport)}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {[...SPORTS, 'Other'].map((sp) => {
              const sel = s.sport === sp;
              return (
                <Pressable
                  key={sp}
                  accessibilityRole="button"
                  accessibilityLabel={sp}
                  accessibilityState={{ selected: sel }}
                  onPress={() => { haptics.select(); s.setSport(sp); }}
                  style={({ pressed }) => ({ width: '31.5%', backgroundColor: sel ? colors.accent : colors.card, borderWidth: 1.5, borderColor: sel ? colors.accent : colors.border, borderRadius: 14, paddingVertical: 18, alignItems: 'center', opacity: pressed ? 0.9 : 1 })}
                >
                  <Txt w="b" size={14} color={sel ? '#fff' : colors.slate700}>
                    {sp}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </StepShell>
      );

    case 'position': {
      const positions = (s.sport && POSITION_MAP[s.sport]) || POSITION_MAP.default;
      return (
        <StepShell progress={progress} onBack={s.obBack} title="What position?" sub="So your recommendations fit your role on the field." footer={<Btn label={s.position ? 'Continue' : 'Skip'} onPress={s.obNext} />}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {positions.map((p) => {
              const sel = s.position === p;
              return (
                <Pressable
                  key={p}
                  accessibilityRole="button"
                  accessibilityLabel={p}
                  accessibilityState={{ selected: sel }}
                  onPress={() => { haptics.select(); s.setPosition(p); }}
                  style={({ pressed }) => ({ backgroundColor: sel ? colors.accent : colors.card, borderWidth: 1.5, borderColor: sel ? colors.accent : colors.border, borderRadius: 13, paddingVertical: 13, paddingHorizontal: 18, opacity: pressed ? 0.9 : 1 })}
                >
                  <Txt w="b" size={15} color={sel ? '#fff' : colors.slate700}>
                    {p}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </StepShell>
      );
    }

    case 'profile':
      return (
        <StepShell progress={progress} onBack={s.obBack} title="Your physical profile" sub="Tap to adjust. This calibrates your targets." footer={cont(true)}>
          <View style={{ gap: 14 }}>
            <Row style={{ gap: 12 }}>
              <Stepper label="Age" value={String(s.baseAge)} unit="years" onDec={() => s.ageStep(-1)} onInc={() => s.ageStep(1)} />
              <Stepper label="Height" value={formatHeight(s.baseHeight)} onDec={() => s.hStep(-1)} onInc={() => s.hStep(1)} />
            </Row>
            <Row style={{ gap: 12 }}>
              <Stepper label="Weight" value={String(s.baseWeight)} unit="lb" onDec={() => s.bwStep(-1)} onInc={() => s.bwStep(1)} />
              <Stepper label="Target weight" value={String(s.weightTarget)} unit="lb" onDec={() => s.adjustWeightTarget(-1)} onInc={() => s.adjustWeightTarget(1)} />
            </Row>
          </View>
        </StepShell>
      );

    case 'frequency':
      return (
        <StepShell progress={progress} onBack={s.obBack} title="How often do you train?" footer={cont(!!s.trainingFreq)}>
          {TRAIN_FREQ.map((o) => (
            <OptionRow key={o.key} label={o.label} selected={s.trainingFreq === o.key} onPress={() => s.setTrainingFreq(o.key)} />
          ))}
        </StepShell>
      );

    case 'support':
      return (
        <StepShell progress={progress} onBack={s.obBack} title="Who's on your team?" sub="Connect coaches, trainers, or family so the right people can see your work." footer={cont(true)}>
          {SUPPORT_OPTIONS.map((o) => (
            <OptionRow key={o.key} label={o.label} selected={s.supportTeam.includes(o.key)} onPress={() => s.toggleSupport(o.key)} />
          ))}
          <OptionRow label="Just me for now" selected={s.supportTeam.length === 0} onPress={() => s.toggleSupport('none')} />
          {s.supportTeam.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <Txt w="eb" size={11} color={colors.textTertiary} ls={0.6} upper style={{ marginBottom: 8 }}>
                Have an invite code? (optional)
              </Txt>
              <Input value={s.inviteCode} onChangeText={s.setInviteCode} placeholder="Enter code" autoCapitalize="characters" />
            </View>
          ) : null}
        </StepShell>
      );

    case 'b_conf':
      return (
        <ScaleStep
          progress={progress}
          onBack={s.obBack}
          title="How confident are you in your nutrition?"
          value={s.baseNutritionConfidence}
          low="Not at all"
          high="Dialed in"
          onChange={(v) => s.setBaseAnswer('baseNutritionConfidence', v)}
          onContinue={s.obNext}
        />
      );

    case 'b_protein':
      return (
        <StepShell progress={progress} onBack={s.obBack} eyebrow="Baseline" title="How often do you hit your protein target?" footer={cont(true)}>
          {PROTEIN_FREQ.map((o) => (
            <OptionRow key={o.key} label={o.label} selected={s.baseProteinFreq === Number(o.key)} onPress={() => s.setBaseAnswer('baseProteinFreq', Number(o.key))} />
          ))}
        </StepShell>
      );

    case 'b_consistency':
      return (
        <ScaleStep
          progress={progress}
          onBack={s.obBack}
          title="How consistent are you, week to week?"
          value={s.baseConsistency}
          low="All over"
          high="Locked in"
          onChange={(v) => s.setBaseAnswer('baseConsistency', v)}
          onContinue={s.obNext}
        />
      );

    case 'b_meals':
      return (
        <CounterStep
          progress={progress}
          onBack={s.obBack}
          title="How many meals a day, typically?"
          value={s.baseMealsPerDay}
          unit="meals / day"
          fmt={(v) => String(v)}
          onDec={() => s.setBaseAnswer('baseMealsPerDay', Math.max(2, s.baseMealsPerDay - 1))}
          onInc={() => s.setBaseAnswer('baseMealsPerDay', Math.min(6, s.baseMealsPerDay + 1))}
          onContinue={s.obNext}
        />
      );

    case 'b_water':
      return (
        <CounterStep
          progress={progress}
          onBack={s.obBack}
          title="How much water do you drink daily?"
          value={s.baseWaterL}
          unit="liters / day"
          fmt={(v) => v.toFixed(1)}
          onDec={() => s.setBaseAnswer('baseWaterL', Math.max(0, +(s.baseWaterL - 0.5).toFixed(1)))}
          onInc={() => s.setBaseAnswer('baseWaterL', Math.min(5, +(s.baseWaterL + 0.5).toFixed(1)))}
          onContinue={s.obNext}
        />
      );

    case 'b_sleep':
      return (
        <CounterStep
          progress={progress}
          onBack={s.obBack}
          title="How many hours of sleep, on average?"
          value={s.baseSleepH}
          unit="hours / night"
          fmt={(v) => v.toFixed(1)}
          onDec={() => s.setBaseAnswer('baseSleepH', Math.max(4, +(s.baseSleepH - 0.5).toFixed(1)))}
          onInc={() => s.setBaseAnswer('baseSleepH', Math.min(10, +(s.baseSleepH + 0.5).toFixed(1)))}
          onContinue={s.obNext}
        />
      );

    case 'score': {
      const score = s.startScore ?? 0;
      const name = s.athleteName.trim();
      return (
        <StepShell
          progress={progress}
          onBack={s.obBack}
          eyebrow="Your Starting Point Score"
          title={name ? `${name}, here's where you stand.` : "Here's where you stand."}
          sub="This is your starting point, estimated from your habits. It rises as AthleteOS learns from what you actually do."
          footer={<Btn label="See today's challenge" onPress={s.obNext} />}
        >
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <ScoreReveal score={score} />
          </View>
        </StepShell>
      );
    }

    case 'challenge':
    default:
      return (
        <StepShell
          progress={progress}
          onBack={s.obBack}
          eyebrow="Today's challenge"
          title="Upload your first meal"
          sub="One photo. Your AI nutrition coach reads it, scores it, and shows you exactly what to do next, instantly."
          footer={<Btn label="Start now" haptic="success" onPress={s.startFirstMealChallenge} />}
        >
          <Card style={{ alignItems: 'center', paddingVertical: 34, marginTop: 6 }} elevated>
            <View style={{ width: 86, height: 86, borderRadius: 28, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="camera" size={38} color={colors.accent} />
            </View>
            <Txt w="eb" size={17} style={{ marginTop: 16 }}>
              +3 to your score
            </Txt>
            <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 4, textAlign: 'center', paddingHorizontal: 20 }}>
              Logging your first meal proves the loop. Your score moves the moment you do the work.
            </Txt>
          </Card>
        </StepShell>
      );
  }
}

/** 1-10 slider step (baseline confidence / consistency). */
function ScaleStep({
  progress, onBack, title, value, low, high, onChange, onContinue,
}: {
  progress: number; onBack: () => void; title: string; value: number; low: string; high: string; onChange: (v: number) => void; onContinue: () => void;
}) {
  return (
    <StepShell progress={progress} onBack={onBack} eyebrow="Baseline" title={title} footer={<Btn label="Continue" onPress={onContinue} />}>
      <View style={{ alignItems: 'center', marginBottom: 22 }}>
        <Txt w="eb" size={56} ls={-2} color={colors.accent}>
          {value}
        </Txt>
        <Txt w="sb" size={13} color={colors.textTertiary}>
          out of 10
        </Txt>
      </View>
      <Slider value={value} min={1} max={10} onChange={onChange} />
      <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
        <Txt w="sb" size={12} color={colors.textTertiary}>{low}</Txt>
        <Txt w="sb" size={12} color={colors.textTertiary}>{high}</Txt>
      </Row>
    </StepShell>
  );
}

/** ± counter step (meals / water / sleep). */
function CounterStep({
  progress, onBack, title, value, unit, fmt, onDec, onInc, onContinue,
}: {
  progress: number; onBack: () => void; title: string; value: number; unit: string; fmt: (v: number) => string; onDec: () => void; onInc: () => void; onContinue: () => void;
}) {
  return (
    <StepShell progress={progress} onBack={onBack} eyebrow="Baseline" title={title} footer={<Btn label="Continue" onPress={onContinue} />}>
      <View style={{ alignItems: 'center' }}>
        <Row style={{ gap: 18 }}>
          <RoundStep glyph="−" onPress={onDec} />
          <View style={{ alignItems: 'center', minWidth: 110 }}>
            <Txt w="eb" size={52} ls={-2}>
              {fmt(value)}
            </Txt>
          </View>
          <RoundStep glyph="+" onPress={onInc} />
        </Row>
        <Txt w="sb" size={13} color={colors.textTertiary} style={{ marginTop: 10 }}>
          {unit}
        </Txt>
      </View>
    </StepShell>
  );
}

function RoundStep({ glyph, onPress }: { glyph: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? 'Increase' : 'Decrease'}
      hitSlop={8}
      onPress={() => { haptics.select(); onPress(); }}
      style={({ pressed }) => ({ width: 60, height: 60, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
    >
      <Txt w="b" size={30} color={colors.accent}>
        {glyph}
      </Txt>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ generic (non-athlete) flow */
function GenericFlow() {
  const s = useStore();
  const role = (s.role ?? 'athlete') as Role;
  const flow = ROLE_FLOWS[role] ?? [];
  const idx = s.obStep - 2;
  const step = flow[idx] as GenStep | undefined;

  if (!step) {
    // Past the defined flow — route to the personalized dashboard.
    s.finishOb();
    return null;
  }
  const progress = (idx + 1) / flow.length;
  return <GenericStep step={step} progress={progress} />;
}

function GenericStep({ step, progress }: { step: GenStep; progress: number }) {
  const s = useStore();
  const val = step.kind !== 'invite' ? s.obMeta[step.field] : undefined;

  if (step.kind === 'invite') {
    return (
      <StepShell
        progress={progress}
        onBack={s.obBack}
        eyebrow="Activate"
        title={step.title}
        sub={step.sub}
        footer={<Btn label={step.cta} haptic="success" onPress={s.finishOb} />}
      >
        <Card style={{ marginTop: 6 }} elevated>
          <Txt w="eb" size={11} color={colors.textTertiary} ls={0.6} upper>
            {step.codeLabel}
          </Txt>
          <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <Txt w="eb" size={26} ls={1}>
              EAGLES24
            </Txt>
            <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="copy" size={19} color={colors.accent} />
            </View>
          </Row>
        </Card>
        <Pressable accessibilityRole="button" accessibilityLabel="Skip for now" hitSlop={8} onPress={() => { haptics.tap(); s.finishOb(); }} style={({ pressed }) => ({ alignSelf: 'center', marginTop: 18, opacity: pressed ? 0.6 : 1 })}>
          <Txt w="b" size={14} color={colors.textSecondary}>
            Skip for now
          </Txt>
        </Pressable>
      </StepShell>
    );
  }

  if (step.kind === 'text') {
    const cur = typeof val === 'string' ? val : '';
    return (
      <StepShell progress={progress} onBack={s.obBack} title={step.title} sub={step.sub} footer={<Btn label="Continue" disabled={cur.trim().length < 1} onPress={s.obNext} />}>
        <Input value={cur} onChangeText={(v) => s.setObMeta(step.field, v)} placeholder={step.placeholder} autoCapitalize="words" />
      </StepShell>
    );
  }

  if (step.kind === 'multiselect') {
    const arr = Array.isArray(val) ? val : [];
    return (
      <StepShell progress={progress} onBack={s.obBack} title={step.title} sub={step.sub} footer={<Btn label="Continue" disabled={arr.length < 1} onPress={s.obNext} />}>
        {step.options.map((o) => (
          <OptionRow key={o.key} label={o.label} selected={arr.includes(o.key)} onPress={() => s.toggleObMetaItem(step.field, o.key)} />
        ))}
      </StepShell>
    );
  }

  // select
  return (
    <StepShell progress={progress} onBack={s.obBack} title={step.title} sub={step.sub} footer={<Btn label="Continue" disabled={!val} onPress={s.obNext} />}>
      {step.options.map((o) => (
        <OptionRow key={o.key} label={o.label} selected={val === o.key} onPress={() => s.setObMeta(step.field, o.key)} />
      ))}
    </StepShell>
  );
}

/* ------------------------------------------------------------------ entry */
export function Onboarding() {
  const signinMode = useStore((s: Store) => s.signinMode);
  const obStep = useStore((s: Store) => s.obStep);
  const role = useStore((s: Store) => s.role);

  if (signinMode) return <SignIn />;
  if (obStep === 0) return <Welcome />;
  if (obStep === 1) return <RolePicker />;
  return flowForRole(role) === 'app' && (role === 'athlete' || role == null) ? <AthleteFlow /> : <GenericFlow />;
}
