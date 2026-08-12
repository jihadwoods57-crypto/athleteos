# Verified Profile — Design Brief (confirmed 2026-08-11)

The founder-approved design for the recruiter-facing public profile. Decisions here were made
in brainstorm and confirmed explicitly; do not relitigate them in implementation.

## What it is

A public page at `onstandard.app/a/<handle>` that shows a college recruiter an athlete's
verified accountability record: how long they've been on record, how consistently they hold
the standard, and what parts of that are machine- or coach-verified. Paired with an in-app
publish/share flow and a weekly share graphic.

Product name: **Verified Profile**. Recruiting is the use, not the label.

## Founder rulings (locked)

1. **All-or-nothing record.** The page shows the full record from the day the athlete enables
   it. No hiding bad weeks inside that window. Unpublish removes the whole page, anytime.
   Never selective curation: cherry-picked data is worthless to a recruiter and kills the metric.
2. **V1 scope: page + share flow.** Public page with per-athlete Twitter unfurl image, in-app
   enable/preview/publish/share/unpublish, weekly payload for the existing share-card renderer.
   No recruiter-side capture in v1.
3. **Free card, paid page.** Share graphics stay free for every athlete (the viral billboard).
   The living public profile link is premium. Lapse: 7-day grace, then auto-unpublish. Never a
   degraded or ad-covered page; a dead link is better than a cheapened document.
4. **Dark brand.** The page is the same visual object as the share card and the app: dark
   canvas, the ring, Archivo on the score, tokens.css values.

## The audience contract

The page's real user is a ~45-year-old assistant coach clicking from Twitter at his desk,
skeptical, giving it fifteen seconds. So:

- It reads as a **served document, not an app**: no tab bar, no signup wall (ever), dense and
  scannable like a transcript.
- **Longevity is the headline**, not this week's score: days on record, roll-call rate, days on
  standard (>=80). One good week means nothing to a recruiter.
- **Verified beats pretty.** Every data source is labeled: geofence-verified roll call,
  photo-logged meals, coach-confirmed commitments, self-reported check-ins. Honesty about the
  last one is what sells the first three.
- **The coach is the credibility bridge**: "Roster-verified by Coach X, School" when the
  relationship exists; the row is absent, never faked.
- A collapsed "How this score works" methodology disclosure in plain coach English.
- Footer: served-from-onstandard.app authenticity line + a quiet "What is OnStandard?" link.

## Page layout (top to bottom)

Identity band (name, sport + position, school, class year, dial mark) -> the record (score
ring with 30-day average + the three longevity numbers) -> month-by-month consistency
timeline for the full window (bad months show; that is the product) -> verification ledger ->
coach attestation -> methodology disclosure -> footer.

## States

- Live (default).
- Unpublished/unknown handle: clean "This profile isn't available." No data leak, no hint
  whether the handle exists.
- Sparse record: publishing requires **30 days on record**. Below that the in-app flow shows
  progress toward eligibility, not a publish button.
- Premium lapse: 7-day grace (page live + warning notification), then auto-unpublish.
- Loading: skeleton shaped like the document.
- Minor without guardian consent: publish blocked at the consent gate. **This feature does not
  ship until the guardian consent email actually sends** (pre-existing open debt).

## Interaction

Athlete: Profile -> Verified Profile -> enable (consent + one plain-language all-or-nothing
contract screen) -> preview the exact public page -> publish -> share sheet posts card image +
link. Unpublish is one tap, immediate, whole-page.

Recruiter: reads, expands methodology, maybe clicks the footer. No account required for
anything on the page.

The Twitter unfurl image is rendered by the existing canvas share-card renderer at
publish/refresh time and uploaded to storage, so the tweet preview is pixel-identical to the
brand card.

## Architecture

- `public-profile` edge function: service-role behind deny-all RLS (the beta.html precedent),
  serves profile JSON and the HTML with per-athlete `og:` tags. All numbers computed
  server-side from the same `days` rows the app reads; the page invents nothing; missing
  values render as an em dash glyph in data (copy itself carries no em dashes).
- New table `verified_profiles` (handle, published, enabled_at, consent fields), with the
  0103-style grant discipline (new tables need explicit grants).
- Static assets live with the landing site.
- share-card.js gains a `week` payload. ONE renderer; no second drawing function.

## Non-goals

- No invented athletic stats (40 time, bench, etc.). The page claims only what we verified.
- No weekly AI narrative. AI stays monthly (already capped). Weekly is the card with a week's
  numbers.
- No recruiter accounts, capture forms, or outreach in v1.
