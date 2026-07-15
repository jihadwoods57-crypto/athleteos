-- OnStandard — server-side data-processing consent receipt (GDPR Art. 7(1) accountability).
--
-- THE GAP (compliance audit 2026-07-15): the athlete's own Terms/Privacy acceptance and
-- data-processing consent were recorded ONLY in client-local storage (Zustand
-- termsAcceptedAt / realDataConsent). There was no server-side, versioned record, so the
-- operator could not DEMONSTRATE that a given user consented, to which policy version, and
-- when — which Art. 7(1) requires. Guardian consent was already server-side (0008); this
-- closes the same gap for the athlete's own consent.
--
-- 0048 already added profiles.tos_accepted_at + tos_version + committed_at (the client now
-- writes them — see useStore acceptTerms). This migration adds the one remaining column: the
-- moment the athlete affirmatively granted DATA-SHARING / processing consent (distinct from
-- merely accepting the Terms). Additive + inert; the client writes it best-effort in a
-- separate call, so it is safe on either side of the apply. profiles_self_write (0002)
-- already authorizes the owner to update their own profiles row, so no policy change here.
--
-- GUARDRAIL: authored only — NOT applied to live by the audit. Founder applies at go-live
-- (like 0004+): supabase db reset on a throwaway stack, run supabase/tests, then db push.

alter table profiles add column if not exists data_consent_at timestamptz;

comment on column profiles.data_consent_at is
  'When the athlete affirmatively granted data-sharing / processing consent in-app '
  '(GDPR Art. 7 demonstrable consent). Distinct from tos_accepted_at (accepting the Terms). '
  'Written best-effort by the client at recordConsent; null when never granted / local-only.';
