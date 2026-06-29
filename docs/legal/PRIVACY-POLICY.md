# AthleteOS — Privacy Policy

> **DRAFT — accurate to the app as of 2026-06-29; requires legal review before publishing. Not legal advice.**
>
> This document was authored by engineering to describe, truthfully, what the AthleteOS
> application actually collects and does as of the date above. It is a review-ready draft
> for a qualified attorney. It is **not** legal advice and is **not** a substitute for
> counsel. It must be reviewed and finalized by an attorney (COPPA, FERPA, GDPR, CCPA/CPRA,
> and state minor-privacy law) before it is hosted at the URL the app links to
> (`PRIVACY_POLICY_URL` = `https://athleteos.app/privacy`) and before the backend is enabled
> for real users.

---

## [FOUNDER + COUNSEL TO COMPLETE] — fill before publishing
The following items are policy or legal decisions that engineering cannot truthfully assert.
Each must be supplied and lawyer-reviewed before this policy goes live:

1. **Legal entity name and registered address** of the operator (used throughout; placeholder `[LEGAL ENTITY NAME]`, `[ADDRESS]`).
2. **Effective date** of this policy.
3. **Privacy contact / DPO**: a real, monitored privacy contact (and an EU/UK representative if GDPR applies). Today the only contact in code is `support@athleteos.app`.
4. **Governing law / jurisdiction** for privacy claims (mirror the Terms).
5. **Data-retention windows** — how long active-account data is kept, and the deletion-completion window after an account is deleted (placeholder `[N] days`). This is a policy decision, not a code fact.
6. **Anthropic (Claude) data-processing terms** — the signed DPA, whether submitted images/data are retained by Anthropic and for how long, and whether they are used for model training. Marked `[FOUNDER/DPA TO CONFIRM]` in §4. Do not publish the §4 claims until verified against the current Anthropic commercial terms / DPA in force.
7. **Subprocessor list confirmation** — confirm the production hosting provider (currently Supabase) and any others, and attach a DPA for each.
8. **International-transfer mechanism** (§12), if data is processed outside the user's country.
9. **Eating-disorder / mental-health resource referral** to include (§6), e.g. a regional helpline.
10. **FERPA / school data-processing addendum** (§8), if the product is sold to or used by schools.

---

**Effective date:** [DATE]
**Operator:** [LEGAL ENTITY NAME], [ADDRESS]
**Contact:** support@athleteos.app

---

## 1. Who this policy is for
AthleteOS is an athlete nutrition-accountability platform for athletes and the people who
support them (parents/guardians, personal trainers, sports-performance coaches,
nutritionists, and high-school and college coaches). The app's primary users are athletes
roughly ages 13–22. **Some athletes are minors.** We treat athlete nutrition, weight, and
check-in data as sensitive and apply heightened protections to minors' data (see §7).

## 2. Two modes: on-device vs. connected
AthleteOS can run in two states, and what we collect depends on which is active:

- **On-device only (default in the current build).** When the app's backend is not enabled,
  the app runs entirely on your device using local storage. In this state, **no personal data
  is sent to or collected by our servers.** Your meals, scores, weight, check-ins, and
  performance entries stay on the device.
- **Connected (backend enabled).** When the backend is enabled and you sign in, your data is
  stored on our hosted infrastructure so it can sync across your devices and be shared with
  the people you have linked, **subject to the consent rules in §7**.

The sections below describe what happens in the **connected** state. In the on-device-only
state, the only data leaving your device is a meal or label photo sent for AI analysis, and
**only** if AI analysis is configured **and** the consent gate in §4 and §7 passes.

## 3. What we collect (connected state)
- **Account and identity:** name, email address, role (athlete / parent / trainer / coach /
  nutritionist), and — for athletes — sport, position, school or program/organization name,
  primary goal, training frequency, and the age you enter at setup.
- **Nutrition and health data:** meals you log and their estimated or transcribed macros
  (protein, calories, carbohydrate, fat); **meal photos and Nutrition Facts label photos**
  you capture (see §4); daily accountability scores; body weight, starting weight, and weight
  goals; daily hydration; weekly check-in answers (energy, recovery, sleep, confidence,
  soreness, motivation); and performance records (PRs such as lifts, sprints, jumps) you
  choose to log.
- **Relationships and links:** the coaches, trainers, nutritionists, and guardians you link
  to; team/join codes; and, for staff accounts, the athletes on your roster or client book.
- **Messages** you send to linked people through the app.
- **Authentication data:** your sign-in credentials are handled by our authentication
  provider; we store your account identifier and email. We never store your password in the
  app.
- **Device/technical:** the app keeps a local copy of your data on the device for offline use.
  When the backend is enabled, our infrastructure provider generates standard service logs.
- **We do NOT collect** advertising identifiers, cross-app tracking data, location data, or
  analytics from third-party advertising/tracking SDKs. The app contains no third-party
  analytics, advertising, attribution, or crash-tracking SDKs, and does **not** display an App
  Tracking Transparency prompt because it performs no such tracking.

## 4. Meal-photo and label analysis by a third-party AI (Anthropic / Claude)
When AI meal analysis is configured for the app, a photo you take of a meal or of a Nutrition
Facts label is sent to our AI provider, **Anthropic (the Claude API)**, to identify foods and
estimate or transcribe nutrition information. This is the **only** path by which a photo or
meal data leaves your device to a third party.

Key facts, accurate to the code:
- The photo is sent only when (a) AI analysis is configured **and** (b) a consent gate passes.
  The same gate that governs all real-data sharing applies here and **fails closed**: an
  athlete who has not given consent, an athlete who has paused sharing, and a **minor whose
  guardian is not verified** never have a photo sent off the device. When the gate blocks, the
  app produces an on-device estimate instead, and **nothing leaves the device.**
- The Anthropic API key is held only on our server (an Edge Function); it is never in the app.
- We use the AI to provide the nutrition feature. **We do not use your photos for advertising.**
- Two other in-app text features ("nutrition memory" and "restaurant coach" rewording) may send
  **already-computed text and numbers** (no photos) to Anthropic purely to reword them in a
  coach voice; the app re-verifies the numbers and never lets the AI change them.

**[FOUNDER/DPA TO CONFIRM]** Anthropic's data-handling, retention period for submitted images
and data, and whether submitted data is used for model training, must be confirmed against the
Anthropic commercial terms / Data Processing Addendum in force and disclosed here before
publishing. Do not publish a specific claim about Anthropic retention or training until verified.

## 5. The AI and the app are not medical advice
AthleteOS provides nutrition education and accountability, **not medical advice.** AI meal
estimates, scores, and coaching copy are estimates and may be inaccurate. The app is not a
substitute for a physician or registered dietitian and must not be used to diagnose or treat
any condition. **[FOUNDER + COUNSEL TO COMPLETE: add an eating-disorder / mental-health
resource referral, e.g. a regional helpline.]**

## 6. How we use your data
We use your data to provide the service: analyze and log meals, compute and show your
accountability score and trends, let the people you have linked see what you have agreed to
share, generate roster/compliance views for your coach or trainer, and send the reminders you
enable. **We do not sell your personal information, and we do not share it for cross-context
behavioral advertising.**

## 7. Who can see your data, and your sharing controls
- **You** can always see and export your own data.
- **People you link** (a coach, trainer, nutritionist, or guardian) can see the athlete data
  you have consented to share — for example your daily score, compliance, and weight trend.
- **Consent is required and revocable.** When the backend is enabled, real athlete data is only
  collected and shared after consent is recorded. You can **pause all sharing** at any time
  from the Profile screen, which immediately stops data leaving the device.
  - **[FOUNDER TO CONFIRM]** In the current build, the in-app "remove viewer" control updates
    your local sharing model; a server-side revocation step is a documented go-live requirement
    before the connected state is enabled for real users. Do not represent server-side
    revocation as live until that step ships.
- **Service providers (subprocessors):** our hosting/database/storage and authentication
  provider (currently **Supabase**), and **Anthropic** for the AI analysis described in §4.
  Each operates under contract. **[FOUNDER + COUNSEL TO COMPLETE: confirm the production
  provider list and attach a DPA for each.]**
- **Legal disclosure:** we may disclose data if required by law or to protect users
  (especially minors).

## 8. Minors and parental/guardian consent
- **Under 13 are barred.** The app does not sign up users under 13 (the minimum signup age is
  13). Because we do not knowingly collect personal information from children under 13, the
  product is intended to fall outside COPPA's scope. If we learn we have collected data from a
  child under 13, we will delete it.
- **Ages 13–17 require verified guardian consent before any data is shared.** For an athlete
  under 18, the app keeps the athlete's real data **on the device only** until a parent or
  guardian has been **verifiably** approved. A self-tapped checkbox by the minor is not
  sufficient; the gate fails closed and a minor stays on-device-only until a guardian is
  verified server-side.
  - **[FOUNDER + COUNSEL TO COMPLETE]** The exact verifiable-consent mechanism (e.g. a
    confirmation link emailed to the guardian and confirmed through a consent vendor or verified
    guardian account) must be described here and implemented before the connected state is
    enabled for minors.
- **Minor safety in messaging.** The app restricts messaging involving minors: a registered
  minor cannot be placed in an unsupervised message thread with an unrelated adult; minor
  messaging is limited to the minor's authorized coach, trainer, or guardian.
- **Guardian rights.** A parent or guardian can review their minor's data, request its
  deletion, and withdraw consent at any time using the in-app controls or by contacting
  support@athleteos.app.

## 9. Education records (FERPA)
Where a school, team, or coach provides rosters, or where AthleteOS handles data that may
constitute education records, we handle that data to provide the service to the school/team and
do not sell it or use it for unrelated purposes. **[FOUNDER + COUNSEL TO COMPLETE: attach a
school data-processing addendum if AthleteOS is sold to or used by schools.]**

## 10. Your rights: access, export, and deletion
- **Export.** You can export a structured (JSON) copy of your own data from the app's Account
  screen at any time. The export includes your identity, your targets, today's log, your score,
  weight, and nutrition history, and your performance records — your own data only.
- **Deletion.** You can permanently delete your account and data from the app. When the backend
  is enabled, deletion removes your server account and cascades to delete the data you own
  (days, meals, check-ins, links, and threads) and your meal-photo storage folder, and signs
  you out; your local on-device data is also wiped. Deletion is built to actually erase data,
  not merely sign you out.
- **GDPR / CCPA-CPRA.** EU/UK residents (GDPR) and California residents (CCPA/CPRA) have
  additional rights, including access, correction, deletion, portability, and the right to opt
  out of the sale or sharing of personal information. **We do not sell or share personal
  information** as those terms are used by CCPA/CPRA. To exercise any right, use the in-app
  controls or email support@athleteos.app.

## 11. Data retention
We keep your data while your account is active. When you delete your account, we delete your
personal data and meal photos as described in §10. **[FOUNDER + COUNSEL TO COMPLETE: specify
the active-account retention policy and the deletion-completion window (`[N] days`), and confirm
the meal-photo storage-bucket lifecycle.]**

## 12. Security
- The app stores your authenticated session token in the device's **encrypted OS keychain**
  (via the platform secure-storage service) on iOS and Android, rather than in plain app
  storage.
- When the backend is enabled, data is transmitted over encrypted connections (HTTPS/TLS), and
  the database enforces **row-level security** so that, server-side, only you and the people you
  have linked can read your data.
- The app bundle contains **no secret keys**. The public API key shipped in the app is a
  publishable key that is safe to expose and is gated by server-side row-level security; the
  Anthropic key lives only on the server.
- We do **not** claim end-to-end encryption of meal photos: photos are sent over an encrypted
  connection to our server and to Anthropic for analysis, where they are processed in the clear
  for that purpose.
- No system is perfectly secure.

## 13. International transfers
**[FOUNDER + COUNSEL TO COMPLETE: if data is processed outside the user's country (e.g. by our
hosting provider or by Anthropic), describe the transfer mechanism.]**

## 14. Changes to this policy
We will post changes here and update the effective date. We will provide notice of material
changes; material changes affecting minors will be communicated to guardians.

## 15. Contact
Questions or requests: support@athleteos.app — [LEGAL ENTITY NAME], [ADDRESS].
