# OnStandard Design Constitution

Design is a **first-class pillar**, co-equal with engineering in the backlog. For an app athletes
subconsciously compare to Instagram, Oura, Whoop, and Apple Health, "does it feel premium" is **product
quality, not decoration.** This file is the reference the Design pillar scores against.

## Who holds the veto
- **Within-domain veto is the crew's, and automatic:** the Design Critic can kill a *design* change it judges
  cheap; the test oracle kills an *engineering* change that breaks.
- **Cross-domain veto is the FOUNDER's:** an AI never blocks a working, tested feature on taste, and never
  auto-ships a taste change. Design proposes the direction → **you approve** → the crew implements your approved
  direction, gated by the oracle. Taste is your call; safe execution is the crew's.

## Reference truth
- The **:8124 master proto** is the canonical look (Bo's master version): green-forward, Welcome, all tabs +
  breakdown / weight / recovery / history / streak / trust, proto onboarding, coach/trainer/parent. Drift is a finding.

## The lean design studio (v1)
- **Design Critic** — would Apple / Oura / Linear / Whoop ship this? cluttered, cheap, dated, visual noise, can anything disappear?
- **Design Systems** — components (buttons, cards, headers, inputs, modals, badges, charts). Fix a component → every screen improves. Behavior-preserving component refactors are **provable**; restyles are taste.
- **Navigation** — can two screens merge? can a flow lose a step? bottom nav, gestures vs buttons, modal vs full-screen.
- **Motion & interaction states** — purposeful motion (score fill, card glide) + pressed/loading/empty/skeleton/success/error states + haptics. Missing structural states are **provable**; motion polish is taste.
- **Visual & delight** — color/shadow/radius/spacing rhythm, icon + type consistency, "would someone screenshot this," and *earned* delight (subtle celebration on real achievement — never fake confetti; see the constitution's honesty leash).
- **Accessibility** (**provable**) — contrast (WCAG AA), screen-reader labels, dynamic type, touch targets ≥44 — enforced by the crew-built `test:design`.

## Brand & honesty
- **Green-forward.** The gold / Performance-Dial direction was tried and reverted — do not re-propose it.
- No generic AI-slop aesthetics (default fonts, purple-gradient clichés, cookie-cutter layouts).
- Delight is earned, never manufactured (mirrors the constitution's engagement rule).

## Ships vs. proposes
- **Provable** (a11y, missing structural states, behavior-preserving component refactors) → auto-ships via `test:design` + the code oracle.
- **Taste** (premium feel, motion, visual polish, delight) → before/after proposal in the report → **you approve** → crew builds it.

## Deferred — revisit after the first run (written down, not dropped)
- The full 11-role AI Design Studio (separate Principal Designer, UX Researcher, Motion, Interaction, Visual, Systems, Delight designers).
- **Design Inspiration** — weekly study of Apple / Oura / Linear / Whoop / Nike / Duolingo to extract (not copy) patterns (needs web browsing).
- **Innovation Lab** — bold new-feature exploration (proposal-only; never builds).

---
Source of truth: `docs/superpowers/specs/2026-07-09-onstandard-autonomous-crew-design.md` §6.1.
