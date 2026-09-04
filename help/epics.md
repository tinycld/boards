---
title: Epics
summary: Group cards into a larger piece of work and track its progress in points
tags: [epics, grouping, planning, scope, progress, points, roadmap]
order: 28
---

An **epic** is a large piece of work made of many cards — "User authentication",
"Billing", "Q3 migration". Filing cards under one lets you see how much of that
work is done without hunting for its cards across the board.

An epic groups by **what** the work is. That is different from a list, which
says what stage a card is at, and from a sub-task, which is one card belonging
to another. A card can sit in any list, have its own sub-tasks, and still belong
to an epic.

## Creating an epic

Epics belong to a board, so they are set up from the board rather than from a
card. Open the board menu (the **⋯** beside the board name) and choose
**Epics…**. Each epic has a name and a color; the color is what identifies it on
the card faces.

You can rename or recolor an epic at any time from the same dialog.

## Filing a card

Open a card and use the **Epic** row in its details. A card belongs to at most
one epic — pick a different one to move it, or **No epic** to unfile it.

The epic then shows on the card's face as a colored dot and its name, beside the
sub-task chip. Epics only ever offer the cards' own board, so a card is never
filed under a plan its readers cannot see.

## Progress

Each epic tracks how much of its work is finished, in **points**:

    Authentication          8 / 21 pts

The total is the sum of the estimates on the cards filed under it. **A card with
no estimate counts as 1 point**, so the number is meaningful whether or not your
board estimates — on a board that never sets estimates, an epic simply reads as
a count of its cards.

Points count as done when the card reaches a list marked **Done** or
**Canceled**, which is the same rule the list header uses, so the two always
agree. Archived cards are left out of both halves: archived work is neither
finished nor outstanding.

The progress is kept by the server from the cards actually filed under the
epic, so it stays right no matter who moves a card, and it does not change when
you filter the board.

## Finding an epic's work

The board filter has an **Epics** section: pick one or more epics to show only
their cards, or **No epic** to find work nobody has filed yet. Archived epics
still appear in the filter — looking up what is left in a closed epic is exactly
when you need it.

## Finishing an epic

**Archive** it, from the board menu's **Epics…** dialog. An archived epic stops
being offered when filing new cards, but the cards already in it stay filed and
keep showing its name.

Deleting an epic is different, and the dialog warns you: the cards are **not**
deleted — they stay on the board and simply become unfiled — but putting them
back means filing each one by hand. Archive is almost always what you want.

## Moving a card to another board

An epic belongs to one board, so a card moving to a different board cannot take
its epic id with it. The move dialog asks what to do:

- **Move** files the card under an epic of the same name on the target board,
  creating one if there isn't one already.
- **Unlink** leaves the card unfiled on its new board.

The card's history records either outcome, so it is always clear what happened.
