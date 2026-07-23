"""Founding 50: replace the 50%-off-for-12-months discount with a price lock.

Reason (founder decision 2026-07-23): src/core/pricing.ts:49-53 records that Solo/Professional
were repriced UP in July because the old numbers sat at/below the per-seat AI cost floor on an
engaged roster — "a MORE successful trainer earned us LESS margin". A 50% discount reproduces
exactly that: $179/50 seats = $3.58/seat becomes $1.79 against a ~$2 heavy-user AI cost. The org
tiers survive the cut; the professional tiers do not, and founding customers are the cohort most
likely to be fully engaged.

The replacement offer costs nothing today, is worth more the more prices rise later, and removes
the "grandfathered for good" / "50% off" ambiguity that read as half-price-forever. It also states
what happens to the $10/mo per-extra-client overage, which the discount left undefined.

Run once from web/landing/:  python ../landing-src/fix-founding.py
"""
import io, re

def norm(t):
    return (t.replace('&mdash;', '—').replace('&ndash;', '–')
             .replace('&#8209;', '‑').replace('&rsquo;', "'").replace('’', "'")
             .replace('&amp;', '&').replace('&nbsp;', ' '))

PAIRS = [
 # hero fine print — coaches/facilities wording
 ("<b>First 50 coaches &amp; facilities lock 50% off for 12 months</b> &mdash; grandfathered for good.",
  "<b>The first 50 coaches &amp; facilities lock today's price for life</b> &mdash; free through the beta, and a later price rise never touches them."),
 ("<b>First 50 coaches &amp; facilities lock 50% off for 12 months</b> — grandfathered for good.",
  "<b>The first 50 coaches &amp; facilities lock today's price for life</b> — free through the beta, and a later price rise never touches them."),
 # hero fine print — professionals wording
 ("<b>First 50 professionals lock 50% off for 12 months</b> &mdash; grandfathered for good.",
  "<b>The first 50 professionals lock today's price for life</b> &mdash; free through the beta, and a later price rise never touches them."),
 ("<b>First 50 professionals lock 50% off for 12 months</b> — grandfathered for good.",
  "<b>The first 50 professionals lock today's price for life</b> — free through the beta, and a later price rise never touches them."),
 # finale tick lists
 ("<li>Founding 50: 50% off for 12 months</li>",
  "<li>Founding 50: today's price, locked for life</li>"),
 # pricing card kicker
 ("<span class=\"pk\">/month · Founding 50 lock 50% off</span>",
  "<span class=\"pk\">/month · Founding 50 lock this price for life</span>"),
 # story block
 ("<b>Founding 50:</b> the first 50 coaches and facilities lock 50% off for 12 months, grandfathered so a later price rise never touches them. You're not buying software early; you're setting the standard with us.",
  "<b>Founding 50:</b> the first 50 coaches and facilities are free through the beta, then lock today's price permanently &mdash; every later price rise passes them by. No discount games, no expiry to diarise. You're not buying software early; you're setting the standard with us."),
 # pricing fine print — also resolves the $10 overage question the discount left open
 ("Opening pricing. Founding partners: the first 50 coaches and facilities lock 50% off for 12 months, grandfathered so a later price rise never touches them.",
  "Opening pricing. Founding partners: the first 50 coaches and facilities are free through the beta, then lock today's price permanently &mdash; including the $10/month per active client beyond a plan's limit. A later price rise never touches them."),
 # coaches FAQ body
 ("Founding 50 lock 50% off for 12 months, grandfathered.",
  "Founding 50 are free through the beta, then lock today's price permanently &mdash; including the $10/month per client over a plan's limit."),
 # coaches JSON-LD
 ("The first 50 coaches and facilities lock 50% off for 12 months.",
  "The first 50 coaches and facilities are free through the beta, then lock today's price permanently, including the $10/month per client over a plan's limit."),
 # role-page bands
 ("Founding coaches are onboarded personally, usually within a day. Your free 14&#8209;day trial starts when we onboard you — no card until you start, and your athletes ride free.",
  "Founding coaches are onboarded personally, usually within a day. You're free through the beta, then locked at today's price for life — no card until we start charging, and your athletes ride free."),
 ("Founding professionals are onboarded personally, usually within a day. Free 14&#8209;day trial when we onboard you, no card until you start — and every client on your book rides free.",
  "Founding professionals are onboarded personally, usually within a day. Free through the beta, then locked at today's price for life — no card until we start charging, and every client on your book rides free."),
 ("Founding professionals are onboarded personally, usually within a day — free 14&#8209;day trial when we onboard you, no card until you start, clients always free.",
  "Founding professionals are onboarded personally, usually within a day — free through the beta, then locked at today's price for life, no card until we start charging, clients always free."),
]

PAGES = ["index.html", "athletes.html", "coaches.html", "trainers.html", "parents.html", "dietitians.html"]

if __name__ == "__main__":
    total = 0
    for path in PAGES:
        s = io.open(path, encoding="utf-8").read()
        n = 0
        for a, b in PAIRS:
            if a in s:
                s = s.replace(a, b); n += s.count(b) and 1
                continue
            # entity-tolerant fallback
            na, ns = norm(a), norm(s)
            idx = ns.find(na)
            if idx < 0:
                continue
            lo, hi = 0, len(s)
            while lo < hi:
                mid = (lo + hi) // 2
                if len(norm(s[:mid])) < idx: lo = mid + 1
                else: hi = mid
            start, end = lo, lo
            while len(norm(s[start:end])) < len(na) and end < len(s): end += 1
            s = s[:start] + b + s[end:]
            n += 1
        io.open(path, "w", encoding="utf-8", newline="").write(s)
        total += n
        print(f"{path}: {n} replaced")
    print(f"\ntotal {total}")
