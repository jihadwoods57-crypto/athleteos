# OnStandard Design Constitution

The reference for the crew's **Design & UX** role. Design *taste* has no machine oracle — the founder
is the gate. This file is what design findings are scored against.

## Reference truth
- The **:8124 master proto** is the canonical look (Bo's master version). The app was rebuilt to it
  end-to-end: green-forward, Welcome screen, all tabs + breakdown / weight / recovery / history /
  streak / trust, proto onboarding, and coach / trainer / parent surfaces. A screen that drifts from
  the proto is a finding.

## Brand
- **Green-forward.** Not the aborted gold / Performance-Dial direction (that was tried and reverted —
  do **not** re-propose gold).
- No generic AI-slop aesthetics: no default Inter/Roboto/system-font blandness, no purple-gradient-on-
  white cliché, no cookie-cutter layouts. Cohesive, context-specific character.

## Honest surface (mirrors the main constitution)
- Screens tell the truth. No feel-good mush that hides a real state; error and empty states are honest.
- The score surface is honest (N50/R25/C15/K10; weight shown but not scored). Never dress up a failing
  state as success.

## Accessibility — the provable slice
- Text contrast meets WCAG AA (4.5:1 body, 3:1 large text).
- Touch targets ≥ 44×44.
- Every interactive element is reachable and labeled.
- These are what `npm run test:design` (a11y + contrast, built by the crew as its first design act)
  enforces automatically.

## What ships vs. what proposes
- **Objective** (a11y / contrast / genuinely broken layout) → auto-ships through `test:design` + the
  code oracle.
- **Taste** (hierarchy, spacing, rhythm, "feels off") → before/after screenshot proposal in the
  morning report; the founder decides. The crew never auto-ships a taste change.

---
Source of truth: `docs/superpowers/specs/2026-07-09-onstandard-autonomous-crew-design.md` §6.1.
