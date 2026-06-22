// AthleteOS — logo system. The Athlete Score ring resolving into a rising check.
// Construction transcribed from Logo.dc.html / README (100×100 viewBox).
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors, font } from '@/ui/tokens';
import { Txt } from '@/ui/primitives';

export function LogoMark({ size = 56, onDark = false }: { size?: number; onDark?: boolean }) {
  const gid = `lg${onDark ? 'd' : 'l'}`;
  const track = onDark ? 'rgba(255,255,255,0.32)' : '#E5EDFB';
  const arc = onDark ? '#60A5FA' : undefined;
  const check = onDark ? '#FFFFFF' : colors.accent;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#3B82F6" />
          <Stop offset="1" stopColor="#2563EB" />
        </LinearGradient>
      </Defs>
      <Circle cx={50} cy={50} r={37} fill="none" stroke={track} strokeWidth={11} />
      <Circle
        cx={50}
        cy={50}
        r={37}
        fill="none"
        stroke={arc ?? `url(#${gid})`}
        strokeWidth={11}
        strokeLinecap="round"
        strokeDasharray="170 63"
        transform="rotate(128 50 50)"
      />
      <Path d="M32 52 L45 65 L72 31" fill="none" stroke={check} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** App icon — mark in white on a blue gradient rounded square. */
export function AppIcon({ size = 58, radius }: { size?: number; radius?: number }) {
  const rad = radius ?? size * 0.24;
  return (
    <View style={{ width: size, height: size, borderRadius: rad, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="appicon-bg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#3B82F6" />
            <Stop offset="1" stopColor="#2563EB" />
          </LinearGradient>
        </Defs>
        <Path d="M0 0 H100 V100 H0 Z" fill="url(#appicon-bg)" />
        <Circle cx={50} cy={50} r={37} fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth={11} />
        <Circle
          cx={50}
          cy={50}
          r={37}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={11}
          strokeLinecap="round"
          strokeDasharray="170 63"
          transform="rotate(128 50 50)"
          opacity={0.9}
        />
        <Path d="M32 52 L45 65 L72 31" fill="none" stroke="#FFFFFF" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/** Full lockup: mark + AthleteOS wordmark. */
export function Logo({ size = 40, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} onDark={onDark} />
      <Txt style={{ fontFamily: font.eb, letterSpacing: -0.04 * (size * 0.55) }} size={size * 0.55} color={onDark ? '#fff' : colors.text}>
        Athlete<Txt style={{ fontFamily: font.eb }} size={size * 0.55} color={colors.accent}>OS</Txt>
      </Txt>
    </View>
  );
}
