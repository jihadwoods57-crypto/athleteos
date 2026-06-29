# When you get back to the computer — start here

Plain-English, in order. The full technical version is `docs/LAUNCH-CHECKLIST.md`; the
business decisions you already approved are in `docs/founding/STRATEGIC-DECISIONS.md`.

The honest truth: **the app is built. What's left is mostly NOT code — it's people and
accounts.** The fastest path to launch is starting the slow human stuff first.

---

## 1. THE most important thing — start the human chain (this week)
These take days/weeks because other people do them, and everything else waits on them.
Get all three *moving* before you touch anything technical:

- [ ] **Call a lawyer** — privacy policy + terms reviewed, and sign-off on handling minors'
      data (COPPA/FERPA). Get the policy hosted at a real web link.
- [ ] **Pick a parent-verification vendor** — the service that confirms a parent is really a
      parent. This is what lets a teen's data actually sync. Until it exists, every minor
      stays local-only.
- [ ] **Pick an email service** — for sign-up confirmation emails and the parent-approval link.

You can do steps 2–5 in parallel, but if you only do one thing, do this one.

## 2. Get the code in front of you (15 minutes)
- [ ] Pull the branch **`claude/crew-update-wvkvhh`** (everything I built is there).
- [ ] `npm install`, then `npm run verify` — confirms it all builds and the ~1,012 tests pass.
- [ ] Optionally run it (`npx expo start`) to click around. It's still in free-preview mode —
      nothing is connected to a real server yet, which is correct.

## 3. Lock the prices + set up billing (your call, then ~an afternoon)
- [ ] Look at `docs/founding/LAUNCH-PRICING.md` and **bless or tweak the numbers** (they're
      just settings — change anything).
- [ ] Set up **Stripe** with those prices, and a "billing portal" link for cancellation.
- [ ] Once you have that link, the checkout screen I built goes live as-is (it's already
      compliant — shows price, auto-renewal, trial, easy cancel).

## 4. Turn the backend on (technical, ~an hour — only after step 1 is in motion)
Do these in order; full detail in `docs/LAUNCH-CHECKLIST.md`:
- [ ] Apply the database migrations to your live Supabase project, **one at a time, in order**:
      `0004 → 0005 → 0007 → 0008 → 0009 → 0010 → 0011 → 0012`. (They're written and tested;
      `0012` swaps how access is checked — re-run the quick equivalence check on a copy of real
      data first, it's noted in the file.)
- [ ] In Supabase, flip **email confirmation ON**.
- [ ] Set three settings and rebuild: your Supabase URL, your Supabase key, and
      `EXPO_PUBLIC_BACKEND_LIVE=true`. **That single switch is what turns the whole backend on**
      — and turning it back off is your instant kill-switch.
- [ ] Wire the small "parent clicked approve" endpoint (needs the vendor from step 1).

## 5. The phone + the App Store (needs a real device)
- [ ] Test notifications, the camera, and meal photos on a real phone (the simulator can't).
- [ ] **Sign in with Apple** — Apple requires it since you offer email login. Add the Apple
      capability + the native module (it's already wired in the code; it just needs the
      Apple-developer-account setup). Notes are in the launch checklist.
- [ ] Submit to Apple (the in-app account-deletion they require is already built).

## 6. Then the only thing that actually matters — real users
- [ ] Recruit a few **gyms / performance facilities** (your chosen beachhead) + their clients,
      and watch whether people actually keep using it. Plan is in `docs/BETA-TEST-PLAN.md`.

---

### One-line version
**Call the lawyer + the two vendors today. Pull the code and run `npm run verify` to see it's
all there. Everything else lines up behind those.**

### Where to read more
- Strategy & the company plan: `docs/founding/` (start with `05_SYNTHESIS_AND_CHALLENGES.md`).
- The architecture: `docs/architecture/` (start with `00` and the `DECISION-MEMO`).
- The full go-live list: `docs/LAUNCH-CHECKLIST.md`.
