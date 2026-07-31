import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { C } from './theme';
import { BackPlate, FullBleed, Kinetic, Phone } from './bits';
import { EndCard } from './EndCard';

/* 30s pre-roll (16:9, 900f): open → roll call → scan → ring → card.
 * Same score file; it simply ends earlier (the bed is textural, not melodic). */
export const Preroll30: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Audio src={staticFile('score.wav')} />
    <Sequence from={0} durationInFrames={96}>
      <FullBleed src="s1.mp4" startFrom={20} />
      <Sequence from={12} durationInFrames={80}>
        <Kinetic lines={['Nobody sees', 'this part.']} size={68} />
      </Sequence>
    </Sequence>
    <Sequence from={96} durationInFrames={150}>
      <BackPlate src="s1.mp4" frame={132} />
      <Phone src="rollcall.mp4" startFrom={10} height={904} shiftX={330} />
      <Sequence from={48} durationInFrames={98}>
        <Kinetic mode="left" lines={['Proof,', 'not', 'promises.']} size={92} gapFrames={9} />
      </Sequence>
    </Sequence>
    <Sequence from={246} durationInFrames={216}>
      <BackPlate src="s2.mp4" frame={130} />
      <Phone src="snap.mp4" startFrom={16} height={904} shiftX={330} />
      <Sequence from={36} durationInFrames={172}>
        <Kinetic mode="left" lines={['Every plate', 'becomes', 'a number.']} size={84} gapFrames={12} />
      </Sequence>
    </Sequence>
    <Sequence from={462} durationInFrames={192}>
      <BackPlate src="s5.mp4" frame={130} />
      <Phone src="ring.mp4" startFrom={24} height={940} shiftY={40} shiftX={330} />
      <Sequence from={70} durationInFrames={116}>
        <Kinetic mode="left" lines={['The number', 'doesn’t lie.']} size={84} gapFrames={12} />
      </Sequence>
    </Sequence>
    <Sequence from={654} durationInFrames={246}><EndCard /></Sequence>
  </AbsoluteFill>
);

/* 15s vertical (1080x1920, 450f): scan → ring → card. The phone is the frame. */
export const Vertical15: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Audio src={staticFile('score.wav')} />
    <Sequence from={0} durationInFrames={180}>
      <BackPlate src="s2.mp4" frame={130} />
      <Phone src="snap.mp4" startFrom={40} height={1500} appear={false} punchFrom={1.02} punchTo={1.07} shiftY={60} />
      <Sequence from={16} durationInFrames={158}>
        <Kinetic mode="top" lines={['Point. Shoot. Know.']} size={64} />
      </Sequence>
    </Sequence>
    <Sequence from={180} durationInFrames={162}>
      <BackPlate src="s5.mp4" frame={130} />
      <Phone src="ring.mp4" startFrom={24} height={1500} punchFrom={1} punchTo={1.06} shiftY={60} />
      <Sequence from={70} durationInFrames={90}>
        <Kinetic mode="top" lines={['The number doesn’t lie.']} size={58} />
      </Sequence>
    </Sequence>
    <Sequence from={342} durationInFrames={108}><EndCard compact /></Sequence>
  </AbsoluteFill>
);
