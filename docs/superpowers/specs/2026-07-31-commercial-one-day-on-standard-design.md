# "One Day on Standard" — OnStandard master commercial

**Date:** 2026-07-31 · **Status:** approved (founder granted full creative control, no review gates)

## Deliverables

1. **Master**: 16:9, 1920×1080, ~75s, kinetic text + music, no VO. Center-safe framing so a 9:16 crop never loses a face or a phone.
2. **30s pre-roll cut** (16:9): cold open → meal snap → number → end card.
3. **15s vertical cut** (9:16, 1080×1920): meal snap → end card.
4. All under `web/landing/assets/video/` naming `commercial-master.mp4`, `commercial-30.mp4`, `commercial-15-vertical.mp4` (final placement = founder's call later; produce files first).

## Concept

A single day, 5:02am → 9:58pm, told across four lives (athlete, coach, parent — trainer implied) that share one number. Ensemble threaded by the day-arc and the score. Clock stamps do the narrative work.

## Shot list (100 BPM edit grid, 0.6s/beat)

| # | Time | Content | Source | Kinetic text |
|---|------|---------|--------|--------------|
| 0 | 0:00–0:06 | Black → clock type "5:02 AM" → dark bedroom, phone glow, athlete's eyes open | Kling S1 | "Nobody sees this part." |
| 1 | 0:06–0:16 | Lock-screen roll-call notification → thumb taps "I'm Up" → confirmed | HTML lock-screen composite + real roll-call ack UI | "Proof, not promises." |
| 2 | 0:16–0:30 | "7:41 AM" → hands raise phone over breakfast plate → camera → analyzing → macros resolve → score ticks up | Kling S2 + real proto UI capture | "Point. Shoot. Know." → "Every plate becomes a number." |
| 3 | 0:30–0:46 | "12:15 PM" → parent at desk gets ping / coach on field gets same ping → real thread: AI note, coach reply, parent reply | Kling S3 + S4 + real thread UI | "One meal. Everyone in the loop." |
| 4 | 0:46–0:62 | "9:58 PM" → athlete at night, calm → score ring animates to 87 | Kling S5 + real score UI | "The number doesn't lie." → "That's the point." |
| 5 | 0:62–0:75 | End card: OnStandard lockup, blue→teal | Remotion | "One day at a time. On standard." → onstandard.app |

## Human shots (gpt-image-2 → Kling v2.5-turbo, 5s each)

- **S1** dark bedroom 5am, phone glow on face, athlete waking — moody, single light source
- **S2** over-shoulder/POV hands raising phone above a breakfast plate, morning window light
- **S3** parent at office desk, phone lights up, warm glance
- **S4** coach on practice field, whistle, checks phone, small nod
- **S5** athlete at night, low light, quiet satisfaction looking at glowing phone

Style: cinematic, warm-dark, no logos/jerseys/text in frame (Kling mangles text), warm closed-mouth expressions (v1 hero lesson: avoid "sighing/annoyed"), ≤4% push-in motion briefs, subjects diverse across shots. Center-safe: subject + phone inside middle 56% of width.

## UI capture (Playwright, free, real proto)

- Serve `proto/redesign-2026-07`; seed via **live module mutation** (localStorage seed is broken by boot session-wipe). Emulate `prefers-reduced-motion: no-preference` or no animation ever renders. `img.decode()` barrier before capture.
- Capture at deviceScaleFactor 2–3, 390×844 viewport, screen-recording via Playwright video or CDP screencast.
- Needed: (a) roll-call ack confirm, (b) camera→#analyzing→meal result with macros + score move, (c) meal thread with AI + coach + parent messages (seed needs a mealId or composer is invisible), (d) score ring animating to 87 (repaint gotcha: ring markup rests at ZERO — capture the mount animation itself, which is what we want).
- Thread seed: 4-meal standard order Breakfast/Lunch/Dinner/Snack; blue→teal on score surfaces; product name only ever OnStandard.

## Assembly (Remotion)

- Remotion project under `scripts/commercial/` (not in app deps — own package.json).
- Phone composites: UI captures inside a device frame, subtle 3D tilt + push-in.
- Type: Archivo Expanded for numbers/headline moments (the score face), brand body type otherwise; blue→teal gradient signature; dark canvas.
- Music: CC0 track (freepd.com or similar) timed to the 100 BPM grid as the shipping placeholder; recommend founder swap to Artlist/Epidemic license before paid campaigns. Edit stays on the grid so a swap is a drop-in.
- ffmpeg final encode; xfade frozen-tail trim gotcha applies if ffmpeg concat used anywhere.

## Cost guardrail

≤ ~15 gpt-image-2 frames, ≤ ~15 Kling generations. Stop and reassess if a shot needs a 4th take.

## Known risks

- Higgsfield credit balance unknown — first 402 stops Phase C for a founder top-up.
- OpenAI billing hard-limit previously hit once — same stop rule.
- Kling needs public image URLs (catbox.moe staging, as hero pipeline).
