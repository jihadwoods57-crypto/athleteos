# App Store — build & submit (founder steps)

Your app config is submission-ready: app icon, camera/photo permission descriptions, bundle id
(`com.onstandard.app`), portrait, dark-mode support — all set. What's left is (1) one build-time
setting you must add, (2) the build + submit commands (once your Apple account clears), and (3) the
store listing, which I've drafted below so you can paste it in.

---

## ⚠️ 1. The one thing that will break the build if you skip it — env vars

The production app needs to know your backend URL + public key. These are **not** committed to the
code (keys don't belong in git), so you set them once as **EAS environment variables**. Miss this and
the built app opens but can't reach your backend.

After `npm install -g eas-cli` and `eas login`, from the project folder run:

```
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL \
  --value https://ftwrvylzoyznhbzhgism.supabase.co
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY \
  --value <your anon key: Supabase → Settings → API → anon public>
```

Optional (once Stripe is set up): the "Manage plan" button target:
```
eas env:create --environment production --name EXPO_PUBLIC_BILLING_PORTAL_URL --value <your Stripe portal link>
```

*(`EXPO_PUBLIC_BACKEND_LIVE=true` is already baked into eas.json, so you don't set that one.)*

## 2. Build & submit (once your Apple Developer account is active)

```
eas build --platform ios --profile production      # builds the app in Expo's cloud (~15-20 min)
eas submit --platform ios --profile production      # uploads it to App Store Connect / TestFlight
```

`eas build` will ask to log in to your Apple account and will handle the signing certificates for you.
When it's done, the build appears in **App Store Connect → TestFlight** — put it on your own phone
first, then invite your first gym before any public listing. **This one build also turns on push
notifications, the invite deep-links, and the camera** (all of which can't be tested in the browser).

## 3. App Store listing — draft copy (paste into App Store Connect)

**Name:** `OnStandard`
**Subtitle (≤30 chars):** `Nutrition accountability`
**Promotional text (≤170):**
> Snap a photo of your meal. Get an instant nutrition score and coach-ready feedback. Build the
> habit that actually moves the needle — and let your coach see you show up.

**Keywords (≤100 chars, comma-separated):**
`nutrition,athlete,macros,protein,meal tracker,coach,accountability,sports,diet,team,fitness,log`

**Description:**
> OnStandard is the nutrition-accountability app built for serious athletes and the coaches who push
> them.
>
> Snap a photo of your meal and OnStandard reads it, estimates your macros, and scores the meal for
> your goal — instantly. No tedious searching, no guesswork. Your daily Execution Score shows exactly
> where you stand and what to do next.
>
> • Photo-log meals — AI reads the plate and scores it for your goal
> • A daily accountability score that reflects what you actually did
> • Protein, calories, hydration, weight, and weekly check-ins in one place
> • Link your coach, trainer, or parent — they see what you agree to share
> • Coaches: see your whole roster's day at a glance and nudge who's slipping
>
> Built to be honest: the number reflects your real work, and your data stays yours. You control what
> you share, and you can pause or delete it anytime.
>
> OnStandard provides nutrition education and accountability, not medical advice.

**Support URL:** `https://onstandard.app`
**Marketing URL:** `https://onstandard.app`
**Privacy Policy URL:** `https://onstandard.app/privacy`  *(host the legal pages first)*

## 4. Apple "App Privacy" answers (the data questions during submission)

Apple asks what data you collect. Based on your actual app, answer:

| Data type | Collected? | Linked to identity? | Used for tracking? |
|---|---|---|---|
| Contact Info — **Email** | Yes | Yes | No |
| Health & Fitness (nutrition, weight, check-ins) | Yes | Yes | No |
| User Content — **Photos** (meal photos) | Yes | Yes | No |
| User Content — Other (messages, notes) | Yes | Yes | No |
| Identifiers — User ID | Yes | Yes | No |
| Usage Data / Analytics | **No** | — | — |
| Location | **No** | — | — |

**Tracking:** answer **"No, this app does not track."** You have no third-party analytics, ads, or
attribution SDKs, so there's **no App Tracking Transparency prompt** — which is correct and true.

Each "Yes" above is **"App Functionality"** as the purpose (not advertising, not analytics).

## 5. Age rating
Because minors can use it and it involves messaging, expect a rating around **12+**. Answer the
questionnaire honestly (no objectionable content; user-generated messaging is present but restricted
for minors, which you can note).

---

**What I can't do here:** the Apple account, the build (needs your Apple login), and typing into App
Store Connect are all yours. **What I've done:** the config is build-ready, and the listing + privacy
answers above are drafted so you're mostly copy-pasting. Set the env vars in step 1 *before* your first
build — that's the one easy-to-miss step.
