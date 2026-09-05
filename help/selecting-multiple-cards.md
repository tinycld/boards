---
title: Selecting multiple cards
summary: Change, move or archive many cards at once instead of opening them one by one
tags: [select, multi-select, bulk, batch, move, label, assign, archive, selection]
order: 22
---

Most changes to a card are made by opening it. When the same change applies to
several cards — the same label, the same assignee, moving a batch into the next
list — you can select them all first and make the change once.

Selecting cards does not change anything on its own. Nothing is written until
you choose an action from the bar that appears at the bottom of the board.

## Selecting cards

On a computer, hold a modifier while clicking:

- **⌘-click** a card to add it to the selection, or to take it back out.
- **⇧-click** a card to select everything between it and the last card you
  picked. On the board this follows column order, top to bottom; in the table
  view it follows the rows as they are sorted.
- **⌘A** selects every card the board is currently showing. If a filter is on,
  that means the cards you can see — not the ones the filter is hiding.

Once a selection exists, an ordinary click narrows it to the one card you
clicked rather than opening that card. Press **Esc** to drop the selection; the
board goes back to opening cards on a click.

On a phone or tablet there are no modifier keys, so tap **Select** in the board
header first. While it is on, tapping a card adds or removes it. Tap **Select**
again to leave.

You can also build a selection from the keyboard: **⇧J** and **⇧K** extend it
downwards and upwards as you move.

## Changing the selected cards

The bar at the bottom of the board shows how many cards are selected and what
you can do to them:

- **Move** puts every selected card at the bottom of a list, keeping the order
  they were in.
- **Label** and **Assign** add or remove a label or a person across the
  selection.
- **Priority** and **Points** set the same value on every selected card.
- **Archive** takes them all off the board. They are not deleted — see
  [Archiving and deleting](help://boards:archiving-and-deleting) for how to get
  them back.

**X** archives the selection too, so you can select a batch and clear it without
reaching for the bar.

A label or person that only *some* of the selected cards carry shows a small
count beside **Label** or **Assign**. Choosing it then adds it to the cards that
are missing it, rather than removing it from the ones that have it.

## When a selection is dropped

The selection is cleared whenever what is on screen changes underneath it —
switching board, switching between the board and table views, or changing the
filter. This is deliberate: a selected card that a filter has hidden would still
be changed by the next action, with nothing on screen to say so.

If someone else archives or deletes a card while you have it selected, that card
is simply skipped when you run an action.
