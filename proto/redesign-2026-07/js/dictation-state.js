/* The composer's dictation rules, pure (composer upgrade, 2026-09-23). No DOM here: dictation.js
   applies these, dictation.test.mjs pins them, and the stylesheet mirrors composerMode() with its
   html.can-dictate / .has-text / .has-photo / .listening selectors (screens.css, "The microphone"). */

/** Which control sits in the pill's right slot.
 *   'stop'      listening: the blue stop control, and nothing else (never auto-send)
 *   'send'      there is something to send (words, or a photo on its own)
 *   'mic'       the box is empty and dictation can run here
 *   'send-idle' the box is empty and there is no dictation (web, an older app): send as before */
export function composerMode({ text = '', photo = false, listening = false, canDictate = false } = {}) {
  if (listening) return 'stop';
  if (String(text).trim() || photo) return 'send';
  return canDictate ? 'mic' : 'send-idle';
}

/** Where dictated words go: at the caret, between what was typed before it and after it. */
export function splitAtCaret(value, start, end) {
  const v = String(value ?? '');
  const a = Number.isInteger(start) ? Math.max(0, Math.min(start, v.length)) : v.length;
  const b = Number.isInteger(end) ? Math.max(a, Math.min(end, v.length)) : a;
  return { before: v.slice(0, a), after: v.slice(b) };
}

/** Typed text plus the running transcript, as the box should read and where the caret belongs.
 *  One space either side where words would otherwise touch, none before punctuation that follows,
 *  and a capital where the dictation starts a sentence. The transcript is the WHOLE session so
 *  far, so calling this again with a longer one replaces the previous words rather than adding. */
export function mergeDictation(base, transcript) {
  const before = String(base?.before ?? '');
  const after = String(base?.after ?? '');
  let t = String(transcript ?? '').trim();
  if (!t) return { value: before + after, caret: before.length };
  if (!before.trim() || /[.!?]\s*$/.test(before)) t = t.charAt(0).toUpperCase() + t.slice(1);
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = after && !/^[\s.,!?;:]/.test(after) ? ' ' : '';
  const head = before + pre + t;
  return { value: head + post + after, caret: head.length };
}

/* One plain line per reason, shown under the box. No jargon, no blame, and each says what to do. */
const COPY = {
  denied: 'To dictate, turn on Microphone and Speech Recognition for OnStandard in Settings.',
  unavailable: 'Dictation isn’t available on this phone right now. You can still type.',
  'no-speech': 'Didn’t catch that. Tap the mic and try again.',
  network: 'Dictation needs a connection right now. Try again, or type it.',
  interrupted: 'Dictation stopped for a call or another app.',
  busy: 'Dictation is busy. Try again in a moment.',
  failed: 'Dictation stopped. Try again, or type it.',
};
export function dictationMessage(code) {
  return COPY[code] || COPY.failed;
}
