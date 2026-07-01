# OnStandard — Skeptical Persona Review (2026-06-24)

Seven simulated target users reviewed the real app (onboarding, dashboards, meal/AI
flow, score, visibility) from their own lens. They were instructed to be brutally
honest, review-only, and to think like skeptical real users, not friendly assistants.
This is a pre-beta gut-check meant to expose weaknesses before real coaches see it.

> **Headline:** The intervention-first "who's slipping → nudge them" dashboard and the
> AI meal-coaching screen are genuinely good, rare instincts. But today this is a
> polished athlete nutrition-compliance demo running on hardcoded data with a
> coach/parent/trainer skin bolted on. It will not survive contact with a real coach
> until the data is real, the score is defensible (and honestly named), and there's a
> consent layer for minors.

---

## 1. Marcus — Personal Trainer
Coaches general fitness, weight-loss, muscle-gain clients (adults, not athletes).

- **Primary motivation:** Keep clients compliant/engaged between sessions and retain them, without adding admin work or asking adults to use something built for high-school jocks.
- **Biggest pain:** Clients drift between sessions; no honest read until they show up (or quit). Wants a glanceable "who's slipping" + easy outreach.
- **Likelihood to use:** 4/10 — the follow-up + nudge loop is his workflow, but the whole product reads athlete-coded.
- **Likelihood to pay:** 3/10 — static KPIs, hardcoded 92% retention, demo athlete roster; the only action is a canned nudge; value to him is never demonstrated before he's asked to invite a client.
- **Top 3 that work:** (1) Trainer dashboard nails the triage shape (Needs Follow-Up → tap → nudge). (2) AI meal-coach result is the standout — coaching, not a food log. (3) Trainer onboarding asks the right questions (client type, count, retention/adherence challenge).
- **Top 3 problems:** (1) Product is athlete-first; non-athlete adults are an afterthought (sport-only roster, "season weight goal," 180g protein, "glycogen for tomorrow's session"). (2) Headline KPIs are fake (92% retention, +6% trend). (3) Only between-session action is a canned nudge — far too thin for a retention-driven trainer.
- **Most confusing:** Athlete Score breakdown — can't tell what it measures for a general-fitness/weight-loss client.
- **Most valuable:** AI Nutrition Coach result.
- **Missing trust signal:** No proof the numbers are real, no "how the score is calculated," no privacy statement for adult clients, no real results timeline.
- **Copy fixes:** Trainer-path welcome should lead with trainer value, not "build your development plan"; goal-based targets instead of "season weight goal"/180g; cut the invented "70% of at-risk clients recover after a nudge"; switch AI voice off athlete metaphors per clientType.
- **Must-fix before beta:** Real (or clearly-labeled-sample) trainer KPIs; non-athlete clients as first-class (book + score/targets/voice that adapt to fat-loss/general/muscle-gain); show value before the invite ask; plain-language "what this measures."
- **Nice-to-have later:** Two-way messaging; workout/plan assignment; client results timeline; surface trainingFreq; per-client custom targets.
- **Verdict:** Good bones (intervention dashboard + AI coaching), but an athlete app with a trainer skin and fake headline numbers. Wouldn't put a paying client's name on it yet.

## 2. Coach Reyes — Sports Performance Coach
Trains athletes for speed/strength/size/output; cares about compliance, recovery, weight goals, measurable development.

- **Primary motivation:** Know — without chasing them — whether athletes are eating, recovering, and hitting weight/body-comp targets between sessions, and catch the one slipping before it costs a game.
- **Biggest pain:** Athletes forget/lie about what they do away from the facility; he finds out too late.
- **Likelihood to use:** 5/10. **Likelihood to pay:** 3/10 (won't pay for a demo roster with hardcoded weight deltas and a uniform streak).
- **Top 3 that work:** (1) Coach dashboard opens on ranked Needs-Attention with a derived reason + one action — exact 3-second triage. (2) The score is honest by design (incomplete reads as incomplete; nutrition correctly heaviest). (3) Role onboarding speaks his language.
- **Top 3 problems:** (1) The development data he lives on is faked/missing — same +7 lb delta and 12-day streak for every athlete; weightScore hardcoded to 95. (2) It's a nutrition-compliance tool in a "performance" jersey — zero training load/lifts/speed; recovery is a weekly slider. (3) Whole coach experience is a seeded demo roster; real athletes = an empty hardcoded invite code (EAGLES24).
- **Most confusing:** PersonDetail — looks like a real scouting read but weight delta/streak are constants and the breakdown is reverse-derived from one number.
- **Most valuable:** Coach Dashboard Needs-Attention card.
- **Missing trust signal:** No evidence any number came from the actual athlete on an actual day.
- **Copy fixes:** AI Team/Athlete summaries assert canned conclusions regardless of roster — derive or drop; reset coach onboarding expectation from "your first AI coaching moment" to "see your roster light up"; label what the score weights.
- **Must-fix before beta:** Real per-athlete weight progression (kill +7/95); real invite→roster path; derive the at-risk reasons + summaries from real data or remove; de-fake streak and meal analysis.
- **Nice-to-have later:** Training load/lift/sprint capture; real recovery (wearables); body-comp trend; position-group rollups; exportable weekly report.
- **Verdict:** Promising bones, wrong depth. Honest score philosophy and at-risk loop are rare and good, but it runs on a demo roster with hardcoded fields. Disqualifying for a coach judged on measurable development — until the data is real.

## 3. Dana — Nutritionist / Registered Dietitian
Builds/monitors meal plans; cares about compliance, food-quality accuracy, behavior change, education, liability.

- **Primary motivation:** See at a glance which clients are following nutrition between sessions and intervene early — without her name attached to inaccurate AI macro claims or advice she didn't give.
- **Biggest pain:** Macro/quality numbers are fabricated, not measured (fixed per meal SLOT), and the +/- steppers and "Re-analyze" are no-ops — she can neither trust nor correct an estimate. An uncorrectable wrong number clients act on is a liability.
- **Likelihood to use:** 3/10. **Likelihood to pay:** 2/10.
- **Top 3 that work:** (1) Needs-Attention → nudge is a real fast triage. (2) Honest framing of the Starting Point Score as a self-report estimate. (3) Clean, calm, nutrition-lensed UI.
- **Top 3 problems:** (1) Macros hardcoded per slot and clinically implausible (veggie omelette + toast = 38g; near-identical yogurt snacks reading 24g vs 49g). (2) AI coach gives prescriptive goal-themed boilerplate ("stay in a surplus," "have a shake tonight") with no RD in the loop — clinical overreach she'd be liable for. (3) Score breakdown + AI summary invented from one number — every client shows the same-shaped bars.
- **Most confusing:** MealDetail — precise "Quality Breakdown," steppers, and "Re-analyze" all look authoritative/editable but none respond.
- **Most valuable:** Needs-Attention card + nudge.
- **Missing trust signal:** No "how a macro was produced," no confidence, no "estimate — verify portion," no food-data source, no scope gating on prescriptive advice, no way to correct an estimate.
- **Copy fixes:** Label every macro/quality figure as an estimate with confidence + "Edit/verify portion"; reframe coaching from prescriptive to educational/optional and scoped ("General guidance — your nutritionist sets your plan"); mark self-reported vs photo-estimated vs measured; replace templated AI summary with one citing the actual signals used.
- **Must-fix before beta:** Make analysis actually read the photo (or clearly label demo); editable foods/portions that recompute; estimate/confidence labeling + verify step; gate/soften prescriptive advice; fix clinically implausible seed values.
- **Nice-to-have later:** Plan/target authoring per client; trusted food DB / barcode / manual entry; education library attachable to a nudge; per-macro adherence trends; surface trainingFreq.
- **Verdict:** Promising workflow shell, but the nutrition substance is simulated and presented with the confidence of measured clinical data. A credibility-and-liability gap, not a polish gap. Wouldn't put clients or her license behind it today.

## 4. Sharon — Parent (of a 16-year-old athlete)
Wants quiet, honest visibility without nagging; worried about privacy on a minor.

- **Primary motivation:** Honest visibility into whether her kid is eating/recovering/progressing, so she can step in only when something is genuinely slipping.
- **Biggest pain:** No real link to her actual child — the invite is a fake hardcoded code and there's no backend, so she sees a demo kid ("Jihad") or her child's name pasted over invented charts.
- **Likelihood to use:** 3/10. **Likelihood to pay:** 1/10 (weakest payer — no privacy/consent story for a minor is an instant no).
- **Top 3 that work:** (1) Single-athlete parent view is genuinely glanceable (ring, weekly dots, weight + nutrition trends, plain summary). (2) Calm, non-hype tone — feels serious, not a kid's game. (3) Honest "no notes yet" empty state for Coach Notes.
- **Top 3 problems:** (1) No real data pipeline — fake invite, demo data, the product's whole promise broken. (2) Zero privacy/parental-consent handling for a minor's meal photos and weight — disqualifying. (3) One-way reassurance feed she can't verify; the AI summary always says "no action needed."
- **Most confusing:** Parent onboarding — asks athlete name/sport/goal, hands her "EAGLES24," then dumps her on a dashboard already full of a kid's data; can't tell if it's her child, a sample, or nothing real.
- **Most valuable:** Parent "This week" dashboard — right shape, *if* fed real data.
- **Missing trust signal:** Any proof the data is her actual kid + any privacy/consent statement ("linked to [child] — last synced 6:40pm," "your child approved sharing X").
- **Copy fixes:** Replace always-on "no action needed" with a freshness state ("Last update from Jordan: today 6:40pm"); say plainly what linking shows and hides; add an explicit minor-privacy line; label partial history ("Building history — 3 of 7 days").
- **Must-fix before beta:** Real parent↔athlete link; minor consent/data-governance; data-freshness/linked-status indicator; make the invite real or mark it "coming soon."
- **Nice-to-have later:** Drill into a day/meal to see the actual photo + coach feedback; opt-in weekly digest; athlete-routed nudge from the parent side; surface trainingFreq.
- **Verdict:** Right idea, pleasantly calm, but it fails its one job — it cannot show her real child. A polished prototype of a feeling. Closed within a minute.

## 5. Coach Tucker — High School Coach
Manages 40+ athletes across position groups, almost no time, accountable for the whole roster.

- **Primary motivation:** Roster-wide accountability and instantly seeing WHO needs help, without babysitting or chasing buy-in.
- **Biggest pain:** The entire engine depends on 40+ teenagers voluntarily photographing every meal daily — which won't happen at HS level; if they don't log, the dashboard is empty.
- **Likelihood to use:** 5/10. **Likelihood to pay:** 3/10.
- **Top 3 that work:** (1) Needs Attention is intervention-first, ranked worst-first with a real derived reason + one-tap nudge. (2) The score gives one shared number + plain-language status. (3) Role onboarding is short and honest (<1 min).
- **Top 3 problems:** (1) Built for the athlete, not him — nutrition photo-logging is 40% of the score and depends on 40 teens daily. (2) No roster scale or position-group filtering — 6 seeded athletes, no search, no offense/defense/ST grouping, no bulk action. (3) The only action is Nudge — can't message a group, set a standard, or track discipline/practice.
- **Most confusing:** Coach onboarding invite step — hardcoded "EAGLES24," then drops him onto a populated dashboard of athletes he never invited.
- **Most valuable:** Needs-Attention list with reason + Nudge.
- **Missing trust signal:** Nothing is real — fake code, seeded roster, an "AI TEAM SUMMARY" recommending "1-on-1 before Friday" off demo numbers.
- **Copy fixes:** Coach onboarding should set honest expectations ("0 of 24 athletes have logged today") instead of a demo roster; AI summary shouldn't make confident claims off thin data; reframe value prop around the roster, not the meal.
- **Must-fix before beta:** Dashboard that works at 40+ (position-group segmentation, search, real empty state); believable invite→roster path + a "who hasn't logged" view; reduce dependence on daily meal photos (lighter compliance signal).
- **Nice-to-have later:** Group-level nudge/message; practice attendance/discipline/weight-room; trend by position group; coach-set team standards.
- **Verdict:** A well-built ATHLETE app with a coach window bolted on. The Needs-Attention dashboard is the right idea and cleanest part, but it assumes 40 teens logging meal photos daily, doesn't scale, and every screen is seeded demo data. Would demo it, wouldn't roll it out.

## 6. Coach Vance — College Coach
High-stakes P5-type program (scholarships, NIL, revenue share, portal retention); cares about protecting investment, development, compliance, liability, data governance.

- **Primary motivation:** Know what athletes do between sessions to protect the investment and intervene early — without creating compliance/liability exposure.
- **Biggest pain:** It treats a college program like a consumer fitness app — no consent/data-governance for minors' and student-athletes' health data, no real roster, a "51+" max band, and a one-way message-less Nudge. Can't put it in front of compliance or an AD.
- **Likelihood to use:** 3/10. **Likelihood to pay:** 1/10 (ties weakest payer — fails procurement/liability before price).
- **Top 3 that work:** (1) Dashboard is correctly intervention-first with KPIs derived from the roster. (2) PersonDetail breakdown is anchored honestly to the headline score. (3) Onboarding is fast and role-tailored.
- **Top 3 problems:** (1) No compliance/consent/data-governance posture for student-athlete + minor health data. (2) Everything is seeded demo data — no real roster ingestion. (3) The score leans on self-report + stubs (weightScore=95 for everyone, 4-item macro lookup, 4 pre-written AI results).
- **Most confusing:** Coach dashboard at first real open — KPIs/summary/roster show a seeded LB room he never entered, with no path to load his athletes.
- **Most valuable:** Needs-Attention card + PersonDetail breakdown.
- **Missing trust signal:** Any data-governance/consent/access-control story (who sees weight/health data, athlete+parent consent, FERPA-type handling, NCAA nutrition guardrails, SSO/role-based staff access).
- **Copy fixes:** Roster band must go past "51+" to 85-110 and ask about staff seats; AI summary's frozen "1-on-1 before Friday" must derive or drop; Nudge must say what it sends; replace "drop your team code in the group chat" with admin-grade roster/staff onboarding.
- **Must-fix before beta:** Real roster ingestion + account linking; data-governance/consent layer; defensible score (kill weightScore=95, real intake, disclose self-report); a real action beyond a blind nudge (attachable note + documentation trail).
- **Nice-to-have later:** Real LLM + camera meal analysis; staff multi-seat scoped access; export/weekly report; NCAA banned-substance guardrails; surface or stop collecting trainingFreq.
- **Verdict:** Right instincts, wrong altitude. A polished demo, not a product, for his world: fake roster, self-report score with a weight stub, canned AI, message-less nudge, and zero governance for minors' health data — never clears an AD.

## 7. Jayden — Athlete (17, the primary user)
Wants playing time, body comp, scholarship/NIL, confidence, honest feedback.

- **Primary motivation:** Get bigger/leaner/faster, prove to coaches he's doing the work, and get a real read on scholarship trajectory — feedback that makes him better, not another adult watching him.
- **Biggest pain:** The whole thing is a nutrition tracker in a "performance" jersey. His goals are playing time/speed/strength/scholarship, but his score is protein + meals + a weekly mood survey — nothing about lifts, sprint times, or film. The score moves because he photographed dinner, not because he got faster.
- **Likelihood to use:** 4/10. **Likelihood to pay:** 2/10 (17, no card, MyFitnessPal-grade value with a coach-surveillance vibe).
- **Top 3 that work:** (1) Onboarding is fast and respectful — one question per screen, Starting Point Score in <5 min, then an immediate +3 first-meal challenge so the loop works. (2) AI meal result leads with coaching + one concrete next step, framed around his chosen goal — the one screen that feels like a person. (3) Honest, never fake-hype copy ("You're behind today," not confetti).
- **Top 3 problems:** (1) Sold as performance/scholarship, but it's a nutrition tracker — score is 40% nutrition, 20% a flat 95 weight score, 20% a mood survey; can't tell him if he's getting better at his sport. (2) Surveillance dread — "Visible to Coach Davis," "sent to your coach & your parent," worst-first ranking, "Nudge." Feels like homework his coach and mom grade. (3) Clearly a demo (same Coach Davis / Eastside HS / leaderboard everywhere); a real solo athlete gets an empty squad — the retention hook is blank on day one.
- **Most confusing:** Athlete Score hero — "Top of your team" badge with no team connected; weight score is a hidden flat 95; "Recovery" is his own sliders — a number that judges him is mostly him rating himself.
- **Most valuable:** Meal analysis/result screen.
- **Missing trust signal:** No source/accuracy for AI numbers (no confidence range, no "tap to fix"); score weights never shown; zero privacy reassurance for a minor's body-weight data.
- **Copy fixes:** "Let's build your development plan" overpromises — rename to what it is or add performance; reframe "visible to Coach Davis"/"your coach is waiting on it" athlete-first ("You control who sees this"); add a one-tap "what's in this score?"; macros should say "estimated from your photo — tap to correct."
- **Must-fix before beta:** Add ≥1 real performance signal (lifts/PR/sprint/readiness) or stop calling it "Athlete Score"/"development plan"; make privacy athlete-first + reassure on body-weight data, kill the guilt framing; show what the score is made of in-app; give a solo athlete something on day one besides an empty leaderboard.
- **Nice-to-have later:** Scholarship/NIL shareable card; surface trainingFreq, tie tasks to position/sport; real photo capture + editable foods; body-comp tracking beyond one weight number.
- **Verdict:** The craft is real (fast onboarding, honest voice, a meal-coaching screen that helps), but the core promise is a bait-and-switch — it sells performance and hands him a nutrition tracker + mood survey, broadcast to his coach and mom. The strongest instinct in the app is built for the ADULT, not him. Would poke at it for a couple days, then drop it.

---

## Cross-agent summary

### Most common problems (independently flagged by multiple personas)
1. **Nothing on screen is real** — all 7 flagged seeded demo data presented as live (92% retention, weightScore=95, identical +7 lb delta and 12-day streak, a 4-item meal lookup, the static EAGLES24 code). The single most-cited problem; breaks trust on first open.
2. **The "Athlete Score" is a nutrition + self-report score wearing a performance jersey** — 6 of 7 said it's protein + meals + a weekly mood slider + a frozen weight stub, with no training load/lifts/speed/real recovery. The athlete and both sport coaches call it a bait-and-switch.
3. **Athlete-first with every other persona bolted on as a skin** — trainer (non-athlete adults), nutritionist (no plan authoring), parent (no real link), coaches (no roster scale).
4. **The only coach/trainer action is a one-tap canned Nudge** — no message, note, group action, or documentation trail.
5. **AI output is canned but presented with the confidence of fact** — team/athlete summaries and meal analysis are templates ("1-on-1 before Friday" every time; same 38g omelette). Pros catch it instantly and then distrust the whole screen.
6. **No privacy/consent/data-governance for minors and student-athletes** — disqualifying for the parent and college coach, not a polish gap.
7. **Macros are clinically implausible AND uneditable** — dead steppers/"Re-analyze"; an uncorrectable wrong number is a liability.
8. **Value is never demonstrated before the ask** — users land on a fake populated dashboard, then are asked to invite real people with no proof of what they get.
9. **Collected-but-unused data** — trainingFreq captured by multiple roles, surfaced nowhere.

### Highest-priority fixes (ordered)
1. **Kill all fabricated data or label it unmistakably as sample.** Remove/seed-label retention=92%, weightScore=95, the uniform +7 lb / 12-day streak, the per-slot meal lookup, the canned AI summaries. This gates everything else.
2. **Wire a real invite → roster/athlete → data pipeline.** Without it the coach AND parent products don't function.
3. **Add a minor/student-athlete consent + data-governance layer** (consent capture, athlete-controlled sharing, role-based visibility). Hard gate for parents and college procurement.
4. **Make the score defensible and honest about what it is** — add ≥1 real performance signal or rename it; show weighting in a tappable breakdown; label self-reported vs photo-estimated vs measured.
5. **Make meal analysis real or clearly demo-labeled; make foods/portions editable with recompute; add estimate + confidence labels** to every macro.
6. **Give coaches/trainers a real action beyond a blind nudge** — attachable message/note + documentation trail.
7. **Build the coach dashboard for real scale** — position-group segmentation, search, a "who hasn't logged today" view, real empty states, college roster bands to 85-110.
8. **Make every persona first-class** — non-athlete client book + goal-based targets/voice for the trainer; plan/target authoring for the RD; a genuinely live, freshness-stamped parent view.

### Strongest target user
The **high-school / sports-performance coach**. The intervention-first dashboard maps exactly onto how a coach triages in 3 seconds, and the honest score-to-status mapping was praised by everyone — but only after the data is real and the dashboard scales by position group.

### Weakest target user
The **parent of a minor** (pay 1/10) — the view can't show the parent's real child and has zero privacy/consent story. The **college coach** ties on payment (1/10) for the same root causes plus procurement/governance, but the parent is the most completely non-functional.

### Most valuable feature
The **AI Nutrition Coach meal-result screen** — named most valuable by the trainer and athlete; "reads like coaching, not a food log." The one surface that delivers standalone value. Caveat: its credibility depends on the underlying macros becoming real, editable, and confidence-labeled.

### Most confusing feature
The **Athlete Score + PersonDetail breakdown** — looks authoritative, but the weight component is hardcoded 95, streak/delta are constants, the breakdown is reverse-derived from one number, and 20-40% is the user's own sliders dressed up as objective. Nobody could explain what it measures for their specific user.

### Recommended beta audience
A small, hand-held cohort of **HS or sports-performance coaches (roster ~15-40)** who train competitive sport athletes and will accept it as a **nutrition-compliance + accountability tool**, NOT a full performance system. Pair each coach with athletes whose **parents are not yet in the loop**, so the missing minor-consent layer isn't load-bearing. Defer the parent, nutritionist, college/P5, and non-athlete-trainer audiences until real data, a defensible score, editable/labeled macros, a real intervention action, and a consent/governance layer exist.

### One-line takeaway
The intervention-first "who's slipping, nudge them" dashboard and the AI meal-coaching screen are genuinely good, rare instincts — but today this is a polished athlete nutrition-compliance demo running on hardcoded data with a coach/parent/trainer skin bolted on, and it will not survive contact with a real coach until the data is real, the score is defensible (and honestly named), and there's a consent layer for minors.
