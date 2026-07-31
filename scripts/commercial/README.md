# "One Day on Standard" — commercial pipeline

Spec: `docs/superpowers/specs/2026-07-31-commercial-one-day-on-standard-design.md`

Five stages, all rerunnable:

1. **UI capture** — `node scripts/serve-proto.mjs 8799`, then `node scripts/commercial/capture-ui.mjs [names] [--hi]`.
   Screencasts the real proto (seeded evidence, stubbed Supabase — no painted numbers) into
   `.tmp/commercial/ui/*.mp4`. `--hi` captures 2x detail takes for punch-ins.
2. **Keyframes** — `node scripts/commercial/keyframes.mjs s1..s5 [--engine soul]`.
   gpt-image-2 primary; Higgsfield Soul fallback (used 2026-07-31: OpenAI billing hard-limit).
   Judge every take: Soul invents clothing logos and teeth — re-roll or retouch before animating.
3. **Animation** — `node scripts/commercial/animate.mjs s1..s5` (Kling v2.5-turbo via Higgsfield;
   keyframes staged on uguu.se — catbox/0x0.st were dead 2026-07-31).
4. **Score** — `node scripts/commercial/music.mjs` → synthesized rights-clean pulse bed on a
   100 BPM grid (18f/beat at 30fps). A licensed track can replace `score.wav` 1:1 — the edit
   sits on the same grid; the hit lands at 62.4s.
5. **Assembly** — `cd scripts/commercial/remotion && npx remotion render src/index.ts Master out/commercial-master.mp4 --codec h264 --crf 16`.
   Compositions: `Master` (75.6s 16:9), `Preroll30` (30s 16:9), `Vertical15` (15s 9:16).
   Copy assets into `remotion/public/` first (clips + ui captures + fonts; see capture stages).

Brand: dark-navy `#070B14`, Athlete Blue, dial sweep `#34D399→#22D3EE→#60A5FA`, Archivo
Expanded 900 for kinetic type, Plus Jakarta Sans 800 two-tone wordmark (LOGO.md brand law).
