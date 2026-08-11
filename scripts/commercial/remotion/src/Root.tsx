import React from 'react';
import { Composition } from 'remotion';
import { Master } from './Master';
import { Preroll30, Vertical15 } from './Cuts';
import { ATHLETE_BEATS, COACH_BEATS, DemoRole, DemoRoleVertical, PARENT_BEATS, TRAINER_BEATS, demoDuration } from './Demo';

export const Root: React.FC = () => (
  <>
    <Composition id="Master" component={Master} durationInFrames={2268} fps={30} width={1920} height={1080} />
    <Composition id="Preroll30" component={Preroll30} durationInFrames={900} fps={30} width={1920} height={1080} />
    <Composition id="Vertical15" component={Vertical15} durationInFrames={450} fps={30} width={1080} height={1920} />
    <Composition id="DemoAthlete" component={DemoRole} durationInFrames={demoDuration(ATHLETE_BEATS)} fps={30} width={1920} height={1080}
      defaultProps={{ role: 'Athletes', line: 'Prove the work. Own your record.', beats: ATHLETE_BEATS }} />
    <Composition id="DemoCoach" component={DemoRole} durationInFrames={demoDuration(COACH_BEATS)} fps={30} width={1920} height={1080}
      defaultProps={{ role: 'Coaches', line: 'The whole roster, live, in three seconds.', beats: COACH_BEATS }} />
    <Composition id="DemoTrainer" component={DemoRole} durationInFrames={demoDuration(TRAINER_BEATS)} fps={30} width={1920} height={1080}
      defaultProps={{ role: 'Trainers', line: 'Your clients’ execution, between sessions.', beats: TRAINER_BEATS }} />
    <Composition id="DemoParent" component={DemoRole} durationInFrames={demoDuration(PARENT_BEATS)} fps={30} width={1920} height={1080}
      defaultProps={{ role: 'Parents', line: 'In the loop, never in the way.', beats: PARENT_BEATS }} />
    <Composition id="DemoAthleteVertical" component={DemoRoleVertical} durationInFrames={demoDuration(ATHLETE_BEATS)} fps={30} width={1080} height={1920}
      defaultProps={{ role: 'Athletes', line: 'Prove the work. Own your record.', beats: ATHLETE_BEATS }} />
    <Composition id="DemoCoachVertical" component={DemoRoleVertical} durationInFrames={demoDuration(COACH_BEATS)} fps={30} width={1080} height={1920}
      defaultProps={{ role: 'Coaches', line: 'The whole roster, live, in three seconds.', beats: COACH_BEATS }} />
    <Composition id="DemoTrainerVertical" component={DemoRoleVertical} durationInFrames={demoDuration(TRAINER_BEATS)} fps={30} width={1080} height={1920}
      defaultProps={{ role: 'Trainers', line: 'Your clients’ execution, between sessions.', beats: TRAINER_BEATS }} />
    <Composition id="DemoParentVertical" component={DemoRoleVertical} durationInFrames={demoDuration(PARENT_BEATS)} fps={30} width={1080} height={1920}
      defaultProps={{ role: 'Parents', line: 'In the loop, never in the way.', beats: PARENT_BEATS }} />
  </>
);
