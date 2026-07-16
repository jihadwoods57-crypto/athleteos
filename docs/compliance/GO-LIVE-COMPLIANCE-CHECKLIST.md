# OnStandard — Go-Live Compliance Checklist

**Companion to** `COMPLIANCE-AUDIT-2026-07-15.md`. This turns every "needs a human" item from the audit into a concrete action, with owner and commands. The code side is **done and verified** (branch `compliance-fixes`); everything below is a deploy, a signature, or a decision only you (or counsel) can make.

Legend: **[YOU]** you can do it · **[COUNSEL]** needs a lawyer · **[BOTH]** you prepare, counsel confirms.

---

## 1. Ship the code that's already written  **[YOU]**

All four migrations are **authored only** — never applied to your live DB by the audit (per this repo's "founder applies at go-live" convention). Apply them the same way you apply `0007`/`0048`/`0050`:

- [ ] **Apply migrations `0064`–`0067`** on a throwaway stack first, run the SQL tests, then push:
  ```bash
  # on a disposable/local Supabase project, NOT prod:
  supabase db reset          # applies all migrations fresh
  bash supabase/tests/run.sh # RLS/authz tests must pass
  # then, against the real project:
  supabase db push
  ```
  - `0064_consent_receipt.sql` — `profiles.data_consent_at` (server consent receipt)
  - `0065_export_account_data.sql` — `export_account_data()` RPC (complete data export)
  - `0066_data_retention.sql` — `purge_stale_data()` + retention scheduler
  - `0067_notification_prefs.sql` — `profiles.notifications_opt_out`
- [ ] **After `0066` is applied, arm the retention job once:**
  ```sql
  select schedule_data_retention();   -- nightly purge of analytics_events + food_cache > 180 days
  ```
- [ ] **Deploy the erasure billing-teardown function** (it deletes the caller's own Stripe customer on account deletion — cancels the subscription + removes payment PII):
  ```bash
  supabase functions deploy cancel-subscription   # shares STRIPE_SECRET_KEY + service role
  ```
  ⚠️ This mutates external billing state when a user deletes their account. It's correct erasure behavior, but confirm your Stripe keys are set first. Until deployed, deletion completes locally exactly as before (the client swallows the failed invoke).
- [ ] **Redeploy `weekly-digest` + `send-push`** so the notification opt-out enforcement goes live (safe in any order vs `0067` — the column read is fail-open):
  ```bash
  supabase functions deploy weekly-digest
  supabase functions deploy send-push
  ```

## 2. Finish verifiable parental consent for minors  **[YOU + COUNSEL]**

The guardian-verify flow is built but **inert until an email sender is wired** (`guardian-verify/index.ts:22`, `0008:15`). **Minors' real data must not sync until this works.**

- [ ] Wire an email provider to send the guardian-consent link (this is a **new data processor** — add it to the subprocessor list in `web/landing/privacy.html` §7 and sign its DPA). Resend is already named in the policy but not wired — either wire Resend or update the policy to the provider you choose.
- [ ] Test the full flow on a disposable project: minor signs up → guardian email sent → guardian confirms → `guardian_consent_requests.status = 'verified'` → minor data syncs.
- [ ] **[COUNSEL]** Confirm the token-link verification method is an acceptable "verifiable parental consent" mechanism for your target jurisdictions (COPPA has specific methods; the code comment at `guardian-verify/index.ts:13` notes "counsel blesses this flow" — get that blessing in writing).

## 3. Contracts & data-processing agreements  **[BOTH]**

- [ ] **Sign a DPA with each subprocessor** that receives personal data: **Supabase** (hosting/DB/storage/auth), **Stripe** (payments), **Anthropic** (AI meal/label analysis), **Expo** (push). All four are now disclosed in the served privacy policy (fixed in commit `114d634`).
- [ ] **[COUNSEL]** **Confirm the Anthropic claim** in privacy §4: "not used to train… retained a limited period." This matches Anthropic's standard commercial API terms, but verify against the DPA/terms actually in force before relying on it — meal photos + weight/health history are the most sensitive egress.

## 4. GDPR governance  **[COUNSEL]**

- [ ] **Appoint an EU/UK Article 27 representative** if you have EU/UK users and no EU establishment.
- [ ] **Decide on a DPO (Art. 37).** Large-scale special-category processing of *minors'* data leans toward "appoint one, or document why not."
- [ ] **Finalize the DPIA** — a grounded draft is at `docs/compliance/DPIA-draft.md`. Art. 35 almost certainly applies here (special-category + minors + AI). Have counsel complete and sign it.
- [ ] **Review the operating entity.** Operator is currently "Jihad Woods, doing business as OnStandard" (sole proprietor, `web/landing/terms.html:38`). Given health data + minors, get advice on an entity/liability structure.

## 5. Records & registers  **[BOTH]**

- [ ] **Record of Processing Activities (Art. 30)** — a complete, code-grounded register is at `docs/compliance/RoPA-record-of-processing.md`. Review, keep it updated as processing changes.
- [ ] **Set your retention windows in writing.** The policy says "kept while your account is active" + 30-day deletion; the new job purges telemetry/cache at 180 days. Confirm those numbers are the ones you want and that they're consistent across the policy, the RoPA, and `0066`.

## 6. Accessibility  **[YOU]**

- [ ] **Commission a WCAG 2.1 AA audit** of the app + `web/landing`. ADA (US) applies to commercial services; the EU **EAA** is in force (June 2025) if you have EU users. Not addressed by this audit.

## 7. Housekeeping  **[YOU]**

- [ ] **Delete or keep-but-ignore the stale legal drafts.** `docs/legal/PRIVACY-POLICY.md`, `TERMS-OF-SERVICE.md`, and `docs/legal/public/*.html` are now marked/synced (audit commit), but the authoritative documents are `web/landing/privacy.html` + `terms.html`. Consider deleting the `docs/legal/*.md` drafts to avoid future confusion.
- [ ] **(Low urgency) Rotate the Supabase project keys.** The public **anon** key is hardcoded in static landing/proto HTML — acceptable by design (RLS-gated) but it pins the prod project ref. No secret is exposed; this is hygiene only.

---

## Breach-response quick reference  (GDPR Art. 33/34 + US state laws)

You have **no incident-response process in code today** (only a narrow copilot `activity_log`). Minimum viable plan to have ready *before* an incident:

1. **Detect & contain.** Rotate affected keys (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY` — names only; see `.env.example`). Revoke sessions if auth is implicated.
2. **Assess scope.** Which tables/buckets? Whose data? Was special-category (health) or minors' data involved? (Use the RoPA data map.)
3. **Clock starts at awareness.** GDPR: notify your supervisory authority **within 72 hours** if there's a risk to individuals; notify affected individuals "without undue delay" if high risk. US state laws vary (many require notice "without unreasonable delay"); **minors' data raises the stakes** and often triggers guardian notification (policy §14 already commits to this).
4. **Document everything** — even breaches you decide not to report need a written risk assessment (Art. 33(5) accountability).
5. **Have the contacts ready now:** your supervisory authority, counsel, and each subprocessor's security/incident contact (from their DPAs).

A full runbook is a fast follow — this quick reference plus the RoPA is enough to not be flat-footed on day one.

---

## Status snapshot

| Area | State |
|------|-------|
| Code fixes (9 gaps) | ✅ Done, committed on `compliance-fixes`, `npm run verify` green (typecheck + 1833 tests + xss + bundle) |
| Migrations `0064`–`0067` | ✍️ Authored, **not applied** — §1 |
| `cancel-subscription` fn | ✍️ Authored, **not deployed** — §1 |
| Served policy + terms | ✅ Finalized + accurate (Stripe/Expo disclosed) |
| Guardian-consent email | ⛔ Not wired — §2 (blocks minors on connected backend) |
| DPAs / EU rep / DPIA / entity | ⛔ Counsel — §3–5 |
| Accessibility | ⛔ Audit needed — §6 |
