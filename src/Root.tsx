// OnStandard — top-level flow switch. Mirrors the prototype's `flow` state:
// onboarding | app (athlete) | coach | parent | trainer.
import React from 'react';
import { useStore } from '@/store';
import { useInviteLink } from '@/lib/inviteLink';
import { Onboarding } from '@/screens/onboarding/Onboarding';
import { AthleteApp } from '@/screens/athlete/AthleteApp';
import { CoachView } from '@/screens/roles/CoachView';
import { ParentView } from '@/screens/roles/ParentView';
import { TrainerView } from '@/screens/roles/TrainerView';

export function Root() {
  const flow = useStore((s) => s.flow);
  useInviteLink(); // invite deep links open the Connect overlay with the code prefilled

  switch (flow) {
    case 'app':
      return <AthleteApp />;
    case 'coach':
      return <CoachView />;
    case 'parent':
      return <ParentView />;
    case 'trainer':
      return <TrainerView />;
    case 'onboarding':
    default:
      return <Onboarding />;
  }
}
