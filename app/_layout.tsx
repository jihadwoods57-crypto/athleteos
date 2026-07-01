import React from 'react';
import { View } from 'react-native';
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
import { colors, DEVICE_MAX_WIDTH } from '@/ui/tokens';
import { ThemeProvider } from '@/ui/theme';

export default function RootLayout() {
  const [loaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    // Theming foundation: defaults to light, so the app is visually unchanged today.
    // Flipping the scheme (OS setting or a toggle) is all dark mode will need once
    // components migrate to useColors().
    <ThemeProvider initial="light">
      <SafeAreaProvider>
        {/* Center a phone-width frame on wide screens (web/tablet). */}
        <View style={{ flex: 1, backgroundColor: colors.bg2, alignItems: 'center' }}>
          <View style={{ flex: 1, width: '100%', maxWidth: DEVICE_MAX_WIDTH, backgroundColor: colors.bg }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
          </View>
        </View>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
