#!/usr/bin/env node
// OnStandard — every checked-in copy of a shared source file must never drift from its original.
//
// Two module graphs in this repo cannot import each other, so each needs a copy of the code both
// sides must agree on. A copy that silently diverges is the worst kind of bug: nothing throws, and
// the two halves just quietly stop meaning the same thing. Hence a gate.
//
// WHY THERE ARE COPIES AT ALL. `targets/RollCallWidget/` compiles into the widget EXTENSION;
// `modules/rollcall-live/ios/` compiles into the APP. Two of the types are needed by both:
//
//   RollCallAttributes      ActivityKit matches an incoming push to a running activity by this
//                           type's NAME and decodes the payload against its ContentState. The app
//                           starts and updates activities; the extension draws them.
//   RollCallCheckInIntent   the extension constructs it to hand to Button(intent:), so it needs
//                           the type at compile time; Apple requires it in the app target because
//                           that is the process perform() actually runs in.
//
// WHY A TEST RATHER THAN A SYMLINK. Symlinks in this repo have form: the skills symlink farm broke
// the EAS tarball outright (eas-ship-gotchas). A checked-in copy plus a gate that fails the build
// is the same trade the notification category ids already make across the Deno and React Native
// module graphs, which cannot import each other either.
//
// WHAT DRIFT WOULD COST. Nothing throws. The app encodes one ContentState and the extension
// decodes another, so iOS drops the push and no card appears — indistinguishable from the feature
// not being installed. That is exactly the failure a compiler cannot catch and a person will not
// think to look for, which is why it is a gate.
import { readFileSync, existsSync } from 'node:fs';

const PAIRS = [
  // The widget EXTENSION and the APP compile separately and both need these types.
  ['modules/rollcall-live/ios/RollCallAttributes.swift', 'targets/RollCallWidget/RollCallAttributes.swift'],
  ['modules/rollcall-live/ios/RollCallCheckInIntent.swift', 'targets/RollCallWidget/RollCallCheckInIntent.swift'],
  ['modules/rollcall-live/ios/RollCallWidget.swift', 'targets/RollCallWidget/RollCallWidget.swift'],
  // The Notification Service Extension (roll call v3) arms alarms from a push. The alarm's
  // metadata, its intents and the scheduler must be the SAME types the app arms with, or an alarm
  // armed from the push would carry intents the app cannot run.
  ['modules/rollcall-live/ios/RollCallAlarm.swift', 'targets/NotificationService/RollCallAlarm.swift'],
  ['modules/rollcall-live/ios/RollCallCheckInIntent.swift', 'targets/NotificationService/RollCallCheckInIntent.swift'],
  // WHO IS THIS MESSAGE FOR. The proto (browser ES modules, shipped in proto.zip) decides whether
  // to call the AI at all; meal-chat (Deno) enforces the SAME decision server-side so a stale or
  // tampered client cannot buy itself a turn. Two answers to one question is not a fix, so the
  // decision is one file, copied. Drift here means the AI speaks when the app said it should not.
  ['proto/redesign-2026-07/js/ai-addressing.js', 'supabase/functions/_shared/ai-addressing.mjs'],
  // WHAT THE ATHLETE PREFERS TO EAT (0250). The Plan screen saves and filters with the proto file;
  // meal-chat's plan ideas read the stored value through the copy. Drift here means the prompt and
  // the screen disagree about what the athlete said, or a dislike filtered on one side only.
  ['proto/redesign-2026-07/js/food-prefs.js', 'supabase/functions/_shared/food-prefs.mjs'],
];

/** Line endings are not drift: git normalises them on this repo and the compiler does not care. */
const norm = (s) => s.replace(/\r\n/g, '\n');

let bad = 0;
for (const [source, copy] of PAIRS) {
  if (!existsSync(source)) { console.error(`✗ missing ${source}`); bad++; continue; }
  if (!existsSync(copy)) { console.error(`✗ missing ${copy}`); bad++; continue; }
  const a = norm(readFileSync(source, 'utf8'));
  const b = norm(readFileSync(copy, 'utf8'));
  if (a !== b) {
    console.error(`✗ ${copy}\n  has drifted from ${source}`);
    // Name the first differing line, so the fix is obvious rather than a diff hunt.
    const la = a.split('\n'); const lb = b.split('\n');
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) {
        console.error(`  first difference at line ${i + 1}:`);
        console.error(`    source ${JSON.stringify(la[i] ?? '(end of file)')}`);
        console.error(`    copy   ${JSON.stringify(lb[i] ?? '(end of file)')}`);
        break;
      }
    }
    console.error(`  fix: copy the source over the copy, then re-read it.`);
    bad++;
  }
}

if (bad) {
  console.error(`\n${bad} widget mirror${bad === 1 ? '' : 's'} out of sync.`);
  console.error('A drifted ContentState does not throw: iOS silently drops the push and no card');
  console.error('appears, which looks exactly like the feature not being installed.');
  process.exit(1);
}
console.log(`mirrors: ${PAIRS.length}/${PAIRS.length} in sync`);
