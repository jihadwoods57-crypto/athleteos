import React from 'react';
import { View, useColorScheme } from 'react-native';
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
  const scheme: 'light' | 'dark' = themeMode === 'auto' ? (os === 'dark' ? 'dark' : 'light') : themeMode;
  const palette = scheme === 'dark' ? darkColors : lightColors;

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: palette.bg }} />;
  }

  return (
    <ThemeProvider scheme={scheme}>
      <SafeAreaProvider>
        {/* Center a phone-width frame on wide screens (web/tablet). */}
        <View style={{ flex: 1, backgroundColor: palette.bg2, alignItems: 'center' }}>
          <View style={{ flex: 1, width: '100%', maxWidth: DEVICE_MAX_WIDTH, backgroundColor: palette.bg }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }} />
          </View>
        </View>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
