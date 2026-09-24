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
  /** The athlete's own clock ('3:40 PM') and next open item; rendered by day-context clockLine. */
  localTime?: unknown;
  next?: unknown;
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

// THE POSITION IS STORED AS AN ABBREVIATION (founder 2026-09-13). Every football position the
// app can save is a code — SPORT_POSITIONS is ['QB','RB','WR','TE','OL','DL','LB','DB',…] — and
// this line lowercased it, so a linebacker reached the prompt as "lb", sitting one comma away
// from "about 250 lb". The model could not tell the position from the unit, fell back to the
// bodyweight, and called a linebacker a lineman in the athlete's own thread.
//
// So the codes are spelled out before they are shown. Only football is a code table: every other
// sport's picker already stores whole words ('Point Guard', 'Goalkeeper'), and those pass through
// untouched. Coach-typed roster labels are covered too, because a coach writes "MLB" or "FS", not
// "middle linebacker".
const FOOTBALL_POSITIONS: Record<string, string> = {
  qb: 'quarterback', rb: 'running back', hb: 'running back', fb: 'fullback',
  wr: 'wide receiver', te: 'tight end', ath: 'athlete',
  ol: 'offensive lineman', ot: 'offensive tackle', og: 'offensive guard',
  c: 'center', dl: 'defensive lineman', de: 'defensive end', dt: 'defensive tackle',
  nt: 'nose tackle', edge: 'edge rusher',
  lb: 'linebacker', ilb: 'inside linebacker', olb: 'outside linebacker',
  mlb: 'middle linebacker', mike: 'middle linebacker', will: 'weakside linebacker',
  sam: 'strongside linebacker',
  db: 'defensive back', cb: 'cornerback', s: 'safety', fs: 'free safety',
  ss: 'strong safety', ni: 'nickelback', nb: 'nickelback',
  k: 'kicker', p: 'punter', ls: 'long snapper', kr: 'return specialist', pr: 'return specialist',
};

/** A position an athlete or coach saved, in words the model can coach with.
 *
 *  Football codes are expanded; anything already spelled out is returned as-is. A code we do not
 *  know is UPPERCASED rather than left lowercase — "DE" is at worst an unfamiliar abbreviation to
 *  the model, while "de" is noise, and "lb" is actively wrong. Exported so plan-generate and any
 *  other prompt that names the position speaks the same vocabulary. */
export function positionWords(sport: unknown, position: unknown): string {
  const raw = word(position);
  if (!raw) return '';
  const s = word(sport);
  // Codes are one token, no spaces. A phrase is already words; leave it alone.
  if (raw.includes(' ')) return raw;
  // Single letters (C, S, K, P) collide across sports — a soccer striker is not a center — so
  // they expand only when we KNOW the sport is football. Multi-letter codes are football-specific
  // enough to expand on their own, which also covers a roster row that carries no sport.
  const full = FOOTBALL_POSITIONS[raw];
  if (full && (raw.length > 1 || s.includes('football'))) return full;
  return raw.length <= 4 ? raw.toUpperCase() : raw;
}

/** Render the athlete line, or '' when there is nothing honest to say. */
export function athleteContextLine(a: AthleteContextIn | null | undefined): string {
  if (!a || typeof a !== 'object') return '';
  const bits: string[] = [];
  const sport = word(a.sport);
  const position = positionWords(a.sport, a.position);
  if (sport) bits.push(sport);
  if (position && position.toLowerCase() !== sport) bits.push(position);
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
