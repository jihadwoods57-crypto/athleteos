// OnStandard — inline SVG icon set (2px stroke, round caps, currentColor-driven).
import React from 'react';
import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';
import { useColors } from '@/ui/theme';

export type IconName =
  | 'bell'
  | 'flame'
  | 'camera'
  | 'home'
  | 'plan'
  | 'squad'
  | 'checkin'
  | 'chevronRight'
  | 'chevronLeft'
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'menu'
  | 'user'
  | 'settings'
  | 'bolt'
  | 'drop'
  | 'utensils'
  | 'trophy'
  | 'shield'
  | 'send'
  | 'copy'
  | 'gallery'
  | 'barcode'
  | 'sparkle'
  | 'mic';

export function Icon({
  name,
  size = 22,
  color,
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const c = useColors();
  const resolved = color ?? c.text;
  const p = { stroke: resolved, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {render(name, resolved, p)}
    </Svg>
  );
}

function render(name: IconName, color: string, p: object) {
  switch (name) {
    case 'bell':
      return (
        <>
          <Path d="M6 9a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8" {...p} />
          <Path d="M10.3 21a1.94 1.94 0 003.4 0" {...p} />
        </>
      );
    case 'flame':
      return <Path d="M12 3c1 4 4 5 4 9a4 4 0 11-8 0c0-2 1-3 2-4 .5 2 2 2 2 4 0-3 0-6-0-9z" {...p} />;
    case 'camera':
      return (
        <>
          <Path d="M3 8a2 2 0 012-2h2l1.5-2h7L17 6h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" {...p} />
          <Circle cx={12} cy={12.5} r={3.4} {...p} />
        </>
      );
    case 'barcode':
      return <Path d="M4 6v12M7 6v12M10 6v12M13.5 6v12M17 6v12M20 6v12" {...p} />;
    case 'mic':
      return (
        <>
          <Rect x={9} y={3} width={6} height={11} rx={3} {...p} />
          <Path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6" {...p} />
        </>
      );
    case 'home':
      return <Path d="M4 11l8-7 8 7M6 10v9a1 1 0 001 1h10a1 1 0 001-1v-9" {...p} />;
    case 'plan':
      return (
        <>
          <Rect x={4} y={4} width={16} height={16} rx={3} {...p} />
          <Path d="M8 9h8M8 13h8M8 17h4" {...p} />
        </>
      );
    case 'squad':
      return (
        <>
          <Circle cx={9} cy={8} r={3} {...p} />
          <Path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" {...p} />
          <Path d="M16 5.5a3 3 0 010 5.5M17 20c0-2.3-.8-3.9-2-5" {...p} />
        </>
      );
    case 'checkin':
      return (
        <>
          <Rect x={5} y={4} width={14} height={17} rx={2.5} {...p} />
          <Path d="M9 3h6v3H9z" {...p} />
          <Polyline points="9 13 11 15 15 10" {...p} />
        </>
      );
    case 'chevronRight':
      return <Path d="M9 6l6 6-6 6" {...p} />;
    case 'chevronLeft':
      return <Path d="M15 6l-6 6 6 6" {...p} />;
    case 'plus':
      return <Path d="M12 5v14M5 12h14" {...p} />;
    case 'minus':
      return <Path d="M5 12h14" {...p} />;
    case 'close':
      return <Path d="M6 6l12 12M18 6L6 18" {...p} />;
    case 'check':
      return <Polyline points="5 12 10 17 19 7" {...p} />;
    case 'menu':
      return <Path d="M4 7h16M4 12h16M4 17h16" {...p} />;
    case 'user':
      return (
        <>
          <Circle cx={12} cy={8} r={4} {...p} />
          <Path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" {...p} />
        </>
      );
    case 'settings':
      return (
        <>
          <Circle cx={12} cy={12} r={3} {...p} />
          <Path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2" {...p} />
        </>
      );
    case 'bolt':
      return <Path d="M13 2L5 13h6l-1 9 8-12h-6l1-8z" {...p} />;
    case 'drop':
      return <Path d="M12 3c3.5 4.5 6 7.5 6 11a6 6 0 11-12 0c0-3.5 2.5-6.5 6-11z" {...p} />;
    case 'utensils':
      return <Path d="M5 3v8a2 2 0 002 2h0v8M9 3v6M7 3v6M16 3c-1.5 0-3 1.5-3 5 0 2 1 3 2 3v8" {...p} />;
    case 'trophy':
      return (
        <>
          <Path d="M7 4h10v5a5 5 0 01-10 0V4z" {...p} />
          <Path d="M7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3M9 19h6M10 14v5M14 14v5" {...p} />
        </>
      );
    case 'shield':
      return <Path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z" {...p} />;
    case 'send':
      return <Path d="M5 12l15-7-6 15-2-6-7-2z" {...p} />;
    case 'copy':
      return (
        <>
          <Rect x={8} y={8} width={12} height={12} rx={2.5} {...p} />
          <Path d="M5 16V5a1 1 0 011-1h9" {...p} />
        </>
      );
    case 'gallery':
      return (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2.5} {...p} />
          <Circle cx={8.5} cy={10} r={1.5} {...p} />
          <Path d="M21 16l-5-5-8 8" {...p} />
        </>
      );
    case 'sparkle':
      return <Path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" {...p} />;
    default:
      return null;
  }
}
