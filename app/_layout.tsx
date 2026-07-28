import React from 'react';
import { AppState, View, useColorScheme, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { darkColors, lightColors, DEVICE_MAX_WIDTH } from '@/ui/tokens';
import { ThemeProvider } from '@/ui/theme';
import { useStore } from '@/store';
import { useFlagsStore } from '@/store/flagsStore';

export default function RootLayout() {
  const [loaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  // Active appearance: the user's preference, or the OS setting when on 'auto'. Drives the
  // palette (via ThemeProvider) and the native chrome (status bar + the frame background).
  const themeMode = useStore((s) => s.themeMode);
  const os = useColorScheme();
  // The redesign is a dark-premium experience, so dark is the default: an unset or 'dark'
  // preference renders dark; 'auto' follows the OS; only an explicit 'light' opts out.
  const scheme: 'light' | 'dark' =
    themeMode === 'auto' ? (os === 'dark' ? 'dark' : 'light') : themeMode === 'light' ? 'light' : 'dark';
  const palette = scheme === 'dark' ? darkColors : lightColors;

  // Oversight roles (coach / trainer / parent) are used on a laptop, not just a phone, so on a
  // genuinely wide screen they get a roomier frame instead of the phone-width column that made
  // the coach product feel like an emulator on desktop (the audit). Athletes + onboarding stay
  // phone-first. Reactive via useWindowDimensions so a browser resize re-flows.
  const flow = useStore((s) => s.flow);
  const { width } = useWindowDimensions();
  const isOversight = flow === 'coach' || flow === 'trainer' || flow === 'parent';
  const frameMaxWidth = isOversight && width >= 900 ? 760 : DEVICE_MAX_WIDTH;

  // Local reminders are exec-driven now: the proto posts NOTIFY_SYNC via the bridge.

  // Runtime feature flags: hydrate the cached map at launch, then fetch the caller's evaluated
  // flags, and re-fetch on foreground resume so a kill-switch/flip is picked up. Fire-and-forget —
  // never blocks render; on failure the last cache (or safe defaults) stands.
  React.useEffect(() => {
    const flags = useFlagsStore.getState();
    flags.hydrate().then(() => flags.refresh());
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') useFlagsStore.getState().refresh();
    });
    return () => sub.remove();
  }, []);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: palette.bg }} />;
  }

  return (
    <ThemeProvider scheme={scheme}>
      <SafeAreaProvider>
        {/* Center a phone-width frame on wide screens (web/tablet); oversight roles get more room. */}
        <View style={{ flex: 1, backgroundColor: palette.bg2, alignItems: 'center' }}>
          <View style={{ flex: 1, width: '100%', maxWidth: frameMaxWidth, backgroundColor: palette.bg }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }} />
          </View>
        </View>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
