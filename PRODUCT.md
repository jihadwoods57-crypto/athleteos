# OnStandard — Product Context

register: product

## Product purpose
A mobile-first **athlete accountability platform**. Athletes log meals (AI analysis) and
complete a nightly recovery check-in, and earn a daily **Athlete Score**; coaches,
parents, and trainers get real-time visibility. The product answers one question:
**"Is this athlete actually doing what they're supposed to be doing?"** Design SERVES that
truth — the score is honest, never inflated, and every surface makes accountability legible.

## Users
- **Primary: serious high-school & college athletes** (13–22). On their phone, daily, often
  tired, post-practice, low patience. They want a fast, motivating, *honest* read on whether
  they're on track — and they know the people who matter (coach, parent) can see it.
- **Secondary: coaches, parents, trainers** — oversight roles. Quick scans for "who needs
  attention," roster standings, weekly trends. Glanceable, trustworthy, no fluff.

## Tone & voice
Confident, direct, coach-room real. Like a respected strength coach: motivating but never
coddling, precise with numbers, allergic to hype. Numbers are heavy and exact. Copy is
short and earns its place. Never cutesy, never corporate-SaaS, never fake-hype.

## Anti-references (do NOT look like these)
- Generic SaaS dashboards / the big-number "hero metric" template with a gradient accent.
- Consumer fitness-app clichés: neon-on-black, aggressive gamification, confetti, badges-for-everything.
- Gradient text, glassmorphism-by-default, identical icon+heading+text card grids, side-stripe accents.
- Anything that reads "an AI generated this." If the domain (fitness) makes the palette/theme
  obvious (neon, energetic orange, "beast mode"), that's the reflex to avoid.

## Strategic principles
- **Calorie math is never the athlete's homework** (design red line, 2026-09-05). The habit
  is a photo: the AI reads the plate and labels every estimate as an estimate; typing exists
  only as a fallback (a transcribed label, a food searched), never as a daily ledger. Never
  build a surface that asks a teen athlete to count, tally, or budget calories; never
  moralize food; and Intuitive (calorie/macro readouts stripped from the meal read, scored on
  fueling enough, never restriction) must always exist. Known gaps — shrink, never grow (every
  number is still computed and stored, hiding is presentation only; the pre-log analysis macro
  row and the food-search/barcode number rows were closed 2026-09-05, and the last stored-number
  READBACKS — the Food Memory edit sheet's pre-filled numbers, the "save this as a usual?"
  suggestion line, the goal panel's derived-targets row, and the past-meal history view's macro
  row — were closed 2026-09-06, per-figure where a surface quotes both numbers, pinned by
  intuitive-surface.test.mjs; the same day's audit made per-figure hold on EVERY meal-family
  surface — the live meal read, thread strip and day bars, the past-meal view, the edit
  sheet's fields, and food-search/barcode cells — so a professional hiding calories alone
  hides exactly calories, everywhere): what remains, deliberately, is TYPING where the athlete is
  transcribing a source they hold (the label-entry screen and a new manual Food Memory item —
  the one fallback this red line allows), and Guided's meal-screen calorie tile plus
  calories-vs-target day bar by that style's own design. This is also the market position — see
  `docs/marketing/aso-listing.md` ("accountability without calorie counting").
- **Honest accountability over vanity.** The score reflects work actually done; incomplete
  days read as incomplete. Never decorate a bad week into looking good.
- **Glanceable truth.** A coach or athlete should read their state in under 3 seconds.
- **Calm, premium, trustworthy.** This is a serious tool people are judged by — it should
  feel considered and clean, not loud. Athlete Blue is the spine; color is earned, not sprayed.
- **The established design system is law.** OnStandard already has a committed visual language
  (see DESIGN.md): Plus Jakarta Sans, Athlete Blue `#2563EB`, soft slate neutrals, layered
  soft shadows, generous radii. **Refine WITHIN it.** Do not migrate color spaces, restyle
  wholesale, or invent a new language — sharpen fidelity, rhythm, motion, and polish.
