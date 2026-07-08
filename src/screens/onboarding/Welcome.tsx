// OnStandard — the branded Welcome / landing screen. Faithful rebuild of the proto's
// auth entry (proto/redesign-2026-07/js/screens/auth.js + css/flows.css .welcome block):
// the green→cyan→blue check-ring mark, the On·Standard wordmark, the brandline, the
// three-line tagline, then the green "Get Started" CTA, a ghost "Sign In", and the role
// note. This is the FIRST thing a new user sees; "Get Started" reveals the existing
// onboarding steps (passWelcome), "Sign In" opens the existing sign-in path (startSignin).
import React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useStore } from '@/store';
import { useColors } from '@/ui/theme';
import { Btn, Txt } from '@/ui/primitives';
import { LogoMark } from '@/brand/Logo';

/**
 * Landing screen. Two buttons route into existing flow actions — no onboarding logic
 * lives here beyond the front-door gate.
 */
export function Welcome() {
  const c = useColors();
  const { passWelcome, startSignin } = useStore();

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingTop: 54, paddingHorizontal: 30, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Check-ring mark (~104px) with the proto's green + blue under-glow. */}
        <View
          style={{
            marginBottom: 24,
            // Approximates the proto's drop-shadow(0 0 34px rgba(52,211,153,.35)) glow.
            ...Platform.select({
              ios: { shadowColor: c.success, shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 0 } },
              android: { elevation: 0 },
              default: {},
            }),
          }}
        >
          <LogoMark size={104} onDark />
        </View>

        {/* Wordmark: "On" green-bright, "Standard" near-white. Plus Jakarta 800. */}
        <Txt w="eb" size={38} ls={-1.7} style={{ lineHeight: 38, textAlign: 'center' }}>
          <Txt w="eb" size={38} ls={-1.7} color={c.successDeep}>On</Txt>Standard
        </Txt>

        {/* Brandline — small, uppercase, wide letter-spacing, muted. */}
        <Txt w="eb" size={11} ls={2.4} upper color={c.textTertiary} style={{ marginTop: 10, textAlign: 'center' }}>
          Athlete execution platform
        </Txt>

        {/* Tagline — three centered lines. */}
        <Txt w="sb" size={15.5} color={c.textSecondary} style={{ marginTop: 18, lineHeight: 25, textAlign: 'center' }}>
          The coach sets the standard.{'\n'}You prove the work.{'\n'}The score never lies.
        </Txt>

        {/* Spacer pushes the actions toward the bottom of a tall screen. */}
        <View style={{ flex: 1, minHeight: 40 }} />

        {/* Actions + role note, full width. */}
        <View style={{ alignSelf: 'stretch' }}>
          <Btn label="Get Started" haptic="success" onPress={passWelcome} />
          <Btn
            label="Sign In"
            variant="secondary"
            onPress={startSignin}
            // Match the proto's ghost button exactly: elevated surface + hairline, no glow.
            style={{ marginTop: 10, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, shadowOpacity: 0, elevation: 0 }}
          />
          <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 14, lineHeight: 18, textAlign: 'center' }}>
            Athlete, client, coach, or trainer — every role has its own view.{'\n'}Parents join from an athlete's invite.
          </Txt>
        </View>
      </ScrollView>
    </View>
  );
}
