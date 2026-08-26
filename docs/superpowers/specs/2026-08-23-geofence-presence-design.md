# Design brief: geofence presence (not arrival)

Shaped 2026-08-23 via `/impeccable shape`, then **built the same day** via `/impeccable craft`.

> **STATUS: built, verified, NOT shipped.** 12/12 gates green, 45 proto tests pass, QC'd in a real
> browser in both themes. Migration `0208_geofence_presence.sql` is **authored and never executed**
> (no Docker on this machine; `--linked` is live prod). Nothing is committed.
>
> **Ship order is not optional: apply 0208 BEFORE publishing the proto OTA.** Section 6's coach
> copy states that a minimum stay is enforced. Until the migration is live that sentence is false,
> and shipping the OTA first would replace one overclaim with a different one.
>
> The `presence_exit_grace()` value (5 minutes) is a starting guess. See section 13.

Founder framing, verbatim: *"the main purpose is to confirm that the athlete is in the facility,
or classroom or whatever the geofence is set at."*

That sentence is the whole brief. The system does not do it today.

---

## 1. The gap

Geofencing confirms a **boundary crossing**, not presence. Follow the coach's
"Stay at least 45 min" field through the stack:

| Step | Status |
|---|---|
| Coach types 45 into `coach-commitments.js:524` | works |
| Saves to `commitments.min_dwell_min` | works |
| Ships to the client in `my_commitments` | works |
| `complete_commitment(instance,'dwell')` enforces it (`0139:183-190`) | exists, correct, **never called** |
| Anything passing `'dwell'` | does not exist. Only caller is `roll-call.js:163`, hardcoded `'manual'` |
| Geofence `Exit` event | delivered (`notifyOnExit:true`), **dropped**. `src/lib/location/index.ts:214` branches on `Enter` only |
| `commitment_responses.departed_at` | declared `0138:166`, **written by nothing, read by nothing** |

A phone that clips the perimeter at 5:43 and drives on is credited identically to one that
stayed two hours. The comment at `src/lib/location/index.ts:212` claims "An Exit is recorded as
a departure only." That behaviour was never built.

**Wiring up the existing `'dwell'` path would not close this.** `complete_commitment` only checks
that clock time has passed since `arrived_at`. It never checks the athlete stayed. Arrive, leave
immediately, never return, and it still passes. Real presence needs the exit.

## 2. Primary user understanding

Not an action. The athlete should understand that being there was recorded. The coach should be
able to trust that the record means what the word implies.

## 3. Presence as a lifecycle

One event becomes three states:

1. **Provisional** — `Enter` fires. Here, but the session has not been held. This is what today's
   `arrived_at` already means, and it should stop looking like a settled result.
2. **Confirmed** — the dwell threshold passes with no sustained exit. This is the real signal and
   the one that carries accountability weight.
3. **Broken** — a sustained exit lands before the threshold. `departed_at` finally gets written.

## 4. The highest-risk constraint: indoor GPS

The founder named "classroom." Indoors, often concrete, the worst possible GPS environment. iOS
**will** fire spurious `Exit` events for an athlete sitting still in study hall.

A presence system that trusts a single `Exit` will accuse athletes of leaving rooms they never
left. That is precisely the failure the schema comment at `0138:155` exists to prevent:

> a dead phone, a revoked permission, weak GPS indoors, or a session moved to another field must
> never be silently converted into a failure.

**Therefore: the exit must be debounced.** A brief exit followed by re-entry is noise and must be
discarded. Only a sustained absence counts. Choosing that threshold is the hardest part of this
build and it is not a UI problem. It needs real device data (see Open items).

## 5. Founder rulings taken during shape

- **Scope: both phases, native build.** Phase A ships by OTA now. Phase B rides build #28.
- **Left early, sustained: verified absence, counted.** Distinct from `unverified`. The system
  knows they left, so it counts as not meeting the requirement, shown plainly with the time and
  open to the existing dispute path. The honesty rule stays intact: `unverified` remains excluded
  from the denominator, verified non-presence does not.

## 6. Phase A, proto, OTA-shippable, no build needed

Stop the product claiming what it does not do. Required regardless of Phase B timing.

- `coach-commitments.js` — the "Stay at least N min" field currently promises enforcement that
  never runs. Either remove it until Phase B lands, or label it honestly as not yet enforced.
  Do not leave a coach believing a drive-by is filtered.
- Athlete copy — demote "arrived" wherever it implies presence. What the coach cares about, and
  what the founder's sentence named, is *was there*.
- `src/lib/location/index.ts:212` — the comment describing exit handling that does not exist is a
  trap for the next reader. Fix or delete it.

## 7. Phase B, native, build #28

- Handle `GeofencingEventType.Exit` in the task at `src/lib/location/index.ts:207`.
- Debounce per section 4, then write `departed_at` (column already exists, no migration for it).
- Wire the `'dwell'` completion source, or replace it with a presence check that actually consults
  `departed_at` rather than clock time alone. Prefer the latter: the current function's contract
  does not match its name.
- Accountability weighting per the founder ruling in section 5.

## 8. Key states

| State | What the athlete sees |
|---|---|
| Provisional (arrived, session ongoing) | Quiet, factual, honest that it is not settled. **Not green.** |
| Presence confirmed | The moment. "You were at the Football Facility for the full session." Green, once, on Home. |
| Left early, sustained | Stated plainly with the time. No scolding. Disputable. |
| Exit was noise, re-entered | **Nothing.** The athlete never learns their phone wobbled. Silence is the correct output. |
| Couldn't confirm (dead phone, region cap, when_in_use) | Muted, explicit that nothing was counted against them. |
| No located commitment | Nothing renders. Absence is the design. |
| Read failed | No row. Never a fabricated presence. |

## 9. Design direction

**Restrained** (DESIGN.md floor). `--green` for confirmed presence only. `.status-pill.muted` for
anything unconfirmed, **never amber**: DESIGN.md reserves amber for warnings, and an unconfirmed
result is deliberately excluded from scoring rather than counted against the athlete.

**Scene sentence:** a sixteen-year-old walks out of a dark February parking lot into the facility
at 5:43 AM, pulls their phone out with one cold hand, glances for two seconds, and puts it in a
locker. Dark, with the light mirror owed in full.

**Anchors:** the Apple Wallet transit tap receipt (confirms, never celebrates); the Stripe payment
row (the *how* is a quiet first-class field, which is what `arrival_source` should become); a badge
reader's confirmation light (unemotional, unmistakable).

**Reflex to avoid:** a fitness-app "You made it!" celebration. PRODUCT.md bans confetti and
gamification by name, and this feature rests on "arrival does not prove work happened." A trophy
here breaks the product's central honesty claim.

## 10. Where the confirmed-presence moment lives

Home already has the right precedent in `.seen-receipt` (`screens.css:1231`), the tinted row that
says "Coach saw your day," elevated because "proof someone who matters opened the day is the core
differentiator." Proof you were where you said you would be is the same job in the same slot.
Reuse its structure, restraint, and `seen-in` entrance under the existing `playSeenIn` gate
(`home.js:898`).

**Collision to design around:** on a day where a coach viewed the day *and* presence confirmed,
Home stacks two near-identical green gradient rows under the score. That reads as a template.
Resolve as one receipts region with shared rhythm, presence leading (it is about the athlete's own
conduct; being seen is about someone else's).

`arrival_source` (`'geofence' | 'manual' | 'staff'`) is **already returned to the client** by
`my_commitments` (`0141:182`) and thrown away. `commitments.js:197-201` renders the same sentence
whether the phone did it or the athlete tapped.

## 11. Project constraints the build must respect

- **Type-scale ratchet.** `npm run lint:type` fails on raw `font-size: Npx`. New rules use tokens,
  even though the `.seen-receipt` beside them uses raw 12px.
- **Dual theme.** Compose alpha from `--green-rgb`, never a frozen `rgba(52,211,153,...)`.
- **No `__render()` inside `mount()`.** Infinite loop; documented in `connected-standards.js`.
- **Reduced motion.** The block at `screens.css:1442` gains the new class.
- **Icons** come from `js/icons.js`. Add the glyph to `P` first or `icon()` warns and emits nothing.
- **OTA.** Phase A must rebuild `assets/proto.zip` and commit it, or nothing ships.
- **Never bump `app.json` version.** Strands every `rt=1.0.0` OTA.

## 12. Recommended references

`ux-writing.md` carries the most weight; this is a handful of sentences that must be honest and
warm at once. Then `interaction-design.md` for the state matrix and `motion-design.md` for the
arrival-only entrance gate.

## 13. Open items

- **The debounce threshold is unset and cannot be chosen from a desk.** It needs a real device in
  a real building. This compounds the standing debt that geofencing has never been device-QA'd
  (needs Always permission and a real arrival). Recommend instrumenting Phase B to log raw
  enter/exit sequences before the threshold gates anything that scores.
- Phase B lands in the same native build as the owed HealthKit device QA. Worth batching.
