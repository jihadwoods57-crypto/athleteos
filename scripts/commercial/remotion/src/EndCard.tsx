import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from './theme';
import { Dial, Wordmark } from './bits';

const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** The close: dial draws on, lockup lands, the line, then the ask. Fades to black. */
export const EndCard: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const dial = interpolate(frame, [4, 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const mark = interpolate(frame, [22, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const line1 = interpolate(frame, [46, 62], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const cta = interpolate(frame, [86, 102], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const fade = interpolate(frame, [durationInFrames - 40, durationInFrames - 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scale = compact ? 0.82 : 1;
  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: 'center', alignItems: 'center' }}>
      {/* faint ambient glow behind the lockup */}
      <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,211,238,0.10), transparent 62%)', opacity: dial * fade }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34 * scale, opacity: fade, transform: `scale(${scale})` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
          <Dial size={128} progress={dial} uid="endcard" />
          <div style={{ transform: `translateX(${(1 - mark) * 24}px)`, opacity: mark }}>
            <Wordmark size={96} />
          </div>
        </div>
        <div
          style={{
            fontFamily: F.exp, fontWeight: 900, textTransform: 'uppercase', textAlign: 'center',
            fontSize: 58, lineHeight: 1.2, color: C.ink, letterSpacing: '0.02em',
            clipPath: `inset(0 0 ${(1 - line1) * 100}% 0)`, transform: `translateY(${(1 - line1) * 26}px)`, opacity: line1,
          }}
        >
          One day at a time.<br />On standard.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: cta, transform: `translateY(${(1 - cta) * 18}px)` }}>
          <div
            style={{
              fontFamily: F.body, fontWeight: 700, fontSize: 30, color: '#FFFFFF',
              padding: '20px 44px', borderRadius: 16,
              background: `linear-gradient(165deg, ${C.blueBright}, ${C.blueDeep})`,
              boxShadow: '0 18px 60px rgba(59,130,246,0.35)',
            }}
          >
            Start free
          </div>
          <div style={{ fontFamily: F.body, fontWeight: 600, fontSize: 30, color: C.ink2, letterSpacing: '0.01em' }}>
            onstandard.app
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
