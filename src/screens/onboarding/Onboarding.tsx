// OnStandard — activation-first onboarding. The goal is the first moment of value
// (Starting Point Score -> first meal -> AI coaching), not account setup. One question
// per screen, tap-first, in-system premium. 7 roles personalize onto the 4 dashboards.
// See docs/specs/2026-06-23-onboarding-redesign.md.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, ScrollView, View } from 'react-native';
import {
  formatHeight,
  flowForRole,
  consentSummary,
  firstName,
  guardianConsentCopy,
  GOAL_GROUPS,
  isMinor,
  isValidEmail,
  isValidGuardianEmail,
  POSITION_MAP,
  PROTEIN_FREQ,
  ROLE_DEFS,
  SPORTS,
  TRAIN_FREQ,
  validateCredentials,
  credentialsOk,
} from '@/core';
import type { Role } from '@/core';
import { isBackendLive, db } from '@/lib/supabase';
import type { OrgRow } from '@/lib/supabase';
import { isAppleAuthAvailable, requestAppleIdentityToken } from '@/lib/auth/apple';
import { openPrivacyPolicy, openTerms } from '@/lib/legal';
import { aiPrefix, isAiConfigured } from '@/lib/ai';
import { useStore } from '@/store';
import type { Store } from '@/store';
import { useColors, useTheme } from '@/ui/theme';
import { Btn, Card, Input, ProgressBar, Row, Stepper, Toggle, Txt, Pressable } from '@/ui/primitives';
import { Slider } from '@/ui/Slider';
import { haptics } from '@/ui/haptics';
import { useReduceMotion } from '@/ui/useReduceMotion';
import { Icon, type IconName } from '@/icons';
import { LogoMark } from '@/brand/Logo';
import { ROLE_FLOWS, athleteFlowKeys, roleFlowFor, type GenStep } from './flows';
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
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
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
              style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 13, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
            >
              <Icon name="chevronLeft" size={22} color={c.slate600} />
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
          <Txt w="eb" size={12} color={c.accent} ls={1} upper style={{ marginBottom: 10 }}>
            {eyebrow}
          </Txt>
        ) : null}
        <Txt w="eb" size={28} ls={-0.8} style={{ lineHeight: 32 }}>
          {title}
        </Txt>
        {sub ? (
          <Txt w="m" size={15} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 21 }}>
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
  const c = useColors();
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
        backgroundColor: selected ? c.accentSurface : c.card,
        borderWidth: 1.5,
        borderColor: selected ? c.accent : c.border,
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
        <Txt w="b" size={16} color={selected ? c.accent : c.text}>
          {label}
        </Txt>
        {sub ? (
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 2 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <Icon name="check" size={13} color={c.white} /> : null}
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ welcome */
function Welcome() {
  const c = useColors();
  const { scheme } = useTheme();
  const { athleteName, setName, obNext, startSignin } = useStore();
  // First + last are both required. We keep the store's single `athleteName` as the
  // source of truth (it holds the full "First Last" and every downstream helper —
  // firstName()/initials() — already parses it), and split it back into two local
  // fields so returning to this step repopulates both inputs. First token is the
  // first name; the remainder is the last name.
  const seed = React.useMemo(() => athleteName.trim().split(/\s+/).filter(Boolean), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [first, setFirst] = React.useState(seed[0] ?? '');
  const [last, setLast] = React.useState(seed.slice(1).join(' '));
  const commit = (f: string, l: string) => setName(`${f.trim()} ${l.trim()}`.trim());
  const onFirst = (v: string) => { setFirst(v); commit(v, last); };
  const onLast = (v: string) => { setLast(v); commit(first, v); };
  const ready = first.trim().length > 0 && last.trim().length > 0;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingTop: 76, paddingHorizontal: 26, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <Row style={{ gap: 10 }}>
          <LogoMark size={30} onDark={scheme === 'dark'} />
          <Txt w="eb" size={20} ls={-0.4}>
            On<Txt w="eb" size={20} color={c.accent}>Standard</Txt>
          </Txt>
        </Row>
        <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 28 }}>
          <Txt w="eb" size={38} ls={-1.4} style={{ lineHeight: 42 }}>
            Let's get you{'\n'}set up.
          </Txt>
          <Txt w="m" size={16} color={c.textSecondary} style={{ marginTop: 14, lineHeight: 23 }}>
            A few quick questions and we'll tailor OnStandard to exactly how you'll use it. About two minutes.
          </Txt>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.8} upper style={{ marginTop: 32, marginBottom: 9 }}>
            First, what should we call you?
          </Txt>
          <View style={{ gap: 12 }}>
            <Input value={first} onChangeText={onFirst} placeholder="First name" autoCapitalize="words" returnKeyType="next" />
            <Input value={last} onChangeText={onLast} placeholder="Last name" autoCapitalize="words" returnKeyType="done" />
          </View>
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 26, paddingBottom: 34, gap: 14 }}>
        <Btn label="Get started" disabled={!ready} onPress={obNext} />
        <Pressable accessibilityRole="button" accessibilityLabel="Sign in" hitSlop={8} onPress={() => { haptics.tap(); startSignin(); }} style={({ pressed }) => ({ alignSelf: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Txt w="b" size={14} color={c.textSecondary}>
            Already have an account? <Txt w="b" size={14} color={c.accent}>Sign in</Txt>
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

function SignIn() {
  const c = useColors();
  const { exitSignin, signinDone, signInLive, signInWithApple, requestPasswordReset, setAuthError } = useStore();
  const authError = useStore((st: Store) => st.authError);
  const resetSent = useStore((st: Store) => st.passwordResetSent);
  const [mode, setMode] = React.useState<'in' | 'forgot'>('in');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // Flag OFF: the mock router (signinDone) runs exactly as today. Flag ON: route
  // through live auth; on success hydrate + enter the app, else surface the error.
  const onSubmit = async () => {
    if (!isBackendLive) {
      signinDone();
      return;
    }
    setBusy(true);
    const ok = await signInLive(email, password);
    setBusy(false);
    if (ok) signinDone();
  };

  const onApple = async () => {
    setBusy(true);
    const token = await requestAppleIdentityToken();
    if (token) {
      const ok = await signInWithApple(token);
      if (ok) { setBusy(false); signinDone(); return; }
    }
    setBusy(false);
  };

  // ---- forgot-password sub-mode ----
  if (mode === 'forgot') {
    return (
      <StepShell
        progress={null}
        onBack={() => { setAuthError(null); setMode('in'); }}
        title="Reset your password"
        sub="Enter your email and we'll send a link to set a new one."
        footer={
          resetSent
            ? <Btn label="Back to sign in" onPress={() => { setMode('in'); }} />
            : <Btn label={busy ? 'Sending...' : 'Send reset link'} disabled={busy || !isValidEmail(email)} onPress={async () => { setBusy(true); await requestPasswordReset(email); setBusy(false); }} />
        }
      >
        {resetSent ? (
          <Card style={{ marginTop: 6 }} elevated>
            <Txt w="sb" size={15} color={c.slate700} style={{ lineHeight: 22 }}>
              If an account exists for that email, a reset link is on its way. Check your inbox (and spam).
            </Txt>
          </Card>
        ) : (
          <View style={{ gap: 12 }}>
            <Input value={email} onChangeText={setEmail} placeholder="Email address" autoCapitalize="none" keyboardType="email-address" />
            {authError ? <Txt w="sb" size={13} color={c.alert}>{authError}</Txt> : null}
          </View>
        )}
      </StepShell>
    );
  }

  return (
    <StepShell
      progress={null}
      onBack={() => { setAuthError(null); exitSignin(); }}
      title="Welcome back"
      sub="Pick up right where you left off."
      footer={<Btn label={busy ? 'Signing in...' : 'Sign in'} disabled={busy} onPress={onSubmit} />}
    >
      <View style={{ gap: 12 }}>
        <Input value={email} onChangeText={setEmail} placeholder="Email address" autoCapitalize="none" keyboardType="email-address" />
        <Input value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
        {authError ? (
          <Txt w="sb" size={13} color={c.alert} style={{ marginTop: 2 }}>
            {authError}
          </Txt>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Forgot password" hitSlop={8} onPress={() => { setAuthError(null); setMode('forgot'); }} style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}>
          <Txt w="b" size={13} color={c.accent}>Forgot password?</Txt>
        </Pressable>
        <AppleButton busy={busy} onPress={onApple} />
      </View>
    </StepShell>
  );
}

/** Sign in with Apple button — renders only when the native seam is available AND
 *  the backend is live (App Store 4.8). Hidden today; lights up at go-live once
 *  expo-apple-authentication is added. See src/lib/auth/apple.ts. */
function AppleButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  const c = useColors();
  if (!isAppleAuthAvailable || !isBackendLive || Platform.OS !== 'ios') return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign in with Apple"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({ height: 52, borderRadius: 14, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 4, opacity: pressed ? 0.85 : 1 })}
    >
      <Txt w="b" size={15} color={c.white}> Sign in with Apple</Txt>
    </Pressable>
  );
}

/**
 * Shared account-creation form (athlete + overseer flows, only mounted when the
 * backend is live). Collects email + password, validates inline, and calls
 * signUpLive; on success it shows a "confirm your email" panel (the Supabase project
 * has email-confirmation on) and a Continue button that advances the flow. The
 * account works locally immediately; sync waits on confirmation + consent.
 */
function CreateAccountForm({ progress, title, sub, onDone }: { progress: number; title: string; sub: string; onDone: () => void }) {
  const c = useColors();
  const s = useStore();
  const authError = useStore((st: Store) => st.authError);
  const [email, setEmail] = React.useState(s.athleteEmail ?? '');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState(false);
  const errors = validateCredentials(email, password, confirm);
  const ready = credentialsOk(errors);

  const onCreate = async () => {
    setBusy(true);
    const ok = await s.signUpLive(email, password, s.athleteName);
    setBusy(false);
    if (ok) setCreated(true);
  };

  const onApple = async () => {
    setBusy(true);
    const token = await requestAppleIdentityToken();
    if (token) { const ok = await s.signInWithApple(token); if (ok) { setBusy(false); onDone(); return; } }
    setBusy(false);
  };

  if (created) {
    // Honest under either email-confirmation setting: only claim a link was sent when the project
    // actually requires confirmation (Supabase returned no session). With confirm OFF the account
    // is immediately usable, so we say so instead of pointing them at an email that never came.
    const pending = s.emailConfirmPending;
    return (
      <StepShell
        progress={progress}
        onBack={s.obBack}
        eyebrow="Almost there"
        title={pending ? 'Confirm your email' : "You're all set"}
        sub={pending ? 'We sent a confirmation link to keep your account secure.' : 'Your account is ready to go.'}
        footer={<Btn label="Continue" haptic="success" onPress={onDone} />}
      >
        <Card style={{ marginTop: 6 }} elevated>
          <Row style={{ gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={pending ? 'bell' : 'check'} size={19} color={c.accent} />
            </View>
            <Txt w="sb" size={14} color={c.slate700} style={{ flex: 1, lineHeight: 20 }}>
              {pending
                ? `Check ${email.trim()} for a link. You can keep going now — your data stays on this device until you confirm.`
                : `You're signed in as ${email.trim()}. Let's keep going.`}
            </Txt>
          </Row>
        </Card>
      </StepShell>
    );
  }

  return (
    <StepShell
      progress={progress}
      onBack={s.obBack}
      eyebrow="Create your account"
      title={title}
      sub={sub}
      footer={<Btn label={busy ? 'Creating...' : 'Create account'} disabled={busy || !ready || !s.termsAcceptedAt} onPress={onCreate} />}
    >
      <View style={{ gap: 12 }}>
        <Input value={email} onChangeText={setEmail} placeholder="Email address" autoCapitalize="none" keyboardType="email-address" />
        {email.length > 0 && errors.email ? <FieldError text={errors.email} /> : null}
        <Input value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
        {password.length > 0 && errors.password ? <FieldError text={errors.password} /> : null}
        <Input value={confirm} onChangeText={setConfirm} placeholder="Confirm password" secureTextEntry />
        {confirm.length > 0 && errors.confirm ? <FieldError text={errors.confirm} /> : null}
        {authError ? <Txt w="sb" size={13} color={c.alert} style={{ marginTop: 2 }}>{authError}</Txt> : null}
        <AppleButton busy={busy} onPress={onApple} />
        <TermsAgreement accepted={!!s.termsAcceptedAt} onToggle={() => s.acceptTerms(s.termsAcceptedAt ? null : new Date().toISOString())} />
      </View>
    </StepShell>
  );
}

function FieldError({ text }: { text: string }) {
  const c = useColors();
  return <Txt w="m" size={12} color={c.alert} style={{ marginTop: -4, marginLeft: 2, lineHeight: 16 }}>{text}</Txt>;
}

/** Required Terms + Privacy agreement on the account-creation screen: an explicit
 *  checkbox (gates the Create-account button) plus a line with tappable links to the
 *  hosted documents. Reuses OptionRow for the checkbox affordance and the safe
 *  Linking helpers in lib/legal.ts. */
function TermsAgreement({ accepted, onToggle }: { accepted: boolean; onToggle: () => void }) {
  const c = useColors();
  return (
    <View style={{ gap: 8, marginTop: 2 }}>
      <OptionRow label="I agree to the Terms of Service and Privacy Policy" selected={accepted} onPress={onToggle} />
      <Row style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: 2 }}>
        <Txt w="m" size={12} color={c.textTertiary}>Read the</Txt>
        <Pressable accessibilityRole="link" accessibilityLabel="Terms of Service" hitSlop={6} onPress={openTerms}>
          <Txt w="b" size={12} color={c.accent}>Terms of Service</Txt>
        </Pressable>
        <Txt w="m" size={12} color={c.textTertiary}>and</Txt>
        <Pressable accessibilityRole="link" accessibilityLabel="Privacy Policy" hitSlop={6} onPress={openPrivacyPolicy}>
          <Txt w="b" size={12} color={c.accent}>Privacy Policy</Txt>
        </Pressable>
        <Txt w="m" size={12} color={c.textTertiary}>.</Txt>
      </Row>
    </View>
  );
}

/* ------------------------------------------------------------------ role picker */
function RolePicker() {
  const c = useColors();
  const { role, setRole, obNext, obBack } = useStore();
  return (
    <StepShell
      progress={null}
      onBack={obBack}
      eyebrow="Who are you?"
      title="How will you use OnStandard?"
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
              backgroundColor: selected ? c.accentSurface : c.card,
              borderWidth: 1.5,
              borderColor: selected ? c.accent : c.border,
              borderRadius: 16,
              padding: 15,
              marginBottom: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              opacity: pressed ? 0.92 : 1,
            })}
          >
            <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: selected ? c.accent : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={r.icon as IconName} size={21} color={selected ? c.white : c.slate600} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt w="b" size={16} color={selected ? c.accent : c.text}>
                {r.title}
              </Txt>
              <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 1 }}>
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
// Step order from flows.ts: includes the real-data consent gate only when the backend
// is live, so with the flag OFF this is byte-identical to the prior fixed list.
const ATHLETE_KEYS = athleteFlowKeys(isBackendLive);

function AthleteFlow() {
  const c = useColors();
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
        <StepShell progress={progress} onBack={s.obBack} eyebrow="Your plan" title="What's your #1 goal right now?" sub={`This shapes every piece of ${aiPrefix}coaching you'll get.`} footer={cont(!!s.primaryGoal)}>
          {GOAL_GROUPS.map((g) => (
            <View key={g.group} style={{ marginBottom: 18 }}>
              <Txt w="eb" size={12} color={c.textTertiary} ls={0.6} upper style={{ marginBottom: 10 }}>
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
                      style={({ pressed }) => ({ backgroundColor: sel ? c.accent : c.card, borderWidth: 1.5, borderColor: sel ? c.accent : c.border, borderRadius: 13, paddingVertical: 12, paddingHorizontal: 15, opacity: pressed ? 0.9 : 1 })}
                    >
                      <Txt w="b" size={14} color={sel ? c.white : c.slate700}>
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

    case 'sport': {
      // Position is merged in here (optional): it only appears once a sport is picked,
      // so the old standalone position step is gone but the data is still collected.
      const positions = (s.sport && POSITION_MAP[s.sport]) || POSITION_MAP.default;
      // Sport is only required for a competitive (performance) goal. A Lose Fat / general user is not
      // forced to declare a sport — they can skip straight through (context-assumption fix).
      const sportOptional = s.baseGoal !== 'performance';
      return (
        <StepShell
          progress={progress}
          onBack={s.obBack}
          title="What sport do you play?"
          sub={sportOptional ? 'Optional — skip if your goal isn’t sport-specific.' : undefined}
          footer={cont(sportOptional || !!s.sport)}
        >
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
                  style={({ pressed }) => ({ width: '31.5%', backgroundColor: sel ? c.accent : c.card, borderWidth: 1.5, borderColor: sel ? c.accent : c.border, borderRadius: 14, paddingVertical: 18, alignItems: 'center', opacity: pressed ? 0.9 : 1 })}
                >
                  <Txt w="b" size={14} color={sel ? c.white : c.slate700}>
                    {sp}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          {s.sport ? (
            <View style={{ marginTop: 22 }}>
              <Txt w="eb" size={11} color={c.textTertiary} ls={0.6} upper style={{ marginBottom: 10 }}>
                Your position (optional)
              </Txt>
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
                      style={({ pressed }) => ({ backgroundColor: sel ? c.accent : c.card, borderWidth: 1.5, borderColor: sel ? c.accent : c.border, borderRadius: 13, paddingVertical: 13, paddingHorizontal: 18, opacity: pressed ? 0.9 : 1 })}
                    >
                      <Txt w="b" size={15} color={sel ? c.white : c.slate700}>
                        {p}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </StepShell>
      );
    }

    case 'profile':
      // Training frequency is merged in here (compact chips) so it isn't its own step.
      return (
        <StepShell progress={progress} onBack={s.obBack} title="About you" sub="Tap to adjust. This calibrates your targets." footer={cont(true)}>
          <View style={{ gap: 14 }}>
            <Row style={{ gap: 12 }}>
              <Stepper label="Age" value={String(s.baseAge)} unit="years" onDec={() => s.ageStep(-1)} onInc={() => s.ageStep(1)} />
              <Stepper label="Height" value={formatHeight(s.baseHeight)} onDec={() => s.hStep(-1)} onInc={() => s.hStep(1)} />
            </Row>
            <Row style={{ gap: 12 }}>
              <Stepper label="Weight" value={String(s.baseWeight)} unit="lb" onDec={() => s.bwStep(-1)} onInc={() => s.bwStep(1)} />
              <Stepper label="Target weight" value={String(s.weightTarget)} unit="lb" onDec={() => s.adjustWeightTarget(-1)} onInc={() => s.adjustWeightTarget(1)} />
            </Row>
            <View>
              <Txt w="eb" size={11} color={c.textTertiary} ls={0.6} upper style={{ marginTop: 4, marginBottom: 10 }}>
                How often do you train?
              </Txt>
              <Row style={{ flexWrap: 'wrap', gap: 8 }}>
                {TRAIN_FREQ.map((o) => {
                  const sel = s.trainingFreq === o.key;
                  return (
                    <Pressable
                      key={o.key}
                      accessibilityRole="button"
                      accessibilityLabel={o.label}
                      accessibilityState={{ selected: sel }}
                      onPress={() => { haptics.select(); s.setTrainingFreq(o.key); }}
                      style={({ pressed }) => ({ backgroundColor: sel ? c.accent : c.card, borderWidth: 1.5, borderColor: sel ? c.accent : c.border, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 15, opacity: pressed ? 0.9 : 1 })}
                    >
                      <Txt w="b" size={14} color={sel ? c.white : c.slate700}>{o.label}</Txt>
                    </Pressable>
                  );
                })}
              </Row>
            </View>
          </View>
        </StepShell>
      );

    case 'baseline':
      // All six habit questions on ONE screen (was six separate steps). Same setters,
      // same starting-score math; compact controls so it's a ~30-second scroll.
      return (
        <StepShell progress={progress} onBack={s.obBack} eyebrow="Baseline" title="A few quick habits" sub="Roughly is fine. This is what sets your starting score." footer={cont(true)}>
          <View style={{ gap: 20 }}>
            <MiniScale label="Confidence in your nutrition" value={s.baseNutritionConfidence} low="Not at all" high="Dialed in" onChange={(v) => s.setBaseAnswer('baseNutritionConfidence', v)} />
            <MiniScale label="Week-to-week consistency" value={s.baseConsistency} low="All over" high="Locked in" onChange={(v) => s.setBaseAnswer('baseConsistency', v)} />
            <View>
              <Txt w="b" size={14} color={c.slate700} style={{ marginBottom: 9 }}>How often do you hit your protein target?</Txt>
              <Row style={{ flexWrap: 'wrap', gap: 8 }}>
                {PROTEIN_FREQ.map((o) => {
                  const sel = s.baseProteinFreq === Number(o.key);
                  return (
                    <Pressable
                      key={o.key}
                      accessibilityRole="button"
                      accessibilityLabel={o.label}
                      accessibilityState={{ selected: sel }}
                      onPress={() => { haptics.select(); s.setBaseAnswer('baseProteinFreq', Number(o.key)); }}
                      style={({ pressed }) => ({ backgroundColor: sel ? c.accent : c.card, borderWidth: 1.5, borderColor: sel ? c.accent : c.border, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 15, opacity: pressed ? 0.9 : 1 })}
                    >
                      <Txt w="b" size={14} color={sel ? c.white : c.slate700}>{o.label}</Txt>
                    </Pressable>
                  );
                })}
              </Row>
            </View>
            <MiniCounter label="Meals a day" display={String(s.baseMealsPerDay)} onDec={() => s.setBaseAnswer('baseMealsPerDay', Math.max(2, s.baseMealsPerDay - 1))} onInc={() => s.setBaseAnswer('baseMealsPerDay', Math.min(6, s.baseMealsPerDay + 1))} />
            <MiniCounter label="Water (liters / day)" display={s.baseWaterL.toFixed(1)} onDec={() => s.setBaseAnswer('baseWaterL', Math.max(0, +(s.baseWaterL - 0.5).toFixed(1)))} onInc={() => s.setBaseAnswer('baseWaterL', Math.min(5, +(s.baseWaterL + 0.5).toFixed(1)))} />
            <MiniCounter label="Sleep (hours / night)" display={s.baseSleepH.toFixed(1)} onDec={() => s.setBaseAnswer('baseSleepH', Math.max(4, +(s.baseSleepH - 0.5).toFixed(1)))} onInc={() => s.setBaseAnswer('baseSleepH', Math.min(10, +(s.baseSleepH + 0.5).toFixed(1)))} />
          </View>
        </StepShell>
      );

    case 'score': {
      const score = s.startScore ?? 0;
      const name = firstName(s.athleteName, '');
      return (
        <StepShell
          progress={progress}
          onBack={s.obBack}
          eyebrow="Your Starting Execution Score"
          title={name ? `${name}, here's where you stand.` : "Here's where you stand."}
          sub="This is your starting point, estimated from your habits. It rises as OnStandard learns from what you actually do."
          footer={<Btn label="See today's challenge" onPress={s.obNext} />}
        >
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <ScoreReveal score={score} />
          </View>
        </StepShell>
      );
    }

    case 'account':
      // Only present when isBackendLive (see athleteFlowKeys). Creates the real
      // account before consent so a userId exists for the data path.
      return (
        <CreateAccountForm
          progress={progress}
          title={firstName(s.athleteName, '') ? `Save your progress, ${firstName(s.athleteName, '')}.` : 'Save your progress.'}
          sub="Create an account so your score and meals sync across devices."
          onDone={s.obNext}
        />
      );

    case 'consent': {
      // Consent step (only present when isBackendLive). A minor may ACTIVATE now in
      // local-only mode — the real-data sync gate (core/consent.ts realDataConsent)
      // keeps their meals + score on-device until a guardian is VERIFIED, so we no
      // longer hard-block onboarding on a sent request. Proceeding needs only the
      // athlete's own agreement; the guardian request is encouraged, not required.
      const minor = isMinor(s.baseAge);
      const verified = s.guardianStatus === 'verified';
      const pending = s.guardianStatus === 'pending';
      const emailEntered = s.guardianEmail.trim().length > 0;
      const emailValid = isValidGuardianEmail(s.guardianEmail);
      return (
        <StepShell
          progress={progress}
          onBack={s.obBack}
          eyebrow="Before you start"
          title={minor ? 'Your data, with a guardian' : 'Your data, your control'}
          sub="OnStandard only ever shares what you allow, and you can stop any time."
          footer={
            <Btn
              label={minor && !verified ? 'Start — my data stays on this device' : 'I agree, continue'}
              disabled={!s.realDataConsent}
              onPress={s.obNext}
            />
          }
        >
          <Card style={{ marginTop: 6 }} elevated>
            <Txt w="m" size={15} color={c.slate700} style={{ lineHeight: 22 }}>
              {consentSummary(minor)}
            </Txt>
          </Card>
          <View style={{ marginTop: 14 }}>
            <OptionRow
              label={minor
                ? 'A parent or guardian and I agree to share this data'
                : 'I agree to share this data with my linked coach'}
              selected={s.realDataConsent}
              onPress={() => { haptics.select(); s.recordConsent(!s.realDataConsent); }}
            />
          </View>
          {minor ? (
            <View style={{ marginTop: 14 }}>
              <Txt w="eb" size={12} color={c.textTertiary} ls={0.6} upper style={{ marginBottom: 8 }}>
                Parent or guardian approval
              </Txt>
              <Input
                value={s.guardianEmail}
                onChangeText={s.setGuardianEmail}
                placeholder="parent@email.com"
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!verified}
              />
              {emailEntered && !emailValid ? (
                <Txt w="m" size={12} color={c.alert} style={{ marginTop: 6, lineHeight: 17 }}>
                  That doesn&apos;t look like a valid email. Check for typos (e.g. &quot;gmial.com&quot;).
                </Txt>
              ) : null}
              <Btn
                label={verified ? 'Approved' : pending ? 'Resend approval request' : 'Send for approval'}
                disabled={!emailValid || verified}
                onPress={() => { void s.requestGuardianConsent(); }}
                style={{ marginTop: 10 }}
              />
              <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 8, lineHeight: 17 }}>
                {guardianConsentCopy(s.guardianStatus)}
              </Txt>
              {!verified ? (
                <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 6, lineHeight: 17 }}>
                  You can start now — your meals and score stay private on this device.
                  Nothing is shared with a coach until a guardian approves.
                </Txt>
              ) : null}
            </View>
          ) : null}
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
          sub={isAiConfigured
            ? 'One photo. Your AI nutrition coach reads it, scores it, and shows you exactly what to do next, instantly.'
            : 'Log your meal and your nutrition coach scores it and shows you exactly what to do next, instantly.'}
          footer={<Btn label="Start now" haptic="success" onPress={s.startFirstMealChallenge} />}
        >
          <Card style={{ alignItems: 'center', paddingVertical: 34, marginTop: 6 }} elevated>
            <View style={{ width: 86, height: 86, borderRadius: 28, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="camera" size={38} color={c.accent} />
            </View>
            <Txt w="eb" size={17} style={{ marginTop: 16 }}>
              +3 to your score
            </Txt>
            <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 4, textAlign: 'center', paddingHorizontal: 20 }}>
              Logging your first meal proves the loop. Your score moves the moment you do the work.
            </Txt>
          </Card>
        </StepShell>
      );
  }
}

/** 1-10 slider step (baseline confidence / consistency). */
/** Compact 1-10 slider row for the combined baseline screen. */
function MiniScale({ label, value, low, high, onChange }: { label: string; value: number; low: string; high: string; onChange: (v: number) => void }) {
  const c = useColors();
  return (
    <View>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
        <Txt w="b" size={14} color={c.slate700} style={{ flex: 1 }}>{label}</Txt>
        <Txt w="eb" size={16} color={c.accent}>{value}<Txt w="sb" size={11} color={c.textTertiary}> / 10</Txt></Txt>
      </Row>
      <Slider value={value} min={1} max={10} onChange={onChange} />
      <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <Txt w="sb" size={11} color={c.textTertiary}>{low}</Txt>
        <Txt w="sb" size={11} color={c.textTertiary}>{high}</Txt>
      </Row>
    </View>
  );
}

/** Compact ± counter row for the combined baseline screen (meals / water / sleep). */
function MiniCounter({ label, display, onDec, onInc }: { label: string; display: string; onDec: () => void; onInc: () => void }) {
  const c = useColors();
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Txt w="b" size={14} color={c.slate700} style={{ flex: 1 }}>{label}</Txt>
      <Row style={{ gap: 14, alignItems: 'center' }}>
        <MiniRound glyph="−" onPress={onDec} />
        <Txt w="eb" size={18} style={{ minWidth: 48, textAlign: 'center' }}>{display}</Txt>
        <MiniRound glyph="+" onPress={onInc} />
      </Row>
    </Row>
  );
}

function MiniRound({ glyph, onPress }: { glyph: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? 'Increase' : 'Decrease'}
      hitSlop={8}
      onPress={() => { haptics.select(); onPress(); }}
      style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 14, backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
    >
      <Txt w="b" size={24} color={c.accent}>{glyph}</Txt>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ generic (non-athlete) flow */
function GenericFlow() {
  const s = useStore();
  const role = (s.role ?? 'athlete') as Role;
  const flow = roleFlowFor(ROLE_FLOWS[role] ?? [], isBackendLive);
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
  const c = useColors();
  const s = useStore();
  const val = step.kind === 'select' || step.kind === 'multiselect' || step.kind === 'text' ? s.obMeta[step.field] : undefined;

  // On the invite step, when the backend is live, mint the overseer's real team
  // via the create_team RPC so the shared code is the genuine server-generated one.
  // Inert when the flag is off (createTeamLive no-ops) — the demo keeps EAGLES24.
  const { teamCode, obMeta, createTeamLive, teamDiscoverable } = s;
  useEffect(() => {
    if (step.kind !== 'invite' || !isBackendLive || teamCode) return;
    const sport = typeof obMeta.sport === 'string' ? obMeta.sport : undefined;
    const school = typeof obMeta.school === 'string' ? obMeta.school.trim() : '';
    const orgId = typeof obMeta.orgId === 'string' && obMeta.orgId ? obMeta.orgId : null;
    const name = school || (sport ? `${sport} team` : 'My Team');
    void createTeamLive(name, sport, orgId, teamDiscoverable);
  }, [step.kind, teamCode, obMeta, createTeamLive, teamDiscoverable]);

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
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.6} upper>
            {step.codeLabel}
          </Txt>
          <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <Txt w="eb" size={26} ls={1}>
              {s.teamCode || 'EAGLES24'}
            </Txt>
            <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="copy" size={19} color={c.accent} />
            </View>
          </Row>
        </Card>
        <Pressable accessibilityRole="button" accessibilityLabel="Skip for now" hitSlop={8} onPress={() => { haptics.tap(); s.finishOb(); }} style={({ pressed }) => ({ alignSelf: 'center', marginTop: 18, opacity: pressed ? 0.6 : 1 })}>
          <Txt w="b" size={14} color={c.textSecondary}>
            Skip for now
          </Txt>
        </Pressable>
      </StepShell>
    );
  }

  if (step.kind === 'account') {
    return <CreateAccountForm progress={progress} title={step.title} sub={step.sub} onDone={s.obNext} />;
  }

  if (step.kind === 'orgpicker') {
    return <OrgPicker step={step} progress={progress} />;
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

/** School/club directory picker (orgpicker step). Backend-live: type-ahead over the
 *  seeded `orgs` directory + "add your school/club", writing the org's display name to
 *  obMeta[field] and its id to obMeta.orgId (so an athlete and this coach land on the
 *  same school), plus the discoverable toggle. Offline/demo: degrades to the prior
 *  freetext behavior (name only, no org id) so the coach flow works without a backend. */
function OrgPicker({ step, progress }: { step: Extract<GenStep, { kind: 'orgpicker' }>; progress: number }) {
  const c = useColors();
  const s = useStore();
  const selectedName = typeof s.obMeta[step.field] === 'string' ? (s.obMeta[step.field] as string) : '';
  const selectedOrgId = typeof s.obMeta.orgId === 'string' ? (s.obMeta.orgId as string) : '';
  const [query, setQuery] = React.useState(selectedName);
  const [results, setResults] = React.useState<OrgRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const ready = selectedName.trim().length > 0;

  // Live directory search (inert offline: db.searchOrgs returns []). Re-runs as the
  // query changes; skips when the query already equals the current selection.
  React.useEffect(() => {
    if (!isBackendLive) return;
    let cancelled = false;
    const term = query.trim();
    if (term.length < 2 || term === selectedName) { setResults([]); return; }
    void db.searchOrgs(term).then((rows) => { if (!cancelled) setResults(rows); }).catch(() => { if (!cancelled) setResults([]); });
    return () => { cancelled = true; };
  }, [query, selectedName]);

  const onChange = (v: string) => {
    setQuery(v);
    // Offline/demo has no directory, so the typed text IS the selection (mirrors the
    // prior freetext step). Live: typing only drives search until an org is picked.
    if (!isBackendLive) { s.setObMeta(step.field, v); s.setObMeta('orgId', ''); }
  };

  const pick = (name: string, orgId: string) => {
    haptics.select();
    s.setObMeta(step.field, name);
    s.setObMeta('orgId', orgId);
    setQuery(name);
    setResults([]);
  };

  const addNew = async () => {
    const name = query.trim();
    if (!name || busy) return;
    setBusy(true);
    const org = await db.createOrg(name, null, null, 'school', s.userId ?? undefined).catch(() => null);
    setBusy(false);
    pick(org?.name ?? name, org?.id ?? '');
  };

  const term = query.trim();
  const showAdd = isBackendLive && term.length >= 2 && term !== selectedName
    && !results.some((o) => o.name.toLowerCase() === term.toLowerCase());

  return (
    <StepShell
      progress={progress}
      onBack={s.obBack}
      title={step.title}
      sub={step.sub}
      footer={<Btn label="Continue" disabled={!ready} onPress={s.obNext} />}
    >
      <Input value={query} onChangeText={onChange} placeholder="Search your school or club" autoCapitalize="words" />
      {isBackendLive ? (
        <View style={{ marginTop: 10 }}>
          {results.map((o) => (
            <OptionRow
              key={o.id}
              label={o.name}
              sub={[o.city, o.state].filter(Boolean).join(', ') || undefined}
              selected={selectedName === o.name && selectedOrgId === o.id}
              onPress={() => pick(o.name, o.id)}
            />
          ))}
          {showAdd ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${term}`}
              onPress={addNew}
              style={({ pressed }) => ({ borderWidth: 1.5, borderColor: c.border, borderStyle: 'dashed', borderRadius: 16, paddingVertical: 15, paddingHorizontal: 18, opacity: pressed ? 0.9 : 1 })}
            >
              <Txt w="b" size={15} color={c.accent}>{busy ? 'Adding…' : `+ Add “${term}”`}</Txt>
              <Txt w="m" size={12} color={c.textSecondary} style={{ marginTop: 2 }}>Not in the list? Add your school or club.</Txt>
            </Pressable>
          ) : null}
          <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: 14, marginTop: 20 }}>
            <Txt w="m" size={14} color={c.text} style={{ flex: 1, lineHeight: 20 }}>{step.toggleLabel}</Txt>
            <Toggle on={s.teamDiscoverable} onPress={() => s.setTeamDiscoverable(!s.teamDiscoverable)} label={step.toggleLabel} />
          </Row>
        </View>
      ) : null}
    </StepShell>
  );
}

/* ------------------------------------------------------------------ entry */
export function Onboarding() {
  const signinMode = useStore((s: Store) => s.signinMode);
  const obStep = useStore((s: Store) => s.obStep);
  const role = useStore((s: Store) => s.role);

  let content: React.ReactNode;
  if (signinMode) content = <SignIn />;
  else if (obStep === 0) content = <Welcome />;
  else if (obStep === 1) content = <RolePicker />;
  else content = flowForRole(role) === 'app' && (role === 'athlete' || role == null) ? <AthleteFlow /> : <GenericFlow />;

  // The key remounts StepEnter on every step so the new screen fades + rises in, making the flow
  // feel fluid instead of hard-cutting between identical-looking forms.
  return <StepEnter key={signinMode ? 'signin' : `step-${obStep}`}>{content}</StepEnter>;
}

/** Fade + slight rise on mount (one beat, ease-out). Each onboarding step animates in; honors
 *  reduce-motion (renders settled, no animation). Mirrors the overlay slide-up motion (aos-up). */
function StepEnter({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    Animated.timing(anim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [anim, reduceMotion]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return <Animated.View style={{ flex: 1, opacity: anim, transform: [{ translateY }] }}>{children}</Animated.View>;
}
