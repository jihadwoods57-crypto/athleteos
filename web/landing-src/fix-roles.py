"""One-shot corrections to the role pages: remove claims with no code behind them, refresh
stale ones, and swap the superseded v3-* screenshots for the regenerated set.
Run once from web/landing/:  python ../landing-src/fix-roles.py
"""
import io

FIX = {
"coaches.html": [
 # FABRICATED: no server-side read receipt exists (RT.coachSeenMealIds is coach-device-local)
 ("""<p>Real meal photos from your roster, newest first, with unseen markers. When you open an athlete's day, they see "Seen by Coach" &mdash; being watched is the point.</p>""",
  """<p>Real meal photos from your roster, newest first, with markers for what you haven't opened. Comment on one and it lands in that meal's thread &mdash; the athlete's screen flips from "Coach hasn't reviewed this meal yet" to "Coach replied."</p>"""),
 ("""<div class="lg-cell never"><b>Boundaries</b><p>Only athletes who joined with your code and were approved. When an athlete opens their day, they see that you looked.</p></div>""",
  """<div class="lg-cell never"><b>Boundaries</b><p>Only athletes who joined with your code and were approved. Opening their day is read-only; when you comment or react, they see that.</p></div>"""),
 ("""<p>Their daily score and flag, every logged meal with its photo and the AI's macro read, recovery check&#8209;ins, weight trend, requirement completion, and the meal threads. Opening an athlete's day is read&#8209;only &mdash; and they can see that you looked, which does half the coaching for you.</p>""",
  """<p>Their daily score and flag, every logged meal with its photo and the AI's macro read, recovery check&#8209;ins, weight trend, requirement completion, and the meal threads. Opening an athlete's day is read&#8209;only. You get two messages per meal &mdash; a deliberate cap, so the ones you send carry weight. Reactions are unlimited.</p>"""),
 # NOT SHIPPED: no athlete-facing leaderboard (state.js:3141 "coming soon")
 ("""<div class="lg-who">Teammates</div>
          <div class="lg-cell sees"><b>They see</b><p>Leaderboard score only.</p></div>
          <div class="lg-cell never"><b>Never</b><p>No logs, no photos, no details.</p></div>""",
  """<div class="lg-who">Teammates</div>
          <div class="lg-cell sees"><b>They see</b><p><b>Nothing.</b></p></div>
          <div class="lg-cell never"><b>Never</b><p>There is no team feed and no athlete-facing leaderboard. Nobody is ranked against anybody in public.</p></div>"""),
 # STALE pricing
 ("""<p>The professional pays; athletes are always free with a paying coach, trainer, or program. Team and facility plans are priced per roster &mdash; see <a href="/#pricing">pricing</a>. Founding 50 coaches lock 50% off for 12 months, grandfathered so a later price rise never touches them.</p>""",
  """<p>You pay; your athletes never do. Programs and facilities run <b>$249/mo</b> up to 30 active participants, <b>$499</b> up to 75, <b>$799</b> up to 150, with departments and multi-location quoted. An independent coach on their own book is <b>$99/mo</b> up to 25 clients or <b>$179/mo</b> up to 50. Every plan carries a 14-day trial and cancels in account settings &mdash; see <a href="/#pricing">pricing</a>. Founding 50 lock 50% off for 12 months, grandfathered.</p>"""),
 # Trust Pass: CHECK_EVERY = 5 -> every fifth day, not only days 5 and 10
 ("""<p>Seven photo&#8209;proven days on standard earns an athlete camera&#8209;free days, credited from their own real median &mdash; with camera spot&#8209;checks on days 5 and 10 and credit that decays until fresh photos reset it. You grant it; you can end it.</p>""",
  """<p>Seven photo-proven days at 80+ earns an athlete camera-free days, credited at <b>the median of their own proven days</b> &mdash; never their best one. Every fifth day the camera returns as a spot-check, and after ten camera-free days the credit decays. You grant it; you can end it.</p>"""),
 # superseded imagery
 ("""<img src="assets/product/v3-team.webp" width="390" height="760" alt="" decoding="async">""",
  """<img src="assets/product/coach-2-roster.webp" width="390" height="760" alt="" decoding="async">"""),
 ("""<img src="assets/product/v3-team.webp" width="390" height="760" loading="lazy" decoding="async" alt="OnStandard coach Team page: team score 87, needs-attention card with message and nudge actions, live activity feed of meals, and the roster with live scores.">""",
  """<img src="assets/product/coach-1-home.webp" width="390" height="844" loading="lazy" decoding="async" alt="OnStandard coach home: group score, how many are on standard, and ranked priorities.">"""),
 ("""<figcaption><b>Team</b> The roster with live scores, flags, and every log as it lands.</figcaption>""",
  """<figcaption><b>Home</b> Group score, who is on standard, and a ranked list of who needs you first.</figcaption>"""),
 ("""<img src="assets/product/v3-inbox.webp" width="390" height="760" loading="lazy" decoding="async" alt="OnStandard coach Inbox: the daily briefing computed from the roster, join requests, and unopened logs.">""",
  """<img src="assets/product/coach-3-inbox.webp" width="390" height="844" loading="lazy" decoding="async" alt="OnStandard coach inbox: a daily briefing computed from the real roster.">"""),
 ("""<img src="assets/product/v3-thread.webp" width="390" height="760" loading="lazy" decoding="async" alt="OnStandard meal thread: the AI's read of a dinner plate with detected foods and confidence, then the coach and athlete discussing it.">""",
  """<img src="assets/product/coach-4-insights.webp" width="390" height="844" loading="lazy" decoding="async" alt="OnStandard team insights, computed from the roster's real logs.">"""),
 ("""<figcaption><b>Meal thread</b> The AI's read, your comment, their reply &mdash; accountability with context.</figcaption>""",
  """<figcaption><b>Insights</b> Computed from your roster's real logs. A metric with no data says nothing at all, rather than hedging.</figcaption>"""),
],
"trainers.html": [
 # STALE: operator unification made this false (state.js:2388-2399)
 ("""<p>Their daily score, recovery and readiness from the nightly check&#8209;in, and nutrition consistency &mdash; live. The scope is shown to clients in the app in plain words, which is why they log honestly. Deeper coaching surfaces (meal photo review, targets editing, requirement assignment) live in the coach lane today.</p>""",
  """<p>Everything a team coach sees for their athletes: the daily score, every logged meal with its photo and macro read, recovery and readiness, weight as a trend, requirement completion and the meal threads. <b>Coach and trainer are one operator role</b> &mdash; you are not on a reduced tier. The scope is shown to clients in the app in plain words, which is why they log honestly.</p>"""),
 # STALE: the shipped standard is four slots (day.js MEAL_KEYS)
 ("""<li><b>The default client standard.</b><span>Three meals with photo proof, a nightly recovery check&#8209;in, weight as a weekly trend, a weekly check&#8209;in. Set once at signup, applied to every client.</span></li>""",
  """<li><b>The default client standard.</b><span>Four photo-proven slots &mdash; breakfast, lunch, dinner and a snack &mdash; a nightly recovery check-in, weight as a trend, and a weekly check-in. Set once at signup, applied to every client, adjustable from one to six meals.</span></li>"""),
 # MISSING: OnStandard Pay
 ("""<p>No. Clients are free while they're attached to your practice &mdash; you carry the subscription because you get the book&#8209;wide view. If a client leaves, their history stays theirs.</p>""",
  """<p>Not for the app &mdash; clients are free on your book, because you carry the subscription. Separately you <b>can</b> charge for your own coaching packages through OnStandard Pay: you set the price, the client pays in-app, the money lands in your own Stripe account and the platform takes 15%. A parent can pay on a client's behalf. If a client leaves, their history stays theirs.</p>"""),
 ("""<img src="assets/product/v3-home.webp" width="390" height="760" alt="" decoding="async">""",
  """<img src="assets/product/trainer-1-book.webp" width="390" height="760" alt="" decoding="async">"""),
],
"parents.html": [
 # The guardian RPC returns score/grade/date only (migration 0081)
 ("""<div class="lg-cell sees"><b>You see</b><p>Their daily score, their streaks, and completion &mdash; whether the day's requirements got done.</p></div>""",
  """<div class="lg-cell sees"><b>You see</b><p>Their daily score and letter grade, the date of their most recent logged day, and the same for the past 30 days.</p></div>"""),
 ("""<p>No &mdash; and that's a promise, not a limitation. Parents see score, streaks, and completion only. Meal photos never leave the coach connection, weight is visible only as a season trend to the coach, and check&#8209;in answers stay private. The app tells your athlete this in plain words, which is why they trust it enough to use it.</p>""",
  """<p>No &mdash; and that's a promise, not a limitation. The parent view returns exactly four things: your athlete's name, their score, their letter grade, and the date. Meal photos never leave the coach connection, weight is visible only as a trend to the coach, and check-in answers stay private. The app tells your athlete this in plain words, which is why they trust it enough to use it.</p>"""),
 ("""<div class="lg-cell never"><b>Boundaries</b><p>Read&#8209;only, scoped to their own roster. When they open your athlete's day, your athlete sees it.</p></div>""",
  """<div class="lg-cell never"><b>Boundaries</b><p>Read-only, scoped to their own roster. When they comment or react, your athlete sees it.</p></div>"""),
 ("""<div class="lg-who">Teammates</div>
          <div class="lg-cell sees"><b>See</b><p>Leaderboard score only.</p></div>
          <div class="lg-cell never"><b>Never</b><p>No logs, no photos, no details. Nothing is public, to anyone.</p></div>""",
  """<div class="lg-who">Teammates</div>
          <div class="lg-cell sees"><b>See</b><p><b>Nothing.</b></p></div>
          <div class="lg-cell never"><b>Never</b><p>There is no team feed and no athlete-facing leaderboard. Nothing is public, to anyone.</p></div>"""),
 # STALE: parent-funded packages and the household plan both exist
 ("""<p>Nothing, in the normal case: athletes are free while they're attached to a paying coach, trainer, or program. The professional pays because the professional gets the roster value.</p>""",
  """<p>Nothing, in the normal case: your athlete is free on a paying coach, trainer, or program's roster. Two optional things do cost money, and you choose both. You can <b>fund a coaching package</b> for your child directly &mdash; their trainer sets the price, you pay in the app, and it appears under "Funded plans" where you can cancel it. And a household with several athletes can put them on a single bill. Neither is required for your athlete to be scored.</p>"""),
 # the page had no product imagery at all
 ("""<div class="rp-photo"><img src="assets/img/g-hero-parents.webp" width="1024" height="1536" alt="" fetchpriority="high"></div>""",
  """<div class="rp-photo"><img src="assets/img/g-hero-parents.webp" width="1024" height="1536" alt="" fetchpriority="high"></div>
        <div class="p3d">
          <div class="p3d-screen"><img src="assets/product/parent-1-dashboard.webp" width="390" height="760" alt="" decoding="async"></div>
        </div>"""),
],
"dietitians.html": [
 # STALE: plan styles move the mix; the CAPS are what is actually fixed
 ("""<p>Fat&#8209;loss clients are scored on calorie&#8209;window adherence and meal consistency; gain clients on the calorie floor and protein; athletes on protein and timing. The weights are fixed platform&#8209;wide &mdash; adherence numbers you can compare across your whole book.</p>""",
  """<p>Fat-loss clients are scored on calorie-window adherence and meal consistency; gain clients on a calorie floor and protein; athletes on protein and timing. You set the targets; <b>you can never move the weights, and every weight has a published ceiling</b> &mdash; which is exactly what makes adherence comparable across your whole book.</p>"""),
 ("""<img src="assets/product/v3-thread.webp" width="390" height="760" alt="" decoding="async">""",
  """<img src="assets/product/loop-3-meal-read.webp" width="390" height="760" alt="" decoding="async">"""),
 ("""<img src="assets/product/v3-camera.webp?v=2" width="390" height="760" loading="lazy" decoding="async" alt="OnStandard camera screen for logging dinner: framed viewfinder and the 8:00 PM deadline.">""",
  """<img src="assets/product/loop-2-camera.webp" width="390" height="844" loading="lazy" decoding="async" alt="The OnStandard camera screen a client uses to log a meal.">"""),
 ("""<img src="assets/product/v3-thread.webp" width="390" height="760" loading="lazy" decoding="async" alt="OnStandard meal thread: the AI's read of a dinner plate with detected foods and confidence, then the professional and client discussing it.">""",
  """<img src="assets/product/loop-3-meal-read.webp" width="390" height="844" loading="lazy" decoding="async" alt="A logged OnStandard meal: detected foods with confidence, macros, a meal-quality read and the timing stamp.">"""),
 ("""<figcaption><b>Thread</b> The AI's read, your comment, their reply &mdash; context preserved.</figcaption>""",
  """<figcaption><b>The read</b> Foods with per-item confidence, macros, meal quality, and whether it landed inside its window.</figcaption>"""),
 ("""<img src="assets/product/v3-home.webp" width="390" height="760" loading="lazy" decoding="async" alt="OnStandard home screen: the daily score ring, streak, and today's record of completed requirements.">""",
  """<img src="assets/product/style-intuitive.webp" width="390" height="844" loading="lazy" decoding="async" alt="An OnStandard plan on the Intuitive style: no calorie or macro targets shown to the client.">"""),
 ("""<figcaption><b>The day</b> Meals, recovery, and check&#8209;ins in one score clients actually watch.</figcaption>""",
  """<figcaption><b>Intuitive</b> A client who should not be looking at numbers doesn't see any. Same score, measured on awareness and adequate fueling instead.</figcaption>"""),
],
}

if __name__ == "__main__":
    total = miss = 0
    for path, reps in FIX.items():
        s = io.open(path, encoding="utf-8").read()
        n = 0
        for a, b in reps:
            if a in s:
                s = s.replace(a, b); n += 1
            else:
                miss += 1
                print(f"  MISS {path}: {a[:78]}")
        io.open(path, "w", encoding="utf-8", newline="").write(s)
        total += n
        print(f"{path}: {n}/{len(reps)}")
    print(f"\napplied {total}, missed {miss}")
