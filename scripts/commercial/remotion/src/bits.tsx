import React from 'react';
import {
  AbsoluteFill, Easing, Freeze, OffthreadVideo, interpolate, staticFile,
  useCurrentFrame, useVideoConfig,
} from 'remotion';
import { C, F, ensureFonts, sweep } from './theme';

ensureFonts();

const ease = Easing.bezier(0.22, 1, 0.36, 1);

/* ---------------- full-bleed Kling clip, graded for cohesion ---------------- */
export const FullBleed: React.FC<{
  src: string; startFrom?: number; zoomFrom?: number; zoomTo?: number;
}> = ({ src, startFrom = 0, zoomFrom = 1.04, zoomTo = 1.1 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const z = interpolate(frame, [0, durationInFrames], [zoomFrom, zoomTo]);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <OffthreadVideo
        muted
        src={staticFile(src)}
        startFrom={startFrom}
        style={{
          width: '100%', height: '100%', objectFit: 'cover',
          transform: `scale(${z})`,
          filter: 'contrast(1.06) saturate(0.9) brightness(0.97)',
        }}
      />
      <Vignette />
    </AbsoluteFill>
  );
};

/* ---------------- frozen, blurred backplate from a clip frame ---------------- */
export const BackPlate: React.FC<{ src: string; frame?: number }> = ({ src, frame = 130 }) => (
  <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
    <Freeze frame={frame}>
      <OffthreadVideo
        muted
        src={staticFile(src)}
        style={{
          width: '100%', height: '100%', objectFit: 'cover',
          transform: 'scale(1.22)',
          filter: 'blur(14px) brightness(0.38) saturate(0.75)',
        }}
      />
    </Freeze>
    <Vignette strength={0.55} />
  </AbsoluteFill>
);

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.42 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at 50% 42%, transparent 52%, rgba(2,4,10,${strength}) 100%)`,
      pointerEvents: 'none',
    }}
  />
);

/* ---------------- the phone ----------------
 * Device shell around a UI screen-capture. Screen aspect is the capture's 390:844.
 * `appear` runs a rise+settle entrance; `punch` drifts scale across the shot. */
export const Phone: React.FC<{
  src: string; startFrom?: number; height?: number; appear?: boolean;
  punchFrom?: number; punchTo?: number; playbackRate?: number; shiftY?: number; shiftX?: number;
}> = ({ src, startFrom = 0, height = 920, appear = true, punchFrom = 1, punchTo = 1.05, playbackRate = 1, shiftY = 0, shiftX = 0 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const enter = appear
    ? interpolate(frame, [0, 22], [0, 1], { extrapolateRight: 'clamp', easing: ease })
    : 1;
  const punch = interpolate(frame, [0, durationInFrames], [punchFrom, punchTo]);
  const bezel = 13;
  const radius = height * 0.072;
  const screenH = height - bezel * 2;
  const screenW = screenH * (390 / 844);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          transform: `translateX(${shiftX}px) translateY(${(1 - enter) * 70 + shiftY}px) scale(${(0.94 + 0.06 * enter) * punch})`,
          opacity: enter,
          borderRadius: radius,
          padding: bezel,
          background: 'linear-gradient(160deg, #10141d, #05070c)',
          border: '1.5px solid rgba(255,255,255,0.14)',
          boxShadow: '0 60px 140px rgba(0,0,0,0.65), 0 0 110px rgba(59,130,246,0.13), inset 0 0 2px rgba(255,255,255,0.12)',
          position: 'relative',
        }}
      >
        <div style={{ width: screenW, height: screenH, borderRadius: radius - bezel + 4, overflow: 'hidden', background: '#000', position: 'relative' }}>
          <OffthreadVideo
            muted
            src={staticFile(src)}
            startFrom={startFrom}
            playbackRate={playbackRate}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {/* dynamic island */}
          <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', width: screenW * 0.26, height: 26, borderRadius: 14, background: '#000' }} />
          {/* glass sheen */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,0.07) 0%, transparent 24%)', pointerEvents: 'none' }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ---------------- kinetic text ----------------
 * Lines land one after another: rise + unmask, tracked-out Archivo Expanded caps.
 * Everything is horizontally centered so the 9:16 crop keeps it. */
export const Kinetic: React.FC<{
  lines: string[]; size?: number; bottom?: string; gapFrames?: number; outAt?: number; accent?: number[];
  mode?: 'band' | 'left' | 'top';
}> = ({ lines, size = 66, bottom = '11%', gapFrames = 13, outAt, accent = [], mode = 'band' }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const end = outAt ?? durationInFrames;
  const exit = interpolate(frame, [end - 14, end - 2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const wrap: React.CSSProperties =
    mode === 'left'
      ? { justifyContent: 'center', alignItems: 'flex-start', paddingLeft: '6.5%' }
      : mode === 'top'
        ? { justifyContent: 'flex-start', alignItems: 'center', paddingTop: '6%' }
        : { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: bottom };
  return (
    <AbsoluteFill style={{ ...wrap, pointerEvents: 'none' }}>
      <div style={{ textAlign: mode === 'left' ? 'left' : 'center', opacity: exit }}>
        {lines.map((line, i) => {
          const t0 = i * gapFrames;
          const k = interpolate(frame, [t0, t0 + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
          return (
            <div
              key={i}
              style={{
                fontFamily: F.exp, fontWeight: 900, textTransform: 'uppercase',
                fontSize: size, lineHeight: 1.14, letterSpacing: '0.015em',
                color: C.ink,
                clipPath: `inset(0 0 ${(1 - k) * 100}% 0)`,
                transform: `translateY(${(1 - k) * 34}px)`,
                opacity: k,
                textShadow: '0 4px 40px rgba(0,0,0,0.75), 0 1px 8px rgba(0,0,0,0.5)',
                ...(accent.includes(i)
                  ? { background: sweep(90), WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', textShadow: 'none' }
                  : {}),
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/* ---------------- the time-jump card ---------------- */
export const TimeCard: React.FC<{ time: string; meridiem: string }> = ({ time, meridiem }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const k = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: 'clamp', easing: ease });
  const out = interpolate(frame, [durationInFrames - 10, durationInFrames - 2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const track = interpolate(frame, [0, durationInFrames], [0.06, 0.02]);
  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ opacity: k * out, textAlign: 'center' }}>
        <div style={{ fontFamily: F.exp, fontWeight: 900, fontSize: 150, color: C.ink, letterSpacing: `${track}em`, lineHeight: 1 }}>
          {time}<span style={{ fontSize: 66, color: C.ink2, marginLeft: 18 }}>{meridiem}</span>
        </div>
        <div style={{ margin: '26px auto 0', width: 148 * k, height: 4, borderRadius: 2, background: sweep(90) }} />
      </div>
    </AbsoluteFill>
  );
};

/* ---------------- the brand dial (LOGO.md geometry, landing SVG paths) ---------------- */
export const Dial: React.FC<{ size: number; progress: number; uid?: string }> = ({ size, progress, uid = 'd' }) => {
  const needle = interpolate(progress, [0.85, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <defs>
        <linearGradient id={`dial-${uid}`} x1="26" y1="82" x2="58" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={C.ringA} /><stop offset="50%" stopColor={C.ringB} /><stop offset="100%" stopColor={C.ringC} />
        </linearGradient>
      </defs>
      <path d="M33 81.4 A34 34 0 1 1 67 81.4" stroke="rgba(255,255,255,0.16)" strokeWidth={12} strokeLinecap="round" />
      <path
        d="M33 81.4 A34 34 0 0 1 50 18" stroke={`url(#dial-${uid})`} strokeWidth={12} strokeLinecap="round"
        pathLength={100} strokeDasharray={100} strokeDashoffset={100 - progress * 100}
      />
      <circle cx={50} cy={18} r={10.5} fill="#0F172A" opacity={needle} />
      <circle cx={50} cy={18} r={6} fill="#FFFFFF" opacity={needle} transform-origin="50 18" style={{ transform: `scale(${0.5 + 0.5 * needle})` }} />
    </svg>
  );
};

/* ---------------- wordmark: "On" ink + "Standard" in the sweep (brand law) ---------------- */
export const Wordmark: React.FC<{ size?: number; opacity?: number }> = ({ size = 84, opacity = 1 }) => (
  <div style={{ fontFamily: F.brand, fontWeight: 800, fontSize: size, letterSpacing: '-0.04em', color: C.ink, opacity }}>
    On<span style={{ background: sweep(90), WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Standard</span>
  </div>
);
