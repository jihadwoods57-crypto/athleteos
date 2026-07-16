# OnStandard — Data Protection Impact Assessment (DRAFT)

> **DRAFT for legal review — not a completed DPIA and not legal advice.** Engineering-authored from the codebase to give counsel a grounded starting point. Data map lives in `RoPA-record-of-processing.md`; do not duplicate — reference it.

## Why a DPIA is required (GDPR Art. 35)
This processing hits **multiple Art. 35(3) / EDPB triggers**, so a DPIA is almost certainly mandatory:
- **Special-category data** (health/fitness: weight, sleep, HRV, nutrition, meal photos) — RoPA §2.
- **Vulnerable data subjects — minors** (core audience is ages ~13–22; some under 18) — `PRODUCT.md:13`.
- **Innovative technology / AI** — meal photos + health history sent to a third-party LLM (Anthropic) — `analyze-meal/index.ts:471`.
- **Data matching / profiling-adjacent** — accountability scoring + coach visibility across a roster.

## 1. Description of processing
See RoPA §2–§6 for categories, purposes, recipients, retention, transfers. In brief: athletes log nutrition/health data on-device; when the backend + consent gate are on, it syncs to Supabase and (per consent) is visible to linked coaches/guardians; meal photos are analyzed by Anthropic; coaches on paid plans are billed via Stripe.

## 2. Necessity & proportionality
- **Data minimization:** age is collected as an integer/DOB only (no broader identity docs); no precise geolocation; no advertising IDs or third-party trackers (`privacy.html:73`). Photo hash is file-dedup, not biometric. **Assessment: proportionate**, with one open question for counsel — whether meal *photos* (vs. user-entered macros) are necessary for all users or should be more granularly optional.
- **Purpose limitation:** data used to provide the service + consented sharing; **not sold, not used for cross-context advertising** (`privacy.html:104`). AI provider contractually barred from training on the data (**to be confirmed — checklist §3**).
- **Lawful basis:** consent for special-category + AI; contract for the core service; verified guardian consent for minors (RoPA §3).

## 3. Risks to data subjects & mitigations

| Risk | Likelihood/Impact | Mitigation in place | Residual / action |
|------|-------------------|---------------------|-------------------|
| Minor's health data collected/shared without valid consent | High impact | Fail-closed client gate treats unknown age as minor (`consent.ts:36`); server triggers block a provable minor's writes until verified guardian consent (`0050:59`); minor messaging restricted (`0006`) | **Guardian-verify email not yet wired** (checklist §2) — until then minors are local-only. **Server gate treats *unknown* age as adult** (`0050:19`, documented tradeoff) — residual risk on null-DOB rows; revisit with an age-verification vendor. |
| Special-category health data exposed to a third party (Anthropic) | High impact | Consent gate fails closed before any photo egress; key server-side only; provider bound by commercial terms (no training, limited retention) | **Confirm the Anthropic DPA** (checklist §3). |
| Sensitive data readable by the wrong coach/parent | Medium | Row-Level Security + `can_view`; minors read-blocked from third parties without consent (`0050:108`); "pause all sharing" (`consent.ts:56`) | Ongoing RLS test coverage (`supabase/tests`). |
| Continued billing / payment-PII retention after erasure | Medium | `cancel-subscription` deletes the Stripe customer on account deletion (audit fix `b09fabe`) | Deploy the function (checklist §1). |
| Incomplete erasure / access response | Medium | Cascade delete (`0007`); complete server export (`0065`) | Apply migrations (checklist §1). |
| Unbounded retention of telemetry | Low | 180-day purge (`0066`) | Arm the scheduler (checklist §1). |
| Disordered-eating harm (a nutrition app for youth) | High impact, low likelihood | "Not medical advice" + eating-disorder helplines in policy §5; AI system prompt bars extreme/restrictive advice (`analyze-meal` SYSTEM) | Keep the safety framing under review; consider clinical input. |
| Data breach | Medium/High | TLS, RLS, keychain tokens, secrets server-side, no committed secrets | **No breach-response process yet** — checklist "Breach-response quick reference". |
| PII leakage via logs | Low | Error-only logging; analytics PII-filtered server-side (`analytics-ingest:39`) | Confirmed clean in audit. |

## 4. Consultation
- **[COUNSEL]** required to finalize legal bases, confirm the guardian-consent method meets COPPA/GDPR-K, and sign off.
- Consider consulting the supervisory authority if high residual risk cannot be reduced (Art. 36).

## 5. Sign-off (to complete)
| Role | Name | Date | Decision |
|------|------|------|----------|
| Controller | | | |
| DPO / counsel | | | |

**Outcome (to complete):** proceed / proceed-with-conditions / do-not-proceed. Current engineering view: the highest residual risks are all **action items already itemized in the go-live checklist** (wire guardian email; deploy migrations/function; confirm Anthropic DPA; decide on the unknown-age server default).
