// OnStandard — activation-first onboarding. The goal is the first moment of value
// (Starting Point Score -> first meal -> AI coaching), not account setup. One question
// per screen, tap-first, in-system premium. 7 roles personalize onto the 4 dashboards.
// See docs/specs/2026-06-23-onboarding-redesign.md.
//
// Visual system (2026-07 redesign): every step is a proto "ob" frame
// (proto/redesign-2026-07/js/screens/onboarding.js + css/flows.css) — centered dot
// progress, 27px tight title + 14.5px sub, surface2/hairline chips + tiles that turn
// accent when selected, proto eyebrows, sideboxes, green primary CTAs, and the
// "Your Standard is set." confirmation. The RN flow keeps MORE steps than the proto
// (consent, baseline, auth) — those wear the same clothes so it reads as one design.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, ScrollView, Share, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import {
  formatHeight,
  flowForRole,
  consentSummary,
  deriveTargetsFromGoal,
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
  TIERS,
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
import { Btn, Input, PasswordInput, Reveal, Row, SampleTag, Stepper, Toggle, Txt, Pressable } from '@/ui/primitives';
import { shadow, tierChip, MAX_FONT_SCALE } from '@/ui/tokens';
import { Slider } from '@/ui/Slider';
import { haptics } from '@/ui/haptics';
import { useReduceMotion } from '@/ui/useReduceMotion';
import { Icon, type IconName } from '@/icons';
import { LogoMark } from '@/brand/Logo';
import { ROLE_FLOWS, athleteFlowKeys, roleFlowFor, type GenStep } from './flows';
import { ScoreReveal } from './ScoreReveal';
import { Welcome as WelcomeLanding } from './Welcome';

/* ------------------------------------------------------------------ proto atoms */

/** Proto `.ob-dots` step progress: past+current steps are green pills, the rest small
 *  surface dots. Replaces the old thin ProgressBar so progress reads like the proto. */
function ObDots({ step, total }: { step: number; total: number }) {
  const c = useColors();
  return (
    <Row
      accessible
      accessibilityLabel={`Step ${step} of ${total}`}
      style={{ gap: 7, justifyContent: 'center' }}
    >
      {Array.from({ length: total }, (_, i) => {
        const on = i < step;
        return (
          <View
            key={i}
            style={on
              ? { width: 22, height: 7, borderRadius: 4, backgroundColor: c.success }
              : { width: 7, height: 7, borderRadius: 4, backgroundColor: c.surface3 }}
          />
        );
      })}
    </Row>
  );
}

/** Back affordance (the proto has none — RN keeps it for the preserved obBack flow). */
function BackChip({ onPress }: { onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={8}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name="chevronLeft" size={22} color={c.slate600} />
    </Pressable>
  );
}

/** Proto `.eyebrow` section label. */
function Eyebrow({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return (
    <Txt w="eb" size={11} color={c.textTertiary} ls={1.4} upper style={[{ marginBottom: 10 }, style]}>
      {children}
    </Txt>
  );
}

/** Proto `.ob-input` treatment shared by Input + PasswordInput call sites:
 *  56px tall, 16 radius, surface2 + 1.5 hairline, no floating shadow. */
const fieldStyle = (c: ReturnType<typeof useColors>) =>
  ({
    height: 56,
    borderRadius: 16,
    backgroundColor: c.surface2,
    borderWidth: 1.5,
    borderColor: c.hairline,
    fontSize: 16,
    shadowOpacity: 0,
    elevation: 0,
  }) as const;

function ObInput(props: React.ComponentProps<typeof Input>) {
  const c = useColors();
  return <Input {...props} style={[fieldStyle(c), props.style]} />;
}

/** Proto `.chp` chip: pill, surface2 + hairline; selected = accent tint + accent border
 *  + accent text (the proto's tinted selection, not a solid fill). */
function Chp({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => ({
        paddingVertical: 11,
        paddingHorizontal: 17,
        borderRadius: 999,
        backgroundColor: on ? c.accentSurface : c.surface2,
        borderWidth: 1.5,
        borderColor: on ? c.accent : c.hairline,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Txt w="b" size={14} color={on ? c.accent : c.slate700}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Proto `.sidebox`: an icon tile + a short titled note on a quiet surface. */
function Sidebox({ icon, tint, title, text, style }: { icon: IconName; tint: string; title: string; text: string; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 15, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }, style]}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: `${tint}26`, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="eb" size={13.5}>{title}</Txt>
        <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

/** Quiet content tile (the proto's surface2 + hairline panel). */
function Tile({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 18, padding: 16 }, style]}>
      {children}
    </View>
  );
}

/** Proto `.code-boxes`: one letter per box, accent-tinted when the code is real. */
function CodeBoxes({ code, sample }: { code: string; sample?: boolean }) {
  const c = useColors();
  const chars = code.split('');
  const w = chars.length > 6 ? 38 : 46;
  return (
    <Row style={{ gap: chars.length > 6 ? 7 : 9, justifyContent: 'center' }}>
      {chars.map((ch, i) => (
        <View
          key={i}
          style={{
            width: w,
            height: 56,
            borderRadius: 13,
            backgroundColor: sample ? c.surface2 : c.accentSurface,
            borderWidth: 1.5,
            borderColor: sample ? c.hairline : c.accentBorder,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt w="eb" size={22} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {ch}
          </Txt>
        </View>
      ))}
    </Row>
  );
}

/** Proto skip link ("Skip for now" — centered, muted). */
function SkipLink({ label = 'Skip for now', onPress }: { label?: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({ alignSelf: 'center', paddingTop: 14, opacity: pressed ? 0.6 : 1 })}
    >
      <Txt w="b" size={14} color={c.textTertiary}>
        {label}
      </Txt>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ shared shell */
function StepShell({
  step,
  total,
  onBack,
  eyebrow,
  title,
  sub,
  children,
  footer,
}: {
  /** 1-based current step for the dot progress; omit (with total) to hide dots. */
  step?: number | null;
  total?: number | null;
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
        <View style={{ height: 40, justifyContent: 'center' }}>
          {step != null && total != null ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }}>
              <ObDots step={step} total={total} />
            </View>
          ) : null}
          {onBack ? <BackChip onPress={onBack} /> : null}
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <Reveal index={0}>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <Txt w="eb" size={27} ls={-0.8} style={{ lineHeight: 31 }}>
            {title}
          </Txt>
          {sub ? (
            <Txt w="sb" size={14.5} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 22 }}>
              {sub}
            </Txt>
          ) : null}
        </Reveal>
        <Reveal index={1} style={{ marginTop: 22 }}>{children}</Reveal>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingBottom: 34, paddingTop: 14 }}>{footer}</View>
    </View>
  );
}

/** Big tappable option row — the primary answer affordance (proto tile language:
 *  surface2 + hairline, accent tint + border when selected). */
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
        backgroundColor: selected ? c.accentSurface : c.surface2,
        borderWidth: 1.5,
        borderColor: selected ? c.accent : c.hairline,
        borderRadius: 18,
        paddingVertical: 17,
        paddingHorizontal: 18,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <Txt w="b" size={15} color={selected ? c.accent : c.text}>
          {label}
        </Txt>
        {sub ? (
          <Txt w="sb" size={12.5} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 17 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? c.accent : c.slate300, backgroundColor: selected ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 64, paddingHorizontal: 24, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <Row style={{ gap: 10 }}>
          <LogoMark size={30} onDark={scheme === 'dark'} />
          <Txt w="eb" size={20} ls={-0.4}>
            <Txt w="eb" size={20} color={c.successDeep}>On</Txt>Standard
          </Txt>
        </Row>
        <Reveal index={0} style={{ marginTop: 34 }}>
          <Txt w="eb" size={27} ls={-0.8} style={{ lineHeight: 31 }}>
            Who are you?
          </Txt>
          <Txt w="sb" size={14.5} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 22 }}>
            Your name sits next to everything you log — make it the real one. A few quick questions and OnStandard is tailored to exactly how you&apos;ll use it.
          </Txt>
        </Reveal>
        <Reveal index={1} style={{ marginTop: 26 }}>
          <Eyebrow>Your name</Eyebrow>
          <View style={{ gap: 12 }}>
            <ObInput value={first} onChangeText={onFirst} placeholder="First name" autoCapitalize="words" returnKeyType="next" />
            <ObInput value={last} onChangeText={onLast} placeholder="Last name" autoCapitalize="words" returnKeyType="done" />
          </View>
        </Reveal>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingBottom: 34, gap: 14 }}>
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
          <Sidebox
            icon="send"
            tint={c.success}
            title="Reset link on its way"
            text="If an account exists for that email, a reset link is on its way. Check your inbox (and spam)."
          />
        ) : (
          <View style={{ gap: 12 }}>
            <ObInput value={email} onChangeText={setEmail} placeholder="Email address" autoCapitalize="none" keyboardType="email-address" />
            {authError ? <Txt w="sb" size={13} color={c.alert}>{authError}</Txt> : null}
          </View>
        )}
      </StepShell>
    );
  }

  return (
    <StepShell
      onBack={() => { setAuthError(null); exitSignin(); }}
      title="Welcome back"
      sub="Pick up right where you left off."
      footer={<Btn label={busy ? 'Signing in...' : 'Sign in'} disabled={busy} onPress={onSubmit} />}
    >
      <View style={{ gap: 12 }}>
        <ObInput value={email} onChangeText={setEmail} placeholder="Email address" autoCapitalize="none" keyboardType="email-address" />
        <PasswordInput value={password} onChangeText={setPassword} placeholder="Password" style={fieldStyle(c)} />
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
 *  expo-apple-authentication is added. See src/lib/auth/apple.ts. Apple mandates the
 *  black treatment — it stays black in every theme. */
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
function CreateAccountForm({ step, total, title, sub, onDone }: { step: number; total: number; title: string; sub: string; onDone: () => void }) {
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
        step={step}
        total={total}
        onBack={s.obBack}
        eyebrow="Almost there"
        title={pending ? 'Confirm your email' : "You're all set"}
        sub={pending ? 'We sent a confirmation link to keep your account secure.' : 'Your account is ready to go.'}
        footer={<Btn label="Continue" haptic="success" onPress={onDone} />}
      >
        <Sidebox
          icon={pending ? 'bell' : 'check'}
          tint={c.success}
          title={pending ? 'Check your inbox' : "You're signed in"}
          text={pending
            ? `Check ${email.trim()} for a link. You can keep going now — your data stays on this device until you confirm.`
            : `You're signed in as ${email.trim()}. Let's keep going.`}
        />
      </StepShell>
    );
  }

  return (
    <StepShell
      step={step}
      total={total}
      onBack={s.obBack}
      eyebrow="Last step"
      title={title}
      sub={sub}
      footer={<Btn label={busy ? 'Creating...' : 'Create account'} disabled={busy || !ready || !s.termsAcceptedAt} onPress={onCreate} />}
    >
      <View style={{ gap: 12 }}>
        <ObInput value={email} onChangeText={setEmail} placeholder="Email address" autoCapitalize="none" keyboardType="email-address" />
        {email.length > 0 && errors.email ? <FieldError text={errors.email} /> : null}
        <PasswordInput value={password} onChangeText={setPassword} placeholder="Password" style={fieldStyle(c)} />
        {password.length > 0 && errors.password ? <FieldError text={errors.password} /> : null}
        <PasswordInput value={confirm} onChangeText={setConfirm} placeholder="Confirm password" style={fieldStyle(c)} />
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
/** Per-archetype accent for the role tile icon chips (proto choice-grid gives every
 *  role its own tint: athlete green, client purple, team amber, nutrition cyan). */
function roleTint(c: ReturnType<typeof useColors>, archetype: string): string {
  switch (archetype) {
    case 'athlete': return c.success;
    case 'client': return c.purple;
    case 'team': return c.warning;
    case 'nutrition': return c.cyan;
    default: return c.accent; // parent
  }
}

function RolePicker() {
  const c = useColors();
  const { scheme } = useTheme();
  const { role, setRole, obNext, obBack } = useStore();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: 60, paddingHorizontal: 24 }}>
        <View style={{ height: 40, justifyContent: 'center' }}>
          <BackChip onPress={obBack} />
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {/* Proto roles.js header: centered mark, centered title + sub. */}
        <Reveal index={0} style={{ alignItems: 'center' }}>
          <LogoMark size={56} onDark={scheme === 'dark'} />
          <Txt w="eb" size={27} ls={-0.8} style={{ lineHeight: 31, marginTop: 18, textAlign: 'center' }}>
            How will you use OnStandard?
          </Txt>
          <Txt w="sb" size={14.5} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 22, textAlign: 'center' }}>
            Each role gets its own view. Nothing shared that shouldn&apos;t be.
          </Txt>
        </Reveal>
        {/* Proto choice-grid: 2-up tiles, tinted icon chip, title + sub. */}
        <Reveal index={1} style={{ marginTop: 22 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 11 }}>
            {ROLE_DEFS.map((r) => {
              const selected = role === r.key;
              const tint = roleTint(c, r.archetype);
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
                    width: '47.8%',
                    backgroundColor: selected ? c.accentSurface : c.surface2,
                    borderWidth: 1.5,
                    borderColor: selected ? c.accent : c.hairline,
                    borderRadius: 18,
                    paddingVertical: 17,
                    paddingHorizontal: 15,
                    opacity: pressed ? 0.92 : 1,
                  })}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: `${tint}26`, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={r.icon as IconName} size={19} color={tint} />
                  </View>
                  <Txt w="eb" size={15} style={{ marginTop: 9 }}>
                    {r.title}
                  </Txt>
                  <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 3, lineHeight: 16 }}>
                    {r.sub}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </Reveal>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingBottom: 34, paddingTop: 14 }}>
        <Btn label="Continue" disabled={!role} onPress={obNext} />
      </View>
    </View>
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
  const stepNo = idx + 1;
  const total = ATHLETE_KEYS.length;

  // Compute the Starting Point Score the moment we land on the reveal.
  useEffect(() => {
    if (key === 'score' && s.startScore == null) s.commitStartingScore();
  }, [key, s.startScore]); // eslint-disable-line react-hooks/exhaustive-deps

  const cont = (canContinue: boolean, label = 'Continue') => (
    <Btn label={label} disabled={!canContinue} onPress={s.obNext} />
  );

  switch (key) {
    case 'goal':
      // Proto step 2 ("What are we building?") — the full grouped goal list stays
      // (it drives AI coaching + the scoring profile), styled as proto chip rows.
      return (
        <StepShell step={stepNo} total={total} onBack={s.obBack} title="What are we building?" sub={`This shapes every piece of ${aiPrefix}coaching you'll get.`} footer={cont(!!s.primaryGoal)}>
          {GOAL_GROUPS.map((g) => (
            <View key={g.group} style={{ marginBottom: 20 }}>
              <Eyebrow>{g.group}</Eyebrow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
                {g.options.map((o) => (
                  <Chp key={o.key} label={o.label} on={s.primaryGoal === o.key} onPress={() => s.setPrimaryGoal(o.key)} />
                ))}
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
          step={stepNo}
          total={total}
          onBack={s.obBack}
          title="What sport do you play?"
          sub={sportOptional ? 'Optional — skip if your goal isn’t sport-specific.' : undefined}
          footer={cont(sportOptional || !!s.sport)}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {[...SPORTS, 'Other'].map((sp) => (
              <Chp key={sp} label={sp} on={s.sport === sp} onPress={() => s.setSport(sp)} />
            ))}
          </View>
          {s.sport ? (
            <View style={{ marginTop: 24 }}>
              <Eyebrow>Position · optional</Eyebrow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
                {positions.map((p) => (
                  <Chp key={p} label={p} on={s.position === p} onPress={() => s.setPosition(p)} />
                ))}
              </View>
            </View>
          ) : null}
        </StepShell>
      );
    }

    case 'profile': {
      // Training frequency is merged in here (compact chips) so it isn't its own step.
      // Target weight DISPLAYS the goal-derived default (points the right way for the goal)
      // until the athlete adjusts it — so a Lose Fat user never sees a target ABOVE their
      // weight that then silently flips to the derived value later (the audit bug).
      const derivedTarget = deriveTargetsFromGoal(s.baseGoal, s.baseWeight).weightTarget;
      const shownTarget = s.weightTargetTouched ? s.weightTarget : derivedTarget;
      const targetHint =
        s.baseGoal === 'lose' ? `Aiming ${Math.max(0, s.baseWeight - shownTarget)} lb below your current weight.`
        : s.baseGoal === 'gain' ? `Aiming ${Math.max(0, shownTarget - s.baseWeight)} lb above your current weight.`
        : s.baseGoal === 'maintain' ? 'Holding around your current weight.'
        : '';
      return (
        <StepShell
          step={stepNo}
          total={total}
          onBack={s.obBack}
          title="Where are you now?"
          sub="Tap to adjust — this calibrates your targets."
          footer={cont(true)}
        >
          <View style={{ gap: 14 }}>
            <Row style={{ gap: 12 }}>
              <Stepper label="Age" value={String(s.baseAge)} unit="years" onDec={() => s.ageStep(-1)} onInc={() => s.ageStep(1)} onSet={s.setBaseAge} />
              <Stepper label="Height" value={formatHeight(s.baseHeight)} onDec={() => s.hStep(-1)} onInc={() => s.hStep(1)} />
            </Row>
            <Row style={{ gap: 12 }}>
              <Stepper label="Weight" value={String(s.baseWeight)} unit="lb" onDec={() => s.bwStep(-1)} onInc={() => s.bwStep(1)} onSet={s.setBaseWeight} />
              <Stepper label="Target weight" value={String(shownTarget)} unit="lb" onDec={() => s.adjustWeightTarget(-1)} onInc={() => s.adjustWeightTarget(1)} onSet={s.setWeightTarget} />
            </Row>
            {targetHint ? (
              <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: -6 }}>
                {targetHint}
              </Txt>
            ) : null}
            {/* Proto step 3 sidebox — true here too: weight is a season trend, never scored daily. */}
            <Sidebox
              icon="shield"
              tint={c.accent}
              title="How weight works in OnStandard"
              text="Weight is a season trend here, never a daily judgment. It never moves your daily score, so one heavy morning can't wreck a perfect day."
            />
          </View>
        </StepShell>
      );
    }

    case 'baseline':
      // All six habit questions on ONE screen (was six separate steps). Same setters,
      // same starting-score math; compact controls so it's a ~30-second scroll.
      return (
        <StepShell step={stepNo} total={total} onBack={s.obBack} eyebrow="Baseline" title="A few quick habits" sub="Roughly is fine. This is what sets your starting score." footer={cont(true)}>
          <View style={{ gap: 20 }}>
            <MiniScale label="Confidence in your nutrition" value={s.baseNutritionConfidence} low="Not at all" high="Dialed in" onChange={(v) => s.setBaseAnswer('baseNutritionConfidence', v)} />
            <MiniScale label="Week-to-week consistency" value={s.baseConsistency} low="All over" high="Locked in" onChange={(v) => s.setBaseAnswer('baseConsistency', v)} />
            <View>
              <Txt w="b" size={14} color={c.slate700} style={{ marginBottom: 9 }}>How often do you hit your protein target?</Txt>
              <Row style={{ flexWrap: 'wrap', gap: 8 }}>
                {PROTEIN_FREQ.map((o) => (
                  <Chp key={o.key} label={o.label} on={s.baseProteinFreq === Number(o.key)} onPress={() => s.setBaseAnswer('baseProteinFreq', Number(o.key))} />
                ))}
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
      // Only promise "today's challenge" when the challenge is actually next (with the
      // backend live, account + consent come first).
      const nextIsChallenge = ATHLETE_KEYS[idx + 1] === 'challenge';
      return (
        <StepShell
          step={stepNo}
          total={total}
          onBack={s.obBack}
          eyebrow="Your Starting OnStandard Score"
          title={name ? `${name}, here's where you stand.` : "Here's where you stand."}
          sub="This is your starting point, estimated from your habits. It rises as OnStandard learns from what you actually do."
          footer={<Btn label={nextIsChallenge ? "See today's challenge" : 'Continue'} onPress={s.obNext} />}
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
          step={stepNo}
          total={total}
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
          step={stepNo}
          total={total}
          onBack={s.obBack}
          eyebrow="Before you start"
          title={minor ? 'Your data, with a guardian' : 'Your data, your control'}
          sub="OnStandard only ever shares what you allow, and you can stop any time."
          footer={
            // Two genuine, non-contradictory actions (audit fix): the SHARE path is gated
            // on the agree checkbox; the KEEP-LOCAL path is always available and never
            // requires agreeing to share. Before, one button said "stays on this device"
            // yet was disabled until you consented to share — a direct contradiction.
            <View style={{ gap: 8 }}>
              <Btn
                label={minor && !verified ? "Share with a guardian's OK" : 'Agree and continue'}
                disabled={!s.realDataConsent}
                onPress={s.obNext}
              />
              {!verified ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Keep my data on this device for now"
                  hitSlop={8}
                  onPress={() => { haptics.tap(); s.recordConsent(false); s.obNext(); }}
                  style={({ pressed }) => ({ alignSelf: 'center', paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}
                >
                  <Txt w="b" size={14} color={c.textSecondary}>
                    Keep it on this device for now
                  </Txt>
                </Pressable>
              ) : null}
            </View>
          }
        >
          {/* Age is confirmed HERE, at the moment it decides the guardian requirement, not silently
              defaulted from the earlier "About you" step (COPPA gate — audit/founder fix). isMinor
              recomputes reactively as this changes, so the screen switches between adult/minor. */}
          <Tile>
            <Eyebrow>Confirm your age</Eyebrow>
            <Stepper label="Age" value={String(s.baseAge)} unit="years" onDec={() => s.ageStep(-1)} onInc={() => s.ageStep(1)} />
            <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 10, lineHeight: 17 }}>
              Under 18 needs a parent or guardian&apos;s approval before anything is shared with a coach.
            </Txt>
          </Tile>
          <Tile style={{ marginTop: 12 }}>
            <Txt w="m" size={14.5} color={c.slate700} style={{ lineHeight: 22 }}>
              {consentSummary(minor)}
            </Txt>
          </Tile>
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
            <View style={{ marginTop: 12 }}>
              <Eyebrow style={{ marginBottom: 8 }}>Parent or guardian approval</Eyebrow>
              <ObInput
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
    default: {
      // Proto step 6 — the "Your Standard is set." confirmation. The halo-check moment,
      // an honest summary of what the score is built from, the real tier ladder ("score
      // to beat" comes from core/tiers.ts, not a hardcoded number), today's first-meal
      // challenge (+3 — same activation semantics), and the green "Start Day 1" CTA
      // (still startFirstMealChallenge: it lands straight in capture).
      const onStandard = TIERS.find((t) => t.key === 'onstandard') ?? TIERS[0];
      return (
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          <View style={{ paddingTop: 60, paddingHorizontal: 24 }}>
            <View style={{ height: 40, justifyContent: 'center' }}>
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }}>
                <ObDots step={total} total={total} />
              </View>
              <BackChip onPress={s.obBack} />
            </View>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            <Reveal index={0} style={{ alignItems: 'center' }}>
              {/* Proto .standard-set halo + core: green glow ring, green core, dark check. */}
              <View style={{ width: 130, height: 130, borderRadius: 65, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center', ...shadow.ctaGreen }}>
                  <Icon name="check" size={38} color={c.onGreen} strokeWidth={2.5} />
                </View>
              </View>
              <Txt w="eb" size={27} ls={-0.8} style={{ marginTop: 22, lineHeight: 31, textAlign: 'center' }}>
                Your Standard is set.
              </Txt>
              <Txt w="sb" size={14.5} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 22, textAlign: 'center', paddingHorizontal: 10 }}>
                Starting now, your execution score is built from what you actually do — meals, recovery, check-ins. It moves the moment you do the work.
              </Txt>
            </Reveal>
            <Reveal index={1} style={{ marginTop: 26, alignSelf: 'stretch' }}>
              <Sidebox
                icon="camera"
                tint={c.success}
                title="Today's challenge — upload your first meal"
                text={isAiConfigured
                  ? 'One photo. Your AI nutrition coach reads it, scores it, and shows you exactly what to do next, instantly. +3 to your score.'
                  : 'Log your meal and your nutrition coach scores it and shows you exactly what to do next, instantly. +3 to your score.'}
              />
              {/* Proto tiles2: the standard to chase, from the real tier ladder. */}
              <Row style={{ gap: 12, marginTop: 12 }}>
                <Tile style={{ flex: 1, padding: 15 }}>
                  <Txt w="eb" size={11} color={c.textTertiary} ls={0.8} upper>Score to beat</Txt>
                  <Txt w="eb" size={20} ls={-0.4} style={{ marginTop: 5 }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {onStandard.min}
                  </Txt>
                </Tile>
                <Tile style={{ flex: 1, padding: 15 }}>
                  <Txt w="eb" size={11} color={c.textTertiary} ls={0.8} upper>That tier</Txt>
                  <Txt w="eb" size={20} ls={-0.4} color={tierChip.g.fg} style={{ marginTop: 5 }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {onStandard.name}
                  </Txt>
                </Tile>
              </Row>
            </Reveal>
          </ScrollView>
          <View style={{ paddingHorizontal: 24, paddingBottom: 34, paddingTop: 14 }}>
            <Btn label="Start Day 1" haptic="success" onPress={s.startFirstMealChallenge} />
          </View>
        </View>
      );
    }
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
      style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
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
  return <GenericStep step={step} stepNo={idx + 1} total={flow.length} />;
}

function GenericStep({ step, stepNo, total }: { step: GenStep; stepNo: number; total: number }) {
  const c = useColors();
  const s = useStore();
  const val = step.kind === 'select' || step.kind === 'multiselect' || step.kind === 'text' ? s.obMeta[step.field] : undefined;

  // On the invite step, when the backend is live, mint the overseer's real team
  // via the create_team RPC so the shared code is the genuine server-generated one.
  // Inert when the flag is off (createTeamLive no-ops) — the demo keeps EAGLES24.
  const { teamCode, obMeta, createTeamLive, createPracticeLive, teamDiscoverable, role } = s;
  useEffect(() => {
    if (step.kind !== 'invite' || !isBackendLive || teamCode) return;
    // Trainers/nutritionists get a PRACTICE (handle-discoverable); everyone else a TEAM.
    if (role === 'personal_trainer' || role === 'nutritionist') {
      const handle = typeof obMeta.handle === 'string' ? obMeta.handle.trim() : '';
      const practiceName = typeof obMeta.school === 'string' && obMeta.school.trim() ? obMeta.school.trim() : 'My Practice';
      void createPracticeLive(practiceName, handle || null, !!handle);
      return;
    }
    const sport = typeof obMeta.sport === 'string' ? obMeta.sport : undefined;
    const school = typeof obMeta.school === 'string' ? obMeta.school.trim() : '';
    const orgId = typeof obMeta.orgId === 'string' && obMeta.orgId ? obMeta.orgId : null;
    const name = school || (sport ? `${sport} team` : 'My Team');
    void createTeamLive(name, sport, orgId, teamDiscoverable);
  }, [step.kind, teamCode, obMeta, createTeamLive, createPracticeLive, teamDiscoverable, role]);

  if (step.kind === 'invite') {
    // Only a REAL server-minted code earns the "share it with your team" moment.
    // Handing a coach the demo fallback with a Share CTA meant they could text a
    // dead code to their whole roster (the audit's team-code P0) — the sample
    // state now says exactly what it is and routes forward without a share.
    const realCode = !!s.teamCode?.trim();
    const shareCode = async () => {
      try {
        await Share.share({ message: `Join our team on OnStandard — enter team code ${s.teamCode} after you sign up.` });
      } catch { /* user cancelled the share sheet */ }
    };
    return (
      <StepShell
        step={stepNo}
        total={total}
        onBack={s.obBack}
        eyebrow="Activate"
        title={step.title}
        sub={realCode ? step.sub : 'Your real team code will be ready on your dashboard. Here is what it will look like.'}
        footer={
          <View>
            {realCode
              ? <Btn label={step.cta} haptic="success" onPress={() => { void shareCode(); s.finishOb(); }} />
              : <Btn label="Go to your dashboard" haptic="success" onPress={s.finishOb} />}
            <SkipLink onPress={s.finishOb} />
          </View>
        }
      >
        {/* Proto code-boxes: one letter per box; tinted only when the code is real. */}
        <Eyebrow style={{ textAlign: 'center' }}>{realCode ? step.codeLabel : 'Example team code'}</Eyebrow>
        <CodeBoxes code={s.teamCode || 'EAGLES24'} sample={!realCode} />
        {!realCode ? (
          <Row style={{ gap: 6, marginTop: 14, alignItems: 'flex-start' }}>
            <SampleTag />
            <Txt w="sb" size={12} color={c.textTertiary} style={{ flex: 1, lineHeight: 17 }}>
              Sample — don&apos;t share this one. Your code appears on the Roster tab once your team is set up.
            </Txt>
          </Row>
        ) : null}
      </StepShell>
    );
  }

  if (step.kind === 'account') {
    return <CreateAccountForm step={stepNo} total={total} title={step.title} sub={step.sub} onDone={s.obNext} />;
  }

  if (step.kind === 'orgpicker') {
    return <OrgPicker step={step} stepNo={stepNo} total={total} />;
  }

  if (step.kind === 'text') {
    const cur = typeof val === 'string' ? val : '';
    return (
      <StepShell step={stepNo} total={total} onBack={s.obBack} title={step.title} sub={step.sub} footer={<Btn label="Continue" disabled={cur.trim().length < 1} onPress={s.obNext} />}>
        <ObInput value={cur} onChangeText={(v) => s.setObMeta(step.field, v)} placeholder={step.placeholder} autoCapitalize="words" />
      </StepShell>
    );
  }

  if (step.kind === 'multiselect') {
    const arr = Array.isArray(val) ? val : [];
    return (
      <StepShell step={stepNo} total={total} onBack={s.obBack} title={step.title} sub={step.sub} footer={<Btn label="Continue" disabled={arr.length < 1} onPress={s.obNext} />}>
        {step.options.map((o) => (
          <OptionRow key={o.key} label={o.label} selected={arr.includes(o.key)} onPress={() => s.toggleObMetaItem(step.field, o.key)} />
        ))}
      </StepShell>
    );
  }

  // select
  return (
    <StepShell step={stepNo} total={total} onBack={s.obBack} title={step.title} sub={step.sub} footer={<Btn label="Continue" disabled={!val} onPress={s.obNext} />}>
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
function OrgPicker({ step, stepNo, total }: { step: Extract<GenStep, { kind: 'orgpicker' }>; stepNo: number; total: number }) {
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
      step={stepNo}
      total={total}
      onBack={s.obBack}
      title={step.title}
      sub={step.sub}
      footer={<Btn label="Continue" disabled={!ready} onPress={s.obNext} />}
    >
      <ObInput value={query} onChangeText={onChange} placeholder="Search your school or club" autoCapitalize="words" />
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
              style={({ pressed }) => ({ backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.accentBorder, borderStyle: 'dashed', borderRadius: 18, paddingVertical: 15, paddingHorizontal: 18, opacity: pressed ? 0.9 : 1 })}
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
  const welcomeDone = useStore((s: Store) => s.welcomeDone);
  const obStep = useStore((s: Store) => s.obStep);
  const role = useStore((s: Store) => s.role);

  let content: React.ReactNode;
  // Sign In takes priority even when it was launched from the landing screen.
  if (signinMode) content = <SignIn />;
  // The branded landing is the front door: it shows until "Get Started" (passWelcome)
  // reveals the existing steps below. All existing onboarding logic is untouched.
  else if (!welcomeDone) content = <WelcomeLanding />;
  else if (obStep === 0) content = <Welcome />;
  else if (obStep === 1) content = <RolePicker />;
  else content = flowForRole(role) === 'app' && (role === 'athlete' || role == null) ? <AthleteFlow /> : <GenericFlow />;

  // The key remounts StepEnter on every step so the new screen fades + rises in, making the flow
  // feel fluid instead of hard-cutting between identical-looking forms.
  const key = signinMode ? 'signin' : !welcomeDone ? 'landing' : `step-${obStep}`;
  return <StepEnter key={key}>{content}</StepEnter>;
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
