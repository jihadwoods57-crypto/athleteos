"""Second pass: the JSON-LD FAQ blocks and a few body strings the entity-normalising pass missed.
These must agree with the visible copy or the structured data contradicts the page.
Run from web/landing/:  python ../landing-src/fix-jsonld.py
"""
import io

FIX = {
"coaches.html": [
 ('"text": "The professional pays; athletes are always free with a paying coach, trainer, or program. The first 50 coaches and facilities lock 50% off for 12 months."',
  '"text": "You pay; athletes never do. Programs run $249/mo up to 30 active participants, $499 up to 75, $799 up to 150. An independent coach on their own book is $99/mo up to 25 clients or $179/mo up to 50. Every plan has a 14-day trial and cancels in account settings. The first 50 coaches and facilities lock 50% off for 12 months."'),
],
"parents.html": [
 ('"text": "No. Parents see score, streaks, and completion only — never meal photos, weight, or check-in answers. Those stay between the athlete and their coach."',
  '"text": "No. The parent view returns exactly four things: the athlete\'s name, their daily score, their letter grade, and the date — never meal photos, weight, or check-in answers. Those stay between the athlete and their coach."'),
 ('"text": "No. Parents see score, streaks, and completion only — never meal photos, weight, or check-in answers. Those stay between the athlete and their coach."',
  '"text": "No. The parent view returns exactly four things: the athlete\'s name, their daily score, their letter grade, and the date — never meal photos, weight, or check-in answers. Those stay between the athlete and their coach."'),
],
"trainers.html": [
 ('"text": "No. Clients are free while attached to a trainer\'s practice. The trainer carries the subscription and gets the live book-wide view."',
  '"text": "Not for the app: clients are free on a trainer\'s book, because the trainer carries the subscription. Trainers can separately charge for their own coaching packages through OnStandard Pay, where the platform takes 15% and the rest goes to the trainer\'s Stripe account."'),
 ('"text": "Each client\'s daily score, recovery and readiness from the nightly check-in, and nutrition consistency — live, with honest empty states when a client hasn\'t logged."',
  '"text": "Everything a team coach sees: daily score, every logged meal with photo and macro read, recovery and readiness, weight as a trend, requirement completion and the meal threads. Coach and trainer are one operator role. Honest empty states when a client hasn\'t logged."'),
 ('"text": "Each client\'s daily score, recovery and readiness from the nightly check-in, and nutrition consistency — live, with honest empty states when a client hasn\'t logged."',
  '"text": "Everything a team coach sees: daily score, every logged meal with photo and macro read, recovery and readiness, weight as a trend, requirement completion and the meal threads. Coach and trainer are one operator role. Honest empty states when a client hasn\'t logged."'),
],
}

if __name__ == "__main__":
    for path, reps in FIX.items():
        s = io.open(path, encoding="utf-8").read()
        n = 0
        for a, b in reps:
            if a in s:
                s = s.replace(a, b); n += 1
        io.open(path, "w", encoding="utf-8", newline="").write(s)
        print(f"{path}: {n} applied")
