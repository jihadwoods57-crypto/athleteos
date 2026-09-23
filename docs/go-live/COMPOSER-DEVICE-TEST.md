# Go-live: composer device test

The composer upgrade (2026-09-23: the keyboard as one motion, one flush bar at the bottom of every
thread, dictation) was built and checked in a headless browser, which cannot raise a real keyboard,
cannot run WKWebView, and has no microphone. Everything below is what only a phone can prove. Run it
on the native build that carries expo-speech-recognition (the first build after this branch), on an
iPhone with a home indicator (any Face ID model), then once on an Android phone.

Kept separate from ROLLCALL-DEVICE-TEST.md on purpose: it is a different feature, one phone, and a
ten-minute pass that should be rerun after any change to `js/keyboard.js`, `js/dictation.js`,
`src/proto/ProtoApp.tsx` or the `.chat-dock` rules in `css/screens.css`.

You need: one athlete account with a logged meal that has a few messages in its thread, and one
coach account on the same team (for the coach's view of that meal). Turn on Settings > Accessibility
> Motion > Reduce Motion for one pass of step 2 at the end.

## 1. The four threads, keyboard up and down

Run each of these on all four threads: **the meal page** (Home, tap a logged meal), **a past meal**
(History, tap an older meal), **the full chat** (the meal page's Open), **the coach's view of a
meal** (coach account, an athlete's meal).

1. **Rest.** Scroll to the bottom.
   Expected: the message box is one bar flush with the bottom edge of the screen, its glass running
   under the home indicator. No grey band under the pill, no empty line, no "Back to Home" (or "Back
   to History") button anywhere at the bottom. The way out is the back arrow at the top left.
2. **Tap the box.**
   Expected: ONE motion. The bar rises with the keys, riding exactly on top of them, and the newest
   message rises with it, staying just above the bar the whole way. Look specifically for, and fail
   the step on, any of: the whole screen (header included) jumping up and snapping back; the keys
   covering the bar for a moment before the bar moves; the bar arriving and then the conversation
   scrolling a second time; a flash of grey or of the page behind; the header moving at all.
3. **Type three lines, then five more.**
   Expected: the box grows a line at a time, up to about five lines, then scrolls inside itself. The
   newest message stays just above the bar as it grows.
4. **Tap the conversation's empty ground** (between bubbles).
   Expected: the keys go down and the bar comes down with them in one motion, back to resting flush
   on the bottom edge. Same failure list as step 2, in reverse.
5. **Scroll up into older messages first, then tap the box.**
   Expected: the bar rides the keys, and the older messages you were reading stay where they are
   (the thread does not jump to the end on its own).
6. **Send a message with the keys up.**
   Expected: the message lands at the bottom, just above the bar, and the box shrinks back to one line.
7. **Rotate / background:** with the keys up, swipe home, then return to the app.
   Expected: the screen is fully usable (it scrolls and taps). A stuck-short screen is a fail.

## 2. Dictation

1. **First tap of the mic** (a fresh install, or reset Settings > General > Transfer or Reset >
   Reset Location & Privacy).
   Expected: two iOS prompts, microphone and speech recognition, each reading OnStandard's own
   sentence about tapping the mic in a chat (never "Allow OnStandard to access your microphone").
   Allow both.
2. **Say "two eggs, turkey bacon and a bowl of oatmeal".**
   Expected: the mic has become a blue stop button with a ring that moves with your voice; the words
   appear in the box as you speak, and the box grows if they wrap. The placeholder reads "Listening…"
   before the first word.
3. **Tap stop.**
   Expected: listening ends, the last words land, and the text stays in the box. NOTHING sends.
   Send (the blue arrow) is now where the mic was. Edit a word, then send it yourself.
4. **Type a sentence, move the caret into the middle, tap the mic, say "and rice".**
   Expected: "and rice" is inserted at the caret, with spaces either side, not appended at the end.
5. **Tap the mic and start typing on the keyboard.**
   Expected: listening stops at once; your typing stays.
6. **Tap the mic, then leave the app** (swipe home). Come back.
   Expected: not listening any more (the mic is idle, no orange microphone dot in the status bar).
7. **Tap the mic and say nothing for 10 seconds, then tap stop.**
   Expected: no error line (stopping with nothing said is not an error). If recognition times out
   on its own first, one line reads "Didn't catch that. Tap the mic and try again."
8. **Denied.** Settings > OnStandard > turn Microphone off. Back in a thread, tap the mic.
   Expected: one line under the box: "To dictate, turn on Microphone and Speech Recognition for
   OnStandard in Settings." The mic stays (tapping it is how you learn why). Turn it back on and it
   works without relaunching.
9. **On-device vs network.** Settings > General > Keyboard > Dictation languages: with English
   (US) downloaded, put the phone in Airplane Mode and dictate.
   Expected: it still works (on-device). Then on a phone or language without the on-device model,
   in Airplane Mode: one line, "Dictation needs a connection right now. Try again, or type it."
   With a connection it works (network recognition). Note which happened on each phone.
10. **All four threads.** Dictate one short message in each of the four threads, and in Plan > Ask
    OnStandard.
11. **Android.** Repeat 2, 3, 5 and 8 (Android's prompt is one microphone permission).
    Expected: the same behaviour; the keyboard on Android resizes the app on its own, so step 1.2 is
    judged the same way (one motion, header still).

## 2b. Added after review (fix round 1)

1. **Stop, then an immediate re-tap.** Tap the mic, say two words, tap stop, and within a second
   tap the mic again and say "rice". Then tap stop.
   Expected: only "rice" arrives after the re-tap (nothing late from the first session), the second
   session listens normally, and after the final stop the orange microphone dot in the status bar
   CLEARS within about a second. An orange dot that stays on with an idle mic is a fail.
2. **One box, then another.** On the full chat, tap the mic, then go back to the meal page and tap
   its mic straight away. Expected: the second listens; the orange dot clears when you stop it.
3. **Coach private note.** Coach account, a meal, ⋯ > Private note, type three lines.
   Expected: the note box is fully visible above the keys the whole time, never under the
   "Comment on this meal" bar.
4. **Another language.** Settings > General > Language & Region: set iPhone Language to Spanish,
   dictate in Spanish. Expected: Spanish text. Switch back afterwards.
5. **iPad, Stage Manager.** With Stage Manager on and OnStandard in a window that does not touch the
   bottom of the screen, tap a thread's box. Expected: the bar ends up above the keys once they
   land (it may arrive a beat late there: the native keyboard frame is in screen coordinates, so the
   page corrects from its own measure after the animation).
6. **iPad with a trackpad or mouse attached.** Open a meal thread in portrait and landscape.
   Expected: the app fills the screen (no desktop-style phone frame). If a phone frame appears and
   its bottom cannot be scrolled to, report it: with the WebView's outer scroll off on iOS, that
   layout has no way to scroll (review M-3; a pre-existing layout gap, made visible by this change).

## 2c. Fields outside a thread (final review M-7)

`scrollEnabled={false}` on the iOS WebView removes WebKit's own reveal for EVERY input, so every
form field now relies on keyboard.js alone. Check two that sit low on the screen:

1. **Sign-in.** Sign out, tap the password field (the lowest field on the screen). Expected: the
   field sits above the keys while typing; nothing is hidden under them.
2. **Onboarding.** Start onboarding on a fresh account and tap the lowest field on any step.
   Expected: the same. Then dismiss the keys: the screen does not jump (a form is never pinned to
   its end when the keys go away; only a thread is).

## 3. An older build

On a phone still on the build before this branch, install the OTA that carries this proto.
Expected: no mic appears anywhere (the old binary has no speech module), the bottom bar is the new
flush bar, and section 1 passes there too: the keyboard forwarding and `scrollEnabled` live in
ProtoApp.tsx, which is JavaScript and rides the same update, and react-native-webview already
supports the prop. Any crash is a fail.

## What to report back

For each failed step: the thread, the step number, and a screen recording. For step 1.2 a screen
recording is the only useful evidence; a screenshot cannot show a double move.
