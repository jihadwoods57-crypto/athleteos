// AthleteOS — onboarding flow. Welcome → role → role-specific steps → success.
// Ported from AthleteOS.dc.html onboarding block.
import React from 'react';
import { ScrollView, View } from 'react-native';
import {
  ATHLETE_GOALS,
  BASE_GOAL_CHIPS,
  CHECKIN_QUESTIONS,
  COMP_MODES,
  INVITE_DATA,
  LEVELS,
  ONBOARDING_SEQS,
  PARENT_FOCUS,
  POSITION_MAP,
  SPORTS,
  TRACK_DATA,
  accountStepValid,
  baselineRec,
  displayWeight,
  formatHeight,
  isValidEmail,
  weightStepLb,
  weightUnit,
} from '@/core';
import { useStore } from '@/store';
import { colors, font, radius, shadow } from '@/ui/tokens';
import { Btn, Chip, Card, Input, Pill, Row, Toggle, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { LogoMark } from '@/brand/Logo';

function StepHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Pressable
        onPress={onBack}
        style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="chevronLeft" size={22} color={colors.slate600} />
      </Pressable>
      {label ? (
        <Txt w="b" size={13} color={colors.textTertiary}>
          {label}
        </Txt>
      ) : (
        <View />
      )}
    </Row>
  );
}

function Title({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <View style={{ marginTop: 24 }}>
      <Txt w="eb" size={30} ls={-0.9} style={{ lineHeight: 33 }}>
        {children}
      </Txt>
      {sub ? (
        <Txt w="m" size={15} color={colors.textSecondary} style={{ marginTop: 8 }}>
          {sub}
        </Txt>
      ) : null}
    </View>
  );
}

export function Onboarding() {
  const s = useStore();
  const obRole = s.role ?? 'athlete';
  const seq = ONBOARDING_SEQS[obRole];

  let screen: string;
  if (s.signinMode) screen = 'signin';
  else if (s.obStep === 0) screen = 'welcome';
  else if (s.obStep === 1) screen = 'role';
  else screen = seq[s.obStep - 2] ?? 'success';

  const pIdx = s.obStep - 2;
  const inPersona = screen !== 'welcome' && screen !== 'role' && screen !== 'signin';
  const stepLabel = inPersona ? `Step ${pIdx + 1} of ${seq.length}` : '';

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: 64, paddingHorizontal: 24, paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
      >
        {screen === 'welcome' && <Welcome />}
        {screen === 'signin' && <SignIn />}
        {screen === 'role' && <RolePicker />}
        {screen === 'account' && <AccountStep label={stepLabel} />}
        {screen === 'level' && <LevelStep label={stepLabel} />}
        {screen === 'sport' && <SportStep label={stepLabel} />}
        {screen === 'baseline' && <BaselineStep label={stepLabel} />}
        {screen === 'connect' && <ConnectStep label={stepLabel} />}
        {screen === 'link' && <LinkStep label={stepLabel} />}
        {screen === 'focus' && <FocusStep label={stepLabel} />}
        {screen === 'team' && <TeamStep label={stepLabel} />}
        {screen === 'roster' && <RosterStep label={stepLabel} />}
        {screen === 'track' && <TrackStep label={stepLabel} />}
        {screen === 'practice' && <PracticeStep label={stepLabel} />}
        {screen === 'clients' && <ClientsStep label={stepLabel} />}
        {screen === 'success' && <Success role={obRole} />}
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ Welcome */
function Welcome() {
  const { obNext, startSignin } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <Row style={{ gap: 9, marginTop: 6 }}>
        <View style={{ width: 30, height: 30, borderRadius: 9, overflow: 'hidden' }}>
          <LogoMark size={30} />
        </View>
        <Txt w="eb" size={17} ls={-0.34}>
          Athlete<Txt w="eb" size={17} color={colors.accent}>OS</Txt>
        </Txt>
      </Row>

      <View style={{ marginTop: 'auto' }}>
        <Txt w="eb" size={42} ls={-1.5} style={{ lineHeight: 44 }}>
          The accountability platform for <Txt w="eb" size={42} color={colors.accent} ls={-1.5}>serious athletes.</Txt>
        </Txt>
        <Txt w="m" size={17} color={colors.textSecondary} style={{ marginTop: 18, lineHeight: 25, maxWidth: 310 }}>
          Nutrition, recovery, and habits — measured every day, visible to the people helping you win.
        </Txt>
      </View>

      <View style={{ gap: 14, marginVertical: 34 }}>
        <FeatureRow icon="camera" text="AI meal analysis in one tap" />
        <FeatureRow icon="bolt" text="A daily Athlete Score that means something" />
        <FeatureRow icon="squad" text="Coach & parent visibility, built in" />
      </View>

      <Btn label="Create account" onPress={obNext} />
      <Row style={{ justifyContent: 'center', marginTop: 16 }}>
        <Txt w="m" size={14} color={colors.textTertiary}>
          Already have one?{' '}
        </Txt>
        <Pressable onPress={startSignin}>
          <Txt w="b" size={14} color={colors.accent}>
            Sign in
          </Txt>
        </Pressable>
      </Row>
    </View>
  );
}

function FeatureRow({ icon, text }: { icon: any; text: string }) {
  return (
    <Row style={{ gap: 13 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={colors.accent} />
      </View>
      <Txt w="sb" size={15} color={colors.slate700} style={{ flex: 1 }}>
        {text}
      </Txt>
    </Row>
  );
}

/* ------------------------------------------------------------------ Sign in */
function SignIn() {
  const { exitSignin, signinDone, athleteEmail, setEmail } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label="Sign in" onBack={exitSignin} />
      <Title sub="Pick up right where you left off.">Welcome back</Title>
      <View style={{ gap: 12, marginTop: 24 }}>
        <Input value={athleteEmail} onChangeText={setEmail} placeholder="Email address" autoCapitalize="none" keyboardType="email-address" />
        <Input value="password" secureTextEntry placeholder="Password" />
        <Txt w="b" size={13} color={colors.accent} style={{ textAlign: 'right' }}>
          Forgot password?
        </Txt>
      </View>
      <View style={{ marginTop: 'auto' }}>
        <Btn label="Sign in" onPress={signinDone} />
        <Row style={{ justifyContent: 'center', marginTop: 16 }}>
          <Txt w="m" size={14} color={colors.textTertiary}>
            New here?{' '}
          </Txt>
          <Pressable onPress={exitSignin}>
            <Txt w="b" size={14} color={colors.accent}>
              Create an account
            </Txt>
          </Pressable>
        </Row>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------- Role picker */
const ROLE_INFO: { key: 'athlete' | 'parent' | 'coach' | 'trainer'; icon: any; title: string; sub: string }[] = [
  { key: 'athlete', icon: 'bolt', title: 'Athlete', sub: 'Track meals, score & habits' },
  { key: 'parent', icon: 'user', title: 'Parent', sub: "Follow your athlete's progress" },
  { key: 'coach', icon: 'checkin', title: 'Coach', sub: 'Manage a team & leaderboards' },
  { key: 'trainer', icon: 'plan', title: 'Trainer', sub: 'Coach clients beyond sessions' },
];

function RolePicker() {
  const { role, setRole, obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label="Choose your role" onBack={obBack} />
      <Title sub="Pick the role that fits you — we'll tailor the rest.">How will you use AthleteOS?</Title>
      <View style={{ gap: 11, marginTop: 24 }}>
        {ROLE_INFO.map((r) => {
          const sel = role === r.key;
          return (
            <Pressable
              key={r.key}
              onPress={() => setRole(r.key)}
              style={[
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 15,
                  padding: 18,
                  borderRadius: 18,
                  backgroundColor: sel ? colors.accentSurface : colors.card,
                  borderWidth: 2,
                  borderColor: sel ? colors.accent : 'transparent',
                },
                sel ? undefined : shadow.card,
              ]}
            >
              <View style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: sel ? '#fff' : colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={r.icon} size={23} color={sel ? colors.accent : colors.textTertiary} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt w="b" size={16}>
                  {r.title}
                </Txt>
                <Txt w="m" size={13} color={colors.textSecondary}>
                  {r.sub}
                </Txt>
              </View>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 2,
                  borderColor: sel ? colors.accent : '#CBD5E1',
                  backgroundColor: sel ? colors.accent : '#fff',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {sel ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <Btn label="Continue" onPress={obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

/* ----------------------------------------------------------------- Account */
function AccountStep({ label }: { label: string }) {
  const { athleteName, athleteEmail, setName, setEmail, obNext, obBack } = useStore();
  // Gate Continue until both fields are sane; show the email hint only once the
  // athlete has typed something invalid (never nag an empty, untouched field).
  const emailInvalid = athleteEmail.trim().length > 0 && !isValidEmail(athleteEmail);
  const canContinue = accountStepValid(athleteName, athleteEmail);
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="This sets up your profile and login.">Create your account</Title>
      <View style={{ gap: 14, marginTop: 24 }}>
        <Field label="FULL NAME">
          <Input value={athleteName} onChangeText={setName} placeholder="e.g. Jihad Carter" />
        </Field>
        <Field label="EMAIL">
          <Input value={athleteEmail} onChangeText={setEmail} placeholder="you@email.com" autoCapitalize="none" keyboardType="email-address" />
          {emailInvalid ? (
            <Txt w="sb" size={12} color={colors.alert} style={{ marginTop: 6, marginLeft: 4 }}>
              Enter a valid email address
            </Txt>
          ) : null}
        </Field>
      </View>
      <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 14, paddingHorizontal: 4, lineHeight: 17 }}>
        By continuing you agree to the AthleteOS Terms & Privacy Policy. Athletes under 13 need a parent to create the account.
      </Txt>
      <Btn label="Continue" onPress={obNext} disabled={!canContinue} style={{ marginTop: 'auto' }} />
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Txt w="b" size={12} color={colors.textTertiary} style={{ marginBottom: 7, marginLeft: 4 }}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------- Level */
function LevelStep({ label }: { label: string }) {
  const { level, setLevel, obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="We tailor targets, templates, and norms to your level.">What level do you compete at?</Title>
      <View style={{ gap: 11, marginTop: 24 }}>
        {LEVELS.map((l) => (
          <Pressable
            key={l}
            onPress={() => setLevel(l)}
            style={[
              {
                padding: 18,
                borderRadius: 16,
                backgroundColor: level === l ? colors.accent : colors.card,
                borderWidth: 2,
                borderColor: level === l ? colors.accent : 'transparent',
              },
              level === l ? undefined : shadow.card,
            ]}
          >
            <Txt w="b" size={16} color={level === l ? '#fff' : colors.text}>
              {l}
            </Txt>
          </Pressable>
        ))}
      </View>
      <Btn label="Continue" onPress={obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

/* ------------------------------------------------------------------- Sport */
function SportStep({ label }: { label: string }) {
  const { sport, position, setSport, setPosition, obNext, obBack } = useStore();
  const positions = POSITION_MAP[sport ?? ''] ?? POSITION_MAP.default;
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="We'll tailor your targets and templates.">What's your sport?</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginTop: 22 }}>
        {SPORTS.map((name) => {
          const active = sport === name;
          return (
            <Pressable
              key={name}
              onPress={() => setSport(name)}
              style={[
                {
                  width: '47.5%',
                  height: 62,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? colors.accent : colors.card,
                  borderWidth: 2,
                  borderColor: active ? colors.accent : 'transparent',
                },
                active ? shadow.cta : shadow.card,
              ]}
            >
              <Txt w="b" size={15} color={active ? '#fff' : colors.text}>
                {name}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      {sport ? (
        <>
          <Txt w="b" size={14} style={{ marginTop: 24, marginBottom: 12 }}>
            Select your position
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {positions.map((p) => (
              <Chip key={p} label={p} active={position === p} onPress={() => setPosition(p)} />
            ))}
          </View>
        </>
      ) : null}
      <Btn label="Continue" onPress={obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

/* ---------------------------------------------------------------- Baseline */
function BaselineStep({ label }: { label: string }) {
  const s = useStore();
  const rec = baselineRec(s.baseWeight, s.baseGoal);
  const units = s.units ?? 'imperial';
  const wStepLb = weightStepLb(units);
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={s.obBack} />
      <Title sub="We'll set smart targets — your coach can fine-tune them.">Your baseline</Title>
      <Row style={{ gap: 10, marginTop: 22, alignItems: 'stretch' }}>
        <BaseTile label="HEIGHT" value={formatHeight(s.baseHeight)} onDec={() => s.hStep(-1)} onInc={() => s.hStep(1)} />
        <BaseTile label="WEIGHT" value={`${displayWeight(s.baseWeight, units)}`} unit={weightUnit(units)} onDec={() => s.bwStep(-wStepLb)} onInc={() => s.bwStep(wStepLb)} />
        <BaseTile label="AGE" value={`${s.baseAge}`} onDec={() => s.ageStep(-1)} onInc={() => s.ageStep(1)} />
      </Row>
      <Txt w="b" size={14} style={{ marginTop: 24, marginBottom: 12 }}>
        What's the goal?
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
        {BASE_GOAL_CHIPS.map((g) => (
          <Chip key={g.key} label={g.label} active={s.baseGoal === g.key} onPress={() => s.setBaseGoal(g.key)} />
        ))}
      </View>
      <View style={{ marginTop: 22, borderRadius: 20, padding: 18, backgroundColor: colors.accentSurface, borderWidth: 1, borderColor: colors.accentBorder }}>
        <Row style={{ gap: 8 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent }} />
          <Txt w="eb" size={11} color={colors.accent} ls={1.1}>
            AI RECOMMENDATION
          </Txt>
        </Row>
        <Row style={{ justifyContent: 'space-between', marginTop: 15 }}>
          <RecStat value={`${rec.recProtein}g`} label="Protein/day" />
          <RecStat value={rec.recCalStr} label="Calories" />
          <RecStat value={rec.recChange} label="12-wk goal" color={rec.recChangeColor} />
        </Row>
        <Txt w="m" size={12} color={colors.slate600} style={{ marginTop: 13, lineHeight: 17 }}>
          Tuned to your build & goal. Your coach or nutritionist can override these anytime.
        </Txt>
      </View>
      <Btn label="Continue" onPress={s.obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

function BaseTile({ label, value, unit, onDec, onInc }: { label: string; value: string; unit?: string; onDec: () => void; onInc: () => void }) {
  return (
    <View style={[{ flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 13, alignItems: 'center' }, shadow.card]}>
      <Txt w="b" size={11} color={colors.textTertiary} ls={0.4}>
        {label}
      </Txt>
      <Row style={{ marginVertical: 6 }}>
        <Txt w="eb" size={20}>
          {value}
        </Txt>
        {unit ? (
          <Txt w="sb" size={12} color={colors.textTertiary}>
            {unit}
          </Txt>
        ) : null}
      </Row>
      <Row style={{ gap: 6 }}>
        <MiniStep glyph="−" onPress={onDec} />
        <MiniStep glyph="+" onPress={onInc} />
      </Row>
    </View>
  );
}

function MiniStep({ glyph, onPress }: { glyph: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
      <Txt w="b" size={17} color={colors.slate700}>
        {glyph}
      </Txt>
    </Pressable>
  );
}

function RecStat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View>
      <Txt w="eb" size={24} color={color}>
        {value}
      </Txt>
      <Txt w="sb" size={11} color={colors.textSecondary} style={{ marginTop: 2 }}>
        {label}
      </Txt>
    </View>
  );
}

/* ----------------------------------------------------------------- Connect */
function ConnectStep({ label }: { label: string }) {
  const { inviteWho, toggleInvite, obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="Invite the people who keep you accountable.">Connect your circle</Title>
      <TeamCodeCard code="EAGLES24" />
      <View style={{ gap: 10, marginTop: 16 }}>
        {INVITE_DATA.map((iv) => {
          const sel = inviteWho.includes(iv.key);
          return (
            <Pressable
              key={iv.key}
              onPress={() => toggleInvite(iv.key)}
              style={[
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 16,
                  borderRadius: 16,
                  backgroundColor: sel ? colors.accentSurface : colors.card,
                  borderWidth: 1.5,
                  borderColor: sel ? colors.accentBorderStrong : 'transparent',
                },
                sel ? undefined : shadow.card,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Txt w="b" size={15}>
                  {iv.name}
                </Txt>
                <Txt w="m" size={13} color={colors.textSecondary}>
                  {iv.desc}
                </Txt>
              </View>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  backgroundColor: sel ? colors.accent : '#fff',
                  borderWidth: 2,
                  borderColor: sel ? colors.accent : '#CBD5E1',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {sel ? <Icon name="check" size={14} color="#fff" /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <Btn label="Continue" onPress={obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

function TeamCodeCard({ code }: { code: string }) {
  return (
    <Row style={{ marginTop: 20, borderRadius: 18, padding: 18, backgroundColor: colors.text, justifyContent: 'space-between' }}>
      <View>
        <Txt w="eb" size={11} color="rgba(255,255,255,0.5)" ls={1.1}>
          YOUR TEAM CODE
        </Txt>
        <Txt w="eb" size={26} color="#fff" ls={2} style={{ marginTop: 4 }}>
          {code}
        </Txt>
      </View>
      <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="copy" size={18} color="#fff" />
      </View>
    </Row>
  );
}

/* ------------------------------------------------------------ Parent: link */
function LinkStep({ label }: { label: string }) {
  const { obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="Enter the invite code from your athlete or coach.">Connect to your athlete</Title>
      <Row style={{ gap: 8, marginTop: 22 }}>
        <View style={[{ flex: 1, height: 58, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
          <Txt w="eb" size={22} ls={6}>
            EAGLES24
          </Txt>
        </View>
        <View style={{ width: 58, height: 58, borderRadius: 14, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={24} color="#fff" />
        </View>
      </Row>
      <Card style={{ marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 15, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="eb" size={20} color="#fff">
            J
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={17}>
            Jihad Carter
          </Txt>
          <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 2 }}>
            Linebacker · Eastside HS
          </Txt>
        </View>
        <Row style={{ gap: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success }} />
          <Txt w="b" size={12} color={colors.success}>
            Found
          </Txt>
        </Row>
      </Card>
      <Btn label="Continue" onPress={obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

/* ----------------------------------------------------------- Parent: focus */
function FocusStep({ label }: { label: string }) {
  const { parentFocus, toggleFocus, obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="We'll highlight these in your weekly reports.">What matters most to you?</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 22 }}>
        {PARENT_FOCUS.map((f) => (
          <Chip key={f} label={f} active={parentFocus.includes(f)} onPress={() => toggleFocus(f)} />
        ))}
      </View>
      <View style={{ marginTop: 22, borderRadius: 20, padding: 18, backgroundColor: colors.accentSurface, borderWidth: 1, borderColor: colors.accentBorder }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="eb" size={16}>
            Parent Plan
          </Txt>
          <Txt w="eb" size={18} color={colors.accent}>
            $24.99
            <Txt w="sb" size={12} color={colors.textSecondary}>
              /mo
            </Txt>
          </Txt>
        </Row>
        <View style={{ gap: 8, marginTop: 13 }}>
          <PlanRow text="Full athlete dashboard & alerts" />
          <PlanRow text="AI weekly summaries & trends" />
        </View>
      </View>
      <Btn label="Continue" onPress={obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

function PlanRow({ text }: { text: string }) {
  return (
    <Row style={{ gap: 9 }}>
      <Icon name="check" size={14} color={colors.accent} />
      <Txt w="sb" size={13} color={colors.slate700}>
        {text}
      </Txt>
    </Row>
  );
}

/* ------------------------------------------------------------- Coach: team */
function TeamStep({ label }: { label: string }) {
  const { compMode, setCompMode, obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="You can edit any of this later.">Set up your team</Title>
      <View style={{ gap: 10, marginTop: 22 }}>
        <SettingRow label="SCHOOL / ORG" value="Eastside High School" />
        <SettingRow label="TEAM" value="Varsity Football" />
      </View>
      <Txt w="b" size={14} style={{ marginTop: 22, marginBottom: 12 }}>
        Competition mode
      </Txt>
      <Row style={{ gap: 8 }}>
        {COMP_MODES.map((c) => {
          const sel = compMode === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => setCompMode(c.key)}
              style={[
                { flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: 'center', backgroundColor: sel ? colors.accent : colors.card },
                sel ? undefined : shadow.card,
              ]}
            >
              <Txt w="b" size={13} color={sel ? '#fff' : colors.textSecondary}>
                {c.label}
              </Txt>
            </Pressable>
          );
        })}
      </Row>
      <Btn label="Continue" onPress={obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={[{ backgroundColor: '#fff', borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, justifyContent: 'space-between' }, shadow.card]}>
      <View>
        <Txt w="b" size={11} color={colors.textTertiary}>
          {label}
        </Txt>
        <Txt w="b" size={16} style={{ marginTop: 3 }}>
          {value}
        </Txt>
      </View>
      <Icon name="settings" size={18} color={colors.textTertiary} />
    </Row>
  );
}

/* ----------------------------------------------------------- Coach: roster */
function RosterStep({ label }: { label: string }) {
  const { obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="Athletes join with your code, or import a roster.">Add your athletes</Title>
      <TeamCodeCard code="EAGLES24" />
      <Card style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plan" size={22} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={15}>
            Import from CSV
          </Txt>
          <Txt w="m" size={13} color={colors.textSecondary}>
            Name, email, position
          </Txt>
        </View>
        <Icon name="chevronRight" size={20} color={colors.textTertiary} />
      </Card>
      <Btn label="Continue" onPress={obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

/* ------------------------------------------------------------ Coach: track */
function TrackStep({ label }: { label: string }) {
  const { coachTrack, toggleTrack, ciConfig, toggleCiQ, obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="Choose what your athletes track and report.">What do you track?</Title>
      <Txt w="eb" size={11} color={colors.textTertiary} ls={0.6} style={{ marginTop: 22, marginBottom: 10 }}>
        DAILY METRICS
      </Txt>
      <Card style={{ paddingVertical: 4 }}>
        {TRACK_DATA.map((t, i) => (
          <Row key={t.key} style={{ justifyContent: 'space-between', paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Txt w="b" size={15}>
                {t.name}
              </Txt>
              <Txt w="m" size={13} color={colors.textSecondary}>
                {t.desc}
              </Txt>
            </View>
            <Toggle on={coachTrack[t.key]} onPress={() => toggleTrack(t.key)} />
          </Row>
        ))}
      </Card>
      <Txt w="eb" size={11} color={colors.textTertiary} ls={0.6} style={{ marginTop: 22, marginBottom: 10 }}>
        WEEKLY CHECK-IN QUESTIONS
      </Txt>
      <Card style={{ paddingVertical: 4 }}>
        {CHECKIN_QUESTIONS.map((q, i) => (
          <Row key={q.key} style={{ justifyContent: 'space-between', paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
            <Txt w="b" size={15}>
              {q.label}
            </Txt>
            <Toggle on={ciConfig[q.key]} onPress={() => toggleCiQ(q.key)} />
          </Row>
        ))}
      </Card>
      <Btn label="Finish setup" onPress={obNext} style={{ marginTop: 24 }} />
    </View>
  );
}

/* -------------------------------------------------------- Trainer: practice */
function PracticeStep({ label }: { label: string }) {
  const { obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="Set up your training practice.">Your practice</Title>
      <View style={{ gap: 14, marginTop: 24 }}>
        <Field label="PRACTICE NAME">
          <Input defaultValue="Apex Performance" placeholder="Practice name" />
        </Field>
        <SettingRow label="PLAN" value="Pro · up to 50 clients" />
      </View>
      <Btn label="Continue" onPress={obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

/* --------------------------------------------------------- Trainer: clients */
function ClientsStep({ label }: { label: string }) {
  const { obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1 }}>
      <StepHeader label={label} onBack={obBack} />
      <Title sub="Clients join across any org with your code.">Invite clients</Title>
      <TeamCodeCard code="APEX01" />
      <Card style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="send" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="b" size={15}>
            Send invite links
          </Txt>
          <Txt w="m" size={13} color={colors.textSecondary}>
            Text or email each client
          </Txt>
        </View>
        <Icon name="chevronRight" size={20} color={colors.textTertiary} />
      </Card>
      <Btn label="Continue" onPress={obNext} style={{ marginTop: 'auto' }} />
    </View>
  );
}

/* ----------------------------------------------------------------- Success */
const SUCCESS_COPY: Record<string, { title: string; sub: string; cta: string; code?: string }> = {
  athlete: { title: "You're all set", sub: 'Your first Athlete Score is ready. Log a meal to start your streak.', cta: 'Enter AthleteOS', code: 'EAGLES24' },
  parent: { title: "You're connected", sub: "You'll get Jihad's weekly summaries and alerts. Welcome aboard.", cta: 'Go to dashboard' },
  coach: { title: 'Team is live', sub: 'Share your code and athletes will start showing up on your roster.', cta: 'Open coach view', code: 'EAGLES24' },
  trainer: { title: 'Practice is live', sub: 'Invite clients and start tracking compliance across your book.', cta: 'Open trainer view', code: 'APEX01' },
};

function Success({ role }: { role: string }) {
  const { finishOb } = useStore();
  const copy = SUCCESS_COPY[role] ?? SUCCESS_COPY.athlete;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.successSurface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="check" size={48} color={colors.successDeep} strokeWidth={3} />
      </View>
      <Txt w="eb" size={30} ls={-0.9} style={{ marginTop: 28, textAlign: 'center' }}>
        {copy.title}
      </Txt>
      <Txt w="m" size={15} color={colors.textSecondary} style={{ marginTop: 10, textAlign: 'center', lineHeight: 22, maxWidth: 300 }}>
        {copy.sub}
      </Txt>
      {copy.code ? (
        <Pill bg={colors.text} color="#fff" style={{ marginTop: 22, paddingHorizontal: 18, paddingVertical: 11 }}>
          <Txt w="eb" size={18} color="#fff" ls={1.5}>
            {copy.code}
          </Txt>
        </Pill>
      ) : null}
      <Btn label={copy.cta} onPress={finishOb} style={{ marginTop: 36, alignSelf: 'stretch' }} />
    </View>
  );
}
