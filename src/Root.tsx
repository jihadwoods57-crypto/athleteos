// OnStandard — top-level flow switch. Mirrors the prototype's `flow` state:
// onboarding | app (athlete) | coach | parent | trainer.
import React from 'react';
import { AppState } from 'react-native';
import { useStore } from '@/store';
import { useInviteLink } from '@/lib/inviteLink';
import { Onboarding } from '@/screens/onboarding/Onboarding';
import { AthleteApp } from '@/screens/athlete/AthleteApp';
import { CoachView } from '@/screens/roles/CoachView';
import { ParentView } from '@/screens/roles/ParentView';
import { TrainerView } from '@/screens/roles/TrainerView';

export function Root() {
  const flow = useStore((s) => s.flow);
  const initPush = useStore((s) => s.initPush);
  useInviteLink(); // invite deep links open the Connect overlay with the code prefilled

  // Register this device for push once, for every signed-in role (coaches get join alerts,
  // athletes get nudges). No-op offline / on web / until an EAS build exists.
  React.useEffect(() => {
    void initPush();
  }, [initPush]);

  // The day boundary must fire when the app comes back to the FOREGROUND, not just on a
  // cold restart (the persist-merge path): a phone backgrounded overnight is the normal
  // mobile pattern, and without this the athlete reopened onto yesterday's completed day
  // — no fresh morning game plan, the product's signature moment. The same foreground
  // beat re-checks a pending guardian consent, so a parent's approval reaches the
  // minor's device without a destructive sign-out/sign-in cycle.
  React.useEffect(() => {
    const onActive = () => {
      const s = useStore.getState();
      s.rollDayForeground();
      if (s.userId && s.guardianStatus === 'pending') void s.hydrateGuardianConsent();
    };
    onActive(); // run once at mount (covers a resumed JS context without a state change)
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') onActive();
    });
    return () => sub.remove();
  }, []);

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
