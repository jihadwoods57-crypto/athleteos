/* The one line under the greeting that says where the athlete belongs.
 *
 * It read `${weekday} · ${teamName}` and nothing else, which meant an athlete with no coach got a
 * bare weekday and the school they had typed into their own profile appeared on exactly one
 * screen in the app. The founder hit it from the other side: "I updated my school in the profile
 * but it didn't update on my Home Screen." It could not have. Home was reading a different field,
 * off a different object, written by a different flow.
 *
 * PRECEDENCE, founder-ruled 2026-09-10 and REVERSED the same day. I shipped it team-first,
 * reasoning that a coach-verified membership outranks self-declared free text. The founder set
 * their school to University of Central Florida, saw Home still reading "Northgate Varsity", and
 * said it was still not working. They are right and my reasoning was wrong in the way that
 * matters: the school is the field the athlete can actually EDIT, so it is the one they expect to
 * see change when they edit it. A line that ignores the only control you were given is a line
 * that looks broken, however defensible the data behind it is.
 *
 * So the school wins when it is set, and the team is the fallback for the athlete who never typed
 * one. An athlete who would rather see their team simply leaves the school blank, which makes the
 * control work in both directions.
 *
 * Dependency-free on purpose, like score-band.js: home.js imports state.js, so a helper that
 * lived there could not be unit-tested without booting the app, and this rule is worth a real
 * test rather than a source-shape pin.
 */

/**
 * @param {string} day       the weekday, already localised ("Wednesday")
 * @param {string?} teamName the coach-verified team, used when no school is set
 * @param {string?} school   the athlete's own school or organisation, self-declared; wins
 * @returns {string} "Wednesday · Lincoln High", or just "Wednesday"
 */
export function identityLine(day, teamName, school) {
  const org = String(school || '').trim() || String(teamName || '').trim();
  return org ? `${day} · ${org}` : day;
}
