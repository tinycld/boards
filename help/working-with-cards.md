---
title: Working with cards
summary: Opening a card, editing its details, and moving it between lists
tags: [cards, board, kanban, detail, shortcuts, "drag and drop"]
order: 20
---

## Opening a card

Click any card on the board to open it in a panel on the right. The board stays
visible behind the panel — click a different card to switch to it without
closing anything.

To give a card the whole screen, click the expand button (the arrows in the
panel's top corner). Your browser's back button returns you to the board.

## Moving cards by drag and drop

To move a card, drag it anywhere you like — within its list to reorder, or
into another list. On a computer, click and drag; on a touch screen, press and
hold a card for a moment, then drag. While you drag, a gap opens at the exact
spot the card will land, and the list under your pointer is outlined. Drop the
card outside every list to cancel — it glides back to where it started.

Dragging a card toward the left or right edge of the window scrolls the board,
so you can reach lists that are off screen.

## Rearranging lists

To move a whole list, drag it by its name in the list header. A colored bar
shows which side of the neighboring list it will land on. The list menu's
**Move left** and **Move right** do the same thing one step at a time.

## Making room on a busy board

Two controls change how much of the board you see at once. Both are yours
alone — they change nothing for anyone else on the board, and they stay set
the next time you open it.

To fold a list you're not working in down to a narrow strip, open its menu and
choose **Collapse list**, or double-click the list's name. The strip shows the
number of cards at the top and the list's name down its side, so a row of
collapsed lists still tells you where the work is piling up. Click the strip to
open it again.

Collapsed lists are still lists: you can drag a card onto one, and it lands
there.

To fit more cards on screen, click the rows button in the board's top bar to
**Hide card details**. Cards shrink to a single line, keeping the title, who
it's assigned to, and its due date — labels stay as colored dots. Click the
button again to bring the full cards back.

## Reordering a checklist

In an open card, drag a checklist item by the grip at the start of its row.
On a computer the grip appears when you point at the row.

## The list stepper

The row of small segments at the top of an open card shows where the card sits
on the board: one segment per list, filled up to the card's current list. To
move the card, click the segment for the list you want — the board updates
immediately.

## Card details

An open card shows its assignees, labels, and due date, followed by the
description, checklist, and comments. A due date turns amber when it's less
than two days away and red once it has passed — the same colors the board
shows on the card itself.

## Writing a description

Click a description and start typing — it formats as you go. Type `## ` for a
heading, `- ` for a bullet, `- [ ] ` for a checkbox, `**bold**`, `` `code` ``
or `~~strikethrough~~`, and each turns into the real thing as you finish it.
Tables and images you paste in are kept too. Everything is stored as Markdown,
so a description written here reads the same anywhere else.

There is no save button: every change is kept as you type. Esc leaves the
description without discarding anything, and plain Enter starts a new line,
since a description is prose.

## Writing a description together

Several people can write the same description at once. Edits appear as they are
typed, each person's cursor shows where they are working, and changes merge
without anyone overwriting anyone else.

If your connection drops mid-sentence, keep typing — your words are held on
your machine and sent as soon as you are back. A short note under the
description says when that is happening.

People with **View** access can read a description but not change it.

## Comments

The box at the bottom of an open card posts a comment. Markdown works here too,
so `**bold**`, `` `code` ``, lists and links all render once the comment is
posted — type the source and it formats when it appears.

Press ⌘↩ to post. Plain Enter starts a new line, so a longer comment does not
send itself half-written. Reply to a comment to keep a thread together.

## Who else is here

When someone else has the same board open, their initials appear beside the
member avatars at the top. Open a card they're looking at and you'll see them
on the card face too, so you can tell at a glance if a teammate is already
working on something.

These appear and disappear as people come and go — nothing is recorded, and
you'll never see yourself.

## Keyboard shortcuts

You can work a board without touching the mouse. Press **J** to start — the
first press highlights a card, and from there:

- **J** / **↓** — next card
- **K** / **↑** — previous card
- **←** / **→** — the card beside it in the next column over
- **Enter** or **O** — open the highlighted card
- **Esc** — clear the highlight

J and K walk the board in order, list by list, so you can review a whole board
a card at a time. The arrow keys move across columns instead, keeping your place
in the column — handy when a board is laid out as stages.

To move a card, hold **⇧** with an arrow key:

- **⇧←** / **⇧→** — send it to the column beside it
- **⇧↑** / **⇧↓** — move it up or down its own column
- **X** — archive it

To add something:

- **N** — add a card to the highlighted column. If nothing is highlighted the
  first column takes it, and a collapsed column opens first.
- **⇧N** — add a list

The composer stays open after you press Enter, so you can type several cards in
a row without reaching for the mouse.

Moving, archiving and adding need permission to edit the board; if you're a
viewer or commentor, the navigation keys still work.

With a card open:

- **J** — next card
- **K** — previous card
- **E** — edit the title
- **Esc** — close the card (or return to the board from the full-screen view)

Press **⇧?** anywhere to see every shortcut the app knows, including the ones
for jumping between apps.

## Missing a button?

What you can do on a board depends on your role there. If you can't add or
edit cards, you're likely a viewer or commentor — see
[Sharing boards](help://cards:sharing-boards).
