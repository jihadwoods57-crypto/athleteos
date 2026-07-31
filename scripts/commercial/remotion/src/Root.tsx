import React from 'react';
import { Composition } from 'remotion';
import { Master } from './Master';
import { Preroll30, Vertical15 } from './Cuts';

export const Root: React.FC = () => (
  <>
    <Composition id="Master" component={Master} durationInFrames={2268} fps={30} width={1920} height={1080} />
    <Composition id="Preroll30" component={Preroll30} durationInFrames={900} fps={30} width={1920} height={1080} />
    <Composition id="Vertical15" component={Vertical15} durationInFrames={450} fps={30} width={1080} height={1920} />
  </>
);
