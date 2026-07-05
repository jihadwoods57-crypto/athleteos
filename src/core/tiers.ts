// OnStandard — tier ladder (the redesign's honest status band over the 0–100 score).
//
// The score is unchanged (0.5 nutrition + 0.25 recovery + 0.15 commitment + 0.10 check-in).
// Tiers are a pure read over that number — a name + status color the ring chip, roster
// flags, and progress screens all speak. Thresholds match proto js/state.js:
//   Off Standard 0–59 · Building 60–74 · Locked In 75–89 · OnStandard 90–100.
import type { Tier, TierKey } from './types';

/** The status color class per tier, mirroring the proto's tierCls ('r'|'a'|'b'|'g'). */
export function tierFor(score: number): Tier {
  if (score >= 90) return { key: 'onstandard', name: 'OnStandard', short: 'g' };
  if (score >= 75) return { key: 'lockedin', name: 'Locked In', short: 'b' };
  if (score >= 60) return { key: 'building', name: 'Building', short: 'a' };
  return { key: 'off', name: 'Off Standard', short: 'r' };
}

/** All tiers, highest first — for the breakdown/progress ladders. */
export const TIERS: { key: TierKey; name: string; min: number; short: 'r' | 'a' | 'b' | 'g' }[] = [
  { key: 'onstandard', name: 'OnStandard', min: 90, short: 'g' },
  { key: 'lockedin', name: 'Locked In', min: 75, short: 'b' },
  { key: 'building', name: 'Building', min: 60, short: 'a' },
  { key: 'off', name: 'Off Standard', min: 0, short: 'r' },
];
