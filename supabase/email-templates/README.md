# Supabase Auth email templates — source of truth

These 13 files are the **actual content** live on the `ftwrvylzoyznhbzhgism` project's Supabase Auth
mailer config (`mailer_templates_<type>_content`), applied 2026-07-22 to replace Supabase's bare default
templates. They cover every email GoTrue can send for this project:

**Active today** (users hit these paths now): `confirmation`, `recovery`, `email_change`. Kept ready but
currently dormant (either unused by the app's own flows, or the notification is switched off):
`invite`, `magic_link`, `reauthentication` (no app flow triggers these); `password_changed_notification`,
`email_changed_notification`, `phone_changed_notification`, `mfa_factor_enrolled_notification`,
`mfa_factor_unenrolled_notification`, `identity_linked_notification`, `identity_unlinked_notification`
(exist but `mailer_notifications_*_enabled=false` — a founder decision, since enabling them changes
notification volume for the whole user base, not just content).

Brand: the real consumer identity (green checkmark mark + "OnStandard" wordmark, cream/white light theme)
established in `docs/legal/public/reset.html` — deliberately different from the **admin** Command Center's
dark blue-teal theme (`supabase/functions/admin-alert/logic.mjs`), since these go to real end users, not
the founder.

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
