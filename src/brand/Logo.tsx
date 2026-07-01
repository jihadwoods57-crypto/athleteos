// OnStandard — logo system. The "Performance Dial": a score gauge reading at the
// very top of its scale (on standard) whose silhouette also reads as an "O".
// Geometry transcribed 1:1 from the brand handoff Logo.dc.html (100×100 viewBox).
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { font } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Txt } from '@/ui/primitives';

// Shared dial geometry (viewBox 0 0 100 100, fill="none"). Track = the unfilled
// remainder with a gap at the bottom; progress = the filled sweep up to the top
// marker sitting "on standard". Center (50,52), radius 34.
const TRACK_D = 'M33 81.4 A34 34 0 1 1 67 81.4';
const PROGRESS_D = 'M33 81.4 A34 34 0 0 1 50 18';

/** The mark alone. Primary (blue on light) or reversed (on dark). */
export function LogoMark({ size = 56, onDark = false }: { size?: number; onDark?: boolean }) {
  const gid = `osdial${React.useId().replace(/:/g, '')}`;
  const track = onDark ? 'rgba(255,255,255,0.16)' : '#DCE7FB';
  const progress = onDark ? '#60A5FA' : `url(#${gid})`;
  const markerOuter = onDark ? '#0F172A' : '#FFFFFF';
  const markerInner = onDark ? '#FFFFFF' : `url(#${gid})`;
  const innerR = onDark ? 6.5 : 6;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      {!onDark && (
        <Defs>
          <LinearGradient id={gid} x1="26" y1="82" x2="58" y2="18" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#3B82F6" />
            <Stop offset="1" stopColor="#2563EB" />
          </LinearGradient>
        </Defs>
      )}
      <Path d={TRACK_D} stroke={track} strokeWidth={12} strokeLinecap="round" />
      <Path d={PROGRESS_D} stroke={progress} strokeWidth={12} strokeLinecap="round" />
      <Circle cx={50} cy={18} r={10.5} fill={markerOuter} />
      <Circle cx={50} cy={18} r={innerR} fill={markerInner} />
    </Svg>
  );
}

/** App icon — white mark on the blue gradient tile. Mark sits at ~61% of the tile. */
export function AppIcon({ size = 58, radius }: { size?: number; radius?: number }) {
  const rad = radius ?? size * 0.24;
  return (
    <View style={{ width: size, height: size, borderRadius: rad, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="osIconBg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#3B82F6" />
            <Stop offset="1" stopColor="#2563EB" />
          </LinearGradient>
        </Defs>
        <Path d="M0 0 H100 V100 H0 Z" fill="url(#osIconBg)" />
        <G transform="translate(19.5 19.5) scale(0.61)">
          <Path d={TRACK_D} stroke="rgba(255,255,255,0.34)" strokeWidth={12} strokeLinecap="round" fill="none" />
          <Path d={PROGRESS_D} stroke="#FFFFFF" strokeWidth={12} strokeLinecap="round" fill="none" />
          <Circle cx={50} cy={18} r={10.5} fill="#2563EB" />
          <Circle cx={50} cy={18} r={6.5} fill="#FFFFFF" />
        </G>
      </Svg>
    </View>
  );
}

/** Full horizontal lockup: mark + On·Standard wordmark (Plus Jakarta Sans 800). */
export function Logo({ size = 40, onDark = false }: { size?: number; onDark?: boolean }) {
  const c = useColors();
  const textSize = size * 0.6;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Math.round(size * 0.32) }}>
      <LogoMark size={size} onDark={onDark} />
      <Txt style={{ fontFamily: font.eb, letterSpacing: -0.04 * textSize }} size={textSize} color={onDark ? '#fff' : c.text}>
        On<Txt style={{ fontFamily: font.eb }} size={textSize} color={c.accent}>Standard</Txt>
      </Txt>
    </View>
  );
}
