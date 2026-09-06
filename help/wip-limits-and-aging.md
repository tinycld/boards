---
title: WIP limits and card aging
summary: Cap how many cards a column holds, and see at a glance which cards have stopped moving
tags: [wip, limit, kanban, aging, stale, flow, column, list]
order: 33
---

Two signals about the health of a board, both off until you turn them on. A
**WIP limit** says how many cards belong in a column at once. **Card aging**
tints a card that has sat in the same column too long.

## Setting a WIP limit on a column

Open the column's `⋯` menu and choose **Set WIP limit…**. Enter how many cards
belong in that column, then **Save**. The menu row afterwards reads
**WIP limit: 3**, so you can see the value without opening the dialog again.

The column's count then reads `2 / 3` — the cards in the column, over its
limit. It turns amber when the column is full and red with a warning triangle
when it is over. A collapsed column shows the same badge on its spine, which is
when it matters most: none of its cards are visible.

Enter **0** to remove the limit. The count goes back to a plain number.

### Nothing is blocked

A limit is a warning, never a wall. You can always drop, create or move a card
into a full column, and so can the command line, an import and a board rule.
A limit that refused work would stop a bulk move or an import partway through
and leave the board half-changed — the number is there to be noticed, and
deciding what to do about it is yours.

### Filters do not relax a limit

The count beside a limit always describes **every** card in the column, even
while a filter hides some of them. A column that went back under its limit
because you narrowed the board would be misleading at exactly the wrong
moment. The points total beside it behaves the opposite way, and deliberately:
it adds up the cards you can see.

On a board using [sprints](help://boards:sprints), the count describes the
cards in the sprint you are looking at, not the whole backlog behind it.

## Highlighting cards that have stopped moving

Open the board's `⋯` menu, choose **Board settings…**, and set **Highlight
cards untouched for (days)**. Cards that have sat in the same column that long
are tinted amber; at twice that long they turn red. **0** turns it off.

The clock starts when a card **enters a column**, not when it was last edited.
Commenting on a card, relabelling it or changing its due date does not reset
it — only moving it to another column does. That is the point: a card someone
keeps fiddling with but never advances is exactly the card worth noticing.

Cards in a done or canceled list are never tinted. The work there has
finished, however long ago.

## From the command line

    tinycld boards column wip "In progress" 3 --board Launch
    tinycld boards column wip "In progress" 0 --board Launch

`boards column show` lists every column with its limit, and a `-` where there
is none. See [the command line](help://boards:command-line) for setup.
