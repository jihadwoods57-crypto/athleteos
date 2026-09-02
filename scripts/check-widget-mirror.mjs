#!/usr/bin/env node
// OnStandard — the widget extension's copies of the shared Swift must never drift.
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
  ['modules/rollcall-live/ios/RollCallAttributes.swift', 'targets/RollCallWidget/RollCallAttributes.swift'],
  ['modules/rollcall-live/ios/RollCallCheckInIntent.swift', 'targets/RollCallWidget/RollCallCheckInIntent.swift'],
  ['modules/rollcall-live/ios/RollCallWidget.swift', 'targets/RollCallWidget/RollCallWidget.swift'],
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
        console.error(`    app       ${JSON.stringify(la[i] ?? '(end of file)')}`);
        console.error(`    extension ${JSON.stringify(lb[i] ?? '(end of file)')}`);
        break;
      }
    }
    console.error(`  fix: copy the app's version over the extension's, then re-read it.`);
    bad++;
  }
}

if (bad) {
  console.error(`\n${bad} widget mirror${bad === 1 ? '' : 's'} out of sync.`);
  console.error('A drifted ContentState does not throw: iOS silently drops the push and no card');
  console.error('appears, which looks exactly like the feature not being installed.');
  process.exit(1);
}
console.log(`widget mirror: ${PAIRS.length}/${PAIRS.length} in sync`);
