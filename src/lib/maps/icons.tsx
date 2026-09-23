/* The picker's glyphs, drawn rather than typed so they match on every font size. */
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

type P = { color: string; size?: number };

export const SearchIcon = ({ color, size = 18 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={2.2} />
    <Path d="M16.5 16.5 21 21" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);

export const CloseIcon = ({ color, size = 14 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M5 5l14 14M19 5 5 19" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
  </Svg>
);

/** Left-right arrows: this handle resizes. */
export const ResizeIcon = ({ color, size = 14 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const PinIcon = ({ color, size = 28 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    <Circle cx={12} cy={10} r={2.6} stroke={color} strokeWidth={2} />
  </Svg>
);

/** The location arrow: Near me. */
export const LocateIcon = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M21 3 3 10.5l7.5 3 3 7.5L21 3Z" stroke={color} strokeWidth={2.1} strokeLinejoin="round" />
  </Svg>
);
