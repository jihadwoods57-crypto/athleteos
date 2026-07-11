# Design — Practice HQ (Trainer profile: real identity + invite loop) + cross-role back-nav fix

Prototype: https://claude.ai/code/artifact/05c6b786-a7fe-4b64-bd40-2b1612ff085e
File: .fable5/proto/practice-hq.html (self-contained; dark tokens from proto/redesign-2026-07/css/tokens.css)

## Register / system
Product register. Refine WITHIN the existing dark redesign system (proto/redesign-2026-07).
Trainer purple (#A855F7 / bright #C084FC) is the trainer LANE accent; Athlete Blue stays the
athlete spine. Restrained color strategy: tinted-slate surfaces + one lane accent. No new language.

## Screens designed
1. Practice HQ (redesigned Trainer Profile) — the primary screen. Sub-screen of the trainer
   dashboard, so its back chevron correctly returns to `trainer`.
   Sections: business identity header, Invite-a-client (signature), Practice settings, Coming-to-HQ roadmap.
2. Trainer dashboard header (documented, not re-mocked): tab root — NO back chevron.

## States (all built + clickable in the prototype)
- live     — real identity + minted code + QR + Copy/Share.
- loading  — skeleton shimmer on header + invite + list while RT hydrates from server.
- minting  — honest "Your client code is being created" with spinner. Replaces the old broken
             "No code yet" copy. Never shows a dead code to a client.
- offline  — shows LAST-KNOWN cached identity (real business, never another persona) with a quiet
             amber "Reconnecting" chip; Share disabled with "reconnect to share"; code still visible.

## The three build fixes, grounded
1. Back-nav (coach.js 56/528/652 pass 'profile' to backHead): tab roots (coach/trainer/parent)
   should carry NO back chevron; sub-screens point back to their own role home. Prototype shows the
   before/after in the annotation column.
2. Real identity: hydrate full_name (profiles) + practice id/name/client-code into RT on trainer
   sign-in — mirror of state.js _loadProfileIntoRt for athletes; fetchMyPractices must also SELECT
   the join code. Removes the "Tracy Boone"/"No code yet" fallbacks (roles.js 811-812, state.js 625).
3. Invite loop: real code boxes (purple), scannable QR of the join link, Copy (clipboard), Share
   (SHARE bridge, src/proto/bridge.ts). Primary action = Share invite. Production inlines a
   dependency-free QR generator; the prototype renders the exact layout via a seeded QR-anatomy
   matrix (correct finders/timing/alignment/quiet-zone) so the founder approves layout, not a
   possibly-buggy from-scratch encoder.

## Anti-slop / honesty checks
- No hero-metric template, no gradient text, no glass-by-default, no side-stripe accents.
- Roadmap sections rendered as honest LOCKED rows (business/client health, AI assistant, analytics,
  branding, integrations) — never faked as working. Matches OnStandard's honest-pending ethos.
- Default client standard: dead "Set" pill replaced with a real summary line + Manage affordance
  (routes to the standard editor, roadmapped as the next slice).

## Founder-gated proposals (NOT actions)
- Server hydration path + any migration to expose practice join code on trainer sign-in: authored
  in build/plan, migrations never applied live.
- Remaining Practice HQ sections (business health, client health, AI assistant, analytics,
  default-standard editor, branding, integrations, business tools) ship one gated slice at a time.

## Accessibility / craft
Touch targets >=44px, visible focus rings, prefers-reduced-motion honored, QR carries an aria-label,
tabular code boxes, contrast on dark surfaces meets AA for text.
