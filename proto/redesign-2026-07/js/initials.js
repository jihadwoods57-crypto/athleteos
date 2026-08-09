/* Monogram initials, in ONE place.
 *
 * Seven surfaces derived an avatar monogram by hand — S.athlete, S.coach, S.coachIdentity,
 * S.trainerIdentity, the chat avatar, the connected-standards row, the room member chip — and
 * every one of them did it with `name[0]` or `.charAt(0)`.
 *
 * Both index a JS string by UTF-16 CODE UNIT, so any name whose first character is astral gets
 * sliced in half and the avatar renders the replacement glyph. That is not hypothetical for a
 * product whose primary users are 13-to-22-year-olds: "🐐 Jayden O'Brien-Washington" rendered
 * as a broken box next to a J, on Home and on Profile, for as long as the name stayed set.
 * A leading quote, dash or period had the same effect, minus the mojibake.
 *
 * The rule here reads the name by CODE POINT and takes the first LETTER OR DIGIT of each word,
 * so emoji, punctuation and combining marks are skipped rather than sampled. First word plus
 * last word, which is what "initials" means and what the chat avatar already did; the four
 * state.js copies took the first two words, so "Mary Jane Watson" was MJ on Profile and MW in
 * the thread. One rule, one answer.
 *
 * DEPENDENCY-FREE ON PURPOSE, for the same reason score-band.js is: state.js imports roles.js
 * and components.js imports state.js, so this cannot live in components.js. A leaf module is
 * importable from anywhere, and is testable in plain node.
 */

/* \p{L} covers accented Latin, Cyrillic, Greek, CJK and every other script a real roster
   carries; \p{N} keeps a name like "3K" from falling through to the fallback. */
const LETTER = /[\p{L}\p{N}]/u;

/** First letter-or-digit of a word, read by code point. '' when the word is all symbols. */
function firstGlyph(word) {
  for (const ch of word) if (LETTER.test(ch)) return ch;
  return '';
}

/**
 * Avatar monogram for a display name.
 * @param {string} name     the display name, as entered
 * @param {string} fallback what to show when the name yields no letters ('A', 'C', 'T', '?')
 * @param {number} max      how many glyphs to return (2 for an avatar, 1 for a small chip)
 */
export function initialsOf(name, fallback = 'A', max = 2) {
  const glyphs = String(name == null ? '' : name)
    .trim()
    .split(/\s+/)
    .map(firstGlyph)
    .filter(Boolean);
  if (!glyphs.length) return fallback;
  // toLocaleUpperCase, not toUpperCase: a Turkish "i" must become "İ", and the roster is real.
  if (max <= 1 || glyphs.length === 1) return glyphs[0].toLocaleUpperCase();
  return (glyphs[0] + glyphs[glyphs.length - 1]).toLocaleUpperCase();
}
