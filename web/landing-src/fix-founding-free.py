"""Founding 50: drop the "free through the beta" clause. The offer is the price lock, only.

Reason (founder decision 2026-07-30): "free through the beta" was never implemented anywhere.
0161 created a `billing_starts_at` column to carry it and no code has ever read or written that
column. Meanwhile the only path to a founding slot is a COMPLETED Stripe checkout
(stripe-webhook/index.ts, `claim_founding_slot` on checkout.session.completed) — so the pages
promised free access on a route that requires paying, and a coach who took the copy at its word
and never subscribed would never have become founding at all.

Killing it rather than building it, for the same reason the 50%-off offer died (see
fix-founding.py): an engaged founding roster costs ~$2/seat in AI, so the fifty most-committed
accounts would have been the fifty largest losses. What remains is what the code actually does and
what is worth more the more prices rise later — the permanent price-generation lock plus the
locked $10/mo overage. Where the free clause carried the sentence, the overage lock replaces it,
because that is the clause a hand-managed arrangement loses first.

The standard 14-day trial (billing-checkout) is untouched and is what the role-page bands now say.

Run once from web/landing/:  python ../landing-src/fix-founding-free.py
"""
import io

PAIRS = [
 # ---- hero fine print. The free clause is replaced by the overage lock, not just deleted:
 #      it is a real, checkable promise and the strongest half of what we actually enforce.
 ("<b>The first 50 coaches &amp; facilities lock today's price for life</b> &mdash; free through the beta, and a later price rise never touches them.",
  "<b>The first 50 coaches &amp; facilities lock today's price for life</b> &mdash; including the $10/month per extra active client. A later price rise never touches them."),
 ("<b>The first 50 coaches &amp; facilities lock today's price for life</b> — free through the beta, and a later price rise never touches them.",
  "<b>The first 50 coaches &amp; facilities lock today's price for life</b> — including the $10/month per extra active client. A later price rise never touches them."),
 ("<b>The first 50 professionals lock today's price for life</b> &mdash; free through the beta, and a later price rise never touches them.",
  "<b>The first 50 professionals lock today's price for life</b> &mdash; including the $10/month per extra active client. A later price rise never touches them."),
 ("<b>The first 50 professionals lock today's price for life</b> — free through the beta, and a later price rise never touches them.",
  "<b>The first 50 professionals lock today's price for life</b> — including the $10/month per extra active client. A later price rise never touches them."),

 # ---- story block (index). "No discount games" now reads truer, not less true.
 ("<b>Founding 50:</b> the first 50 coaches and facilities are free through the beta, then lock today's price permanently",
  "<b>Founding 50:</b> the first 50 coaches and facilities lock today's price permanently"),

 # ---- pricing fine print (index)
 ("Opening pricing. Founding partners: the first 50 coaches and facilities are free through the beta, then lock today's price permanently",
  "Opening pricing. Founding partners: the first 50 coaches and facilities lock today's price permanently"),

 # ---- FAQ bodies
 ("Founding 50 are free through the beta, then lock today's price permanently",
  "Founding 50 lock today's price permanently"),
 ("the first 50 professionals are free through the beta, then lock today's price permanently",
  "the first 50 professionals lock today's price permanently"),

 # ---- JSON-LD FAQ answers (must match the visible copy or the rich result contradicts the page)
 ("The first 50 coaches and facilities are free through the beta, then lock today's price permanently",
  "The first 50 coaches and facilities lock today's price permanently"),

 # ---- role-page onboarding bands. These now describe the real 14-day trial rather than a beta
 #      that has no end date and no enforcement.
 ("Founding coaches are onboarded personally, usually within a day. You're free through the beta, then locked at today's price for life — no card until we start charging, and your athletes ride free.",
  "Founding coaches are onboarded personally, usually within a day. Your free 14&#8209;day trial starts when we onboard you &mdash; then today's price, locked for life. Your athletes always ride free."),
 ("Founding professionals are onboarded personally, usually within a day. Free through the beta, then locked at today's price for life — no card until we start charging, and every client on your book rides free.",
  "Founding professionals are onboarded personally, usually within a day. Your free 14&#8209;day trial starts when we onboard you &mdash; then today's price, locked for life. Every client on your book rides free."),
 ("Founding professionals are onboarded personally, usually within a day — free through the beta, then locked at today's price for life, no card until we start charging, clients always free.",
  "Founding professionals are onboarded personally, usually within a day &mdash; your free 14&#8209;day trial starts when we onboard you, then today's price locked for life, clients always free."),
]

# site.js carries the waitlist modal's founding copy, which no page template covers.
PAGES = ["index.html", "athletes.html", "coaches.html", "trainers.html", "parents.html",
         "dietitians.html", "js/site.js"]

if __name__ == "__main__":
    total = 0
    for path in PAGES:
        s = io.open(path, encoding="utf-8").read()
        n = 0
        for a, b in PAIRS:
            c = s.count(a)
            if c:
                s = s.replace(a, b)
                n += c
        io.open(path, "w", encoding="utf-8", newline="").write(s)
        total += n
        print(f"{path}: {n} replaced")

    # A miss is silent otherwise, and a half-swept promise is worse than an unswept one.
    print(f"\ntotal {total}")
    leftover = 0
    for path in PAGES:
        s = io.open(path, encoding="utf-8").read().lower()
        c = s.count("free through the beta") + s.count("no card until we start charging")
        if c:
            print(f"  LEFTOVER {path}: {c}")
            leftover += c
    print("clean" if not leftover else f"{leftover} MENTIONS STILL LIVE")
