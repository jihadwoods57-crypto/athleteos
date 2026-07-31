import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, F } from './theme';
import { BackPlate, FullBleed, Kinetic, Phone, TimeCard } from './bits';
import { EndCard } from './EndCard';

/* "One Day on Standard" — 75.6s master @30fps (2268 frames) on a 100 BPM grid (18f/beat).
 * The score's hit lands at 62.4s (f1872): the ring locks its number right on it. */

const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [12, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const out = interpolate(frame, [62, 72], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#02040A', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ opacity: k * out, textAlign: 'center' }}>
        <div style={{ fontFamily: F.exp, fontWeight: 900, fontSize: 150, color: C.ink, lineHeight: 1 }}>
          5:02<span style={{ fontSize: 66, color: C.ink2, marginLeft: 18 }}>AM</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Master: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Audio src={staticFile('score.wav')} />

    {/* 0:00 cold open */}
    <Sequence from={0} durationInFrames={72}><ColdOpen /></Sequence>

    {/* 0:02.4 S1 — waking up */}
    <Sequence from={72} durationInFrames={150}>
      <FullBleed src="s1" />
      <Sequence from={48} durationInFrames={96}>
        <Kinetic lines={['Nobody sees', 'this part.']} size={72} />
      </Sequence>
    </Sequence>

    {/* 0:07.4 roll call — the tap that proves it */}
    <Sequence from={222} durationInFrames={216}>
      <BackPlate src="s1" frame={132} />
      <Phone src="rollcall" startFrom={10} height={904} punchFrom={1} punchTo={1.06} shiftX={330} />
      <Sequence from={78} durationInFrames={138}>
        <Kinetic mode="left" lines={['Proof,', 'not', 'promises.']} size={92} gapFrames={10} />
      </Sequence>
    </Sequence>

    {/* 0:14.6 time jump */}
    <Sequence from={438} durationInFrames={48}><TimeCard time="7:41" meridiem="AM" /></Sequence>

    {/* 0:16.2 S2 — the plate (clean, no text: the gesture is the line) */}
    <Sequence from={486} durationInFrames={120}>
      <FullBleed src="s2" startFrom={8} />
    </Sequence>

    {/* 0:20.2 snap — confirm → scan */}
    <Sequence from={606} durationInFrames={228}>
      <BackPlate src="s2" frame={130} />
      <Phone src="snap" startFrom={16} height={904} punchFrom={1} punchTo={1.055} shiftX={330} />
      <Sequence from={36} durationInFrames={180}>
        <Kinetic mode="left" lines={['Point.', 'Shoot.', 'Know.']} size={96} gapFrames={22} />
      </Sequence>
    </Sequence>

    {/* 0:27.8 the numbers land */}
    <Sequence from={834} durationInFrames={150}>
      <BackPlate src="s2" frame={140} />
      <Phone src="bfast" startFrom={22} height={904} punchFrom={1.02} punchTo={1.08} shiftX={330} />
      <Sequence from={18} durationInFrames={126}>
        <Kinetic mode="left" lines={['Every plate', 'becomes', 'a number.']} size={84} gapFrames={10} />
      </Sequence>
    </Sequence>

    {/* 0:32.8 time jump */}
    <Sequence from={984} durationInFrames={48}><TimeCard time="12:15" meridiem="PM" /></Sequence>

    {/* 0:34.4 S3 parent / S4 coach — the same ping, two worlds */}
    <Sequence from={1032} durationInFrames={108}>
      <FullBleed src="s3" startFrom={10} />
      <Sequence from={24} durationInFrames={80}>
        <Kinetic lines={['One meal.']} size={66} />
      </Sequence>
    </Sequence>
    <Sequence from={1140} durationInFrames={108}>
      <FullBleed src="s4" startFrom={10} />
      <Sequence from={16} durationInFrames={88}>
        <Kinetic lines={['Everyone in the loop.']} size={62} />
      </Sequence>
    </Sequence>

    {/* 0:41.6 coach types the line */}
    <Sequence from={1248} durationInFrames={120}>
      <BackPlate src="s4" frame={130} />
      <Phone src="coachmeal" startFrom={104} height={904} punchFrom={1.01} punchTo={1.05} shiftX={330} />
    </Sequence>

    {/* 0:45.6 the thread — coach, parent, AI, one record */}
    <Sequence from={1368} durationInFrames={240}>
      <BackPlate src="s3" frame={120} />
      {/* rate 1.25: the hi take's scroll bunches near its tail — this reaches the conversation
          with ~1.7s to spare, and srcIndex clamps to the last frame so it HOLDS there. */}
      <Phone src="thread" startFrom={20} playbackRate={1.25} height={904} punchFrom={1} punchTo={1.05} shiftX={330} />
      <Sequence from={96} durationInFrames={136}>
        <Kinetic mode="left" lines={['Your people,', 'on the', 'record.']} size={88} gapFrames={10} />
      </Sequence>
    </Sequence>

    {/* 0:53.6 time jump */}
    <Sequence from={1608} durationInFrames={48}><TimeCard time="9:58" meridiem="PM" /></Sequence>

    {/* 0:55.2 S5 — day done */}
    <Sequence from={1656} durationInFrames={132}>
      <FullBleed src="s5" startFrom={6} />
    </Sequence>

    {/* 0:59.6 the ring — locks its number on the music hit at 1:02.4 */}
    <Sequence from={1788} durationInFrames={180}>
      <BackPlate src="s5" frame={130} />
      <Phone src="ring" startFrom={24} height={940} punchFrom={1.03} punchTo={1.1} shiftY={40} shiftX={330} />
      <Sequence from={84} durationInFrames={96}>
        <Kinetic mode="left" lines={['The number', 'doesn’t lie.', 'That’s the point.']} size={76} gapFrames={12} accent={[2]} />
      </Sequence>
    </Sequence>

    {/* 1:05.6 end card */}
    <Sequence from={1968} durationInFrames={300}><EndCard /></Sequence>
  </AbsoluteFill>
);
