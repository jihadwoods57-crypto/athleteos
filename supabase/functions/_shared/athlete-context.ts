// Who the athlete IS, as one prompt line — the read used to know a single word about them.
//
// analyze-meal was asked to write "specific to THIS plate and THIS athlete's day" while the
// request carried `goal` and nothing else. Sport, position, level, bodyweight and whether today
// is a training or rest day all exist client-side (RT.profile, the team week pattern) and never
// reached the prompt, so every athlete got the same generic coach. This renders those as ONE
// sentence the model may lean on and may not embellish.
//
// Same rules as every other athlete-derived block in userContent(): the values are athlete- or
// coach-authored text and numbers, so they are treated as data — stripped, capped, clamped —
// never as instructions. Absent or garbage input renders '' and the prompt is byte-identical to
// before, which is what makes this safe to send from a client an older deploy will ignore.

export type AthleteContextIn = {
  sport?: unknown;
  position?: unknown;
  level?: unknown;
  /** Pounds. Clamped to a plausible athlete range and rounded to 5, the way a coach says it. */
  bodyweightLb?: unknown;
  /** 'training' | 'rest' from the team week pattern; anything else means "unknown", and the
   *  model is told nothing rather than guessed for. */
  dayType?: unknown;
};

const word = (v: unknown, max = 32): string =>
  typeof v === 'string'
    ? v.replace(/[^A-Za-z0-9 &'\-\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).toLowerCase()
    : '';

const LEVELS: Record<string, string> = {
  hs: 'high school', highschool: 'high school', 'high school': 'high school',
  college: 'college', collegiate: 'college', ncaa: 'college', juco: 'college',
  club: 'club', youth: 'youth', pro: 'pro', professional: 'pro', adult: 'adult',
};

/** Render the athlete line, or '' when there is nothing honest to say. */
export function athleteContextLine(a: AthleteContextIn | null | undefined): string {
  if (!a || typeof a !== 'object') return '';
  const bits: string[] = [];
  const sport = word(a.sport);
  const position = word(a.position);
  if (sport) bits.push(sport);
  if (position && position !== sport) bits.push(position);
  const lvlRaw = word(a.level, 24);
  const level = LEVELS[lvlRaw] ?? (lvlRaw ? lvlRaw : '');
  if (level) bits.push(`${level} level`);
  const bw = Number(a.bodyweightLb);
  if (Number.isFinite(bw) && bw >= 70 && bw <= 450) bits.push(`about ${Math.round(bw / 5) * 5} lb`);
  const dayType = a.dayType === 'training' ? 'training' : a.dayType === 'rest' ? 'rest' : '';
  if (!bits.length && !dayType) return '';
  const who = bits.length ? ` Athlete profile: ${bits.join(', ')}.` : '';
  const day = dayType ? ` Today is a ${dayType} day on their team's week pattern.` : '';
  return `${who}${day}`;
}
