// OnStandard — the shape of one roll-call push, and the platform split.
// ZERO framework imports: loaded by both Deno (edge) and jest (babel).
//
// WHY THIS FILE EXISTS. Two functions compose roll-call pushes — commitment-reminders (INITIAL and
// REMINDER) and commitment-escalation (LATE). Before the 2026-09-02 design pass both crammed every
// name into a single `title` so the two operating systems would read alike. That levelled down to
// the weaker platform: iOS has a real title/subtitle/body hierarchy and was being handed one line.
//
// So the copy is now authored ONCE per state in the shape iOS can render, and this module owns the
// fold back down for platforms that cannot. `platformCopy()` is the only place that decides, and
// the caller passes the platform recorded on the device token it is about to send to.
//
// THE RULE ABOUT THE APP NAME: never write "OnStandard" into title, subtitle or body. Both
// operating systems draw the app name in the notification header themselves; repeating it spends a
// line saying what the OS already said. (The iOS Live Activity is the deliberate exception — it is
// a fully custom surface with no system header, so it names OnStandard in its own eyebrow.)

export type PushCopy = {
  /** The headline. On iOS this is the title line; on Android see `androidTitle`. */
  title: string;
  /** iOS only. null when the title stands alone and a subtitle would only repeat the body. */
  subtitle: string | null;
  /** The title for a platform with no subtitle line to render (Android). */
  androidTitle: string;
  body: string;
  /** The body for a platform with no subtitle line. Defaults to `body`; set it only when the
   *  subtitle carried a fact Android would otherwise lose entirely. */
  androidBody: string;
  /** True only when `body` is the coach's own words, verbatim. Drives the bell row, which keeps
   *  the whole message even when the push body was capped. */
  fromCoach: boolean;
  truncated: boolean;
};

/** Join a title and its subtitle for a one-line platform. Defined once so a folded title can
 *  never drift from `title · subtitle`. */
export function fold(title: string, subtitle: string | null): string {
  return subtitle ? `${title} · ${subtitle}` : title;
}

/** Build one state's copy. `androidTitle` defaults to the fold and `androidBody` to `body`, so a
 *  caller only names them when the platforms genuinely diverge. */
export function copy(
  title: string,
  subtitle: string | null,
  body: string,
  extra: {
    fromCoach?: boolean; truncated?: boolean;
    androidTitle?: string; androidBody?: string;
  } = {},
): PushCopy {
  return {
    title,
    subtitle,
    androidTitle: extra.androidTitle ?? fold(title, subtitle),
    body,
    androidBody: extra.androidBody ?? body,
    fromCoach: extra.fromCoach ?? false,
    truncated: extra.truncated ?? false,
  };
}

/** What to actually send to one device. iOS gets the three-line shape; every other platform (and
 *  an unknown/missing platform string) gets the folded form, because a subtitle Android cannot
 *  draw is that half of the copy silently thrown away. */
export function platformCopy(
  c: PushCopy,
  platform: string | null | undefined,
): { title: string; subtitle: string | null; body: string } {
  return platform === 'ios'
    ? { title: c.title, subtitle: c.subtitle, body: c.body }
    : { title: c.androidTitle, subtitle: null, body: c.androidBody };
}
