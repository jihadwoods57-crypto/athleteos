# OnStandard — your launch checklist (start here)

This is the one page that shows the whole path from here to real users. Everything technical is done
and tested; what's left is accounts, a lawyer, one app build, and a few clicks — plus a couple of
spots where you hand me a key and I finish the code part.

**Legend:** ✅ done · 🔵 you're on it · ⬜ to do · 🤝 you start it, I finish it

---

## Already done (the hard part) ✅
- Backend live, all database migrations applied, all functions deployed
- The app works end-to-end (we tested it in a live browser together)
- Email sending fixed (Resend) — real signup emails deliver
- Every bug you found is fixed (the age/guardian screen, etc.)
- Legal pages written + ready to host; Stripe + App Store steps drafted (this folder)

## What's left — in the order I'd do it

### 1. 🔵 Domain — DONE, you bought it. ✅
Nice. This unblocked everything below.

### 2. ⬜ Host your legal pages (~20 min) — needed for the App Store
- Files are ready: `docs/legal/public/privacy.html` + `terms.html`
- Fill a few blanks (entity name, address, date) and host them so they answer at
  `onstandard.app/privacy` and `/terms`.
- **Full steps:** `docs/legal/public/README.md`
- *I can't host on your domain for you, but the pages are 90% done.*

### 3. 🔵 Apple Developer account — processing. Good.
The moment it clears, you can do step 5.

### 4. 🤝 Stripe — take your first payment (~40 min, then I finish)
- Create the account, a plan (Solo $69 or Starter $249), a payment link, and a webhook.
- **Full steps:** `docs/go-live/STRIPE-SETUP.md`
- **Hand me the two secret keys and I deploy the webhook + verify a test charge.**
- *Not urgent if your first beta is free — only needed to actually charge.*

### 5. ⬜ Build the app + put it on TestFlight (~1 hr, once Apple clears)
- Set 2 environment variables (⚠️ easy to miss — the build won't reach the backend without them),
  then two commands: `eas build` and `eas submit`.
- **This one build unlocks push notifications, invite links, and the camera.**
- **Full steps + ready-to-paste App Store listing + Apple privacy answers:** `docs/go-live/APP-STORE-SETUP.md`

### 6. ⬜ Get your first gym on it
- With the app on TestFlight, walk one gym owner through creating a team and inviting their athletes
  (adults first — it skips the whole parental-consent process). That's your first real users.

---

## The three places I'm standing by to finish for you 🤝
The moment you have each of these, tell me and it's minutes of work on my end:

1. **Stripe** → give me `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` → I deploy the webhook + test it.
2. **A first paying coach's user id** → I'll confirm their subscription row flipped to active.
3. **Anything that breaks** as you or a tester walk the app → I diagnose + fix on the live stack (I did
   this today with the email and age-screen bugs).

## The shortest path to money
Domain (done) → **host legal pages (step 2)** → Apple clears → **build + TestFlight (step 5)** → walk
one gym through it (step 6). Stripe (step 4) whenever you're ready to charge. Steps 2, 4, and the
build are the only real work left, and none of it is coding.

---

*Detailed runbooks in this folder and `docs/legal/public/`:*
- `docs/legal/public/README.md` — finish + host the legal pages
- `docs/go-live/STRIPE-SETUP.md` — Stripe, step by step
- `docs/go-live/APP-STORE-SETUP.md` — build, submit, and the store listing copy
