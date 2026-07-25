# Design Direction

## What OnStandard should feel like

The product already has a real point of view, stated on its own first screen:

> The coach sets the standard. You prove the work. The score never lies.

That is a strong, specific position — accountability, evidence, and a number you cannot argue
with. The design should serve it. Three consequences follow.

**1. The number is the product.** The daily score is the one thing every role opens the app to
see. Today it renders as a small numeral on a dashed ring inside a bordered card, visually
outranked by an amber CTA beneath it. The signature moment should be the most confident element
on the screen, not the third most.

**2. Evidence beats decoration.** The codebase already refuses to fabricate — no demo meals, no
invented personas, no sentence where there is no data. The visual language should match that
restraint: fewer surfaces, more information. A screen that shows one true thing clearly is worth
more than four cards hedging.

**3. Honest, not punitive.** The copy gets this right in places worth protecting: a failed
verification records *unverified*, never *missed*; an incomplete day is "still open", not failed;
late still counts. The design should never turn a bad day into a red wall.

## The central problem to fix

**Hierarchy is currently built from containers instead of from type.**

The measurements make the causal chain unambiguous: 45 font sizes with 618 declarations packed
into a 7px band means adjacent levels differ by less than a device pixel. Typography therefore
cannot separate anything — so every new level of meaning got a new border and a new background
tint. The result is 130 card-like rules, 165 hairlines and 46 card class names for one idea.

This is why the app reads as "a collection of disconnected cards". The cards are a *symptom*.
Removing borders without fixing the type scale would just re-grow them.

The direction is therefore: **let type and space carry hierarchy, and let surfaces become rare
enough to mean something.** A card should signal "this is a distinct object", not "this is the
next paragraph".

## Working rules

- **One primary action per screen.** The FAB and the NOW card should not compete.
- **State a fact once.** Athlete Home currently says "4 remaining" three ways above the fold.
- **Colour is semantic, never decorative.** Green means on standard, amber means due, red means
  critical. When four hues appear at once, none of them means anything.
- **Surfaces are earned.** Prefer spacing and type weight; reach for a border last.
- **Empty states are content.** They are the first thing most users see, and this codebase already
  writes them honestly.
- **Both themes, always.** A colour without a light value is not finished.
- **44px minimum for anything tappable.** No exceptions for "it is just a chip".

## Sequence

1. **Athlete Home** against the new type scale — the highest-traffic screen and the best test of
   whether the scale is right. Success looks like fewer borders surviving, not more.
2. **Score breakdown** — make the number and its explanation the whole screen.
3. **Meal analysis** — already the strongest flow; consolidate its three skeleton systems and its
   duplicate labels.
4. **Coach home** — "who needs attention and why" should be answerable in one glance.
5. **Component consolidation** — 11 stat tiles to 1, 15 progress bars to 2, 21 pills to 1, 6 empty
   states to 1, 4 button systems to 1.

Each step is verifiable in the QC contact sheet, which is why the type migration is per screen
rather than one sweep.
