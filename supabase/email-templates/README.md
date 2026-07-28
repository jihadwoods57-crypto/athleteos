# Supabase Auth email templates — source of truth

These 13 files are the **actual content** live on the `ftwrvylzoyznhbzhgism` project's Supabase Auth
mailer config (`mailer_templates_<type>_content`), applied 2026-07-22 to replace Supabase's bare default
templates. They cover every email GoTrue can send for this project:

**Active today**: `confirmation`, `recovery`, `email_change` (real app flows) plus, as of 2026-07-22,
6 of the 7 notification types are now **enabled** per founder request ("turn on the ones you recommend"):
`password_changed_notification`, `email_changed_notification`, `mfa_factor_enrolled_notification`,
`mfa_factor_unenrolled_notification`, `identity_linked_notification`, `identity_unlinked_notification`.
Rationale: password/email-changed are standard security hygiene; MFA enroll/unenroll ties directly to the
Command Center hardening work; identity linked/unlinked matters because Apple Sign-In is live on prod.
**`phone_changed_notification` deliberately left OFF** — phone-based auth/MFA is disabled everywhere in
this project's config, so it would never fire; enabling it would just be inert. `invite` and `magic_link`
have no app-code trigger (staff invites use a custom join-code system; no magic-link flow exists) but got
the same content upgrade for completeness/future-proofing.

## Brand

Uses the **real, founder-ratified** brand — `docs/brand/LOGO.md`, `src/brand/Logo.tsx`, `src/ui/tokens.ts` —
not a guess. Primary accent is **"Athlete Blue" `#2563EB`** (tokens.ts `accent`); the top accent bar and
mark use the ratified signature sweep `#34D399 -> #22D3EE -> #3B82F6` (green->teal->blue, LOGO.md); the
wordmark is "On" in ink `#0F172A` + "Standard" in the blue accent, exactly as LOGO.md specifies. Warning
badges stay amber (a real semantic, matching tokens.ts `warning`) — that was never in question.

An earlier version of this file used **green** as the primary color, reasoning from a single
success-checkmark icon on `docs/legal/public/reset.html` (a password-reset-success page) into "green is
the brand." That was wrong — green there is the same semantic-success-only color the app uses everywhere
(tokens.ts `success`), never the brand identity. Founder caught this ("why is it green? should it be the
colors of the app?") and it was corrected same-day. Deliberately different from the **admin** Command
Center's dark blue-teal theme (`supabase/functions/admin-alert/logic.mjs`) — same blue family, different
audience (real end users here, the founder there).

## Regenerating

Source is `scripts/gen-auth-email-templates.mjs` (Node, no deps). Edit the template definitions there,
then:

```sh
node scripts/gen-auth-email-templates.mjs   # writes these .html files
```

**Everything here must stay pure ASCII** — no em-dashes, curly quotes, or other non-ASCII punctuation.
PowerShell's `ConvertTo-Json` (used for the Management API PATCH below) has historically mangled non-ASCII
in some environments; plain ASCII sidesteps the risk entirely. The generator script enforces this by
convention — verify with:

```sh
node -e "for (const f of require('fs').readdirSync('supabase/email-templates')) { if(!f.endsWith('.html')) continue; const s=require('fs').readFileSync('supabase/email-templates/'+f,'utf8'); for (const c of s) if (c.codePointAt(0)>127) console.log(f, c); }"
```

## Applying to prod

Never `supabase config push` (see the warning in `supabase/config.toml`). Apply via a Management API PATCH
(same pattern as everywhere else in this session) — each field is `mailer_templates_<type>_content`. When
scripting this in PowerShell, **force a plain string** with `[string](Get-Content -Raw -Path ...)` —
`Get-Content` alone returns a PSObject-wrapped string that `ConvertTo-Json` serializes incorrectly (as
`{"value": "..."}` instead of a plain JSON string), which the Management API rejects with "Expected
string, received object".

`{{ .ConfirmationURL }}` / `{{ .Token }}` / etc. are Go template placeholders GoTrue fills in server-side —
never touch or escape them in the generator.

## Enabling the dormant notification emails

Content is live; the 7 notification types are still switched off (`mailer_notifications_*_enabled=false`
in the project's auth config). To turn one on, PATCH e.g. `{"mailer_notifications_password_changed_enabled": true}`.
This is a **behavior change for every user**, not a content change — get founder sign-off first.
