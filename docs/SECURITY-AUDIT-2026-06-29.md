# AthleteOS — Full Security Audit (2026-06-29)

Whole-codebase + Supabase-backend audit run by five parallel read-only auditors
(auth/session, database RLS/authz, consent/COPPA/privacy, secrets/config/supply-chain,
client-side/new-code). Every finding below was **adversarially re-verified against the
actual code** before action — security audits produce false positives, so nothing here is
a relayed claim. Fixes were applied in one batch, `npm run verify` stays green (1018 tests,
up from 1012), and the new migration was validated on a throwaway Postgres (18/18 assertions).

**Headline:** the codebase is unusually disciplined about the client/server boundary and
the backend-off kill-switch. One genuine *active* leak existed (minor meal photos to a
third-party AI without a consent gate); it is now fixed. The rest were defense-in-depth /
go-live hardening. No leaked secrets. No service-role key or DB password anywhere.

Severity legend: **CRITICAL** (active breach) · **HIGH** · **MEDIUM** · **LOW/INFO**.
Status: **FIXED** (this batch) · **GO-LIVE** (must be done before the relevant flag flips) ·
**CORRECT** (verified safe).

---

## FIXED in this batch

### H1 — Minor meal photos were sent to Anthropic with no consent gate · HIGH · FIXED
`src/store/useStore.ts` `capture()`
The meal-photo → AI path (`capture()` → `analyzeMeal` → Edge Function → Anthropic Claude
vision) was gated only on `isAiConfigured`, which is **independent of `isBackendLive`**
(the "shared-project flag trap": the AI endpoint can be live while the database backend is
staged). So a **minor's** real meal photo could leave the device to a third party **before
any guardian was verified, before consent was recorded, and even while "Pause all sharing"
was on** — directly contradicting the COPPA invariant the rest of the app enforces.
`recordMeal` correctly gates the *database* write, but the photo had already been
transmitted to Anthropic during `capture()`, before `recordMeal` runs.
**Fix:** `capture()` now clears the same fail-closed gate as `pushDay`/`recordMeal` —
`realDataConsent(consentContextFromState(get(), isAiConfigured))` — before any remote call.
When the gate fails (un-consented athlete, unverified minor, or sharing paused) it degrades
to the deterministic on-device analysis, so **nothing leaves the device**. Regression tests
added in `src/store/captureConsent.test.ts` (minor-no-consent, paused, unverified-minor all
blocked; consenting adult allowed).

### H2 — Sign-out did not terminate the Supabase session · HIGH · FIXED
`src/store/useStore.ts` `signOut`; buttons at `Profile.tsx:337`, `Account.tsx:150`
Both Sign-out buttons called `signOut`, which only reset navigation (`flow → onboarding`).
It never called `auth.signOut()` and never cleared `userId` / consent / entitlement — so
once the backend is live, tapping "Sign out" would leave a **live, authenticated session and
its refresh token in AsyncStorage** behind. `signOutLive` (which does it correctly) was wired
to no screen.
**Fix:** `signOut` now composes `signOutLive` (terminates the Supabase session + clears
`userId`/`realDataConsent`/`entitlement`) with the nav reset, so both buttons do both. Local
state still resets even if the network sign-out fails. Test added in `auth.test.ts`.

### H3 — Minor-messaging gate was one-directional (child-safety bypass) · HIGH · FIXED
`supabase/migrations/0006` → fixed forward in **`0013_security_hardening.sql`**
`messaging_authorized(t_athlete, t_counterpart)` only checked `is_minor(t_athlete)`. An
adult could open a thread with **themselves as `athlete_id` and a registered minor as
`counterpart_id`**, and the gate returned `not is_minor(adult)` = true — an unsupervised
adult↔minor channel.
**Fix:** the gate now governs **both** parties. The athlete side keeps the fail-closed
`is_minor` check (unchanged — no existing protection weakened); a new clause blocks a
**registered minor** sitting in the counterpart slot unless the other party is their
authorized coach/trainer/guardian. The counterpart clause keys on `is_registered_minor()`
(a real minor `athlete_profile`) rather than `is_minor()` — because `is_minor()` treats any
id with no `athlete_profile` as age 0, which would have mis-flagged every adult overseer and
broken legitimate minor↔coach threads. **This subtlety was caught by the throwaway-Postgres
validation** (the naive symmetric version failed 3 legit-thread assertions). Verified: the
bypass is blocked; minor↔coach/guardian still works; two minors blocked (safe default).

### H4 — `org_memberships` admin read policy self-recursion · HIGH · FIXED
`supabase/migrations/0011` `om_read_admin` → fixed in `0013`
0011's `om_read_admin` policy queried `org_memberships` **inside a plain policy on
`org_memberships`** — Postgres aborts any such read with *"infinite recursion detected in
policy."* This is latent: any admin's `select` on the table would fail. (Found while
validating the `orgs_read` fix below, which surfaced the recursion.)
**Fix:** routed the admin check through a `SECURITY DEFINER` helper `is_org_admin()` (the
same RLS-breaking pattern the 0002 helpers use), and rebuilt `om_read_admin` on it. Verified
non-recursive on Postgres.

### M1 — Blanket DML grant on service-role-only tables · MEDIUM (HIGH if a policy ever slips) · FIXED
`supabase/migrations/0005` → fixed in `0013`
0005 granted `authenticated` INSERT/UPDATE/DELETE on **all** tables and, worse, set
`alter default privileges … grant … to authenticated` so **every future table** inherits
DML. Today, writes to `subscriptions` (self-granting a paid plan) and `org_memberships`
(forging an access grant) are blocked **only by the absence of an RLS write policy** — one
forgotten policy from a breach.
**Fix:** `0013` revokes INSERT/UPDATE/DELETE on `subscriptions` and `org_memberships` from
`authenticated` (they keep SELECT; writes come only from the service-role webhook/RPCs), and
reverses the dangerous default-privilege DML grant so future tables must grant explicitly.
Athlete-owned tables (days/meals/checkins/…) keep their grants — their self-write RLS needs
them. Verified on Postgres: `authenticated` now lacks INSERT on both tables, retains it on
`days`, service_role retains full DML.

### M2 — `can_view` cutover dropped trainer/guardian access · MEDIUM · FIXED
`supabase/migrations/0012` → fixed in `0013`
0012 swapped `can_view()` to the memberships predicate, but its backfill is **teams-only**
(`practice_clients`/`guardianships` are a later phase). A memberships-only `can_view` would
silently revoke every trainer's and guardian's read access at go-live. (Self-reported — this
was our own migration.)
**Fix:** `0013` redefines `can_view` as the **union** of the membership predicate and the
legacy `is_trainer_of`/`is_guardian_of` checks, until those relationships are backfilled. No
relationship loses access; none widens. Verified: trainer sees client, guardian sees ward,
coach sees member (via memberships), stranger denied.

### M3 — `orgs_read using (true)` leaked the org list · MEDIUM · FIXED
`supabase/migrations/0002` → fixed in `0013`
Any authenticated user could enumerate every organization (name, type, creator).
**Fix:** `0013` scopes `orgs_read` to orgs the caller created, belongs to (team
member/staff), or is an active org member of (via the `SECURITY DEFINER` `in_org()` helper,
to avoid re-triggering `org_memberships` RLS). Join-by-code is unaffected (it goes through
`SECURITY DEFINER` RPCs, not this policy). Verified: a stranger sees 0 orgs, the creator and
a member each see exactly 1.

### M4 — `deleteAccount` left the local session token behind · MEDIUM · FIXED
`src/store/useStore.ts` `deleteAccount`
Deleted the server account and wiped local storage, but never called `auth.signOut()`, so
the (now-deleted) account's refresh token lingered in AsyncStorage.
**Fix:** `deleteAccount` now calls `auth.signOut()` after the server delete (best-effort, in
addition to the local wipe). Test added.

---

## GO-LIVE — must be addressed before the relevant flag flips (not fixed in code now)

### G1 — "Remove viewer" is a UI-only affordance · HIGH-when-live · GO-LIVE
`src/store/useStore.ts` `removeViewer`, `Profile.tsx`
`removeViewer` only filters a local array of **role labels** (`supportTeam`); it deletes no
server link row. Today (backend off) that array *is* the visibility model, so the button is
honest. **Once the backend is live, a removed coach/guardian keeps full `can_view` access** —
a privacy-and-safety mismatch (the button promises revocation it doesn't deliver). Not fixed
in code now because an honest revoke needs a server RPC that flips the actual
`team_members`/`practice_clients`/`guardianships`/`org_memberships` row to non-active, and
the local role-label model doesn't carry the link-row identity to target. **Go-live
requirement:** add a `revoke_viewer` RPC (sets the link `status <> 'active'`, which
`can_view` already excludes) and wire `removeViewer` to call it when `isBackendLive`.

### G2 — Guardian `verified` state is never read back · MEDIUM · GO-LIVE
`src/store/useStore.ts`, `queries.ts`, `migration 0008`
The client only ever sets `guardianStatus: 'pending'`; nothing hydrates it to `'verified'`
from the server. This **fails closed** (a minor stays blocked — safe), but means a
legitimately verified guardian can't unblock the minor from the client. Go-live: add a
read-only `fetchGuardianConsent` hydrate (server-set `verified` only; never client-writable).

### G3 — Privacy policy has unfilled blanks vs. reality · MEDIUM · GO-LIVE
`docs/legal/PRIVACY-POLICY.md`
Marked DRAFT (good), but it's the URL the app links to. Retention windows (`[within [N]
days]`), Anthropic's data-retention terms, and the legal-entity/effective-date fields must
be completed (and lawyer-reviewed) before publishing. The §4 "photo sent to Anthropic when
enabled" framing now matches the code after H1.

### G4 — `analyze-meal` Edge Function CORS `*` + no rate limit · INFO · GO-LIVE
`supabase/functions/analyze-meal/index.ts`
Open CORS and no rate limiting on the AI endpoint. Fine for staging; before go-live, restrict
CORS and add per-user rate limiting so the (paid) Anthropic endpoint can't be abused.

---

## LOW / INFO (optional hardening)

- **L1 — Supabase session token in AsyncStorage** (`client.ts`): standard for Expo/Supabase,
  but AsyncStorage is unencrypted. Defense-in-depth: back auth storage with
  `expo-secure-store`. (The only genuinely sensitive local datum.)
- **L2 — Billing portal URL scheme** (`portal.ts`): the URL is a build-time config constant
  (no open-redirect today). Future-proof by asserting an `https://` prefix before
  `Linking.openURL`, in case it's ever sourced from a server field.
- **L3 — Raw RPC error strings** surfaced to the UI (`useStore.ts` `createTeamLive`,
  `pushAthleteGoals`): not stack traces and not sensitive, but a generic fallback reads
  cleaner. The password-reset path already correctly avoids email enumeration.
- **L4 — Committed anon JWT** in `docs/GO-LIVE-NOW.md`: the Supabase **anon** key is public
  by design (RLS-gated). Safe. Noted only so it isn't mistaken for a leak.

---

## CORRECT — verified safe (highlights)

- **No secrets anywhere.** No service-role key, DB password, or Stripe secret in the repo,
  `EXPO_PUBLIC_*` vars, `app.json`, or source. `.gitignore` covers `.env*`; only `.env.example`
  (placeholders) is tracked. The Anthropic key is server-side only (Edge Function); the app
  calls it with the public anon key as bearer. No `console.*` of PII; no analytics/tracking SDKs.
- **Backend-off kill-switch holds.** `isBackendLive` gates every DB write path; with it off the
  app is pure local mock data. The single flag is the documented instant kill-switch.
- **Consent fails closed on every modeled DB path.** `realDataConsent`: backend-off → blocked;
  paused → blocked; no consent → blocked; minor + guardian≠verified → blocked. Unknown age →
  minor; unknown role → coerced to athlete (gated, not waved through). `pushDay` and
  `recordMeal` both honor it.
- **A minor cannot self-verify a guardian.** `guardian_consent_requests` lets the athlete only
  `select`; `verified` is settable only by the service-role endpoint. Server re-validates the
  email.
- **`deleteAccount` truly erases** server + storage folder + cascaded rows, and always completes
  locally (Apple 5.1.1(v)). **`exportMyData`** exports only the signed-in user's own data.
- **RLS spine is sound:** athlete data read = `can_view`, write = `is_self`; SECURITY DEFINER
  helpers/RPCs all pin `search_path = public`; `join_team`/`create_team`/`coach_set_goals`
  validate authorization and don't allow self-escalation. Meal-photos bucket is private, read =
  `can_view`, write = own folder, served via short-lived signed URLs.
- **Client is a mirror, not the boundary.** `membership.ts` `can()/canView()` has no path where a
  non-member resolves true; DB access is fully parameterized (no string interpolation);
  ephemeral secrets/PII (meal photo base64, analysis) are excluded from the `partialize`
  allowlist; no WebView / `dangerouslySetInnerHTML` / untrusted deep-link handling.

---

## Verification

- `npm run verify`: **green** — tsc clean, **1018** tests pass (+6 new regression tests), iOS
  bundle exports.
- `0013_security_hardening.sql`: applied on a throwaway Postgres on top of 0001–0012;
  **18/18** authorization assertions pass (can_view trainer/guardian/coach/stranger; the
  symmetric messaging gate across 6 thread shapes; the grant revokes; the scoped org read).
- **No migration was applied to the live project** (per standing guardrail D1 — the founder
  applies migrations at go-live). `EXPO_PUBLIC_BACKEND_LIVE` remains off in committed config.

**Apply order at go-live now ends with `… → 0011 → 0012 → 0013`.**
