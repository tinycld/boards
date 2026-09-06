---
title: Filtering, sorting and board views
summary: Show only the cards you care about, order each list, and switch between the board, list, timeline and backlog views
tags: [filter, sort, board, search, labels, assignees, views, list view, table, timeline]
order: 30
---

## Filtering the board

Click the filter icon in the board's top bar to choose what to show. You can
narrow by the status of a card's list (backlog, to do, in progress, done or
canceled), priority, label, who a card is assigned to (including **Assigned
to me** and **Unassigned**), who reported it, its due state (overdue, due
soon, with or without a date), whether it has an estimate, and a word from
its title or key. Cards in a done or canceled list never count as overdue or
due soon. Within one group any
match is enough; across groups a card has to match all of them.

While a filter is on, a row of chips under the header shows exactly what is
applied. Click a chip's `×` to drop that one condition, or **Clear all** to
see everything again. Each list's count turns into `shown/total` so a
half-empty column is never a mystery, and the board's subtitle reads
"12 of 40 cards". A list's points total counts only the cards it is showing.

A filter is yours alone and belongs to the board it was set on: switching to
another board shows that board unfiltered, and reloading the app starts you
clean.

Hidden cards keep their place. If you drag a card between two visible
neighbours, it lands between them in the board's order and stays there when the
filter is cleared. If the card you have open is hidden by a filter, the panel
closes — clear the filter to get it back.

You can also narrow the board to one or more [epics](help://boards:epics), or to
the cards nobody has filed under one yet.

## Sorting a list

The sort icon next to the filter orders every list by **priority**, **due
date**, **start date**, **estimate**, **created**, **title** or **key**,
ascending or descending. Cards without a date or an estimate always sort
last. **Manual order** is the default: the
order you arranged by dragging.

While a sort is on, dragging a card up or down within its list does nothing —
the sort decides the order. You can still drag a card to another list, where
it takes its sorted place. Clearing the sort brings back your arrangement.

## Other views

The view toggle beside the filter switches between the board's views: the
columns you start on, a **list**, a **timeline**, and — on a board that plans
in [sprints](help://boards:sprints) — a **backlog**. The same filter applies in
all of them, and the choice is remembered per board.

### List view

The list view shows the board as a table:
one row per card, with its key, title, list, assignees, labels, start and due
dates, priority and estimate. Click a column heading to sort by it; click again
to reverse.

There is no dragging in the list — to move a card, open it and use the list
stepper or the card menu. The `j` and `k` keys walk the rows, and `Enter`
opens the highlighted card.

### Timeline view

The timeline lays the board out against a calendar: one row per card that
has a start or due date, grouped by list, with a bar from start to due — or a
dot on the one date a card has. Bars take the due date's colour, so late work
reads red at a glance, and today is marked on the axis. Scroll sideways to
move through time; the card names stay pinned at the left.

Cards with no dates are left out, and the same filter and sort apply as in
the other views. Click a row to open the card, or walk the rows with `j` and
`k` and press `Enter`. Dates are changed on the card, not by dragging a bar.

## Sprints

On a board that plans in [sprints](help://boards:sprints), the filter has a
**Sprints** section (the active sprint, any sprint, or **No sprint**), the
sort menu has **Sprint**, and a pill in the header scopes every view to the
running sprint, the backlog, or all cards. The timeline draws each sprint as
a band over its dates.
