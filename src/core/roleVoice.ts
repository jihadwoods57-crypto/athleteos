// OnStandard — role voice + experience tailoring (pure TS, no RN imports).
//
// One engine, four audiences. An ATHLETE (performance/gain profile) lives in team language:
// squad, streak, coach watching, fuel to perform. A non-athlete CLIENT (general profile) is
// an adult on a personal goal working with a trainer: personal progress, privacy by default,
// and the one thing most diet apps get backwards said OUT LOUD — this score rewards eating
// ENOUGH (calorieAdherence is two-sided; a crash deficit loses credit). This module is where
// that split lives as data, so surfaces switch framing with one call instead of scattering
// role conditionals.
import { calorieAdherence, resolveProfile } from './scoringProfiles';
import type { ScoringProfile } from './types';

/** Which experience an account gets: team-athletic vs personal-client. */
export type ExperienceKind = 'athlete' | 'client';

/** general profile = the non-athlete client experience; athlete/gain keep the team frame.
 *  (A gain-profile solo client still fuels like an athlete — surplus is the point.) */
export function experienceKind(profile: ScoringProfile | undefined): ExperienceKind {
  return resolveProfile(profile) === 'general' ? 'client' : 'athlete';
}

/** The overseer word each experience uses ("Your coach sees this" vs "Your trainer"). If a
 *  trainer link exists it wins for clients; the athlete default stays coach. */
export function overseerNoun(kind: ExperienceKind, supportTeam: string[] = []): 'coach' | 'trainer' {
  if (kind === 'client') return 'trainer';
  return supportTeam.includes('trainer') && !supportTeam.includes('coach') ? 'trainer' : 'coach';
}

/** Squad/leaderboard is team furniture: on for athletes, OFF by default for clients (an adult
 *  on a personal goal did not sign up for a teen leaderboard). */
export function showSquad(kind: ExperienceKind): boolean {
  return kind === 'athlete';
}

/**
 * The anti-crash-diet win, said as a positive. Fires ONLY for the general profile on a day
 * inside the two-sided window (>=90% adherence credit) with a real target — the exact
 * condition the score already credits, so the copy can never contradict the math.
 * Null everywhere else (athletes have their own fueling language).
 */
export function ateEnoughLine(
  profile: ScoringProfile | undefined,
  kcalToday: number,
  calTarget: number,
): string | null {
  if (resolveProfile(profile) !== 'general') return null;
  if (!(calTarget > 0) || !(kcalToday > 0)) return null;
  if (calorieAdherence(kcalToday, calTarget) < 0.9) return null;
  return 'On target without under-eating. That is the win: this score rewards fueling right, never starving.';
}

/** Per-experience copy for shared surfaces (data, not conditionals in screens). */
export interface ExperienceVoice {
  /** The progress surface eyebrow ("SEASON GOAL" is sports furniture; a client gets ownership). */
  goalEyebrow: string;
  /** The day-complete encouragement line. */
  dayDoneLine: string;
  /** The comeback CTA (clients get the adult register). */
  comebackDetail: string;
}

export function experienceVoice(kind: ExperienceKind): ExperienceVoice {
  if (kind === 'client') {
    return {
      goalEyebrow: 'YOUR GOAL',
      dayDoneLine: 'You showed up today. That is the whole job.',
      comebackDetail: 'A few days off changes nothing about what you can do today. One meal photo starts it.',
    };
  }
  return {
    goalEyebrow: 'SEASON GOAL',
    dayDoneLine: 'Every requirement is in. Same again tomorrow.',
    comebackDetail: "It's been a minute. None of that changes what you can do today, and today is the only day on the board. One meal photo starts it.",
  };
}
