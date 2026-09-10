/* The one line under the greeting that says where the athlete belongs.
 *
 * It read `${weekday} · ${teamName}` and nothing else, which meant an athlete with no coach got a
 * bare weekday and the school they had typed into their own profile appeared on exactly one
 * screen in the app. The founder hit it from the other side: "I updated my school in the profile
 * but it didn't update on my Home Screen." It could not have. Home was reading a different field,
 * off a different object, written by a different flow.
 *
 * The precedence is deliberate and is the whole reason this is a function rather than an `||`.
 * A TEAM is a coach-verified membership: someone with a roster put this athlete on it, and it
 * names the actual room they answer to. A SCHOOL is self-declared free text. When both exist the
 * team is both more specific and more trustworthy, and a team name usually carries the school
 * inside it ("Lincoln Varsity Football"), so printing both would repeat the word Lincoln twice in
 * a six-word line. The school is what an athlete has BEFORE a coach, which is exactly when this
 * line was emptiest.
 *
 * Dependency-free on purpose, like score-band.js: home.js imports state.js, so a helper that
 * lived there could not be unit-tested without booting the app, and this rule is worth a real
 * test rather than a source-shape pin.
 */

/**
 * @param {string} day       the weekday, already localised ("Wednesday")
 * @param {string?} teamName the coach-verified team, when the athlete is on one
 * @param {string?} school   the athlete's own school or organisation, self-declared
 * @returns {string} "Wednesday · Lincoln Varsity Football", or just "Wednesday"
 */
export function identityLine(day, teamName, school) {
  const org = String(teamName || '').trim() || String(school || '').trim();
  return org ? `${day} · ${org}` : day;
}
