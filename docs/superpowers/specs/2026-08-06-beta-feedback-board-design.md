# Beta Feedback Board — design

**Date:** 2026-08-06
**Status:** approved by founder, built and shipped same day
**Context:** OnStandard is going out to external TestFlight testers. Those testers need somewhere to
report what they hit, and the founder needs that to arrive already sorted rather than as a pile.

## Problem

The app already has a feedback screen writing into `support_tickets`, and a founder queue in the
Command Center. That pipeline is one-way and one-at-a-time: six people report the same slow photo
upload and it reads as six unrelated tickets. For a beta group specifically, the useful shape is the
opposite — collapse duplicates into themes, rank the themes, and let testers see that their report
landed and that other people hit it too.

A public idea board was deliberately **not** built for the main app (2026-07-29): a visible feed of
other users' submissions collides with the "no team feed, no leaderboard" promise made in Settings,
and votes are meaningless at Founding-50 volume.

**This is scoped differently and that is what makes it acceptable.** The board is a side surface for
a hand-picked beta group, reached by a secret link, living entirely outside the product. No real
user encounters it, so the Settings promise is untouched. It ships with the beta and can be retired
with it.

## What gets built

One page: `onstandard.app/beta.html?k=<token>`, handed out alongside the TestFlight invite.

A tester types a display name and what happened. One AI call folds the post into the existing
themes — either **joining** one or **starting** a new one with a title, a one-line summary, a kind,
and a severity. The board re-renders immediately. Testers can upvote a theme and see a status the
founder sets: Open / Fixing / Shipped / Won't do.

### Explicitly not built

- Comment threads. Moderating a forum for a dozen testers is not worth the code.
- Accounts or a login wall in front of leaving feedback.
- Nightly re-clustering. Incremental only; merge by hand at this volume.
- Any change to the app itself. Zero OTA, zero proto edits.

## Architecture

Follows the `t.html` precedent exactly — one hand-written, self-contained page, no build step,
shipped by the existing Cloudflare Worker deploy.

| Piece | Path | Role |
|---|---|---|
| Board page | `web/landing/beta.html` | Entire UI: intake form, ranked themes, voting, admin controls |
| Edge function | `supabase/functions/beta-board/index.ts` | All reads/writes + the AI triage call |
| Schema | `supabase/migrations/0191_beta_board.sql` | `beta_themes`, `beta_posts`, `beta_votes` |
| CSP | `web/landing/_headers` | `/beta*` block, matching `/t*` |
| Auth pin | `supabase/config.toml` | `[functions.beta-board] verify_jwt = false` |

### Data model

- **`beta_themes`** — `id`, `title`, `summary`, `kind` (`bug`/`confusing`/`idea`/`praise`),
  `severity` 1–5, `status` (`open`/`fixing`/`shipped`/`wontdo`), `post_count`, `vote_count`,
  `created_at`, `updated_at`.
- **`beta_posts`** — `id`, `theme_id`, `author_name`, `body`, `app_version`, `created_at`. The raw
  words, kept verbatim — the theme summary is a convenience, never a replacement for what was said.
- **`beta_votes`** — `theme_id`, `voter_id`, unique together.

RLS is enabled on all three with **no policies at all**. Nothing reaches these tables except the
edge function's service-role client, which bypasses RLS. That is deliberate: the page has no
Supabase session, so a policy keyed on `auth.uid()` would be meaningless, and shipping
`grant ... to anon` would be a genuine hole. Deny-everything plus one server door is the honest
version.

### Access control

The `?k=` token is verified **server-side** in the function against the `BETA_BOARD_KEY` secret,
with a constant-time compare — not merely an obscure filename. A missing or wrong key returns 403
and no data. Rotating access is a one-secret change.

Founder controls ride the same page under `&admin=<BETA_ADMIN_KEY>`, mirroring the existing
`/api/leads` `x-admin-key` precedent in `web/landing-src/deploy/worker.js`.

### Abuse and cost control

Layered, because submission costs real money:

1. Per-IP in-memory sliding window via `clientIpFrom` (rightmost XFF — leftmost is
   attacker-controlled and silently disables the cap).
2. Durable daily per-IP cap through `claim_ai_usage_key`, which returns a boolean and lets the
   caller decide — a SQL rate limit that `RAISE`s rolls back the very increment it just made.
3. `checkSpend(EST_USD.text)` before the Anthropic call, `recordAiCall` awaited on **both** the
   success and failure paths.

Input is bounded on the way in: name 40 chars, body 2000, version 40.

### AI triage

One forced-tool call per submission. The model receives the new post plus the id/title/summary of
every open theme and returns exactly one of:

- `{ match_theme_id }` — this is the same issue as an existing theme, or
- `{ new_theme: { title, summary, kind, severity } }` — nothing fits.

If the AI is unavailable, spend-gated, or returns a theme id that does not exist, the post is
**still saved** into an `Unsorted` theme. Feedback is never lost to an AI failure — the tester's
words matter more than the clustering.

### Ranking

Severity descending, then heat (`2 × votes + posts`) descending. Crashes float above annoyances, and
within a severity band the thing more people hit wins. `shipped` and `wontdo` sink below everything
open. Votes are what move ranking over time; the AI sets severity once at theme creation and the
founder can override it.

## Trade-offs accepted

- **Anyone the link is forwarded to can post.** Fine for a trusted group; the fix is rotating `k`.
- **Votes dedupe on a localStorage id**, so they are trivially bypassable. These are people who were
  handed an invite; ballot-stuffing a beta board has no prize.
- **Incremental clustering drifts.** Two themes that should be one will happen. Merge by hand; a
  nightly re-cluster is the upgrade path if it becomes annoying.
- **Severity is assigned once**, from a single report, before anyone else has weighed in.

## Verification

- Migration validated against local Postgres before it touches prod.
- `deno check` on the function.
- Live browser QC of the real deployed URL: submit → cluster → duplicate joins the same theme →
  vote → admin status change → wrong key is refused.
