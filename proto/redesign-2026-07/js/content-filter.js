/* App Store Guideline 1.2: an app with user-generated content needs a method for FILTERING
 * objectionable content, not only for reporting it after the fact. This is that method: a short,
 * whole-word list of slurs and abuse, checked on the device before a message, an announcement or
 * a display name is sent. It is deliberately small. A long list catches "Scunthorpe" and a
 * running back's own surname; a short one catches the words nobody types by accident. The
 * human review behind Report (members-sheet.js, content_reports) is still the real moderation.
 *
 * Matching folds case, strips punctuation and squeezes letter runs ("fuuuck" -> "fuck") so the
 * usual dodges do not walk past it. Whole-word only: "assist" and "class" are clean. */

const TERMS = [
  // slurs
  'nigger', 'nigga', 'niggers', 'niggas', 'faggot', 'faggots', 'fag', 'fags', 'retard', 'retards', 'retarded',
  'tranny', 'trannies', 'kike', 'kikes', 'spic', 'spics', 'chink', 'chinks', 'wetback', 'wetbacks',
  'gook', 'gooks', 'raghead', 'towelhead', 'beaner', 'beaners', 'dyke', 'dykes', 'coon', 'coons',
  // sexual harassment and threats
  'cunt', 'cunts', 'whore', 'whores', 'slut', 'sluts', 'rape', 'raped', 'rapist',
  'kys', 'kill yourself', 'kill urself', 'go die', 'neck yourself',
];
const RE = new RegExp(`(?<![a-z0-9])(?:${TERMS.map((t) => t.replace(/ /g, '\\s+')).join('|')})(?![a-z0-9])`, 'i');

/** The text folded the way the list expects: lower-case, no punctuation, no letter runs. */
function fold(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[@$]/g, 'a').replace(/[0]/g, 'o').replace(/[1!|]/g, 'i').replace(/[3]/g, 'e').replace(/[5]/g, 's')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/([a-z])\1{2,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the text carries something the app will not carry for you. */
export function objectionable(text) {
  const s = fold(text);
  return !!s && RE.test(s);
}

/** The one sentence shown in place of a filtered send. Says what, not which word. */
export const FILTERED_NOTE = 'That can’t be sent. Slurs, threats and sexual abuse aren’t allowed here.';
