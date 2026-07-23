"""Insert a per-role "how it works" section into each role page.

Every step names a concrete user ACTION and the concrete SYSTEM RESPONSE, paired with the real
screenshot of that step from web/landing/assets/product/. Uses the .loop component added to
site.css. Run once from web/landing/:  python ../landing-src/add-loops.py
"""
import io

def step(n, img, alt, do, get):
    return f"""        <div class="loop-step">
          <div class="phone sm"><img src="assets/product/{img}" width="390" height="844" loading="lazy" decoding="async" alt="{alt}"></div>
          <div class="loop-txt"><span class="loop-n">{n}</span><p class="loop-do">{do}</p>
          <p class="loop-get">{get}</p></div>
        </div>
"""

def section(sid, kicker, h2, lede, steps, tail=""):
    return f"""  <!-- ============ HOW IT WORKS ============ -->
  <section class="rp-sect" id="{sid}" aria-labelledby="{sid}-h">
    <div class="wrap">
      <div class="rp-head">
        <p class="kicker reveal">{kicker}</p>
        <h2 id="{sid}-h" class="h2 reveal d1">{h2}</h2>
        <p class="lede reveal d2">{lede}</p>
      </div>
      <div class="loop reveal d2">
{''.join(steps)}      </div>
{tail}    </div>
  </section>

"""

COACH = section(
 "how", "How it works", "Your week, with OnStandard in it.",
 "Five things you actually do. Every screen below is the real app &mdash; the scores in them were computed by the same engine that will score your roster.",
 [
  step(1, "coach-5-create.webp", "The OnStandard coach create menu: assign a requirement, send an announcement, message, set standards, or schedule a commitment.",
     "Share one team code, then set the standard.",
     "Athletes enter the code once and land on your board as a request <b>you approve</b>. You set meals per day (one to six), their windows, weigh-in days and per-athlete targets &mdash; per team, or overridden per position room."),
  step(2, "coach-1-home.webp", "OnStandard coach home showing group score, how many are on standard, and a ranked priority list.",
     "Open the app once a day.",
     "The group score, how many are on standard, and <b>a ranked list of who needs you first</b> &mdash; ordered by what actually happened, not alphabetically. No dashboard to interpret."),
  step(3, "coach-2-roster.webp", "An OnStandard roster: six athletes with live scores, status flags and trend sparklines.",
     "Read the roster in one screen.",
     "<b>On standard</b>, <b>below standard</b>, <b>overdue</b>, <b>no activity</b> &mdash; four honest states. The athlete who hasn't logged shows a dash, never an invented number. One tap nudges them, <b>once per day</b>, so it stays sharp."),
  step(4, "coach-3-inbox.webp", "The OnStandard coach inbox with a daily briefing computed from the real roster.",
     "Act on the briefing, not on memory.",
     "Computed from your actual roster: who hasn't logged, who's under the bar, who leads the day. Alongside it, a work queue &mdash; join requests, logs you haven't opened, threads waiting on you."),
  step(5, "coach-4-insights.webp", "OnStandard team insights, computed from the roster's real logs, naming athletes trending down.",
     "Catch the fade before it's a departure.",
     "Insights name who is trending down and by how much. A weekly digest lands automatically with anyone <b>silent for three or more days</b>. And when a metric has no data behind it, the app says <b>nothing at all</b> rather than hedging."),
 ],
 tail="""      <div class="duo reveal" style="margin-top:clamp(46px,6vw,80px)">
        <div class="duo-shot"><div class="phone sm"><img src="assets/product/vc-1-rollcall.webp" width="390" height="844" loading="lazy" decoding="async" alt="An athlete's OnStandard home at 5am showing a Morning Roll Call card titled 5 AM Club with one button."></div></div>
        <div class="duo-body">
          <p class="kicker">Verified Commitments</p>
          <h3>For the things a photo can't prove.</h3>
          <p>Schedule a 5&nbsp;AM roll call, a lift, study hall, tutoring or rehab. The athlete gets a card carrying <b>your own title for it</b> &mdash; "5 AM Club", not software vocabulary &mdash; and one button. Reminders go only to athletes who haven't answered, so nobody is called out in a group chat, and they deliberately break quiet hours because a silent 4:45 AM alarm is a feature that doesn't work.</p>
          <p>It produces <b>its own Accountability number</b>, separate from the daily score: answering counts a little, arriving on time counts more, finishing counts most. <b>"Couldn't verify" is never "missed"</b> &mdash; a dead phone or weak GPS leaves the calculation rather than counting against anyone, and only you can mark someone missed.</p>
          <p style="color:var(--text-3);font-size:13.5px">Arrival verification watches a single location you specify, only during that event's window. No coordinates are ever stored, and athletes who decline background location check in with a button instead.</p>
        </div>
      </div>
""")

TRAINER = section(
 "how", "How it works", "One code. Your whole book, live.",
 "Four steps from signing up to walking into a session already knowing. Every screen is the real app.",
 [
  step(1, "trainer-3-grow.webp", "The OnStandard trainer Grow screen with a public page, offers and applications.",
     "Set up your practice and share one client code.",
     "Name the practice, set the default standard, get your code. Clients enter it once and appear as requests <b>you approve</b>. You also get a public page they can apply through."),
  step(2, "trainer-1-book.webp", "An OnStandard trainer's client book, sorted by score with status flags.",
     "Check the book before your first session.",
     "Every client sorted by score with honest flags. A client who didn't log reads <b>\"No logs today\"</b> &mdash; never a fabricated number. You know they slept badly before they tell you."),
  step(3, "trainer-2-home.webp", "The OnStandard trainer home showing who needs attention today.",
     "Send the one message that matters.",
     "Your note arrives as <b>a real push notification, from you, by name</b> &mdash; not an email they'll read Thursday. You get two messages per meal thread, so the ones you send land."),
  step(4, "style-guided.webp", "An OnStandard plan on the Guided style: flexible ranges rather than exact numbers.",
     "Match the plan to the person.",
     "Assign <b>Structured</b> (exact targets), <b>Guided</b> (flexible ranges plus meal quality) or <b>Intuitive</b> (no calorie or macro surface at all). A client can state a preference; you confirm or adjust it &mdash; and switching never rewrites their history."),
 ],
 tail="""      <div class="duo flip reveal" style="margin-top:clamp(46px,6vw,80px)">
        <div class="duo-shot"><div class="phone sm"><img src="assets/product/parent-2-fund.webp" width="390" height="844" loading="lazy" decoding="async" alt="The OnStandard fund-a-plan screen a parent uses to pay for a child's coaching package."></div></div>
        <div class="duo-body">
          <p class="kicker">OnStandard Pay</p>
          <h3>Get paid inside the app.</h3>
          <p>Connect a Stripe account, publish your packages at your own prices, and clients pay in-app &mdash; one-off, per session, weekly or monthly. The money goes to <b>your</b> Stripe account; <b>the platform takes 15%</b>. Refunds return the fee too.</p>
          <p>A parent can pay on a client's behalf: the app checks they're an active guardian <em>and</em> that the athlete is an active client of your practice, every time. They see what they're funding, and can cancel it themselves.</p>
        </div>
      </div>
""")

PARENT = section(
 "how", "How it works", "What actually happens, step by step.",
 "Four steps, and a hard stop in the middle that exists specifically to protect your family.",
 [
  step(1, "state-connect.webp", "The OnStandard connect screen showing which team a code belongs to and what they will see.",
     "Your athlete joins their coach.",
     "They enter a code. Before anything is shared the app shows them <b>the real team behind that code</b> and spells out exactly what that coach will see. Nothing moves until they confirm."),
  step(2, "loop-1-home-morning.webp", "An OnStandard athlete home screen showing the day's requirements.",
     "Under 18? Everything stops and waits for you.",
     "Their logs stay <b>on their phone</b> &mdash; not on our servers, not visible to the coach &mdash; until you approve by email. One email, one button. Under 13 can't sign up at all, and the app doesn't even keep their name."),
  step(3, "loop-7-home-complete.webp", "A completed OnStandard day with the score and streak.",
     "They do the work; the app scores it.",
     "Meals photographed, a check-in before bed, one honest answer to close the day. <b>Their coach sees the detail. You don't</b> &mdash; and that boundary is the reason they use it honestly."),
  step(4, "parent-1-dashboard.webp", "The OnStandard parent dashboard showing an athlete's score, grade and latest logged day.",
     "You see whether the work is getting done.",
     "Their score, their letter grade, and the date of their latest logged day &mdash; today and the past 30. <b>That's the whole view.</b> No photos, no weight, no check-in answers, no coach threads, ever."),
 ])

DIETITIAN = section(
 "how", "How it works", "From plate to record, in four steps.",
 "What happens between your appointments, on the screens your clients actually use.",
 [
  step(1, "loop-2-camera.webp", "The OnStandard camera screen a client uses to log a meal.",
     "Your client photographs the plate.",
     "No recall, no food diary that dies in week two, no typing. Packaged food is scanned from the Nutrition Facts panel and <b>transcribed rather than estimated</b> &mdash; estimation is reserved for plates that need it."),
  step(2, "loop-3-meal-read.webp", "A logged OnStandard meal showing detected foods with confidence, macros and meal quality.",
     "The model reads it, and asks when it can't see.",
     "Each food carries <b>high, medium or low confidence</b>. When something invisible would move the numbers &mdash; cooking fat, a sauce, food off-frame &mdash; it asks one to three questions rather than guessing. Estimates are bounded by an energy-consistency check so one bad read can't distort a day."),
  step(3, "loop-8-breakdown.webp", "The OnStandard score breakdown showing each component's contribution.",
     "It lands as adherence you can compare.",
     "Timing is part of the record: on time counts full, late counts half, and the log says how late. You set the targets. <b>You can never move the weights</b>, and each has a published ceiling &mdash; which is what makes adherence comparable across your whole book."),
  step(4, "style-intuitive.webp", "An OnStandard plan on the Intuitive style, showing no calorie or macro targets.",
     "You choose how much structure they see.",
     "You are one of only three roles that can <b>assign a plan style</b>. Put a client on <b>Intuitive</b> and the app shows them no calories and no macros at all &mdash; scoring awareness, adequate fueling, hydration and consistency instead. Awareness is scored on <b>answering, not on the answer</b>: a 1-out-of-5 satisfaction scores exactly like a 5."),
 ],
 tail="""      <p class="rp-fine reveal" style="margin-top:26px;max-width:76ch"><b>What it will not do:</b> it does not diagnose, deliver medical nutrition therapy, or set a target. It can flag a possible allergen conflict from what it detects and what the client declared &mdash; it can <b>never</b> confirm a plate is allergen-free, and it says so on the screen.</p>
""")

ANCHORS = {
 "coaches.html": ("  <!-- ============ REAL SCREENS ============ -->", COACH),
 "trainers.html": ("  <!-- ============ FEATURES ============ -->", TRAINER),
 "parents.html": ("  <!-- ============ WHAT YOU SEE ============ -->", PARENT),
 "dietitians.html": ("  <!-- ============ FEATURES ============ -->", DIETITIAN),
}

if __name__ == "__main__":
    for path, (anchor, block) in ANCHORS.items():
        s = io.open(path, encoding="utf-8").read()
        if 'id="how"' in s:
            print(f"{path}: already has a how-it-works section, skipping")
            continue
        if anchor not in s:
            print(f"{path}: ANCHOR NOT FOUND")
            continue
        s = s.replace(anchor, block + anchor, 1)
        io.open(path, "w", encoding="utf-8", newline="").write(s)
        print(f"{path}: inserted ({block.count('loop-step')} steps)")
